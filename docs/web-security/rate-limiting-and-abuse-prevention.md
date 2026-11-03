# 限流、配額與資源耗盡防護

即使每一個請求都通過了格式檢查與權限驗證，只要系統允許外部在短時間內無上限地觸發登入驗證、全文搜尋、報表匯出或寄送驗證信，少數自動化腳本或失控的無限重試就能耗盡 CPU、資料庫連線與第三方配額，讓正常使用者無法讀寫自己的筆記。
這類無限制分配資源的風險，在常見弱點分類中稱為[〈CWE-770：Allocation of Resources Without Limits or Throttling〉](https://cwe.mitre.org/data/definitions/770.html)。

先備概念見[信任邊界與威脅思考](trust-boundaries.md)、[登入、Cookie 與 Session](login-and-sessions.md)與[逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)。
查證日期：2026-11-03。依 OWASP Denial of Service／Authentication Cheat Sheet、MITRE CWE-770 與 RFC 6585 整理。
本次僅查證文件，未部署限流器或執行壓力測試；以下為自創的筆記服務情境。

## 為什麼語法合法的請求也能耗盡服務容量：非對稱成本

Web 應用常存在**非對稱成本（asymmetric cost）**：攻擊者或異常客戶端送出一個幾百位元組的 HTTP 請求非常便宜，但伺服器為了回應這個請求，卻可能付出數百倍的運算與 I/O 代價。
參考 [OWASP Denial of Service Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html)。

```text
外部送出 1 個簡短請求（很低成本）
    │
    ├─→ POST /login       ：執行慢速密碼雜湊驗證（消耗大量 CPU）
    ├─→ POST /forgot-pwd  ：發送外部重設信或簡訊（消耗第三方配額與費用）
    └─→ GET  /notes/export：掃描數萬筆筆記並打包壓縮（消耗記憶體、資料庫連線與磁碟 I/O）
```

因此，可用性與資源保護不能只靠最外層網路防火牆過濾大量封包，還必須在應用層針對**不同端點的成本與業務風險**設計限流（rate limiting）、配額（quota）與輸入大小上限。

## 限流不能只看單一來源 IP：依操作選擇識別維度

若所有限流規則都只寫「每個來源 IP 每分鐘最多 N 次」，在真實網路環境中很快會遇到兩個反效果：

- **誤擋共享 IP 的正常使用者**：公司、學校或行動網路常透過 NAT 讓數百人共用同一個對外 IP；若門檻太低，一個部門多人同時使用筆記服務就會集體被擋。
- **擋不住分散式來源**：攻擊者使用多個代理節點輪流發送請求時，單一 IP 的速率看似正常，但目標帳號或後端資料庫已經承受很大壓力。

實務上應依端點性質組合多個維度（keying）：

| 端點或操作類型 | 要防範的主要風險 | 建議組合的限流與配額維度 |
| --- | --- | --- |
| 登入與驗證碼檢查（`POST /login`） | 單一帳號暴力猜密碼、或跨大量帳號的憑證填充（credential stuffing） | 同時檢查「來源 IP 速率」與「目標帳號識別（如電子郵件）速率」，並設全站總保護上限 |
| 寄送重設密碼信／驗證簡訊 | 密集發送訊息干擾特定收件位址、耗盡第三方寄信費用 | 依「目標收件位址／門號冷卻時間」、「來源 IP」與「每小時全站發送配額」共同限制 |
| 已登入的一般筆記讀寫 | 單一失控腳本高頻輪詢或塞滿佇列 | 依「已驗證的 `user_id`／API key」限制突發速率與每分鐘請求數 |
| 高成本匯出、轉檔與批次搜尋 | 少數大型請求占滿工作執行緒與資料庫連線池 | 依「`user_id` 並行工作數上限（如同時最多 1 個匯出工作）」加上單次查詢分頁與大小限制 |

此外，若應用伺服器位於反向代理或 CDN 後方，直接讀取 TCP 連線的來源位址只會拿到代理伺服器自己的 IP（導致全站所有使用者被算成同一個 IP）。
必須比照[〈TLS、HTTPS 與傳輸安全邊界〉](tls-https-and-transport-boundaries.md)的原則，只在確認請求來自受控代理時，才採信代理寫入的客戶端 IP 標頭。

## 登入防暴力破解與「帳號鎖定」的副作用

保護登入端點時，若設計成「只要連續輸入錯誤密碼 5 次，就將該帳號永久鎖定直到人工解鎖」，攻擊者只要拿到一份公開的使用者電子郵件清單，就能故意對每個帳號連送 5 次錯誤密碼，讓大批正常使用者全部無法登入，形成**帳號鎖定型阻斷服務（Account Lockout DoS）**。
參考 [OWASP Authentication Cheat Sheet：Protect Against Automated Attacks](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)。

較穩健的緩解組合包括：

1. **以時間窗冷卻與漸進延遲取代永久鎖死**：在短時間失敗達門檻後，僅對該帳號或來源組合實施短暫冷卻（或要求額外驗證挑戰），讓合法擁有者稍候或透過安全管道仍能恢復使用。
2. **限制密碼輸入最大長度**：慢速密碼雜湊演算法本來就會刻意消耗 CPU；若允許傳入數 MB 的超長字串進入雜湊計算，單一請求就可能長時間占用運算資源，應在進入雜湊前先檢查合理長度上限。
3. **不以明顯差異洩漏帳號是否存在**：重設密碼或登入失敗時，對外的回應訊息與處理流程應盡量一致，避免讓自動化工具直接試出哪些電子郵件已註冊。

## 把成本擋在昂貴資源之前，並回傳明確的退避信號

限流與資源保護的順序應該是**越便宜的檢查越早做**：

1. **在進入資料庫與業務邏輯前先擋下超額請求**：在閘道或 HTTP 接收層先限制請求本體（body）大小、JSON 巢狀深度與單頁查詢上限（`limit` 最大值，見[〈集合查詢設計〉](../api/collection-query-design.md)）。
2. **以非同步佇列隔離昂貴工作**：像「匯出全部筆記 PDF」這類耗時任務，不應占著同步 HTTP 連線與資料庫交易等待完成，而應檢查該使用者的進行中工作配額後放入背景佇列。
3. **使用明確的 `429 Too Many Requests` 與退避契約**：
   當請求觸發限流時，HTTP 層可回傳 `429 Too Many Requests`，並視情境附上 `Retry-After` 標頭告知客戶端應等待多久再重試。參考 [RFC 6585 §4：429 Too Many Requests](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)。
   同時，自己的前端與 SDK 在收到 `429` 或 `503` 時，必須遵守[〈逾時、重試與冪等性〉](../api/timeouts-retries-and-idempotency.md)的指數退避與抖動（backoff with jitter），不能立刻無延遲重送，否則會在系統恢復瞬間再次製造重試風暴。

## 相關文件

- [信任邊界與威脅思考](trust-boundaries.md)：可用性是與機密性、完整性並列的核心保護目標。
- [登入、Cookie 與 Session](login-and-sessions.md)：登入驗證與密碼雜湊的保護邊界。
- [逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)：客戶端退避、重試條件與伺服器過載保護的配合。
- [資料表分割與連線資源管理](../relational-databases/partitioning-and-connection-management.md)：後端資料庫連線池與查詢逾時如何作為最後防線。
- [Web 應用資安索引](README.md)。
