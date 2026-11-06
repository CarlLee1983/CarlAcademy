# 程式執行與並行處理知識索引

從單機程式執行、行程虛擬記憶體空間與排程切換出發，理解多核心 CPU 快取層級與 MESI 協定、指令重排與 Happens-Before 記憶體模型，再深入同步原語（Mutex／Futex／RWLock／死鎖防護）、無鎖程式設計（CAS／ABA／Disruptor）與現代高併發 I/O 多工模型（epoll／io_uring／執行緒池實務）。
主線先問硬體如何執行程式、多工並發伴隨哪些一致性與記憶體開銷，再逐步展開各層同步原語、無鎖結構與 I/O 排程，不預設特定程式語言或單一作業系統。

**目前狀態：主線 12 篇已全數撰寫，依下列五個階段閱讀。**
查證日期：2026-11-06。全系列依 Linux man-pages（`clone(2)`, `futex(2)`, `epoll(7)`）、Intel 64 and IA-32 Architectures Software Developer's Manual、JSR-133 Java Memory Model、The Go Memory Model 規範、POSIX pthread 規範與經典並行計算論文整理。案例均為概念推演與架構模型，未宣稱已於特定硬體完成極限壓測；版本與硬體語意見各篇。

## 先備知識與閱讀方式

讀者需理解基本的程式語言開發（具備 C／Rust／Go／Java／Node.js 任一實作經驗）、基礎資料結構（陣列、鏈結串列、佇列）與作業系統基本常識（記憶體與檔案概念）。不要求先讀完 Linux 或分散式系統的所有篇章；需要的共通概念會在當篇簡短回顧，再連回相關主題的既有文章。

建議第一次依 01–12 順序閱讀：先建立記憶體空間與排程實體模型，再理解 CPU 快取一致性與指令重排的硬體真相，接著掌握互斥鎖與死鎖防禦，然後進入極致的 CAS 無鎖設計與 Disruptor，最後以 I/O 多工與生產環境執行緒池容量配置完成閉環。已有背景的讀者也可依特定問題直接查閱。

## 第一階段：程式執行本質與輕量執行單元（已撰寫）

| 順序與文章 | 當篇要回答的問題 | 案例推進 |
| --- | --- | --- |
| 01 [程式執行本質：從原始碼、記憶體配置到 CPU 指令週期](process-execution-memory-layout-and-cpu-cycles.md) | 程式碼編譯後長成什麼樣？執行時虛擬記憶體空間（Stack／Heap／Text／BSS）如何分佈？指令指針與呼叫棧如何運作？ | 拆解二進位執行檔載入、虛擬位址分頁映射、指令 Fetch-Decode-Execute 週期與 Stack Overflow 成因 |
| 02 [行程 (Process) 與執行緒 (Thread)：排程本質與 Context Switch 代價](process-and-thread-scheduling-context-switch.md) | Process 與 Thread 的硬體資源邊界有何本質區別？CPU Context Switch 時究竟切換了哪些暫存器與分頁表？ | 比較獨立位址空間（CR3 分頁表切換、TLB 沖刷）與執行緒共享記憶體，量化 Context Switch 的 CPU 週期損耗 |
| 03 [輕量執行單元：協程 (Coroutine)、纖程與虛擬執行緒](coroutines-fibers-and-virtual-threads.md) | 為什麼 OS Thread 數量有極限？1:1、N:1 與 M:N 排程模型如何解決百萬並行？ | 比較 OS 原生執行緒、Go GMP 排程模型與 Java 21 Virtual Threads，剖析使用者空間上下文切換與動態堆疊延展 |

完成這一階段後，能分清行程、執行緒與協程在作業系統與 CPU 視角下的本質差異，並理解排程切換與記憶體開銷的數量級界限。

## 第二階段：硬體快取架構與記憶體模型（已撰寫）

4. [CPU 快取階層與一致性：MESI 協定與偽共享 (False Sharing)](cpu-cache-hierarchy-mesi-and-false-sharing.md)：CPU 存取暫存器（<1ns）與記憶體（>60ns）速度差距千倍，L1/L2/L3 快取與 64-byte Cache Line 如何運作？拆解 MESI 協定狀態轉移，剖析並行計數器發生 False Sharing 的災難與 Cache Line Padding 解決方案。
5. [指令重排、記憶體屏障與 Happens-Before 記憶體模型](instruction-reordering-memory-barriers-and-happens-before.md)：程式碼寫的順序真的是 CPU 執行的順序嗎？分析編譯器重排與 CPU 亂序執行，拆解 Store Buffer、Load/Store 記憶體屏障（Memory Barrier），以及 JMM / C++11 / Go 的 Happens-Before 偏序規則如何防範「半初始化物件」。

## 第三階段：同步原語與死鎖防禦（已撰寫）

6. [競態條件與互斥鎖：Mutex、Futex 與自旋鎖 (Spinlock)](race-conditions-mutex-futex-and-spinlocks.md)：臨界區（Critical Section）搶奪時作業系統如何處理？剖析 Linux `futex(2)` 快速使用者空間互斥機制（無競爭零核心切換），比較自旋鎖（Spinlock）與 Adaptive Mutex 的延遲取捨。
7. [讀寫鎖 (RWLock)、條件變數與執行緒通訊協作](read-write-locks-condition-variables-and-signaling.md)：讀多寫少情境如何提高並行吞吐？解析 RWLock 讀鎖／寫鎖偏向與寫者飢餓問題；說明條件變數（Condition Variable）配合 Mutex 的運作機制與防禦 Spurious Wakeup（虛假喚醒）之迴圈檢查法。
8. [死鎖 (Deadlock)、活鎖與飢餓：成因、偵測與防禦架構](deadlocks-livelocks-starvation-and-coffman-conditions.md)：系統為什麼會卡死不動？拆解 Coffman 死鎖四大必要條件（互斥、持有並等待、不可搶佔、循環等待）；給出破壞循環等待的 Lock Ordering 規範、TryLock 超時策略與避免優先權反轉（Priority Inversion）的繼承機制。

## 第四階段：無鎖程式設計與資料結構（已撰寫）

9. [比較並交換 (CAS)、原子操作 (Atomics) 與 ABA 陷阱](compare-and-swap-atomics-and-the-aba-problem.md)：無鎖（Lock-Free）是如何做到的？剖析 CPU `CMPXCHG` 指令與 LOCK 匯流排鎖定；深入分析 ABA 問題成因（記憶體釋放與重複位址分配），詳解版本標記（Tagged Pointer / Double CAS）防禦機制。
10. [無鎖並行資料結構：Lock-Free Queue 與 Disruptor 環狀緩衝](lock-free-queues-and-the-disruptor-ring-buffer.md)：不用 Mutex 如何實作執行緒安全的佇列？剖析 Michael-Scott Lock-Free Queue 的 CAS 推進演算法；深度解密 LMAX Disruptor 的 RingBuffer 預分配、單調遞增 Sequence、消除 False Sharing 與免鎖高效能架構。

## 第五階段：I/O 多工與生產執行緒池實務（已撰寫）

11. [I/O 多工模型演進：從阻塞 I/O、epoll/kqueue 到 io_uring](io-multiplexing-epoll-kqueue-and-io-uring.md)：單一執行緒如何同時監視數萬個連線？比較 BIO、NIO、`select`/`poll`（$O(N)$ 輪詢）與 `epoll`（紅黑樹+就緒串列 $O(1)$ 通知）；對比 Linux 5.1+ 次世代非同步原生 `io_uring` 的 SQ/CQ 雙環共享記憶體零拷貝架構。
12. [執行緒池 (Thread Pool) 架構與背壓防護：極限負載實務案例](thread-pool-architecture-sizing-and-backpressure.md)：核心執行緒數該設多少？以 Brian Goetz 公式推導 CPU 密集型與 I/O 密集型最佳容量；設計 Caller-Runs 等飽和拒絕策略、監控工作佇列水位，徹底防範任務飢餓引發的執行緒池死鎖（Thread Starvation Deadlock）。

## 與其他主題的分工

- [Linux 知識索引](../linux/README.md)：Linux 篇聚焦於作業系統維運、檔案系統與 VFS、Shell 指令、基礎程序信號（`kill`）與權限隔離；本主題聚焦於程式開發視角下的虛擬位址分頁、暫存器排程切換與 Futex 系統呼叫機制。
- [電腦網路知識索引](../networking/README.md)：網路篇聚焦於 TCP 滑動視窗、UDP、TLS 1.3 握手與 HTTP/3 QUIC 傳輸；本主題聚焦於伺服器主機內部如何以 I/O 多工（`epoll`/`io_uring`）與 Event Loop 高效驅動巨量 Socket。
- [關聯式資料庫索引](../relational-databases/README.md)：資料庫篇聚焦於磁碟資料模型、交易隔離等級（ACID）與資料庫列級鎖；本主題聚焦於應用程式記憶體內的原生資料結構並行安全（Mutex、CAS、無鎖佇列）。
- [分散式系統知識索引](../distributed-systems/README.md)：分散式篇聚焦於跨主機節點的網路分區、時鐘因果與 Paxos/Raft 多副本共識；本主題聚焦於單主機多核心架構下的指令重排、CPU 快取行一致性與記憶體屏障。
- [快取與資料存取架構知識索引](../caching/README.md)：快取篇聚焦於 Redis 集中式快取、穿透擊穿雪崩防禦與雙寫一致性；本主題聚焦於單行程內的 CPU 快取硬體機制、MESI 協定、SingleFlight 原理與 Disruptor 記憶體設計。
