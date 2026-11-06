# 比較並交換 (CAS)、原子操作 (Atomics) 與 ABA 陷阱

互斥鎖（Mutex）雖然可靠，但其背後的排程切換、死鎖風險與快取失效代價，在追求極致延遲的場景中成為了不可逾越的瓶頸。為了榨乾硬體的運算潛力，系統工程師開拓了一條截然不同的道路——**無鎖程式設計 (Lock-Free Programming)**。

無鎖技術的核心基石，是 CPU 提供的硬體級原子指令：**比較並交換 (Compare-And-Swap, CAS)**。然而，樂觀重試的機制也帶來了並行領域最著名的經典陷阱——**ABA 問題**。

## 悲觀鎖 vs 樂觀並行 (Lock-Free)

- **悲觀鎖 (Pessimistic Locking)**：假定衝突必定發生。在踏入臨界區之前，先透過 Mutex 鎖住資源，強迫所有人排隊。其安全且適用於衝突極為劇烈、操作複雜的長事務，但存在上下文切換開銷與死鎖風險。
- **樂觀並行 (Optimistic Concurrency / Lock-Free)**：假定衝突是少數情況。**不加鎖直接讀取並計算新值**；在將新值寫回記憶體的最後瞬間，以硬體指令檢查：「記憶體中的數值是否依然是我當初讀到的舊值？」若無人篡改，原子性寫入新值；若已被他人修改，則放棄當前結果並在迴圈中重新嘗試。

無鎖架構保證了**系統整體始終有進展（System-wide Progress）**：即使某個執行緒在執行過程中意外崩潰或被排程器掛起，絕對不會導致其他執行緒永久卡死。

## 硬體級原子指令：CAS (Compare-And-Swap)

現代 CPU（x86、ARM、RISC-V）在硬體層級提供了一組特殊的原子指令。在 x86 架構中，這條指令是帶有 `LOCK` 前綴的 `CMPXCHG`（Compare and Exchange）。

其語意可用以下 C 語言偽代碼精準描述（注意：這段邏輯由 CPU 硬體在單一指令週期內不可分割地完成）：

```c
// 硬體原子語意 (不可分割的原子操作)
bool CAS(int* addr, int expected_val, int new_val) {
    if (*addr == expected_val) {
        *addr = new_val;
        return true;  // 成功替換
    }
    return false;     // 記憶體已被他人修改，替換失敗
}
```

```
           [ 記憶體位址 addr ] ── 存放著數值 V
                   │
                   ▼
     ┌───────────────────────────┐
     │ 執行硬體 CMPXCHG 原子指令 │
     └─────────────┬─────────────┘
                   │
        ┌──────────┴──────────┐
   V == expected          V != expected
        │                     │
        ▼                     ▼
【 將 new_val 寫入 】    【 不做變更，返回失敗 】
【 返回成功 (true) 】    【 執行緒取得最新值並重試 】
```

### 現代 CPU 如何保證 CAS 的原子性？
早期的多處理器系統採用**匯流排鎖定（Bus Locking）**：CPU 核心在發起 `LOCK` 指令時，拉低主機板上的 LOCK 實體引腳，阻斷全系統所有其他核心存取記憶體匯流排，代價極高。

現代 CPU 則採用**快取鎖定 (Cache Locking)**：若目標記憶體位址已經被該核心載入在 L1/L2 快取中，硬體透過 **MESI 快取一致性協定**，將該 64-byte Cache Line 標記為 Exclusive 或 Modified 狀態，獨佔並原子性地完成修改與寫回，**完全不干擾其他核心存取其他不相關的快取行**，效能相較於總線鎖提升了數個數量級。

## 原子變數實踐：CAS 自旋重試迴圈

高階語言封裝了硬體 CAS 操作（如 C++11 `<atomic>`、Rust `std::sync::atomic`、Java `AtomicLong`、Go `sync/atomic`）。一個無鎖的原子計數器核心迴圈如下：

```c
#include <stdatomic.h>

void atomic_add(atomic_long* obj, long delta) {
    long current = atomic_load(obj);
    // CAS 失敗時，atomic_compare_exchange_weak 會自動將 current 更新為最新值
    while (!atomic_compare_exchange_weak(obj, &current, current + delta)) {
        // 自旋重試 (CAS Loop)，零 Context Switch 開銷
    }
}
```

在高並發計數情境下，多個執行緒並行調用 `atomic_add`，勝利者成功推進數值，失敗者只需重新載入最新值並再次嘗試，消除了互斥鎖的排隊休眠代價。

## 隱密的致命陷阱：ABA 問題

CAS 檢查的核心前提是：「若數值等於預期舊值，則代表記憶體從未被變更過。」
然而，在指標操作與記憶體回收的環境中，這個假設會帶來災難性的邏輯漏洞——**ABA 問題**。

### ABA 的經典時序：
1. 執行緒 1 準備修改變數 $V$，讀取到目前值為 **A**。
2. 執行緒 1 突然被作業系統排程器切換走（暫停）。
3. 執行緒 2 啟動，將變數 $V$ 的值從 **A 改為 B**。
4. 執行緒 2 緊接著又將變數 $V$ 的值從 **B 改回 A**。
5. 執行緒 1 重新恢復執行，發起 CAS 操作比對：「$V$ 的值依然是 **A**！」CAS 判定成功並寫入新值。

```
Thread 1:  讀取 V = A ────────────────(暫停掛起)────────────────▶ CAS(A, New) -> 判定成功!
Thread 2:              寫入 V = B ──▶ 寫入 V = A ──▶ 完成
時間軸 ──▶
```

### 為什麼數值沒變卻是災難？無鎖棧 (Lock-Free Stack) 的毀滅案例
在數值累加（如 10 ➔ 20 ➔ 10）時，ABA 通常無害；但若操作的是**記憶體指標（Pointer）**，後果不堪設想：

```
初始狀態：Stack 頂端 (Top) 指向節點 A，A 的 next 指向節點 B
Top ──▶ [ Node A ] ──▶ [ Node B ] ──▶ NULL
```

1. 執行緒 1 嘗試出棧（Pop）：記錄 `old_top = A`，預計將 Top 指向 `A->next`（即節點 B）。此時執行緒 1 被中斷。
2. 執行緒 2 連續兩次出棧，將 A 與 B 全數彈出，並呼叫 `free(A)` 釋放了 A 的記憶體。
3. 執行緒 2 隨後建立了一個全新的節點 C，**記憶體分配器（malloc）恰好把剛剛釋放的記憶體位址重新分配給了 C**，且 C 的 `next` 指向 NULL。接著執行緒 2 又將其命名（或復原）為 A 放回棧頂。
4. 執行緒 1 甦醒，執行 `CAS(&Top, old_top, old_top->next)`：
   - 檢查發現 `Top` 的位址依然等於 `old_top`（因為記憶體位址被重複利用了！）。
   - CAS 成功，執行緒 1 將 Top 改為指向舊的 `B`！
   - **毀滅結果**：節點 B 早已被釋放銷毀，Top 現在指向了一個無效的野指針（Dangling Pointer），後續存取直接觸發非法記憶體存取崩潰！

## ABA 問題的標準防禦：版本號標記 (Tagged Pointer)

防禦 ABA 的根本手段是**引入單調遞增的版本標記（Version Stamp）**：變更的不僅是數值，還包括版本號。
即使數值從 $A$ 變為 $B$ 再變回 $A$，其版本號也經歷了 $(A, 1) \to (B, 2) \to (A, 3)$。執行緒 1 拿著舊版本 $(A, 1)$ 來比較時，CAS 發現版本號不符，果斷拒絕操作。

### 1. 雙字長度原子指令 (Double-width CAS)
在 x86-64 架構上，硬體提供了 `CMPXCHG16B` 指令，能**同時原子性地比較並替換連續 16 個位元組（128-bit）**的資料。工程師可以將 64 位元的指標與 64 位元的版本號整合成一個 128 位元的結構體，完成無鎖防禦。

### 2. 高階語言封裝
Java 提供了 `AtomicStampedReference` 類別，底層同時保存物件參照與整數 Stamp：
```java
AtomicStampedReference<Node> top = new AtomicStampedReference<>(nodeA, 0);

// 更新時同時比對物件參照與版本號
int[] stampHolder = new int[1];
Node oldNode = top.get(stampHolder);
int oldStamp = stampHolder[0];

boolean success = top.compareAndSet(oldNode, newNode, oldStamp, oldStamp + 1);
```

## 常見誤解與架構限制

1. **誤解：無鎖（Lock-Free）永遠比互斥鎖（Mutex）快**
   在鎖競爭極端劇烈的「超級熱點」下，幾十個 CPU 核心同時執行 CAS 迴圈，絕大多數執行緒會不斷失敗重試。這不僅會讓 CPU 核心飆到 100% 滿載，還會在 CPU 內部匯流排上引發頻繁的 Cache Line Invalidate 廣播風暴（Bus Contention）。在此情境下，透過分段計數（如 Java `LongAdder`）或直接使用 Mutex 排隊休眠，系統整體吞吐反而更好。
2. **誤解：CAS 能夠保證多個變數的跨記憶體原子更新**
   單條 CAS 指令只能保證單一變數（或單一 128-bit 記憶體區塊）的原子性。如果業務操作需要同時修改位在不同記憶體位址的多個獨立變數，單靠 CAS 無法完成，必須使用軟體交易記憶體（STM）、無鎖狀態機，或回歸互斥鎖保護。

## 相關文件與參考來源

- [無鎖並行資料結構：Lock-Free Queue 與 Disruptor](lock-free-queues-and-the-disruptor-ring-buffer.md)：探討如何利用 CAS 構建工業級無鎖並行佇列。
- [CPU 快取階層與一致性](cpu-cache-hierarchy-mesi-and-false-sharing.md)：回顧 Cache Line 與 MESI 一致性廣播的硬體限制。
- 參考文獻：
  - Herlihy, M., & Shavit, N., *The Art of Multiprocessor Programming*, Chapter 10 (Queue Implementations and the ABA Problem).
  - Intel® 64 and IA-32 Architectures Software Developer's Manual, Volume 2A: Instruction Set Reference (CMPXCHG / LOCK Prefix).
