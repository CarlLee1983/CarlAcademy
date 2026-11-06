# 輕量執行單元：協程 (Coroutine)、纖程與虛擬執行緒

在面對現代百萬連線（C1000K）的網路服務時，傳統為每個客戶端請求分配一個作業系統原生執行緒（Thread-per-request）的架構，會迅速因記憶體耗盡與排程崩潰而倒下。為突破作業系統核心的調度瓶頸，「使用者空間輕量執行單元」應運而生——從協程（Coroutine）、纖程（Fiber）到現代的虛擬執行緒（Virtual Threads）。

## 執行緒模型演進的三種架構

程式語言執行時期（Runtime）與作業系統核心在任務映射上，歷史上演進出三種主要拓撲模型：

```
1:1 模型 (Kernel Thread)        N:1 模型 (Green Thread)        M:N 模型 (Hybrid / 現代協程)
  使用者任務     核心執行緒         使用者任務     核心執行緒         使用者任務     核心執行緒
    [ T1 ] ───▶ [ K1 ]            [ T1 ] ┐                       [ G1 ] ┐
    [ T2 ] ───▶ [ K2 ]            [ T2 ] ┼───▶ [ K1 ]            [ G2 ] ┼───▶ [ M1 ]
    [ T3 ] ───▶ [ K3 ]            [ T3 ] ┘                       [ G3 ] ┘     [ M2 ]
                                                                 [ G4 ] ─────▶
```

| 模型架構 | 運作機制 | 優點 | 缺陷與致命傷 |
|---|---|---|---|
| **1:1 模型** | 每個語言執行緒直接由核心系統呼叫建立並排程（如 C++ `std::thread`, Java 早期 Thread） | 充分利用多核心 CPU 硬體平行運算；核心自動處理阻塞 | 建立與銷毀成本高；預設 Stack 佔用 1MB–8MB；過多執行緒引發 Context Switch 崩潰 |
| **N:1 模型** | 所有任務全由使用者空間程式庫排程，底層僅綁定單一 OS 執行緒（如早期綠色執行緒） | 切換完全在使用者空間，無系統呼叫開銷；記憶體佔用極小 | **無法利用多核心硬體**；任一任務發起阻塞式系統呼叫，全體任務集體凍結 |
| **M:N 模型** | 將 $M$ 個超輕量使用者任務，由語言 Runtime 動態多工映射至 $N$ 個 OS 原生執行緒 | 兼具使用者空間高速切換、超低記憶體與多核心硬體平行能力 | Runtime 需實作複雜的排程演算法（工作竊取、系統呼叫掛鉤與搶佔） |

## 有棧協程 (Stackful) vs 無棧協程 (Stackless)

協程的本質在於**可暫停（Suspend / Yield）與可接續（Resume）**的計算流程。根據其暫停時如何保留呼叫狀態，分為兩大流派：

### 1. 有棧協程 (Stackful Coroutine)
- **代表技術**：Go Goroutine、Java 21 Virtual Threads、Lua Coroutine。
- **機制**：每個協程擁有自己獨立、動態增長的使用者空間堆疊。這意味著協程可以在**任意深度的巢狀函式呼叫中隨時中斷讓出**，下次恢復時能完美復原深層的呼叫鏈與區域變數。
- **優勢**：開發者可以使用傳統直觀的同步編程風格（Sequential Code），無需將程式碼切碎為回呼函式。

### 2. 無棧協程 (Stackless Coroutine)
- **代表技術**：JavaScript `async`/`await`、Rust `async`/`Future`、Python `asyncio`、C# `async`/`await`。
- **機制**：協程**沒有獨立的呼叫棧**。編譯器在背後將帶有 `async`/`await` 的函式改寫為一個由列舉（Enum）表示的**狀態機 (State Machine)**。當遇到 `await` 時，僅將狀態保存於 Heap 中的結構體，並直接向事件迴圈返回。
- **特徵**：記憶體佔用極致輕量（僅需數十至數百位元組）；但具有「函式著色問題（Function Coloring Problem）」——`async` 傳染性，同步函式無法直接呼叫非同步函式並在其深處暫停。

## Go GMP 排程模型：現代 M:N 的工業典範

Go 語言透過 GMP 模型在使用者空間實作了一套極具彈性的 M:N 排程器：

- **G (Goroutine)**：輕量協程實體。初始堆疊僅需 **2KB**（隨呼叫深度在 Heap 上動態擴展至最高 1GB），可輕鬆建立數十萬甚至上百萬個 G。
- **M (Machine)**：作業系統原生執行緒，由 OS 核心直接調度，負責真正在 CPU 核心上執行機器指令。
- **P (Processor)**：邏輯排程器／處理器抽象，代表執行 Go 程式碼所需的資源上限（數量預設等於 CPU 核心數 `GOMAXPROCS`）。每個 P 持有一個容量為 256 的本機就緒佇列（Local Run Queue, LRQ）。

```
        ┌──────────────────────────────────────────────────┐
        │ 全域就緒佇列 (Global Run Queue)                   │
        └──────────────────────────────────────────────────┘
                      ▲                   ▲
                      │                   │ 偷取一半 (Work Stealing)
             ┌────────┴────────┐ ┌────────┴────────┐
             │ P1 (Local Queue)│ │ P2 (Local Queue)│
             │ [G1][G2][G3]... │ │ [G4][G5]...     │
             └────────┬────────┘ └────────┬────────┘
                      │ 綁定執行          │
                      ▼                   ▼
             ┌─────────────────┐ ┌─────────────────┐
             │ M1 (OS Thread)  │ │ M2 (OS Thread)  │
             └────────┬────────┘ └────────┬────────┘
                      ▼                   ▼
             ┌─────────────────────────────────────┐
             │ CPU 實體核心 1      CPU 實體核心 2    │
             └─────────────────────────────────────┘
```

GMP 解決高併發的核心機制：
1. **工作竊取 (Work Stealing)**：當 P1 消耗完自己的 Local Queue 時，優先從全域佇列抓取任務；若全域佇列為空，則隨機挑選另一個繁忙的 P2，從其佇列尾端「偷取一半」的 G 過來執行，實現多核心負載的極致均衡。
2. **系統呼叫剝離 (Hand-off / Syscall Optimization)**：當 M1 上運行的 G1 進行阻塞性系統呼叫（如磁碟讀寫）時，M1 會釋放 P1。Runtime 會將 P1 重新綁定至另一個空閒的 M 或新建 M 接續處理其他 G；當 G1 完成系統呼叫返回時，再尋找空閒的 P 重新入隊。
3. **非協作式搶佔 (Non-cooperative Preemption)**：Go 1.14 之後透過 OS 信號（`SIGURG`）實作真正的搶佔機制，即使 G 內部陷入沒有函式呼叫的純死迴圈（Tight Loop），Sysmon 監控執行緒也會定期發送信號中斷該 G，防止單一協程霸佔 CPU 核心。

## Java 21 Virtual Threads：Project Loom 的革新

Java 長期堅持 1:1 平台執行緒模型（Platform Thread），面對高吞吐 Web 服務曾不得不推行複雜的反應式編程（Reactive Programming，如 WebFlux、RxJava），程式碼晦澀且難以除錯。

Java 21 正式引入 **虛擬執行緒 (Virtual Threads, JEP 444)**，採取了純粹的有棧 M:N 設計：
- **載體執行緒 (Carrier Thread)**：由標準的 `ForkJoinPool` 維護固定數量的平台執行緒（通常等於 CPU 核心數）。
- **Continuation 堆疊掛載 (Mount / Unmount)**：
  - 當虛擬執行緒在 Carrier Thread 上執行遇到阻塞式 I/O（如呼叫阻塞 Socket 讀寫、資料庫查詢或進入 `synchronized`／Lock）時，JVM 核心的 Continuation 機制會攔截該事件，將當前虛擬執行緒的棧幀由 Carrier Thread 的原生堆疊**拷貝（Unmount）至 Java Heap** 中儲存。
  - Carrier Thread 立即被解放，轉頭去執行下一個就緒的虛擬執行緒。
  - 當底層的非同步網路多工器（如 Linux `epoll`）通知該 I/O 資料已抵達時，排程器重新挑選一個空閒的 Carrier Thread，將堆疊資料還原回原生堆疊（Mount），虛擬執行緒接續原行程式碼執行。

這使得工程師可以用最直觀、易懂的同步阻塞式程式碼風格（`InputStream.read()`），取得與反應式非同步引擎同等的百萬並發吞吐量。

## 常見誤解與架構限制

1. **誤解：協程可以加速純 CPU 密集型運算**
   協程本質上是為了解決 **I/O 密集型（I/O Bound）**等待時 CPU 閒置與記憶體浪費的問題。如果是矩陣乘法、影片編碼等純運算任務，CPU 始終處於 100% 滿載，多開協程只會在使用者空間增加額外的任務切換與記憶體搬移負擔，完全無法縮短運算時間。
2. **誤解：用了協程就永遠不需要考慮並行緒安全（Thread-Safe）**
   在 M:N 架構中，多個協程依然可能同時在不同的 OS 執行緒（不同的 CPU 核心）上**真正平行執行**。若兩個協程同時讀寫同一個全域變數或未加鎖的記憶體指標，依然會發生嚴重的資料競爭（Data Race）。互斥鎖、原子操作與記憶體屏障，在協程環境中同樣不可或缺。

## 相關文件與參考來源

- [CPU 快取階層與一致性](cpu-cache-hierarchy-mesi-and-false-sharing.md)：探討多核心並行運算時底層快取的物理通訊代價。
- [I/O 多工模型演進](io-multiplexing-epoll-kqueue-and-io-uring.md)：理解協程底層如何與 `epoll` 非同步事件通知掛鉤。
- 參考文獻：
  - JEP 444: Virtual Threads, OpenJDK Specification (2023).
  - Russ Cox, Dmitry Vyukov, *Go Scheduler Design*, The Go Authors (2012).
  - Ana-Maria Mihalceanu, *Virtual Threads in Java*, InfoQ (2023).
