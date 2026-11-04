# HTTP 演進：從 HTTP/1.1、HTTP/2 到 HTTP/3 (QUIC)

HTTP 是全球資訊網的應用層基礎，歷經三十餘年的演進，其底層通訊架構從早期明文、短連線與管道化，走向二進位多路複用，最終在 HTTP/3 突破 TCP 限制，轉移至基於 UDP 的 QUIC 傳輸協定。
理解這段演進過程，能清楚看見現代分散式系統與 Web 應用如何在吞吐量、往返延遲（RTT）與隊頭阻塞（Head-of-Line Blocking）之間做出工程權衡。

本文接續[TLS 傳輸層安全：交握協商、密鑰交換與安全通道](tls-and-secure-transport.md)、[TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)與[UDP 與無連線傳輸](udp-and-connectionless-transport.md)，並與應用層[資源、表示與訊息](../api/resources-representations-and-messages.md)及[逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)對照。

## HTTP/1.0 與 HTTP/1.1：文字協定與長連線

早期 HTTP/1.0（RFC 1945）採用簡單的「一請求一連線」模型：用戶端每發起一次 HTTP 請求，都必須與伺服器建立一次完整的 TCP 三方交握；伺服器傳送完回應後立即關閉連線。在高資源量的現代網頁中，載入數十個靜態資源將導致嚴重的 TCP 慢啟動延遲與連線開銷。

HTTP/1.1（現代規格整合於 RFC 9112）奠定了長達二十年的 Web 基礎，帶來了關鍵通訊改善：

1. **持久連線（Persistent Connections / Keep-Alive）**：預設啟用長連線，允許多個循序的 HTTP 請求與回應復用同一條已建立的 TCP 連線，大幅減少三方交握次數並避免重複經歷慢啟動。
2. **管道化（Pipelining）**：允許用戶端在收到前一個請求的回應前，先送出後續請求。然而，伺服器**必須嚴格依照收到請求的先後順序回傳回應**。若第一個請求處理耗時（如繁重的資料庫查詢），後續所有已處理完畢的靜態資源回應皆會被卡在伺服器佇列中無法發送，此即**HTTP 應用層隊頭阻塞（HTTP Head-of-Line Blocking）**。
3. **分塊傳輸編碼（Chunked Transfer-Encoding）**：允許伺服器在尚未得知內容總長度（`Content-Length`）前，動態生成資料並切成小塊串流發送。
4. **瀏覽器因應手段（多連線平行抓取）**：為繞過隊頭阻塞，瀏覽器對同一個網域名稱普遍開啟 6 條獨立的 TCP 連線平行下載資源，但也加劇了伺服器連線負擔與 TCP 壅塞控制競爭。

## HTTP/2：二進位框架與多路複用

為了徹底解決 HTTP/1.1 的文字剖析低效與應用層隊頭阻塞，IETF 於 2015 年發布了 HTTP/2（RFC 7540，最新規範為 RFC 9113），在不改變 HTTP 語意（方法、狀態碼、標頭）的前提下，徹底重構了傳輸層表現：

### 1. 二進位分幀層（Binary Framing Layer）

HTTP/2 將傳輸內容由 ASCII 文字轉換為二進位格式，並定義了清晰的抽象層級：
- **畫格（Frame）**：通訊的最小單位，包含固定 9 位元組的標頭，標明長度、類型、旗標與所屬串流 ID。常見類型包含 `HEADERS`（傳遞標頭）與 `DATA`（傳遞酬載）。
- **訊息（Message）**：邏輯上對應一次完整的 HTTP 請求或回應，由一個或多個畫格組成。
- **串流（Stream）**：已建立連線內的雙向位元組流，擁有唯一的整數串流識別碼（Stream ID）。

### 2. 多路複用（Multiplexing）

用戶端與伺服器之間只需**維護單一條 TCP 連線**。所有請求與回應皆切碎為帶有 Stream ID 的畫格，交錯混合穿插在同一條 TCP 連線中傳輸，接收端再依 Stream ID 重新組裝為獨立訊息。
這使得後續請求不再需要等待前一個請求回應返回，應用層隊頭阻塞在此層級被完全消弭。

### 3. HPACK 標頭壓縮與優先順序

- **HPACK 壓縮（RFC 7541）**：HTTP 請求標頭（如 User-Agent、Cookie）高度重複。HPACK 在連線兩端維護靜態字典與動態更新的索引表，相同的標頭只傳送簡短整數索引，大幅壓縮重複標頭的傳輸量。
- **串流優先權與相依性**：用戶端可為不同串流指派權重與相依樹狀結構，確保關鍵的 HTML / CSS 能優先獲得頻寬，非關鍵圖片稍後傳輸。

```
[HTTP/1.1]  Client ===== Request 1 =====> Server (Wait response 1)
                    <==== Response 1 ====
                    ===== Request 2 =====> (HOL Blocking)

[HTTP/2]    Client ----- Stream 1 Frame A -----> Server (交錯並行傳輸)
                   <---- Stream 3 Frame A -----
                    ----- Stream 1 Frame B ----->
```

## HTTP/2 的致命傷：TCP 層隊頭阻塞

雖然 HTTP/2 解決了應用層的隊頭阻塞，但其基礎仍建立在 TCP 之上。
TCP 核心協定只保證**整條連線的位元組流嚴格循序交付**。若網路環境發生偶發性丟包（Packet Loss）：

- 即使丟失的僅僅是 Stream 1 的某個畫格，作業系統核心的 TCP 接收緩衝區為了保證循序性，必須等待發送端重傳該丟失封包。
- 在重傳封包送達之前，**同一條 TCP 連線上所有後續已經安全抵達的 Stream 2、Stream 3 畫格，通通無法交付給上層應用程式**。
- 在高丟包率或不穩定的行動網路（如 4G/5G 訊號邊緣、地鐵車廂）中，HTTP/2 單連線多路複用的實際吞吐與延遲表現甚至可能遜於開立多條連線的 HTTP/1.1。

## HTTP/3 與 QUIC：以 UDP 重塑傳輸基石

為了解決跨層隊頭阻塞與長期僵化的 TCP 堆疊，Google 早期實驗 QUIC（Quick UDP Internet Connections），隨後 IETF 於 2021 年將其標準化為底層的 QUIC 傳輸協定（RFC 9000）與應用層的 HTTP/3（RFC 9114）。

### 1. 為什麼選擇 UDP？

作業系統核心中的 TCP 實作難以快速升級，且中間網路設備（Middleboxes，如防火牆、NAT 閘道）常會丟棄帶有未知 TCP 選項的封包，造成協定僵化（Ossification）。
UDP 提供無連線、極低開銷的資料報介面，使得 QUIC 能夠**在使用者空間（User-Space）**實作所有連線控制、可靠性保證與壅塞調節，兼具彈性與快速演進能力。

### 2. QUIC 的關鍵創新架構

```
+--------------------+--------------------+
|      HTTP/2        |      HTTP/3        |
+--------------------+--------------------+
|    TLS 1.2 / 1.3   | QPACK (RFC 9204)   |
+--------------------+--------------------+
|        TCP         | QUIC (RFC 9000)    |
| (OS Kernel, RFC)   | (Streams/Crypto/CC)|
+--------------------+--------------------+
|        IP          |     UDP (IP)       |
+--------------------+--------------------+
```

- **真正獨立的多串流（True Stream Independence）**：QUIC 在傳輸層原生支援串流概念。每個串流擁有獨立的位元組位移序號，若 Stream A 的封包丟失，只有 Stream A 進入等待重傳，Stream B 與 Stream C 仍能不受阻礙地立刻交付應用層，徹底斬斷跨串流隊頭阻塞。
- **整合 TLS 1.3 的 0-RTT / 1-RTT 交握**：傳統 HTTPS 需要經歷 TCP 三方交握（1 RTT）加上 TLS 交握（1~2 RTT）。QUIC 將傳輸層參數協商與 TLS 1.3 密鑰交換完全合併，首次建立連線僅需 1 RTT；若先前已建立過連線，更支援 **0-RTT（Early Data）**，發起請求的第一個封包即可夾帶加密應用資料。
- **連線識別碼（Connection ID）與連線遷移（Connection Migration）**：TCP 依賴「來源 IP、來源 Port、目的 IP、目的 Port」四元組綁定連線，行動裝置從 Wi-Fi 切換至行動網路時，IP 改變會導致所有 TCP 連線斷線重連。QUIC 引入 64 位元的 Connection ID 識別連線，即使設備 IP 改變，只要 Client ID 不變，通訊即可無縫延續，無須重新握手。
- **QPACK 標頭壓縮（RFC 9204）**：因應 QUIC 串流的失序傳遞，HTTP/3 取代 HPACK 改採 QPACK，透過控制串流單獨同步動態字典，避免因封包丟失導致標頭解碼卡死。

## 各版本特性全面比較

| 特性 | HTTP/1.1 | HTTP/2 | HTTP/3 |
| --- | --- | --- | --- |
| **底層傳輸協定** | TCP | TCP | UDP (QUIC) |
| **格式表現** | 純 ASCII 文字 | 二進位分幀 (Binary Frames) | 二進位分幀 (Binary Frames) |
| **連線復用模式** | 循序長連線 (Keep-Alive) | 單連線多路複用 (Multiplexing) | 原生多串流多路複用 |
| **應用層隊頭阻塞** | 存在（循序回應） | 已解決 | 已解決 |
| **傳輸層隊頭阻塞** | 不存在（多連線分開） | **存在（單一 TCP 丟包卡死全線）** | **完全解決（串流互不阻塞）** |
| **交握建立延遲** | 1 RTT (TCP) + TLS | 1 RTT (TCP) + TLS | **0-RTT ~ 1 RTT (合併握手)** |
| **標頭壓縮方式** | 無（明文重複發送） | HPACK（靜態/動態表） | QPACK（非同步字典更新） |
| **網路切換/漫遊** | 斷線重連 (四元組綁定) | 斷線重連 (四元組綁定) | **無縫遷移 (Connection ID)** |

## 相關主題與參考來源

- [TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)：理解 TCP 的慢啟動、循序交付與滑動視窗機制。
- [UDP 與無連線傳輸](udp-and-connectionless-transport.md)：理解 QUIC 選擇以 UDP 作為底層載體的原因。
- [TLS 傳輸層安全：交握協商、密鑰交換與安全通道](tls-and-secure-transport.md)：深入探討 TLS 1.2 與 1.3 握手在 HTTP 加密傳輸中的角色。
- [負載平衡與反向代理：L4、L7 與流量調度](load-balancing-and-reverse-proxy.md)：理解代理伺服器如何處理各版本 HTTP 終止與轉發。
- [RFC 9112 - HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html)：IETF HTTP/1.1 最新核心規範。
- [RFC 9113 - HTTP/2](https://www.rfc-editor.org/rfc/rfc9113.html)：IETF HTTP/2 二進位分幀與多路複用標準。
- [RFC 9000 - QUIC: A UDP-Based Multiplexed and Secure Transport](https://www.rfc-editor.org/rfc/rfc9000.html)：IETF QUIC 傳輸協定標準規範。
- [RFC 9114 - HTTP/3](https://www.rfc-editor.org/rfc/rfc9114.html)：IETF HTTP/3 規範與 QPACK 架構。
