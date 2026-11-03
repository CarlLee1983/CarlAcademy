# TCP 基礎：連線生命週期與流量控制

TCP 是傳輸層中提供可靠、雙向全雙工、循序位元組流傳遞的連線導向協定，透過序號、確認應答與滑動視窗克服不可靠 IP 網路的限制。
底層的 IP 網路本質上是「盡力而為（Best-Effort）」的，封包可能會遺失、延遲、重複或順序錯亂；TCP 的使命便是在不可靠的傳輸介質之上，向應用程式提供如同有線電話般穩固的位元組串流通道。

本文接續[封包交換與網路分層模型](packet-switching-and-network-models.md)，並與低延遲替代方案[UDP 與無連線傳輸](udp-and-connectionless-transport.md)以及應用層[逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)對照。

## TCP 的核心特徵與承諾

與 UDP 相比，TCP（Transmission Control Protocol，現代規範整合於 RFC 9293）對上層應用程式提供了四大核心承諾：

1. **連線導向（Connection-Oriented）**：在傳送任何實際資料之前，雙方必須先透過交握建立連線狀態，並在通訊完畢後協調釋放狀態。
2. **保證送達與確認（Reliable Delivery）**：傳送的資料若在網路中丟失，TCP 會自動偵測並重新傳送，直到接收端確認收到為止。
3. **循序交付（In-Order Delivery）**：若封包因路徑不同而後發先至，接收端的 TCP 堆疊會依序號重新排列，保證交給應用程式的資料順序與發送端完全一致。
4. **位元組串流（Byte Stream）**：TCP 不維護應用層的訊息邊界，它將資料視為一連串無結構的位元組串流（Stream），發送端呼叫三次 `write()` 的資料，接收端可能一次 `read()` 全部讀出。

## 連線建立：三方交握（Three-Way Handshake）

為了同步雙方的初始序號（Initial Sequence Number, ISN）並確認雙向發送與接收能力皆正常，TCP 必須在通訊前執行**三方交握**：

```
用戶端 (Client)                                伺服器 (Server)
    |                                                | [LISTEN]
    | ---- 1. SYN (seq=x) -------------------------> | [SYN_RCVD]
    |                                                |
    | <--- 2. SYN-ACK (seq=y, ack=x+1) ------------- |
    | [ESTABLISHED]                                  |
    |                                                |
    | ---- 3. ACK (seq=x+1, ack=y+1) --------------> | [ESTABLISHED]
    v                                                v
```

1. **第一步（SYN）**：用戶端選擇一個隨機初始序號 $x$，發送帶有 `SYN=1` 的控制封包，進入 `SYN_SENT` 狀態，請求建立連線。
2. **第二步（SYN-ACK）**：伺服器收到後分配連線資源，隨機挑選自己的初始序號 $y$，回傳帶有 `SYN=1, ACK=1` 的封包，其中確認號為 $x+1$（代表已收到用戶端的第 $x$ 位元組，期待接收 $x+1$），進入 `SYN_RCVD` 狀態。
3. **第三步（ACK）**：用戶端收到伺服器的 SYN-ACK 後，確認自己的發送與伺服器的發送皆正常，進入 `ESTABLISHED`；接著回傳帶有 `ACK=1, ack=y+1` 的封包。伺服器收到此 ACK 後，同樣進入 `ESTABLISHED`。此時雙向連線正式建立，第三次握手的封包中已允許夾帶應用層的第一筆有效負載。

> **為什麼需要隨機化 ISN？**
> 若所有 TCP 連線初始序號都從 0 開始，當舊連線延遲滯留在網路中的迷途封包抵達剛建立的新連線時，新連線無法區分這是歷史封包還是新資料，可能造成嚴重的資料污染；隨機序號同時能有效防範惡意第三方偽造序號進行 TCP 劫持攻擊。

## 連線終止：四方揮手（Four-Way Wave）與 `TIME_WAIT`

由於 TCP 是全雙工（Full-Duplex）通訊，兩個方向的資料傳輸是彼此獨立關閉的。當一方發送完畢，僅代表它不再發送新資料，但仍可能繼續接收對方的資料，因此關閉連線需要經歷**四次揮手**：

```
主動關閉端 (Active Closer)                     被動關閉端 (Passive Closer)
    | [ESTABLISHED]                                  | [ESTABLISHED]
    | ---- 1. FIN (seq=u) -------------------------> | [CLOSE_WAIT]
    | [FIN_WAIT_1]                                   |
    | <--- 2. ACK (ack=u+1) ------------------------ |
    | [FIN_WAIT_2]                                   |
    |                                                | (處理剩餘緩衝區資料)
    | <--- 3. FIN (seq=w, ack=u+1) ----------------- | [LAST_ACK]
    | [TIME_WAIT]                                    |
    | ---- 4. ACK (ack=w+1) -----------------------> | [CLOSED]
    |                                                |
    | (等待 2MSL 後釋放)                             |
    v [CLOSED]                                       v
```

### 為什麼主動關閉端必須停留在 `TIME_WAIT`？

在第四步發出最後的 ACK 之後，主動關閉端**不會立即銷毀 Socket**，而是必須在核心中保持 `TIME_WAIT` 狀態長達 **$2 \times \text{MSL}$（Maximum Segment Lifetime，通常為 1 到 2 分鐘）**：

1. **確保最後一個 ACK 確實送達**：若主動關閉端發出的最後 ACK 在網路中遺失，被動端會因為逾時而重新發送第三步的 FIN。若主動端已提前關閉，收到重發的 FIN 時會回覆 RST 錯誤，導致被動端異常終止。停留 2MSL 足夠讓重傳的 FIN 抵達並讓主動端補發 ACK。
2. **讓迷途封包在網路中徹底消亡**：防止舊連線中殘留的延遲封包，在該「四元組（來源 IP、來源 Port、目的 IP、目的 Port）」被立刻復用於新連線時，被新連線錯誤當作合法資料接收。

在伺服器高併發場景下，大量短連線（如未開啟 HTTP Keep-Alive 的請求）會導致伺服器主動關閉時堆積數萬個 `TIME_WAIT` 狀態佔用連接埠與記憶體，應透過連線池（Connection Pooling）或長連線降低頻繁揮手的開銷。

## 可靠傳輸：序號、確認應答與重傳機制

TCP 將位元組串流中的**每一個位元組**都編上連續的整數序號（Sequence Number）：
- **累積確認（Cumulative ACK）**：ACK 號碼代表「接收端已經正確、連續收到了此號碼之前的所有位元組，期望下一次收到該號碼開頭的資料」。
- **逾時重傳（RTO, Retransmission Timeout）**：發送端在發送一個區段後啟動定時器。若在 RTO 倒數結束前未收到 ACK，發送端認定封包遺失並觸發重傳。RTO 是根據持續測量網路的往返時間（RTT, Round-Trip Time）動態計算平滑而得。
- **快速重傳（Fast Retransmission）**：當接收端收到失序的區段（例如收到了 1~1000 與 2001~3000，唯獨遺失 1001~2000）時，每收到一個後續封包就重複發送一次最後一個連續序號的 ACK（稱為 Duplicate ACK）。當發送端連續收到 3 個重複的 ACK 時，不等定時器超時，立即重傳遺失的區段。

## 流量控制：滑動視窗（Sliding Window）

為了避免發送端傳輸過快，導致接收端作業系統核心緩衝區（Receive Buffer）溢位而被迫丟棄封包，TCP 實作了**流量控制（Flow Control）**機制：

- 接收端在每次回傳的 TCP 標頭中，都會填寫 **`Window Size`（接收視窗大小，rwnd）**，向發送端明確通告：「我目前緩衝區還能再收多少位元組」。
- 發送端的「未確認在途資料量（In-Flight Bytes）」嚴格不得超過對方的 `rwnd`。
- 若接收端應用程式處理過慢，緩衝區被填滿，接收端會通告 `rwnd = 0`（零視窗，Zero Window）。此時發送端必須暫停發送，並定期發送「零視窗探測封包（Window Probe）」以得知接收端何時騰出空間恢復傳輸。

## 壅塞控制（Congestion Control）概覽

流量控制只保護了接收端，但無法感知整個中間網際網路路由器的負載。若全網所有主機同時全速發送，中間路由器佇列爆滿將造成大規模丟包與網路崩潰（Congestion Collapse）。
因此 TCP 在發送端維護了一個**壅塞視窗（Congestion Window, cwnd）**，實際發送上限為 $\min(\text{cwnd}, \text{rwnd})$：

1. **慢啟動（Slow Start）**：連線剛建立時，`cwnd` 從極小的數值開始（通常為 10 個 MSS），每收到一個確認 ACK，`cwnd` 呈**指數型增長**，迅速探測可用頻寬。
2. **壅塞避免（Congestion Avoidance）**：當 `cwnd` 達到慢啟動門檻（ssthresh）後，轉為**加性增長（Additive Increase）**，每個 RTT 僅增加 1 個 MSS，謹慎逼近瓶頸頻寬。
3. **壅塞偵測與降速**：一旦發生丟包，TCP 認定網路發生壅塞，立即將門檻減半並大幅縮減 `cwnd`（乘性減少，Multiplicative Decrease），即著名的 AIMD（加性增長乘性減少）演算法，維持全網資源共享的動態穩定。

## 相關主題與參考來源

- [封包交換與網路分層模型](packet-switching-and-network-models.md)：理解傳輸層在網路堆疊中的分工。
- [UDP 與無連線傳輸](udp-and-connectionless-transport.md)：對比不需要交握與可靠性狀態維護的無連線通訊模型。
- [逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)：理解應用層如何在 TCP 傳輸逾時或中斷時進行重試與防重設計。
- [RFC 9293 - Transmission Control Protocol (TCP)](https://www.rfc-editor.org/rfc/rfc9293.html)：現代最新整合之 TCP 完整協定標準規範。
