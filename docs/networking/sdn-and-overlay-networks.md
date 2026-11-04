# 軟體定義網路與 Overlay 虛擬化：VXLAN 與 Geneve

在傳統資料中心中，網路隔離主要依賴實體交換器的 IEEE 802.1Q 虛擬區域網路（VLAN）與生成樹協定（STP）。
然而，VLAN 僅有 12 位元的識別碼（最多容納 4,096 個虛擬網段），且 STP 為避免環路會封鎖一半以上的冗餘線路，面對現代多租戶雲端架構（如 AWS VPC）與超大規模容器叢集（如 Kubernetes 數萬個 Pod）的動態遷移與隔離需求已不堪負荷。

**軟體定義網路（SDN）**與 **Overlay 覆蓋網路**透過將虛擬二層或三層封包封裝在實體 IP 封包中（Packet-in-Packet），徹底實現了「邏輯網路拓撲」與「實體底層硬體」的完全解耦。

本文接續[封包交換與網路分層模型](packet-switching-and-network-models.md)與[路由、轉送與封包生命週期](routing-and-packet-forwarding.md)，並與雲端網路[虛擬私有雲（VPC）](../aws/vpc-and-resource-connectivity.md)相互對照。

## SDN 核心哲學：控制平面與資料平面分離

傳統網路設備將所有功能整合於單一黑盒子中：
- 韌體在 CPU 上執行 OSPF、BGP 等協定計算拓撲（控制平面）。
- 專用積體電路（ASIC）負責依照記憶體中的轉發表進行極速封包轉送（資料平面）。

這種高度耦合導致網路變更依賴繁瑣且容易出錯的手動 CLI 配置，且無法動態因應工作負載的彈性伸縮。

```
+-----------------------------------------------------------+
| 管理平面 (Management Plane): 宣告式 API、雲端主控台、Kubernetes CNI|
+-----------------------------------------------------------+
                             │ 政策下發
                             ▼
+-----------------------------------------------------------+
| 控制平面 (Control Plane): 集中式/分散式 SDN 控制器 (OVN, Calico) |
|   - 全域計算邏輯拓撲、IP/MAC 分發、存取控制規則清單           |
+-----------------------------------------------------------+
                             │ 轉發表與 Flow 規則下發
                             ▼
+-----------------------------------------------------------+
| 資料平面 (Data Plane): 實體交換器 / 核心虛擬交換器 (OVS, eBPF)   |
|   - 高速封包匹配、標頭改寫、封裝/解封裝與硬體轉發             |
+-----------------------------------------------------------+
```

1. **資料平面（Data Plane / Forwarding Plane）**：只專注於「依規則轉發」。節點依據轉發表（Flow Tables）高速比對進來的封包欄位，執行轉送、丟棄、重寫標頭或進出佇列。
2. **控制平面（Control Plane）**：集中或分散式軟體控制器，掌握全域邏輯網路狀態，負責動態生成轉發表並推送到資料平面。
3. **管理平面（Management Plane）**：提供人類與自動化系統操作的宣告式介面，將業務意圖轉換為控制平面的網路政策。

## Underlay 與 Overlay 網路模型

現代雲端與資料中心網路架構劃分為清晰的兩層結構：

```
[ 虛擬 Pod A ]                                    [ 虛擬 Pod B ]
(10.244.1.5)                                      (10.244.2.8)
     │                                                 ▲
     ▼                                                 │
[ 節點 A: VTEP ] ===== 外部 UDP/IP 封裝隧道 =====> [ 節點 B: VTEP ]  <-- Overlay 邏輯層
(192.168.10.11)                                  (192.168.20.22)
     │                                                 ▲
     ▼                                                 │
[ Leaf 交換器 ] ─── [ Spine 交換器 (L3 ECMP) ] ─── [ Leaf 交換器 ]  <-- Underlay 實體層
```

### 1. Underlay 實體底層網路

- **職責**：專注於穩定、高頻寬且無阻塞地在實體伺服器之間遞送 IP 封包。
- **現代架構**：普遍採用 **Spine-Leaf（CLOS）** 拓撲，所有交換器間以純三層（Layer 3）路由協定（如 BGP 或 OSPF）連線，搭配等價多路徑路由（ECMP），充分利用每一條實體線路頻寬，徹底廢除容易引發阻塞的 STP。實體交換器無須知道虛擬機或容器的內部 IP。

### 2. Overlay 覆蓋虛擬網路

- **職責**：建立在 Underlay 之上的虛擬抽象層。
- **特性**：虛擬機器（VM）或容器（Pod）互相通訊時，看見的是專屬的私有邏輯網段。端點通訊發出的封包在離開實體宿主機前，會被包裝為標準的 UDP/IP 封包穿越實體網路，抵達目的宿主機後再解封裝還原，完全不受實體機房線路跳數與實體網段位置的限制。

## VXLAN：虛擬可擴展區域網路

**VXLAN（Virtual eXtensible Local Area Network, RFC 7348）** 是現代資料中心與容器 CNI 最主流的 Overlay 封裝技術。

### 1. 突破 4,096 限制的 24 位元 VNI

VXLAN 引入了 24 位元的 **VNI（VXLAN Network Identifier）**，使網路虛擬網段數量上限一舉從 VLAN 的 4,096 躍升至：
$$2^{24} = 16,777,216\text{ 個獨立租戶網段}$$

### 2. MAC-in-UDP 封裝結構

VXLAN 採用 **MAC-in-UDP** 封裝，將內層原始的二層乙太網路訊框完整包裹在標準的三層 UDP/IP 封包中：

```
+---------------+---------------+---------------+---------------+--------------------+
| 外部乙太標頭   | 外部 IP 標頭   | 外部 UDP 標頭 | VXLAN 標頭    | 內部原始乙太網路訊框 |
| (14 Bytes)    | (20 Bytes)    | (8 Bytes)     | (8 Bytes)     | (MAC + IP + Data)  |
+---------------+---------------+---------------+---------------+--------------------+
                                 ▲               ▲
                                 │               └─ 包含 24-bit VNI 識別碼
                                 └─ 目的地 Port: 4789
                                    來源 Port: 內部訊框雜湊 (支援 ECMP)
```

- **外部 UDP 連接埠**：目的地連接埠預設為 **4789**（RFC 7348 官方標準）。
- **來源連接埠雜湊**：來源 Port 通常不是隨機產生，而是對內部原始訊框的「五元組」進行雜湊計算所得。這使得實體 Underlay 交換器在執行 ECMP 負載平衡時，能將不同虛擬連線均勻分流至不同的 Spine 鏈路，避免多條虛擬連線擠死同一實體通道。

### 3. VTEP（VXLAN 穿隧端點）

**VTEP（VXLAN Tunnel Endpoint）** 是負責執行封裝與解封裝的節點。
- **硬體 VTEP**：直接由實體 Leaf 交換器的專用 ASIC 晶片處理，轉發效能極高。
- **軟體 VTEP**：由 Linux 作業系統核心的虛擬介面（如 `vxlan0`、Open vSwitch 或 eBPF 程式）處理，普遍應用於 Kubernetes 叢集的 Flannel、Calico 或 Cilium 網路外掛。

## Geneve：新一代彈性封裝協定

隨著雲端網路功能虛擬化（NFV）的發展，固定欄位的 VXLAN 逐漸難以滿足傳遞安全上下文的需求。IETF 隨後制定了 **Geneve（Generic Network Virtualization Encapsulation, RFC 8926）**：

- **UDP 連接埠**：預設目的地為 **6081**。
- **可變長度 TLV 選項標頭**：Geneve 允許在標準 8 位元組基礎標頭後，動態追加多個 **TLV（Type-Length-Value）** 選項。
- **應用場景**：這使得控制器可以在封裝標頭中夾帶租戶安全權限標籤、分散式追蹤識別碼（Trace ID）或服務網格中繼資料。Geneve 目前已被 OVN（Open Virtual Network）及 AWS Gateway Load Balancer 作為預設穿隧協議。

## 控制平面的演進：多播學習到 EVPN-BGP

在 Overlay 網路中，VTEP 節點如何得知「內層目的 MAC 位址究竟在哪一台實體主機的 VTEP 上」？

```
傳統資料面學習 (Flood & Learn):
  VTEP A 遇到未知 MAC ──> 向 Underlay IP 多播群組廣播 ──> 實體網路湧入巨量洪水

現代 EVPN-BGP 控制面:
  端點 A 上線 ──> VTEP A 透過 BGP 發送 EVPN Route ──> 控制面全域同步 ──> 精準單播
```

### 1. 早期多播洪水學習（Data Plane Flood-and-Learn）

早期 VXLAN 依賴實體網路的 IP 多播（Multicast）技術。當 VTEP A 遇到未知的內部目的 MAC 時，會將封包複製發送到多播群組，所有加入群組的 VTEP 都會收到該封包。此方式不僅需要 Underlay 交換器維護繁瑣的多播路由（PIM），且極易引發資料中心的廣播風暴。

### 2. 現代 EVPN-BGP 控制平面（RFC 8365）

現代大規模資料中心與雲端網路全數採用 **EVPN-BGP（Ethernet VPN with MP-BGP）** 作為標準控制平面：
- 當虛擬機或容器在節點 A 啟動時，本機 VTEP 立即將其 MAC 位址、內部 IP 與所屬 VNI，包裝成 BGP EVPN 路由（Type 2 MAC/IP Advertisement）宣告給全域網路。
- 其他所有 VTEP 節點透過 BGP 控制面預先學會對應關係，建立完整的轉發對應表。
- 資料平面轉發時，封包一律透過**精準單播（Unicast）**送達目標 VTEP，徹底消滅了廣播與未知單播洪水。

## 工程挑戰與實務限制

| 挑戰面向 | 現象與原理 | 解決方案與最佳實踐 |
| --- | --- | --- |
| **MTU 與封裝開銷** | 外部 Ethernet (14B) + IP (20B) + UDP (8B) + VXLAN (8B) 共帶來 **50 位元組額外開銷**。若虛擬機發送 1500 位元組封包，封裝後達 1550 位元組。 | **Underlay 啟用巨型封包（Jumbo Frames）**：實體交換器 MTU 設為 9000 或 9216；若無法啟用巨型封包，則必須在虛擬網卡調小 MTU 至 1450。 |
| **PMTUD 黑洞與封包分段** | 若 Underlay 實體路徑不允許超過 1500 位元組，且外層封包標註了 DF（Don't Fragment），封包將被直接丟棄造成連線懸掛。 | 確保路徑中 ICMP Type 3 Code 4 封包暢通，或在虛擬路由器開啟 TCP MSS Clamping（強制縮小 TCP 握手時的 MSS）。 |
| **硬體卸載（Offloading）** | 傳統實體網卡（NIC）的 LSO/TSO、Checksum 卸載無法辨識內層封包，導致封裝工作全由 CPU 負擔。 | 採用支援 **VXLAN / Geneve 封裝卸載** 的現代 SmartNIC，在網卡硬體層直接完成檢查碼計算與封包切片。 |
| **封包分析與觀測障礙** | 在實體主機上使用 `tcpdump` 抓包時，預設僅看見大量外層 UDP 4789 封包，難以直接除錯內部協定。 | 使用支援解封裝的診斷工具（如 `tcpdump -vv -T vxlan` 或 Wireshark VXLAN 解碼設定），還原內部原始訊框。 |

## 相關主題與參考來源

- [封包交換與網路分層模型](packet-switching-and-network-models.md)：理解分層封裝（Encapsulation）在協定棧中的核心地位。
- [路由、轉送與封包生命週期](routing-and-packet-forwarding.md)：理解 Underlay 網路的三層路由轉送與 ECMP 等價多路徑。
- [BGP 自治系統、跨域路由與 Anycast 架構](bgp-and-autonomous-systems.md)：理解 EVPN-BGP 背後的 BGP 控制面運作機制。
- [虛擬私有雲（VPC）](../aws/vpc-and-resource-connectivity.md)：理解雲端服務商如何在多租戶實體設施上構建隔離的邏輯私有網路。
- [RFC 7348 - Virtual eXtensible Local Area Network (VXLAN)](https://www.rfc-editor.org/rfc/rfc7348.html)：IETF VXLAN 官方規範標準。
- [RFC 8365 - A Network Virtualization Overlay Solution Using BGP EVPN](https://www.rfc-editor.org/rfc/rfc8365.html)：以 BGP EVPN 作為網路虛擬化控制平面標準。
- [RFC 8926 - Geneve: Generic Network Virtualization Encapsulation](https://www.rfc-editor.org/rfc/rfc8926.html)：新一代可延伸 Overlay 封裝協定規範。
