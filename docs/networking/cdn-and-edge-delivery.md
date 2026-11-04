# CDN 內容傳遞網路與邊緣運算架構

當全球使用者嘗試連線至位於單一中心資料中心的網站或 API 時，受限於光纖物理傳播速度，跨洋的往返延遲（RTT）動輒高達 150 至 300 毫秒；再加上 TCP 三方交握與 TLS 密鑰協商，首次連線需消耗數個 RTT，嚴重影響載入效能。此外，中心伺服器亦容易遭遇突發流量高峰或分散式阻斷服務（DDoS）攻擊。

**內容傳遞網路（Content Delivery Network, CDN）** 透過在全球各主要城市邊緣部署大量的節點（Point of Presence, PoP），將靜態內容快取於離使用者最近的實體位置，並透過連線池化與最佳化路徑加速動態請求，是現代網際網路高可用與低延遲架構的核心骨幹。

本文接續[DNS 網域名稱解析系統](dns-resolution-and-records.md)、[HTTP 演進：從 HTTP/1.1、HTTP/2 到 HTTP/3 (QUIC)](http-evolution-and-quic.md)、[BGP 自治系統、跨域路由與 Anycast 架構](bgp-and-autonomous-systems.md)與[負載平衡與反向代理：L4、L7 與流量調度](load-balancing-and-reverse-proxy.md)，並與應用層[資源、表示與訊息](../api/resources-representations-and-messages.md)相互對照。

## CDN 核心架構與階層式快取拓撲

CDN 並非單純的一對一反向代理，而是由遍布全球的邊緣節點與區域中心節點構成的**階層式拓撲（Tiered Caching）**：

```
[ 使用者 A ] ──> [ 邊緣節點 L1 (Edge PoP) ] ──┐
                                             │
[ 使用者 B ] ──> [ 邊緣節點 L1 (Edge PoP) ] ──┼──> [ 區域防護中心 L2 ] ──> [ 來源伺服器 ]
                                             │    (Origin Shield)     (Origin Server)
[ 使用者 C ] ──> [ 邊緣節點 L1 (Edge PoP) ] ──┘
```

1. **邊緣節點（Edge PoP / L1 快取）**：部署於靠近使用者的各大都會區與網際網路交換中心（IXP）。配備高速記憶體與 NVMe SSD 快取伺服器，負責處理絕大多數使用者的讀取命中。
2. **區域防護中心（Origin Shield / Regional Edge Cache / L2 快取）**：當全球數百個 Edge PoP 發生快取未命中（Cache Miss）時，若所有節點同時直接向來源伺服器發起請求，將引發嚴重的**驚群效應（Thundering Herd / Cache Stampede）**導致後端崩潰。Origin Shield 作為中繼樞紐，將來自多個邊緣節點的未命中請求進行**請求合併（Request Collapsing）**，僅由單一連線向來源伺服器回源拉取資料，隨後廣播至各邊緣節點。
3. **來源伺服器（Origin Server）**：企業的核心資料庫、物件儲存（如 AWS S3）或應用程式服務，保留資料的最終權威版本。

## 邊緣流量調度策略：Anycast BGP vs GeoDNS

如何確保全球使用者發送請求時，能自動被導流至「離他最近、網路狀況最好」的 CDN 邊緣節點？業界主要有兩種調度架構：

```
Anycast BGP 架構:
  全球所有 PoP 宣告相同 IP ──> 網際網路路由器依 BGP Path Vector 自發就近收斂

GeoDNS 架構:
  客戶端查詢 DNS ──> 權威 DNS 辨識客戶端來源 IP (或 EDNS Client Subnet)
                ──> 回傳該地理區域專屬的單播 IP (Unicast A/AAAA 記錄)
```

| 比較維度 | Anycast BGP 路由調度 | GeoDNS 地理名稱調度 |
| --- | --- | --- |
| **調度機制** | 運行於第三層（L3/BGP），全球 PoP 共享相同 IP，由 ISP 路由器自動計算最短路徑。 | 運行於應用層（DNS），權威伺服器依據查詢來源 IP 所在地理座標動態回應不同的 IP。 |
| **容災收斂速度** | **極快（數十秒以內）**：單一 PoP 故障時，撤回 BGP 宣告，全球路由自動秒級收斂至備用 PoP。 | **較慢（受限於 DNS TTL）**：即便將 TTL 縮短至 30 秒，仍有部分遞迴 DNS 快取不遵守標準而延遲切換。 |
| **覆蓋精準度** | 依賴網際網路自治系統（AS）商業路徑，有時電信商間繞路可能導致連線非地理最短。 | 若支援 **EDNS Client Subnet（RFC 7871）** 可極精確識別用戶所在城市與電信業者。 |
| **DDoS 吸收能力** | **極高**：攻擊封包被全球各地路由自然打散吸收，難以集中癱瘓單一目標。 | 易遭受 DNS 洪水攻擊或針對特定單播 IP 發起集中衝擊。 |
| **代表服務商** | Cloudflare, Google Cloud CDN, Fastly | AWS CloudFront (Route 53 輔助), Akamai (混合式架構) |

## HTTP 快取語意與快取控制（RFC 9111）

CDN 快取的核心決策建立在標準的 HTTP 標頭語意之上。

### 1. 關鍵快取控制標頭

- **`Cache-Control: public, max-age=3600, s-maxage=86400`**：
  - `public`：允許任何中間代理（包括 CDN 共享快取）保存回應。
  - `max-age=3600`：告訴終端瀏覽器本地快取有效期間為 1 小時（3,600 秒）。
  - `s-maxage=86400`（Shared Max-Age）：專門覆寫 CDN 等共享快取的過期時間，指示 CDN 節點可保存 24 小時。
- **`stale-while-revalidate=<seconds>`**：
  極致效能的最佳實踐。當快取資料已超過 `s-maxage` 時，在後續指定秒數內，CDN 節點**先立即回傳快取的舊資料（Stale Data）給使用者**，同時在背景非同步向來源伺服器發起回源驗證。使用者獲得零等待的即時回應，資料又能在背景平滑更新。
- **`stale-if-error=<seconds>`**：
  高可用容災機制。當來源伺服器遭遇宕機或回傳 HTTP 500、502、504 時，CDN 自動降級回傳過期快取給使用者，維持對外服務不中斷。

### 2. 條件請求與驗證標頭

當快取過期且必須重新驗證時，CDN 透過條件標頭避免傳輸重複酬載：
- **`ETag`**（實體標籤）與 **`If-None-Match`**：以內容雜湊值為依據。
- **`Last-Modified`** 與 **`If-Modified-Since`**：以最後修改時間為依據。
若來源內容未變更，來源伺服器僅回傳 **`HTTP 304 Not Modified`** 且不含 Message Body，大幅節省回源頻寬。

### 3. 快取鍵（Cache Key）與快取清除（Cache Purge）

- **快取鍵（Cache Key）計算**：
  CDN 判定一筆快取是否命中的雜湊索引。預設通常由 `HTTP Method + Host + Path + Query String` 組成。若 API 具備多語系或壓縮版本，必須透過 **`Vary: Accept-Encoding, Accept-Language`** 標頭指示 CDN 將特定請求標頭納入 Cache Key，防範向不支援 gzip 的客戶端回傳壓縮內容。
- **主動清除快取（Cache Purge / Invalidation）**：
  當業務資料更新時，不能被動等待 TTL 自然過期，需主動調用 CDN API 清除快取：
  - **URL Purge**：精確清除特定網址路徑，速度最快。
  - **標籤式清除（Surrogate-Keys / Cache-Tags）**：伺服器在回應中標註 `Surrogate-Key: product-123 category-shoes`。當某雙鞋子價格變動時，可一次性發布 Tag Purge，瞬時使全站包含該商品的所有不同頁面快取同步失效。

## 動態請求加速原理

對於無法被快取的個人化資料（如使用者個人主頁、即時下單、動態搜尋 API），CDN 如何發揮加速作用？

```
無 CDN 直連:
  用戶端 ══════════════ 跨洋高延遲公網 (TCP 握手 + TLS 握手 + API 傳輸) ══════════════> 來源機房
        (光纖 RTT 200ms x 3 = 600ms 連線建立時延)

經 CDN 動態加速:
  用戶端 ══ 短距低延遲 ══> [ 邊緣 PoP ] ════════ 長連線池化 / 專屬優化骨幹 ════════> 來源機房
       (RTT 5ms 就近握手)            (預先建立 TCP/TLS 長連線，0 RTT 即時轉發)
```

1. **邊緣連線終止（Edge Connection Termination）**：
   使用者只需就近與實體距離幾十公里內的 Edge PoP 進行 TCP 三方交握與 TLS 握手（RTT 僅 5~10ms），以極短時間完成連線建立並開始發送 HTTP 請求。
2. **長連線池化（Connection Pooling）**：
   Edge PoP 與遠端的 Origin 伺服器之間，在背景長期維持多條**已經建立好的 TCP / TLS 長連線池**。當動態請求到達 PoP 時，無須重新走跨洋握手流程，直接藉由既有長連線向來源轉發，節省至少 2~3 個跨洋 RTT 的寶貴時間。
3. **專屬優化骨幹網路與智慧路由**：
   大型 CDN 業者（如 Cloudflare, AWS, Fastly）擁有私有跨國專屬光纖骨幹，能避開公網網際網路的 BGP 路由跳數與壅塞節點；並在骨幹通道採用先進的 TCP 壅塞控制演算法（如 Google BBR），有效消弭封包丟失引發的重傳抖動。

## 現代演進：邊緣運算（Edge Computing）

現代 CDN 已從早期的「靜態檔案快取通道」演化為「全球分散式邊緣運算平台」：
- **運算模型**：多數基於輕量級的 **V8 Isolate（如 Cloudflare Workers, Fastly Compute, AWS CloudFront Functions）**，啟動時間僅需數毫秒（比傳統容器冷啟動快上千倍），記憶體開銷極低。
- **邊緣執行業務邏輯**：
  - **A/B 測試與金絲雀發布**：在邊緣依據 Cookie 或權重動態重寫後端目標路由。
  - **身分驗證與授權**：在邊緣節點直接解析並驗證 JWT 數位簽章，未授權請求直接在邊緣被拒絕，無須打擾後端資料庫。
  - **Web 應用防火牆與機器人防禦（WAF & Bot Management）**：在邊緣分析客戶端 TLS 指紋、IP 信譽並實施速率限制（Rate Limiting）。

## 相關主題與參考來源

- [DNS 網域名稱解析系統](dns-resolution-and-records.md)：理解 GeoDNS 與階層式解析在 CDN 流量引導中的運作機制。
- [HTTP 演進：從 HTTP/1.1、HTTP/2 到 HTTP/3 (QUIC)](http-evolution-and-quic.md)：理解邊緣節點如何終止連線並轉換 HTTP/2 與 HTTP/3 協定。
- [BGP 自治系統、跨域路由與 Anycast 架構](bgp-and-autonomous-systems.md)：深入掌握 BGP Anycast 技術如何實現邊緣節點的就近收斂與分散式抗 DDoS。
- [負載平衡與反向代理：L4、L7 與流量調度](load-balancing-and-reverse-proxy.md)：理解反向代理的連線池化、TLS 卸載與健康檢查機制。
- [資源、表示與訊息](../api/resources-representations-and-messages.md)：理解應用層 REST 資源識別與表示在快取鍵設計中的對應關係。
- [RFC 9111 - HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)：IETF 官方 HTTP 快取標準規範。
- [RFC 7871 - Client Subnet in DNS Queries](https://www.rfc-editor.org/rfc/rfc7871.html)：EDNS Client Subnet（ECS）精準地理位置解析標準。
