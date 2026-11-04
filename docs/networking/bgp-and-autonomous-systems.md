# BGP 自治系統、跨域路由與 Anycast 架構

網際網路並非單一扁平的龐大網路，而是由全球數萬個獨立管理的**自治系統（Autonomous System, AS）**網狀互連而成。
在單一組織內部，網路可仰賴 OSPF 或 IS-IS 等內部閘道協定（IGP）依據鏈路頻寬計算最短路徑；但跨越不同電信商、雲端服務商與國家邊界的跨域路由，則完全由**邊界閘道協定（Border Gateway Protocol, BGP-4）**主導。

本文接續[路由、轉送與封包生命週期](routing-and-packet-forwarding.md)與[IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)，並與[DNS 網域名稱解析系統](dns-resolution-and-records.md)及[負載平衡與反向代理：L4、L7 與流量調度](load-balancing-and-reverse-proxy.md)相互對照。

## 自治系統（AS）與網際網路商業模型

一個自治系統（AS）是由單一技術實體或組織（如網際網路服務供應商 ISP、雲端巨頭、跨國企業）擁有並具備統一路由政策的網路集合。

### 1. 自治系統編號（ASN）

全球 AS 由網際網路號碼指派局（IANA）及其下轄的五大區域網際網路註冊機構（RIR，如 APNIC、ARIN、RIPE NCC）分配唯一的**自治系統編號（Autonomous System Number, ASN）**：
- **16 位元 ASN**：早期規格（1 ~ 65535），其中 64512 ~ 65534 保留為私有 ASN（類似私有 IP 網段）。
- **32 位元擴充 ASN（RFC 6793）**：因應全球網路擴張，ASN 擴展至 32 位元（最高 4,294,967,295），使網際網路得以容納數十萬個獨立自治系統。

### 2. 互連模式：Transit 與 Peering

跨 AS 之間的實體互連與流量交換主要遵循兩種商業模式：
- **傳輸轉送（IP Transit）**：小型網路向大型第一層（Tier 1）或第二層（Tier 2）電信業者付費購買頻寬服務，由上游業者負責將封包轉送至全球其餘所有網路。
- **對等互連（Peering）**：兩個網路在網際網路交換中心（Internet Exchange Point, IXP）或機房私下對接（Private Peering），雙方通常不收費，僅免費交換彼此及其下游客戶的雙向流量，大幅降低傳輸成本並減少繞經第三方的延遲。

## eBGP 與 iBGP 的分工

BGP 運行於 TCP 之上（預設目的地連接埠為 TCP 179），具備連線導向的可靠性，並分為外部與內部兩種運作模式：

```
[ AS 100 ]                          [ AS 200 ]
+--------------+                   +--------------+
| Router A     |=== eBGP (TCP 179) ===| Router C     |
|              |                   |              |
|  iBGP (全網狀)|                   |              |
|              |                   |              |
| Router B     |                   | Router D     |
+--------------+                   +--------------+
```

### 1. 外部 BGP（eBGP）

- **定義**：運行於**不同 AS** 邊界路由器之間的 BGP 連線。
- **特性**：預設要求兩台路由器直連（IP TTL 預設為 1，多跳連線需啟用 eBGP Multihop）；宣告路由時，會在路徑屬性中附加自身的 ASN，並嚴格套用對外出口政策（Export Policies）。

### 2. 內部 BGP（iBGP）

- **定義**：運行於**同一個 AS 內部**路由器之間的 BGP 連線。
- **防環機制與水平分割**：為防止同 AS 內產生轉發環路，iBGP 嚴格規定「**從一個 iBGP 鄰居學到的路由，絕對不可再宣告給另一個 iBGP 鄰居**」（iBGP Split Horizon）。
- **解決全網狀（Full Mesh）開銷**：
  若 AS 內部有 $N$ 台路由器，全網狀連線需要 $\frac{N(N-1)}{2}$ 條 TCP 連線。大型網路會透過**路由反射器（Route Reflector, RR，RFC 4456）**或 BGP 聯盟（BGP Confederation）打破全網狀限制，由 RR 集中轉發特定客戶端路由。
- **下一跳策略（Next Hop Self）**：當邊界路由器 A 將從外部 eBGP 學到的路由傳播至內部 iBGP 鄰居時，若未重設 Next Hop 屬性，內部路由器可能無法路由抵達外部 IP。因此邊界路由器通常設定 `next-hop-self`，將下一跳改寫為自己內部的 Loopback 介面位址。

## BGP 路徑向量與最佳路徑決策鏈

與 OSPF 的鏈路狀態（Link-State）不同，BGP 是**路徑向量（Path Vector）**協定。全球核心路由表（Global Routing Table）超過百萬條前置碼，若頻繁同步鏈路狀態將導致路由器運算崩潰；因此 BGP 傳播的是「前置碼（Prefix）＋ 途經的所有自治系統清單（AS-Path）」。

### 關鍵路由屬性

1. **AS-Path（RFC 4271）**：記錄封包抵達目標網段所需依序穿過的 ASN 序列。若路由器收到的宣告中包含自身的 ASN，便判定存在環路並立即拒絕吸收該路由。
2. **Next-Hop**：抵達該網段的下一個 IP 躍點。
3. **Local Preference（LOCAL_PREF）**：AS 內部屬性，僅在 iBGP 傳播。值越高代表 AS 內部優先選擇該出口路由器離開本網路。
4. **MED（Multi-Exit Discriminator）**：告知相鄰外部 AS 應從本網路的多個入口中優先選擇哪一個進入，數值越小越優先。
5. **Community（RFC 1997）**：附加在路由上的標籤，用於大規模自動化觸發過濾規則或調整出口權重。

### BGP 最佳路徑選擇演算法（Best Path Selection）

當路由器針對同一個 IP 前置碼收到多條有效候選路由時，會依序進行嚴格的屬性比對，選出唯一的最佳路由（Best Route）寫入轉發資訊庫（FIB）：

1. **最高權重（Weight）**：本地私有屬性（如 Cisco 專屬，僅在本機生效，不對外傳遞）。
2. **最高 Local Preference**：同 AS 內部共同認可的最佳出口偏好。
3. **本地起源優先**：本地透過 `network` 或重分發產生的路由優於從 BGP 學來的路由。
4. **最短 AS-Path 長度**：途經的最少 AS 數量。
5. **最低 Origin 類型**：IGP < EGP < Incomplete。
6. **最低 MED**：在來自同一個外部 AS 的多條連線中選擇最小者。
7. **eBGP 優於 iBGP**：外部直接學到的路徑優先於內部轉播路徑。
8. **抵達 Next-Hop 的內部 IGP Cost 最低**：就近從最近的內部邊界送出（Hot Potato Routing）。
9. **最穩定連線 / 最低 BGP Router ID**：破除平手情況的最終決定條件。

## BGP Anycast（任播）與全球負載分流

傳統網路多採**單播（Unicast）**模式，全球僅有一台主機擁有特定公開 IP 位址。而 **BGP Anycast（任播，RFC 4786）** 徹底顛覆了這個限制：

```
[ 美國用戶 ] ────> (網際網路) ────> [ 美西 PoP ] (宣告 198.51.100.1)
                                      ▲
                                      │ 共享相同 IP
[ 亞洲用戶 ] ────> (網際網路) ────> [ 東京 PoP ] (宣告 198.51.100.1)
```

### 1. Anycast 運作機制

- **多點相同宣告**：全球分散於各地的節點（Point of Presence, PoP）同時在本地 eBGP 向各上游電信商宣告**完全相同的 IP 前置碼（如 `198.51.100.0/24`）**。
- **拓撲就近收斂**：全球各地的網際網路路由器依照各自的 BGP 最佳路徑演算法，自動將封包引導向網路跳數最少、延遲最低的 Anycast 節點。

### 2. Anycast 的工程優勢

1. **極致低延遲**：使用者自動連線至拓撲距離最近的邊緣伺服器，縮短光纖傳播物理時延。
2. **天然的 DDoS 吸收能力**：當分散式拒絕服務攻擊發起時，攻擊流量會被各地的網際網路路由自然打散並導向各區域 PoP 吸收，避免所有流量集中癱瘓單一機房。
3. **無感知自動容災**：若東京 PoP 遭遇電力中斷或維護，東京邊界路由器停止發送 BGP 宣告（BGP Withdraw），全球路由在數十秒內重新收斂，亞洲使用者的封包將自動無縫改道至新加坡或美西 PoP。

### 3. Anycast 應用於長連線的挑戰

Anycast 在無狀態的 UDP 協定（如 DNS 根伺服器、Cloudflare 1.1.1.1、Google 8.8.8.8）運作極為完美。
然而，在 TCP 傳輸中，若網際網路發生動態路由震盪（Route Flapping），使用者的 TCP 握手封包可能送達東京 PoP，而後續的 `ACK` 封包卻被導向新加坡 PoP。後者因記憶體中缺乏該 TCP 連線控制區塊（TCB），會直接回傳 `RST` 導致連線中斷。
現代 CDN 與雲端業者解決此問題的方式包括：
- 在所有 Anycast PoP 之間建立專屬內部 Overlay 隧道，透過統一的雜湊追蹤轉發非本地 TCP 封包。
- 採用具備連線漫遊（Connection ID）特性的 QUIC（HTTP/3）取代傳統綁定 IP 四元組的 TCP。

## 網際網路路由安全與防禦

BGP-4 誕生於信任網路時代，協定本身缺乏對路由宣告真實性的驗證機制，導致網際網路長期面臨嚴重的安全隱患。

### 1. 常見路由威脅

- **BGP 路由劫持（BGP Hijacking）**：攻擊者偽造 BGP 宣告，向其上游聲稱自己擁有某個不屬於自己的 IP 網段。由於 BGP 優先採納「更具體的前置碼（Longest Prefix Match）」，若攻擊者宣告 `/24` 而正牌擁有者宣告 `/20`，全球流量將會被強行引流至攻擊者節點，造成機密竊聽或服務中斷。
- **路由洩漏（Route Leak）**：多宿主（Multi-homed）客戶端因配置疏失，誤將從上游 ISP A 學到的路由又宣告給上游 ISP B，導致外部巨量傳輸流量誤穿越該客戶端的小頻寬線路，引發大規模擁塞。

### 2. RPKI 與路由來源驗證（ROV）

為徹底根除路由劫持，IETF 推出了**資源公鑰基礎設施（RPKI, RFC 6480）**：

```
+--------------------------------------------------------------+
| 區域註冊機構 (RIR) 簽發 X.509 憑證                                |
|   -> 建立 ROA 記錄: Prefix 198.51.100.0/24 僅允許 ASN 64500 宣告  |
+--------------------------------------------------------------+
                               │ RPKI 快取驗證伺服器
                               ▼ RTR 協定 (RFC 6810)
+--------------------------------------------------------------+
| 邊界路由器進行 Route Origin Validation (ROV)                     |
|   -> Valid: 允許並正常計算路由                                   |
|   -> Invalid: 來源 ASN 不符，直接丟棄拒絕寫入路由表                 |
+--------------------------------------------------------------+
```

1. **路由來源授權（Route Origin Authorization, ROA）**：IP 位址的合法持有人透過 RIR 密碼學私鑰簽發 ROA 記錄，明確定義該 IP 前置碼只允許由哪個特定 ASN 宣告，以及允許的最長前置碼長度（MaxLength）。
2. **路由來源驗證（Route Origin Validation, ROV，RFC 6811）**：BGP 路由器在收到 BGP Update 時，即時比對 RPKI 驗證庫：
   - **Valid（有效）**：宣告的 ASN 與前置碼長度與 ROA 吻合。
   - **Invalid（無效）**：前置碼已有 ROA，但宣告的 ASN 不符或超過 MaxLength。遵循資安規範的 ISP 會直接**拒絕並丟棄 Invalid 路由**，徹底封殺劫持行為。
   - **Not Found（未註冊）**：該網段尚未簽署 ROA，依傳統策略處理。

## 相關主題與參考來源

- [路由、轉送與封包生命週期](routing-and-packet-forwarding.md)：理解單一主機與區域網路的路由表查表、下一跳與轉發原理。
- [IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)：理解 CIDR 前置碼劃分與最長前置碼匹配規則。
- [DNS 網域名稱解析系統](dns-resolution-and-records.md)：理解全域 Anycast 如何成為根域名與公共 DNS 解析服務的基礎架構。
- [負載平衡與反向代理：L4、L7 與流量調度](load-balancing-and-reverse-proxy.md)：理解邊界路由器如何將流量自 BGP 遞送至四層與七層負載平衡器。
- [RFC 4271 - A Border Gateway Protocol 4 (BGP-4)](https://www.rfc-editor.org/rfc/rfc4271.html)：IETF BGP-4 標準協定規範。
- [RFC 4786 - Operation of Anycast Services](https://www.rfc-editor.org/rfc/rfc4786.html)：Anycast 服務架構與網際網路營運指引。
- [RFC 6480 - An Infrastructure to Support Secure Internet Routing](https://www.rfc-editor.org/rfc/rfc6480.html)：RPKI 安全路由架構規範。
- [RFC 6811 - BGP Prefix Origin Validation](https://www.rfc-editor.org/rfc/rfc6811.html)：BGP 路由來源驗證標準。
