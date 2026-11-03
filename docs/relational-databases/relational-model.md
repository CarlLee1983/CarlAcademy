# 關聯模型與資料表

關聯式資料庫不只是「可以存很多試算表」。它要求我們先說明每一列代表什麼事實、
欄位有哪些允許值，以及哪些資料組合有效，再透過查詢取得需要的結果。
這讓多個程式能依同一套結構與規則共同使用資料。

本文不要求 SQL 經驗。查證日期：2026-11-02；具體語法以 PostgreSQL 18 為例。
本文只查閱文件，未執行資料庫；資料與例子均為本站自創。

## 先說清楚一列代表什麼

假設要記錄線上課程，`courses` 的一列代表一門可識別的課程，
而不是某位學員的一次觀看，也不是每次開課的場次。
如果同一課程有不同梯次，梯次應另有自己的識別與時間，否則「開課日」的意義便不清楚。
這是本例的建模選擇，不是資料庫替我們決定的業務分類。

| course_id | title | price |
| --- | --- | --- |
| 10 | SQL 基礎 | 1200.00 |
| 20 | Linux 入門 | 800.00 |

資料表（table）包含列（row）與欄（column）；同表每列具有相同的一組欄位，每欄有型別。
PostgreSQL 官方以 relation 說明這種資料組織，但資料表的顯示順序沒有自動保證。
參考 [PostgreSQL 18：Concepts](https://www.postgresql.org/docs/18/tutorial-concepts.html)。

## 結構與當下資料是兩回事

**結構（schema）**描述表名、欄位、型別與約束；**資料狀態**則是某個時刻真正存在的列。
今天剛好沒有重複課程編號，不代表結構已保證它永遠不重複。
下面是 PostgreSQL 18 的自創建表例子，價格規則特意允許免費課程：

```sql
CREATE TABLE courses (
    course_id bigint PRIMARY KEY,
    title text NOT NULL,
    price numeric(10, 2) NOT NULL CHECK (price >= 0)
);

INSERT INTO courses (course_id, title, price) VALUES
    (10, 'SQL 基礎', 1200.00),
    (20, 'Linux 入門', 800.00);
```

`bigint`、`text` 與 `numeric(10, 2)` 是此例的 PostgreSQL 型別選擇。
型別限制值的種類，約束再限制哪些組合可接受；例如價格是數字還不夠，還要禁止負數。
`PRIMARY KEY`、`NOT NULL` 與 `CHECK` 的責任見[〈約束與資料完整性〉](constraints-and-data-integrity.md)，
官方依據為 [PostgreSQL 18：Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)。

此設計並未禁止空字串或只有空白的標題；`NOT NULL` 只排除 NULL。
若業務不接受這類標題，須另定規則，而不能把「已宣告型別」理解成「內容有意義」。

## 關聯運算讓資料依問題重新組合

可以先挑出免費課程，再只取編號與名稱；也可以把課程與報名資料連接，回答各課程有哪些學員。
篩選選的是列，投影選的是欄，連接則依條件組合不同資料來源的列。
查詢產生的結果不必等同某張實體表，也不需要預先保存每一種報表。
多表連接的具體語意見 [PostgreSQL 18：Joins Between Tables](https://www.postgresql.org/docs/18/tutorial-join.html)。

```sql
SELECT course_id, title
FROM courses
WHERE price = 0
ORDER BY course_id;
```

依上面的兩筆自創資料，這個查詢預期沒有結果，並非表不存在或 SQL 失敗。
「沒有符合條件的列」本身是一種正常查詢結果。

## SQL 資料表與理論上的關聯不要完全畫上等號

理論上的關聯以集合思考，沒有重複 tuple；SQL 查詢通常可保留重複列，
例如兩門課同名，`SELECT title` 可能回傳兩個相同標題。
需要合併重複輸出才使用 `DISTINCT`；不應用它掩蓋錯誤的連接條件。
參考 [PostgreSQL 18：SELECT，DISTINCT](https://www.postgresql.org/docs/18/sql-select.html#SQL-DISTINCT)。

另一個差異是 SQL 的 NULL，常用來表達未知或缺值，卻不是數字 0、空字串或一般可相等比較的值。
`price = NULL` 不能用來查缺值，應用 `IS NULL`。
參考 [PostgreSQL 18：Comparison Functions and Operators](https://www.postgresql.org/docs/18/functions-comparison.html)。

也不能把「插入順序」當成查詢契約。要穩定輸出順序，須有明確 `ORDER BY`；
同分時還要補上可決定順序的欄位。
參考 [PostgreSQL 18：Sorting Rows](https://www.postgresql.org/docs/18/queries-order.html)。

## 模型能保證什麼，仍取決於我們寫下的規則

表名叫 `paid_orders` 不會自動保證付款已完成；欄位叫 `student_id` 也不會自動保證學員存在。
名稱幫人理解，鍵與約束才讓資料庫執行對應規則。
同樣地，資料庫可限制價格非負，卻不知道哪位登入者有權更改價格；那是另一層授權契約。

設計時可以先回答三件事：一列代表哪個事實、用什麼識別它，以及哪些狀態永遠不應出現。
回答不清楚時，先補領域定義，通常比急著增加欄位有效。

## 相關文件

- [鍵與資料關係](keys-and-relationships.md)：從識別資料進到跨表關係。
- [SQL 查詢與資料變更](sql-queries-and-data-changes.md)：具體操作資料與理解結果。
- [正規化與資料依賴](normalization.md)：把不同事實放回適合的位置。
- [關聯式資料庫索引](README.md)：版本、驗證限制與閱讀順序。
