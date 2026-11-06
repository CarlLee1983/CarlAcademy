# OAuth 2.0 授權模式與許可類型

OAuth 2.0 是一個授權框架（Authorization Framework），它允許第三方應用程式在不獲取使用者密碼的前提下，代表資源擁有者或自身取得對受保護 HTTP 資源的有限存取權限。
選用正確的授權許可類型（Grant Type），是確保用戶端身分、權限範圍（Scope）與金鑰憑證不被攔截濫用的核心關鍵。

## 四大核心角色與責任邊界

依據 RFC 6749 規範，OAuth 2.0 嚴格劃分了四個參與主體：

1. **資源擁有者（Resource Owner）**：通常是終端使用者，擁有受保護資源並具備授予存取權的能力（例如文章發布者）。
2. **用戶端（Client）**：代表資源擁有者發起資源請求的第三方應用程式（例如 CarlAcademy 的行動 App 或第三方文章備份工具）。依據能否安全保存機密憑證，分為**機密型用戶端（Confidential Client）**（具備安全後端伺服器）與**公開型用戶端（Public Client）**（如單頁 SPA 應用、原生手機 App）。
3. **授權伺服器（Authorization Server）**：負責驗證資源擁有者身分、獲取存取同意，並在驗證用戶端合法性後簽發存取權杖（Access Token）。
4. **資源伺服器（Resource Server）**：代管受保護資源的 API 伺服器，負責檢驗 Access Token 的有效性並回應受保護的資料。

```
+--------+                               +---------------+
|        |--(A)- 授權請求 (Authorization) ->|   資源擁有者  |
|        |<-(B)- 授權許可 (Grant) ----------| (Resource Owner)|
|        |                               +---------------+
|        |
|        |                               +---------------+
|        |--(C)- 授權許可 (Grant) --------->|   授權伺服器  |
| 用戶端 |<-(D)- Access Token -----------| (Auth Server) |
| (Client)|                               +---------------+
|        |
|        |                               +---------------+
|        |--(E)- 攜帶 Access Token ------>|   資源伺服器  |
|        |<-(F)- 受保護資源 (Protected) ---| (Resource Svr)|
+--------+                               +---------------+
```

## 主流授權許可模式（Grant Types）深度剖析

OAuth 2.0 定義了多種授權模式，現代規範（OAuth 2.1 BCP）根據執行環境與信任邊界收斂為以下核心類型：

### 1. 授權碼模式搭配 PKCE（Authorization Code Grant with PKCE）

這是目前所有具備互動介面的 Web、SPA 與行動 App 的**唯一推薦標準**（RFC 7636）。

- **運作原理**：
  1. 用戶端在本地生成一個高強度的密碼隨機字串 `code_verifier`，並以 SHA-256 雜湊計算出 `code_challenge`。
  2. 瀏覽器重新導向至授權伺服器端點，附帶 `code_challenge` 與 `code_challenge_method=S256`。
  3. 使用者登入並同意授權，授權伺服器回傳一次性授權碼 `code`。
  4. 用戶端透過後端安全通道（或直接向 Token 端點）發起 HTTP POST，附帶 `code` 與未加密的原始 `code_verifier` 交換 Token。
  5. 授權伺服器對比雜湊值，確認出示授權碼者與當初發起授權者為同一個實體，防止授權碼遭惡意攔截冒領。
- **適用場景**：傳統後端 Web 網站、React/Vue 單頁應用（SPA）、iOS/Android 原生行動 App。

### 2. 用戶端憑證模式（Client Credentials Grant）

當操作不涉及具體終端使用者，而是兩個伺服器或微服務之間的機器對機器（M2M）通訊時使用。

- **運作原理**：
  用戶端直接以自身註冊的 `client_id` 與 `client_secret`（或私鑰簽章之 Client Assertion），向授權伺服器的 Token 端點發起請求：
  ```http
  POST /oauth/token HTTP/1.1
  Host: auth.example.com
  Authorization: Basic czZCaGRSa3F0MzpnWDFmQmF0M2JW
  Content-Type: application/x-www-form-urlencoded

  grant_type=client_credentials&scope=articles:read+system:metrics
  ```
  授權伺服器驗證憑證無誤後，直接簽發代表該服務自身權限的 Access Token。
- **適用場景**：排程清理 Worker、微服務內部 RPC 呼叫、跨伺服器日誌匯總。

### 3. 裝置授權模式（Device Authorization Grant）

依據 RFC 8628 定義，專為缺少完整鍵盤輸入能力或無內建瀏覽器的設備設計（如智慧電視、CLI 命令列工具、IoT 物件）。

- **運作原理**：
  1. 裝置向授權伺服器申請一組 `device_code` 與簡短的 `user_code`（如 `WDJB-MJHT`），以及驗證網址（`verification_uri`）。
  2. 裝置在螢幕上顯示網址與驗證碼（或 QR Code），提示使用者在手機或電腦瀏覽器開啟該網址並輸入該組代碼。
  3. 裝置以 `device_code` 持續向 Token 端點發起輪詢（Polling）。
  4. 使用者在外部裝置上登入並授權後，下一次輪詢即成功取得 Access Token。
- **適用場景**：`gh auth login` 命令列驗證、Apple TV 與遊戲主機登入。

### 4. 重新整理權杖模式與輪替機制（Refresh Token Grant & Rotation）

Access Token 為了降低外洩損害，通常設定極短的有效期（如 15 分鐘至 1 小時）。當其過期時，用戶端無需打擾使用者重新登入，而是使用長期有效的 Refresh Token 獲取新的 Access Token。

- **安全威脅**：若 Refresh Token 在傳輸或儲存時遭攻擊者竊取，攻擊者可無限期保持存取權。
- **防禦標準——Refresh Token 輪替（Refresh Token Rotation, RTR）**：
  - 每次用戶端出示舊的 Refresh Token 交換新 Access Token 時，授權伺服器**強制核發一個全新的 Refresh Token，並將舊的立即作廢**。
  - **重播偵測（Replay Detection）**：若授權伺服器發現一個**已經被作廢的舊 Refresh Token 再次被提交**，系統判定該 Token 家族已遭外洩或被中間人複製；伺服器立即觸發警報，**直接將該帳號名下簽發的所有 Token 家族全數撤銷**，強制使用者重新登入。

| 授權模式 (Grant Type) | 參與者 | 是否需使用者互動 | 用戶端類型要求 | 典型應用場景 |
|---|---|---|---|---|
| **Authorization Code + PKCE** | 資源擁有者 + 用戶端 | 是（瀏覽器登入與同意） | 公開型與機密型皆可 | Web 網站、SPA、行動 App |
| **Client Credentials** | 用戶端自身 | 否（M2M 機器對機器） | 必須為機密型（Confidential） | 背景 Worker、微服務間呼叫 |
| **Device Authorization** | 資源擁有者 + 無瀏覽器設備 | 是（次要裝置瀏覽器確認） | 通常為公開型設備 | CLI 工具、智慧電視、IoT |
| **Refresh Token Rotation** | 用戶端 + 授權伺服器 | 否（背景透明換票） | 公開型與機密型皆需防護 | 長期登入狀態維持 |

## 歷史模式的淘汰：為何 OAuth 2.1 正式廢棄 Implicit 與 Password 模式？

在最新的 OAuth 2.1 整合規範草案中，兩大歷史主流模式已被明確剔除：

1. **隱式許可模式（Implicit Grant）被廢棄**：
   - 歷史原因：過去瀏覽器不支援跨域發送 POST（CORS 尚未普及），舊版規格允許 Token 端點將 Access Token 直接放在轉址 URL 的 Hash Fragment（`#access_token=...`）回傳給前端。
   - 漏洞成因：Token 暴露在瀏覽器歷史紀錄、網址列與 Referrer 標頭中，極易遭 XSS 竊取或存取日誌外洩。現代瀏覽器全面支援 CORS 與 PKCE，此模式已無存在必要。
2. **密碼許可模式（Resource Owner Password Credentials Grant）被廢棄**：
   - 歷史原因：為了相容傳統將使用者帳號密碼直接交給客戶端表單的情境。
   - 漏洞成因：完全違背了 OAuth「不將密碼透露給第三方」的立論核心，客戶端可能惡意留存使用者明文密碼，且無法支援多因素驗證（MFA）或聯邦登入。

## 相關文件與參考來源

- [身分驗證與授權](authentication-and-authorization.md)：理解身分主體、權限檢查與 Scope 的概念基礎。
- [Token 架構、JWT 簽章與 JWKS 金鑰輪替](tokens-jwt-and-jwks-architecture.md)：深入探討 Token 結構與金鑰管理。
- [Web 安全：第三方登入、OAuth 與 OIDC 邊界](../web-security/oauth-and-federated-login.md)：了解瀏覽器轉址與登入 CSRF 防護。
- RFC 6749, *The OAuth 2.0 Authorization Framework*.
- RFC 7636, *Proof Key for Code Exchange by OAuth Public Clients (PKCE)*.
- RFC 8628, *OAuth 2.0 Device Authorization Grant*.
- IETF, *OAuth 2.1 Security Best Current Practice (BCP)*.
