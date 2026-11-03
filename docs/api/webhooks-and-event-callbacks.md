# Webhook、事件回呼與反向通知契約

在一般 HTTP API 中，由使用者（客戶端）主動向服務提供者發起請求；而在 **Webhook（事件回呼）** 模型中，角色反了過來：當提供者內部發生特定狀態變化（例如付款完成、匯出結束或倉庫收到新提交），**由事件提供者作為 HTTP 客戶端，主動向訂閱者預先註冊的網址發送 HTTP `POST` 請求。** 這個角色反轉改變了驗證、重試、去重與網路防護的責任邊界。[來源：RFC 9110 §9.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.3)

本文接續[介面、契約與責任](interface-contract-responsibility.md)、[逾時、重試與冪等性](timeouts-retries-and-idempotency.md)與[長時間執行操作與非同步 API 契約](long-running-operations-and-async-apis.md)，並銜接 Web 資安的[SSRF 與伺服器對外請求邊界](../web-security/ssrf-and-outbound-requests.md)。

查證日期：2026-11-03。依據 IETF RFC 9110、RFC 2104（HMAC）、AWS Builders' Library 的重試與冪等設計原則及 OWASP SSRF 防護指南。本文只查閱文件，未執行 Webhook 收發測試；文中的事件負載與標頭名稱為本站自訂的通用示例，不綁定單一產品規格。

## 角色反轉：誰是提供者，誰是接收端？

理解 Webhook 時，先分清「業務上的事件來源」與「HTTP 通訊上的客戶端／伺服器」：

```text
1. 註冊階段：
   訂閱者系統 ──(設定回呼 URL 與訂閱事件類型)──→ 事件來源服務

2. 觸發與投遞階段（HTTP 角色反轉）：
   事件來源服務 (HTTP Client) ──(POST 事件訊息 + 簽章)──→ 訂閱者 Webhook 端點 (HTTP Server)
   事件來源服務 (HTTP Client) ←──(2xx 確認已收下事件)─── 訂閱者 Webhook 端點 (HTTP Server)
```

因為訂閱者的 Webhook 端點必須對外開放接收 HTTP 請求，這同時給雙方帶來新的契約課題：

- **對事件發送方（來源服務）**：訂閱者的伺服器可能離線、緩慢、回傳 5xx，或故意填入內部網路位址誘發 SSRF。
- **對事件接收方（訂閱者）**：任何知道該 URL 的人都能偽造 HTTP `POST` 請求送過來；而且同一個事件可能因網路逾時被重送多次，或兩個事件到達的先後順序與發生順序相反。

## 投遞語意：至少一次送達、重複事件與順序交錯

大多數透過網路投遞的 Webhook 採 **至少一次（at-least-once）** 語意：發送方若在約定逾時（例如 5~10 秒）內沒有收到接收端的 `2xx` 成功狀態碼，就會按退避策略（exponential backoff with jitter）排程重送。參考 [AWS：Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)。

| 常見現象 | 為什麼會發生 | 接收端（訂閱者）應如何處理 |
| --- | --- | --- |
| 同一事件收到兩次以上 | 接收端已處理完成，但回傳 `200` 時網路斷線或超過發送方等待上限，觸發發送方重送 | 以事件唯一識別（`event_id`）搭配資料庫唯一約束或冪等紀錄去重（參見[逾時、重試與冪等性](timeouts-retries-and-idempotency.md)） |
| 較晚發生的事件先到達 | 先發出的事件剛好遇到短暫網路失敗進入退避重試，後發出的事件卻一次成功 | 比較事件內的資源版本號／時間標記，或在收到通知後向來源 API 反查該資源的最新狀態 |
| 接收端處理太久導致大量重送累積 | 接收端在同步處理請求時直接跑耗時轉檔或寄信，超過發送方 timeout | **先驗簽、落地保存或寫入內部佇列後立即回傳 `2xx`**，再由背景工作非同步處理 |

### 完整負載（Fat Payload）與精簡通知（Thin Notification）的取捨

事件訊息的內容設計通常有兩種取向：

1. **包含完整資源快照**：接收端省去一次額外查詢，但若事件順序交錯到達，直接拿事件內的舊快照覆蓋本地資料庫，會把新狀態蓋回舊狀態。
2. **只含事件類型、資源 ID 與版本／狀態摘要**：強迫接收端有需要時再去來源 API 讀取最新狀態；多一次讀取成本，但能大幅減少順序交錯覆蓋與敏感資料在 Webhook 日誌中暴露的範圍。

## 驗證來源與防重放：原始位元組簽章與時間標記

因為 Webhook 端點是公開可連的 HTTP 入口，**不能只靠「URL 很長很難猜」或檢查 `User-Agent` 來確認請求來自真正的事件提供者**。常見的驗證機制是由雙方共享一把 Webhook 簽章密鑰（或由發送方以非對稱私鑰簽章、提供公鑰供驗證），對「時間標記 + 原始請求主體（raw request body）」計算訊息驗證碼（如 HMAC-SHA256）。[來源：RFC 2104](https://www.rfc-editor.org/rfc/rfc2104.html)

以下是自訂的 Webhook 請求概念示例：

```text
POST /webhooks/export-events HTTP/1.1
Host: consumer.example.org
Content-Type: application/json
X-Webhook-Id: evt-20261103-881
X-Webhook-Timestamp: 1793714400
X-Webhook-Signature: v1=6f4e9a1c...（以共享密鑰對 "1793714400.<raw_body>" 計算之 HMAC）

{"event_id":"evt-20261103-881","type":"export.completed","created_at":"2026-11-03T14:00:00Z","data":{"export_id":"exp-77","version":3}}
```

接收端驗證時必須守住三個細節：

1. **必須對「原始位元組（raw body）」驗簽，不能先解析成 JSON 物件再重新 `JSON.stringify`**：空白字元、鍵順序或數值格式的微小差異都會改變雜湊結果，導致驗簽失敗。
2. **結合時間標記檢查重放視窗（replay window）**：攻擊者若截獲一筆合法的簽章請求，可能在數小時後原樣重送。接收端應將簽章內容綁定 `X-Webhook-Timestamp`，拒絕與目前伺服器時間相差超過容許範圍（例如 5 分鐘）的請求，並在時間視窗內搭配 `event_id` 去重。
3. **支援密鑰輪替過渡期**：輪替 Webhook 簽章密鑰時，發送方通常支援在短時間內同時附帶新舊兩個版本的簽章（或接收端同時用新舊兩把有效密鑰嘗試驗證），確認切換完成後再撤銷舊密鑰（參見[機密與敏感資料的生命週期](../web-security/secrets-and-sensitive-data.md)）。

## 回應狀態碼如何驅動發送方的重試決策

在 Webhook 契約中，接收端回傳的 HTTP 狀態碼不是給終端人類看的，而是**給發送方排程器看的控制訊號**：

| 接收端回傳狀態 | 對發送方的語意 | 適用情境 |
| --- | --- | --- |
| `200 OK`／`202 Accepted`／`204 No Content` | 事件已成功收下，**停止重送** | 驗簽通過且已完成去重檢查或排入內部佇列（包含「這是我不關心的事件類型，直接忽略」的情況） |
| `400 Bad Request`／`401 Unauthorized` | 簽章無效或格式損壞 | 拒絕偽造請求；部分發送方仍可能重試或標記端點異常 |
| `429 Too Many Requests`／`500`／`502`／`503`／`504` | 接收端暫時過載或內部相依故障，**請稍後重送** | 接收端資料庫或內部佇列暫時無法寫入，希望發送方保留事件稍後再試 |

特別注意：如果接收端收到一筆「簽章合法、但業務上不需要處理（或目標資源早已刪除）」的事件，**應該回傳 `2xx` 並記錄忽略原因，而不是回傳 `404` 或 `500`**；否則發送方會誤以為投遞失敗，在接下來數小時甚至數天內不斷重送同一筆永遠不會成功的事件。

## 發送方的對外連線安全邊界

對提供 Webhook 功能的服務而言，允許使用者任意填寫 `callback_url` 並由伺服器主動發起 HTTP 請求，本質上就是典型的 **SSRF（Server-Side Request Forgery）** 高風險入口。發送方必須強制要求 `https://`、在連線層驗證解析後的目標 IP 不落入私有網段／loopback／雲端中繼資料位址（如 `169.254.169.254`）、禁止自動跟隨未重新檢查的轉址，並將發送任務放在沒有內部敏感網路存取權限的隔離環境與嚴格連線／讀取逾時下執行。完整防護原理見[SSRF 與伺服器對外請求邊界](../web-security/ssrf-and-outbound-requests.md)。[來源：OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

## 相關文件

- [API 共通知識索引](README.md)：回到跨語言概念與 HTTP 分支。
- [介面、契約與責任](interface-contract-responsibility.md)：釐清事件發送方與訂閱方的責任邊界。
- [逾時、重試與冪等性](timeouts-retries-and-idempotency.md)：退避重試與以事件識別去重的核心原理。
- [長時間執行操作與非同步 API 契約](long-running-operations-and-async-apis.md)：對照客戶端輪詢與伺服器回呼兩種非同步模式。
- [相容性與演進](compatibility-and-evolution.md)：事件 payload 新增欄位或版本演進時的相容規則。
- [SSRF 與伺服器對外請求邊界](../web-security/ssrf-and-outbound-requests.md)：防止使用者提供的 Webhook URL 被用來探測內部網路。
- [SQS、SNS 與 EventBridge](../aws/sqs-sns-and-eventbridge.md)：在雲端環境以佇列與事件匯流排緩衝與分發事件。
