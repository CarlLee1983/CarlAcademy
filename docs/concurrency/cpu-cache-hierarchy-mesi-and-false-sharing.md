# CPU 快取階層與一致性：MESI 協定與偽共享 (False Sharing)

在多核心並行計算的世界中，程式碼看似只是在修改變數的數值，但硬體底層卻在以極限速度進行訊號傳輸。多核心 CPU 存取實體主記憶體（RAM）的延遲高達暫存器的百倍以上，為此引入了多層級快取（Cache Hierarchy）。然而，快取機制在帶來超高讀取速度的同時，也帶來了快取一致性（Cache Coherence）的硬體同步開銷，並引發了並行程式設計中最隱密的效能殺手——**偽共享 (False Sharing)**。

## 記憶體牆 (Memory Wall) 與快取階層

自 1980 年代起，CPU 運算頻率的提升速度遠遠超過了 DRAM 主記憶體的存取速度，這種硬體存取延遲的巨大鴻溝被稱為**記憶體牆 (Memory Wall)**：

| 儲存層級 | 典型容量 | 存取延遲 (週期) | 存取延遲 (絕對時間) | 共享範圍 |
|---|---|---|---|---|
| **CPU 暫存器** | 數百位元組 | 1 週期 | < 0.5 ns | 單一 CPU 核心私有 |
| **L1 快取 (Data / Inst)** | 32 KB – 64 KB | 4–5 週期 | ~ 1 ns | 單一 CPU 核心私有 |
| **L2 快取** | 512 KB – 1 MB | 12–14 週期 | ~ 3–4 ns | 通常為單核心私有 |
| **L3 快取 (LLC, Last Level)** | 16 MB – 64 MB+ | 40–50 週期 | ~ 10–15 ns | 所有 CPU 核心共享 |
| **主記憶體 (DRAM)** | 16 GB – 128 GB+ | 150–250+ 週期 | ~ 60–80 ns | 全系統共享 |

如果 CPU 每讀寫一個變數都必須直接等待主記憶體回應，現代 CPU 超過 98% 的時脈週期都將在空轉等待。因此，CPU 核心配備了高速 SRAM 快取階層。

```
 ┌──────────────────────┐  ┌──────────────────────┐
 │   CPU 核心 0 (Core 0) │  │   CPU 核心 1 (Core 1) │
 │ ┌──────────────────┐ │  │ ┌──────────────────┐ │
 │ │ L1d 快取 (32 KB) │ │  │ │ L1d 快取 (32 KB) │ │
 │ └────────┬─────────┘ │  │ └────────┬─────────┘ │
 │ ┌────────┴─────────┐ │  │ ┌────────┴─────────┐ │
 │ │ L2 快取 (512 KB) │ │  │ │ L2 快取 (512 KB) │ │
 │ └────────┬─────────┘ │  │ └────────┬─────────┘ │
 └──────────┼───────────┘  └──────────┼───────────┘
            ▼                         ▼
 ┌────────────────────────────────────────────────┐
 │           L3 共享快取 (LLC, 32 MB)             │
 └───────────────────────┬────────────────────────┘
                         ▼
 ┌────────────────────────────────────────────────┐
 │              主記憶體 (DRAM, 64 GB)            │
 └────────────────────────────────────────────────┘
```

## 快取行 (Cache Line)：硬體傳輸的最小粒子

CPU 快取與主記憶體交換資料時，**絕非**以單一位元組或 4 位元組（一個 `int`）為單位進行傳輸，而是以固定大小的塊——**快取行 (Cache Line)** 為最小原子單位。在當今主流的 x86 與 ARM64 架構上，**Cache Line 的大小固定為 64 位元組 (64 Bytes)**。

這意味著即使你的程式碼只讀取了一個 8 位元組的 `long` 變數，CPU 也會把該變數所在記憶體位址前後整整 64 位元組的連續資料一次性載入 L1 快取。這符合電腦架構的**空間局部性 (Spatial Locality)** 原理——存取了一個資料，相鄰資料極大概率緊接著會被存取。

## 快取一致性：MESI 協定與狀態機

當 Core 0 讀取並修改了它私有 L1 快取中的變數 $X$ 時，若 Core 1 隨後也嘗試讀取 $X$，Core 1 如何知道自己快取中的 $X$ 是舊資料？這就是**快取一致性問題 (Cache Coherence)**。

現代硬體透過連接各核心快取的內部匯流排進行**匯流排監聽 (Bus Snooping)**，並採用經典的 **MESI 協定**（或其變體 MOESI / MESIF）來維護每一條 Cache Line 的生命週期狀態：

```
                ┌──────────────┐
                │ Invalid (I)  │◀──────────────┐
                └──────┬───────┘               │
                       │ 讀取 miss             │ 其他核心寫入此行
                       ▼                       │
    ┌───────────────────────────────────┐      │
    │ 判斷其他核心是否持有此 Cache Line?  │      │
    └─────────┬───────────────┬─────────┘      │
   其他核心無 │               │ 其他核心有      │
              ▼               ▼                │
       ┌─────────────┐ ┌─────────────┐         │
       │Exclusive (E)│ │ Shared (S)  │         │
       └──────┬──────┘ └──────┬──────┘         │
              │ 本核心寫入    │ 本核心寫入     │
              ▼               │ (廣播使他人失效)│
       ┌─────────────┐        │                │
       │Modified (M) │◀───────┴────────────────┘
       └─────────────┘
```

- **Modified (M, 已修改)**：此 Cache Line 僅被當前核心持有，資料已被當前核心修改，且與主記憶體中的資料**不一致**。該核心有責任稍後將資料刷回（Write-Back）主記憶體。
- **Exclusive (E, 獨佔乾淨)**：此 Cache Line 僅被當前核心持有，資料與主記憶體**一致**。若該核心想寫入，可直接變為 Modified 狀態而無需通知其他核心。
- **Shared (S, 共享唯讀)**：此 Cache Line 同時存在於多個核心的私有快取中，資料與主記憶體一致。任何核心**若想寫入，必須先在匯流排廣播 Invalidation 訊號，強制其他所有核心將該行標記為 Invalid**。
- **Invalid (I, 無效)**：此 Cache Line 內的資料已過期無效，不能讀取；必須重新自其他快取或主記憶體抓取。

## 偽共享 (False Sharing)：致命的快取行顛簸

MESI 協定保證了多核心並行的正確性，但在特定記憶體佈局下，會引發毀滅性的效能陷阱——**偽共享 (False Sharing)**。

### 發生機制
假設有兩個完全獨立的業務計數器變數：
```c
long counterA = 0; // 由 Worker 執行緒 1 (運行於 Core 0) 獨佔累加
long counterB = 0; // 由 Worker 執行緒 2 (運行於 Core 1) 獨佔累加
```
在記憶體配置中，`counterA` 與 `counterB` 各佔 8 位元組，兩者在實體位址上相鄰，因此**極大概率被分配在同一個 64-byte Cache Line 之內**！

```
                     同一個 64-byte Cache Line
┌───────────────────────┬───────────────────────┬─────────────────────────┐
│ counterA (8 Bytes)    │ counterB (8 Bytes)    │ 其他相鄰資料 (48 Bytes) │
└───────────────────────┴───────────────────────┴─────────────────────────┘
        ▲                               ▲
        │ Core 0 寫入                   │ Core 1 寫入
```

1. Core 0 修改 `counterA`：依據 MESI 協定，Core 0 必須在匯流排廣播失效通知，**導致 Core 1 快取中的整個 64-byte Cache Line 被標記為 Invalid (I)**。
2. Core 1 緊接著修改 `counterB`：發現自己的 Cache Line 是 Invalid，必須透過匯流排向 Core 0 請求最新快取行，修改後又反過來**導致 Core 0 的整條 Cache Line 變為 Invalid**。
3. 兩個核心在實體匯流排上高速輪番讓彼此的快取失效，產生劇烈的**快取行乒乓效應（Cache Line Bouncing / Ping-Pong）**。

雖然程式碼在邏輯上沒有任何資料競爭（修改不同變數，無需加鎖），但在硬體層面卻引發了近乎 100% 的 L1 Cache Miss，吞吐量相較於分開儲存可能**暴跌數十倍至百倍**！

## 偽共享的消除方案：快取行填充 (Padding)

要消滅 False Sharing，核心思想極其直觀：**確保頻繁被不同核心寫入的獨立變數，在記憶體位址上相距至少 64 位元組，各自獨佔一整條 Cache Line**。

### 1. 結構體手動填充 (C/C++ / Rust)
```c
struct alignas(64) PaddedCounter {
    long value;
    // 64 Bytes 扣掉 8 Bytes 的 long，手動填充 56 位元組
    char padding[56];
};
```

### 2. Java 的 @Contended 與 Disruptor 實踐
在高效能金融撮合架構 **LMAX Disruptor** 中，其核心游標 `Sequence` 透過填充宣告徹底消除了偽共享：
```java
// Disruptor 早期版本透過繼承進行位元組填充：
class LhsPadding {
    protected long p1, p2, p3, p4, p5, p6, p7; // 7 * 8 = 56 位元組
}
class Value extends LhsPadding {
    protected volatile long value;             // 核心變數
}
class RhsPadding extends Value {
    protected long p9, p10, p11, p12, p13, p14, p15; // 右側再填充 56 位元組
}
```
Java 8 之後則提供了 `@jdk.internal.vm.annotation.Contended` 註解，由 JVM 在載入類別時自動在目標欄位前後插入 128 位元組的隔離區間（支援跨架構與 Prefetcher）。

## 常見誤解與邊界

1. **誤解：只有全域變數才會發生 False Sharing**
   若多執行緒並行修改同一個陣列（如 `long[] array`）中不同索引的元素（例如 Thread 0 改 `array[0]`，Thread 1 改 `array[1]`），因陣列元素在記憶體中完全緊密排列，同樣會引發嚴重的偽共享。
2. **誤解：所有變數都應該做 Cache Line Padding**
   Padding 會使資料結構體積膨脹數倍甚至十倍，導致原本能在單一快取行容納多筆資料的讀多寫少情境喪失「空間局部性」優勢，並白白浪費寶貴的 L1/L2 快取容量。Padding 僅適用於**極高頻並行寫入的熱點核心變數**。

## 相關文件與參考來源

- [指令重排、記憶體屏障與 Happens-Before](instruction-reordering-memory-barriers-and-happens-before.md)：探討快取寫入緩衝區（Store Buffer）引發的順序錯亂。
- [無鎖並行資料結構：Disruptor 環狀緩衝](lock-free-queues-and-the-disruptor-ring-buffer.md)：了解無鎖架構如何極致壓榨 Cache Line。
- 參考文獻：
  - *Intel® 64 and IA-32 Architectures Optimization Reference Manual*, §3.7.3 (False Sharing & Cache Organization).
  - Papamarcos & Patel, *A Low-Overhead Coherence Solution for Multiprocessors with Private Cache Memories*, ISCA 1984 (MESI Specification).
