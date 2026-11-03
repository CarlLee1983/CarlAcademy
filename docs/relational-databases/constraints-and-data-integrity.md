# 約束與資料完整性

應用程式先檢查輸入，可以回傳容易理解的錯誤；資料庫約束則讓多個寫入者都受同一套規則限制。
兩個請求都先查到「還沒報名」，不代表它們稍後都能安全新增。
要保證同一學員不重複報名，規則必須落在共同寫入邊界。

先備背景：[鍵](keys-and-relationships.md)與[基本 SQL](sql-queries-and-data-changes.md)。
查證日期：2026-11-02。本文採 PostgreSQL 18 官方手冊，只做文件查證，未執行 SQL 或並行測試。
以下情境為本站自創。

## 把不變條件轉成可以執行的限制

完整性（integrity）關心資料是否符合既定規則。例如編號可識別、參照對象存在、數量不可負。
它不代表資料庫知道所有真實世界的事實：拼錯但格式有效的姓名，仍可能通過所有約束。

| 規則 | 常見表達方式 | 不能因此推導的保證 |
| --- | --- | --- |
| 欄位不可缺 | `NOT NULL` | 字串一定非空且有意義 |
| 值或組合不可重複 | `UNIQUE` | NULL 一律只能一筆 |
| 每列有主要識別 | `PRIMARY KEY` | 業務上不會重複建立同一對象 |
| 值符合列內條件 | `CHECK` | 任意跨列總量都能直接檢查 |
| 參照對象必須存在 | `FOREIGN KEY` | 登入者有權使用該對象 |

以上是約束種類的概要；具體語意與限制以
[PostgreSQL 18：Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)為準。

## 自創例子：用資料庫守住一筆報名的條件

下例是獨立示意，假設 `students(student_id)` 與 `courses(course_id)` 已存在，且各自為主鍵；
`enrollments_checked` 是新的示範表，不替換其他文章的 `enrollments`。

```sql
CREATE TABLE enrollments_checked (
    student_id bigint NOT NULL REFERENCES students (student_id),
    course_id bigint NOT NULL REFERENCES courses (course_id),
    enrolled_on date NOT NULL,
    paid_amount numeric(10, 2) NOT NULL,
    CONSTRAINT enrollment_once PRIMARY KEY (student_id, course_id),
    CONSTRAINT nonnegative_payment CHECK (paid_amount >= 0)
);
```

此例讓同一配對最多存在一次，禁止負付款金額，並要求學員與課程存在。
它允許金額為 0，也沒有聲稱款項真的入帳。
「付款已收到」需要付款流程的證據，不能從金額欄位通過 `CHECK` 推導。

若兩個交易都嘗試插入同一配對，主鍵約束不會允許兩筆都成為已提交狀態。
但第二個請求得到什麼結果、是否等待，以及如何翻譯成 API 錯誤，仍須由產品行為與介面契約處理。
PostgreSQL 對唯一性並行檢查的說明見
[Unique Index Checks](https://www.postgresql.org/docs/18/index-unique-checks.html)。

## NULL 是約束最容易漏掉的角落

在 PostgreSQL 18，`CHECK (paid_amount >= 0)` 對結果為未知的情況不會拒絕，所以仍要有 `NOT NULL`。
一般 `UNIQUE` 預設允許多筆 NULL；需要把 NULL 也視為相同時，PostgreSQL 支援 `NULLS NOT DISTINCT`。
這個預設不是跨產品通則，不能拿到別的資料庫直接假定相同。
參考 [Check Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS)與
[Unique Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS)。

以教學判斷而言，如果某值是必要識別，通常先問「為什麼允許缺值」，
比補一個特殊假值更容易維持意思。把未知學員寫成 `0`，只會讓正常的外鍵規則更難表達。

## 外鍵守住參照，刪除策略守住歷史意義

不可缺的外鍵要求每筆子資料有合法父資料；可缺的外鍵則須另看 NULL 規則。
複合外鍵尤其不能只看其中一欄，PostgreSQL 預設的 `MATCH SIMPLE` 與 `MATCH FULL` 對部分 NULL 有不同處理。
本系列的報名外鍵都設 `NOT NULL`，避免引入這個額外歧義。
參考 [PostgreSQL 18：Foreign Keys](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-FK)。

如果報名需要作為歷史證據，刪除課程就順便級聯刪除報名通常不符合這個需求。
可以評估停用狀態或限制刪除，而不是只讓刪除指令順利通過。
這是依本例「保留歷史」需求得出的設計判斷，不是所有資料都不適合級聯刪除。

## 跨列規則需要另一種邊界

「價格非負」是列內規則；「報名人數不得超過課程名額」則涉及多列與並行寫入。
不要把查其他列的函式塞進 PostgreSQL `CHECK`，期待之後其他列變動時它會自動重檢。
PostgreSQL 明確不支援用這種方式維護跨列約束。
參考 [PostgreSQL 18：CHECK 的跨列限制](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS)。

這類限制應依模型選擇可表達的唯一約束、受控的計數更新、鎖定或適當隔離的交易流程。
例如將名額扣減寫成「剩餘名額大於零才減一」，再與報名新增放在同一交易，
比先查總人數、稍後自行判斷更接近共同寫入邊界；完整條件仍須包含取消、重試與失敗回復。

新增約束到既有資料也需要先確認舊資料符合規則，並考慮鎖定與部署相容性。
本篇沒有提供資料遷移操作腳本；概念建表例子不能取代真實資料的遷移計畫。

## 相關文件

- [交易與隔離](transactions-and-isolation.md)：把多個有效步驟合成一致操作。
- [正規化與資料依賴](normalization.md)：減少本可避免的重複事實。
- [資料表結構演進與遷移](schema-evolution-and-migrations.md)：為既有資料表補上約束時，如何同時處理鎖定與相容性。
- [檢視表、觸發器與資料庫內邏輯](views-functions-and-triggers.md)：比較宣告式約束與觸發器的責任邊界。
- [API 輸入、輸出與失敗語意](../api/input-output-failure-semantics.md)：將約束失敗轉成清楚契約。
- [關聯式資料庫索引](README.md)。
