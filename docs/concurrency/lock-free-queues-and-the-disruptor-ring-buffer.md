# 無鎖並行資料結構：Lock-Free Queue 與 Disruptor 環狀緩衝

在非同步架構與生產者-消費者模式中，佇列（Queue）是解耦不同模組最關鍵的樞紐。然而，傳統基於互斥鎖的阻塞佇列（如 `ArrayBlockingQueue`），在每秒數百萬筆事件的超高頻交易與網路框架中，會因為鎖競爭、上下文切換與動態記憶體配置而成為全系統的瓶頸。

本篇將深入剖析並行計算史上的經典無鎖佇列——**Michael-Scott 佇列**，並深度解密金融撮合領域的極限效能神話——**LMAX Disruptor** 環狀緩衝區架構。

## 傳統加鎖佇列的三大效能枷鎖

傳統阻塞佇列（Blocking Queue）的內部實作通常包含一個陣列或鏈結串列，並搭配兩把互斥鎖（`putLock` 與 `takeLock`）及條件變數（`notEmpty` 與 `notFull`）：

```
生產者 ──▶ [ putLock 加鎖 ] ──▶ [ 入隊 ] ──▶ [ 喚醒消費者 notEmpty ] ──▶ [ 解鎖 ]
消費者 ──▶ [ takeLock 加鎖 ] ──▶ [ 出隊 ] ──▶ [ 喚醒生產者 notFull ]  ──▶ [ 解鎖 ]
```

這種架構在巨量高頻負載下暴露三大痛點：
1. **鎖競爭與 Context Switch**：每次佇列存取都伴隨 Futex/Mutex 加鎖與解鎖；當佇列為空或滿時，執行緒被核心掛起休眠，喚醒時付出數微秒的上下文切換代價。
2. **動態記憶體分配與 GC 壓力**：鏈結佇列在每次入隊時都需要在堆積（Heap）上 `new Node()`，出隊後丟棄給垃圾回收器（GC），引發頻繁的記憶體分配開銷、快取失效與 GC 停頓。
3. **快取行顛簸 (False Sharing)**：佇列的頭部指標（Head）與尾部指標（Tail）往往緊鄰存放，生產者修改 Tail 與消費者修改 Head 頻繁引發 CPU 快取行失效。

## 經典無鎖鏈結佇列：Michael-Scott Queue (1996)

1996 年，Maged M. Michael 與 Michael L. Scott 在 PODC 研討會上發表了著名的無鎖佇列演算法（Java 中的 `ConcurrentLinkedQueue` 即為其工業實作）。

### 結構核心：哨兵節點與 CAS 協同推進
Michael-Scott 佇列是一個單向鏈結串列，其精妙之處在於**永遠保留一個 Dummy（哨兵）頭節點**：

```
初始狀態：
Head ──▶ [ Dummy 節點 (value = null, next = null) ] ◀── Tail
```

- **入隊演算法 (Enqueue)**：
  1. 讀取當前的 `tail` 與其下一個節點 `tail->next`。
  2. 檢查 `tail` 是否已被其他執行緒推進；若尚未推進，使用原子 CAS 嘗試將 `tail->next` 由 `null` 指向新節點。
  3. 若 CAS 成功，新節點已鏈結入串列；隨後再次透過 CAS 推進 `tail` 指向新節點。
  4. **協助機制 (Helping Mechanism)**：若步驟 2 中發現 `tail->next` 已經非空（說明有另一個執行緒剛接上新節點，但尚未推進 `tail` 就被中斷了），當前執行緒不會傻等，而是**主動協助那個慢速執行緒將 `tail` 推進至 `tail->next`**！這種自愈協同設計徹底消除了單點延遲。
- **出隊演算法 (Dequeue)**：
  1. 讀取 `head`、`tail` 與首個有效資料節點 `first = head->next`。
  2. 若 `head == tail`：
     - 若 `first == null`，佇列為空（返回空值）。
     - 若 `first != null`，說明有並行入隊操作接上了新節點但尚未推進 `tail`（Tail 落後）；此時出隊執行緒必須**主動協助透過 CAS 將 `tail` 推進至 `first`**，隨後重新嘗試。
  3. 若 `head != tail`：透過原子 CAS 嘗試將 `head` 指針推進為 `first`。CAS 成功者獲得原 `first` 節點中的數值，並將原 `first` 節點晉升為新的 Dummy 哨兵節點。

Michael-Scott 佇列全程零互斥鎖，只要有執行緒在嘗試，全系統就必定能在有限步數內完成入隊或出隊。

## 金融撮合巔峰：LMAX Disruptor 環狀緩衝架構

雖然 Michael-Scott 佇列消除了鎖，但鏈結節點的動態記憶體分配與指標追蹤依然無法滿足微秒級（Sub-microsecond）低延遲交易的需求。英國外匯交易平台 LMAX 開發了 **Disruptor**，在單一執行緒內達成了每秒處理 **600 萬筆交易**、延遲小於 1 微秒的極限記錄。

```
              Disruptor RingBuffer (固定大小為 2 的冪次方)
                             [ Slot 0 ]
                    [ Slot 7 ]         [ Slot 1 ]
                [ Slot 6 ]                 [ Slot 2 ]
                    [ Slot 5 ]         [ Slot 3 ]
                             [ Slot 4 ]
                                 ▲
                                 │
                   Producer Sequence (游標單調遞增)
```

Disruptor 的四大顛覆性硬體級設計：

### 1. RingBuffer 預分配陣列 (Zero Allocation)
Disruptor 徹底摒棄鏈結串列，採用**連續的固定大小陣列**。在系統初始化時，Disruptor 一次性建立好陣列中的所有業務事件物件（例如預先建立 65536 個 `OrderEvent`）。
在系統運行期間，生產者只修改已有物件的內部欄位，**零動態記憶體分配、零物件銷毀、零 GC 壓力**，且連續記憶體對 CPU 預取器（Hardware Prefetcher）極度友好。

### 2. 位元與運算快速取模 (Fast Modulo)
RingBuffer 的長度強制設定為 2 的冪次方（$2^n$，如 1024、65536）。游標（Sequence）是一個 64 位元長整數，從 0 開始單調無界遞增。計算陣列實體索引時，無需使用耗時的 CPU 除法／取模指令（`%`），直接採用超高速的位元與運算（`&`）：
$$\text{Index} = \text{Sequence} \ \& \ (\text{BufferSize} - 1)$$

### 3. 快取行填充 (Cache Line Padding) 消除偽共享
在 Disruptor 中，代表生產者與消費者進度的核心游標類別 `Sequence`，內部透過填充無意義的 `long` 變數（前後各 56 位元組），**確保該 Sequence 變數獨佔一整條 64-byte Cache Line**，徹底消除了多核心 CPU 匯流排上的偽共享顛簸。

### 4. 序號屏障 (Sequence Barrier) 與單一寫者無鎖管線
在 Disruptor 中，若採用單一生產者模式（Single Producer），生產者甚至連 CAS 指令都不需要！生產者只需要在自己的私有暫存器中遞增 Sequence，並在寫入資料後發佈一條寫入記憶體屏障。

消費者透過 **Sequence Barrier** 監視生產者的發布進度。消費者之間可以組成流水線依賴圖（例如：Handler A 負責解密、Handler B 負責風控校驗、Handler C 負責撮合），每個 Handler 只需要比對前置 Handler 的 Sequence 即可並行推進，無需任何排他鎖。

```
生產者 (Publish Seq = 100)
    │
    ▼
[ Handler A: 網路封包解碼 ] (處理至 Seq = 100)
    │
    ▼
[ Handler B: 交易業務校驗 ] (只需確保自己處理的 Seq <= Handler A 的 Seq)
    │
    ▼
[ Handler C: 磁碟日誌刷盤 ]
```

## 常見誤解與邊界

1. **誤解：Disruptor 可以在所有後端專案中無腦取代 Kafka 或 Redis 佇列**
   Disruptor 是一個**行程內的記憶體通訊框架 (In-Memory Inter-Thread Framework)**，它解決的是「單機多執行緒間超高速交換資料」的問題；而 Kafka 與 Redis 是分散式中介軟體，解決的是「跨主機節點、跨進程持久化解耦」的問題，兩者處於完全不同的架構層級。
2. **誤解：無鎖佇列的容量可以無限大**
   Disruptor 採用固定長度的預分配環狀緩衝，容量有限。當生產速度遠大於消費速度且環被填滿時，生產者必須等待（或採取特定丟棄策略）。無鎖並不代表可以無視容量邊界，背壓（Backpressure）設計依然不可或缺。

## 相關文件與參考來源

- [比較並交換 (CAS) 與原子操作](compare-and-swap-atomics-and-the-aba-problem.md)：回顧 CAS 指令與 ABA 問題防禦基礎。
- [CPU 快取階層與一致性](cpu-cache-hierarchy-mesi-and-false-sharing.md)：理解 Cache Line 填充對消除偽共享的關鍵作用。
- 參考文獻：
  - Michael, M. M., & Scott, M. L., *Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms*, PODC 1996.
  - Martin Fowler, *The LMAX Architecture*, Technical Report (2011).
  - Thompson, P. et al., *Disruptor: High performance alternative to bounded queues for exchanging data between concurrent threads*, LMAX Whitepaper.
