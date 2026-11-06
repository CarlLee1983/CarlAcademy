# 指令重排、記憶體屏障與 Happens-Before 記憶體模型

許多並行程式的詭異 Bug，源自一個直覺但危險的假設：「CPU 永遠會按照我寫在原始碼中的順序，逐行逐條地執行指令。」
在現代高效能處理器與編譯器最佳化下，這個假設完全不成立。為了極大化管線吞吐量，指令會被大膽地重新編排；而在多核心架構下，缺乏同步機制的指令重排將導致其他核心讀取到「半初始化物件」或徹底錯亂的狀態。

## 經典災難：雙重檢查鎖定 (DCL) 的崩潰

在單例模式（Singleton）或延遲初始化架構中，工程師曾廣泛採用**雙重檢查鎖定 (Double-Checked Locking, DCL)** 來兼顧效能與安全：

```java
public class ServiceRegistry {
    private static ServiceRegistry instance;

    public static ServiceRegistry getInstance() {
        if (instance == null) { // 第一次檢查 (免鎖，加速讀取)
            synchronized (ServiceRegistry.class) {
                if (instance == null) { // 第二次檢查 (加鎖，防止重複實例化)
                    instance = new ServiceRegistry(); // 致命的一行！
                }
            }
        }
        return instance;
    }
}
```

這段程式碼在多核心 CPU 上運行時，**偶爾會引發毀滅性的 NullPointerException 或資料不完整**。

### 崩潰成因：物件實例化的指令重排
在高階語言視角中，`instance = new ServiceRegistry()` 看似一條語句，但在底層組合語言中被拆解為三個步驟：
1. `memory = allocate();` （在堆積上分配記憶體空間）
2. `ctorInstance(memory);` （執行建構函式，初始化欄位資料）
3. `instance = memory;`     （將物件的記憶體指標賦值給 `instance` 靜態變數）

在單執行緒視角中，步驟 2 與步驟 3 誰先執行，並不影響該執行緒最後獲得正確的物件。因此，編譯器或 CPU 核心極有可能將其**重排為：1 ➔ 3 ➔ 2**。

```
Thread A (執行實例化)                         Thread B (嘗試獲取實例)
┌─────────────────────────────────────┐      ┌─────────────────────────────────────┐
│ 1. allocate() 分配記憶體空間        │      │                                     │
│ 3. instance = memory (指標已非空!)  │      │ 呼叫 getInstance()                  │
│                                     │ ───▶ │ 檢查 if (instance == null) -> false!│
│                                     │      │ 直接返回 instance 並存取內部欄位!   │
│                                     │      │ 💥 讀取到「未初始化完畢的半物件」!  │
│ 2. ctorInstance() 正在執行建構函式..│      └─────────────────────────────────────┘
└─────────────────────────────────────┘
```

當 Thread A 執行完步驟 3 但**步驟 2 尚未完成**的瞬間，Thread B 恰好進入 `getInstance()`。Thread B 發現 `instance` 已非空，直接返回該指標並調用其方法。然而此時該物件內部的成員變數完全處於預設零值或未定義狀態，導致全系統資料錯亂。

## 指令重排的兩大源頭

現代系統中有兩個層級會主動打亂指令順序：

```
原始碼 ──▶ [ 編譯期重排 (Compiler) ] ──▶ 目標機器碼 ──▶ [ 執行期 CPU 亂序 (Out-of-Order) ] ──▶ 實體硬體
```

### 1. 編譯期重排 (Compiler Reordering)
靜態編譯器（如 GCC、Clang、Rustc）與即時編譯器（JIT）為了減少暫存器溢出（Spilling）與避免 CPU 管線停頓，會在不違反**單執行緒語意（as-if-serial）**的前提下調整指令順序。只要在單一執行緒內執行結果與順序執行無異，編譯器就有權自由重排。

### 2. 執行期 CPU 亂序執行 (Hardware Out-of-Order Execution)
為了隱藏快取存取延遲，現代超純量（Superscalar）CPU 引入了額外的硬體緩衝結構：
- **Store Buffer (寫緩衝區)**：CPU 核心執行寫入指令時，若該 Cache Line 不在私有 L1 快取中，核心不會傻傻停頓等待匯流排確認，而是將寫入暫存於極速的 Store Buffer 中，隨即轉身去執行後續的讀取指令（引發 Store-Load 重排）。
- **Invalidate Queue (失效佇列)**：當核心收到其他核心廣播的 Cache Line 失效訊號時，先將訊息推進 Invalidate Queue 並立即回覆 ACK，延後非同步處理快取失效，導致該核心在短暫視窗內依然讀取到已過期的舊資料。

## 硬體記憶體屏障 (Memory Barrier / Fence)

為了在需要嚴格順序的並行邊界上約束硬體，CPU 架構提供了專門的機器指令——**記憶體屏障 (Memory Barrier)**：

| 屏障類型 | 硬體行為與保證 |
|---|---|
| **寫屏障 (Store Barrier / Write Fence)** | 強制將 Store Buffer 中的所有暫存寫入全數刷出至快取。**保證屏障前的所有寫入，先於屏障後的所有寫入被其他核心看見**。 |
| **讀屏障 (Load Barrier / Read Fence)** | 強制清空處理 Invalidate Queue 中的所有條目。**保證屏障後的所有讀取，必定讀取到最新的快取狀態，不得預先讀取**。 |
| **全屏障 (Full Barrier, 如 x86 `MFENCE`)** | 同時具備寫屏障與讀屏障的所有語意，強制兩側的讀寫操作皆不可跨越屏障。 |

- **強記憶體模型 vs 弱記憶體模型**：
  - **x86-TSO (Total Store Order)**：屬於強記憶體模型。硬體保證 Load-Load、Store-Store、Load-Store 都不會被重排，**唯一會發生的重排是 Store-Load**。
  - **ARM64 / POWER**：屬於弱記憶體模型（Weak Memory Model）。硬體預設允許任意讀寫指令相互重排，極度依賴工程師或編譯器在關鍵處精確插入記憶體屏障（如 ARM 的 `DMB` 指令）。

## 語言級記憶體模型與 Happens-Before 規範

不同 CPU 架構的屏障指令各異，直接寫組合語言既不可移植又極易出錯。為此，現代語言（Java JSR-133、C++11 `<atomic>`、Go Memory Model）制定了跨硬體的**記憶體模型 (Memory Model)**，核心抽象為 **Happens-Before 偏序規則**。

> **定義**：若操作 $A$ happens-before 操作 $B$（記作 $A \to B$），則 $A$ 產生的所有記憶體寫入結果，在 $B$ 執行時**保證對 $B$ 完全可見**，且 $A$ 的執行順序**保證排在 $B$ 之前**。

### 六大關鍵 Happens-Before 規則：

1. **程式順序規則 (Program Order Rule)**：在同一個執行緒內，按照原始碼書寫的控制流，書寫在前面的操作 happens-before 書寫在後面的操作。
2. **監視器鎖規則 (Monitor Lock Rule)**：對一個互斥鎖的釋放（Unlock），happens-before 後續對同一個鎖的獲取（Lock）。
3. **Volatile 變數規則 (Volatile Variable Rule)**：對一個 `volatile`（或 C++ `memory_order_seq_cst`）變數的寫入，happens-before 後續對該變數的讀取。
4. **執行緒啟動規則 (Thread Start Rule)**：主執行緒呼叫子執行緒的 `start()` 操作，happens-before 該子執行緒內的第一條指令。
5. **執行緒終止規則 (Thread Termination Rule)**：子執行緒內的所有操作，happens-before 其他執行緒在 `join()` 成功返回之後的操作。
6. **傳遞性 (Transitivity)**：若 $A \to B$ 且 $B \to C$，則保證 $A \to C$。

### 修復 DCL：利用 volatile 的記憶體屏障
在 Java 中，只需將實例變數加上 `volatile` 修飾：
```java
private static volatile ServiceRegistry instance;
```
編譯器會在寫入 `instance` 指標之前強制插入 Store-Store 屏障，並在其後插入 Store-Load 屏障。這**嚴格禁止了步驟 2（建構函式）與步驟 3（指標指派）發生重排**，徹底封死了「半初始化物件」外洩的漏洞。

## 常見誤解與實際限制

1. **誤解：加上 `volatile` 就能讓 `count++` 變成執行緒安全**
   `volatile` 僅能保證**單次讀／寫的可見性與禁止重排**，但 `count++` 在底層是由三個獨立步驟組成：(1) Read 讀取數值；(2) Modify 暫存器加一；(3) Write 寫回記憶體。若多個執行緒同時執行，依然會發生交錯覆蓋。複合操作必須使用原子操作（CAS）或互斥鎖。
2. **誤解：只要在單執行緒跑沒問題，多執行緒就只會遇到搶鎖問題**
   若共享變數沒有建立 Happens-Before 保證，一個執行緒修改了變數，另一個執行緒可能因為 Invalidate Queue 未處理或快取未刷出，在死迴圈中**永遠讀取到舊的 0 或 false**，造成程式永遠無法退出。

## 相關文件與參考來源

- [競態條件與互斥鎖：Mutex、Futex 與自旋鎖](race-conditions-mutex-futex-and-spinlocks.md)：理解鎖的獲取與釋放如何透過記憶體屏障實作 Happens-Before。
- [比較並交換 (CAS) 與原子操作](compare-and-swap-atomics-and-the-aba-problem.md)：探討無需 Mutex 的底層硬體指令原子性保證。
- 參考文獻：
  - Manson, J., Pugh, W., & Adve, S. V., *The Java Memory Model*, POPL 2005 (JSR-133).
  - Russ Cox, *The Go Memory Model* (Official Go Specification, 2022 Revision).
  - ISO/IEC 14882:2011 (C++11 Standard), §29: Atomic operations library (Acquire/Release Semantics).
