# 程式執行與並行處理：寫作證據與來源

查核日期：2026-11-06。本文為編寫本主題時所查證的一手文獻、官方技術規範與論文清單。本篇筆記用於確保技術細節的正確性與邊界清晰，不替代產品官方文件。

---

## 1. 程式執行、行程空間與排程代價

- **可用主張**：
  - **虛擬記憶體空間配置**：現代作業系統上的每個行程（Process）擁有獨立的虛擬位址空間。在 64 位元 Linux 下，標準配置包含使用者空間（User Space）與核心空間（Kernel Space）。使用者空間自低位址到高位址依序為：代碼段（Text/Code Segment）、資料段（Data / BSS）、堆積（Heap，由 `brk`/`sbrk` 或 `mmap` 向上增長）、記憶體映射區（Memory Mapping Segment，如動態連結庫）、呼叫堆疊（Stack，向下增長）。
  - **Process vs Thread 的硬體邊界**：Linux 核心內部皆以 `task_struct` 表示可排程實體。建立行程使用 `fork(2)` 或 `clone(2)`，擁有獨立的虛擬分頁表（Page Table / CR3 暫存器）；建立執行緒使用帶有 `CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND` 旗標的 `clone(2)`，共享位址空間與檔案描述子。
  - **Context Switch 代價**：行程間切換必須切換分頁目錄（Page Table Base Register / CR3），導致 CPU 的 TLB（Translation Lookaside Buffer）快取失效，造成後續記憶體存取代價暴增；執行緒間切換共享位址空間，無需刷掉全域 TLB，但仍需切換程式計數器（PC）、堆疊指針（SP）與通用暫存器，並伴隨 CPU L1/L2 快取熱度的流失。
- **來源依據**：
  - Linux man-pages: `clone(2)`, `fork(2)`, `sched(7)`, `mmap(2)`.
  - Robert Love, *Linux Kernel Development* (3rd ed.), Chapter 3: Process Management.
  - Hennessy, J. L., & Patterson, D. A., *Computer Architecture: A Quantitative Approach* (6th ed.), §B.4 (Virtual Memory and TLB).

---

## 2. 輕量協程與 M:N 排程器架構

- **可用主張**：
  - **執行緒模型演進**：
    - **1:1 模型（Kernel-level Thread）**：每個語言執行緒直接對應一個 OS 原生執行緒。排程由核心負責，優點是能充分發揮多核心，缺點是記憶體佔用高（預設 Stack 1MB–8MB）且 Context Switch 必須陷進核心。
    - **N:1 模型（User-level Green Thread）**：多個使用者執行緒跑在單一 OS 執行緒上。切換極快且省記憶體，但無法利用多核心，且任一阻塞 I/O 會卡死整個行程。
    - **M:N 模型（Hybrid / Two-tier）**：將 $M$ 個輕量任務動態多工映射至 $N$ 個 OS 執行緒。
  - **Go GMP 模型**：$G$（Goroutine，初始 Stack 僅 2KB 可動態擴展）、$M$（OS Thread，執行硬體指令）、$P$（Processor，邏輯排程器與本機佇列）。具備 Work Stealing（工作竊取）與 Hand-off（遇系統呼叫剝離 $P$）機制。
  - **Java Virtual Threads (Project Loom / JEP 444)**：虛擬執行緒掛載在載體執行緒（Carrier Thread，標準 ForkJoinPool）之上。當遇到阻塞 I/O 或同步點時，虛擬執行緒呼叫內部 yield 將堆疊幀複製至 Heap，釋出 Carrier Thread 處理其他工作。
- **來源依據**：
  - JEP 444: Virtual Threads (Java 21 Specification, 2023).
  - Russ Cox et al., *The Go Scheduler Design Document* (Dmitry Vyukov, 2012).
  - Reiser & Skoglund, *Scalable Multiprocessor Operating Systems*, ACM SIGOPS.

---

## 3. CPU 快取階層、MESI 協定與偽共享 (False Sharing)

- **可用主張**：
  - **Cache Line 概念**：現代主流 CPU（x86/ARM）的快取階層（L1 Data, L2, L3 LLC）以 64 位元組（Bytes）的 Cache Line 為最小存取單位。
  - **MESI 快取一致性協定**：硬體透過 Snooping（監聽）匯流排維持各核心快取資料一致性。狀態包含：
    - **Modified (M)**：核心獨佔修改，快取與記憶體不一致。
    - **Exclusive (E)**：核心獨佔乾淨，快取與記憶體一致。
    - **Shared (S)**：多核心共享唯讀。
    - **Invalid (I)**：該快取行資料已無效。
  - **偽共享 (False Sharing)**：當兩個運行在不同核心的獨立執行緒，分別修改記憶體上相鄰但位於同一個 64-byte Cache Line 的不同變數（例如 `long a` 與 `long b`）時，核心間會不斷透過匯流排廣播 Invalidate 信號，強制彼此的 L1/L2 快取行失效，造成效能暴跌數十倍至百倍。防護方案為以填充位元（Padding，如 Java `@Contended` 或 C++ `alignas(64)`）將變數隔離至不同 Cache Line。
- **來源依據**：
  - Intel® 64 and IA-32 Architectures Optimization Reference Manual, §3.7.3 (False Sharing).
  - Papamarcos, M. S., & Patel, J. H., *A Low-Overhead Coherence Solution for Multiprocessors with Private Cache Memories*, ISCA 1984 (MESI protocol).
  - Hennessy & Patterson, *Computer Architecture: A Quantitative Approach*, Chapter 5: Thread-Level Parallelism.

---

## 4. 指令重排、記憶體屏障與 Happens-Before

- **可用主張**：
  - **亂序執行 (Out-of-Order Execution)**：為了最大化流水線（Pipeline）效率，編譯器（編譯期）與超純量 CPU（執行期）會在不違反單執行緒相依性（as-if-serial）的前提下自由重排指令。
  - **多核心可見性漏洞**：在多核心下，核心 1 的寫入會先存入硬體 Store Buffer，若未刷新至 L1 快取，核心 2 將無法看見最新寫入。這導致經典的雙重檢查鎖（Double-Checked Locking）在缺乏記憶體屏障時失效：物件已分配記憶體並指派指標，但內部欄位建構式尚未執行完畢，另一個執行緒讀到了「半初始化物件」。
  - **記憶體屏障 (Memory Barrier / Fence)**：
    - **Store Barrier (Write Barrier)**：強制將 Store Buffer 內容刷出，確保屏障前的寫入先於屏障後的寫入對其他核心可見。
    - **Load Barrier (Read Barrier)**：強制清空 Invalidate Queue，確保屏障後的讀取必須重新從快取或記憶體獲取最新資料。
    - **Full Barrier (MFENCE)**：兼具讀寫排序。
  - **Happens-Before 語意**：在語言級別（JMM / C++11 / Go），Happens-Before 定義了記憶體操作的偏序關係（Partial Order）。如果操作 A happens-before 操作 B，則 A 產生的所有記憶體寫入對 B 保證可見。
- **來源依據**：
  - Leslie Lamport, *How to Make a Multiprocessor Computer That Correctly Executes Multiprocess Programs*, IEEE Transactions on Computers, 1979. (Sequential Consistency).
  - Jeremy Manson, William Pugh, Sarita V. Adve, *The Java Memory Model*, POPL 2005 (JSR-133).
  - ISO/IEC 14882:2011 (C++11 Standard), §1.10 (Multi-threaded executions and data races) & §29 (Atomic operations library).
  - The Go Memory Model (Russ Cox revision, June 2022).
  - Intel® 64 and IA-32 Architectures Software Developer's Manual, Volume 3A, §8.2 (Memory Ordering).

---

## 5. 同步原語：Mutex、Futex、信號量與死鎖防護

- **可用主張**：
  - **Mutex 與 Futex 機制**：傳統互斥鎖依賴核心系統呼叫，成本高昂。Linux 的 `futex(2)`（Fast Userspace Mutex）結合使用者空間的原子操作與核心等待佇列：在無競爭（No Contention）時，純粹在使用者空間以一條 CAS 指令取得鎖，不進核心；僅在搶鎖失敗時才發起 `futex(FUTEX_WAIT)` 系統呼叫將執行緒掛起。
  - **Spinlock vs Adaptive Mutex**：Spinlock 適用於臨界區極短、鎖競爭低且不能發生 Context Switch 的情境（如中斷處理函式）；現代 Mutex 通常是 Adaptive 的：先短暫自旋嘗試搶鎖，若失敗才轉為休眠。
  - **死鎖 (Deadlock) 四大必要條件 (Coffman Conditions)**：
    1. 互斥（Mutual Exclusion）：資源同一時刻只能被一個執行緒持有。
    2. 持有並等待（Hold and Wait）：持有一個資源的同時，申請另一個被佔用的資源。
    3. 不可搶佔（No Preemption）：已獲取的資源無法被強制剝奪。
    4. 循環等待（Circular Wait）：存在一組執行緒 $\{T_1, T_2, \dots, T_n\}$，形成首尾相連的資源等待鏈。
    - **防範法則**：破壞循環等待（例如強制全域統一的資源獲取順序 Lock Ordering）；使用帶有超時機制的 TryLock；使用靜態程式碼檢查或執行時期檢測（如 Lockdep）。
- **來源依據**：
  - Ulrich Drepper, *Futexes Are Strange*, 2011.
  - Linux man-page: `futex(2)`.
  - Edward G. Coffman, Jr., Michael J. Elphick, Arie Shoshani, *System Deadlocks*, ACM Computing Surveys, 1971.
  - Edsger W. Dijkstra, *Cooperating Sequential Processes*, Technological University Eindhoven, 1965.

---

## 6. 無鎖 (Lock-Free) 程式設計與 Disruptor

- **可用主張**：
  - **硬體 CAS (Compare-And-Swap)**：x86 CPU 透過帶有 `LOCK` 前綴的 `CMPXCHG` 指令提供原子性的比較並交換。如果記憶體位置的值等於預期舊值，則寫入新值並返回成功；否則不做變更並返回失敗。
  - **ABA 問題**：在 CAS 操作中，執行緒讀取變數值為 A，中途其他執行緒將值改為 B 後又改回 A。CAS 檢查值仍為 A 而成功寫入，但其底層記憶體或指標語意可能已被破壞（例如節點被 free 後重新分配至同位址）。解法為引入版本號（Tagged Pointer / Double CAS，例如 x86 `CMPXCHG16B`）。
  - **Michael-Scott Lock-Free Queue**：經典無鎖佇列演算法。佇列始終保有哨兵節點（Dummy Node），入隊（Enqueue）與出隊（Dequeue）分別使用 CAS 操作更新 tail 與 head 指標，並透過協同推進（Helping Mechanism）處理部分完成狀態。
  - **LMAX Disruptor 環狀緩衝區**：專為超低延遲設計的無鎖並行架構。其關鍵設計包括：(1) 固定長度為 2 的冪次方的環狀陣列（RingBuffer），避免動態記憶體分配與 GC；(2) 透過游標（Sequence）單調遞增進行無鎖位置計算；(3) 透過 Cache Line Padding 徹底消除 Sequence 上的 False Sharing。
- **來源依據**：
  - Maged M. Michael and Michael L. Scott, *Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms*, PODC 1996.
  - Martin Fowler, *The LMAX Architecture*, 2011.
  - LMAX Disruptor Technical Paper: *High Performance Alternative to Bounded Queues for Exchanging Data Between Concurrent Threads* (Trisha Gee, Mike Barker et al.).
  - Maurice Herlihy & Nir Shavit, *The Art of Multiprocessor Programming*, Chapter 10: Queue Implementations and the ABA Problem.

---

## 7. 高併發 I/O 多工模型與執行緒池實務

- **可用主張**：
  - **I/O 多工演進**：
    - `select(2)` / `poll(2)`：每次呼叫需將檔案描述子集合從使用者空間複製進核心空間，核心以 $O(N)$ 線性輪詢，上限通常受限於 `FD_SETSIZE` (1024)。
    - `epoll(7)`（Linux）/ `kqueue(2)`（BSD/macOS）：在核心中以紅黑樹維護監聽清單，以就緒鏈結串列（Ready List）回報事件。呼叫 `epoll_wait` 僅返回實際就緒的事件，複雜度降至 $O(1)$，消除無謂輪詢。
    - `io_uring`：Linux 5.1+ 推出的次世代非同步 I/O 介面。使用者空間與核心空間透過一對環狀緩衝區（Submission Queue SQ 與 Completion Queue CQ）共享記憶體，支援零拷貝（Zero-copy）與極致的非同步批次提交，大幅降低系統呼叫開銷。
  - **執行緒池容量配置公式 (Brian Goetz 公式)**：
    $$N_{\text{threads}} = N_{\text{cpu}} \times U_{\text{cpu}} \times \left(1 + \frac{W}{C}\right)$$
    其中 $N_{\text{cpu}}$ 為可用 CPU 核心數，$U_{\text{cpu}}$ 為目標 CPU 利用率（$0 \le U \le 1$），$W/C$ 為等待時間（Wait time / I/O time）與計算時間（Compute time）的比例。
  - **執行緒飢餓死鎖 (Thread Starvation Deadlock)**：在固定大小的執行緒池中，若任務向同一個執行緒池提交子任務並同步等待子任務回傳，當主任務佔滿全部執行緒時，子任務在佇列中永遠無法被排程，引發系統死鎖。
- **來源依據**：
  - Linux man-pages: `select(2)`, `poll(2)`, `epoll(7)`, `epoll_ctl(2)`, `epoll_wait(2)`.
  - Jens Axboe, *Efficient IO with io_uring*, Linux Kernel Documentation, 2019.
  - Brian Goetz, Tim Peierls, Joshua Bloch, Joseph Bowbeer, David Holmes, Doug Lea, *Java Concurrency in Practice*, Chapter 8: Applying Thread Pools.
