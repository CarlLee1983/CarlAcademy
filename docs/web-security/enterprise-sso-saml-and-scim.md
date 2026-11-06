# 企業級 SSO、SAML 橋接與 SCIM 自動帳號生命週期

在 B2B SaaS 與大型企業軟體架構中，身分認證絕非僅是提供「註冊帳號與密碼」表單。
企業客戶嚴格要求所有員工必須透過其統一的企業身分提供者（如 Okta、Microsoft Entra ID / Azure AD、Ping Identity）進行單點登入（SSO），且在員工離職或調職時，外部系統必須即時同步開通（Provisioning）與銷毀（Deprovisioning）帳號權限。
掌握動態 IdP 發現、SAML 2.0 協定橋接，以及基於 SCIM 2.0 規範的自動生命週期管理，是建構合規企業級架構的必備支柱。

## 智慧路由核心：動態 IdP 發現（Home Realm Discovery, HRD）

在一款服務數千家企業客戶的多租戶 SaaS 產品中，每個客戶都對接不同的 IdP（例如 A 公司使用 Okta、B 公司使用 Azure AD、C 公司使用 Google Workspace）。登入入口不能為每家企業開闢不同的網址，而是透過 **Home Realm Discovery（HRD）** 動態識別：

```
使用者於登入頁輸入: "alice@acme-corp.com"
                  │
                  ▼
[ 1. 域名解析與租戶匹配 ] ──> 提取 Email 網域名稱 "acme-corp.com"
                              查詢租戶資料庫: 找到 Acme Corp 綁定的是其專屬的 Okta SSO 實例
                  │
                  ▼
[ 2. 動態協議轉址 ] ───────> 瀏覽器自動導向至 Acme 專屬的 SSO 端點:
                              https://acme.okta.com/app/carlacademy/sso/saml
```

若使用者輸入的是公共郵箱（如 `@gmail.com`），系統則自動降級顯示傳統的密碼輸入框或 Passkey 入口。

## SAML 2.0 協定核心與現代 OIDC 橋接

儘管現代 Web 強烈推薦使用基於 JSON/JWT 的 OpenID Connect（OIDC），但在傳統金融、醫療與政府巨頭企業中，**SAML 2.0（Security Assertion Markup Language）** 依然佔據半壁江山。SAML 2.0 是一套基於 XML 的身分斷言協定。

### 角色定義
- **服務提供者（Service Provider, SP）**：我們的 SaaS 應用系統。
- **身分提供者（Identity Provider, IdP）**：企業內部的中央目錄服務（如 Okta）。

### 典型的 SP-Initiated SAML 流程
1. 使用者在 SP 點擊企業登入，SP 生成一筆包含時間戳與隨機 ID 的 `<samlp:AuthnRequest>` XML，並以 Base64 編碼透過瀏覽器重定向送至 IdP。
2. 使用者在 IdP 完成企業內部認證（包含 MFA、硬體憑證卡等）。
3. IdP 生成一筆包含使用者身分與屬性的 `<saml:Response>`，內部包含一塊關鍵的 **`<saml:Assertion>`（身分斷言）**。
4. IdP 透過瀏覽器以 HTTP POST 方式（SAML Assertion Consumer Service, ACS 端點）將 XML 斷言送回 SP。
5. **SP 驗章與橋接**：
   - SP 驗證 XML 數位簽章（XML-DSig）是否由該企業註冊的 X.509 憑證所簽署。
   - 確認 `<saml:Conditions>` 未過期，且受眾（Audience）精確等於本 SP 的 Entity ID。
   - **現代化橋接**：SP 後端在驗證 SAML 斷言成功後，**立即將其轉換為內部通用的 Session 或簽發內部 OIDC JWT**，使得下游業務邏輯無需感知繁瑣的 XML 結構。

```
[ 使用者瀏覽器 ] ──(1. 輸入公司 Email)──> [ SaaS 應用 (SP) ]
       │                                         │
       │<──(2. 轉址 AuthnRequest)─────────────────┘
       ▼
[ 企業 IdP (Okta / Azure AD) ]
       │ (企業內網登入與 MFA 驗證完成)
       │
       └──(3. 瀏覽器 POST 提交 SAML Assertion XML)──> [ SaaS ACS 端點 ]
                                                            │
                                        (4. 驗證 XML 簽章，轉換為內部會話)
```

### SAML 歷史安全弱點與防護
- **XML 實體注入（XXE 漏洞）**：解析 SAML 的 XML 解析器必須在程式碼中硬性停用外部實體解析（`disable-dtd`, `disallow-doctype-decl`），否則攻擊者可構造惡意 XML 刺探內部檔案。
- **XML 簽章包裝攻擊（XML Signature Wrapping, XSW）**：SAML 允許只對斷言部分簽章。若解析器邏輯不嚴謹，攻擊者可在 XML 根節點複製一個未簽章的偽造斷言，導致程式誤判身分。防禦關鍵是必須確保業務讀取的主體就是被數位簽章嚴格覆蓋的同一個節點。

## 為什麼只有 SSO 遠遠不夠？SCIM 2.0 的必要性

傳統企業僅靠 SSO 登入面臨嚴重的**離職員工「孤兒帳號」與安全盲點**：

### JIT Provisioning（即時自動建帳）的致命缺陷
許多系統依賴「JIT（Just-In-Time）Provisioning」：當員工第一次透過 SAML/OIDC 成功登入時，SaaS 系統即時在本地資料庫建立帳號。
- **無法處理離職停用**：當員工從企業離職時，企業 IT 管理員在 Okta 凍結了該帳號。由於離職員工再也不會造訪該 SaaS，**SaaS 系統永遠無法得知該員工已經離職**！該員工在 SaaS 中的私有專案、共享權限與受委託 API 金鑰將永久滯留，形成巨大的合規與外洩漏洞。

### SCIM 2.0（跨網域身分管理系統，RFC 7644）
SCIM 2.0 定義了一套標準的 RESTful JSON 規範，讓企業 IdP 能夠以推播（Push）方式，即時向 SaaS 系統同步使用者與群組的全生命週期：

```
[ 企業 HR / IT 系統 (Okta) ] ──────(標準 SCIM 2.0 REST API)──────> [ SaaS 應用系統 (CarlAcademy) ]
 - 員工入職 (Hire)  ─────────── POST /scim/v2/Users ────────────> 自動建立帳號與工作區
 - 組織異動 (Update) ────────── PATCH /scim/v2/Users/{id} ───────> 同步更新部門、職級與角色
 - 員工離職 (Terminate) ─────── PATCH /scim/v2/Users/{id} ───────> 「即時」鎖定帳號、作廢所有 Session!
                                (active = false)
 - 團隊群組調整 ─────────────── PUT /scim/v2/Groups/{id} ────────> 自動同步專案成員名單
```

| 帳號管理機制 | 觸發時機 | 支援操作 | 員工離職響應速度 |
|---|---|---|---|
| **JIT Provisioning** | 員工手動點擊登入時 | 僅支援建立與被動更新 | **極差**（離職未登入則無法獲知） |
| **SCIM 2.0 Push** | 企業管理員在 IdP 操作時 | 建立、更新、**即時停用**、群組成員同步 | **即時（秒級自動同步）** |

## 相關文件與參考來源

- [OpenID Connect 協定規範與身分聯邦邊界](oidc-protocols-and-identity-federation.md)：掌握現代身分聯邦與單一登出原理。
- [第三方登入、OAuth 與 OIDC 邊界](oauth-and-federated-login.md)：回顧 Web 轉址與帳號對應。
- [細粒度授權、ReBAC 與策略引擎](../api/fine-grained-authorization-and-policy-engines.md)：理解企業群組同步後的權限指派。
- OASIS, *Security Assertion Markup Language (SAML) V2.0 Core*.
- RFC 7644, *System for Cross-domain Identity Management: Protocol (SCIM 2.0)*.
- RFC 7643, *System for Cross-domain Identity Management: Core Schema (SCIM 2.0)*.
