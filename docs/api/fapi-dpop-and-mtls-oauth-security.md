# 金融級 OAuth：DPoP、mTLS 與推播授權請求

標準 OAuth 2.0 所使用的主要憑證是 **持有人權杖（Bearer Token）**。
Bearer Token 的法律與技術語意就如同紙幣現金——「任何在 HTTP 標頭中出示此 Token 者，伺服器皆承認其存取權」。
在開放銀行（Open Banking）、跨境金融支付、高機密雲端控制台等嚴苛場景中，單純依賴傳輸層 TLS 無法防範日誌洩漏、中繼代理外洩或 XSS 竊取後的冒用。
**金融級 API 規範（Financial-grade API, FAPI）** 引入了持有者證明（Proof-of-Possession）與推播授權請求，將 OAuth 提升至防竄改、防冒用與防重放的最高安全水位。

## Bearer Token 的脆弱原罪與持有者證明（PoP）

Bearer Token（RFC 6750）最大的結構性缺陷在於**權杖本身與呼叫者的身分完全脫鉤**：

```
[ 惡意攻擊者 / 惡意代理人 ] ──(截獲合法 Bearer Token)──> [ 資源伺服器 ]
                                                              │
                    伺服器僅檢查: Token 是否過期？簽章是否合法？  │
                    完全無法識別: 拿 Token 前來的人，是否就是當初申請的人？ ──> 放行並執行扣款！
```

為了解決此漏洞，密碼學界引入了 **持有者證明（Proof-of-Possession, PoP）** 機制：
授權伺服器在簽發 Access Token 時，強制將 Token 與用戶端的**非對稱公開金鑰（或客戶端 TLS 憑證）**進行密碼學綁定；當用戶端呼叫資源伺服器時，必須同時出示該金鑰的私鑰簽章證明。攻擊者即便單獨攔截了 Token 字串，因缺少用戶端私鑰，依然無法發起任何有效呼叫。

## 機制一：DPoP——應用層持有者證明（RFC 9449）

在許多現代架構（如單頁應用 SPA、原生行動 App 或無專屬靜態 IP 的微服務）中，配置底層硬體 mTLS 網路設備成本極高。**RFC 9449 DPoP** 提供了一套完全運行在 HTTP 應用層的純軟體 PoP 解決方案。

### DPoP 運作流程與時序
1. **用戶端生成密鑰對**：用戶端在記憶體或本機安全環境生成一組非對稱金鑰（如 ES256 或 Ed25519）。
2. **申請 DPoP-Bound Token**：
   - 用戶端呼叫 Token 端點時，在 HTTP Header 附加一個自簽名的 JWT——稱為 **DPoP Proof**。
   - 授權伺服器提取該 Proof 中的公鑰，計算其 SHA-256 指紋（JWK Thumbprint, `jkt`），並將該指紋寫入簽發的 Access Token 內部（宣告在 `cnf.jkt` 欄位中）。
3. **呼叫受保護 API 資源**：
   - 每次用戶端呼叫 API 時，必須同時攜帶兩個 Header：
     - `Authorization: DPoP <access_token>`
     - `DPoP: <dpop_proof_jwt>`
   - **DPoP Proof 的內部關鍵 Claims**：
     - `htm`（HTTP Method）：例如 `"POST"`。
     - `htu`（HTTP URI）：例如 `"https://api.example.com/transfers"`。
     - `jti`（Unique Nonce）：唯一的隨機 ID，伺服器用以防範重放攻擊。
     - `iat`（Issued At）：簽發時間戳，有效期通常僅設定數秒鐘。
4. **資源伺服器雙重驗證**：
   - 驗證 Access Token 本身有效，且包含 `cnf.jkt`。
   - 驗證 `DPoP` Header 的簽章，確認簽署該 Proof 的公鑰指紋精確符合 Token 內的 `cnf.jkt`。
   - 確認 `htm` 與 `htu` 精確符合當前請求的 HTTP 方法與路徑。

攻擊者即使透過日誌洩漏偷走了 `access_token`，若無法獲取用戶端記憶體中的私鑰來簽署對應目標端點的即時 DPoP Proof，該 Token 便如同廢紙。

## 機制二：mTLS 憑證綁定權杖（RFC 8705）

在伺服器對伺服器（B2B 金流通道、核心資料交換）情境中，業界標準採用 **RFC 8705 mTLS 憑證綁定（Mutual-TLS Client Certificate-Bound Access Tokens）**：

- **運作核心**：
  - 用戶端與授權伺服器、資源伺服器建立連線時，雙方在傳輸層執行 mTLS 握手，用戶端出示 X.509 數位憑證。
  - 授權伺服器簽發 Token 時，在 Payload 注入該 X.509 憑證的 SHA-256 指紋：
    ```json
    {
      "sub": "bank-client-app",
      "cnf": {
        "x5t#S256": "bwcK0SpIv2GBbFVJuWDGUZqkS-bDyqi//..."
      }
    }
    ```
  - 資源伺服器在 TLS 連線建立時由網卡/負載平衡器提取連線憑證指紋，直接核對 Token 內的 `cnf.x5t#S256`。兩者不符立即中斷連線。

## 機制三：推播授權請求（PAR, RFC 9126）與 JAR（RFC 9101）

傳統 OAuth 2.0 在啟動前端授權時，是用戶端組裝超長網址，透過瀏覽器 Query String 轉址：
`GET /authorize?response_type=code&client_id=...&scope=payment&amount=10000...`

### 傳統轉址的資安漏洞
- 參數明文暴露在瀏覽器網址列、瀏覽歷史與反向代理 Access Log 中。
- 惡意瀏覽器擴充套件可在跳轉前竄改 Query String（例如竄改轉帳受款人帳號）。
- 網址長度受限於瀏覽器與伺服器的 URL 長度上限（通常 2048 字元）。

### PAR（Pushed Authorization Requests）防護時序
PAR 將前端通道的參數傳遞完全改為後端直接推播：

```
[ 用戶端後端 (Client) ]                                       [ 授權伺服器 (AS) ]
         │                                                            │
         │─── 1. 後端 POST 推播參數 (POST /as/par) ─────────────────>│
         │       (在後端安全通道出示 Client 憑證，傳遞完整授權參數)   │ (驗證 Client，保存請求參數)
         │<── 2. 回傳短效 Request URI (request_uri: "urn:ietf:...") ──│ (產生單次、90秒過期 URI)
         │
(用戶端僅需將瀏覽器導向精簡網址: GET /authorize?client_id=...&request_uri=urn:ietf:...)
         │
[ 終端使用者瀏覽器 ] ─── 3. 造訪帶有 request_uri 的乾淨網址 ────────> [ 授權伺服器 ]
```

搭配 **JAR（JWT-Secured Authorization Request，RFC 9101）**，所有授權參數在用戶端本地使用私鑰簽名成 `request` 物件，授權伺服器驗簽後才處理，確保整趟授權意圖在傳輸過程中百分之百不可篡改。

| 安全機制 | 規範標準 | 防護層級 | 抵禦的威脅 | 適合的用戶端 |
|---|---|---|---|---|
| **DPoP** | RFC 9449 | 應用層（HTTP Header） | Token 竊取與重放、中間人未授權使用 | SPA、行動 App、現代 Web 後端 |
| **mTLS 綁定** | RFC 8705 | 傳輸層（TLS Handshake） | 網路竊聽、Token 橫向移動 | 企業伺服器、金融專線微服務 |
| **PAR / JAR** | RFC 9126 / 9101 | 授權發起邊界 | 網址列洩漏、轉址參數篡改、瀏覽歷史刺探 | 所有對安全性要求極高的 OAuth 系統 |

## 相關文件與參考來源

- [OAuth 2.0 授權模式與許可類型](oauth-authorization-flows-and-grant-types.md)：回顧標準 Grant Types。
- [Token 架構、JWT 簽章與 JWKS 金鑰輪替](tokens-jwt-and-jwks-architecture.md)：理解非對稱數位簽章與 JWKS 機制。
- [微服務與 API 閘道授權架構](microservices-and-api-gateway-authorization.md)：深入邊界 Token 驗證。
- RFC 9449, *OAuth 2.0 Demonstrating Proof-of-Possession at the Application Layer (DPoP)*.
- RFC 8705, *OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens*.
- RFC 9126, *OAuth 2.0 Pushed Authorization Requests (PAR)*.
- OpenID Foundation, *Financial-grade API (FAPI) 2.0 Security Profile*.
