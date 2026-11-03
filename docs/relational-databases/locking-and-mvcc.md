# 多版本並行控制與鎖定

為什麼一個正在讀取報表的查詢，通常不會擋住另一筆報名資料的修改，但兩個同時修改同一門課名額的交易卻會互相等待？
許多關聯式資料庫同時結合**多版本並行控制（MVCC，Multiversion Concurrency Control）**與**鎖定（locking）**：前者讓讀取依快照挑選可見版本，後者協調寫入衝突與結構變更。

先備背景：[交易與隔離](transactions-and-isolation.md)與[索引與查詢計畫](indexes-and-query-plans.md)。
查證日期：2026-11-03。產品行為明確以 PostgreSQL 18 為準；不同資料庫的儲存引擎與鎖定實作可能不同。
本文僅查閱官方文件，未啟動資料庫、執行並行排程或觀測系統檢視表；以下案例與時間軸為自創推導。

## MVCC 用多個資料版本換取讀寫不互擋

若每次讀取都必須鎖住資料列直到交易結束，長查詢會讓線上寫入停擺；反過來，若寫入直接覆蓋原處資料，讀取又可能看到半成品。
PostgreSQL 以 MVCC 處理這個衝突：更新或刪除不會立刻抹除舊資料，而是保留舊版 tuple、建立新版 tuple，再由各個交易的快照（snapshot）判斷哪一個版本對自己可見。
參考 [PostgreSQL 18：Introduction to MVCC](https://www.postgresql.org/docs/18/mvcc-intro.html)。

```text
交易 A（唯讀查詢，取走快照 S1） ──→ 讀取更新前已提交的舊版本（price = 1200）
交易 B（寫入更新，稍後提交）   ──→ 寫入新版本（price = 1300），不覆蓋交易 A 正在讀的舊版本
```

因此，在 PostgreSQL 中，單純的 `SELECT` 不會擋住 `UPDATE`，`UPDATE` 也不會擋住單純的 `SELECT`。
但「讀取不阻塞寫入」不代表「完全沒有鎖」：當交易 B 要修改某列，仍會取得列級鎖與必要的表級鎖，以防止另一個寫入者同時改壞同一筆資料，或防止別人在查詢進行中執行 `DROP TABLE`。

## 表級鎖與列級鎖負責不同層次的保護

不能把「鎖」當成單一開關。PostgreSQL 同時具備不同層級與模式的鎖：

| 鎖的層次 | 代表情境（PostgreSQL 18） | 主要保護目的 |
| --- | --- | --- |
| 表級鎖（Table-level lock） | `SELECT` 取得 `ACCESS SHARE`；`DROP TABLE` 或部分 `ALTER TABLE` 取得 `ACCESS EXCLUSIVE` | 協調讀寫操作與資料表結構變更，避免查詢途中表結構消失或正在改寫 |
| 列級鎖（Row-level lock） | `UPDATE`、`DELETE`、`SELECT ... FOR UPDATE`、`SELECT ... FOR SHARE` | 協調多個交易對同一筆資料列的並行修改與外鍵參照檢查 |
| 頁面／內部鎖與應用鎖 | 索引頁內部同步，或由應用程式透過 `pg_advisory_lock` 協調自訂資源 | 維護儲存結構一致性，或提供應用自訂的同步邊界 |

多數表級鎖由 SQL 命令自動取得，無須手動呼叫 `LOCK TABLE`。
要注意的是，即使是一般 `SELECT` 也會持有 `ACCESS SHARE` 表級鎖；它與其他讀寫鎖相容，卻會與需要 `ACCESS EXCLUSIVE` 的結構變更衝突。
各種鎖模式的相容對照表見 [PostgreSQL 18：Explicit Locking](https://www.postgresql.org/docs/18/explicit-locking.html)。

列級鎖也有強弱之分：例如外鍵檢查只需要確認父資料列不被刪除或改鍵，使用較低強度的共享列鎖（如 `FOR KEY SHARE`），不會無故擋住父資料列修改其他非鍵欄位。
如果應用程式一律寫 `SELECT ... FOR UPDATE`，可能把原本可並行的操作鎖成排隊等待。

## 自創例子：等待鏈與死結如何發生

假設沿用課程名額表 `course_capacity(course_id, remaining)`，有兩筆交易同時調整課程 10 與課程 20：

| 時間順序 | 交易 T1 | 交易 T2 | 狀態說明 |
| --- | --- | --- | --- |
| 步驟 1 | `UPDATE course_capacity SET remaining = remaining - 1 WHERE course_id = 10;` | `UPDATE course_capacity SET remaining = remaining - 1 WHERE course_id = 20;` | T1 持有課程 10 的列鎖；T2 持有課程 20 的列鎖 |
| 步驟 2 | 嘗試 `UPDATE ... WHERE course_id = 20;` | 尚未執行下一步 | T1 等待 T2 釋放課程 20 |
| 步驟 3 | 仍在等待 | 嘗試 `UPDATE ... WHERE course_id = 10;` | T2 等待 T1 釋放課程 10，形成循環等待（死結） |

當兩個交易互相等待對方釋放鎖時，永遠無法靠繼續等待解開。
PostgreSQL 會在等待超過 `deadlock_timeout` 後檢查死結圖，並主動中止其中一個交易、回傳死結錯誤，讓另一個交易得以繼續。
參考 [PostgreSQL 18：Deadlocks](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-DEADLOCKS)。

預防死結與減少鎖等待的常見原則包括：

1. **固定資源鎖定順序**：若需要一次更新多門課，所有程式路徑都先按 `course_id` 由小到大排序後再更新，避免一正一反交錯取鎖。
2. **縮短交易持有時間**：不要在 `BEGIN` 並取得列鎖之後，才在交易內呼叫緩慢的外部 HTTP API 或等待使用者輸入。
3. **設定合理的等待與執行上限**：依服務契約評估 `lock_timeout` 與 `statement_timeout`，避免單一卡住的鎖讓大量連線無限期堆積。參數說明見 [PostgreSQL 18：Client Connection Defaults](https://www.postgresql.org/docs/18/runtime-config-client.html)。

當應用需要在找不到可鎖定的資源時立即放棄或改走其他分支，也可評估 `FOR UPDATE NOWAIT` 或 `FOR UPDATE SKIP LOCKED`；但 `SKIP LOCKED` 會跳過被鎖住的列，只適合工作佇列取件等允許略過資料的情境，不能拿來計算必須精確的帳務總額。

## 舊版本不會憑空消失：VACUUM 與長交易的代價

因為 MVCC 不會當場抹除舊版本，當所有進行中的交易都不再需要看到某個已刪除或已替換的舊 tuple 時，該空間才算過期（dead tuple），需要由清理機制回收再利用。
在 PostgreSQL 中，這項回收與統計維護主要由 `VACUUM` 及背景的 `autovacuum` 負責。
參考 [PostgreSQL 18：Routine Vacuuming](https://www.postgresql.org/docs/18/routine-vacuuming.html)。

一般 `VACUUM` 會在不阻斷正常讀寫的情況下，將資料表與索引中不再需要的空間標記為可供後續寫入重用，通常不會直接把作業系統層級的檔案大小縮回。
若某個交易開啟後長時間不提交（例如背景報表或未關閉的互動連線），它的舊快照會迫使資料庫保留這段期間內可能被它看見的舊版本，導致 `VACUUM` 無法回收這些 dead tuples，進而使資料表與索引空間持續增長（bloat），甚至影響交易 ID 回捲（transaction ID wraparound）防護。

因此，線上資料庫的效能與穩定性不只看單一查詢有沒有走索引，還要觀察是否有長交易、未解開的鎖等待，以及 `autovacuum` 能否跟上寫入與更新頻率。

## 相關文件

- [交易與隔離](transactions-and-isolation.md)：快照隔離等級與序列化重試的契約。
- [資料表結構演進與遷移](schema-evolution-and-migrations.md)：表級鎖如何影響線上結構變更。
- [索引與查詢計畫](indexes-and-query-plans.md)：空間增長與統計更新對查詢成本的影響。
- [逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)：鎖等待逾時或死結中止後的重試設計。
- [關聯式資料庫索引](README.md)。
