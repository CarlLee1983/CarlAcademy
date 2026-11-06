# 快取與資料存取架構知識索引

從文章閱讀服務的高頻存取需求出發，理解記憶體階層、讀寫模式與失效機制，再深入異常防禦、Redis 內部原理與多層一致性。
主線先問為何需要快取、帶來哪些一致性與記憶體代價，再逐步展開各層防禦與架構整合，不預設特定程式語言或雲端平台。

**目前狀態：主線 12 篇已全數撰寫，依下列五個階段閱讀。**
查證日期：2026-11-06。全系列依 Redis 7.2 官方文件、USENIX NSDI 2013 Facebook Memcached 論文、IEEE TKDE 2017 W-TinyLFU 論文與 RFC 9111 HTTP Caching 規範整理。案例均為概念推演與架構模型，未建立大規模生產壓測或故障注入實驗；版本與保證範圍見各篇。

## 先備知識與閱讀方式

讀者需理解基本的應用程式開發、HTTP 請求回應與關聯式資料庫基本交易。不要求先讀完分散式系統的全部主線；需要的共通概念會在當篇簡短回顧，再連到相關主題的既有文章。

建議第一次依 01–12 順序閱讀：先建立存取模式與過期模型，再處理穿透、擊穿與雪崩防禦，接著探討逐出演算法與記憶體開銷，然後深究 Redis 核心模型，最後以雙寫一致性與端到端多層快取實踐完成閉環。已有背景的讀者也可依特定問題直接查閱。

## 第一階段：快取本質與存取模式（已撰寫）

| 順序與文章 | 當篇要回答的問題 | 案例推進 |
| --- | --- | --- |
| 01 [記憶體階層與快取代價](caching-fundamentals-and-memory-hierarchy.md) | 為什麼需要快取？以 RAM 換取時間背後，伴隨什麼空間局部性、記憶體成本與複雜度？ | 比較暫存器、快取、記憶體與磁碟延遲，指出何時不該引入快取 |
| 02 [讀寫模式：Cache-Aside 到 Write-Behind](cache-read-write-patterns.md) | 讀寫資料時，應用程式、快取與資料庫的先後順序該如何安排？ | 比較 Cache-Aside、Read-Through、Write-Through 與 Write-Behind 的時序與風險 |
| 03 [過期策略、TTL 與清除機制](ttl-eviction-and-expiration-mechanisms.md) | 資料過期（Expire）與逐出（Evict）有何不同？TTL 倒數如何實現？ | 拆解主動定時抽樣清除與被動惰性清除，說明 TTL 隨機抖動的作用 |

完成這一階段後，能分清快取讀寫的責任邊界，辨別過期與逐出的差異，並理解快取引入後的資料一致性代價。

## 第二階段：快取異常與邊界防禦（已撰寫）

4. [快取穿透、空值快取與布隆過濾器](cache-penetration-and-bloom-filters.md)：當請求惡意查詢不存在的資料時，如何以空值快取與布隆過濾器（Bloom Filter）避免流量直擊資料庫。
5. [快取擊穿、熱點 Key 與防互斥鎖](cache-stampede-hotkeys-and-mutex.md)：熱門文章快取過期引發 Thundering Herd 時，如何透過分散式互斥鎖、邏輯過期與 Lease 租約機制壓制併發。
6. [快取雪崩與彈性架構](cache-avalanche-and-resilience.md)：大批快取同時失效或節點宕機時，如何利用 TTL Jitter、服務熔斷（Circuit Breaker）與降級策略保護底層系統。

## 第三階段：記憶體管理與淘汰演算法（已撰寫）

7. [記憶體逐出演算法：LRU 到 W-TinyLFU](eviction-algorithms-lru-lfu-tinylfu.md)：記憶體用盡時誰該被剔除？比較 FIFO、LRU、LFU 與 Window TinyLFU，分析快取污染（Cache Pollution）的成因。
8. [記憶體碎片、序列化與空間預算](memory-fragmentation-and-serialization.md)：解析 jemalloc 內部與外部碎片、`used_memory_rss` 水位、BigKey 危害與序列化格式的體積權衡。

## 第四階段：Redis 深度模型與高可用（已撰寫）

9. [Redis 資料結構深度剖析與執行模型](redis-data-structures-and-execution-model.md)：拆解 SDS、Listpack、Dict、SkipList 結構；說明單執行緒 Reactor 事件循環、Pipeline 與 Lua 腳本的原子邊界。
10. [Redis 持久化、複寫與高可用性](redis-persistence-replication-and-clustering.md)：分析 RDB fork Copy-on-Write、AOF 刷盤政策、PSYNC 增量複製、Sentinel 哨兵投票與 Cluster 16384 Hash Slots 拓撲。

## 第五階段：一致性與架構整合（已撰寫）

11. [快取與資料庫一致性：更新策略與 CDC](cache-database-consistency-patterns.md)：先改 DB 還是先刪快取？並行競爭下的時序競態分析，評估延遲雙刪與 CDC（Binlog）非同步可靠失效機制。
12. [多層快取整合案例：文章服務實踐](multi-tier-caching-and-end-to-end-case.md)：組裝 L1 本機記憶體、L2 分散式 Redis 與 L3 資料庫完整拓撲，配置失效廣播、關鍵監控指標與故障演練矩陣。

## 與其他主題的分工

- [關聯式資料庫](../relational-databases/README.md)：資料庫是權威真實來源（System of Record）；快取為附屬讀取加速層，其生命週期不得取代持久化交易。
- [電腦網路](../networking/README.md)：RFC 9111 HTTP 快取與 CDN 邊緣快取負責在傳輸邊界降低延遲；本主題專注於伺服器應用端與後端快取階層。
- [分散式系統](../distributed-systems/README.md)：一致性模型、網路分割與租約協調的理論基礎；本主題著重於快取架構下的工程實踐與暫態不一致收斂。
- [訊息佇列與事件驅動架構](../event-driven-architecture/README.md)：利用訊息佇列與變更資料捕獲（CDC）推播失效訊號，解決資料庫與快取的雙寫原子性缺口。
