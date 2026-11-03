# 檢視表、觸發器與資料庫內邏輯

除了資料表、索引與約束，關聯式資料庫還提供**檢視表（view）**、**物化檢視表（materialized view）**、**函式／預存程序**與**觸發器（trigger）**。
這些機制能把查詢規則或連動操作集中在資料庫邊界，但也可能隱藏查詢成本與寫入副作用；選擇前要先分清楚哪些邏輯屬於「每次重算的查詢定義」、哪些屬於「預先保存的快取結果」，哪些又是「資料變更時必須連動執行的動作」。

先備背景：[SQL 查詢與資料變更](sql-queries-and-data-changes.md)、[約束與資料完整性](constraints-and-data-integrity.md)與[交易與隔離](transactions-and-isolation.md)。
查證日期：2026-11-03。產品語法與行為明確以 PostgreSQL 18 為準。
本文僅查閱官方文件，未在資料庫執行建立或更新操作；以下 SQL 為自創教學範例。

## 先分清四種機制的運作時機與責任

| 機制 | 何時執行計算或動作 | 是否另外儲存結果資料 | 常見用途與取捨 |
| --- | --- | --- | --- |
| 檢視表（View） | 每次查詢該檢視表時，展開並執行底層查詢 | 否（只保存查詢定義） | 封裝常用 JOIN 與欄位投影；不會自動讓慢查詢變快 |
| 物化檢視表（Materialized View） | 建立與執行 `REFRESH MATERIALIZED VIEW` 時 | 是（保存查詢結果快照） | 加速昂貴彙總報表；讀取可能落後最新底層資料 |
| 函式與預存程序（Function / Procedure） | 被查詢或 `CALL` 明確呼叫時 | 視內部操作而定 | 在資料庫端重用計算或封裝多步驟操作；需管理版本與測試 |
| 觸發器（Trigger） | 目標表發生指定的 `INSERT`、`UPDATE`、`DELETE` 等事件時自動觸發 | 視觸發器函式寫入的目標而定 | 維護稽核紀錄或跨表衍生狀態；增加寫入路徑的隱含成本 |

## 檢視表封裝的是查詢定義，不是效能快取

一般檢視表（view）是一段具名的查詢。當多個報表或應用模組都需要「課程與目前報名人數」時，定義檢視表可以避免各處重複手寫不同的 `LEFT JOIN` 條件。
參考 [PostgreSQL 18：Views](https://www.postgresql.org/docs/18/tutorial-views.html)與 [CREATE VIEW](https://www.postgresql.org/docs/18/sql-createview.html)。

以下是獨立示意，沿用 `courses` 與 `enrollments` 結構：

```sql
CREATE VIEW course_enrollment_summary AS
SELECT c.course_id,
       c.title,
       COUNT(e.student_id) AS enrollment_count
FROM courses AS c
LEFT JOIN enrollments AS e ON e.course_id = c.course_id
GROUP BY c.course_id, c.title;
```

閱讀檢視表時有兩個常見誤解要避開：

1. **一般檢視表不會預先存好結果**：查詢 `SELECT * FROM course_enrollment_summary WHERE course_id = 10;` 時，資料庫仍需針對底層表做規劃與執行。
2. **一層疊一層的檢視表可能夾帶不必要的工作**：若檢視表 A 連接了五張表，檢視表 B 又連接檢視表 A，即使最終查詢只需要其中兩個欄位，規劃器也未必總能消去所有多餘的連接與彙總；仍應透過 [EXPLAIN](indexes-and-query-plans.md) 檢查實際計畫。

此外，在 PostgreSQL 中，檢視表存取底層資料表時的權限檢查預設與檢視表擁有者或呼叫者設定有關（例如 `security_invoker` 選項）；不能假設「只開放查詢檢視表」就自動等於完成了完整的列級授權設計。

## 物化檢視表用資料新鮮度換取讀取速度

如果彙總報表非常昂貴，且業務允許看到幾分鐘或幾小時前的統計快照，可以使用物化檢視表（materialized view）將查詢結果真正存成實體資料，並在上面建立索引。
參考 [PostgreSQL 18：Materialized Views](https://www.postgresql.org/docs/18/rules-materializedviews.html)與 [REFRESH MATERIALIZED VIEW](https://www.postgresql.org/docs/18/sql-refreshmaterializedview.html)。

```sql
CREATE MATERIALIZED VIEW mv_course_enrollment_summary AS
SELECT c.course_id,
       c.title,
       COUNT(e.student_id) AS enrollment_count
FROM courses AS c
LEFT JOIN enrollments AS e ON e.course_id = c.course_id
GROUP BY c.course_id, c.title;

CREATE UNIQUE INDEX mv_course_enrollment_summary_course_idx
ON mv_course_enrollment_summary (course_id);
```

當底層的 `enrollments` 新增報名時，`mv_course_enrollment_summary` 的內容**不會自動改變**，必須明確執行：

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_course_enrollment_summary;
```

使用物化檢視表前，必須先回答三個問題：

- **資料可以落後多久**：這張報表是用於歷史趨勢分析，還是用於判斷「是否還有最後一個報名名額」？後者需要即時一致性，不能讀過時快照。
- **誰負責排程更新**：若沒有排程或事件觸發 `REFRESH`，資料會一直停在建立當下。
- **更新期間的鎖定與成本**：一般 `REFRESH` 會鎖住該物化檢視表的讀取；在 PostgreSQL 18 使用 `REFRESH MATERIALIZED VIEW CONCURRENTLY` 可避免擋住讀取，但前提是該物化檢視表上已建立符合條件的 `UNIQUE` 索引。

## 觸發器與約束不是互相替代的工具

觸發器（trigger）會在資料表發生特定修改事件時自動執行指定函式。
參考 [PostgreSQL 18：Overview of Trigger Behavior](https://www.postgresql.org/docs/18/trigger-definition.html)。

```sql
CREATE TABLE course_price_audit (
    audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id bigint NOT NULL,
    old_price numeric(10, 2) NOT NULL,
    new_price numeric(10, 2) NOT NULL,
    changed_at timestamp with time zone NOT NULL
);
```

例如當 `courses.price` 變更時，透過 `AFTER UPDATE` 觸發器在同一交易內寫入一筆 `course_price_audit` 紀錄，能確保無論是哪一個應用程式或管理工具修改了價格，都不會漏記稽核紀錄，且若原交易回復（rollback），稽核紀錄也會一併撤銷。

但觸發器也有明確的工程邊界：

1. **能用宣告式約束表達的規則，優先用約束**：`NOT NULL`、`UNIQUE`、`CHECK` 與 `FOREIGN KEY` 由資料庫引擎內建保證；若自己寫觸發器去做 `SELECT COUNT(*)` 檢查唯一性，在並行交易下反而容易因為快照隔離而漏判衝突。見 [約束與資料完整性](constraints-and-data-integrity.md)。
2. **觸發器會拉長原交易的時間與鎖定範圍**：觸發器函式在同一個交易內執行。如果觸發器裡做了昂貴的跨表更新，原本簡單的 `INSERT` 也會跟著變慢並持有更多鎖。
3. **不要在觸發器裡直接綁定不可回復的外部副作用**：若觸發器嘗試直接發送外部網路請求，只要後續語句失敗導致交易 `ROLLBACK`，已送出的外部請求無法跟著收回；應改為在交易內寫入待處理事件表（outbox），再由資料庫外的工作者非同步處理。

## 邏輯放在應用程式還是資料庫？

將邏輯放在資料庫內或應用程式內，不是全有或全無的意識形態選擇，可以按「誰共享這份資料」與「失敗後果」分工：

- **資料不變條件（型別、鍵、唯一性、外鍵、基本列內範圍）**：應留在資料庫約束，因為任何寫入路徑繞過它都會破壞資料品質。
- **跨模組共用的讀取視角或同交易內的稽核紀錄**：可評估檢視表或小型、可預測的觸發器，但須納入版本管理與[結構遷移流程](schema-evolution-and-migrations.md)。
- **涉及外部 API、複雜業務流程分支、使用者通知與多服務協調的邏輯**：放在應用程式層通常更容易做單元測試、觀測追蹤、限流與分階段部署。

## 相關文件

- [約束與資料完整性](constraints-and-data-integrity.md)：為什麼宣告式約束比手寫檢查更能守住並行一致性。
- [交易與隔離](transactions-and-isolation.md)：交易回復邊界與外部副作用的分離。
- [索引與查詢計畫](indexes-and-query-plans.md)：檢視表查詢仍須透過執行計畫確認成本。
- [資料表結構演進與遷移](schema-evolution-and-migrations.md)：修改被檢視表或觸發器依賴的欄位時如何避免破壞相容性。
- [關聯式資料庫索引](README.md)。
