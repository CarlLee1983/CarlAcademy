# 電腦網路知識索引

從封包交換、位址與路由出發，理解資料如何在不同主機與網路邊界間可靠或低延遲地傳輸。
本主題聚焦跨主機通訊的共同基礎概念；特定交換器設備指令、無線射頻調變細節不在本索引範圍。

**目前狀態：已整理下列 12 篇基礎與進階架構文章。**
查證日期：2026-11-04。依據 IETF RFC 規格標準（RFC 768、RFC 791、RFC 792、RFC 1034/1035、RFC 1122、RFC 1191、RFC 4291、RFC 4632、RFC 4787、RFC 4861、RFC 4862、RFC 5246、RFC 5389、RFC 6066、RFC 8200、RFC 8305、RFC 8445、RFC 8446、RFC 8656、RFC 9000、RFC 9112、RFC 9113、RFC 9114、RFC 9293）、MDN Web Docs 及文中列出的一手技術來源。
各篇以抽象通訊原理為主，實務指令以現代 Linux 工具（`ip`, `ss`, `dig`, `tcpdump`, `traceroute`）輔助說明，不代表特定網通廠商硬體的私有配置指南。

## 閱讀入口

| 文章 | 要解決的問題 |
| --- | --- |
| [封包交換與網路分層模型](packet-switching-and-network-models.md) | 為何現代網路採用封包交換？OSI 七層與 TCP/IP 四層模型如何劃分通訊責任？ |
| [IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md) | 如何以前置碼劃分網段？主機如何判斷目標屬於同網段還是交由預設閘道？ |
| [路由、轉送與封包生命週期](routing-and-packet-forwarding.md) | 路由器如何根據路由表查表轉送？ARP、下一跳與 NAT 轉換如何協同運作？ |
| [DNS 網域名稱解析系統](dns-resolution-and-records.md) | 網域名稱如何透過階層式架構解析？遞迴與權威伺服器、常見記錄與 TTL 有何作用？ |
| [TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md) | 三方交握與四方揮手如何確保可靠狀態？序號、滑動視窗與壅塞控制如何調節速率？ |
| [UDP 與無連線傳輸](udp-and-connectionless-transport.md) | 為何 UDP 能提供極低開銷？不保證順序與送達的協定適用於哪些場景？ |
| [HTTP 演進：從 HTTP/1.1、HTTP/2 到 HTTP/3 (QUIC)](http-evolution-and-quic.md) | 從明文長連線、二進位多路複用到基於 UDP 的 QUIC，HTTP 如何逐代消弭應用與傳輸層隊頭阻塞？ |
| [TLS 傳輸層安全：交握協商、密鑰交換與安全通道](tls-and-secure-transport.md) | 在開放網路中，TLS 1.2 與 1.3 如何透過憑證、非對稱密鑰交換與對稱 AEAD 建立安全通道？ |
| [負載平衡與反向代理：L4、L7 與流量調度](load-balancing-and-reverse-proxy.md) | L4 與 L7 負載平衡在協定棧中有何責任分工？反向代理如何處理 TLS 卸載、路由與健康檢查？ |
| [網路診斷與觀測：ICMP、路徑追蹤與封包分析](network-troubleshooting-and-observability.md) | 當連線異常時如何分層排查？ICMP 控制訊息、PMTUD 黑洞、traceroute 原理與 tcpdump 簽章為何？ |
| [NAT 穿透與防火牆：網路位址轉換的類型與穿透技術](nat-and-firewall-traversal.md) | 私有網路下的主機如何跨越邊界建立通訊？錐型與對稱型 NAT、STUN、TURN 與 ICE 打洞如何運作？ |
| [IPv6 架構與過渡機制：定址、鄰居探索與雙堆疊](ipv6-architecture-and-transition.md) | 128 位元定址、簡化固定標頭與 NDP 帶來哪些改進？雙堆疊、Happy Eyeballs 與 SLAAC 如何運作？ |

建議先從分層模型建立基礎概念，再依「定址與路由」、「傳輸與安全協定」及「進階網路架構與排查」循序理解。

## 建議閱讀順序

1. **[封包交換與網路分層模型](packet-switching-and-network-models.md)**：先理解為什麼網路不是拉專線獨占（電路交換），以及資料如何被分層包裝（Encapsulation）。
2. **[IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)**：理解邏輯定址、網路號與主機號的切分，以及私有網段的規範。
3. **[路由、轉送與封包生命週期](routing-and-packet-forwarding.md)**：理解封包如何一跳一跳越過閘道抵達目的地，以及 MAC 與 IP 在各跳的變化。
4. **[DNS 網域名稱解析系統](dns-resolution-and-records.md)**：理解文字網域名稱如何轉換為 IP，以及分散式階層查詢與快取的作用。
5. **[TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)**：理解在不可靠的 IP 網路上，如何建立可靠、保證順序且能自我調節傳輸速率的資料流。
6. **[UDP 與無連線傳輸](udp-and-connectionless-transport.md)**：理解放棄交握與確認應答後，能獲得哪些低延遲優勢與適用邊界。
7. **[HTTP 演進：從 HTTP/1.1、HTTP/2 到 HTTP/3 (QUIC)](http-evolution-and-quic.md)**：理解應用層傳輸協定如何從長連線管線化演進至二進位多路複用，再演進為基於 UDP 的 QUIC。
8. **[TLS 傳輸層安全：交握協商、密鑰交換與安全通道](tls-and-secure-transport.md)**：理解在不可信網路中如何透過 PKI 信任鏈、ECDHE 密鑰交換與 AEAD 建立安全通道。
9. **[負載平衡與反向代理：L4、L7 與流量調度](load-balancing-and-reverse-proxy.md)**：理解高併發網路架構中的四層與七層流量分配、TLS 終止、連線池化與健康檢查。
10. **[網路診斷與觀測：ICMP、路徑追蹤與封包分析](network-troubleshooting-and-observability.md)**：建立由下而上的分層排查心智模型，掌握 ICMP 控制訊息、PMTUD、traceroute 與 tcpdump 封包分析。
11. **[NAT 穿透與防火牆：網路位址轉換的類型與穿透技術](nat-and-firewall-traversal.md)**：理解私有網路與防火牆後的連線追蹤、錐型與對稱型 NAT 行為，以及 STUN、TURN 與 ICE 打洞協商。
12. **[IPv6 架構與過渡機制：定址、鄰居探索與雙堆疊](ipv6-architecture-and-transition.md)**：理解下一代網際網路的 128 位元定址、取消廣播的 NDP 協定、SLAAC 自動配置與 Happy Eyeballs 雙堆疊過渡技術。

## 與既有主題的分工

- [Linux 知識索引](../linux/README.md)：作業系統層級的網路介面、Socket 系統呼叫、cgroups 與網路命名空間；本主題著重於跨主機的通訊協定本身。
- [API 共通知識索引](../api/README.md)：應用層的 HTTP 語意、資源表示、錯誤狀態碼與重試策略；本主題負責底層連線建立、傳輸緩衝與封包流向。
- [AWS 知識索引](../aws/README.md)：雲端環境的 VPC、Subnet、Route Table、NAT Gateway 與安全群組；本主題提供底層 CIDR 運算與路由轉送的通用依據。
- [Web 應用資安索引](../web-security/README.md)：信任邊界、中間人攻擊防範與敏感資料保護；本主題負責連線通道建立、TLS 協商與 DNS 解析流程。
- [網站首頁](../../README.md)：查看所有主題與全站閱讀入口。

## 後續方向

後續可視需要擴充進階主題，例如 BGP 自治系統與網際網路跨域路由、軟體定義網路（SDN）與 Overlay 網路（VXLAN / Geneve）、Zero Trust 網路架構與 mTLS 雙向認證實務。
