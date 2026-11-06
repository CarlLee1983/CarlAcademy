# 程式執行與並行處理：內容規劃

2026-11-06 選定為下一個核心主題。接續已完成的 Linux（16 篇）、電腦網路（16 篇）、分散式系統（18 篇）、快取架構（12 篇）與事件驅動架構（12 篇），本主題深入探討單機環境下的程式執行機制、硬體快取層級、記憶體模型、並行同步原語、無鎖資料結構與現代高並發 I/O 排程模型。全系列規劃 12 篇，完成狀態由[公開索引](../concurrency/README.md)維護。

## 主題邊界

本主題要回答：
程式碼在單機硬體上如何被操作系統與 CPU 排程執行？在多核心、快取層級與現代記憶體架構下，如何正確且高效地協調多工，既不發生競態條件、資料損毀或死鎖，又能榨乾硬體的吞吐潛力？

讀者需具備基本程式開發能力（如 C/Rust/Go/Java/Node.js 基礎）、基本資料結構（陣列、鏈結串列、佇列）與作業系統基本常識。
- 與 [Linux](../linux/README.md) 的分工：Linux 篇聚焦於作業系統宏觀管理、檔案系統與 VFS、Shell 指令、基本程序信號（`kill`, `SIGTERM`）、Systemd 與系統權限；本主題聚焦於「程式執行時期視角」——行程虛擬位址空間佈局（Stack、Heap、Text、BSS）、分頁機制、Thread 排程開銷（Context Switch CPU 代價）、Futex 系統呼叫原理。
- 與 [電腦網路](../networking/README.md) 的分工：網路篇聚焦於網路通訊協定（TCP 滑動視窗、UDP、TLS 1.3 握手、HTTP/3 QUIC 傳輸）；本主題聚焦於「伺服器端端點如何處理百萬並行 Socket」——傳統 Thread-per-request 的崩潰邊界、I/O 多工模型（select/poll 到 `epoll`/`kqueue`）、Linux 現代 `io_uring`，以及事件迴圈（Event Loop）模式。
- 與 [關聯式資料庫](../relational-databases/README.md) 的分工：資料庫篇聚焦於磁碟與跨交易的隔離等級（ACID、MVCC、Row-level lock）；本主題聚焦於記憶體中的原生資料結構並行安全——Mutex 互斥鎖、讀寫鎖、Spinlock 自旋鎖、CAS 原子運算、無鎖佇列（Lock-free Queue）。
- 與 [分散式系統](../distributed-systems/README.md) 的分工：分散式篇聚焦於跨網路節點的不可靠網路、時序因果、Vector Clock、Paxos/Raft 共識；本主題聚焦於單節點多核心的硬體重排、快取一致性（Cache Coherence）、編譯器重排與 CPU 記憶體屏障（Memory Barrier / Fence）。

## 貫穿案例

全系列沿用後端常見的真實案例——**「高效能指標計數與非同步任務引擎 (High-Throughput Metrics & Task Engine)」**：
- **情境 1：高頻點擊累加與排行（微觀記憶體競爭）**
  - 多執行緒同時累加計數：從最原始的 `count++` 出現資料遺失（Race Condition）。
  - 加上 Mutex 後吞吐雪崩，分析 Context Switch 與鎖競爭代價。
  - 改用原子操作（Atomic / CAS），遭遇 CPU Cache Line 爭搶與「偽共享 (False Sharing)」，引入 Padding 優化。
- **情境 2：單例與延遲初始化（指令重排陷阱）**
  - 經典 Double-Checked Locking (DCL) 為什麼在現代多核心 CPU 會讀到「尚未初始化完成的半物件」？
  - 剖析硬體與編譯器重排，引入 Memory Barrier 與語言規範的 Happens-Before 保證。
- **情境 3：百萬連線與伺服器架構演進（I/O 模式與排程）**
  - 傳統 Thread-per-connection 遭遇記憶體耗盡（Stack 空間）與排程器過載。
  - 演進為 Non-blocking I/O + `epoll` + Reactor 模式（Netty / Nginx / Node.js 底層原理）。
  - 演進為 M:N 協程排程（Go Goroutine GMP 模型、Java 21 Virtual Threads 延續底層載體執行緒）。

## 建議閱讀主線

全系列共 12 篇，分為五個階段推進：

| 順序 | 文章方向 | 核心問題與案例推進 | 可觀察的完成判準 |
|---|---|---|---|
| 01 | 程式執行本質：從原始碼、記憶體配置到 CPU 指令週期 | 程式碼編譯後長成什麼樣？執行時記憶體空間（Stack/Heap/Text/BSS）如何分佈？指令指針（PC/IP）與呼叫堆疊如何運作？ | 畫出行程記憶體佈局圖，說明指令獲取、解碼、執行週期與呼叫棧溢位（Stack Overflow）底層成因。 |
| 02 | 行程 (Process) 與執行緒 (Thread)：排程本質與 Context Switch 代價 | Process 與 Thread 的硬體資源邊界有何本質區別？CPU Context Switch 時究竟切換了哪些暫存器與分頁表？代價有多大？ | 比較 Process（獨立分頁表、TLB 失效代價）與 Thread（共享位址空間）；量化 Context Switch 的 CPU 週期與排程演算法（CFS）原理。 |
| 03 | 輕量執行單元：協程 (Coroutine)、纖程與虛擬執行緒 | 為什麼 OS Thread 數量有上限？1:1、N:1 與 M:N 排程模型如何解決百萬並發？ | 比較 OS Thread、Green Thread、Go GMP 模型、Java 21 Virtual Threads；分析使用者空間切換（User-space Switch）的堆疊增長與調度代價。 |
| 04 | CPU 快取階層與一致性：MESI 協定與偽共享 (False Sharing) | CPU 存取暫存器（<1ns）與記憶體（>60ns）速度差距千倍，快取階層（L1/L2/L3）如何填補？多核心修改同一變數時如何協調？ | 拆解 Cache Line（64 Bytes）、MESI 狀態轉移（Modified, Exclusive, Shared, Invalid）；示範並行計數器發生 False Sharing 的實測效能崩跌與 Cache Line Padding 解法。 |
| 05 | 指令重排、記憶體屏障與 Happens-Before 記憶體模型 | 程式碼寫的順序真的是 CPU 執行的順序嗎？為什麼雙重檢查鎖（DCL）會崩潰？ | 說明編譯器重排與 CPU Out-of-Order 執行；解析 Store Buffer、Invalidate Queue、Load/Store Barrier，以及語言級記憶體模型（JMM / C++11 / Go）的 Happens-Before 規則。 |
| 06 | 競態條件與互斥鎖：Mutex、Futex 與自旋鎖 (Spinlock) | 多執行緒搶奪臨界區（Critical Section）時，作業系統如何處理？使用者空間與核心空間如何切換？ | 剖析 Mutex 實作、Linux `futex(2)` 快速使用者空間互斥機制（無競爭不進核心）、Spinlock 與 Adaptive Mutex（先自旋再休眠）的選型取捨。 |
| 07 | 讀寫鎖 (RWLock)、條件變數與執行緒通訊協作 | 讀多寫少情境如何提高並行？執行緒要等待特定條件時，如何避免忙碌輪詢（Busy-Wait）？ | 分析 RWLock 讀鎖／寫鎖偏向與寫者飢餓問題；解析 Condition Variable（`wait`/`notify`）的配合 Mutex 機制與 Spurious Wakeup（虛假喚醒）防禦。 |
| 08 | 死鎖 (Deadlock)、活鎖與飢餓：成因、偵測與防禦架構 | 系統為什麼會卡死不動？死鎖四大條件為何？如何在架構設計中從根本消滅死鎖？ | 嚴格定義死鎖四大條件（互斥、持有並等待、不可搶佔、循環等待）；示範資源排序防護法（Lock Ordering）、超時機制、TryLock，以及活鎖（Livelock）與優先權反轉（Priority Inversion）解法。 |
| 09 | 比較並交換 (CAS)、原子操作 (Atomics) 與 ABA 陷阱 | 無鎖（Lock-Free）是如何做到的？硬體如何保證 Read-Modify-Write 的原子性？ | 拆解 CPU `CMPXCHG` 指令、Lock 匯流排前綴、Atomic 計數器實作；深入說明 ABA 問題的成因（記憶體重複利用）與版本標記（Tagged Pointer / Double CAS）防禦。 |
| 10 | 無鎖並行資料結構：Lock-Free Queue 與 Disruptor 環狀緩衝 | 不用 Mutex 如何實作線程安全的佇列？高效能金融系統如何達成數百萬每秒傳遞？ | 剖析 Michael-Scott Lock-Free Queue 鏈結結構；深度解析 LMAX Disruptor 的 RingBuffer 預分配、序號管理（Sequence Barrier）與零鎖無快取行衝突架構。 |
| 11 | I/O 多工模型演進：從阻塞 I/O、epoll/kqueue 到 io_uring | 單一執行緒如何同時監視上萬個連線？為什麼 Node.js / Nginx 能用少數執行緒處理巨量請求？ | 比較 BIO、NIO、`select`/`poll`（O(N) 遍歷缺點）、`epoll`（紅黑樹+就緒鏈結串列 O(1) 通知）、Reactor 模式；對比 Linux 現代非同步原生 `io_uring`（SQ/CQ 雙環共享記憶體）。 |
| 12 | 執行緒池 (Thread Pool) 架構與背壓防護：極限負載實務案例 | 核心執行緒數該設多少（CPU 密集 vs I/O 密集）？工作佇列滿了該怎麼辦？如何防止任務飢餓死鎖？ | 給出 CPU 密集型與 I/O 密集型的執行緒數精確推導公式；設計四大拒絕策略（Caller Runs、Discard 等）、監控佇列水位、防範嵌套任務死鎖（Deadlock by Thread Starvation）。 |

## 研究與撰文條件

一手來源筆記維護於[來源證據](concurrency-runtime-sources.md)，涵蓋 Intel/ARM 架構規格、Linux man pages、JSR-133、Go Memory Model、POSIX pthread 規範與經典並行論文。
所有架構圖與時序案例標為概念推演與原理拆解，不宣稱已完成特定硬體平台微基準跑分；各篇嚴格遵守 CarlAcademy 的單一 H1 標題、繁體中文撰寫、英文專業名詞對照與相對路徑互連規範。
