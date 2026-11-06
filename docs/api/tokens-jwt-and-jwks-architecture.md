# Token 架構、JWT 簽章與 JWKS 金鑰輪替

存取權杖（Access Token）是授權伺服器頒發給用戶端、用以證明其具備特定資源存取資格的數位憑證。
在系統設計中，選擇自包含的無狀態 JWT 還是具備中央狀態的不透明 Token，直接決定了微服務架構的查詢延遲、資料庫負載與即時撤銷能力。

## 兩大 Token 架構設計：Reference Token 與 Value Token

依據 Token 內部是否攜帶業務資料，架構上分為兩大流派：

| 架構面向 | 參考型權杖（Reference / Opaque Token） | 數值型權杖（Value / Self-Contained JWT） |
|---|---|---|
| **形態與長度** | 隨機生成的無意義字串（如 128 位元 UUID 或高熵十六進位值） | 經過 Base64URL 編碼的三段式 JSON 結構體，長度較長（數百至數千字元） |
| **驗證方式** | 資源伺服器每次收到 Token，必須向授權伺服器或中央快取查詢（Introspection） | 資源伺服器僅需以授權伺服器的公鑰本機驗證簽章，完全無須網路呼叫 |
| **驗證延遲** | 較高（依賴跨服務網路 RPC 或 Redis 查詢） | 極低（CPU 數十微秒等級之密碼學非對稱驗簽） |
| **撤銷時效** | **即時生效（Instant Revocation）**：中央快取刪除即可立即作廢 | **延遲生效**：Token 在過期（`exp`）前依然有效，即時撤銷需維護黑名單 |
| **敏感資料外洩風險** | 極低（Token 本身不含任何明文資訊） | 需注意（Payload 僅為編碼非加密，任何人皆可解碼查看內部 Claims） |

## 權杖內省與撤銷標準（RFC 7662 & RFC 7009）

當使用不透明 Token 或由 API Gateway 驗證權杖狀態時，OAuth 2.0 定義了兩組標準端點：

### 1. Token 內省端點（Token Introspection，RFC 7662）
資源伺服器收到用戶端出示的 Token 後，向授權伺服器的 `/oauth/introspect` 發起驗證查詢：
```http
POST /oauth/introspect HTTP/1.1
Host: auth.example.com
Authorization: Basic czZCaGRSa3F0MzpnWDFmQmF0M2JW
Content-Type: application/x-www-form-urlencoded

token=mF_9.B5f-4.1JqM
```
授權伺服器回傳該 Token 的狀態宣告：
```json
{
  "active": true,
  "scope": "articles:read articles:write",
  "client_id": "carl-app-web",
  "sub": "user-42",
  "exp": 1730890000
}
```
若 Token 已過期、遭撤銷或不存在，回傳 `{"active": false}`。

### 2. Token 撤銷端點（Token Revocation，RFC 7009）
當使用者點擊登出或解除授權時，用戶端通知授權伺服器作廢特定 Token（`/oauth/revoke`），授權伺服器立即將其從活躍狀態清單中抹除。

## JSON Web Token（JWT, RFC 7519）結構與簽章演算法

JWT 採用點號（`.`）分隔的三段式緊湊編碼：

$$\text{JWT} = \text{Base64URL}(\text{Header}) \,.\, \text{Base64URL}(\text{Payload}) \,.\, \text{Base64URL}(\text{Signature})$$

1. **標頭（Header）**：宣告 Token 類型與簽章演算法（如 `{"alg": "RS256", "typ": "JWT", "kid": "key-2026-11"}`）。
2. **負載（Payload / Claims）**：儲存身分與權限聲明：
   - 註冊宣告（Registered Claims）：`iss`（發行者）、`sub`（主體 ID）、`aud`（受眾）、`exp`（過期時間戳）、`nbf`（生效前時間戳）、`iat`（簽發時間戳）。
   - 公共與私有宣告：業務所需欄位，如 `scope`、`roles`、`tenant_id`。
3. **簽章（Signature）**：
   - 防篡改核心。透過特定演算法將前兩段的串接字串搭配密鑰進行運算：
   $$\text{Signature} = \text{Sign}(\text{Base64URL}(H) \,||\, "." \,||\, \text{Base64URL}(P), \, \text{Key})$$

### 簽章演算法比較：對稱 vs 非對稱

- **對稱金鑰（HMAC with SHA-256 / HS256）**：
  - 簽發者與驗證者共用同一個密鑰（Shared Secret）。
  - **架構致命傷**：在微服務架構中，所有需要驗證 Token 的下游後端服務都必須擁有該密鑰；只要任一微服務遭滲透，攻擊者即可偽造全站任意使用者的管理員 Token。
- **非對稱金鑰（RSA with SHA-256 / RS256，或 ECDSA / ES256，或 Ed25519 / EdDSA）**：
  - 授權伺服器獨自持有**私鑰（Private Key）**進行簽名。
  - 所有微服務與 API Gateway 僅持有**公鑰（Public Key）**進行純粹的驗章。
  - 即使下游微服務被完全攻陷，攻擊者也僅能讀取公鑰，無法憑空偽造新的合法 Token。

## JWKS（JSON Web Key Set, RFC 7517）與自動公鑰輪替

在生產環境中，私鑰與公鑰必須具備定期輪替（Key Rotation）能力，且公鑰更換時絕不能導致全站服務集體重啟。

### 公鑰發布端點：`/.well-known/jwks.json`
授權伺服器對外公開暴露一個標準端點，以 JSON 陣列形式發布當前所有合法的公鑰集合：

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "key-2026-11-active",
      "n": "u1WDEg2...（公鑰模數 Modulus）",
      "e": "AQAB"
    },
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "key-2026-10-grace",
      "n": "v9X8bQ...（上一代寬限期公鑰）",
      "e": "AQAB"
    }
  ]
}
```

### 資源伺服器驗簽工作流
1. 當資源伺服器收到 JWT 時，解析其 Header 中的 `kid`（Key ID，金鑰識別碼）。
2. 檢查本地快取中是否已有該 `kid` 的公鑰：
   - 若有：直接以該公鑰執行本機數學驗簽。
   - 若無：向授權伺服器的 `/.well-known/jwks.json` 重新拉取最新金鑰集並快取，再執行驗簽。
3. **無痛輪替實踐**：在輪替金鑰時，授權伺服器先將新公鑰加入 JWKS 發布；接著開始以新私鑰簽發 Token；同時保留舊公鑰一段時間（寬限期），確保在過渡期間簽發的舊 Token 仍能被順利驗章。

## 常見安全漏洞與防禦

1. **`alg: none` 簽章繞過攻擊**：
   - 歷史漏洞：部分不嚴謹的 JWT 驗證函式庫若看到標頭 `{"alg": "none"}`，會直接跳過簽章比對判定合法。
   - 防禦：驗證端必須在程式碼中**硬性白名單限定**預期的演算法（如嚴格要求 `RS256`），禁止依據傳入的 Header 動態決定驗證邏輯。
2. **金鑰混淆攻擊（Key Confusion: RS256 降級為 HS256）**：
   - 漏洞成因：攻擊者取得公開的 RSA 公鑰文字，將 JWT Header 的演算法竄改為對稱式 `HS256`，並以 RSA 公鑰作為對稱金鑰進行 HMAC 簽名。若伺服器使用同一個驗證函式，會誤把原本的 RSA 公鑰當作 HMAC 密鑰計算，導致偽造成功。
   - 防禦：嚴格強制指定演算法類型，禁止非對稱公鑰被誤用為對稱密鑰。

## 相關文件與參考來源

- [OAuth 2.0 授權模式與許可類型](oauth-authorization-flows-and-grant-types.md)：了解 Token 是如何被協調簽發的。
- [Web 安全：第三方登入、OAuth 與 OIDC 邊界](../web-security/oauth-and-federated-login.md)：了解 ID Token 與 Access Token 在前端通道的差異。
- RFC 7519, *JSON Web Token (JWT)*.
- RFC 7517, *JSON Web Key (JWK) and JWKS*.
- RFC 7662, *OAuth 2.0 Token Introspection*.
- RFC 7009, *OAuth 2.0 Token Revocation*.
