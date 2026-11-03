# 負載平衡與反向代理：L4、L7 與流量調度

當單一伺服器的計算能力、連線數或頻寬達到實體上限時，現代系統必須仰賴負載平衡器與反向代理將外部流量智慧分散至多台後端實體，實現水平擴充與高可用性。
在網路通訊堆疊中，調度流量的層級（第四層傳輸層或第七層應用層）深刻決定了轉發吞吐量、協定可見度以及系統架構的複雜度。

本文接續[TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)與[HTTP 演進：從 HTTP/1.1、HTTP/2 到 HTTP/3 (QUIC)](http-evolution-and-quic.md)，並與雲端架構[Elastic Load Balancing 與 CloudFront](../aws/load-balancing-and-cloudfront.md)對照。

## 正向代理與反向代理的核心分工

在探討負載平衡前，必須先釐清代理（Proxy）在網路拓撲中的角色方向：

```
正向代理 (Forward Proxy):
[用戶端 A, B, C] ---> [正向代理] ---> (網際網路) ---> [外部伺服器]
                     (代表用戶端發起請求)

反向代理 (Reverse Proxy):
(網際網路用戶) ---> [反向代理 / 負載平衡] ---> [後端主機 1, 2, 3]
                   (代表伺服器叢集接收請求)
```

- **正向代理（Forward Proxy）**：位於用戶端前方，代表用戶端向外部伺服器發送請求。常見於企業內部內網管制、出境稽核（Egress Inspection）、快取加速或隱藏真實客戶端 IP。
- **反向代理（Reverse Proxy）**：位於後端伺服器前方，代表整個伺服器叢集接收外部請求。對外暴露出單一公開 IP 或網域名稱，負責對內安全屏障、隱藏後端拓撲、TLS 終止、靜態檔案快取與流量負載分配。

## 第四層（L4）負載平衡：傳輸層轉發

第四層負載平衡運作在 OSI 模型的傳輸層（TCP/UDP），僅依據封包中的**來源 IP、來源 Port、目的 IP、目的 Port（四元組）**做出路由決策，完全不拆解也不理解上層應用程式協定（如 HTTP 標頭或 URL）。

### 1. 常見轉發模式

1. **NAT 模式（Network Address Translation）**：負載平衡器接收外部請求後，將目的 IP 修改為後端某台私有主機 IP，並將回應封包的來源 IP 改回負載平衡器 IP。進出雙向流量皆必須經過平衡器，容易成為吞吐瓶頸。
2. **DSR 模式（Direct Server Return，直接伺服器回傳）**：負載平衡器僅修改第二層 MAC 位址或使用 IP 通道（IP-in-IP），將請求轉發至後端伺服器；後端伺服器在自身 Loopback 介面上綁定相同的 VIP（虛擬 IP），**直接將龐大的回應流量走一般網關回傳給用戶端**，繞過負載平衡器。此模式極度適合高吞吐下載與影音串流場景。

### 2. 優點與限制

- **優勢**：極致的高吞吐量與超低轉發延遲。因不需解析應用層內容與終止 TLS，單一 L4 設備（如 Linux IPVS/LVS、AWS NLB）往往能支撐數百萬級的每秒連線併發。
- **限制**：缺乏內容感知能力。無法依據 HTTP 請求路徑（`/api` vs `/static`）、HTTP 方法、Host 名稱或 Cookie 做出細緻路由；也無法在轉發時進行標頭修剪或 TLS 卸載。

## 第七層（L7）負載平衡：應用層代理

第七層負載平衡運作在應用層（主要為 HTTP/HTTPS、gRPC、WebSockets）。它作為完整的反向代理，**同時扮演伺服器端與客戶端**：它與外部用戶端完整建立一條 TCP/TLS 連線，完整解析 HTTP 請求內容後，再向後端伺服器建立或復用另一條獨立的內部 TCP 連線。

```
Client <=== TLS + HTTP/2 ===> [ L7 Load Balancer ] <--- HTTP/1.1 (Keep-Alive) ---> [ Backend Pods ]
                              * 終止 TLS / 卸載密碼運算
                              * 檢查路徑 / 標頭 / 認證
                              * 連線池化 (Connection Pooling)
```

### 核心能力與取捨

- **智慧內容路由（Content-Based Routing）**：可根據 URL 路徑（`/users` 導向服務 A、`/payments` 導向服務 B）、HTTP 標頭（如 `Authorization`）、網域名稱（Virtual Hosts）或客戶端裝置類型轉發。
- **TLS 卸載與連線池化（TLS Offloading & Pooling）**：在邊界集中完成耗費 CPU 的 TLS 握手與加解密；後端伺服器只需處理明文通訊。同時利用 HTTP Keep-Alive 連線池復用對後端的長連線，免去後端主機頻繁建立 TCP 握手的系統負載。
- **安全性與防護**：整合 Web 應用防火牆（WAF）、速率限制（Rate Limiting）、Gzip/Brotli 動態壓縮與 CORS 標頭注入。
- **開銷權衡**：需要剖析文字與二進位標頭，記憶體與 CPU 消耗較高，連線併發上限低於 L4。

## 流量調度演算法（Scheduling Algorithms）

負載平衡器如何決定下一個請求派發至哪一台後端主機？常見策略包括：

1. **輪詢（Round Robin）與加權輪詢（Weighted Round Robin）**：依序輪流分配請求。若後端主機硬體規格不一，可指派權重，讓效能較強的實體承受較高比例的流量。
2. **最少連線數（Least Connections）**：將新請求導向目前活躍連線數（Active Connections）最少的伺服器。適合處理耗時差異極大的請求（如長連線 WebSocket 或耗時運算報表）。
3. **來源 IP 雜湊（Source IP Hash）**：將用戶端的 IP 位址進行 Hash 運算，確保同一用戶端的請求始終落在同一台後端主機。
4. **一致性雜湊（Consistent Hashing）**：在後端主機動態擴充或縮減時，僅有極少數的鍵需要重新映射，特別適合分散式快取節點（如 Redis / Memcached）或具備本機快取的微服務代理。

## 連線保持（Session Affinity）與健康檢查

### 1. 連線保持的權衡與代價

在未將 Session 完全外部化（如抽離至 Redis）的有狀態應用中，負載平衡器常需提供**黏性會話（Sticky Sessions）**：
- 通常透過在回應中注入專屬的 Cookie（如 `AWSALB`），後續請求攜帶該 Cookie 即綁定回同一後端實體。
- **架構代價**：破壞了嚴格的負載均衡性，可能造成某些主機負載過熱（Hotspots）；當綁定的主機當機時，該批用戶的 Session 仍會被迫中斷。現代分散式架構強烈建議將狀態外置，維持後端服務無狀態化。

### 2. 健康檢查機制（Health Checks）

負載平衡器必須即時隔離故障節點，避免向已死去的伺服器轉送流量：
- **主動探測（Active Probing）**：負載平衡器定期（如每 5 秒）向所有後端發送 HTTP 請求（如 `GET /healthz`）。
- **閥值防抖（Flapping Prevention）**：為避免網路偶發延遲造成主機狀態頻繁上線下線，通常設定「連續 3 次探測失敗才標記為 Unhealthy」，並要求「連續 2 次探測成功才恢復轉發」。
- **被動觀察（Passive Observation）**：若與後端通訊在轉發實際使用者流量時回傳 `502 Bad Gateway` 或 TCP 連線拒絕（RST），立即計數並動態熔斷。

## 現代多層式負載平衡架構

大型網際網路服務通常不會在 L4 與 L7 之間二選一，而是採行**分層組合（Layered Load Balancing）**：

1. **第一層（DNS / Anycast BGP）**：跨地域調度，將用戶就近引流至最近的資料中心邊界。
2. **第二層（L4 負載平衡器）**：以高效能硬體或核心層虛擬化（如 AWS NLB、LVS、Maglev）處理公網 IP 與 TCP 流量分散，提供數百萬連線吞吐防禦。
3. **第三層（L7 反向代理與 API 網關）**：接收來自 L4 的流量，進行 TLS 卸載、路由細分、微服務服務探索與 WAF 過濾，再轉發至後端容器或 Pod。

## 相關主題與參考來源

- [TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)：理解 L4 負載平衡在 TCP 連線建立時的封包攔截與轉送。
- [HTTP 演進：從 HTTP/1.1、HTTP/2 到 HTTP/3 (QUIC)](http-evolution-and-quic.md)：理解反向代理如何提供連線池化與版本轉換支援。
- [TLS 傳輸層安全：交握協商、密鑰交換與安全通道](tls-and-secure-transport.md)：深入探討反向代理上的 TLS 終止（Termination）原理。
- [Elastic Load Balancing 與 CloudFront](../aws/load-balancing-and-cloudfront.md)：雲端環境中 ALB、NLB 與 CDN 的實際服務對應。
- [RFC 2663 - IP Network Address Translator (NAT) Terminology and Considerations](https://www.rfc-editor.org/rfc/rfc2663.html)：定義 L4 NAT 轉發的網路位址轉換基礎。
