# 狀態碼與錯誤表示

送出 HTTP 請求後，呼叫端需要知道它是否成功、結果代表什麼，以及失敗後能如何處理。
狀態碼提供跨服務共通的結果語意；應用程式的具體原因，則可能需要回應內容補充。
兩者要一起讀，不能只看一個數字，也不能只看 JSON 裡的訊息。

本文接續[〈方法與操作語意〉](methods-and-operation-semantics.md)，
說明 HTTP 狀態類別、常見狀態與 Problem Details 錯誤表示，不綁定框架。

查證日期：2026-11-02。依據固定版本 RFC 9110（2022 年 6 月）、RFC 9457（2023 年 7 月）
與 RFC 6585（2012 年 4 月）。本文只查閱文件，未發送 HTTP 請求，也未實測服務。
範例為本站自創的教學契約，不代表既有產品。

## 狀態碼先表達 HTTP 的結果語意

**狀態碼（status code）**是三位數整數，描述請求結果及回應的語意。
第一位數決定類別；後兩位不構成另一層分類。有效 HTTP 狀態碼範圍為 100 至 599。
參考 [RFC 9110 §15](https://www.rfc-editor.org/rfc/rfc9110.html#section-15)。

| 類別 | 如何理解 |
| --- | --- |
| 1xx：資訊 | 傳達暫時性資訊，例如繼續傳送內容；101 則用於協定切換，不能一律預期後面再有一般最終回應 |
| 2xx：成功 | 請求已成功接收、理解並接受；是否完成工作仍須看具體狀態 |
| 3xx：重新導向 | 完成請求仍需進一步動作；不能一律解讀成「發生錯誤」 |
| 4xx：用戶端錯誤 | 請求看來有問題，或無法被履行；須再區分格式、身分與資源狀態等原因 |
| 5xx：伺服器錯誤 | 伺服器知道自己出錯，或無法執行所要求的方法 |

類別與個別狀態的定義見 [RFC 9110 §15–§15.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-15)。
這些名稱不是完整的責任歸屬報告；呼叫端仍要依具體狀態、標頭及契約判斷下一步。
英文說明短語也只是建議文字，協定意義不能依靠比對 `Unauthorized` 等字串取得。
參考 [RFC 9110 §15.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.1)。

## 成功不只有 200，也不一定已完成工作

| 狀態 | 表達的結果 | 閱讀限制與來源 |
| --- | --- | --- |
| `200 OK` | 請求已成功 | 內容意義依方法而異；GET 與 POST 不必傳回同類結果。見 [§15.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.1) |
| `201 Created` | 已完成請求，並建立一個或多個新資源 | 主要新資源由 `Location` 識別；沒有該欄位時以目標 URI 識別。見 [§15.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.2) |
| `202 Accepted` | 已接受處理，處理尚未完成 | 不保證最後一定執行或成功。見 [§15.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3) |
| `204 No Content` | 已成功履行，沒有額外回應內容 | 可有標頭，但不得帶內容或尾端欄位；不能附一份 JSON 成功訊息。見 [§15.3.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.5) |

例如，假想文章服務接受產生文章匯出檔的工作後回傳 202，只能表示工作已被接受。
匯出檔是否產生，仍須由該 API 的工作狀態查詢或其他完成通知契約確認。
HTTP 不會因背景工作稍後完成，就替原本請求再送一次最終狀態碼；
RFC 建議 202 的表示描述目前狀態，並指向或內嵌可監看狀態的資訊。
參考 [RFC 9110 §15.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3)。

## 失敗要分清楚拒絕的原因

以下挑選常見狀態，不是完整清單，也不是要求所有 API 都實作每一種。

| 狀態 | 主要語意 | 容易忽略的限制與來源 |
| --- | --- | --- |
| `400 Bad Request` | 因看來屬於用戶端的錯誤而無法或不願處理 | 格式錯誤、訊息分界錯誤等都是例子，不限於 JSON 語法。見 [§15.5.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.1) |
| `401 Unauthorized` | 缺少目標資源所需的有效認證憑證，請求未被套用 | 回應必須有 `WWW-Authenticate`，含至少一個適用的認證挑戰。見 [§15.5.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.2) |
| `403 Forbidden` | 理解請求，但拒絕履行 | 可能是憑證權限不足，也可能與憑證無關，不是一律「尚未登入」。見 [§15.5.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.4) |
| `404 Not Found` | 找不到目標資源的目前表示，或不願揭露其存在 | 不足以證明底層資料永遠不存在。見 [§15.5.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.5) |
| `405 Method Not Allowed` | 伺服器認識該方法，但目標資源不支援 | 必須以 `Allow` 列出目標目前支援的方法。見 [§15.5.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.6) |
| `409 Conflict` | 與目標資源目前狀態衝突，無法完成 | 用戶端可能解決衝突後重新提交；不是所有驗證失敗的統一代碼。見 [§15.5.10](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.10) |
| `415 Unsupported Media Type` | 請求內容格式不受目標的該方法支援 | 原因可涉及媒體類型、內容編碼或實際資料。見 [§15.5.16](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.16) |
| `422 Unprocessable Content` | 理解內容類型、內容語法正確，但無法處理其中指令 | 不能把語法壞掉或不支援類型的內容都歸到 422。見 [§15.5.21](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.21) |
| `429 Too Many Requests` | 使用者在一定時間內送出過多請求 | 可有 `Retry-After`；計數與識別使用者的方式由服務決定。見 [RFC 6585 §4](https://www.rfc-editor.org/rfc/rfc6585.html#section-4) |
| `500 Internal Server Error` | 非預期情況阻止伺服器履行請求 | 不能只憑狀態推定是哪個內部元件故障。見 [§15.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.1) |
| `503 Service Unavailable` | 暫時過載或排定維護，現在無法處理 | 可有 `Retry-After`，但不保證所有過載都會回傳 503。見 [§15.6.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.4) |

「驗證失敗」只是籠統名稱，可能指無法解析訊息、內容格式不支援、業務值無效，或與現有狀態衝突。
因此不能先規定所有驗證失敗一律用 400 或一律用 422，再忽略其他狀態的語意。
實際 API 應在符合 HTTP 定義的範圍內，記錄具體情況與狀態的對應方式，讓使用者能預期結果。

同樣地，429 或 503 不是立即無限重送的指令。是否可重試、如何等待，以及重送是否造成重複影響，
還要連同方法語意及應用契約判斷；先回看[〈方法與操作語意〉](methods-and-operation-semantics.md)。

## 狀態碼與應用錯誤，各自提供一層資訊

假設兩次更新文章都回傳 422，一次是標題超長，一次是發布日期不符合規則。
HTTP 狀態表達共通的處理結果，卻不一定足以讓程式辨識這兩個應用原因。
錯誤表示可補充機器能判讀的問題類型，以及給人閱讀的說明。
這是 RFC 9457 **Problem Details** 要處理的需求；它取代 RFC 7807，並以
`application/problem+json` 識別其 JSON 表示。
參考 [RFC 9457 §1](https://www.rfc-editor.org/rfc/rfc9457.html#section-1)與[§3](https://www.rfc-editor.org/rfc/rfc9457.html#section-3)。

| 成員 | 意義 |
| --- | --- |
| `type` | 識別問題類型的 URI reference，是問題類型的主要識別；缺少時視為 `about:blank` |
| `title` | 該問題類型的簡短人類可讀摘要；除在地化外，原則上不應每次發生都改變 |
| `status` | 這次問題由來源伺服器產生的 HTTP 狀態碼，只是建議性資訊；產生者必須讓它與實際 HTTP 回應狀態一致 |
| `detail` | 描述本次問題的具體人類可讀說明，應協助呼叫端修正問題 |
| `instance` | 識別這一次問題事件的 URI reference，不等於問題類型，也不保證能取回網頁 |

以上成員不是全部必填；各自的型別、缺省與意義見
[RFC 9457 §3.1](https://www.rfc-editor.org/rfc/rfc9457.html#section-3.1)。
其中 `status` 不會取代 HTTP 狀態；一般 HTTP 用戶端、代理與快取仍依實際 HTTP 狀態運作。
參考 [RFC 9457 §3.1.2](https://www.rfc-editor.org/rfc/rfc9457.html#section-3.1.2)。

## 看一份自創問題表示

沿用前篇另設的文章管理服務，假設它接受 JSON 文章資料，要求標題為 1 至 80 個 Unicode 碼位。
本例收到語法正確、媒體類型受支援，但標題為空字串的請求；契約選擇回傳 422，且不修改文章。
這項「文章不變」保證來自本例契約，不是單憑 422 推導出所有 API 都會回復狀態。

以下只節錄 HTTP/1.1 狀態行與一個標頭；不是完整線路訊息，省略其他標頭與訊息分界資訊：

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
```

回應內容的 JSON 獨立列出如下；URI 與事件識別均為教學值，未建置對應端點：

```json
{
  "type": "https://example.com/problems/invalid-article-title",
  "title": "文章標題無效",
  "status": 422,
  "detail": "標題必須包含 1 至 80 個 Unicode 碼位。",
  "instance": "https://example.com/problem-occurrences/demo-001",
  "code": "ARTICLE_TITLE_INVALID"
}
```

本例的 `type` 識別「文章標題無效」這一類問題，`instance` 識別這一次事件。
`code` 是本例額外定義的穩定擴充成員，不是 RFC 9457 的標準欄位；其值與 `type` 的對應須由契約維護。
Problem Details 允許這類擴充，呼叫端必須忽略不認識的擴充成員。
參考 [RFC 9457 §3.2](https://www.rfc-editor.org/rfc/rfc9457.html#section-3.2)。

程式應以 `type` 作為問題類型的主要識別；若契約另提供穩定 `code`，也可用它處理較細的分支。
不要解析 `detail` 的措辭或以 `title` 的翻譯文字決定業務行為；這些文字可能為了說明或語言偏好而改變。
參考 [RFC 9457 §3.1.1–§3.1.4](https://www.rfc-editor.org/rfc/rfc9457.html#section-3.1.1)。

錯誤內容應提供修正問題所需的資訊，同時避免暴露堆疊傾印、內部實作或其他敏感資料。
Problem Details 是 HTTP 介面的問題描述，並不是把內部除錯輸出直接公開的格式。
參考 [RFC 9457 §4](https://www.rfc-editor.org/rfc/rfc9457.html#section-4)與[§5](https://www.rfc-editor.org/rfc/rfc9457.html#section-5)。

## 相關文件

- [資源、表示與訊息](resources-representations-and-messages.md)：回看回應內容與媒體類型的角色。
- [方法與操作語意](methods-and-operation-semantics.md)：理解結果如何連同方法、冪等性與重試判斷。
- [輸入、輸出與失敗語意](input-output-failure-semantics.md)：回看驗證、可辨識原因與失敗後的狀態保證。
- [快取與條件請求](caching-and-conditional-requests.md)：接著理解 304、驗證器與條件更新。
- [API 共通知識索引](README.md)：查看 HTTP 分支與其他 API 概念。
