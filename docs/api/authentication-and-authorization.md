# 身分驗證與授權

知道呼叫者是誰，與允許他讀取哪一篇文章，是兩個不同問題。
API 即使已確認一個帳號登入成功，仍須判斷這個主體能否對目標資源執行目前的操作。

本文從身分、資源與操作的關係說起，再區分憑證、token、OAuth 與 OpenID Connect。
先備概念可讀[〈介面、契約與責任〉](interface-contract-responsibility.md)；
本文是基礎概念說明，不指定應採用的登入產品、權限框架或憑證設定方式。

查證日期：2026-11-02。依據 RFC 6749、RFC 6750（均為 2012 年 10 月），
OpenID Connect Core 1.0 incorporating errata set 2（2023-12-15），以及查證當日的 OWASP Cheat Sheets。
RFC 與 OIDC 版本在此用於概念定義，不是完整的現行部署指南；OWASP 網頁持續更新。
本文只查閱文件，未建置登入、發送測試請求、執行服務或進行攻擊測試；文章案例均為自創。

## 身分驗證回答「誰」，授權回答「可不可以」

**身分驗證（authentication）**確認某個實體的身分；
**授權（authorization）**判斷特定實體提出的操作或服務要求是否被允許。
前者成功不會自動推出後者成功。
參考 [OWASP Authorization：Introduction](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#introduction)。

接受判斷的**主體（subject／principal）**可以是人的帳號，也可以是服務程式的身分。
例如背景整理程式以自己的權限讀取資料，不必假設每次呼叫背後都有一個正在操作畫面的使用者。
OAuth 2.0 也區分代表資源擁有者取得存取權，以及應用程式代表自身取得存取權的情境。
參考 [RFC 6749 摘要](https://www.rfc-editor.org/rfc/rfc6749.html)。

閱讀授權規則時，可以把判斷拆成四項：

| 項目 | 自創文章服務中的例子 |
| --- | --- |
| 主體 | 已確認身分的讀者甲、讀者乙，或某個服務帳號 |
| 資源（resource） | 某一篇文章，而不是只有「文章 API」這個大類 |
| 操作（action） | 讀取、修改、刪除；獲准其中一項不代表全部獲准 |
| 情境（context） | 文章是否公開、誰擁有它，以及政策需要的其他可信資訊 |

這是本文整理政策的閱讀方式，不是要求每個系統都設置四個同名欄位。
權限可能依角色、屬性或主體與資源的關係決定；應依實際政策說明判斷依據，
不能只看到「已登入」或某個角色名稱就補上未授予的能力。
參考 [OWASP Authorization：屬性與關係](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#prefer-attribute-and-relationship-based-access-control-over-rbac)。

## 用公開與私人文章看物件權限

以下另設一個**假想文章服務**：公開文章任何人可讀；私人文章只有擁有者可讀。
已確認身分的擁有者可修改自己的文章，其他人不可修改。本例不討論分享、管理員與刪除功能。
這是教學政策，不是 CarlAcademy 的產品存取政策，也不沿用前篇文章服務未定義的規則。

| 主體 | 讀公開文章 A（甲擁有） | 讀私人文章 B（甲擁有） | 修改 A 或 B |
| --- | --- | --- | --- |
| 未驗證身分的訪客 | 允許 | 拒絕 | 拒絕 |
| 已驗證的讀者甲 | 允許 | 允許 | 允許 |
| 已驗證的讀者乙 | 允許 | 拒絕 | 拒絕 |

甲、乙都有「讀者」角色，卻不能因此讀取同一批私人文章。
判斷 B 時還需要「B 的擁有者是否為目前主體」這項關係。
乙登入成功，只解決身分問題；把目標從乙自己的文章改成 B，不會得到甲的權限。

物件識別碼無論是容易猜到的數字，或較難猜的隨機值，都需要相應的存取檢查。
較難猜不等於已授權；知道某個 ID 也不等於擁有它。
OWASP 將缺少物件存取檢查造成的問題稱為不安全的直接物件參照（IDOR），
並強調複雜識別碼不能取代檢查。
參考 [OWASP：Insecure Direct Object Reference Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)。

## 提供者在可信任邊界執行判斷

權限必須在每次請求得到正確檢查，並在提供者可控制的可信任邊界落實，例如伺服器或受控閘道。
畫面隱藏按鈕能改善使用體驗，卻不能取代該檢查；用戶端提供的「我是擁有者」也不能自行成為證據。
OWASP 建議最小權限（least privilege）、預設拒絕（deny by default），並驗證每次請求的權限。
前者只授予完成工作所需的能力；後者在沒有明確允許依據時拒絕，而非自動放行。
參考 [OWASP Authorization：Recommendations](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#recommendations)。

對前述例子，讀 B 前需使用可信的主體與文章歸屬資料判斷；修改也需檢查修改權限。
登入過一次、曾讀取 A，或從某個畫面走到這裡，都不構成讀 B 的許可。
這是依案例政策推演的結果，不要求每次重新輸入密碼；身分驗證狀態可以依所用機制延續。

「每次檢查」也不表示每個方法都各寫一套規則。
檢查可以由共用機制執行，但它仍須涵蓋受保護的入口、操作與目標物件，並確保受保護資料或操作不會在拒絕前先被放行。
這是從授權應在可信任位置落實推得的要求；實際分工仍依系統邊界而定。
參考 [OWASP Authorization：檢查位置](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#verify-that-authorization-checks-are-performed-in-the-right-location)。

## 憑證、token 與 API key 不是同一種承諾

**憑證（credentials）**是用來支持驗證或存取要求的資料；**token** 則要連同發行者、用途與使用規則理解。
看到一串值被稱為 token，還不足以知道它代表誰、能做什麼，或何時失效。
例如 OAuth access token 本身就是用來存取受保護資源的憑證。
參考 [RFC 6749 §1.4](https://www.rfc-editor.org/rfc/rfc6749.html#section-1.4)。

API key 常用來識別或管理呼叫端的使用，例如用量或方案；它代表人、應用程式還是專案，要讀提供者契約。
不能只因 key 被接受，就推定持有者可以讀取任意私人文章。
OWASP 也提醒，不應只依賴 API key 保護敏感、關鍵或高價值資源。
參考 [OWASP REST Security：API Keys](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html#api-keys)。

## OAuth 與 OIDC 各自處理什麼

**OAuth 2.0** 是授權框架，讓應用程式取得受限制的 HTTP 資源存取權。
它本身不是供應用程式確認終端使用者登入身分的協定；RFC 6749 將這項驗證排除在自己的範圍外。
**OpenID Connect（OIDC）**在 OAuth 2.0 上增加身分層，讓用戶端依提供者的驗證結果確認終端使用者身分。
參考 [RFC 6749 §10.16](https://www.rfc-editor.org/rfc/rfc6749.html#section-10.16)與
[OIDC Core 1.0：Introduction](https://openid.net/specs/openid-connect-core-1_0.html#Introduction)。

| 項目 | 主要用途 | 不應直接推定 |
| --- | --- | --- |
| access token | 讓用戶端向資源服務提出獲授權的存取要求 | 這就是給登入用戶端使用的身分證明，或可存取所有物件 |
| ID token | 在 OIDC 中向登入用戶端傳達使用者驗證相關的 claims（宣告） | 這就是可拿去呼叫任意 API 的 access token |

OIDC 的 ID token 有預期接收者；接收端須依規範驗證，而不是只讀出帳號便視為登入成功。
兩種 token 的用途不能因為都由同一次登入過程取得，就任意互換。
參考 [RFC 6749 §1.4](https://www.rfc-editor.org/rfc/rfc6749.html#section-1.4)與
[OIDC Core：ID Token](https://openid.net/specs/openid-connect-core-1_0.html#IDToken)。

OAuth 的 **scope** 表達獲授權的存取範圍，其名稱由授權服務定義；請求的範圍也不一定全部獲准。
假設某服務定義 `articles:read`，還要讀它如何結合文章歸屬與公開性，不能自行解讀成「讀任何文章」。
token 的有效期間與允許範圍須以該服務政策、實際核發資訊及適用規範為準，沒有本文統一指定的秒數。
參考 [RFC 6749 §3.3](https://www.rfc-editor.org/rfc/rfc6749.html#section-3.3)與
[§5.1](https://www.rfc-editor.org/rfc/rfc6749.html#section-5.1)。

## bearer 的持有與 JWT 的可讀，都不等於無條件信任

**Bearer token** 的特性是持有者即可用它提出相應存取要求，不必另外證明持有某把密碼學金鑰。
因此需要保護它在儲存與傳輸時不被揭露；RFC 6750 的 HTTP 用法要求使用 TLS，通常以 HTTPS 承載。
本文不提供可用憑證；也不能把 token 當成可以任意放進 URL、紀錄或公開範例的普通識別碼。
參考 [RFC 6750 摘要與 §1](https://www.rfc-editor.org/rfc/rfc6750.html#section-1)及
[§5](https://www.rfc-editor.org/rfc/rfc6750.html#section-5)。

並非所有 token 都是 JWT；OAuth access token 可以是不供用戶端解讀的值，也可以包含可驗證資訊。
JWT 是一種承載 claims 的格式。能解碼讀出內容，不等於已驗證完整性、發行者、接收對象或期限；
即使這些檢查通過，資源服務仍須確認本次操作的權限，不能跳過前述文章 B 的判斷。
參考 [RFC 6749 §1.4](https://www.rfc-editor.org/rfc/rfc6749.html#section-1.4)與
[OWASP REST Security：JWT](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html#jwt)。

## 拒絕結果是表達，不是防護本身

HTTP API 可能以 401、403，或在適當情況以 404 表達身分與存取問題；
它們的語意及必要標頭見[〈狀態碼與錯誤表示〉](status-codes-and-error-representations.md)。
這不是所有 API 必須使用 HTTP 的要求，也不能把錯誤碼當成授權檢查本身。

依本文案例政策，乙讀私人文章 B 被拒絕時，不能同時把 B 的受保護內容送給乙；
修改被拒絕時，也不能先修改再附上一個拒絕訊息。
這些是從「不允許讀取／修改」推得的可觀察行為，可依[〈API 測試〉](api-testing.md)的方式檢查。
只驗證畫面沒有按鈕、URL 難猜，或 token 有效，都不足以證明授權正確。

## 相關文件

- [Web 登入與 Session](../web-security/login-and-sessions.md)：以伺服器 Session 與 Cookie 說明登入狀態的延續及失效。
- [Web 應用的存取控制](../web-security/access-control.md)：檢查列表、單筆、欄位與背景工作是否遵守政策。
- [介面、契約與責任](interface-contract-responsibility.md)：將存取條件納入對外承諾。
- [輸入、輸出與失敗語意](input-output-failure-semantics.md)：理解失敗訊號與狀態影響的關係。
- [狀態碼與錯誤表示](status-codes-and-error-representations.md)：查看 HTTP 拒絕結果的具體語意。
- [API 測試](api-testing.md)：從允許與拒絕案例檢查可觀察結果。
- [API 共通知識索引](README.md)：查看共通概念與其他情境分支。
