# CSRF、同源政策與跨站請求

瀏覽器收到別的網站引發的請求時，有些情境仍會自動附上目標站的登入 Cookie。
因此「有有效的 Cookie」不能單獨證明使用者想做這個操作。
先備概念見[登入與 Session](login-and-sessions.md)。

查證日期：2026-11-02。依 OWASP、MITRE CWE-352、MDN 與 RFC 9110（2022 年 6 月）整理。
本次未發送跨站請求或執行瀏覽器測試；案例為自創的筆記服務情境。

## CSRF 借用的是瀏覽器代送的身分

跨站請求偽造（Cross-Site Request Forgery，CSRF）會使受害者的瀏覽器對信任的網站送出非使用者本意的請求。
典型風險出現在使用環境自動帶入的憑證，卻沒有充分檢查請求來源或意圖的狀態變更入口。
參考 [MITRE CWE-352](https://cwe.mitre.org/data/definitions/352.html)。

假設甲登入筆記站後造訪另一個網站，而筆記站有一個刪除入口。
若外站能誘發適當請求、瀏覽器會附上可用憑證，且伺服器沒有適當防護，就可能用甲的權限刪除筆記。
攻擊者不一定需要讀到回應；操作真的發生就已造成影響。
這是條件式案例，Cookie 的 SameSite 與瀏覽器政策會影響請求，不代表所有跨站請求都帶 Cookie。

## 同源、同站與 CORS 分別處理什麼

**Origin（源）**一般由 scheme、host 與 port 決定。
`https://app.example.com` 與 `https://api.example.com` 不同源；以這兩個一般網域的 HTTPS 情境而言，它們可屬於同站。
SameSite 使用的「站」與同源政策不同，不能互換。
參考 [MDN：Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)與
[MDN：Set-Cookie 的 SameSite](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#samesitesamesite-value)。

同源政策限制許多跨源讀取，卻不會禁止所有表單、導覽與資源載入。
CORS 則讓伺服器用標頭表達瀏覽器可以允許哪些跨源存取；部分請求會先做 preflight，但不是每一種跨源請求都會。
因此，瀏覽器顯示 CORS 錯誤，不足以證明伺服器沒執行操作。
參考 [MDN：CORS 與 simple requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#simple_requests)。

CORS 也不是一般 API 身分驗證：非瀏覽器用戶端不靠瀏覽器的同源政策限制權限。
資源是否允許讀寫，仍回到[存取控制](access-control.md)。

## 在伺服器驗證狀態變更請求

優先採用所選框架維護的 CSRF 防護，確認所有適用入口都啟用，包含登入與狀態變更。
以有狀態應用的 synchronizer token 模式為例，伺服器產生與 Session 關聯、難以猜測的值，
在可信頁面交給用戶端，再於變更請求帶回並由伺服器驗證；不把 token 放進會外洩的 URL。
參考 [OWASP CSRF Prevention：Built-in Implementations 與 Token-Based Mitigation](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#token-based-mitigation)。

同一個教學刪除入口，預期行為可以寫成：

| 請求 | 結果 |
| --- | --- |
| 甲的有效 Session、合法 CSRF 證明、甲擁有的筆記 | 依功能政策執行 |
| 有效 Session，但缺少或無效 CSRF 證明 | 拒絕，筆記不變 |
| CSRF 證明有效，但目標屬於乙 | 授權拒絕，乙的筆記不變 |

這是採 token 模式的案例政策；不是說所有應用只能用此模式。
不應自行把「Cookie 有值」當作 CSRF 證明，或手寫沒有 Session 綁定保護的 double-submit 方案。
對 API 以自訂標頭及 preflight 作防護，還需嚴格的來源與內容類型政策，不能只是隨便加一個標頭。
參考 [OWASP：Double-Submit Cookie 與 Custom Headers](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi)。

## 各項補強仍有條件

SameSite、Origin／Referer 檢查與 Fetch Metadata 可以補強；選用時要處理代理、缺少標頭與合法跨站流程。
僅將操作改成 POST 不會自動獲得 CSRF 防護。
GET 等安全方法也不應承載使用者要求的刪除或修改；其語意見
[RFC 9110 §9.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1)。

若憑證只由可信用戶端程式明確加進 Authorization 標頭，而不由瀏覽器自動附帶，傳統 Cookie 型 CSRF 的前提會不同。
這不代表可以忽略登入流程、其他 Cookie 入口或 XSS；同源惡意腳本可能取得合法請求所需資訊。
參考 [OWASP：CSRF 防護原則](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#introduction)。

## 相關文件

- [XSS](cross-site-scripting.md)：同源惡意腳本可能繞過請求意圖防護。
- [方法與操作語意](../api/methods-and-operation-semantics.md)：HTTP 安全方法不等於一般資安保證。
- [Web 應用資安索引](README.md)。
