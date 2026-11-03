# 長時間執行操作與非同步 API 契約

當一項操作需要數十秒甚至數十分鐘（例如匯出大型報表、轉檔、訓練模型或佈建雲端資源），強迫呼叫端維持一條同步連線等待，會遇到代理伺服器逾時、連線中斷與重試不確定性。**非同步 API 的核心設計，是將「受理請求」與「完成工作」拆成兩個階段，並把執行過程建模為可獨立查詢、等待與取消的操作資源（Operation resource）。**[來源：RFC 9110 §15.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3)、[AIP-151：Long-running operations](https://google.aip.dev/151)

本文接續[輸入、輸出與失敗語意](input-output-failure-semantics.md)、[逾時、重試與冪等性](timeouts-retries-and-idempotency.md)與[狀態碼與錯誤表示](status-codes-and-error-representations.md)。若完成通知改由服務主動推送，另見[Webhook、事件回呼與反向通知契約](webhooks-and-event-callbacks.md)。

查證日期：2026-11-03。依據 IETF RFC 9110（2022 年 6 月）與查證當日的 Google AIP-151 設計指南。本文只查閱文件，未執行服務或 HTTP 請求；文中的匯出工作與 JSON 皆為本站自創契約示例，不代表所有 API 的統一標準。

## 為什麼不能只靠「把 timeout 調大」？

在同步呼叫中，回應同時承載「請求已被接受」與「最終執行結果」。只要處理時間超過數秒，拉長 timeout 會帶來三個問題：

1. **中間層限制不受單一端點控制**：瀏覽器、行動網路、CDN、負載平衡器與 API Gateway 各有自己的連線與整合逾時上限（參見 AWS 的[API 入口與程式執行](../aws/api-entry-and-program-execution.md#timeout-不等於後端沒有完成)）。
2. **斷線即失去進度能見度**：若等待 50 秒後網路瞬斷，呼叫端無從得知工作究竟是失敗、還在跑，還是已經完成。
3. **重送代價高昂**：耗時工作通常伴隨高昂運算或外部副作用；缺少獨立操作資源時，盲目重送很容易造成重複執行。

將耗時操作改為非同步契約後，首次呼叫只負責驗證輸入、建立工作並回傳「操作資源」的識別與狀態入口；後續進度與最終結果則透過該操作資源取得。參考 [AIP-151：Rationale](https://google.aip.dev/151#rationale)。

## 操作資源（Operation Resource）的狀態與欄位契約

不論底層使用 HTTP、gRPC 或其他協定，清楚的非同步契約通常讓首次呼叫立即回傳一個代表「本次執行過程」的操作物件，而非最終業務資源本身。Google AIP-151 將此概念正規化為 `Operation` 資源；在一般 HTTP API 中，也常搭配 `202 Accepted`、`Location`（指向操作狀態 URI）與 `Retry-After`（建議下次輪詢等待秒數）表達。參考 [RFC 9110 §15.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3)、[§10.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.2)、[§10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3) 及 [AIP-151：Guidance](https://google.aip.dev/151#guidance)。

| 契約面向 | 需要交代的內容 | 常見誤解 |
| --- | --- | --- |
| 操作識別（`id`／`name`） | 用來查詢、等待或取消該次非同步工作的唯一識別 | 把操作 ID 當成最終產出資源的 ID |
| 狀態機（`status`／`done`） | 區分排隊中（`pending`）、執行中（`running`）與終態（`succeeded`、`failed`、`canceled`） | 只用布林值卻沒說明取消或部分失敗算哪一種終態 |
| 進度與中繼資料（`metadata`） | 建立時間、更新時間、階段說明或估算百分比 | 把預估進度百分比當成精確的剩餘時間保證 |
| 成功結果（`result`／`response`） | 終態為成功時，內嵌最終結果或提供產出資源的讀取位置 | 在 `202 Accepted` 階段就假設結果已經可用 |
| 失敗原因（`error`） | 終態為失敗時，提供結構化的錯誤代碼與原因說明 | 查詢操作狀態成功（HTTP `200`）卻誤以為背景工作本身也成功 |

### 「查詢操作成功」不等於「背景工作成功」

這是實作輪詢（polling）時最常見的語意混淆：

- 當呼叫端 `GET /operations/op-42` 時，如果伺服器順利查出這筆操作的紀錄，HTTP 狀態碼通常是 `200 OK`——因為「讀取操作狀態」這個請求本身成功了。
- 至於背景匯出工作本身有沒有成功，必須讀取回應內容中的業務狀態欄位（例如 `status: "failed"` 與 `error` 物件，或 AIP-151 中 `done: true` 且帶有 `error` 而非 `response`）。不能只檢查 `response.status === 200` 就宣告任務完成。參考 [AIP-151：Errors](https://google.aip.dev/151#errors)。

## 自創例子：非同步文章匯出工作的完整生命週期

假設文章服務提供「建立匯出工作」API，支援以 `Idempotency-Key` 避免網路重送時重複建單（參見[逾時、重試與冪等性](timeouts-retries-and-idempotency.md)）。以下是自訂的 HTTP 概念互動，不是真實服務：

### 1. 發起操作並取得操作資源

```text
POST /article-exports HTTP/1.1
Host: api.example.com
Content-Type: application/json
Idempotency-Key: export-req-20261103-01

{"format": "pdf", "topic": "linux"}
```

伺服器完成參數驗證與權限檢查後，將工作排入背景佇列，立即回傳 `202 Accepted`：

```text
HTTP/1.1 202 Accepted
Content-Type: application/json
Location: https://api.example.com/operations/op-901
Retry-After: 5

{
  "id": "op-901",
  "status": "pending",
  "done": false,
  "created_at": "2026-11-03T14:00:00Z",
  "metadata": {
    "format": "pdf",
    "topic": "linux"
  }
}
```

### 2. 輪詢狀態與退避控制

呼叫端依 `Location` 與 `Retry-After` 等待後查詢 `GET /operations/op-901`。若工作失敗，回傳的 HTTP 狀態仍是 `200 OK`，但操作內容進入 `failed` 終態並附帶錯誤細節：

```json
{
  "id": "op-901",
  "status": "failed",
  "done": true,
  "created_at": "2026-11-03T14:00:00Z",
  "completed_at": "2026-11-03T14:00:12Z",
  "error": {
    "code": "EXPORT_RENDER_FAILED",
    "message": "PDF 渲染逾時，請縮小匯出範圍後重試"
  }
}
```

若工作順利完成，則進入 `succeeded` 終態，並提供最終成果的連結或摘要：

```json
{
  "id": "op-901",
  "status": "succeeded",
  "done": true,
  "created_at": "2026-11-03T14:00:00Z",
  "completed_at": "2026-11-03T14:00:18Z",
  "result": {
    "download_url": "https://api.example.com/exports/exp-77/download",
    "expires_at": "2026-11-04T14:00:18Z"
  }
}
```

輪詢時的客戶端與伺服器契約要點：

1. **避免固定高頻率輪詢**：若沒有 `Retry-After` 指引，呼叫端應採用帶有上限的指數退避與抖動（exponential backoff with jitter），並設定整體等待期限（deadline），避免大量客戶端同時每秒輪詢耗盡狀態查詢介面。
2. **終態不可逆**：當 `done: true`（不論是 `succeeded`、`failed` 或 `canceled`），狀態與結果即固定，後續輪詢不應再變回 `running`。

## 取消、過期保留與權限邊界

非同步操作比同步呼叫多了三個必須在文件寫清楚的邊界：

- **取消是「請求停止」，不保證立即中止或自動回復**：提供 `POST /operations/op-901/cancel` 時，契約須交代取消是盡力而為（best-effort）還是具交易回復能力。若背景工作已經完成，取消操作應明確告知已完成或忽略，而非假裝撤銷了已發生的外部副作用。參考 [AIP-151：Cancel](https://google.aip.dev/151)。
- **操作紀錄與產出物的保留期（TTL）**：伺服器通常不會永久保存所有歷史 `op-*` 狀態。契約須說明操作紀錄保留多久（例如 24 小時或 7 天），以及過期後查詢回傳 `404 Not Found` 時，呼叫端應如何透過業務資源清單核對結果。
- **操作狀態的存取控制**：操作 ID（如 `op-901`）不是免驗證的公開密碼。每次查詢或取消 `/operations/op-901` 時，伺服器仍須驗證目前呼叫者是否為建立該操作的主體（或具備對應讀取／管理權限），防止其他使用者透過猜測操作 ID 讀取別人的匯出結果或錯誤細節（參見[身分驗證與授權](authentication-and-authorization.md)與[Web 應用的存取控制](../web-security/access-control.md)）。

## 相關文件

- [API 共通知識索引](README.md)：回到跨語言概念與 HTTP 分支。
- [輸入、輸出與失敗語意](input-output-failure-semantics.md)：區分同步輸入驗證失敗與背景執行失敗。
- [逾時、重試與冪等性](timeouts-retries-and-idempotency.md)：結合冪等鍵防止發起非同步工作時重複建單。
- [狀態碼與錯誤表示](status-codes-and-error-representations.md)：理解 `202 Accepted`、`Location` 與結構化錯誤表示。
- [Webhook、事件回呼與反向通知契約](webhooks-and-event-callbacks.md)：不靠客戶端持續輪詢時，改由提供者主動通知結果的契約。
- [SQS、SNS 與 EventBridge](../aws/sqs-sns-and-eventbridge.md)：AWS 上承接非同步背景工作的佇列與事件服務。
