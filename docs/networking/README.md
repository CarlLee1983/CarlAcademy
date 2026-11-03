# 電腦網路知識索引

從封包交換、位址與路由出發，理解資料如何在不同主機與網路邊界間可靠或低延遲地傳輸。
本主題聚焦跨主機通訊的共同基礎概念；特定交換器設備指令、無線射頻調變細節不在本索引範圍。

**目前狀態：已整理下列 6 篇基礎概念文章。**
查證日期：2026-11-04。依據 IETF RFC 規格標準（RFC 768、RFC 791、RFC 1034/1035、RFC 1122、RFC 4632、RFC 9293）、MDN Web Docs 及文中列出的一手技術來源。
各篇以抽象通訊原理為主，實務指令以現代 Linux 工具（`ip`, `ss`, `dig`）輔助說明，不代表特定網通廠商硬體的私有配置指南。

## 閱讀入口

| 文章 | 要解決的問題 |
| --- | --- |
| [封包交換與網路分層模型](packet-switching-and-network-models.md) | 為何現代網路採用封包交換？OSI 七層與 TCP/IP 四層模型如何劃分通訊責任？ |
| [IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md) | 如何以前置碼劃分網段？主機如何判斷目標屬於同網段還是交由預設閘道？ |
| [路由、轉送與封包生命週期](routing-and-packet-forwarding.md) | 路由器如何根據路由表查表轉送？ARP、下一跳與 NAT 轉換如何協同運作？ |
| [DNS 網域名稱解析系統](dns-resolution-and-records.md) | 網域名稱如何透過階層式架構解析？遞迴與權威伺服器、常見記錄與 TTL 有何作用？ |
| [TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md) | 三方交握與四方揮手如何確保可靠狀態？序號、滑動視窗與壅塞控制如何調節速率？ |
| [UDP 與無連線傳輸](udp-and-connectionless-transport.md) | 為何 UDP 能提供極低開銷？不保證順序與送達的協定適用於哪些場景？ |

建議先從分層模型建立概念，再依「定址與路由（IP / 路由 / DNS）」與「端點傳輸（TCP / UDP）」兩條主線循序理解。

## 建議閱讀順序

1. **[封包交換與網路分層模型](packet-switching-and-network-models.md)**：先理解為什麼網路不是拉專線獨占（電路交換），以及資料如何被分層包裝（Encapsulation）。
2. **[IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)**：理解邏輯定址、網路號與主機號的切分，以及私有網段的規範。
3. **[路由、轉送與封包生命週期](routing-and-packet-forwarding.md)**：理解封包如何一跳一跳越過閘道抵達目的地，以及 MAC 與 IP 在各跳的變化。
4. **[DNS 網域名稱解析系統](dns-resolution-and-records.md)**：理解文字網域名稱如何轉換為 IP，以及分散式階層查詢與快取的作用。
5. **[TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)**：理解在不可靠的 IP 網路上，如何建立可靠、保證順序且能自我調節傳輸速率的資料流。
6. **[UDP 與無連線傳輸](udp-and-connectionless-transport.md)**：理解放棄交握與確認應答後，能獲得哪些低延遲優勢與適用邊界。

## 與既有主題的分工

- [Linux 知識索引](../linux/README.md)：作業系統層級的網路介面、Socket 系統呼叫、cgroups 與網路命名空間；本主題著重於跨主機的通訊協定本身。
- [API 共通知識索引](../api/README.md)：應用層的 HTTP 語意、資源表示、錯誤狀態碼與重試策略；本主題負責底層 TCP 連線建立、傳輸緩衝與封包流向。
- [AWS 知識索引](../aws/README.md)：雲端環境的 VPC、Subnet、Route Table、NAT Gateway 與安全群組；本主題提供底層 CIDR 運算與路由轉送的通用依據。
- [Web 應用資安索引](../web-security/README.md)：TLS 握手憑證驗證、中間人攻擊防範與 SSRF 防護；本主題負責連線通道建立與 DNS 解析基本流程。
- [網站首頁](../../README.md)：查看所有主題與全站閱讀入口。

## 後續方向

後續可視需要擴充傳輸層之上的演進主題，例如 HTTP/1.1、HTTP/2 到 HTTP/3 (QUIC) 的傳輸改進，以及四層（L4）與七層（L7）負載平衡、反向代理與連線保持機制。
