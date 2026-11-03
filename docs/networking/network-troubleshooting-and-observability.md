# 網路診斷與觀測：ICMP、路徑追蹤與封包分析

當跨主機通訊遭遇逾時、延遲暴增或間歇性中斷時，盲目重啟服務往往無法解決底層根因。
網路排查需要建立清晰的分層心智模型，從實體介面、ARP 鄰居、IP 路由轉送、ICMP 控制訊息，一路抽絲剝繭至傳輸層 TCP 狀態與實際封包流向，並善用標準診斷工具探測瓶頸。

本文接續[路由、轉送與封包生命週期](routing-and-packet-forwarding.md)與[TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)，並與系統層級[網路基礎](../linux/networking-basics.md)及[服務與日誌](../linux/services-and-logs.md)對照。

## 分層排查心智模型：由下而上的診斷路徑

排查網路問題應依循網路分層，避免在第一層實體斷線或第二層 ARP 失敗時，耗費大量時間在第七層除錯應用程式設定：

```
[應用層 L7]   curl / openssl s_client  <-- DNS 解析、TLS 憑證、HTTP 狀態碼
      ^
[傳輸層 L4]   ss / nc / telnet         <-- 連接埠監聽、TCP 連線狀態、防火牆阻擋 (SYN 逾時 vs RST)
      ^
[網路層 L3]   ip route / ping / traceroute <-- 路由表查表、預設閘道、ICMP 回應、MTU / PMTUD
      ^
[鏈路層 L2]   ip link / ip neigh       <-- 介面狀態 (UP/DOWN)、ARP 表解析 (MAC 位址是否齊全)
```

1. **鏈路與介面層（L2）**：檢查本機網路介面是否處於 `UP` 狀態（`ip link`），確認與區域網路內下一跳（閘道）的 MAC 位址解析是否成功（`ip neigh`）。若 ARP 表呈現 `FAILED` 或 `INCOMPLETE`，封包根本無法離開網卡發送至實體網路。
2. **網路層（L3）**：檢查本機核心路由表（`ip route`），確認發往目標 IP 是否匹配到正確介面與下一跳；利用 `ping` 驗證基本 IP 可達性與雙向往返時間。
3. **傳輸層（L4）**：檢查遠端服務連接埠是否處於監聽狀態（`ss -tulpn`），使用 TCP 握手探測（如 `nc -zv`）判斷是網路連線正常、被防火牆靜默丟棄（Timeout），還是被明確拒絕（RST）。
4. **應用層（L7）**：透過 `curl -v` 或 `openssl s_client` 觀察 DNS 解析時間、TLS 握手階段與 HTTP 協商回應。

## ICMP 控制訊息：網路層的即時回饋

網際網路控制訊息協定（ICMP，RFC 792）是 IP 協定的伴生協定，封裝在 IP 封包內，專門負責通報傳輸過程中的錯誤狀態與診斷資訊：

### 1. 回應請求與回覆（Echo Request / Reply）：`ping` 的底層

`ping` 命令向目標發送 ICMP Type 8（Echo Request），目標主機收到後核心自動回傳 ICMP Type 0（Echo Reply）：
- **往返時間（RTT）**：計算送出請求到收到回覆的時間差，衡量網路傳播與處理延遲。
- **丟包率（Packet Loss）**：若發出 10 個請求僅收到 8 個回覆，代表路徑上發生了 20% 的封包遺失。

### 2. 目的不可達（Destination Unreachable / Type 3）

當路由器或主機無法轉送封包時，會回傳 Type 3 訊息，並帶有特定代碼（Code）：
- `Code 0 (Net Unreachable)` / `Code 1 (Host Unreachable)`：路由器無法找到前往該網段的路由，或 ARP 探測不到目標主機。
- `Code 3 (Port Unreachable)`：UDP 封包送達目標主機，但該連接埠沒有任何應用程式監聽。
- **`Code 4 (Fragmentation Needed and DF set)`**：**極度重要的效能訊息**。當封包大小超過下一跳鏈路的 MTU（最大傳輸單元，通常為 1500 位元組），且封包標頭設定了「禁止分段（Don't Fragment, DF=1）」旗標時，路由器丟棄封包並回傳此訊息，並告知該鏈路的 MTU 上限。

### 3. 超過傳輸期限（Time Exceeded / Type 11）

當 IP 封包在網路中歷經轉送，其標頭中的 TTL（存活時間）每經一跳減 1，減至 0 時路由器必須丟棄該封包，並向原始發送端回傳 ICMP Type 11 Code 0 訊息。此特性正是路徑追蹤工具的核心原理。

> **嚴禁盲目封鎖所有 ICMP 的資安反面模式：PMTUD 黑洞**
> 許多資安設定為了「隱藏主機」，在防火牆將所有 ICMP 封包無差別丟棄。這會徹底摧毀**路徑 MTU 探索機制（PMTUD, RFC 1191）**：
> 當主機發出大型 TCP 封包（如傳輸 TLS 憑證或檔案）時，中間路由器無法分段而丟棄，回傳的 ICMP Type 3 Code 4 又被防火牆擋下。發送端始終收不到通知，只會不斷超時重傳大封包，導致**小封包 ping 通順，但真實 HTTPS 網頁連線卻永久掛起卡死**（此現象稱為 PMTUD Black Hole）。實務上必須嚴格放行 ICMP Type 3 Code 4。

## 路徑追蹤原理：`traceroute` 與 `mtr`

`traceroute` 是診斷「封包在經過哪一跳路由器時中斷或延遲飆高」的核心工具：

```
發送端 (Client)                                          目標 (Target)
  | --- 1. Probe (TTL = 1) ---> [Router 1] (TTL減至0, 丟棄)
  | <-- ICMP Time Exceeded ---- [Router 1] (得知第一跳 IP: Router 1)
  |
  | --- 2. Probe (TTL = 2) -----------------> [Router 2] (TTL減至0, 丟棄)
  | <-- ICMP Time Exceeded ----------------- [Router 2] (得知第二跳 IP: Router 2)
  |
  | --- 3. Probe (TTL = 3) ----------------------------------> [Target]
  | <-- ICMP Port Unreachable (or Echo Reply) ---------------- [Target] (抵達終點!)
```

1. **探測封包協定選擇**：
   - 傳統 Linux `traceroute` 預設發送**高連接埠 UDP 封包**；
   - Windows `tracert` 預設發送 **ICMP Echo Request**；
   - 現代防火牆常封鎖 UDP 與 ICMP。排查 Web 服務時，強烈建議使用 **TCP SYN 探測（`traceroute -T -p 443 <host>`）**，模擬真實 HTTPS 握手穿越防火牆。
2. **星號標記（`* * *`）的正確判讀**：
   路徑追蹤中出現 `* * *` 並不一定代表該節點斷線。現代核心骨幹路由器常對產生 ICMP 訊息進行嚴格的速率限制（Rate Limiting），或設定了拒絕回覆 ICMP，但依然能正常快速轉發使用者的真實資料封包。只有當某個節點之後**全部持續呈現星號**，才代表實質連線阻斷。

## 封包側錄與即時觀測：`tcpdump`

當所有高階指令無法解釋問題時，在作業系統核心層側錄網路卡進出的原始封包（Packet Capture）是最終的真理來源。

### 1. 抓包三板斧：BPF 語法精準過濾

直接執行 `tcpdump` 會被龐大的雜訊淹沒。利用 Berkeley Packet Filter（BPF）只擷取關鍵目標流量：
- 監聽特定介面與 IP：`sudo tcpdump -i eth0 host 198.51.100.20 -nn`
- 監聽特定 Port 與協定：`sudo tcpdump -i any tcp port 443 -nn`
- 寫入檔案供 Wireshark 分析：`sudo tcpdump -i eth0 -w dump.pcap port 80 or port 443`

### 2. 三大關鍵連線特徵辨識

觀察 TCP 旗標與序號，能瞬間定位網路問題層級：

- **情境一：SYN 送出，持續無回應（SYN Timeout）**
  - 發送端多次重傳 `[SYN]` 封包，但從未收到對方的 `[SYN, ACK]`。
  - **診斷結論**：中間路由不通、中間防火牆將封包 `DROP` 靜默丟棄，或目標實體主機未開機。
- **情境二：SYN 送出，瞬間收到 `[RST, ACK]`（連線被拒絕）**
  - 發送端剛送出 `[SYN]`，立刻收到帶有 `RST` 旗標的回覆。
  - **診斷結論**：網路路由完全通暢，防火牆有放行；但目標主機上**該連接埠沒有任何應用程式在監聽（Listen）**，或本機防火牆（如 iptables）主動執行了 `REJECT` 規則。
- **情境三：持續出現 Duplicate ACK 與 TCP Retransmission**
  - 封包順序跳躍，接收端反覆要求重傳特定序號。
  - **診斷結論**：實體線路品質不良、無線訊號干擾或中間路由器佇列過載發生丟包。

## 相關主題與參考來源

- [封包交換與網路分層模型](packet-switching-and-network-models.md)：理解分層封裝與排查心智模型之對應。
- [路由、轉送與封包生命週期](routing-and-packet-forwarding.md)：理解 IP 路由表、TTL 遞減與下一跳轉送機制。
- [TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)：深入分析 SYN、ACK、RST 旗標與重傳行為。
- [Linux 網路基礎](../linux/networking-basics.md)：Linux 系統下 `ip`、`ss` 工具的操作與連接埠概念。
- [RFC 792 - Internet Control Message Protocol (ICMP)](https://www.rfc-editor.org/rfc/rfc792.html)：IETF ICMP 協定原始核心規範。
- [RFC 1191 - Path MTU Discovery](https://www.rfc-editor.org/rfc/rfc1191.html)：路徑 MTU 動態探測機制與 ICMP 依賴。
