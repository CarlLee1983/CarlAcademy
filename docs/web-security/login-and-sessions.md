# 登入、Cookie 與 Session

登入成功後，下一次讀取筆記的請求如何與同一個人連起來？
本文以伺服器保存 Session、瀏覽器使用 Cookie 帶回識別碼的模式說明，不把它當成所有應用唯一的登入架構。
身分驗證、授權、OAuth 與 token 的共通定義見[〈身分驗證與授權〉](../api/authentication-and-authorization.md)。

查證日期：2026-11-02。依 OWASP 與 MDN 查證當日文件；本文沒有部署登入系統或執行瀏覽器測試。
流程與名稱是自創概念例子，不提供可直接部署的驗證程式。

## Session 延續狀態，Cookie 承載資料

**Session** 將多次互動連到同一個應用狀態，也可以在登入前使用，例如保存匿名偏好。
**Cookie** 是瀏覽器保存、並依適用規則隨請求送出的資料；Cookie 不一定是登入憑證，Session 也不一定使用 Cookie。
參考 [OWASP Session Management：Introduction](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#introduction)與
[MDN：Using HTTP cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)。

在本文模式中，伺服器保存 Session 對應的帳號與有效狀態，瀏覽器只拿到不透明識別碼：

1. 伺服器驗證登入資料；若採密碼，使用合適的密碼驗證機制。
2. 登入成功時更新 Session ID，將登入身分連到新 Session。
3. 伺服器以 `Set-Cookie` 交給瀏覽器；後續適用請求帶回 Cookie。
4. 伺服器查核 Session 是否有效，再判斷當次筆記操作的權限。

識別碼應交由成熟機制產生，具不可預測性，不以帳號或時間直接拼成。
登入與權限提升時更新識別碼，是為了避免原有識別碼被用來固定登入狀態；舊的識別碼不能繼續取得新身分的權限。
參考 [OWASP：Session ID Properties 與更新生命週期](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#renew-the-session-id-after-any-privilege-level-change)。

## Cookie 屬性各管不同問題

以下名稱供閱讀協定用，非本次建立的 Cookie：

```http
Set-Cookie: __Host-session=DEMO_NOT_A_CREDENTIAL; Path=/; Secure; HttpOnly; SameSite=Lax
```

| 屬性 | 作用與界線 |
| --- | --- |
| `Secure` | 在一般正式 HTTPS 環境限制透過安全連線傳送；不代表值已加密儲存 |
| `HttpOnly` | 不讓頁面腳本透過 `document.cookie` 讀取；頁面發出的請求仍可能帶上 Cookie |
| `SameSite=Lax` | 限制部分跨站情境的傳送；同站與同源不同，不能只靠它推定所有 CSRF 都已阻止 |
| `Path=/` | 設定傳送路徑；Path 不是隔離同源應用的安全邊界 |
| `__Host-` 前綴 | 支援的瀏覽器要求 `Secure`、`Path=/` 且不得有 `Domain`，限制為設定它的主機 |

參考 [MDN：Cookie 安全屬性、作用範圍與前綴](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#security)。
`Lax` 是本例說明值；實際登入轉址、跨站整合與瀏覽器政策要一起評估，不能照抄成全站通用設定。

## 密碼與 Session 是不同生命週期

密碼用於驗證，Session ID 則可能在一段時間內讓持有者延續登入狀態，因此也須當作敏感憑證。
密碼不應明文保存或使用單次快速雜湊取代密碼雜湊；應使用成熟函式庫提供的適當慢速密碼雜湊與 salt 機制。
具體演算法與參數須依現行指引及環境決定。
參考 [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。

假設使用者修改了密碼，不能自行推定所有既有 Session 已失效。
系統要明確定義登出、閒置期限、最長有效期、帳號停用與風險事件後的失效政策，並在伺服器落實。
只清除畫面上的 Cookie，不會讓已被複製的識別碼自動失效；本文模式還需撤銷伺服器的 Session。
參考 [OWASP：Session Expiration](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#session-expiration)。

## 從結果檢查流程

依本例模式，應檢查：登入前的識別碼不能在登入後冒用身分；登出或到期後，重送原識別碼不能讀私人筆記；
Session 有效的乙仍不能讀甲的筆記。這些是預期行為，本文未實測。
另外，HttpOnly 無法阻止同源惡意腳本替使用者送請求，因此仍要處理 [XSS](cross-site-scripting.md)；
自動附帶 Cookie 也引出 [CSRF](csrf-and-browser-boundaries.md) 問題。

## 相關文件

- [Web 應用的存取控制](access-control.md)：每次操作仍需授權。
- [第三方登入、OAuth 與 OIDC 邊界](oauth-and-federated-login.md)：外部驗證完成後如何安全銜接本地 Session。
- [TLS、HTTPS 與傳輸安全邊界](tls-https-and-transport-boundaries.md)：`Secure` Cookie、HSTS 與反向代理協定判斷。
- [限流、配額與資源耗盡防護](rate-limiting-and-abuse-prevention.md)：登入防暴力破解與避免帳號鎖定型阻斷服務。
- [機密與敏感資料](secrets-and-sensitive-data.md)：憑證與日誌的保護。
- [Web 應用資安索引](README.md)。
