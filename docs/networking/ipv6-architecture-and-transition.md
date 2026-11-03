# IPv6 架構與過渡機制：定址、鄰居探索與雙堆疊

網際網路通訊協定第 6 版（IPv6）是為徹底解決 IPv4 的 32 位元位址枯竭危機而設計的下一代網路層協定標準。
IPv6 不僅將位址長度大幅擴展至 128 位元，還重新設計了固定長度的簡化標頭結構、徹底淘汰了效率低下的廣播機制，並引入基於 ICMPv6 的鄰居探索協定（NDP）與無狀態自動設定（SLAAC）。理解 IPv6 的架構與雙堆疊過渡機制，是現代雲端網路、行動通訊與全球基礎設施不可或缺的技術儲備。

本文接續[IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)與[DNS 網域名稱解析系統](dns-resolution-and-records.md)，並與系統層級[網路基礎](../linux/networking-basics.md)及雲端[VPC 與資源連線](../aws/vpc-and-resource-connectivity.md)對照。

## 為什麼需要 IPv6：超越位址數量的架構革新

IPv4 的 32 位元位址空間理論上限僅約 43 億個，雖然 NAT 技術延緩了枯竭時程，但 NAT 破壞了端對端透明性（End-to-End Transparency）、增加了網路中繼設備的狀態負擔，且大幅增加了 P2P 通訊的複雜度。

IETF 於 RFC 8200 正式確立 IPv6 為網際網路核心標準，帶來了本質上的架構提升：

1. **極度龐大的定址空間（128 位元）**：提供約 $3.4 \times 10^{38}$ 個位址（即 $2^{128}$）。位址空間充裕到足以為地球上每一粒沙子分配獨立 IP，不再需要透過 NAT 共享公網 IP。
2. **固定 40 位元組的精簡基礎標頭（Fixed Base Header）**：IPv4 標頭長度可變（20~60 位元組）且包含繁瑣的檢查碼（Checksum）與分段欄位，路由器轉送時每一跳都必須重新計算檢查碼。IPv6 將基礎標頭固定為 40 位元組，移除標頭檢查碼，將特殊選項移至「擴充標頭（Extension Headers）」，使路由器硬體能以線速（Line Rate）高速並行處理轉送。
3. **徹底取消廣播（No More Broadcast）**：IPv4 頻繁發送廣播（如 ARP 請求），導致同網段內所有主機皆被中斷喚醒。IPv6 完全取消廣播，全面改採**多播（Multicast）**與**任播（Anycast）**，僅目標節點需要處理封包。
4. **原生路徑 MTU 規範（端點分段原則）**：IPv6 路由器**一律不在中間路徑上替封包進行分段（Fragmentation）**。若封包超過下一跳 MTU，路由器直接丟棄並回傳 ICMPv6 Packet Too Big 訊息，完全交由原始發送端自行縮減封包尺寸或在端點添加分段擴充標頭。

## IPv6 位址表示與常見範圍

IPv6 位址以 128 位元二進位組成，文字表示法採用 8 組以冒號 `:` 分隔的 16 進位數（每組 16 位元，4 個 16 進位字元）：
`2001:0db8:85a3:0000:0000:8a2e:0370:7334`

### 簡化書寫規則

1. **省略前導零**：每組內的開頭 `0` 可以省略，例如 `:0db8:` 簡寫為 `:db8:`、`:0000:` 簡寫為 `:0:`。
2. **雙冒號壓縮連續零（`::`）**：連續多組全為 0 的欄位，可用雙冒號 `::` 壓縮取代；**在整個位址中 `::` 嚴格只能出現一次**，以確保還原長度時不具歧義。
   上述位址簡寫為：`2001:db8:85a3::8a2e:370:7334`。
   本機回呼位址 `0:0:0:0:0:0:0:1` 簡寫為：`::1`。

### 核心位址類型與範疇

```
+---------------------------------+------------------------------------------+
| 位址類型                        | 前置碼範圍 (Prefix)                      | 特性與使用場景                           |
+---------------------------------+------------------------------------------+
| 全域單播位址 (GUA)              | 2000::/3                                 | 公網可路由位址，相當於 IPv4 的 Public IP |
| 鏈路本地位址 (Link-Local / LLA) | fe80::/10                                | 僅限同實體鏈路通訊，不可跨路由器路由     |
| 唯一本地位址 (ULA)              | fc00::/7                                 | 類似 IPv4 私有網段 (RFC 1918)，企業內網  |
| 多播位址 (Multicast)            | ff00::/8                                 | 一對多傳輸，取代所有廣播功能             |
| 回呼位址 (Loopback)             | ::1/128                                  | 本機端點 (相當於 127.0.0.1)              |
| 未指定位址 (Unspecified)        | ::/128                                   | 尚未配置位址時佔位 (相當於 0.0.0.0)      |
+---------------------------------+------------------------------------------+
```

特別需要注意的是**鏈路本地位址（Link-Local Address, LLA）**：任何啟用 IPv6 的網路介面，即使沒有連接外部網際網路或沒有 DHCP 伺服器，作業系統核心皆會自動在 `fe80::/10` 網段下為該網卡生成一個 LLA。LLA 是鄰居探索、路由器通告以及底層路由協定（如 OSPFv3）溝通的必要基礎。

## 鄰居探索協定（NDP）：取代 ARP 的現代機制

在 IPv4 中，主機透過廣播發送 ARP 請求來查詢 IP 對應的 MAC 位址。在 IPv6 中，這套機制被整合進**鄰居探索協定（NDP, Neighbor Discovery Protocol / RFC 4861）**，完全依託於 ICMPv6 與多播運作：

### 1. 鄰居請求與通告（NS / NA）：位址解析

- **鄰居請求（Neighbor Solicitation, NS / ICMPv6 Type 135）**：當主機想得知目標 IPv6 位址的 MAC 時，向目標位址對應的「請求節點多播位址（Solicited-Node Multicast Address）」發送 NS 封包。只有與目標末 24 位元相符的網卡硬體才會接收過濾，其他主機完全不受干擾。
- **鄰居通告（Neighbor Advertisement, NA / ICMPv6 Type 136）**：目標主機回傳包含自己 MAC 位址的 NA 封包。

### 2. 重複位址偵測（DAD, Duplicate Address Detection）

任何節點在正式將一個新的 IPv6 位址綁定至介面之前，**必須先執行 DAD 檢查**：
節點使用未指定位址 `::` 作為來源，發送查詢自己「即將啟用之 IP」的 NS 封包。若在逾時前收到任何主機回覆 NA，代表區域網路內已有人佔用該 IP，介面立即標記位址衝突並拒絕啟用，防止嚴重的 IP 碰撞事故。

## 位址自動設定：SLAAC 與 DHCPv6

IPv6 實現了真正的即插即用連網體驗：

1. **無狀態位址自動設定（SLAAC, RFC 4862）**：
   - 主機開機連上網路時，向全體路由器多播發送**路由器請求（Router Solicitation, RS）**。
   - 區域網路內的預設閘道回傳**路由器通告（Router Advertisement, RA）**，宣告目前網段的 64 位元網路前置碼（Subnet Prefix，如 `2001:db8:1:1::/64`）。
   - 主機取得前置碼後，自行加上後半段 64 位元的介面識別碼（Interface Identifier，早期使用網卡 MAC 轉換為 EUI-64，現代出於隱私考量採用隨機生成的臨時位址 RFC 8981），即可獨立組裝出全球唯一的 IPv6 位址，無需任何 DHCP 伺服器參與。
2. **有狀態與無狀態 DHCPv6（RFC 8415）**：
   - **無狀態 DHCPv6**：主機透過 SLAAC 取得 IP 與閘道，僅向 DHCPv6 查詢 DNS 伺服器位址與網域名稱搜尋清單（亦可由 RA 的 RDNSS 選項直接提供）。
   - **有狀態 DHCPv6**：由 DHCPv6 伺服器集中統一分配精確的 IP 位址與租約，適合嚴格資產管制的企業環境。

## IPv4 到 IPv6 的過渡與共存技術

網際網路架構龐大，不可能在特定時間點全面強制切換，雙方必須長期共存。主流過渡策略包含三大支柱：

### 1. 雙堆疊技術（Dual-Stack）與 Happy Eyeballs

雙堆疊是目前網際網路最主流且推薦的遷移方案：終端設備、作業系統與邊界伺服器同時具備 IPv4 與 IPv6 雙通訊堆疊，網卡同時綁定 IPv4 與 IPv6 位址。
- **Happy Eyeballs 演算法（RFC 8305）**：當使用者瀏覽器查詢網域名稱時，DNS 會同時回傳 IPv4（A 記錄）與 IPv6（AAAA 記錄）。瀏覽器會**同時並行發起 IPv6 與 IPv4 的 TCP 握手探測**（通常優先給予 IPv6 幾十毫秒的微幅優勢）。哪一個協定路徑先握手成功，瀏覽器就採用該路徑傳輸資料。這確保了即使使用者的 IPv6 本地線路存在配置故障或高延遲，使用者也不會感覺到任何載入卡頓。

### 2. 通道技術（Tunneling）

當兩端已經部署 IPv6，但中間傳輸骨幹仍只支援 IPv4 時，可將 IPv6 封包完整包裹在 IPv4 酬載中進行傳輸（如 6in4 或 VPN 通道），穿越 IPv4 網路後在另一側解開封裝。

### 3. 轉譯技術（Translation：NAT64 / DNS64）

在純 IPv6（IPv6-Only）的現代行動營運商網路中，用戶裝置完全沒有私有或公網 IPv4 位址。
- **DNS64**：當用戶想存取只支援 IPv4 的老舊網站時，DNS64 伺服器將對方的 IPv4 位址合成編碼為專屬的 IPv6 偽裝位址（通常在前綴 `64:ff9b::/96` 下）。
- **NAT64 閘道**：用戶向該合成 IPv6 發送請求，邊界 NAT64 閘道拆除 IPv6 標頭並轉譯為標準 IPv4 封包轉發至網際網路，達成跨版本互聯互通。

## 相關主題與參考來源

- [IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)：對比 IPv4 傳統分類與 CIDR 遮罩運算規則。
- [DNS 網域名稱解析系統](dns-resolution-and-records.md)：理解 A 記錄（IPv4）與 AAAA 記錄（IPv6）的雙向解析。
- [NAT 穿透與防火牆：網路位址轉換的類型與穿透技術](nat-and-firewall-traversal.md)：對照 IPv4 NAT 造成的端對端破壞與 IPv6 端對端直連願景。
- [Linux 網路基礎](../linux/networking-basics.md)：Linux 系統下觀察與配置 IPv6 介面的實務命令。
- [RFC 8200 - Internet Protocol, Version 6 (IPv6) Specification](https://www.rfc-editor.org/rfc/rfc8200.html)：IETF IPv6 協定核心現行標準。
- [RFC 4291 - IP Version 6 Addressing Architecture](https://www.rfc-editor.org/rfc/rfc4291.html)：IPv6 定址架構與範疇規範。
- [RFC 4861 - Neighbor Discovery for IP version 6 (IPv6)](https://www.rfc-editor.org/rfc/rfc4861.html)：IPv6 鄰居探索協定（NDP）標準規範。
- [RFC 8305 - Happy Eyeballs Version 2: Better Connectivity Using Concurrency](https://www.rfc-editor.org/rfc/rfc8305.html)：雙堆疊客戶端雙向探測平滑切換演算法。
