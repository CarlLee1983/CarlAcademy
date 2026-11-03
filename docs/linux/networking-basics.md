# 網路基礎

「網站打不開」可能是介面沒連線、沒有合適路由、名稱解析失敗，也可能是服務根本沒在接收請求。
**網路排查的第一步，是分清楚目前觀察到的是哪一層，這項證據又能排除什麼。**
有 IP 位址不代表能到達目的地；ping 得到回覆不代表網站可用；收到 HTTP 404 則表示已經取得 HTTP 回應，不能直接歸類為沒有網路。

本文適合已讀過[認識 Linux](what-is-linux.md)與[終端與 Shell](terminal-and-shell.md)的讀者，從本機觀察理解網路，不修改路由、DNS 或防火牆，也不啟動伺服器。

查證日期：2026-11-02。命令以 Linux 的 iproute2、iputils、glibc `getent` 與 curl 為範圍；
不同發行版與精簡容器不一定預裝這些工具，也不一定使用 glibc 或 systemd-resolved。
本次編寫環境為 macOS（Darwin）、Bash 5.3.9，沒有運行中的 Linux；**以下命令僅核對官方手冊並做 Bash 語法檢查，未在 Linux 執行。**
所有輸出片段都是假想示意；`getent`、`ping`、`curl` 等可能產生網路流量的操作也未執行。

## 介面、MAC 與 IP 分別回答什麼問題

**網路介面（network interface）**是系統收送網路資料的介面，可以對應實體網卡，也可以是虛擬裝置。
不要假設網卡一定叫 `eth0`；實際名稱可能是 `enp1s0`、`wlan0` 等。
在 Linux 中，`ip link` 觀察裝置與連結層資訊，`ip address` 觀察附加於裝置的 IPv4／IPv6 位址。
同一個介面可以有多個位址。參考 iproute2 的 [`ip-link(8)`](https://man7.org/linux/man-pages/man8/ip-link.8.html)與
[`ip-address(8)`](https://man7.org/linux/man-pages/man8/ip-address.8.html)。

以 Ethernet 介面為例，**MAC 位址**是連結層使用的位址；**IP 位址**則用來進行 IP 層的定址與路由。
兩者不是同一個編號：跨越路由器送往遠端時，不是把遠端主機的 MAC 當作全程目的地。
在常見的 IPv4 Ethernet 網路中，系統透過 ARP 找出同一鏈路上下一跳 IP 對應的鏈路層位址。
參考 Linux [`arp(7)`](https://man7.org/linux/man-pages/man7/arp.7.html)。

| 觀察對象 | 回答的問題 | 不能據此推定 |
| --- | --- | --- |
| 介面／link | 系統有哪些網路裝置？管理狀態與鏈路狀態如何？ | `UP` 就一定能到達網際網路 |
| MAC | 在 Ethernet 這類鏈路上，使用什麼鏈路層位址？ | MAC 是可跨網際網路路由的主機位址 |
| IP 與前綴 | 介面有哪些 IP 位址？位址屬於什麼前綴？ | 配到位址就一定有正確路由或 DNS |

可以先讀這兩個查詢：

```bash
ip link show
ip address show
```

閱讀時，`link/ether` 後通常是 Ethernet MAC，`inet` 是 IPv4，`inet6` 是 IPv6。
`UP` 是管理上啟用的旗標；例如 `LOWER_UP` 才與驅動回報的下層鏈路狀態有關，仍不能證明遠端可達。
無線網路認證、虛擬介面與 loopback 也不能只靠一個旗標判斷。
旗標定義見 Linux [`netdevice(7)`](https://man7.org/linux/man-pages/man7/netdevice.7.html)。

## IPv4、IPv6 與 CIDR 前綴

IPv4 使用 32 位元位址，常寫成四段十進位數，如 `192.0.2.10`。
IPv6 使用 128 位元位址，常寫成冒號分隔的十六進位群組，如 `2001:db8::10`；`::` 可以壓縮一段連續的零，一個位址只能使用一次這種壓縮。
位址表示法分別見 Linux [`ip(7)`](https://man7.org/linux/man-pages/man7/ip.7.html)與
[RFC 4291 §2.2](https://www.rfc-editor.org/rfc/rfc4291.html#section-2.2)。

**CIDR** 的 `/數字` 表示網路前綴有多少個位元，不是連接埠，也不是主機數量。
例如 `192.0.2.10/24` 的前 24 位元是前綴，對應 `192.0.2.0/24`，涵蓋 `192.0.2.0` 到 `192.0.2.255`；
這是在算位址範圍，不表示範圍內每個位址都能分配給一般主機。
`2001:db8::10/64` 則表示 IPv6 位址的前 64 位元是前綴。
參考 [RFC 4632 §3.1](https://www.rfc-editor.org/rfc/rfc4632.html#section-3.1)與
[RFC 4291 §2.3](https://www.rfc-editor.org/rfc/rfc4291.html#section-2.3)。

本文用 `192.0.2.0/24`、`198.51.100.0/24` 與 `2001:db8::/32` 中的位址表示假想網路。
它們是文件示範用範圍，不能拿來期待實際連通；`example.com` 也是保留的示例名稱，不是本文架設的測試服務。
來源：[RFC 5737](https://www.rfc-editor.org/rfc/rfc5737.html)、
[RFC 3849](https://www.rfc-editor.org/rfc/rfc3849.html)、[RFC 2606 §3](https://www.rfc-editor.org/rfc/rfc2606.html#section-3)。

### Loopback 是回到自己

Linux 常見的 `lo` 是 loopback 介面，讓本機程序透過網路協定與本機溝通。
IPv4 的 `127.0.0.1` 是常用 loopback 位址，IPv6 對應 `::1`。
連到這些位址，不會是在連另一台電腦；每台電腦的 `127.0.0.1` 都指向自己。
參考 [`ip(7)` 的特殊位址](https://man7.org/linux/man-pages/man7/ip.7.html)與
[RFC 4291 §2.5.3](https://www.rfc-editor.org/rfc/rfc4291.html#section-2.5.3)。

所以，在伺服器自己連到 `127.0.0.1:8080` 成功，只證明這條本機路徑可用。
它沒有測試其他電腦經過網卡、路由與防火牆進來的路徑。

## 路由決定往哪裡送

**路由（routing）**根據目的位址等條件選擇出口與下一跳。
同一鏈路上的目的地可以直接送出；其他目的地常需要交給路由器。
**預設閘道（default gateway）**是常見預設路由的下一跳，但不是所有網路都必須以同一形式設定閘道。
在一般依目的前綴選路的情境，越長、越具體的匹配前綴優先；Linux 也支援政策路由，不能只把整個系統想成一張固定表。
參考 [RFC 4632 §5.1](https://www.rfc-editor.org/rfc/rfc4632.html#section-5.1)與
iproute2 [`ip-route(8)`](https://man7.org/linux/man-pages/man8/ip-route.8.html)。

以下查詢 IPv4 與 IPv6 路由，最後一行詢問核心「若送往這個示例位址，會怎樣選路」：

```bash
ip -4 route show
ip -6 route show
ip route get 198.51.100.20
```

`route get` 是查詢，不會送出測試封包；它能說明核心當下的選路結果，不能證明下一跳或目的服務真的有回應。
`route show` 預設查看的表也不等於所有政策路由資訊。語意見 [`ip-route(8)`](https://man7.org/linux/man-pages/man8/ip-route.8.html)。

假想的 IPv4 路由片段如下，**不是實測輸出，也不是要套用的設定**：

```text
default via 192.0.2.1 dev enp1s0
192.0.2.0/24 dev enp1s0 proto kernel scope link src 192.0.2.10
```

第二行表示這個前綴的直接鏈路路由；第一行的 `default` 相當於 IPv4 的 `0.0.0.0/0`。
若沒有更具體的匹配，假想的 `198.51.100.20` 會經 `enp1s0` 交給下一跳 `192.0.2.1`。
`via` 是下一跳，`dev` 是出口，`src` 是偏好的來源位址；它們都不是 DNS 伺服器欄位。
IPv6 的預設前綴則是 `::/0`。參考 [`ip-route(8)` 的 prefix、via、dev 與 src](https://man7.org/linux/man-pages/man8/ip-route.8.html)。

## 名稱解析不只是一份 DNS 設定檔

程式拿到 `example.com` 這個名稱時，需要先取得可使用的位址。
DNS 是名稱解析的重要機制，A 記錄提供 IPv4 位址、AAAA 記錄提供 IPv6 位址；但本機名稱解析也可能使用靜態檔案與其他來源。
DNS 記錄背景見 [BIND 官方文件：Zone Files](https://bind9.readthedocs.io/en/latest/chapter3.html#example-com-base-zone-file)。

在 glibc 系統上，**NSS（Name Service Switch）**透過 `/etc/nsswitch.conf` 決定 `hosts` 等資料庫查哪些來源、順序為何，以及遇到結果後是否繼續查。
例如 `files` 與 `dns` 是不同來源；不能一律宣稱系統必定「先 hosts 再 DNS」。
來源：[`nsswitch.conf(5)`](https://man7.org/linux/man-pages/man5/nsswitch.conf.5.html)。

| 檔案／工具 | 用途與界線 |
| --- | --- |
| `/etc/hosts` | 靜態記錄 IP 與名稱的對應；是否由某個程式採用，取決於它的解析路徑 |
| `/etc/nsswitch.conf` | 在 glibc 等適用環境中，控制名稱服務來源與動作 |
| `/etc/resolv.conf` | 傳統 resolver 使用的 DNS 伺服器、搜尋網域等設定；不是所有解析機制的唯一真相 |
| `getent ahosts` | 經由 NSS 與 `getaddrinfo()` 查詢位址，適合觀察採用這條解析路徑的應用所見結果 |

檔案格式與工具語意見 [`hosts(5)`](https://man7.org/linux/man-pages/man5/hosts.5.html)、
[`resolv.conf(5)`](https://man7.org/linux/man-pages/man5/resolv.conf.5.html)與
[`getent(1)`](https://man7.org/linux/man-pages/man1/getent.1.html)。

只讀檢查可以從這些命令開始；最後一行可能觸發 DNS 等網路查詢：

```bash
cat /etc/hosts
cat /etc/nsswitch.conf
ls -l /etc/resolv.conf
cat /etc/resolv.conf
getent ahosts example.com
```

假想預期是 `getent` 列出位址、socket 類型與名稱等資訊，實際內容取決於本機與解析結果。
同一位址可能因 `STREAM`、`DGRAM` 等類型重複列出；**這些列不是測試遠端 TCP／UDP 服務的結果**。
結果也可能依本機位址家族設定受到篩選，不能拿它當作 DNS 區域中所有 A／AAAA 記錄的完整清單。
`ahosts` 的 `getaddrinfo()` 行為見 [`getent(1)`](https://man7.org/linux/man-pages/man1/getent.1.html)與
[`getaddrinfo(3)`](https://man7.org/linux/man-pages/man3/getaddrinfo.3.html)。

使用 systemd-resolved 的主機，`/etc/resolv.conf` 可能是符號連結，也可能只列本機 stub resolver `127.0.0.53`。
這不表示上游 DNS 在這個 loopback 位址；本機服務可以再依介面、網域與自身設定選擇上游。
因此，單看該檔案不一定能得知完整的 VPN 或每介面 DNS 行為，也不應直接覆寫它來「修網路」。
只有確認系統使用 systemd-resolved 且具有對應工具時，才可用以下只讀查詢補充：

```bash
resolvectl status
```

不同整合模式與檔案管理方式見 [systemd-resolved 官方文件](https://www.freedesktop.org/software/systemd/man/latest/systemd-resolved.service.html)。
此外，自帶 resolver、使用代理或加密 DNS 的應用，可能走不同路徑；`getent` 成功也不能保證每個應用的解析結果完全相同。

## 連接埠、socket 與 listening

IP 位址之後，還需要辨認要交給哪個通訊端點。
**連接埠（port）**是 TCP、UDP 等傳輸協定中的數字識別；相同數字的 TCP port 與 UDP port 是不同空間。
**Socket** 是程序使用的通訊介面；本文關注 IP socket，但 Linux 也有不使用 IP 的 UNIX domain socket。
參考 Linux [`socket(7)`](https://man7.org/linux/man-pages/man7/socket.7.html)與
[`ip(7)`](https://man7.org/linux/man-pages/man7/ip.7.html)。

| 協定 | 基本行為 | 觀察時要注意 |
| --- | --- | --- |
| TCP | 建立連線，提供可靠、有順序的位元組串流 | `LISTEN` 表示等待接受連線，不表示應用功能一定正常 |
| UDP | 傳送資料報，本身不保證送達、順序或去除重複 | 沒有 TCP 那樣的連線握手與 `LISTEN` 狀態，綁定位址仍可接收資料報 |

來源：Linux [`tcp(7)`](https://man7.org/linux/man-pages/man7/tcp.7.html)與
[`udp(7)`](https://man7.org/linux/man-pages/man7/udp.7.html)。

用 iproute2 的 `ss` 查看本機 socket：

```bash
ss -ltn
ss -lun
```

`-l` 篩選供接收的 socket，`-t` 選 TCP、`-u` 選 UDP，`-n` 用數字顯示位址／port，避免以服務名稱代替數字。
UDP 輸出常見 `UNCONN`，不能因為沒有 TCP 的 `LISTEN` 就判定服務沒啟動。
若需要關聯程序，可用 `ss -ltnp`，但程序資訊的可見性受權限限制，不必為了第一輪觀察直接使用管理員權限。
選項見 [`ss(8)`](https://man7.org/linux/man-pages/man8/ss.8.html)。

### 綁定在哪個位址，影響誰能連進來

以下是**假想的本地端點欄位**，不是實測 socket 清單：

| 本地端點 | 綁定的意義 |
| --- | --- |
| `127.0.0.1:8080` | IPv4 loopback，其他機器不能直接連到這個 socket |
| `[::1]:8080` | IPv6 loopback |
| `192.0.2.10:8080` | 指定的本機 IPv4 位址 |
| `0.0.0.0:8080` | IPv4 wildcard，綁定所有本地 IPv4 位址 |
| `[::]:8080` | IPv6 wildcard；是否也接受 IPv4，取決於 `IPV6_V6ONLY` 等設定 |

`0.0.0.0` 與 `::` 在這裡是**綁定語意**，不是要交給遠端使用者連線的伺服器位址。
相關定義見 [`ip(7)`](https://man7.org/linux/man-pages/man7/ip.7.html)與
[`IPV6_V6ONLY(2const)`](https://man7.org/linux/man-pages/man2/IPV6_V6ONLY.2const.html)。

綁定所有本地位址會擴大可能的接收範圍，但仍不能推定服務已向公網開放：路由、主機防火牆、雲端網路規則及 NAT 等會影響外部到達路徑。
反過來，防火牆放行也不會讓只綁定 loopback 的 socket 自動改成對外接收。
本機防火牆是另外一個封包處理邊界，可參考 [Netfilter 官方 nftables 說明](https://wiki.nftables.org/wiki-nftables/index.php/What_is_nftables%3F)。
排查時應先記下綁定位址，再確認實際網路邊界；本文不提供停用防火牆或擴大綁定的操作。

若在容器或 network namespace 內查詢，看到的介面、路由與 socket 是該命名空間的視角，未必等於主機全貌。
尤其容器內的 loopback 指向容器所在的網路命名空間。
參考 Linux [`network_namespaces(7)`](https://man7.org/linux/man-pages/man7/network_namespaces.7.html)。

## ping 與 curl 各自測到哪裡

### ping：ICMP 回應，不是網站健康檢查

以下僅展示 iputils 語法，**未執行**；示範位址不預期在真實網路回覆：

```bash
ping -c 3 -W 2 192.0.2.1
```

`-c 3` 限制送出次數，`-W 2` 設定等待回應的時間，完整行為依 iputils 手冊。
`ping` 透過 ICMP Echo Request／Reply 觀察回應與往返時間，沒有測試 TCP 443 或 HTTP。
假想若收到回覆，只能說當時 ICMP 測試獲得回覆；若沒收到，也可能是 ICMP 被過濾或限速，不能單憑它認定主機關機。
使用名稱作為目的地還會加入名稱解析因素，所以已知 IP 與名稱是不同的診斷條件。
參考 iputils [`ping(8)`](https://man7.org/linux/man-pages/man8/ping.8.html)。

### curl：觀察一次應用協定請求

下面展示 HTTPS 查詢，**未執行，也沒有保證的 HTTP 狀態碼或輸出內容**：

```bash
curl --connect-timeout 5 --max-time 10 --include https://example.com/
```

這會提出 GET 請求，`--include` 顯示回應標頭；`--connect-timeout` 限制連線階段，包含名稱解析與所需握手，`--max-time` 限制整次操作時間。
假想若收到 HTTP 404，表示取得 HTTP 回應但目標資源未找到；不代表 DNS 或 TCP 完全失敗。
未加 `--fail` 時，不能僅以 curl 結束碼為 0 判定 HTTP 狀態符合需求。
來源：[curl 官方手冊](https://curl.se/docs/manpage.html)。

HTTPS 還涉及 TLS 與憑證驗證；名稱解析成功、連線被拒絕、連線逾時、憑證驗證失敗與 HTTP 錯誤，應分開記錄。
curl 的代理環境變數或設定檔也可能改變實際路徑；透過代理取得回應，不表示本機已直接連到目標主機。
排查憑證失敗時，不要用略過驗證的選項掩蓋原因。工具行為見 [curl 官方手冊的代理、TLS 與結束碼說明](https://curl.se/docs/manpage.html)。
HTTP 的資源、訊息與回應語意，另見[資源、表示與訊息](../api/resources-representations-and-messages.md)。

## 依證據逐層縮小問題

假設「本機連得到服務，另一台電腦連不到」，可以沿著下面的順序查，不必每次從頭執行所有工具。
每一步都是查詢或觀察；要測試真實目的地，應換成自己有權測試的服務與位址。

| 步驟 | 要回答的問題 | 工具與證據 | 下一個判斷 |
| --- | --- | --- | --- |
| 1. 明確界定請求 | 哪台客戶端、哪個名稱、協定、port、時間？ | 記錄完整 URL 與原始錯誤 | 避免拿不同客戶端或不同協定的結果互相比較 |
| 2. 查看服務端點 | 服務是否存在、綁定到哪裡？ | 服務主機的 `ss -ltn`／`ss -lun` | 只綁 loopback 時，外部不能直接連這個 socket；沒有端點則查程序與服務日誌 |
| 3. 查看介面與位址 | 客戶端與服務端是否有預期介面與 IP？ | `ip link show`、`ip address show` | 先分辨裝置、位址與實際觀察視角 |
| 4. 查看選路 | 對目的 IP 使用哪個出口與下一跳？ | `ip route get`、IPv4／IPv6 路由 | 有路由不等於封包已通；無合適路由則先釐清網路設定的管理者 |
| 5. 查看名稱解析 | 這台主機把名稱解成什麼？ | `getent ahosts`，必要時查看 NSS 與 resolver 狀態 | IP 家族、VPN DNS 與應用解析路徑可能不同 |
| 6. 測試所需協定 | 問題停在連線、TLS 還是 HTTP？ | 適當的客戶端，例如 curl 的錯誤與回應 | ping 只提供 ICMP 的旁證，不能代替服務測試 |
| 7. 比對邊界與日誌 | 哪個環節拒絕、丟棄或回覆？ | 主機與網路規則、服務／代理日誌 | 依證據處理，不先改路由、DNS 或停防火牆碰碰運氣 |

例如，`getent` 能取得位址，代表這次名稱查詢有結果；`ss` 只有 `127.0.0.1:8080`，則指出直接外部連線的綁定邊界。
這是兩項不同證據，不能用「DNS 正常」解釋或排除綁定問題。
若收到 HTTP 503，則應往回應者、代理與後端服務的狀態查，並保留原始回應資訊。
程序與服務的後續觀察，見[程序](processes-and-jobs.md)及[服務與日誌](services-and-logs.md)。

## 相關文件與來源範圍

- [Linux 知識索引](README.md)：回到其他系統基礎主題。
- [認識 Linux](what-is-linux.md)：區分核心、使用者空間與發行版。
- [程序](processes-and-jobs.md)、[服務與日誌](services-and-logs.md)：將 socket 觀察接回程序與服務狀態。
- [iproute2 原始碼與手冊來源](https://git.kernel.org/pub/scm/network/iproute2/iproute2.git/)：本文採用 man7 呈現的上游 `ip`／`ss` 手冊，頁尾標示其 iproute2 來源；它們不是所有類 Unix 系統的通用命令介面。
- [Linux man-pages 專案](https://www.kernel.org/doc/man-pages/)：本文引用的核心與函式庫介面，以及相關檔案格式手冊。

本文完成文件查證與靜態檢查，沒有 Linux 介面、路由、DNS、socket 或連通性的實測證據。
實際輸出必須在讀者自己的 Linux 環境觀察，並依發行版、工具版本、權限與網路命名空間解讀。
