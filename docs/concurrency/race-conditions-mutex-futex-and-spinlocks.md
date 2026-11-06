# 競態條件與互斥鎖：Mutex、Futex 與自旋鎖 (Spinlock)

當多個執行緒同時運行並存取共享的記憶體資料時，如果沒有協調機制，程式將陷入**競態條件 (Race Condition)** 的泥淖。為了保護共享資源的完整性，我們需要將特定程式碼區塊劃定為**臨界區 (Critical Section)**，並透過鎖機制實現**互斥 (Mutual Exclusion)**。

然而，加鎖並非零成本。從傳統笨重的核心互斥鎖，到現代 Linux 極速的 **Futex**，再到 CPU 忙碌等待的**自旋鎖 (Spinlock)**，理解其底層機制是設計高吞吐並行系統的關鍵。

## 競態條件的物理真相：count++ 為什麼會漏算？

在多執行緒計數情境中，最常見的錯誤莫過於直接讓多個執行緒累加一個全域變數：

```c
long count = 0;

void* worker(void* arg) {
    for (int i = 0; i < 100000; i++) {
        count++; // 非原子性的臨界區操作！
    }
    return NULL;
}
```

若兩個執行緒各跑 100,000 次，最終 `count` 的值往往遠小於 200,000（通常只有十幾萬）。

### 底層彙編指令的交錯（Interleaving）
在高階語言中的單一語句 `count++`，編譯後會轉化為三條機器指令：
1. `MOV RAX, [count]` （**Read**：將記憶體中的 `count` 載入 CPU 暫存器）
2. `ADD RAX, 1`       （**Modify**：在暫存器內將數值加 1）
3. `MOV [count], RAX` （**Write**：將暫存器的新數值寫回記憶體）

```
時間軸 ──▶
Core 0 (Thread 1)       Core 1 (Thread 2)       記憶體 count 數值
──────────────────────────────────────────────────────────────────
MOV RAX, [count] (讀到 5)                       count = 5
                        MOV RAX, [count] (也讀到 5)
ADD RAX, 1 (算得 6)                             count = 5
                        ADD RAX, 1 (算得 6)
MOV [count], RAX (寫回 6)                       count = 6
                        MOV [count], RAX (覆蓋為 6!) 💥 count = 6 (漏算一次!)
```

因為兩個核心的操作在時間上發生交錯，兩次加法運算最終只使計數器遞增了 1。這段存取共享變數的程式碼區段就是**臨界區**；互斥機制的核心目標，就是保證**同一時刻至多只有一個執行緒能踏入臨界區**。

## 傳統互斥鎖的瓶頸：過重的系統呼叫

早期 Unix 作業系統實作的互斥鎖（Mutex），其加鎖與解鎖全部仰賴核心系統呼叫。

在這種架構下，即使系統中**完全沒有其他競爭者**，單一執行緒要進入臨界區，也必須發起軟體中斷（如 `int 0x80` 或 `syscall`）陷入核心模式，讓核心檢查鎖結構體。系統呼叫伴隨著暫存器保存、核心堆疊切換與檢查，單次耗時高達數十至數百奈秒。在大規模並發的高頻交易或快取系統中，這種無競爭下的無謂損耗完全無法承受。

## 現代 Linux 的基石：Futex (Fast Userspace Mutex)

為了終結無競爭下的核心切換浪費，Linux 核心在 2.6 版本引入了 **Futex（快速使用者空間互斥體）**。其哲學極其精妙：
> **無競爭時在使用者空間搞定；唯有發生真正衝突時，才請求核心出面排隊休眠。**

```
執行緒嘗試加鎖 (Lock)
         │
         ▼
[ 原子 CAS 檢查使用者空間整數 (futex_val) ]
         │
    ┌────┴───────────────────────────┐
成功 (原值為 0 -> 變為 1)        失敗 (已被他人持有)
    │                                │
    ▼                                ▼
【 零系統呼叫，直接進入臨界區! 】    發起系統呼叫 futex(val, FUTEX_WAIT)
(僅需 2–3 個 CPU 週期)               │
                                     ▼
                        【 核心將執行緒置入等待佇列並休眠 】
```

### Futex 的兩段式運作原理：

1. **無競爭加鎖 (Fast Path - User Space)**：
   - 鎖在使用者空間對應一個標準的 32 位元整數變數（`futex_val`）。
   - 執行緒進入臨界區時，直接透過 CPU 原生原子指令 `CMPXCHG`（Compare-And-Swap）嘗試將數值從 `0`（未上鎖）原子性地修改為 `1`（已上鎖）。
   - 若成功，執行緒**完全不需要進入作業系統核心**，直接踏入臨界區。
2. **發生競爭休眠 (Slow Path - Kernel Space)**：
   - 若 CAS 失敗，說明鎖已被其他執行緒奪走。
   - 該執行緒發起 `futex(val_addr, FUTEX_WAIT, 1)` 系統呼叫進入核心。核心會再次核對該位址的值是否仍為 `1`；若成立，核心將該執行緒的狀態設定為 `TASK_INTERRUPTIBLE`，掛入該 Futex 的核心等待佇列中，並觸發排程器切換其他任務執行。
3. **釋放喚醒 (Unlock)**：
   - 持有鎖的執行緒退出臨界區時，原子性地將 `futex_val` 設回 `0`。
   - 若發現有其他執行緒在等待，發起 `futex(val_addr, FUTEX_WAKE, 1)` 系統呼叫，通知核心從等待佇列中喚醒一個排隊的執行緒。

透過 Futex，現代語言的標準鎖（如 C++ `std::mutex`、POSIX `pthread_mutex`、Rust `std::sync::Mutex`）在絕大多數無衝突的情境下，效能逼近原生記憶體讀寫。

## 自旋鎖 (Spinlock) vs 互斥鎖 (Mutex)

當執行緒搶不到鎖時，除了「進入核心休眠等待被喚醒」之外，還有另一種激進的選擇——**自旋等待 (Busy-Waiting)**：

| 比較特性 | 自旋鎖 (Spinlock) | 互斥鎖 (Mutex / Futex) |
|---|---|---|
| **等待行為** | **不放棄 CPU**，在死迴圈中執行 CPU `PAUSE` 指令不斷重試搶鎖 | **放棄 CPU**，讓出執行權，由核心掛起並在稍後喚醒 |
| **切換開銷** | **零 Context Switch 開銷**；延遲極低 | 伴隨兩次上下文切換（休眠切出 + 喚醒切入），開銷約數微秒 |
| **CPU 資源消耗** | 等待期間 CPU 核心佔用率達到 100%（空轉燃燒算力） | 等待期間不佔用 CPU 計算資源 |
| **最佳適用場景** | 臨界區**極端短小**（僅修改一兩個指標）；作業系統核心中斷處理常式（禁止休眠） | 臨界區較長、包含 I/O 操作或鎖競爭激烈的應用層服務 |

```c
// 自旋鎖簡化概念 (以 GCC 內建原子操作為例)
void spin_lock(atomic_flag* lock) {
    while (atomic_flag_test_and_set_explicit(lock, memory_order_acquire)) {
        #if defined(__x86_64__) || defined(_M_X64)
        __builtin_ia32_pause(); // 向 CPU 發出提示，優化流水線並降低功耗
        #endif
    }
}
void spin_unlock(atomic_flag* lock) {
    atomic_flag_clear_explicit(lock, memory_order_release);
}
```

### 自適應互斥鎖 (Adaptive Mutex) 的融合折衷
純粹的 Mutex 會過早讓執行緒休眠，而純粹的 Spinlock 則會在長時間等待時榨乾 CPU。因此，現代高階執行環境（如 Java `synchronized`、Linux glibc `PTHREAD_MUTEX_ADAPTIVE_NP`）採用了**自適應鎖 (Adaptive Lock)**：
> 當搶鎖失敗時，**先自旋一定次數（例如幾十至幾百個 CPU 週期）**；如果在自旋期間鎖持有者釋放了鎖，則立刻拿到鎖，省去 Context Switch；若自旋超時仍未拿到鎖，才轉入 Futex 休眠。

## 常見誤解與架構限制

1. **誤解：鎖能保證安全，所以把整個方法都鎖起來最省事（粗粒度鎖）**
   粗粒度鎖會將原本平行運算的多核心系統徹底退化為單執行緒串列執行（Serial Execution）。在並發系統中，鎖的持有時間越長，鎖競爭（Lock Contention）引發的佇列堆積越嚴重。優化原則永遠是：**極小化臨界區，只鎖真正需要被保護的共享資料**。
2. **誤解：自旋鎖永遠比互斥鎖快**
   如果臨界區內包含磁碟讀寫、網路 I/O 或等待另一個慢速操作，持有鎖的執行緒可能需要數毫秒才退鎖。此時若其他執行緒使用自旋鎖，多個 CPU 核心將在這數毫秒內以 100% 滿載發熱空轉，不僅拖垮系統整體吞吐，還會引發嚴重的 CPU 飢餓。

## 相關文件與參考來源

- [讀寫鎖、條件變數與執行緒通訊](read-write-locks-condition-variables-and-signaling.md)：探索如何將讀操作與寫操作進一步解耦。
- [死鎖、活鎖與飢餓防禦](deadlocks-livelocks-starvation-and-coffman-conditions.md)：分析多鎖嵌套獲取時的系統凍結防護。
- 參考文獻：
  - Ulrich Drepper, *Futexes Are Strange*, Red Hat Inc. (2011).
  - Linux man-page: `futex(2)`, `pthread_mutexattr_settype(3)`.
  - Herlihy, M., & Shavit, N., *The Art of Multiprocessor Programming*, Chapter 7 (Spin Locks and Contention).
