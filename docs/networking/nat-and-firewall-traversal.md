# NAT 穿透與防火牆：網路位址轉換的類型與穿透技術

在 IPv4 位址耗盡的背景下，絕大多數使用者裝置與伺服器皆部署在私有網路（RFC 1918）中，必須透過 NAT（網路位址轉換）閘道共享少數公開 IP 存取網際網路。
NAT 雖有效解決了出境存取問題並隱藏了內網拓撲，卻也打破了網際網路最初「任何兩台主機能直接互相連線」的端對端架構（End-to-End Principle）。在點對點通訊（P2P）、即時影音（WebRTC）與現代網狀 VPN（如 Tailscale）中，如何穿越不同類型的 NAT 與防火牆建立直連通道，是現代網路工程的核心挑戰。

本文接續[IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)與[UDP 與無連線傳輸](udp-and-connectionless-transport.md)，並與雲端架構[VPC 與資源連線](../aws/vpc-and-resource-connectivity.md)及資安[信任邊界與威脅思考](../web-security/trust-boundaries.md)對照。

## NAT 與連線追蹤（Conntrack）機制

當私有網段主機（例如 `192.168.1.100:5000`）向公網伺服器（`203.0.113.50:443`）發送封包時，NAT 路由器會執行**網路位址與連接埠轉換（NAPT）**：

1. **出境轉換（SNAT）**：NAT 路由器將封包的來源 IP 改寫為自己的公網 IP（如 `198.51.100.1`），並動態分配一個可用的公網 Port（如 `40001`）。
2. **連線追蹤表記錄（Conntrack Table）**：在核心中寫入一筆狀態對應表：
   `內部 [192.168.1.100:5000] <===> 外部 [198.51.100.1:40001] <---> 目標 [203.0.113.50:443]`
3. **入境轉換（DNAT）**：當公網伺服器回覆封包抵達 `198.51.100.1:40001` 時，NAT 路由器查表將目的 IP/Port 還原為 `192.168.1.100:5000` 並轉發至內網主機。

### NAT 帶來的連通性阻礙

上述機制對於「內網主動發起請求」運作良好。但若兩台主機 A 與 B 分別位於不同的私有家用網路或企業防火牆後方：
- A 無法直接將封包送達 B 的私有 IP（`192.168.x.x` 不在網際網路中路由）；
- 若 A 直接將封包發往 B 所在的公網 NAT 閘道，B 的 NAT 閘道因為連線追蹤表中**尚未存在對應的入境轉發規則**，會將該未經請求的外部封包直接丟棄（Drop）或拒絕（Reject）。

## NAT 行為分類：錐型與對稱型

能否成功穿透 NAT，取決於 NAT 閘道在 RFC 4787 與 RFC 5389 中定義的位址映射（Mapping）與過濾（Filtering）行為：

```
[錐型 NAT (Cone NAT)]
內網端點 (192.168.1.5:8000) --------------------+
發往 目標 1 (203.0.113.1) ---> 對應公網 198.51.100.1:50000 | (共用同一個公網 Port，
發往 目標 2 (203.0.113.2) ---> 對應公網 198.51.100.1:50000 |  可打洞穿透!)
                                                +

[對稱型 NAT (Symmetric NAT)]
內網端點 (192.168.1.5:8000) --------------------+
發往 目標 1 (203.0.113.1) ---> 對應公網 198.51.100.1:50001 | (只要目標不同，
發往 目標 2 (203.0.113.2) ---> 對應公網 198.51.100.1:50002 |  就換全新 Port，無法打洞!)
                                                +
```

1. **全錐型 NAT（Full Cone / Endpoint-Independent Mapping & Filtering）**：
   只要內部主機建立過一次映射，**網際網路上任何外部主機**只要將封包送往該公網 IP:Port，NAT 皆會轉送給內部主機。最容易穿透。
2. **受限錐型 NAT（Restricted Cone / Endpoint-Dependent Filtering）**：
   只有內部主機曾主動發送過封包的**外部 IP**（連接埠不限），才能將封包送入該公網 IP:Port。
3. **連接埠受限錐型 NAT（Port-Restricted Cone）**：
   內部主機必須曾主動發送過封包給該**特定外部 IP 且特定 Port**，該外部端點才能將封包送入。家用分享器最普遍的類型。
4. **對稱型 NAT（Symmetric NAT）**：
   **最嚴苛且無法直接打洞的類型**。內部主機向不同外部目標（IP 或 Port 只要不同）通訊時，NAT 就會分配**完全不同的公網 Port**。常見於企業大型防火牆與行動通訊 4G/5G 營運商閘道。

## UDP 打洞技術（UDP Hole Punching）原理

UDP 是無連線協定，不需三方交握即可發送封包，是 NAT 穿透的最佳載體。打洞的核心思想是：**誘導雙方 NAT 路由器建立針對彼此的連線追蹤表**。

假設 Client A 與 Client B 想建立直連通訊：
1. 雙方皆先連線至一台位於公網的中介協調伺服器（STUN 伺服器）。
2. STUN 伺服器觀察到 A 的公網反射位址為 `198.51.100.1:40001`，B 的公網反射位址為 `203.0.113.1:50002`，並將對方的公網位址交換告知雙方。
3. **同時打洞**：
   - A 向 B 的公網位址（`203.0.113.1:50002`）發送 UDP 封包。A 的 NAT 記錄了「允許來自 `203.0.113.1:50002` 的回應」；此封包抵達 B 的 NAT 時可能暫時被丟棄。
   - B 幾乎同一時間向 A 的公網位址（`198.51.100.1:40001`）發送 UDP 封包。B 的 NAT 同樣記錄了「允許來自 `198.51.100.1:40001` 的回應」。
4. 當 B 後續的封包抵達 A 的 NAT 時，A 的 NAT 查表發現這正是先前 A 允許連線的目標，立刻放行轉發給 A；雙向通道隨即被打通（Hole Punched），後續通訊直接在 A 與 B 之間點對點直連傳輸。

## NAT 穿透三大支柱：STUN、TURN 與 ICE

在真實複雜的網路環境中，手動實作打洞不可靠。IETF 定義了一套標準化協定套件：

### 1. STUN（RFC 5389）：自我公開端點探索

STUN（Session Traversal Utilities for NAT）是一個極度輕量的請求/回應協定。用戶端向公網的 STUN 伺服器發送探測，伺服器在回應中告知用戶端：「從我的視角看，你的封包是來自哪一個公網 IP 與 Port（稱為反射傳輸位址，Reflexive Transport Address）」。
- **限制**：STUN 只能協助錐型 NAT 探索位址並完成打洞；若通訊雙方中有一方處於對稱型 NAT 後方，STUN 無法建立直連。

### 2. TURN（RFC 8656）：對稱型 NAT 的公網中繼兜底

當雙方處於嚴苛的對稱型 NAT 或禁止 UDP 的企業防火牆後方時，直連打洞完全不可行。此時必須啟用 TURN（Traversal Using Relays around NAT）：
- 雙方與具備高頻寬公網 IP 的 TURN 伺服器建立通道（可走 TCP 或 TLS 443）。
- 所有音訊、視訊或資料封包皆由 TURN 伺服器**中繼轉發（Relay）**。
- **代價**：徹底解決連通性問題，但會消耗中繼伺服器的大量頻寬費用，並增加中轉往返延遲。

### 3. ICE（RFC 8445）：智慧連通性協商框架

ICE（Interactive Connectivity Establishment）是整合 STUN 與 TURN 的整合協商框架，廣泛應用於 WebRTC：

```
[ICE 候選者收集]
1. 本機候選者 (Host Candidate)         --> 本機內網 IP (同 LAN 直連最快)
2. 反射候選者 (Server Reflexive)       --> STUN 探測所得之公網 IP:Port (跨 NAT 打洞)
3. 中繼候選者 (Relay Candidate)        --> TURN 伺服器中繼位址 (兜底轉發)

[優先順序檢查 (Connectivity Checks)]
優先嘗試 Host 直連 ---> 失敗則嘗試 STUN 打洞 ---> 最終兜底走 TURN 中繼
```

ICE 收集所有可能的傳輸候選者（Candidates），透過 SDP（Session Description Protocol）與遠端交換清單，隨後以優先權順序成對發起連通性檢查（Connectivity Checks），自動敲定成本最低、延遲最短且可行的一組通道。

## 現代網路應用實踐

- **WebRTC**：瀏覽器原生的點對點音訊、視訊會議與即時資料傳輸通道，全流程依賴 ICE 收集候選者並自動選擇直連或中繼。
- **Mesh VPN（Tailscale / WireGuard）**：利用 STUN 探索節點公網位址與 UDP 打洞技術，讓跨雲端、地端機房與個人筆記型電腦直接建立點對點加密 WireGuard 通道；當遭遇對稱型 NAT 時，自動回退至 DERP（Designated Encrypted Relay for Packets）中繼伺服器轉發。
- **自動連接埠映射（UPnP / NAT-PMP / PCP）**：在受控的家用或辦公室路由器中，內部應用程式可透過 UPnP 或 PCP 協定，直接向路由器發送請求：「請將公網 Port 8000 靜態轉發給我」，免去動態打洞與中繼開銷。

## 相關主題與參考來源

- [IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)：理解 RFC 1918 私有網段與公網 IP 之界線。
- [路由、轉送與封包生命週期](routing-and-packet-forwarding.md)：理解路由器在第四層與第三層轉送封包時的標頭變更。
- [UDP 與無連線傳輸](udp-and-connectionless-transport.md)：深入探討為何 UDP 是 NAT 打洞的最佳協定載體。
- [VPC 與資源連線](../aws/vpc-and-resource-connectivity.md)：雲端環境中 NAT Gateway 的集中出口架構。
- [RFC 5389 - Session Traversal Utilities for NAT (STUN)](https://www.rfc-editor.org/rfc/rfc5389.html)：IETF STUN 協定標準規範。
- [RFC 8656 - Traversal Using Relays around NAT (TURN)](https://www.rfc-editor.org/rfc/rfc8656.html)：IETF TURN 中繼傳輸協定標準規範。
- [RFC 8445 - Interactive Connectivity Establishment (ICE)](https://www.rfc-editor.org/rfc/rfc8445.html)：IETF ICE 整合式連通性框架規範。
- [RFC 4787 - Network Address Translation (NAT) Behavioral Requirements for Unicast UDP](https://www.rfc-editor.org/rfc/rfc4787.html)：定義 NAT 映射與過濾行為準則。
