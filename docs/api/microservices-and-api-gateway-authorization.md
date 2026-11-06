# 微服務與 API 閘道授權架構

在微服務架構中，單一外部請求通常需要跨越多個獨立後端服務協同完成。
如何在 API 閘道（API Gateway）與分散式微服務之間安全傳遞呼叫者身分、約束服務間的呼叫權限，並維持嚴密的審計溯源鏈，是大型分散式系統中不可迴避的架構課題。

## 邊界驗證與微服務內部通訊的信任斷層

在單體應用（Monolith）中，使用者身分通常存放在單一進程的記憶體或執行緒本地儲存（Thread-Local Storage）中。當系統拆分為微服務後，面臨兩難的架構取捨：

### 痛點 A：各自驗證導致的集中式效能瓶頸
若每一個微服務在收到內部請求時，都各自拿著外部 Access Token 向中央授權伺服器（Authorization Server）發起遠端內省（Introspection），授權伺服器將承受 $N$ 倍的內部呼叫放大，成為全系統的吞吐瓶頸與單點故障源。

### 痛點 B：邊界解碼直接傳明文導致的假冒風險
常見的捷徑做法是：由 API 閘道在邊界集中驗證 Token，解析出 `user_id` 後，以未經防護的 HTTP Header（例如 `X-User-Id: 42`、`X-User-Roles: admin`）向內網微服務透傳。
- **致命弱點**：一旦微服務網路內部缺乏隔離，任何一個存在遠端程式碼執行（RCE）或 SSRF 漏洞的內部服務，都能在呼叫相鄰服務時任意偽造 `X-User-Id` 與管理員角色，在內網長驅直入（缺乏內部零信任防線）。

```
[ 用戶端 (Web/App) ] ──(外部 Bearer Token)──> [ API 閘道 (API Gateway) ]
                                                        │
                      ┌─────────────────────────────────┴─────────────────────────────────┐
                      ▼                                                                   ▼
           [ 方案一：過度信任明文 (危險) ]                                   [ 方案二：安全身分上下文傳遞 (推薦) ]
        透傳: X-User-Id: 42                                           透傳: 內部專用短效 JWT (受眾受限 + 內部驗簽)
        問題: 任一內部節點皆可偽造 Header                               或是: 網格 mTLS 雙向認證 + 簽名 Context
```

## 核心模式一：Token 降級與轉換（Token Exchange, RFC 8693）

為了解決外部 Token 權限過大且容易被內網擴散濫用的問題，現代架構採用 **RFC 8693 權杖交換（OAuth 2.0 Token Exchange）** 機制：

1. **外部使用短效或不透明 Token**：用戶端向 API 閘道出示外部 Access Token（可能具有多種業務 Scopes）。
2. **閘道處執行權杖交換**：
   - API 閘道驗證外部 Token 合法後，向授權服務或內部金鑰模組發起交換。
   - 交換時要求指定**目標受眾（Audience, `aud`）**與**精簡權限**。
   - 例如：將一個全域 Token 轉換為專門發給 `order-service` 的內部短效 JWT（有效期僅 1–2 分鐘，`aud: "https://api.internal/order"`）。
3. **防止跨服務濫用**：即使 `order-service` 遭入侵外洩了該內部 Token，該 Token 由於受眾限制（Audience Restriction），也完全無法被拿去存取 `payment-service` 或 `user-service`。

## 核心模式二：內部身分上下文封套與防篡改簽章

若為了追求極限效能而不希望微服務內部頻繁交換 Token，可採用「API 閘道驗證 + 內部簽章封套」模式：

1. **API 閘道職責**：
   - 負責對外的 TLS 終止、CORS 處理、限流、以及外部 Access Token / JWT 的密碼學驗簽。
   - 從外部 Token 提取主體身分，封裝為標準化的內部使用者上下文（`UserContext`）。
2. **防篡改標頭（Signed Identity Header）**：
   - 閘道不傳送明文，而是將 `UserContext` 物件使用內部私鑰簽發為輕量級的內部 JWT（或以 HMAC-SHA256 產生簽章放在 `X-Internal-Signature` 標頭中）。
   - 內部 JWT 包含微小的生命週期（如 30 秒至 1 分鐘）與當前請求唯一的 `request_id`。
3. **內部服務防禦策略**：
   - 所有內部微服務**一律拒絕任何直接來自外部網際網路的請求**（透過網路安全群組或私有 VPC 實體隔離）。
   - 微服務讀取標頭時，本機使用閘道公鑰驗章；若簽章缺失、過期或不符，直接拋出 401 Unauthorized。
   - 結合 **Service Mesh（如 Istio / Linkerd）** 的 mTLS 雙向認證，由代理層（Sidecar）強制校驗發起端必須是 API Gateway 的服務帳號（SPIFFE ID），徹底杜絕橫向偽造。

## 核心模式三：服務間鏈式呼叫的身分委託（Delegation vs Impersonation）

在複雜業務中，常出現「使用者委託服務 A 處理，服務 A 又呼叫服務 B，服務 B 再呼叫服務 C」的鏈式場景（例如：文章購買流程中，文章服務呼叫促銷服務，促銷服務呼叫錢包扣款）。

此時面臨經典的**混淆代理人問題（Confused Deputy Problem）**：若服務 B 呼叫服務 C 時僅出示服務 B 自己的機器憑證（Client Credentials），服務 C 將無法得知這筆操作究竟是代表哪一位使用者的意圖，審計日誌也會遺失真實行為人。

### 解決方案：RFC 8693 委託宣告（Actor Claim）
在鏈式呼叫中，Token 同時記錄「資源擁有者（主體）」與「當前代理執行的服務（Actor）」：

```json
{
  "iss": "https://auth.internal",
  "sub": "user-42",
  "aud": "wallet-service",
  "exp": 1730890060,
  "scope": "wallet:deduct",
  "act": {
    "sub": "service-order"
  }
}
```

- **語意解析**：
  - `sub: "user-42"`：這筆錢是從使用者 42 的錢包中扣除（真實資源主體）。
  - `act.sub: "service-order"`：當前發起扣款命令的代理執行者是「訂單服務」（委託者）。
  - `aud: "wallet-service"`：這張票據僅限在「錢包服務」消費。
- **效益**：錢包服務既能精準驗證訂單服務是否有權發起扣款，又能確保扣款對象被嚴格鎖定在 user-42，且未獲委託的獨立服務無法冒用該票據。

| 授權維度 | 邊界外網通訊 | 微服務內部通訊 |
|---|---|---|
| **通訊協定** | 公網 HTTPS | 內部 mTLS / gRPC / HTTP |
| **憑證類型** | 不透明 Token 或長期 Access Token | 短效內部 JWT（受眾受限）或 Signed Context |
| **驗證主體** | API 閘道（邊界集中校驗） | 內部 Sidecar / 服務框架本機非對稱驗簽 |
| **身分語意** | 單一使用者身分 | 使用者主體（`sub`） + 代理服務（`act`）複合結構 |
| **有效期限** | 15 分鐘至數小時 | 30 秒至 2 分鐘（極短時效防重放） |

## 貫穿案例：文章閱讀與訂閱系統的授權流轉

以 CarlAcademy 付費文章專欄訂閱為例，展示完整的端到端身分流轉：

```
1. 讀者點擊購買文章專欄
   用戶端 ──(POST /subscriptions, 帶外部 Access Token)──> [ API 閘道 ]
                                                             │
2. 閘道驗章、限流，並執行 Token Exchange                      │
   產生內部 JWT (sub: reader-7, aud: subscription-service)   │
                                                             ▼
                                                [ 訂閱服務 (Subscription) ]
                                                             │
3. 訂閱服務需要扣除閱讀點數，發起鏈式委託                       │
   簽發委託 JWT (sub: reader-7, act: subscription,          │
                aud: ledger-service, scope: balance:deduct)  │
                                                             ▼
                                                  [ 帳本服務 (Ledger) ]
                                                             │
4. 帳本服務驗核: 扣除 reader-7 點數，寫入審計日誌:
   「由 subscription-service 代理執行 reader-7 扣款 50 點」───┘
```

## 常見誤解與邊界限制

- **誤解：只要內網有防火牆隔離，服務之間就可以完全裸奔傳遞明文 ID。**
  零信任（Zero Trust）安全架構的核心原則是「假設網路已被攻破（Assume Breach）」。內部服務如果無條件信任 HTTP Header，任何一個暴露在外的開發測試介面或內部弱點，都會直接造成全站所有帳號失陷。
- **誤解：內部微服務之間只使用 Client Credentials（機器身分）就足夠了。**
  若服務間呼叫完全丟失原始使用者資訊，接收端將無法執行基於使用者屬性的細粒度權限檢查（例如「該使用者是否真的擁有這篇草稿的編輯權」），且事後安全審計無法定位真實操作者。
- **限制：內部 JWT 的有效期必須極度短暫。**
  由於內部微服務通常不向中央資料庫做同步撤銷檢查，內部 JWT 必須將生命週期壓縮至 1–2 分鐘以內。若外部發生登出或帳號凍結，閘道端拒絕換票，內部過期後即可自然收斂失效。

## 相關文件與參考來源

- [身分驗證與授權](authentication-and-authorization.md)：理解身分主體、權限檢查與 Scope 的概念基礎。
- [OAuth 2.0 授權模式與許可類型](oauth-authorization-flows-and-grant-types.md)：深入各類 Grant Types 與 M2M 憑證。
- [Token 架構、JWT 簽章與 JWKS 金鑰輪替](tokens-jwt-and-jwks-architecture.md)：掌握 JWT 結構與非對稱金鑰輪替。
- [Web 安全：信任邊界與威脅思考](../web-security/trust-boundaries.md)：認識跨越信任邊界時的資料驗證原則。
- RFC 8693, *OAuth 2.0 Token Exchange*.
- NIST Special Publication 800-207, *Zero Trust Architecture*.
