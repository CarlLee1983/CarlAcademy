# SQL 查詢與資料變更

SQL 讓我們描述要取得或改變哪些資料，再由資料庫選擇執行方式。
理解 SQL 不只是背語法：查詢的每一階段如何改變列的數量、NULL 如何參與判斷，
以及修改條件到底涵蓋哪些資料，都會直接影響結果。

先備背景：[關聯模型](relational-model.md)與[鍵與資料關係](keys-and-relationships.md)。
查證日期：2026-11-02。以下是 PostgreSQL 18 的自創 SQL；僅做文件查證，未執行資料庫。

## 範例資料的前提

本篇沿用前兩篇的 `courses`、`students` 與 `enrollments` 結構。
假設課程有 `(10, SQL 基礎, 1200.00)`、`(20, Linux 入門, 800.00)`；
學員有 `(1, S001, 小林)`、`(2, S002, 小陳)`；報名只有學員 1 報名課程 10，日期為 `2026-11-01`。
這些是閱讀用的資料狀態，沒有提供已執行的載入紀錄。

## 從資料來源到輸出，分清每一步

下面依課程彙總報名數，只留下至少一筆報名的課程：

```sql
SELECT c.course_id, c.title, COUNT(e.student_id) AS enrollment_count
FROM courses AS c
LEFT JOIN enrollments AS e ON e.course_id = c.course_id
GROUP BY c.course_id, c.title
HAVING COUNT(e.student_id) >= 1
ORDER BY enrollment_count DESC, c.course_id ASC;
```

可以按邏輯理解為：`FROM/JOIN` 建立來源、`WHERE` 篩列、`GROUP BY` 分組、
`HAVING` 篩群組，再由 `SELECT` 決定輸出、`ORDER BY` 排序。
這是理解結果的順序，不是承諾引擎按這個實體順序做每一個計算。
參考 [PostgreSQL 18：Table Expressions](https://www.postgresql.org/docs/18/queries-table-expressions.html)。

依本例資料，結果只有課程 10，報名數為 1。若刪去 `HAVING`，課程 20 也會出現，報名數為 0。
`COUNT(e.student_id)` 計算非 NULL 值；`COUNT(*)` 計算列數。
外連接替沒報名的課程保留一列，因此若改成 `COUNT(*)`，課程 20 也會被算成 1。
參考 [PostgreSQL 18：Aggregate Functions，count](https://www.postgresql.org/docs/18/functions-aggregate.html)。

## JOIN 是配對，可能放大列數

內連接只保留成功配對的列，左外連接則也保留左側找不到對象的列，並在右側補 NULL。
同一學員若有兩筆報名，連接後會得到兩列；這是每個配對各有一列，不是資料庫憑空複製學員。
參考 [PostgreSQL 18：Joins Between Tables](https://www.postgresql.org/docs/18/tutorial-join.html)。

例如要保留所有課程、只配對 11 月的報名，日期條件應放在 `ON`：

```sql
SELECT c.course_id, e.student_id
FROM courses AS c
LEFT JOIN enrollments AS e
  ON e.course_id = c.course_id
 AND e.enrolled_on >= DATE '2026-11-01'
 AND e.enrolled_on < DATE '2026-12-01'
ORDER BY c.course_id, e.student_id;
```

若把右側日期條件移到 `WHERE`，補出的 NULL 列不會通過篩選，沒有 11 月報名的課程便消失。
`ON` 決定配對，`WHERE` 決定配對後還留下誰；外連接時不能隨意互換。
參考 [PostgreSQL 18：Joined Tables](https://www.postgresql.org/docs/18/queries-table-expressions.html#QUERIES-JOIN)。

## NULL 使真假判斷多了一種可能

一般比較只要涉及 NULL，結果可能是未知；`WHERE` 只保留條件為真的列。
因此查缺值用 `IS NULL`，查非缺值用 `IS NOT NULL`，不用 `= NULL`。
`NULL = NULL` 也不能當成真。
參考 [PostgreSQL 18：Comparison Functions and Operators](https://www.postgresql.org/docs/18/functions-comparison.html)。

本例的 `enrollments` 外鍵不可缺，但左外連接的結果仍可出現 NULL；
「來源欄位有 NOT NULL」不代表所有衍生查詢結果也一定沒有 NULL。
要找完全沒有報名的課程，也可以用相關子查詢：

```sql
SELECT c.course_id, c.title
FROM courses AS c
WHERE NOT EXISTS (
    SELECT 1 FROM enrollments AS e WHERE e.course_id = c.course_id
)
ORDER BY c.course_id;
```

這個例子直接問「不存在配對」，避免為了檢查是否存在而把所有配對列都拿到應用端。
依本例資料，預期回傳課程 20。子查詢存在性語意見
[PostgreSQL 18：EXISTS](https://www.postgresql.org/docs/18/functions-subquery.html#FUNCTIONS-SUBQUERY-EXISTS)。

## 排序與分頁必須有可判定的順序

`ORDER BY price` 不能決定同價課程之間誰先誰後；可以加上唯一的 `course_id` 作次序。
PostgreSQL 18 的 `LIMIT 20 OFFSET 40` 表示跳過 40 列後最多取 20 列。
大量 offset 仍有跳過資料的計算成本，且兩次查詢之間若資料改變，頁面可能重複或漏列。
參考 [PostgreSQL 18：LIMIT and OFFSET](https://www.postgresql.org/docs/18/queries-limit.html)。

明確排序解決的是單次結果順序，不會自動固定跨多次查詢的資料快照。
API 的游標與分頁契約另見[集合查詢設計](../api/collection-query-design.md)。

## 修改是一組條件，未必只影響一列

```sql
INSERT INTO courses (course_id, title, price)
VALUES (30, '資料建模', 1500.00);

UPDATE courses
SET price = 1300.00
WHERE course_id = 10;

DELETE FROM courses
WHERE course_id = 30;
```

這三個語句依序執行時，新課程 30 先建立再刪除，課程 10 的價格改為 1300。
`INSERT` 明列欄位可避免依賴表的欄位位置，見
[PostgreSQL 18：Inserting Data](https://www.postgresql.org/docs/18/dml-insert.html)。
`UPDATE` 條件匹配零列不是語法錯誤，應用要檢查影響列數是否符合預期；
不寫 `WHERE` 會修改所有列，見 [Updating Data](https://www.postgresql.org/docs/18/dml-update.html)。
`DELETE` 不寫條件也會刪除整表的列，但不等同刪掉資料表結構，見
[Deleting Data](https://www.postgresql.org/docs/18/dml-delete.html)。

先用 `SELECT` 看候選資料有助檢查，卻不能保證稍後修改時資料沒變。
需要條件式更新、交易或鎖定時，應在[交易與隔離](transactions-and-isolation.md)的邊界處理。
實際應用也應使用參數化查詢，不能把使用者輸入直接拼進 SQL，詳見[SQL 注入](../web-security/sql-injection.md)。

## 相關文件

- [約束與資料完整性](constraints-and-data-integrity.md)：修改時最後由誰阻止無效狀態。
- [索引與查詢計畫](indexes-and-query-plans.md)：查詢的實體成本與邏輯語意不同。
- [通用資料表運算式與視窗函數](ctes-and-window-functions.md)：保留明細列的視窗計算、具名步驟與遞迴查詢。
- [關聯式資料庫索引](README.md)。
