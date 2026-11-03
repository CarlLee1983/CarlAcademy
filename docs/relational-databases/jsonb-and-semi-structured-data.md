# JSONB、半結構化資料與混合建模

在關聯式資料庫中，並不是每一個業務屬性都在系統上線第一天就有固定不變的欄位結構。
例如課程報名表的主體（學員、課程、金額、狀態）非常固定，但不同類型課程附帶的「課前問卷回答」或「教材環境設定」卻可能隨課程型態而異。
PostgreSQL 提供 `json` 與 `jsonb` 型別，讓同一張表能同時保有**關聯式核心欄位與外鍵約束**，並以**半結構化欄位**容納彈性擴充屬性；但若缺少邊界，把所有核心事實都塞進單一 JSON 欄位，就會失去型別檢查、外鍵完整性與更新效率。

先備背景：[正規化與資料依賴](normalization.md)、[約束與資料完整性](constraints-and-data-integrity.md)與[索引與查詢計畫](indexes-and-query-plans.md)。
查證日期：2026-11-03。產品型別、運算子與索引語法明確以 PostgreSQL 18 為準。
本文僅查閱官方文件，未啟動資料庫或執行查詢；以下為自創教學範例。

## 先分清核心關聯欄位與 `jsonb` 的責任邊界

關聯式欄位與 `jsonb` 欄位不是二選一的對立選項，而是依資料在系統中的角色分工：

| 判斷問題 | 適合正規關聯式欄位與獨立資料表 | 適合評估 `jsonb` 半結構化欄位 |
| --- | --- | --- |
| 是否作為主鍵、外鍵或跨表連接條件？ | 是（如 `course_id`、`student_id`），需由資料庫強制參照完整性 | 否；將外鍵藏在 JSON 陣列中無法直接使用宣告式 `FOREIGN KEY` |
| 是否參與核心交易不變條件與精確算術？ | 是（如價格 `numeric`、名額、報名狀態），需要嚴格型別與約束 | 否；JSON 內部沒有獨立的日期或定點數原生型別，易混入字串或格式誤差 |
| 欄位結構是否隨課程／事件類型常變動且稀疏？ | 若每加一種問卷題目都要改表新增數十個稀疏欄位，維護成本較高 | 是（如課前問卷答案、外部 Webhook 原始訊息快照、多型態教材屬性） |
| 更新模式是局部密集改動，還是整份讀寫？ | 獨立欄位或子表只更新目標列 | 適合整份寫入或低頻更新；密集改動大型 JSON 內單一鍵值會放大 MVCC 寫入成本 |

在 PostgreSQL 18 中處理 JSON 資料時，官方文件建議絕大多數情境優先選擇 **`jsonb`** 而非 `json`：

- `json` 直接保存輸入的原始文字（包含空白、重複鍵與鍵的順序），每次查詢都要重新解析。
- `jsonb` 則在寫入時解析為分解後的二進位格式，會移除多餘空白與重複鍵（保留最後出現的值）、不保留物件鍵順序，寫入時略多一點轉換成本，但能大幅加速後續讀取與抽取，並支援包含運算與 GIN 索引。
參考 [PostgreSQL 18：JSON Types](https://www.postgresql.org/docs/18/datatype-json.html)。

## 自創例子：在固定結構旁保存彈性問卷，並加上約束

假設課程報名需要保存學員填寫的課前背景設定 `intake_profile`，我們將識別碼、外鍵與時間維持為標準欄位，只把彈性問卷放進 `jsonb`，並用 `CHECK` 約束守住最基本的結構假設：

```sql
CREATE TABLE course_intake_forms (
    course_id bigint NOT NULL REFERENCES courses (course_id),
    student_id bigint NOT NULL REFERENCES students (student_id),
    submitted_at timestamp with time zone NOT NULL,
    intake_profile jsonb NOT NULL,
    PRIMARY KEY (course_id, student_id),
    CONSTRAINT intake_profile_must_be_object
        CHECK (jsonb_typeof(intake_profile) = 'object')
);
```

沒有 `jsonb_typeof(intake_profile) = 'object'` 這條約束時，合法的 JSON 值也包含頂層陣列 `'[]'`、純字串 `'"hello"'` 甚至 JSON 字面值 `'null'`（注意 `'null'::jsonb` 不是 SQL 的 `NULL`，因此單靠 `NOT NULL` 擋不住 `'null'::jsonb`）。
把頂層型別與必要鍵值的規則寫進 `CHECK` 約束，才能避免應用程式在讀取鍵值時因結構型態不符而失敗。

查詢時也要區分「回傳 `jsonb`」與「回傳文字 `text`」的操作符或標準 SQL/JSON 路徑語法：

```sql
SELECT student_id,
       intake_profile ->> 'os' AS preferred_os,
       intake_profile #>> '{experience,years}' AS years_text
FROM course_intake_forms
WHERE course_id = 10
  AND intake_profile @> '{"os": "linux", "needs_vm": true}'::jsonb;
```

- `->` 取出的結果仍是 `jsonb`（例如字串會保留雙引號 `"linux"`）；`->>` 則取出為一般 `text`（`linux`），要做文字比較或型別轉型時應留意差異。
- `@>` 是 `jsonb` 的包含（containment）運算子，詢問左側文件是否包含右側指定的鍵值結構。運算子與函數細節見 [PostgreSQL 18：JSON Functions and Operators](https://www.postgresql.org/docs/18/functions-json.html)。

## 為 `jsonb` 查詢設計索引：B-tree 表達式索引與 GIN 索引

「欄位型別是 `jsonb`」不代表一定要建整欄的 GIN 索引；應先看查詢固定問哪幾個鍵，還是允許任意鍵值組合搜尋：

1. **只針對少數固定路徑查詢或排序：使用表達式索引或產生欄（Generated Column）**
   如果應用程式總是只依 `intake_profile ->> 'os'` 篩選，直接對該表達式建立一般 B-tree 索引，或先定義 `STORED` 產生欄再建索引，通常比索引整份 JSON 文件更小、維護成本更低：
   ```sql
   CREATE INDEX course_intake_os_idx
   ON course_intake_forms ((intake_profile ->> 'os'));
   ```
   產生欄規則見 [PostgreSQL 18：Generated Columns](https://www.postgresql.org/docs/18/ddl-generated-columns.html)。
2. **需要對多種內部鍵值做包含（`@>`）或鍵存在（`?`）查詢：使用 GIN 索引**
   PostgreSQL 的 GIN（Generalized Inverted Index）索引將 `jsonb` 拆解為內部項目建索引，並提供兩種主要 operator class：
   - 預設的 `jsonb_ops`：為每個鍵與值分別建立索引項目，支援 `@>`、`?`、`?|`、`?&` 與 `@?`／`@@` 路徑查詢。
   - `jsonb_path_ops`：將通往每個值的完整路徑與值雜湊在一起建索引，主要支援 `@>` 與部分路徑判斷；不支援單純詢問「某個鍵是否存在（`?`）」，但當文件包含大量重複鍵名時，索引體積通常更精簡、特定包含查詢更快。
   細節與取捨見 [PostgreSQL 18：JSONB Indexing](https://www.postgresql.org/docs/18/datatype-json.html#JSON-INDEXING)。

## 常見誤解：MVCC 下的整列重寫與「假性免遷移」

使用 `jsonb` 時有兩個在系統放大後才會浮現的代價：

- **修改一個小欄位仍會產生整列的新版 tuple**：如[〈多版本並行控制與鎖定〉](locking-and-mvcc.md)所述，PostgreSQL 的 `UPDATE` 以資料列（tuple）為單位建立新版本。若把數十 KB 的進度紀錄塞在同一個 `jsonb` 欄位裡，每秒用 `jsonb_set` 更新裡面的一個計數器，資料庫每次都必須複製整列 `jsonb` 寫入新版本，快速累積大量 dead tuples 與 I/O 負擔。高頻變動的計數或狀態應抽回獨立的正規欄位或明細表。
- **不在資料庫改表，不代表沒有結構演進問題**：許多人以為把欄位放進 `jsonb` 就「永遠不用做 migration」。事實上，當新版程式把 JSON 內的 `phone` 改名為 `mobile_number`，資料庫裡的歷史列依然留著舊鍵名；如果不做回填或版本標記，就必須在應用程式讀取端長期維護相容轉換邏輯。

## 相關文件

- [正規化與資料依賴](normalization.md)：判斷哪些事實具有獨立依賴、應拆成正規資料表。
- [約束與資料完整性](constraints-and-data-integrity.md)：用 `CHECK` 與外鍵守住結構底線。
- [索引與查詢計畫](indexes-and-query-plans.md)：評估表達式索引與 GIN 索引的讀寫代價。
- [多版本並行控制與鎖定](locking-and-mvcc.md)：理解高頻更新大型欄位對 tuple 版本與 `VACUUM` 的影響。
- [關聯式資料庫索引](README.md)。
