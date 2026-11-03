# 路由、轉送與封包生命週期

路由決定封包跨越不同網段的最佳路徑，轉送則是在節點內部將封包由接收介面迅速搬移到正確的輸出介面與下一跳。
理解這兩者的分工與封包跨網段時的標頭變化，是掌握網路連通性診斷的核心關鍵。

本文接續[IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)，並與作業系統網路堆疊[Linux 網路基礎](../linux/networking-basics.md)及[VPC 與資源連線](../aws/vpc-and-resource-connectivity.md)相互對照。

## 控制平面與資料平面：路由 vs 轉送

在網路架構中，路徑選擇被明確拆分為兩個不同層次的職責：

1. **控制平面（Control Plane）——「路由（Routing）」**：
   - 負責**全域路徑規劃**。
   - 透過靜態配置（Static Routes）或動態路由協定（如 OSPF、BGP），收集全網拓撲與鄰居資訊，計算出由本節點通往世界上各個目的地網段的最佳下一跳（Next Hop）。
   - 運算產物是記憶體中的**路由表（Routing Table / RIB）**與硬體加速轉發資訊庫（FIB）。
2. **資料平面（Data Plane）——「轉送（Forwarding）」**：
   - 負責**本機封包交換**。
   - 當單一封包由網卡進入時，轉送邏輯僅讀取其目的 IP，在轉發表中以極高速度查表，將封包從正確的輸出介面（Egress Interface）發送出去。

簡言之：**路由是決定地圖，轉送是車輛按地圖開過路口**。

## 主機的發送決策：同網段 vs 預設閘道

當一台主機 A（例如 `192.168.1.10/24`）準備發送封包給主機 B 時，核心網路堆疊會執行以下邏輯：

1. **比對目的網路**：
   主機 A 將目的 IP 與自身的子網路遮罩（`255.255.255.0`）進行 AND 運算：
   - 若目的 IP 同為 `192.168.1.x`：運算結果與本機網路號相符，代表目的主機位於**同一個本地廣播網域（L2 本地鏈路）**。
   - 若目的 IP 是 `8.8.8.8`：運算結果為 `8.8.8.0`，與本地網路號不符，代表目的地屬於**外部網段（遠端主機）**。
2. **決定下一跳目標**：
   - **本地通訊**：下一跳就是目的主機自身。主機 A 直接向該目的 IP 尋求其 MAC 位址。
   - **外部通訊**：主機 A 無法直接將封包送達外網主機，必須將封包交由**預設閘道（Default Gateway，通常是本地路由器的內網介面，如 `192.168.1.1`）**代為轉送。下一跳是預設閘道的 IP。

## ARP（位址解析協定）與 L2/L3 轉換

IP 封包無法直接在實體銅線或光纖上漂浮，它必須被包裹在資料鏈結層的訊框（如乙太網路訊框）中傳輸，而乙太網路只認 48 位元的實體 MAC 位址。
**ARP（Address Resolution Protocol，RFC 826）** 負責在同一個 L2 廣播網域內，將「下一跳的 IP 位址」轉換為「硬體 MAC 位址」：

1. **ARP 請求（ARP Request）**：主機發送廣播訊框（目的 MAC 為 `FF:FF:FF:FF:FF:FF`），詢問「誰擁有這個 IP？請把你的 MAC 回覆給我」。
2. **ARP 回應（ARP Reply）**：擁有該 IP 的主機以單播（Unicast）回傳自己的實體 MAC 位址。
3. **ARP 快取（ARP Cache）**：查詢者將 `IP -> MAC` 對應關係記錄在記憶體快取中（可使用 `ip neigh` 或 `arp -n` 查看），避免每個封包都要重新廣播。

## 跨網段傳輸的封包生命週期（端到端追蹤）

假設主機 A 跨越路由器 R 發送資料給外部伺服器 B：

```
[ 主機 A ] -------- (eth0) [ 路由器 R ] (eth1) -------- [ 伺服器 B ]
IP: 192.168.1.10             IP: 192.168.1.1   IP: 10.0.0.1      IP: 10.0.0.20
MAC: AA:AA:AA                MAC: RR:11:11     MAC: RR:22:22     MAC: BB:BB:BB
```

當封包從主機 A 經過路由器 R 抵達伺服器 B 時，標頭發生了關鍵變化：

| 傳輸階段 | 來源 IP | 目的 IP | 來源 MAC | 目的 MAC | TTL 變化 |
| --- | --- | --- | --- | --- | --- |
| 1. 主機 A -> 路由器 R | `192.168.1.10` | `10.0.0.20` | `AA:AA:AA` | `RR:11:11` | $TTL = 64$ |
| 2. 路由器內部處理 | 查表決定下一跳，檢查校驗和，將 TTL 減 1 | - | - | - | $TTL = 63$ |
| 3. 路由器 R -> 伺服器 B | `192.168.1.10` | `10.0.0.20` | `RR:22:22` | `BB:BB:BB` | $TTL = 63$ |

**不變與改變的本質**：
- **IP 標頭（L3）端到端不變**：來源 IP 始終是主機 A，目的 IP 始終是伺服器 B（在不考慮 NAT 的純路由情境下）。
- **MAC 標頭（L2）逐跳替換**：在第一跳，目的 MAC 是路由器內網介面；在第二跳，目的 MAC 被改寫為伺服器 B 的介面。
- **TTL（Time To Live）逐跳減 1**：每個經過的路由器必須將 IP 標頭內的 TTL 減 1。若減為 0，路由器立即丟棄封包並向來源端回發 ICMP Time Exceeded，徹底防止網路出現環路時封包無限循環消耗頻寬。

## 最長前置碼匹配（Longest Prefix Match）

路由器在轉發表中查找目的 IP 時，若有多條路由規則同時符合，採用**最長前置碼匹配原則**：遮罩長度最長（最具體、最精確）的規則勝出：

例如路由器擁有以下三條路由：
1. `10.0.0.0/8` via Gateway X
2. `10.1.0.0/16` via Gateway Y
3. `0.0.0.0/0`（預設路由）via Gateway Z

若封包目的地為 `10.1.2.5`：
- 同時匹配前置碼長度 8、16 與 0。
- `/16` 的匹配長度最長，因此路由器必定將該封包轉送到 Gateway Y。

## NAT（網路位址轉譯）與連線追蹤

由於 RFC 1918 私有 IP 無法在公網傳播，家用與企業路由器採用 **NAPT（Network Address Port Translation / PAT，RFC 3022）**，讓成百上千台內部主機共用少數公網 IP：

1. **連線追蹤（Conntrack）**：
   當內網主機 `192.168.1.10:54321` 發起連線時，NAT 閘道在全域狀態表中建立紀錄，並將封包的「來源 IP:Port」修改為「公網 IP:全新隨機 Port（如 `203.0.113.1:12345`）」。
2. **反向轉譯**：
   當外部伺服器回應給 `203.0.113.1:12345` 時，NAT 閘道比對狀態表，將「目的 IP:Port」還原改寫為 `192.168.1.10:54321`，再轉送回內網主機。

NAT 解決了 IPv4 位址匱乏，但也打破了端到端透明性（End-to-End Principle），使外網主機無法直接向內網主機主動發起連線，需要透過連接埠轉發（Port Forwarding）或 STUN/TURN 等技術穿透。

## 相關主題與參考來源

- [IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)：理解網路號運算與私有 IP 邊界。
- [DNS 網域名稱解析系統](dns-resolution-and-records.md)：理解在發起 IP 路由之前，如何獲取目的主機的 IP 位址。
- [VPC 與資源連線](../aws/vpc-and-resource-connectivity.md)：對照雲端 Internet Gateway 與 NAT Gateway 運作架構。
- [RFC 1812 - Requirements for IP Version 4 Routers](https://www.rfc-editor.org/rfc/rfc1812.html)：路由器查表與封包轉送標準。
- [RFC 826 - An Ethernet Address Resolution Protocol (ARP)](https://www.rfc-editor.org/rfc/rfc826.html)：位址解析協定規範。
- [RFC 3022 - Traditional IP Network Address Translator (Traditional NAT)](https://www.rfc-editor.org/rfc/rfc3022.html)：傳統 NAT 與 NAPT 運作標準。
