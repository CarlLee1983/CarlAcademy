# 索引與查詢計畫

索引（index）是額外維護的資料結構，讓某些查詢能更快定位所需資料。
它不會改變查詢應回傳什麼，卻會改變資料庫付出多少工作。
查詢計畫（query plan）則把這些工作攤開，讓我們用證據判斷瓶頸。

先備背景：[SQL 查詢](sql-queries-and-data-changes.md)。查證日期：2026-11-02。
本文的具體語法與計畫欄位採 PostgreSQL 18；只查閱官方文件，未執行 SQL、建立索引或量測效能。
範例均為本站自創，不提供假造的實測計畫或加速倍數。

## 索引為讀取省工作，也讓寫入多做工作

沒有適合的存取路徑時，資料庫可能逐列檢查資料表；有索引時，則可能從較小的搜尋範圍找到候選列。
但索引要占空間，新增、刪除與部分更新也會需要維護索引。
因此不能只看讀取變快，還要看寫入成本與儲存成本。
參考 [PostgreSQL 18：Indexes，Introduction](https://www.postgresql.org/docs/18/indexes-intro.html)。

如果一張表很小，或查詢需要其中很大比例的列，順序掃描可能比索引定位再取回資料更合算。
「沒有用索引」不必然是錯誤；先確認掃描了多少資料、取回多少列，再判斷是否值得調整。

## 從具體查詢反推索引

以下是獨立 PostgreSQL 18 範例，記錄某課程的閱讀事件，與前面篇章的報名表不同：

```sql
CREATE TABLE reading_events (
    event_id bigint PRIMARY KEY,
    course_id bigint NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    event_kind text NOT NULL
);
```

假設常見需求是「課程 10 在指定時間之後的最近 20 筆事件」：

```sql
SELECT event_id, occurred_at, event_kind
FROM reading_events
WHERE course_id = 10
  AND occurred_at >= TIMESTAMP WITH TIME ZONE '2026-11-01 00:00:00+08'
ORDER BY occurred_at DESC, event_id DESC
LIMIT 20;
```

可以評估以下索引，但效果要以真實資料與計畫確認：

```sql
CREATE INDEX reading_events_course_time_idx
ON reading_events (course_id, occurred_at DESC, event_id DESC);
```

這裡先以 `course_id` 等值縮小範圍，再按事件時間排序；`event_id` 讓同一時間的事件也有明確次序。
查詢的條件、排序與取回列數共同決定價值，並不是「每個 WHERE 欄位各建一個索引」就足夠。
PostgreSQL B-tree 可以提供符合的排序，見
[PostgreSQL 18：Indexes and ORDER BY](https://www.postgresql.org/docs/18/indexes-ordering.html)。

複合 B-tree 索引通常在前導欄位有條件時較有效率，但不能把「缺最左欄就絕對不能用」當成通則。
PostgreSQL 18 可能使用 skip scan；是否值得取決於欄位值分布與成本。
參考 [PostgreSQL 18：Multicolumn Indexes](https://www.postgresql.org/docs/18/indexes-multicolumn.html)。

## EXPLAIN 是估計，ANALYZE 會真的執行

在這個空表範例上，可以閱讀語法，但沒有足夠資料證明索引有效：

```sql
EXPLAIN
SELECT event_id, occurred_at, event_kind
FROM reading_events
WHERE course_id = 10
ORDER BY occurred_at DESC, event_id DESC
LIMIT 20;
```

`EXPLAIN` 顯示規劃器選擇的計畫；加上 `ANALYZE` 會真正執行該語句，並報告執行統計。
即使結果列被捨棄，UPDATE、DELETE、觸發器或有副作用函式仍可能真的造成效果。
在交易內回復也不能撤銷 sequence 消耗或任意外部效果，不能把它當成通用安全沙盒。
參考 [PostgreSQL 18：EXPLAIN](https://www.postgresql.org/docs/18/sql-explain.html)與
[Sequence Manipulation Functions](https://www.postgresql.org/docs/18/functions-sequence.html)。

若要實際診斷，應先確認資料環境與執行影響，再決定是否使用 `EXPLAIN (ANALYZE, BUFFERS)`。
本文沒有執行這個命令，不能由本篇推斷任何真實服務的延遲或 I/O。

## 計畫要看列數與重複工作

PostgreSQL 計畫通常是一棵樹，下層掃描資料，上層做連接、排序、彙總與限制。
常見節點包括 `Seq Scan`、`Index Scan`、`Bitmap Heap Scan`、`Sort` 與不同連接演算法。
辨識名稱只是起點，更有用的是理解資料如何流過整棵樹。
參考 [PostgreSQL 18：Using EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html)。

| 欄位或訊息 | 如何解讀 |
| --- | --- |
| `cost=a..b` | 估計啟動與總成本，屬規劃單位，不是毫秒 |
| 估計 `rows` | 規劃器認為節點會輸出多少列 |
| `actual rows`、`loops` | 執行統計中每次執行的平均輸出與執行次數 |
| `Index Cond` 與 `Filter` | 哪些條件用於索引存取，哪些仍須在取得候選資料後篩選 |
| `Buffers` | 緩衝區存取統計，協助觀察資料存取工作 |

讀計畫時，先找估計列數與實際列數落差大的位置，再檢查大量重複執行的節點。
不要把每個父子節點時間直接相加；父節點可能已包含子節點工作，且 `loops` 會影響總工作量。
欄位語意見 [PostgreSQL 18：EXPLAIN ANALYZE](https://www.postgresql.org/docs/18/using-explain.html#USING-EXPLAIN-ANALYZE)。

例如某內側節點每次只取 2 列，但執行 50,000 次，總輸出便可能是 100,000 列。
這是自創算例，重點是「單次看起來便宜」仍可能累積成大量工作，不是某種連接演算法一律不好。

## 統計與資料分布會改變計畫

規劃器不會先執行所有方案再挑最快的，而是用成本模型與統計估計。
資料偏斜、欄位相關性或過時統計，可能讓它誤估篩選後的列數。
PostgreSQL 的 `ANALYZE` 更新統計，與 `EXPLAIN ANALYZE` 執行查詢並觀察是不同用途。
參考 [PostgreSQL 18：Statistics Used by the Planner](https://www.postgresql.org/docs/18/planner-stats.html)。

例如大部分事件都屬於課程 10，`course_id = 10` 便沒有想像中能縮小範圍；
其他課程的相同形狀查詢可能非常適合索引，不能只測一個參數就下結論。
空表或十筆均勻測試資料也無法代表數百萬筆有偏斜的真實工作負載。

實務上可以先記錄查詢與參數範圍、資料量及分布，查看計畫後提出一項有理由的修改，
再在可比較環境檢查讀取與寫入成本。這是診斷順序，不是任何索引都要建立的操作清單。

## 常見誤解

主鍵與唯一約束在 PostgreSQL 會自動建立相應唯一索引，但外鍵參照端不會自動因此得到索引。
是否替參照端建索引，須看查詢與父資料修改需求。
參考 [PostgreSQL 18：Foreign Keys，索引說明](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-FK)。

索引也不能替代 `ORDER BY` 的結果契約，不能修正錯誤 JOIN，不能保證跨請求資料快照，
更不能讓缺少授權的查詢變得安全。先確認結果正確，再用計畫改善成本。

## 相關文件

- [SQL 查詢與資料變更](sql-queries-and-data-changes.md)：先理解列數與排序的語意。
- [正規化與資料依賴](normalization.md)：先區分資料模型與查詢效能問題。
- [交易與隔離](transactions-and-isolation.md)：效能與並行保證是不同問題。
- [關聯式資料庫索引](README.md)。
