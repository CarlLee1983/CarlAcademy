# Redis 資料結構深度剖析與執行模型

Redis 能夠在單一節點維持數十萬每秒查詢（QPS）的極致效能，源於其針對記憶體量身打造的精準底層資料結構，以及基於 I/O 多路複用的單執行緒 Reactor 事件循環架構。
理解其內部物件模型與執行邊界，是寫出高吞吐且不阻塞服務快取應用的核心前提。

## 執行模型：單執行緒 Reactor 與 I/O 多路複用

Redis 的核心命令處理採用的是典型的 **單執行緒 Reactor 模式（`ae.c`）**。

### 為什麼單執行緒能這麼快？
1. **純記憶體操作**：所有核心資料都在 RAM 中，單次操作耗時多在數十奈秒至微秒之間，CPU 運算並非主要瓶頸。
2. **零多執行緒競爭開銷**：完全消除了執行緒上下文切換（Context Switching）的 CPU 消耗，且內部存取資料無須加裝互斥鎖（Mutex）或讀寫鎖，徹底避免了死鎖與鎖等待。
3. **I/O 多路複用技術（I/O Multiplexing）**：
   - 透過作業系統核心提供的事件機制（Linux 的 `epoll`、macOS 的 `kqueue`），一個執行緒即可同時監聽數萬個用戶端 TCP 連線的讀寫就緒事件。
   - 當某個連線有資料寫入時，核心喚醒 Redis 事件迴圈，依序將其取出並派發給對應的命令處理函式。

### Redis 6.0+ 的 Threaded I/O 責任邊界
自 Redis 6.0 起引入了多執行緒，但必須釐清其責任劃分：
- **輔助執行緒（I/O Threads）**：只負責「從網路 Socket 讀取二進位資料並解析成命令」，以及「將命令執行結果序列化寫回 Socket」。
- **核心命令執行（Main Thread）**：**依然嚴格由單一主執行緒串列化執行**！因此使用者的任何命令（包括 Lua 腳本）依然天然具備單執行緒的原子性（Atomicity），無需擔心並行寫入撕裂。

## 五大核心資料結構的底層內部實現

Redis 對外呈現的資料型別（String, Hash, List, Set, ZSet），其底層會根據資料規模與元素長度，動態切換為空間最節省或搜尋最快的內部編碼（Encoding）：

### 1. String：簡單動態字串（SDS, Simple Dynamic String）
C 語言傳統以 `\0` 結尾的字元陣列存在 $O(N)$ 讀取長度、二進位不安全與容易緩衝區溢位的缺點。Redis 採用自訂的 SDS 結構：
- **結構**：`len`（已用長度）、`alloc`（總配置容量）、`flags`（型別標記）與 `buf[]`（位元組陣列）。
- **優勢**：
  - $O(1)$ 常數時間取得字串長度（直接讀 `len` 欄位）。
  - 二進位安全（可儲存 Protobuf、圖片等包含 `\0` 的二進位資料）。
  - 空間預分配與惰性釋放，大幅減少重新分配記憶體（`realloc`）的頻率。

### 2. Hash：Listpack / ZipList 到 Dict（字典雜湊表）
- **小規模時（Listpack / ZipList）**：若欄位數量少於 512 且長度小於 64 位元組，採用一塊連續的記憶體緊湊存放鍵值對，徹底消滅指標開銷與內部碎片。
- **擴展後（Dict / 雜湊表）**：當資料增長後，轉為標準的鏈結法雜湊表。特別之處在於採用 **漸進式 Rehash（Progressive Rehashing）**：當雜湊表擴容時，不會一次性搬遷百萬筆資料阻塞事件迴圈，而是將搬遷工作分散在後續每一次讀寫操作以及背景定時任務中平滑完成。

### 3. Sorted Set（ZSet）：Listpack 到 SkipList（跳躍表）
ZSet 兼具集合的不重複性與依照分數（Score）排名的能力。
- **大規模時（SkipList + Dict）**：
  - **SkipList（跳躍表）**：透過在節點上建立多層向前推進的索引指標（隨機幾何分佈高度），以類似平衡樹（AVL / 紅黑樹）的效率實現 $O(\log N)$ 的範圍查詢與排名計算。相比平衡樹，跳躍表實作更簡單、範圍遍歷效率更高，且在高併發調整時演算法更容易理解。
  - **Dict 輔助**：底層同時維護一個字典，提供 $O(1)$ 根據成員名稱快速反查 Score 的能力。

## Pipeline 與 Lua 腳本的原子執行邊界

### Pipeline（管線技術）
在網路通訊中，每次執行指令都需要經歷一個往返時間（Round-Trip Time, RTT）。
若要批次執行 100 次 `INCR`，傳統方式需要消耗 100 次 RTT。透過 Pipeline，用戶端將 100 條指令打包成單一 TCP 封包送往 Redis，伺服器依序執行後，再將 100 個結果一次性打包回傳，將耗時縮小為單次 RTT。
- **注意**：Pipeline **不是原子交易**！這 100 條指令在伺服器端排隊時，中間完全可能插入其他用戶端交錯發來的指令。

### Lua 腳本的原子性保證
若需要在 Redis 中執行複雜的「先查、後判斷、再修改」的複合邏輯（例如扣減文章庫存或發放防擊穿互斥鎖），必須使用 Lua 腳本（`EVAL` / `EVALSHA`）：
- **原子性**：由於主執行緒是單一的，Redis 在執行一段 Lua 腳本期間，**不會中斷去執行其他任何指令**。整段腳本作為一個不可分割的原子單元執行完畢。
- **限制**：Lua 腳本內嚴禁撰寫長耗時的大迴圈或呼叫外部網路，否則整座 Redis 服務將在此期間陷入完全假死狀態。

## 貫穿案例：文章閱讀系統中的資料結構選型

1. **文章詳情（`article:42`）**：使用 **String** 儲存 Protobuf 序列化後的二進位 Payload；或使用 **Hash** 存放需單獨局部更新的欄位（如標題與按讚數）。
2. **每小時熱門排行榜（`ranking:hourly`）**：使用 **ZSet**：
   - 每次閱讀：`ZINCRBY ranking:hourly 1 "article:42"`。
   - 取得前 10 名熱門文章：`ZREVRANGE ranking:hourly 0 9 WITHSCORES`，耗時僅數十微秒。
3. **安全釋放互斥鎖**：使用 **Lua 腳本** 確保核對 Token 與刪除鎖的原子性：
   ```lua
   if redis.call("get", KEYS[1]) == ARGV[1] then
       return redis.call("del", KEYS[1])
   else
       return 0
   end
   ```

## 相關文件與參考來源

- [Redis 持久化、複寫與高可用性](redis-persistence-replication-and-clustering.md)：探討資料落地與容錯。
- [快取擊穿、熱點 Key 與防互斥鎖](cache-stampede-hotkeys-and-mutex.md)：了解 Lua 腳本在分散式鎖中的應用。
- William Pugh, *Skip Lists: A Probabilistic Alternative to Balanced Trees*, Communications of the ACM, 1990.
- Salvatore Sanfilippo (antirez), Redis Source Code (`src/server.c`, `src/ae.c`, `src/t_zset.c`).
