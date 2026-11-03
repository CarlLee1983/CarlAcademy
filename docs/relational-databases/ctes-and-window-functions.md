# 通用資料表運算式與視窗函數

當查詢需要「保留每一筆報名明細，同時標出該學員在課程中的報名順序或與前一筆的時間差」，單靠 `GROUP BY` 會把多列收合成一列而丟失明細；當查詢需要拆解多步驟邏輯或追蹤「先修課程樹」，層層巢狀子查詢又難以閱讀與維護。
SQL 透過**視窗函數（window functions）**在不收合列的前提下計算跨列關係，並透過**通用資料表運算式（CTE，Common Table Expressions，即 `WITH` 子句）**組織具名查詢步驟與遞迴展開。

先備背景：[SQL 查詢與資料變更](sql-queries-and-data-changes.md)與[索引與查詢計畫](indexes-and-query-plans.md)。
查證日期：2026-11-03。具體語法與規劃行為明確以 PostgreSQL 18 為準。
本文僅查閱官方文件，未啟動資料庫或執行查詢；以下 SQL 與結果為自創推導範例。

## 視窗函數保留原始列，在視窗範圍內計算

`GROUP BY` 會將同組資料列合併為單一輸出列；視窗函數則搭配 `OVER (...)` 子句，讓每一列維持獨立輸出，同時根據該列所屬的分區（`PARTITION BY`）與排序（`ORDER BY`）計算彙總、排名或前後列對照。
參考 [PostgreSQL 18：Window Functions](https://www.postgresql.org/docs/18/tutorial-window.html)與 [Window Function Calls](https://www.postgresql.org/docs/18/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS)。

```text
GROUP BY course_id      ──→ 每門課只剩 1 列彙總結果（個別學員報名列被收合）
OVER (PARTITION BY ...) ──→ 保留每筆報名列，並在每列旁附上同門課的統計或名次
```

假設沿用報名表 `enrollments(course_id, student_id, enrolled_on, score)`，想查看每筆分數、該門課的平均分，以及該學員在課內的名次：

```sql
SELECT course_id,
       student_id,
       score,
       ROUND(AVG(score) OVER (PARTITION BY course_id), 2) AS course_avg,
       RANK() OVER (
           PARTITION BY course_id
           ORDER BY score DESC
       ) AS score_rank
FROM enrollments
ORDER BY course_id, score_rank, student_id;
```

要注意視窗函數在查詢邏輯中的位置：它們只在 `SELECT` 清單與 `ORDER BY` 中評估，且在 `WHERE`、`GROUP BY` 與 `HAVING` **之後**才執行。
因此不能直接寫 `WHERE RANK() OVER (...) <= 3`；若要篩選前幾名，需先用子查詢或 CTE 算出排名欄位，再於外層 `WHERE` 過濾。

## 同分排名與視窗框架的語意差異

排名前幾名或計算移動總計時，最容易出錯的是「同分（ties）如何編號」以及「視窗框架（window frame）預設涵蓋哪些列」：

| 函數或子句 | 遇到相同排序值（同分）或框架時的行為 | 常見適用情境 |
| --- | --- | --- |
| `ROW_NUMBER()` | 即使排序欄位同分，仍給出不重複的連續序號（如 1、2、3）；同分列誰先誰後若未補唯一鍵則不可判定 | 搭配唯一次要排序鍵，每組嚴格挑出 1 筆代表列 |
| `RANK()` | 同分列獲得相同名次，下一名跳號（如 1、1、3） | 評分或分數排名，反映實際並列人數 |
| `DENSE_RANK()` | 同分列獲得相同名次，下一名不跳號（如 1、1、2） | 依分數梯隊分級，不希望名次出現空缺 |
| `LAG(col, 1)`／`LEAD(col, 1)` | 取同分區內按順序的前一列／後一列值，無對應列時預設回傳 `NULL` | 比較同一學員連續兩次測驗的分數變化或報名間隔 |

參考 [PostgreSQL 18：Window Functions（內建函數表）](https://www.postgresql.org/docs/18/functions-window.html)。

當 `OVER (...)` 內寫了 `ORDER BY` 並搭配 `SUM`、`AVG` 等彙總函數時，預設視窗框架是 `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`——這裡的 `CURRENT ROW` 在 `RANGE` 模式下會**連同所有與目前列排序值相同的並列列（peers）一起納入計算**。
若希望嚴格按實體列數逐列累加，或計算「包含目前列與前 2 列」的滑動平均，應明確指定 `ROWS` 模式並補齊唯一排序鍵：

```sql
SUM(paid_amount) OVER (
    PARTITION BY course_id
    ORDER BY enrolled_on ASC, student_id ASC
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
) AS running_revenue
```

同樣地，`FIRST_VALUE` 與 `LAST_VALUE` 也受預設框架影響：在預設框架下對整個分區呼叫 `LAST_VALUE`，只會拿到「截至目前列（含同分列）為止的最後一筆」，而不是整個分區的最後一筆。

## CTE（`WITH` 子句）整理多步驟查詢與物化邊界

通用資料表運算式（CTE）使用 `WITH` 定義只在單一語句內有效的輔助查詢，讓「先算課內排名、再取每課前三名」這類多階段邏輯不必寫成深層縮排的子查詢。
參考 [PostgreSQL 18：WITH Queries (Common Table Expressions)](https://www.postgresql.org/docs/18/queries-with.html)。

```sql
WITH ranked_enrollments AS (
    SELECT course_id,
           student_id,
           score,
           ROW_NUMBER() OVER (
               PARTITION BY course_id
               ORDER BY score DESC, student_id ASC
           ) AS rn
    FROM enrollments
)
SELECT course_id, student_id, score
FROM ranked_enrollments
WHERE rn <= 3
ORDER BY course_id, rn;
```

閱讀與撰寫 CTE 時，須注意規劃器如何處理它：

1. **CTE 不必然是隔離最佳化的黑盒子**：在 PostgreSQL 18 中，若非遞迴且無副作用的 CTE 只被外層參照一次，規劃器預設會將它展開合併（inline）進主查詢一起規劃，讓外層的 `WHERE` 條件有機會下推到索引掃描。
2. **被多次參照或明確指定時的物化取捨**：若同一個 CTE 被外層參照多次，規劃器會評估是否先算好暫存結果共用；也可明確加上 `AS MATERIALIZED` 或 `AS NOT MATERIALIZED` 提示，但更改前應以 [`EXPLAIN`](indexes-and-query-plans.md) 驗證，不要把 `MATERIALIZED` 當成萬用加速開關。
3. **資料修改 CTE 的快照與執行保證**：PostgreSQL 允許在 `WITH` 內放置 `INSERT ... RETURNING`、`UPDATE ... RETURNING` 或 `DELETE ... RETURNING`，且它們與主查詢共用同一語句層級的轉換步驟，適合在同一交易語句中搬移資料並記錄明細。

## 遞迴 CTE 表達階層關係與防循環保護

當資料具有父子階層或圖形關係（例如課程的先修條件 `course_prerequisites(course_id, prereq_course_id)`），固定層數的自我連接（self-join）無法處理任意深度的先修鏈。
`WITH RECURSIVE` 將查詢分成**非遞迴起始項（non-recursive term）**與**遞迴項（recursive term）**，反覆將上一輪產生的新列接上下一層先修課，直到沒有新列產生為止。

```sql
WITH RECURSIVE prereq_chain AS (
    SELECT course_id,
           prereq_course_id,
           1 AS depth
    FROM course_prerequisites
    WHERE course_id = 300
    UNION ALL
    SELECT p.course_id,
           p.prereq_course_id,
           c.depth + 1
    FROM prereq_chain AS c
    JOIN course_prerequisites AS p
      ON p.course_id = c.prereq_course_id
    WHERE c.depth < 10
)
CYCLE prereq_course_id SET is_cycle USING traversal_path
SELECT course_id, prereq_course_id, depth
FROM prereq_chain
WHERE NOT is_cycle;
```

使用 `WITH RECURSIVE` 時有兩個關鍵防護：

- **防範資料異常造成的無窮循環**：若資料表中誤填了 `A 先修 B、B 又先修 A` 的循環依賴，`UNION ALL` 會無限展開。在 PostgreSQL 18 可使用 SQL 標準的 `CYCLE` 子句自動偵測已造訪過的節點，並搭配明確的深度上限（如 `depth < 10`）與語句逾時作為雙重保險。
- **索引與展開方向**：遞迴項每一輪都會以工作表（working table）連接底層表，因此連接鍵（本例的 `course_prerequisites.course_id`）必須具備適當索引，否則每深入一層都會觸發重複掃描。

## 相關文件

- [SQL 查詢與資料變更](sql-queries-and-data-changes.md)：基本連接、`GROUP BY` 與子查詢的語意基礎。
- [索引與查詢計畫](indexes-and-query-plans.md)：視窗排序成本、CTE 下推與 `EXPLAIN` 判讀。
- [檢視表、觸發器與資料庫內邏輯](views-functions-and-triggers.md)：單一語句內的 CTE 與跨語句重用的檢視表如何分工。
- [關聯式資料庫索引](README.md)。
