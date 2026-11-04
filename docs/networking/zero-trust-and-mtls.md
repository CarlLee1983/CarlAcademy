# 零信任網路架構與雙向 TLS (mTLS) 通訊實務

在傳統網路安全架構中，普遍採用「**邊界防禦（Perimeter Defense / 城堡與護城河）**」模型：只要流量位於內部區域網路（Intranet）或透過 VPN 進入內網，便被預設為安全可信。
然而，隨著多雲混合環境、微服務架構與遠距辦公普及，內部實體邊界日益模糊。一旦攻擊者透過釣魚信件、未受保護的端點或依賴套件漏洞滲透內網，便能在無防備的內部網路肆意進行**橫向移動（Lateral Movement）**。

**零信任架構（Zero Trust Architecture, ZTA）** 徹底揚棄了「內網即信任」的假設，確立了「**從不信任，始終驗證（Never Trust, Always Verify）**」的核心原則。而在分散式系統與微服務之間，**雙向傳輸層安全（Mutual TLS, mTLS）** 是將身分驗證與加密下推至每一次呼叫的關鍵基石。

本文接續[TLS 傳輸層安全：交握協商、密鑰交換與安全通道](tls-and-secure-transport.md)與[負載平衡與反向代理：L4、L7 與流量調度](load-balancing-and-reverse-proxy.md)，並與資安主題[信任邊界與威脅思考](../web-security/trust-boundaries.md)及[身分驗證與授權原則](../api/authentication-and-authorization.md)相互對照。

## 零信任核心哲學與 NIST SP 800-207 架構

依據美國國家標準暨技術研究院（NIST）發布的 **NIST SP 800-207** 零信任架構規範，零信任的核心原則包含：

1. **所有資料來源與運算服務皆視為獨立資源**：無論其部署於地端機房、私有雲還是公有雲。
2. **通訊一律加密**：無論封包是穿越網際網路還是宿主機內部的虛擬網路介面，皆必須強制經過身分驗證與通訊加密。
3. **逐筆連線動態授權（Per-Session Access）**：單次存取的授權不代表能延續至下一筆請求，存取權限必須在建立每個工作階段時單獨評估。
4. **動態政策驅動**：存取決定不僅考量身分憑證，更結合工作負載狀態、環境風險等多維度屬性。

```
+-----------------------------------------------------------+
| 控制平面 (Control Plane)                                   |
|   +-----------------------------------------------------+ |
|   | 政策決策點 (PDP: Policy Decision Point)              | |
|   |   - 政策引擎 (Policy Engine): 評估身分、狀態與授權規則   | |
|   |   - 政策管理員 (Policy Administrator): 發布金鑰與憑證   | |
|   +-----------------------------------------------------+ |
+-----------------------------------------------------------+
                             │ 憑證簽發與授權政策下發
                             ▼
+-----------------------------------------------------------+
| 資料平面 (Data Plane)                                      |
|   [ 主體 / 服務 A ] ───> [ 政策執行點 PEP ]               |
|                           (Sidecar Proxy, Envoy)          |
|                                │                          |
|                                │ 雙向加密 mTLS 隧道       |
|                                ▼                          |
|                          [ 政策執行點 PEP ] ───> [ 資源 B ]|
+-----------------------------------------------------------+
```

- **政策決策點（Policy Decision Point, PDP）**：大腦中樞，負責決定特定身分是否有權存取特定資源，並向資料面發送短效憑證與授權清單。
- **政策執行點（Policy Enforcement Point, PEP）**：看門閘道（如 API Gateway 或 Service Mesh 中的 Sidecar 代理程式），負責攔截所有進出流量，強制執行身分比對與授權阻斷。

## 雙向 TLS（mTLS）協商與握手機制

一般大眾熟悉的 HTTPS 屬於**單向 TLS**：用戶端（瀏覽器）單向驗證伺服器憑證的真實性，伺服器則不在傳輸層驗證用戶端身分，轉由應用層的帳號密碼或 Session 辨識。
而在服務間的零信任架構中，通訊雙方皆是程式。**雙向 TLS（mTLS）** 要求**伺服器與用戶端在握手階段同時出示並嚴格驗證彼此的數位憑證**。

### TLS 1.3 mTLS 交握流程

在 TLS 1.3（RFC 8446）中，mTLS 的握手流程高度精簡且所有憑證資訊皆受加密保護：

```
Client                                                   Server
  │                                                        │
  │─── ClientHello (金鑰共用參數, 支援密碼套件) ─────────────>│
  │                                                        │
  │<── ServerHello (金鑰共用確認) ───────────────────────────│
  │<── {EncryptedExtensions} ──────────────────────────────│
  │<── {CertificateRequest} (關鍵: 伺服器要求客戶端提供憑證) ──│
  │<── {Certificate} (伺服器憑證鏈) ────────────────────────│
  │<── {CertificateVerify} (伺服器私鑰簽名) ─────────────────│
  │<── {Finished} ─────────────────────────────────────────│
  │                                                        │
  │ (驗證伺服器憑證鏈與簽名)                                  │
  │                                                        │
  │─── {Certificate} (關鍵: 客戶端出示自己的 X.509 憑證) ────>│
  │─── {CertificateVerify} (關鍵: 客戶端以自身私鑰對交握簽名) ─>│
  │─── {Finished} ────────────────────────────────────────>│
  │                                                        │
  │                    (驗證客戶端身分成功)                  │
  │<══════════════ 建立已相互認證的安全加密通道 ══════════════>│
```

1. **CertificateRequest**：伺服器向客戶端主動發出要求，列出其信任的根憑證授權單位（CA）特徵與支援的簽章演算法。
2. **Client Certificate**：客戶端回傳自身的 X.509 憑證鏈。
3. **Client CertificateVerify**：客戶端使用對應的私鑰，對截至目前為止所有的握手訊息雜湊值進行數位簽章。伺服器藉由客戶端憑證內的公鑰驗證該簽章，**確認客戶端確實持有該憑證對應的私鑰**，杜絕憑證偽冒。

## 工作負載身分標準：SPIFFE 與 SPIRE

在微服務與容器叢集中，Pod 會動態漂移、擴縮與重啟，傳統基於靜態 IP 或長效 API 密鑰的身分認證機制完全失效。雲原生運算基金會（CNCF）因此制定了 **SPIFFE** 標準。

### 1. SPIFFE ID 統一標識規範

**SPIFFE（Secure Production Identity Framework for Everyone）** 定義了跨組織、跨平台一致的工作負載身分 URI 命名格式：

$$\text{spiffe://<信任網域>/<路徑識別>}$$

範例：
- `spiffe://academy.local/ns/production/sa/payment-service`：明確指出所屬的信任網域、命名空間與服務帳號。

### 2. SVID（SPIFFE 可驗證身分文件）

工作負載用來向外界證明其持有該 SPIFFE ID 的數位文件稱為 **SVID（SPIFFE Verifiable Identity Document）**。最普遍的實體為標準的 **X.509 憑證**：
- 憑證的 **主體別名（Subject Alternative Name, SAN）** 欄位寫入對應的 `spiffe://...` URI。
- 通訊雙方在 mTLS 握手解析憑證時，直接提取 SAN 即可取得對端的真實程式身分。

### 3. SPIRE 運行時環境與無感自動輪替

**SPIRE（SPIFFE Runtime Environment）** 是 SPIFFE 的官方實作。節點上的 **SPIRE Agent** 透過 Linux 核心層特徵（檢查呼叫者的 Process ID、Linux cgroups、所屬 UID、或向本機 Docker/Containerd API 查證容器標籤）進行**工作負載認證（Workload Attestation）**：
- 通過認證後，SPIRE 自動簽發有效期限極短（如 1 小時）的 X.509 SVID 與私鑰。
- 在憑證即將到期前，Agent 自動在背景重新簽發新憑證，應用程式無須重啟，**從根源徹底消滅了長期靜態金鑰洩漏的風險**。

## 服務網格（Service Mesh）與 Sidecar 實作模式

為了讓開發團隊無須手動在每一種程式語言中撰寫複雜的 X.509 憑證解析與 TLS 握手邏輯，現代架構多採用 **服務網格（Service Mesh，如 Istio, Linkerd）**：

```
[ Pod A (訂單服務) ]                         [ Pod B (金流服務) ]
+---------------------+                     +---------------------+
| 業務程式 (Node.js)  |                     | 業務程式 (Go)       |
|   發送明文 HTTP 請求  |                     |   接收明文 HTTP 請求  |
|          │          |                     |          ▲          |
|          ▼          |                     |          │          |
| Envoy Sidecar Proxy |=== 雙向 mTLS 隧道 ==| Envoy Sidecar Proxy |
|   (負責 mTLS 加密)  |   (身分互相驗證)     |   (負責 mTLS 解密)  |
|                     |                     |   (執行 RBAC 政策檢查) |
+---------------------+                     +---------------------+
```

1. **透明攔截**：透過節點上的 `iptables` 規則或 eBPF 程式，容器內進出 Pod 的 TCP 流量被無感重新導向至同 Pod 內的 Envoy 代理（Sidecar）。
2. **自動連線升級**：業務程式之間依然撰寫標準的 HTTP/1.1 或 gRPC 呼叫，Envoy 自動將其包裝為帶有 SPIFFE SVID 的 mTLS 隧道送出。
3. **宣告式細粒度存取控制（AuthorizationPolicy）**：
   接收端的 Envoy 在完成 mTLS 握手後，將對端的 SPIFFE ID 與自定義安全政策進行比對：
   - 允許 `spiffe://.../sa/order-service` 透過 `POST /charges` 呼叫金流服務。
   - 若某個被入侵的日誌蒐集服務 `spiffe://.../sa/logging-agent` 試圖呼叫 `/charges`，即便其連線在同一個內網，Envoy 在 TLS 握手後即刻中斷連線，回傳 HTTP 403。

## 維運挑戰與工程實務權衡

| 挑戰領域 | 潛在事故與原理 | 最佳工程對策 |
| --- | --- | --- |
| **憑證過期與叢集雪崩** | 短效憑證（如 1 小時）若因簽發服務（CA）負載過高或網路中斷導致逾期未能更新，全叢集成千上萬個微服務連線會在同一秒集體中斷引發雪崩。 | **階層式快取與平滑寬限期**：節點 Agent 應在憑證剩餘 50% 壽命時提前非同步申請新憑證；並建立專屬的健全度指標監控與過期前警報。 |
| **中繼代理的身分遺失** | 當請求經過內部 L7 負載平衡器、API Gateway 或 WAF 終止 TLS 時，後端服務僅能看見代理伺服器的連線，原始客戶端憑證遺失（Identity Stripping）。 | **安全轉傳標頭**：前置代理在驗證客戶端後，將驗證過的憑證指紋或 SPIFFE ID 填入標準標頭（如 Envoy `X-Forwarded-Client-Cert`, XFCC），且後端必須嚴格配置只信任該內部前置代理，防範外部偽造注入。 |
| **CPU 運算開銷** | 頻繁的 TLS 1.3 握手（特別是 RSA / ECDSA 簽名與驗證運算）在每秒數十萬高併發情境下會大幅佔用 CPU 週期。 | **連線池化與 Session Resumption**：Sidecar 之間應維持長連線池（Connection Pool），避免短連線重複握手；硬體層啟用具備 AES-NI 與晶片加解密指令集的現代處理器。 |
| **混合環境的過渡困境** | 既有舊式系統不支援 mTLS，若一刀切強制啟用會導致舊系統無法連線。 | **縱深防禦與寬容模式（Permissive Mode）**：服務網格初期配置為 Permissive 模式，同時接受明文與 mTLS 流量；透過日誌審計確認所有流量皆已升級為 mTLS 後，再強制切換為 Strict 模式。 |

## 相關主題與參考來源

- [TLS 傳輸層安全：交握協商、密鑰交換與安全通道](tls-and-secure-transport.md)：深入理解對稱加密、非對稱簽章與 TLS 1.3 密鑰推導機制。
- [負載平衡與反向代理：L4、L7 與流量調度](load-balancing-and-reverse-proxy.md)：理解 TLS 卸載（TLS Termination）與反向代理對傳輸鏈路身分邊界的影響。
- [信任邊界與威脅思考](../web-security/trust-boundaries.md)：理解網路傳輸跨越信任區域時的核心威脅與防禦思維。
- [身分驗證與授權原則](../api/authentication-and-authorization.md)：理解身分識別（Authentication）與權限授權（Authorization）在介面設計中的分工。
- [NIST SP 800-207 - Zero Trust Architecture](https://csrc.nist.gov/publications/detail/sp/800-207/final)：美國國家標準暨技術研究院零信任架構官方規範。
- [RFC 8446 - The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446.html)：TLS 1.3 官方標準（含 CertificateRequest 與 CertificateVerify 規範）。
- [SPIFFE Standards](https://spiffe.io/)：雲原生運算基金會（CNCF）SPIFFE / SPIRE 工作負載身分標準。
