# 記憶體碎片、序列化與空間預算

快取系統的記憶體預算絕不等於儲存原始字串長度的總和。
底層記憶體分配器的碎片機制、鍵值中繼資料的結構開銷，以及網路傳輸的序列化格式，共同決定了快取的實際物理記憶體佔用與 CPU 消耗。

## 記憶體碎片率的本質：內部與外部碎片

在 Redis 或 Memcached 等以 C 語言撰寫的高效能快取服務中，系統底層通常使用專門的記憶體分配器（以 **jemalloc** 最為普及，取代標準 glibc `malloc`）。

記憶體碎片主要源自兩大物理原因：

1. **內部碎片（Internal Fragmentation）**：
   - jemalloc 為了減少管理開銷並提升配置速度，不會依照任意精確位元組分配記憶體，而是預先劃分一系列固定大小的規格階級（如 8B, 16B, 32B, 48B, 64B, 80B, ..., 2KB, 4KB）。
   - 若應用程式需要存入一個長度為 33 位元組的 JSON 字串，jemalloc 會分配一個 48 位元組的記憶體區塊。多出來的 15 位元組無法被其他資料使用，這部分即為內部碎片。
2. **外部碎片（External Fragmentation）**：
   - 隨著快取頻繁地寫入、更新不同長度的字串，以及舊資料過期被刪除，記憶體中會出現大量不連續的微小空閒孔洞。
   - 儘管所有零散孔洞加總起來可能有 2GB 空間，但當系統需要分配一個連續的 10MB 陣列時，卻找不到單一連續的足夠區塊，作業系統被迫額外向實體記憶體申請新的分頁。

### 關鍵監控指標：`mem_fragmentation_ratio`
在 Redis 中透過 `INFO memory` 可查得兩組核心數值：
- `used_memory`：Redis 分配器為了儲存所有鍵值與中繼資料所實際申請的位元組數。
- `used_memory_rss`：作業系統（OS）角度觀察到 Redis 進程所佔用的常駐記憶體大小（Resident Set Size）。

$$\text{mem\_fragmentation\_ratio} = \frac{\text{used\_memory\_rss}}{\text{used\_memory}}$$

- **指標落在 1.0 至 1.5 之間**：健康狀態，屬於正常合理範圍。
- **指標大於 1.5（甚至 2.0 以上）**：表示存在嚴重的外部或內部碎片，記憶體有超過 50% 的空間被浪費；此時需評估重啟實例或開啟 Redis 主動碎片整理（`activedefrag yes`）。
- **指標小於 1.0**：**極度危險信號**！表示實體記憶體已經耗盡，作業系統正在將 Redis 記憶體交換至磁碟（Swap Out）。此時 Redis 每次記憶體存取都會遭遇磁碟 I/O，延遲將從微秒暴增至毫秒，性能直線崩潰。

## 序列化格式的體積與 CPU 權衡

快取資料在進入記憶體前，必須由物件轉換為二進位位元組陣列。不同的序列化格式對記憶體空間與 CPU 算力有著決定性影響：

| 序列化格式 | 資料型別 | 壓縮體積表現 | 序列化 / 反序列化速度 | 可讀性與除錯便利度 | Schema 約束 |
|---|---|---|---|---|---|
| **JSON** | 文字格式 | 差（大量重複鍵名、引號與格式字元） | 中等（需大量字串掃描與數值解析） | 極佳（可直接肉眼閱讀） | 無強制 |
| **MessagePack** | 二進位格式 | 中等（緊湊封裝數值與型別標記） | 快 | 差（需專用解碼檢視） | 無強制 |
| **Protocol Buffers** | 二進位格式 | **極佳（Varint 壓縮、欄位編號代替鍵名）** | **極快（純二進位位移解析）** | 差 | **強約束（需 proto 定義）** |

### 案例實測對比
儲存一篇包含 10 個欄位的文章中繼資料（標題、作者 ID、標籤陣列、狀態、閱讀數等）：
- **JSON**：平均約 420 Bytes（其中超過 60% 是重複的 `"author_id"`、`"published_at"` 等鍵名與雙引號）。
- **Protobuf**：編碼後僅約 85 Bytes（節省近 80% 記憶體空間）。
在儲存 1,000 萬篇文章快取的規模下，單純將序列化格式從 JSON 改為 Protobuf，即可將記憶體總消耗從 4.2 GB 銳減至 0.85 GB。

## 大 Key（BigKey）危害與空間預算控制

快取系統中最常見的系統穩定性殺手之一是 **BigKey**：單一字串體積過大（例如超過 1MB），或集合型態（Hash、List、Set、ZSet）內部包含超過 10,000 個元素。

### BigKey 的三大致命危害
1. **單執行緒阻塞**：Redis 核心以單執行緒處理命令。讀取一個 5MB 的大 Key 或對包含 10 萬個元素的 Hash 執行 `HGETALL` / `DEL`，會阻塞事件迴圈數十毫秒至數秒，期間全站所有其他使用者的輕量查詢一律在佇列中排隊逾時。
2. **網路頻寬被打滿**：千兆網卡（1Gbps）每秒傳輸極限約 125MB/s。若一個 5MB 的文章快取遭受每秒 30 次並行讀取，網路頻寬將瞬間被單一 Key 徹底榨乾。
3. **記憶體分配不均**：在 Redis Cluster 分片中，大 Key 必然落在單一節點上，造成該節點記憶體暴漲觸發 OOM，其餘節點卻極度空閒（資料傾斜）。

### BigKey 拆解最佳實踐
- **字串拆分**：將超大文章正文依段落拆解為多個小 Key，例如 `article:42:part:1`、`article:42:part:2`，需要時並行拉取。
- **集合分桶（Hash Sharding）**：避免將全站百萬讀者的按讚記錄全塞在一個大 Hash 中；改以 `like:article:{id % 100}` 將資料分散至 100 個獨立的小 Hash。
- **非同步安全刪除**：刪除大 Key 時切勿執行同步 `DEL`，應使用 Redis 4.0+ 提供的非同步非阻塞指令 `UNLINK`，由背景執行緒非同步釋放記憶體。

## 相關文件與參考來源

- [Redis 資料結構深度剖析與執行模型](redis-data-structures-and-execution-model.md)：探討緊緻 Listpack 與 SDS 原理。
- [記憶體逐出演算法：LRU 到 W-TinyLFU](eviction-algorithms-lru-lfu-tinylfu.md)：了解記憶體滿額時的應對策略。
- Redis Documentation, *Memory optimization and Latency issues related to BigKeys*.
- Jason Evans, *A Scalable Concurrent malloc(3) Implementation for FreeBSD (jemalloc paper)*, BSDCan, 2006.
