# 死鎖 (Deadlock)、活鎖與飢餓：成因、偵測與防禦架構

在並行程式設計中，鎖是保護資料一致性的利刃，但若多個鎖之間的協調失去秩序，系統將可能陷入整體的癱瘓——這就是**死鎖 (Deadlock)**。更隱密的並行異常還包括雖然 CPU 瘋狂運轉卻毫無業務進展的**活鎖 (Livelock)**，以及特定任務永遠得不到資源的**飢餓 (Starvation)**。

要消滅死鎖，不能依賴運氣或臨時補救，而必須從計算機科學奠基的 **Coffman 四大條件** 著手，在架構設計層面從數學上根除死鎖發生的可能性。

## 什麼是死鎖？經典的轉帳陷阱

考慮一個後端常見的銀行帳戶轉帳服務：

```c
void transfer(Account* from, Account* to, double amount) {
    pthread_mutex_lock(&from->lock);
    pthread_mutex_lock(&to->lock);

    from->balance -= amount;
    to->balance += amount;

    pthread_mutex_unlock(&to->lock);
    pthread_mutex_unlock(&from->lock);
}
```

這段程式碼在單次測試時運作正常，但在高併發下隱藏著致命隱患：
- 執行緒 1 處理：**帳戶 A 轉帳給 帳戶 B**（先鎖 A，再嘗試鎖 B）
- 執行緒 2 同時處理：**帳戶 B 轉帳給 帳戶 A**（先鎖 B，再嘗試鎖 A）

```
Thread 1 (A 轉 B)                              Thread 2 (B 轉 A)
┌──────────────────────────────────────┐        ┌──────────────────────────────────────┐
│ 1. 成功獲取 A->lock                   │        │ 1. 成功獲取 B->lock                   │
│ 2. 嘗試獲取 B->lock ... ⏳ (被阻塞!)  │        │ 2. 嘗試獲取 A->lock ... ⏳ (被阻塞!)  │
└──────────────────────────────────────┘        └──────────────────────────────────────┘
                   │                                               │
                   ▼                                               ▼
          【 等待 Thread 2 釋放 B 】                     【 等待 Thread 1 釋放 A 】
                   └─────────────────── 互相等待形成死結 ───────────┘
```

兩個執行緒各持有一把鎖，同時苦等對方釋放自己所需的下一把鎖。此時作業系統會將兩者同時掛起休眠，CPU 佔用率降為 0%，但轉帳功能**永久卡死凍結**，唯有重啟進程才能解除。

## Coffman 死鎖四大必要條件 (1971)

計算機科學家 Edward G. Coffman 等人在 1971 年嚴格證明：**死鎖的發生，必須且僅在以下四個條件同時滿足時才會成立**：

| 條件名稱 | 具體定義 | 破壞此條件的架構防禦策略 |
|---|---|---|
| **1. 互斥條件 (Mutual Exclusion)** | 資源一次只能被一個執行緒獨佔，他人若想使用必須等待。 | 使用無鎖資料結構（如 CAS 原子操作、Read-Copy-Update）替代互斥鎖。 |
| **2. 持有並等待 (Hold and Wait)** | 一個執行緒已經持有了至少一個資源，同時又在等待獲取其他被佔用的資源。 | 採用**一次性全額申請**（若拿不到全部就一個都不拿），或使用 `tryLock` 遇阻退讓。 |
| **3. 不可搶佔條件 (No Preemption)** | 已經被某執行緒持有的資源，在該執行緒主動釋放前，他人**不得強制剝奪**。 | 當執行緒申請新鎖被拒時，主動強制釋放自己已持有的所有舊鎖（主動讓渡）。 |
| **4. 循環等待條件 (Circular Wait)** | 存在一組執行緒 $\{T_1, T_2, \dots, T_n\}$，其中 $T_1$ 等待 $T_2$ 持有的資源，$T_2$ 等待 $T_3$……$T_n$ 等待 $T_1$，形成首尾相連的環狀依賴鏈。 | **制定全域統一的鎖排序規則 (Lock Ordering)**，嚴格依序申請。 |

> **數學保證：只要在系統架構中徹底破壞這四個條件中的「任意一個」，死鎖在物理上就絕對不可能發生！**

## 架構實踐：破壞死鎖條件的最佳策略

### 1. 破壞循環等待：資源全域排序法 (Lock Ordering)
這是工程上防禦死鎖最有效、開銷最低的手段。所有執行緒在申請多個鎖時，**必須嚴格依照全域統一的順序進行獲取**。

以先前的帳戶轉帳為例，我們可以根據帳戶的唯一識別碼（如 Account ID）進行大小排序：
```c
void safe_transfer(Account* from, Account* to, double amount) {
    if (from == to) return; // 防禦自轉

    Account* first = from->id < to->id ? from : to;
    Account* second = from->id < to->id ? to : from;

    // 永遠先鎖 ID 小的，再鎖 ID 大的
    pthread_mutex_lock(&first->lock);
    pthread_mutex_lock(&second->lock);

    from->balance -= amount;
    to->balance += amount;

    pthread_mutex_unlock(&second->lock);
    pthread_mutex_unlock(&first->lock);
}
```
無論傳入參數的先後順序為何，Thread 1 與 Thread 2 都會先去競爭較小 ID 的鎖。勝利者緊接著去拿較大 ID 的鎖，失敗者在起點就被攔截排隊，**資源等待圖中永遠不會出現任何環路，循環等待被徹底打破**。

### 2. 破壞持有並等待：TryLock 與隨機退避 (Backoff)
若無法對所有鎖進行預先排序，可使用具備超時機制的 `tryLock`：
```c
bool try_acquire_both(pthread_mutex_t* lockA, pthread_mutex_t* lockB) {
    while (true) {
        pthread_mutex_lock(lockA);
        if (pthread_mutex_trylock(lockB) == 0) {
            return true; // 成功同時拿到兩把鎖
        }
        // 拿不到 lockB，主動釋放已持有的 lockA，破壞「持有並等待」
        pthread_mutex_unlock(lockA);

        // 隨機微小休眠 (Jitter)，避免與對手同頻共振引發活鎖
        usleep(rand() % 1000);
    }
}
```

## 活鎖 (Livelock) 與飢餓 (Starvation)

### 1. 活鎖 (Livelock)
執行緒並沒有陷入阻塞休眠，而是在持續運轉，但彼此都在極度禮貌地「主動退讓」，導致所有人都在空轉消耗 CPU，業務進展為零。
- **形象比喻**：兩個人在狹窄走廊迎面走來，為了避免相撞，兩人同時往左讓，又同時往右讓，反覆橫移卻誰也過不去。
- **解決方案**：在退讓重試時引入**隨機化指數退避（Randomized Exponential Backoff / Jitter）**，打亂兩者的重試節奏，使一人能率先越過臨界區。

### 2. 飢餓 (Starvation)
某些執行緒由於排程策略不公或優先權過低，長期處於就緒狀態卻永遠輪不到 CPU，或者永遠搶不到鎖。
- **典型案例**：讀者優先的讀寫鎖中，寫者遭遇的飢餓；或是非公平自旋鎖中，新來的執行緒總是先一步搶到鎖，老排隊者永遠被插隊。
- **解決方案**：採用 **公平鎖 (Fair Lock)**，內部以嚴格的 FIFO 佇列管理等待者，禁止插隊。

## 優先權反轉 (Priority Inversion) 與火星拓荒者號災難

1997 年，NASA「火星拓荒者號（Mars Pathfinder）」探測器登陸火星後發生了著名的系統反覆重啟故障，其罪魁禍首正是**優先權反轉**：

```
時間軸 ──▶
低優先權任務 L:   [ 獲取互斥鎖 M ] ──(被搶佔)────────────────────▶ [ 繼續執行並釋放 M ]
中優先權任務 M:                    [ 搶佔 CPU，執行長計算... ] ──▶
高優先權任務 H:     [ 想獲取鎖 M，被掛起等待 L ] ────────────────▶ (被迫長期等待 M 完成!)
```

1. 低優先權任務 L 獲取了共用互斥鎖。
2. 高優先權任務 H 啟動，嘗試獲取該鎖，因鎖被佔用而掛起休眠。
3. 此時出現了中優先權任務 M（不需要該鎖），因為優先權高於 L，作業系統排程器毫不猶豫地搶佔 CPU 讓 M 運行。
4. 結果：**高優先權任務 H 被迫等待不需要鎖的中優先權任務 M 執行完畢，L 才能有機會拿回 CPU 釋放鎖！** H 遭遇實質上的無限期阻斷，觸發看門狗（Watchdog）判定系統當機並強制重啟。

### 解法：優先權繼承協定 (Priority Inheritance Protocol, PIP)
當高優先權任務 H 阻塞等待低優先權任務 L 手中的鎖時，作業系統**暫時將 L 的優先權提升至與 H 相同**。如此一來，中優先權任務 M 就無法搶佔 L，L 能以最高優先權快速完成臨界區並退鎖，退鎖後 L 恢復原優先權，H 立即接管 CPU，徹底消除優先權反轉。

## 相關文件與參考來源

- [競態條件與互斥鎖：Mutex 與 Futex](race-conditions-mutex-futex-and-spinlocks.md)：複習基礎互斥機制與系統呼叫代價。
- [比較並交換 (CAS) 與原子操作](compare-and-swap-atomics-and-the-aba-problem.md)：探索如何以無鎖演算法完全規避死鎖。
- 參考文獻：
  - Coffman, E. G., Elphick, M., & Shoshani, A., *System Deadlocks*, ACM Computing Surveys (1971).
  - Sha, L., Rajkumar, R., & Lehoczky, J. P., *Priority Inheritance Protocols: An Approach to Real-Time Synchronization*, IEEE Transactions on Computers (1990).
  - Mike Jones, *What Really Happened on Mars?*, The Mars Pathfinder Priority Inversion Story (1997).
