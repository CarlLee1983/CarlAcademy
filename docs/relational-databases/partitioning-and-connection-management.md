# 資料表分割與連線資源管理

當資料庫隨著業務成長開始變慢時，常見的兩個症狀是：**單一歷史事件表長到數百萬列以上，連清理舊資料與 `VACUUM` 都越來越吃力**，以及**應用實例擴充後同時開啟上百條至數百條資料庫連線，導致記憶體與排程爭用大幅上升**。
這兩個問題發生在不同層次：前者涉及**資料表分割（table partitioning）**與儲存生命週期，後者涉及**資料庫連線模型與連線池（connection pooling）**。

先備背景：[索引與查詢計畫](indexes-and-query-plans.md)與[多版本並行控制與鎖定](locking-and-mvcc.md)。
查證日期：2026-11-03。具體分割語法與連線架構明確以 PostgreSQL 18 為準。
本文僅查閱官方文件，未執行分區壓測或部署連線池；以下為自創教學範例。

## 先分清「資料體積成長」與「並行連線成長」

在動手調整架構前，先確認瓶頸落在哪一邊：

| 問題面向 | 典型症狀 | 對應的工程手段 |
| --- | --- | --- |
| 單表資料體積過大 | 依時間累積的紀錄表非常大；刪除過期資料產生大量 dead tuples；索引與 `VACUUM` 維護時間過長 | 評估宣告式資料表分割（Partitioning），將大表依明確維度拆成多個實體分區 |
| 單次查詢掃描過多列 | 資料表雖只有數十萬列，但查詢缺少合適索引或條件無法縮小範圍 | 先檢查[索引與查詢計畫](indexes-and-query-plans.md)，不急著把小表切成數十個分區 |
| 並行連線數過高 | 應用容器水平擴充後，大量閒置或短命連線占滿 `max_connections`，或大量連線同時競爭 CPU 與鎖 | 限制應用端連線池大小、導入外部連線池複用連線，並縮短單次交易時間 |

## 宣告式資料表分割：用分區管理生命週期與查詢範圍

資料表分割（table partitioning）將邏輯上的一張大表（partitioned table），在實體儲存上拆成多張獨立的子分區（partitions）。
PostgreSQL 18 支援三種宣告式分割策略：**範圍分割（`RANGE`，如按月份或日期區間）**、**清單分割（`LIST`，如按固定區域代碼）**與**雜湊分割（`HASH`，平均打散鍵值）**。
參考 [PostgreSQL 18：Table Partitioning](https://www.postgresql.org/docs/18/ddl-partitioning.html)。

沿用[〈索引與查詢計畫〉](indexes-and-query-plans.md)的課程閱讀事件表 `reading_events`，若事件按月持續大量寫入，且只需保留最近一年的線上明細，可按 `occurred_at` 做範圍分割：

```sql
CREATE TABLE reading_events (
    event_id bigint NOT NULL,
    course_id bigint NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    event_kind text NOT NULL,
    PRIMARY KEY (occurred_at, event_id)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE reading_events_2026_11
    PARTITION OF reading_events
    FOR VALUES FROM ('2026-11-01 00:00:00+08') TO ('2026-12-01 00:00:00+08');
```

分割表帶來兩個核心好處，但也伴隨明確的約束限制：

1. **分區略過（Partition Pruning）**：當查詢帶有分割鍵條件（例如 `WHERE occurred_at >= '2026-11-10...'`），規劃器或執行器可跳過無關月份的分區，只掃描命中的分區與其區域索引。
2. **低衝擊的過期資料移除**：若在未分割的大表執行 `DELETE FROM reading_events WHERE occurred_at < ...` 刪除數百萬列，會產生大量 dead tuples 並迫使 `VACUUM` 長時間清理；改用按月分區後，可直接 `DROP TABLE reading_events_2025_10;` 或先以 `ALTER TABLE ... DETACH PARTITION ... CONCURRENTLY` 卸離分區再處理，避開逐列刪除的 I/O 衝擊。
3. **唯一約束與主鍵必須包含分割鍵**：在 PostgreSQL 18 中，分割表上的 `PRIMARY KEY` 或 `UNIQUE` 約束必須涵蓋所有分割鍵欄位（如上例的 `(occurred_at, event_id)`），因為唯一性是由各分區各自的索引保證，不維護跨所有分區的單一全域索引。
4. **未帶分割鍵的查詢可能變慢**：若絕大多數查詢只問 `WHERE event_id = 42` 而不帶 `occurred_at`，資料庫就必須逐一檢查每個月份分區的索引；分區數量過多時，規劃與開啟分區的成本反而高於單張表加 B-tree 索引。

## 為什麼不能無限調高資料庫的 `max_connections`

應用程式與 PostgreSQL 通訊時，PostgreSQL 採每個用戶端連線對應一個獨立後端程序（backend process）的架構。
當用戶端完成連線握手與驗證後，主程序會啟動專屬的後端程序負責該連線後續的查詢。
參考 [PostgreSQL 18：Connection Establishment](https://www.postgresql.org/docs/18/connect-estab.html)與 [Connection Settings](https://www.postgresql.org/docs/18/runtime-config-connection.html)。

```text
無節制直連：50 個應用實例 × 每實例 40 條連線 = 2,000 個資料庫後端程序
經由連線池：50 個應用實例 ──→ 連線池排隊複用 ──→ 少數活躍後端程序專心執行查詢
```

如果為了消除「連線數已滿」錯誤而盲目把 `max_connections` 調到數百甚至上萬，常會引發反效果：

- **每次建立新連線都有固定開銷**：TCP 握手、TLS 協商、身分驗證與啟動後端程序都需要時間；若每個 HTTP 請求都臨時建立並關閉一條資料庫連線，資料庫花在建連與拆連的成本可能超過簡單查詢本身。
- **記憶體與快照計算成本隨連線數上升**：每個後端程序都有自己的私有工作記憶體（如排序與雜湊使用的 `work_mem`），且高並行連線數會增加計算 MVCC 快照、維護鎖表與作業系統進行程序上下文切換（context switch）的負擔。

## 連線池的運作層次與狀態隔離邊界

**連線池（connection pool）**預先維持一組已建立的資料庫連線，供應用程式借用與歸還。
實務上可放在應用程式內部（各程序內建的 pool），也可在資料庫前方部署獨立的連線池代理（集中管理多台應用伺服器與無伺服器函式對資料庫的總連線上限）。

規劃連線池時，必須分清**連線借用粒度**與**連線狀態干擾**：

1. **連線級池化（Session pooling）與交易級池化（Transaction pooling）**：
   - 連線級池化將整條資料庫連線借給某個用戶端直到它主動釋放，支援所有依賴連線狀態的資料庫功能，但複用率較低。
   - 交易級池化只在單一交易（`BEGIN ... COMMIT`）或單一語句期間借出後端連線，一提交就立即歸還給其他請求共用，能大幅壓低資料庫實際承受的後端程序數；但也因此**不能假設同一個用戶端的下一次查詢還在同一條後端連線上**。
2. **避免跨交易留下連線級狀態**：在交易級池化下，不應依賴跨交易的連線級 `SET` 變數、未在交易結束時清除的暫存表或連線級 advisory lock；若某個交易需要調整逾時或搜尋路徑，應使用只在當次交易內生效的 `SET LOCAL`（例如 `SET LOCAL statement_timeout = '2s';`），交易結束時便會自動還原，不會影響下一位借用同一條連線的請求。
3. **連線池搭配逾時保護**：連線池只能控制同時進入資料庫的通道數；如果池內的連線全部被未設逾時的慢查詢或長鎖等待卡死，外面的新請求依然會在排隊逾時後失敗。因此連線池必須與[〈多版本並行控制與鎖定〉](locking-and-mvcc.md)介紹的 `statement_timeout`、`lock_timeout` 及 `idle_in_transaction_session_timeout` 一起設定。

## 相關文件

- [索引與查詢計畫](indexes-and-query-plans.md)：先確認查詢存取路徑，再評估是否需要分割表。
- [多版本並行控制與鎖定](locking-and-mvcc.md)：長交易、`VACUUM` 與鎖等待如何耗盡連線池容量。
- [資料表結構演進與遷移](schema-evolution-and-migrations.md)：在線上新增分區或掛載既有表的鎖定考量。
- [EC2 與 Lambda](../aws/ec2-and-lambda.md)：短命運算環境大量突發擴充時，對關聯式資料庫連線池的特別影響。
- [關聯式資料庫索引](README.md)。
