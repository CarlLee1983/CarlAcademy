# 第三方登入、OAuth 與 OIDC 邊界

當筆記服務提供「使用外部帳號登入」時，驗證密碼或通行金鑰的工作交給了外部身分提供者（Identity Provider，IdP），但**確認這趟瀏覽器轉址真的屬於目前使用者**、**驗證回傳憑證的目標對象**，以及**將外部身分安全對應到本地帳號與 Session**，仍然是筆記服務自己的責任。
OAuth 2.0 與 OpenID Connect（OIDC）的基本定義見[〈身分驗證與授權〉](../api/authentication-and-authorization.md)；本篇聚焦 Web 瀏覽器轉址流程中的信任邊界與常見整合失誤。

先備概念見[登入、Cookie 與 Session](login-and-sessions.md)與 [CSRF、同源政策與跨站請求](csrf-and-browser-boundaries.md)。
查證日期：2026-11-03。依 RFC 6749、RFC 7636（PKCE，2015 年 9 月）、OpenID Connect Core 1.0 與 OWASP OAuth2 Cheat Sheet 整理。
本次僅查證文件，未串接任何外部 IdP 或執行登入測試；以下為自創的筆記服務情境。

## 一次第三方登入跨越了兩段不同的通道

在典型的 Authorization Code 流程中，瀏覽器與後端伺服器分別走不同的路徑：

```text
1. 瀏覽器（前端通道 Front-channel）
   使用者點擊登入 ──→ 轉址至 IdP 授權端點（帶 client_id、redirect_uri、state、code_challenge）
   IdP 驗證完成   ──→ 轉址回筆記服務 callback URL（帶一次性 code 與 state）

2. 伺服器對伺服器（後端通道 Back-channel）
   筆記服務後端   ──→ 向 IdP Token 端點交換（帶 code、code_verifier、client 憑證）
   IdP Token 端點 ──→ 回傳 ID Token 與 Access Token
```

前端通道經過瀏覽器網址列、歷史紀錄與重新導向，本質上較容易暴露於跨站誘導或參數外洩；因此前端通道只傳遞短效、一次性的授權碼（authorization code），真正的 token 交換則在受保護的後端通道完成，並搭配 **PKCE（Proof Key for Code Exchange）** 確認「發起授權請求的人」與「拿授權碼來換 token 的人」是同一個流程實例。
參考 [RFC 7636：PKCE](https://www.rfc-editor.org/rfc/rfc7636.html)與 [OWASP OAuth2 Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)。

## 轉址參數各自守住哪一道邊界

如果少了對應的驗證參數，攻擊者不一定要取得密碼，就能把別人的瀏覽器綁進攻擊者的帳號，或截獲授權碼：

| 參數或檢查項 | 防護的風險 | 筆記服務在整合時必須確認的事 |
| --- | --- | --- |
| `redirect_uri` 精確比對 | 授權碼或 token 被轉送到攻擊者控制的網址或開放轉址入口 | 在 IdP 註冊固定、精確的 callback 網址，避免萬用字元或可被串改的轉址參數 |
| `state`（綁定發起者 Session） | 登入 CSRF（強迫受害者登入攻擊者帳號，讓受害者把私人筆記寫進攻擊者空間） | 發起轉址前產生不可預測的 `state` 並綁定目前瀏覽器狀態；callback 時比對且單次有效後失效 |
| PKCE（`code_challenge`／`code_verifier`） | 授權碼外洩或注入後遭冒領交換 | 發起時保存高強度隨機 `code_verifier` 並送出雜湊後的 `code_challenge`；交換 token 時由 IdP 核對 |
| OIDC `nonce` 與 ID Token 檢查 | 重放舊的身分宣告，或拿給其他應用程式的 token 冒充登入 | 檢查簽章、`iss`（發行者）、`aud`（必須是本筆記服務的 `client_id`）、`exp`（未過期）與 `nonce` |

「登入 CSRF」特別容易被忽略：若筆記服務的 callback 端點不檢查 `state`，攻擊者可以先在自己的電腦走完前半段登入取得合法 `code`，停止不送出，再誘使受害者的瀏覽器造訪帶有該 `code` 的 callback 網址。
受害者會以為自己還在使用原本環境，實際上瀏覽器已被切換為登入攻擊者的外部帳號，後續輸入的私人筆記都進了攻擊者手裡。
參考 [RFC 6749 §10.12：CSRF](https://www.rfc-editor.org/rfc/rfc6749.html#section-10.12)。

## 外部身分如何安全對應到本地帳號

當筆記服務驗證完 ID Token 後，下一步是決定「這是我們資料庫裡的哪一位使用者」。
在 OIDC 中，唯一且穩定的外部身分識別是**發行者（`iss`）加上主體識別碼（`sub`）**的組合，而不是顯示名稱或可變動的電子郵件。
參考 [OIDC Core 1.0：Claim Stability and Uniqueness](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability)。

假設筆記服務原本已有本地電子郵件與密碼帳號，現在新增第三方登入，帳號綁定常見三個錯誤：

1. **只用 `sub` 卻沒加上 `iss` 區分提供者**：支援多個外部登入提供者時，不同 IdP 的 `sub` 可能剛好相同；資料表應以 `(provider_issuer, provider_sub)` 作為外部身分的複合唯一識別。
2. **未確認電子郵件是否已驗證就自動合併本地帳號**：若外部提供者允許使用者填寫尚未驗證的電子郵件（或該位址曾被釋出重註冊），而筆記服務看到 `email` 相同就直接把外部登入合併進既有本地帳號，攻擊者便能藉此接管他人帳號。
3. **在已登入狀態綁定新外部帳號時未重新確認身分**：與修改密碼類似，將新的外部登入綁定到現有帳號屬於高敏感操作，必須驗證目前的登入 Session 與 CSRF 保護。

## 第三方登入完成後，本地 Session 仍有自己的生命週期

外部 IdP 完成驗證並交回 ID Token，只代表「在登入那一刻，外部提供者確認了這個人的身分」。
接下來筆記服務若在自己的伺服器建立 Session Cookie，這個本地 Session 的安全屬性、閒置逾時、登出撤銷與每次讀取筆記時的物件授權，仍完全遵循[〈登入、Cookie 與 Session〉](login-and-sessions.md)與[〈Web 應用的存取控制〉](access-control.md)的規則：

- **本地登出不等於外部 IdP 登出，反之亦然**：使用者在筆記服務點擊登出時，伺服器必須立即撤銷本地 Session；是否同時導向外部提供者做單一登出（Single Logout），應在介面上清楚符合預期，不能只清掉前端畫面卻留下有效 Session。
- **不要把外部 Access Token 當成本地權限全開的通行證**：外部 token 只用於呼叫獲授權的外部 API（若業務需要），筆記服務內部的「甲能否讀取筆記 42」仍由本地資料庫與授權政策決定。

## 相關文件

- [身分驗證與授權](../api/authentication-and-authorization.md)：OAuth 2.0、OIDC、Access Token 與 ID Token 的共通概念。
- [登入、Cookie 與 Session](login-and-sessions.md)：第三方驗證通過後，本地 Session 如何建立、延續與失效。
- [CSRF、同源政策與跨站請求](csrf-and-browser-boundaries.md)：跨站導覽與 `state` 防護的關係。
- [Web 應用的存取控制](access-control.md)：確認身分後仍須執行的資源權限檢查。
- [Web 應用資安索引](README.md)。
