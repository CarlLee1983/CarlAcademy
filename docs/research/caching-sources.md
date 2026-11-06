# 快取與資料存取架構：寫作證據與來源

查核日期：2026-11-06。本文為編寫本主題時所查證的一手文獻、官方技術規範與論文清單。本篇筆記用於確保技術細節的正確性與邊界清晰，不替代產品官方文件。

---

## 1. 記憶體階層與快取定位

- **可用主張**：不同層級儲存設備之存取延遲具備巨大數量級差異（CPU L1/L2/L3 數奈秒、RAM 約 50–100ns、NVMe SSD 數十微秒、網路請求數毫秒至數十毫秒）。快取建立在空間局部性（Spatial Locality）與時間局部性（Temporal Locality）的統計假設上。若存取模式呈現完全隨機或資料生命週期極短（一次性讀寫），快取不僅無法提升效能，反而增加記憶體負擔與維護一致性的開銷。
- **來源依據**：
  - Hennessy, J. L., & Patterson, D. A., *Computer Architecture: A Quantitative Approach* (6th ed.), Chapter 2: Memory Hierarchy Design.
  - Peter Norvig, *Teach Yourself Programming in Ten Years*, "Approximate timing for various operations on a typical PC"（記憶體與磁碟延遲對比基準）。

---

## 2. 經典快取讀寫模式與 Facebook Memcached 實踐

- **可用主張**：
  - **Cache-Aside (Lazy Loading)**：應用程式主導讀寫。讀取時先查快取，miss 則查 DB 並回填；寫入時先更新 DB，再使快取失效（Invalidate）。
  - **Read-Through / Write-Through**：應用程式面對透明快取介面；快取組件自身負責同步與底層儲存溝通。
  - **Write-Behind (Write-Back)**：寫入快取即返回，非同步批次刷盤至資料庫。吞吐極高，但存在斷電或故障時資料遺失（Loss of uncommitted writes）風險。
  - **Facebook 實踐**：在分散式快取池中，Facebook 使用 Lease 機制解決 Stale Set（舊資料覆蓋新資料）與 Thundering Herd（群湧衝垮資料庫）。Lease 是一組 64-bit Token，當快取 miss 時回傳，資料庫回填時必須驗證 Token 是否仍然有效。
- **來源依據**：
  - Rajesh Nishtala et al., *Scaling Memcache at Facebook*, NSDI 2013 (USENIX). §3.1 (Handling Invalidation), §3.2 (Leases for Thundering Herds and Stale Sets).

---

## 3. 快取異常模式與防禦工程

- **可用主張**：
  - **快取穿透 (Cache Penetration)**：請求惡意查詢一個不存在的 Key，導致快取與資料庫皆 miss，請求直接打垮底層 DB。防禦方案為：(1) 空值快取（Cache Null Object / Sentinel）搭配極短 TTL；(2) 布隆過濾器（Bloom Filter）。Bloom Filter 使用 $k$ 個獨立雜湊函式與 $m$ 位元的 Bit Array，存在可預測的假陽性率（False Positive），但不產生假陰性（False Negative），且標準版本無法直接執行刪除操作。
  - **快取擊穿 (Cache Stampede / Hot Key)**：高併發的單一熱點 Key 過期瞬間，上萬請求穿透至 DB。防禦方案為：(1) 分散式互斥鎖（Mutex），僅允許一個請求搶鎖查詢 DB 並回填；(2) 邏輯過期（Logical Expiration），快取永不物理過期，由背景工作定期非同步更新；(3) SingleFlight 模式（合併行程內並行請求）。
  - **快取雪崩 (Cache Avalanche)**：大量快取 Key 在同一短暫時間窗口集體過期，或快取服務實例整體中斷。防禦方案為：(1) TTL 隨機微擾（Jitter），讓過期時間均勻分佈；(2) 跨節點高可用叢集；(3) 服務熔斷（Circuit Breaker）、降級回應與資料庫連線池上限隔離。
- **來源依據**：
  - Burton H. Bloom, *Space/Time Trade-offs in Hash Coding with Allowable Errors*, Communications of the ACM, 1970.
  - Vattani et al., *Optimal Probabilistic Cache Stampede Prevention*, VLDB 2015. (Probabilistic early expiration / XFetch 演算法).

---

## 4. 淘汰演算法與 Window TinyLFU

- **可用主張**：
  - **LRU (Least Recently Used)**：以雜湊表搭配雙向鏈結串列實現 $O(1)$ 存取與剔除。弱點在於對「批次掃描（Full Scan）」缺乏免疫力，一次大範圍遍歷會將歷史高頻資料全數擠出，造成快取污染（Cache Pollution）。
  - **LFU (Least Frequently Used)**：依頻率排序，保留歷史最常存取項。缺點為計數器記憶體開銷高，且對「歷史熱點過期、新熱點湧入」適應緩慢（頻率飢餓與老化問題）。
  - **Window TinyLFU (W-TinyLFU)**：採用分段架構，結合一個小型的 Window Cache（LRU，吸收突發新流量）與主快取（Main Cache，由 Protected 與 Probation 雙段組成），並以 Count-Min Sketch（TinyLFU）在極低記憶體開銷下估算存取頻率，決定是否准入（Admission Policy），有效平衡新近度（Recency）與頻率（Frequency）。
- **來源依據**：
  - Gil Einziger, Ohad Eytan, Roy Friedman, Benjamin Manes, *TinyLFU: A Highly Efficient Cache Admission Policy*, IEEE Transactions on Knowledge and Data Engineering, 2017.
  - Caffeine Cache Design Documentation (Ben Manes): [Window TinyLFU](https://github.com/ben-manes/caffeine/wiki/Efficiency).

---

## 5. Redis 內部機制與高可用架構

- **可用主張**：
  - **執行模型**：Redis 核心命令處理採用單執行緒 Reactor 事件循環架構（`ae.c`，透過 epoll / kqueue 多路複用），消除了執行緒切換開銷與鎖競爭。自 Redis 6.0 起引入 Threaded I/O，但多執行緒僅負責網路讀寫與協定解析，命令執行仍嚴格維持單執行緒串列化。
  - **底層資料結構**：String 採用 SDS（Simple Dynamic String，帶長度前綴與空間預分配）；Hash 與 List 在小規模時採用緊緻記憶體佈局（Listpack / ZipList），擴大後轉為 Dict 或 QuickList；Sorted Set 小規模使用 Listpack，大規模使用 SkipList（跳躍表）搭配 Dict，提供 $O(\log N)$ 範圍查詢與排名計算。
  - **記憶體碎片**：使用 jemalloc 作為預設分配器，依照固定的 Chunk / Slab 尺寸分配。`used_memory` 代表 Redis 資料實體佔用，`used_memory_rss` 為作業系統配置的常駐記憶體。比值即為記憶體碎片率（Fragmentation Ratio），大於 1.5 往往代表存在顯著內部或外部碎片。
  - **持久化取捨**：
    - RDB：透過 `fork()` 產生子行程進行 Copy-on-Write 寫盤。快照完整但具備資料遺失窗口，且在記憶體龐大時 `fork()` 會產生短暫阻塞。
    - AOF：紀錄寫入指令日誌。`appendfsync` 提供 `always`（安全但極慢）、`everysec`（預設，平衡效能與至多 1–2 秒遺失）、`no`（由 OS 控制刷盤）。
  - **複製與叢集**：
    - PSYNC 協議透過 Replication ID 與 Offset 實現斷線後的增量同步（Replication Backlog Buffer），容量不足時退化為全量 RDB 同步。
    - Redis Cluster 將全域 key 空間劃分為 16,384 個 Hash Slots，以 CRC16(key) mod 16384 計算節點歸屬，客戶端快取路由表並處理 MOVED / ASK 重定向。
- **來源依據**：
  - Redis 官方文獻：[Redis Data Structures](https://redis.io/docs/latest/develop/data-types/), [Redis Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/), [Redis Cluster Specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/).
  - Salvatore Sanfilippo (antirez), Redis source code comments (`src/server.c`, `src/ae.c`, `src/t_zset.c`).

---

## 6. 快取與資料庫一致性（Cache-DB Coherence）

- **可用主張**：
  - **先刪快取 vs 先更 DB**：
    - 若先刪快取再更 DB：若請求 A 刪除快取後，請求 B 併發進來發現快取為空，查詢 DB 舊值並回填快取，隨後請求 A 才完成 DB 更新，將造成快取永久殘留舊值。
    - 若先更 DB 再刪快取：只有在「快取恰好失效、請求 A 查 DB 舊值、請求 B 更新 DB 並刪快取、請求 A 才將舊值寫入快取」的情況下會產生舊值覆蓋，但由於 DB 更新與寫快取的時間差極小，此機率遠低於先刪快取。
  - **延遲雙刪 (Delayed Double Deletion)**：在先更 DB 再刪快取的基礎上，休眠數百毫秒後再次執行刪除，用以清除暫態回填的舊值。但休眠時間難以精確估計，且同步休眠阻塞應用線程。
  - **CDC / Binlog 方案**：由可靠元件（如 Debezium / Canal）監聽資料庫事務日誌（WAL / Binlog），在資料庫事務成功提交後，非同步將失效事件投遞至訊息佇列，快取消費者收到後執行失效操作，並具備重試機制，實現最終一致性（Eventual Consistency）。
- **來源依據**：
  - Martin Fowler, *Patterns of Enterprise Application Architecture*, "Data Mapper" and "Identity Map".
  - Debezium Architecture Guide, *Reliable Cache Invalidation with Change Data Capture*.
