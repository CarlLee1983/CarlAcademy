# OpenID Connect 協定規範與身分聯邦邊界

OpenID Connect（OIDC）是在 OAuth 2.0 授權框架之上構建的輕量級身分層（Identity Layer）。
它透過標準化的 ID Token、探索端點（Discovery）與使用者資訊介面，讓應用程式能夠跨越組織與網域邊界，安全驗證終端使用者的身分並建立聯邦身分會話（Federated Session）。

## OAuth 2.0 與 OpenID Connect 的本質差異

許多開發者常將兩者混為一談，但它們在設計目的與傳回憑證上有著嚴格區分：

```
+-------------------------------------------------------+
|              OpenID Connect 1.0 (身分層)              |
|        - 回答「你是誰」 (Authentication)              |
|        - 憑證: ID Token (JWT 格式, 專門給 Client 看)  |
|        - 端點: UserInfo, Discovery, Logout            |
+-------------------------------------------------------+
|              OAuth 2.0 框架 (授權基礎)                 |
|        - 回答「你可以做什麼」 (Authorization)         |
|        - 憑證: Access Token (給 Resource Server 看)   |
|        - 機制: Scopes, Grant Types, Redirection       |
+-------------------------------------------------------+
```

| 比較面向 | OAuth 2.0 | OpenID Connect (OIDC) |
|---|---|---|
| **核心目標** | **授權（Authorization）**：委託存取資源權限 | **身分驗證（Authentication）**：確認使用者身分與個人資訊 |
| **主要憑證** | **Access Token**：給 API 資源伺服器驗證權限 | **ID Token**：給用戶端（RP）讀取的身分證明宣告 |
| **憑證格式** | 規格不限制（可為不透明字串或 JWT） | **強制要求必須為 JWT**，且必須包含數位簽章 |
| **請求 Scope** | 自訂（如 `articles:write`） | **必須包含 `openid`**，可搭配 `profile`、`email` 等 |
| **身分標識** | 無標準定義 | 嚴格由 `(iss, sub)` 複合定義全域唯一身分 |

## 元數據自動探索：`/.well-known/openid-configuration`

在 OIDC 出現前，串接第三方登入需要開發者手動在設定檔寫死各種授權端點、Token 端點與公鑰網址。
OIDC 引入了 **Discovery 規範**：任何相容的 IdP 必須在標準路徑暴露其設定中繼資料：

```http
GET https://auth.example.com/.well-known/openid-configuration HTTP/1.1
```

回傳的 JSON 描述了該身分提供者的完整能力與簽驗位址：
- `issuer`：權威發行者 URL（如 `https://auth.example.com`，必須與 ID Token 的 `iss` 完全精確字串匹配）。
- `authorization_endpoint`：前端轉址授權端點。
- `token_endpoint`：後端換取 Token 端點。
- `userinfo_endpoint`：獲取使用者詳細資料端點。
- `jwks_uri`：驗章公鑰集合發布端點（如 `https://auth.example.com/.well-known/jwks.json`）。
- `response_types_supported`、`claims_supported`：支援的流程與宣告清單。

用戶端應用程式僅需配置提供者的根網址（Issuer URL），即可由 OIDC Client 程式庫自動完成端點發現與金鑰抓取，消除了手動配置錯誤的風險。

## ID Token 關鍵 Claims 與安全驗證矩陣

當用戶端（Relying Party, RP）在登入流程中取得 ID Token 時，必須在本地依序執行以下密碼學與語意驗證，缺一不可：

1. **簽章驗證（Signature Verification）**：透過從 `jwks_uri` 獲取的公鑰，核對簽章是否由合法的 `issuer` 私鑰所簽署。
2. **`iss`（Issuer，發行者）**：必須完全精確等於預期的 IdP 網址（包括協議與結尾斜線）。
3. **`aud`（Audience，受眾）**：必須包含本應用程式註冊的 `client_id`。如果 `aud` 是別的應用程式 ID，該 Token 可能是攻擊者拿在其他網站獲取的 Token 前來本站冒名登入（Token Confusion 攻擊）。
4. **`exp`（Expiration Time，過期時間）**：當前系統時間不得晚於 `exp`（考量伺服器時鐘誤差，通常容許 1–2 分鐘 Clock Skew）。
5. **`nonce`（隨機字串防重放）**：若在發起授權請求時帶了 `nonce`，ID Token 內的 `nonce` 必須與當初保存在使用者本機 Session 中的隨機值完全相同，用以抵禦重放攻擊。
6. **`auth_time`（實際驗證時間）**：記錄使用者在 IdP 輸入密碼或 MFA 的絕對時間。若進行敏感操作（如付款或改密），可檢查 `auth_time` 是否發生在最近 5 分鐘內，必要時要求重新認證（Re-authentication，帶 `prompt=login`）。

## 跨網域單一登出（Single Logout, SLO）的三種標準模型

在身分聯邦與單一登入（SSO）環境中，最棘手的問題是「當使用者在一個網站點擊登出時，如何同步結束所有相關網站的登入會話？」。OIDC 定義了三種協同登出規範：

### 1. RP-Initiated Logout（用戶端發起登出）
使用者點擊登出後，用戶端清除本地 Session，並將瀏覽器重新導向至 IdP 的登出端點（`end_session_endpoint`），並附帶 `id_token_hint`。IdP 收到後銷毀全域 SSO Cookie，並將使用者導回用戶端指定的登出完成頁。

### 2. Front-Channel Logout（前端通道登出）
- **機制**：當使用者在 IdP 登出時，IdP 的登出頁面在背景渲染多個隱藏的 `<iframe>`，分別載入各個已登入應用程式的登出 URL。
- **限制與致命傷**：現代瀏覽器全面封鎖「第三方 Cookie（Third-Party Cookies）」，導致 `<iframe>` 內的請求無法攜帶應用程式的 Session Cookie，使得前端通道登出在絕大多數現代瀏覽器中形同虛設。

### 3. Back-Channel Logout（後端通道登出，現代首選推薦）
- **機制**：完全避開瀏覽器！當 IdP 登出時，由 IdP 伺服器直接向所有已註冊的應用程式後端發起 HTTP POST 呼叫。
- **Logout Token**：呼叫時攜帶一個特殊的由 IdP 簽名的 `Logout Token`（包含使用者 `sub` 與會話標識 `sid`）。
- **應用端處理**：應用伺服器驗證該 Token 的合法性後，在伺服器端將對應的 Session 立即撤銷或加入黑名單。即使瀏覽器端未收到通知，該使用者的下一次請求也會因 Session 失效而被迫重新登入。

## 聯邦身分的失敗窗口與邊界

1. **局部登出失敗（Partial Logout）**：後端通道發送 Logout Token 時若特定應用程式網路逾時，會導致使用者在該系統仍處於已登入狀態。因此系統應依賴本地較短的 Session 有效期作為底線保護。
2. **多租戶 IdP 偽造（Multi-Tenant Confusion）**：在 Azure AD 等多租戶提供者中，`iss` 往往包含動態的 `tenant_id`。應用程式在驗證時，絕不能只比對網域名稱，必須嚴格鎖定受信任的租戶識別碼。

## 相關文件與參考來源

- [API 授權：OAuth 2.0 授權模式與許可類型](../api/oauth-authorization-flows-and-grant-types.md)：回顧底層授權框架。
- [API 授權：Token 架構、JWT 簽章與 JWKS 金鑰輪替](../api/tokens-jwt-and-jwks-architecture.md)：深入 JWT 與 JWKS 密碼學原理。
- [Web 安全：第三方登入、OAuth 與 OIDC 邊界](oauth-and-federated-login.md)：了解 Web 轉址流程中的登入 CSRF 與帳號綁定。
- OpenID Foundation, *OpenID Connect Core 1.0*.
- OpenID Foundation, *OpenID Connect Discovery 1.0*.
- OpenID Foundation, *OpenID Connect Back-Channel Logout 1.0*.
