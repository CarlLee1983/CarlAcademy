# SQL Injection 與查詢參數化

應用程式需要把使用者輸入交給資料庫查詢，但輸入應該是資料，而不是改變查詢意義的 SQL 語法。
SQL Injection 就發生在這個區分被破壞時。先備可讀[SQL 查詢與資料變更](../relational-databases/sql-queries-and-data-changes.md)。

查證日期：2026-11-02。依 OWASP、MITRE CWE-89 與 PostgreSQL 18 官方文件整理。
本文未連線資料庫或執行查詢；範例為自創示意，沒有完整應用程式或可用憑證。

## 問題在查詢如何組成

假想私人筆記服務要依標題搜尋。如果把標題直接拼入 SQL，標題裡的字元就可能被解析為查詢結構，
改變篩選條件或引入其他操作。影響取決於資料庫能力、查詢位置與執行帳號權限。
參考 [MITRE CWE-89](https://cwe.mitre.org/data/definitions/89.html)。

下面是**不安全的概念寫法，勿作為實作範本**：

```text
SQL = "SELECT id FROM notes WHERE title = '" + 輸入標題 + "'"
```

資料不只來自當下的表單；先前存進資料庫的文字、匯入資料與其他服務回應，也可能包含外部可控制的內容。
儲存過一次不會讓它在未來的 SQL 拼接中變安全。
參考 [OWASP SQL Injection Prevention：Introduction](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html#introduction)。

## 固定結構，另行綁定值

參數化查詢將 SQL 結構與資料值分開交給資料庫介面，而不是自己替字串加引號。
以 PostgreSQL 的參數語法為例：

```sql
SELECT id, title
FROM notes
WHERE owner_id = $1 AND title = $2
ORDER BY id;
```

應用程式使用支援參數的驅動介面，分別綁定「驗證後的主體 ID」與「輸入標題」。
`$1`、`$2` 是位置參數，不是要用字串替換的模板；其他驅動可能採 `?` 或命名參數，須依實際介面。
PostgreSQL 的 `PQexecParams` 就將命令與參數值分開傳入。
參考 [PostgreSQL 18：Command Execution Functions](https://www.postgresql.org/docs/18/libpq-exec.html)。

若標題含單引號，它仍是一個標題值，不應變成額外條件。
先把輸入插入 SQL，再把整串 SQL 交給 prepare，沒有保住這條邊界。
參考 [OWASP：Prepared Statements](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html#defense-option-1-prepared-statements-with-parameterized-queries)。

## 欄位名稱與排序方向不是資料值

例如使用者可選「標題排序」或「建立時間排序」，不能以綁定值期待 `$1` 變成任意欄位名稱。
應由應用程式把外部選項對應到固定、受控的查詢片段；不在允許集合內就拒絕。

```text
對外選項 title   → 應用擁有的固定片段：ORDER BY title, id
對外選項 created → 應用擁有的固定片段：ORDER BY created_at, id
其他選項        → 拒絕
```

這是自創對應範例。資料值仍要綁定，結構選項則由程式擁有；不要把任意輸入當成片段原樣接上。
參考 [OWASP：Allow-list Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html#allow-list-input-validation)。

## 防注入不會完成其他責任

ORM、查詢建構器與預存程序是否安全，要看實際用法；raw SQL 或內部動態拼接仍可能破壞邊界。
手動跳脫容易受語法與編碼差異影響，不宜當成主要防線。
資料庫帳號也只應持有所需權限，以限制錯誤或漏洞的影響。
參考 [OWASP：Stored Procedures 與 Hardening](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html#stored-procedures)。

即使查詢完全參數化，若 `owner_id` 取自用戶端任意指定的值，仍可能讓乙讀甲的資料。
上面的例子特別由可信主體取得 ID，是本例[存取控制](access-control.md)政策；參數化本身不會證明授權正確。
交易、外鍵與欄位限制則處理其他[資料完整性](../relational-databases/constraints-and-data-integrity.md)問題。

## 驗證時觀察什麼

在授權的本機測試環境中，可以用一般標題、含引號的標題與不存在的標題，檢查它們是否都作為單一值處理。
同時審查查詢組成路徑，包含篩選、排序、批次與匯出；只測一個入口不能證明其他入口安全。
錯誤回應也不應把含敏感資料的查詢或憑證交給使用者。本文未執行這些測試。

## 相關文件

- [關聯式資料庫索引](../relational-databases/README.md)：理解模型、SQL 與交易。
- [XSS](cross-site-scripting.md)：另一種解析邊界，防護不能用 SQL 參數化替代。
- [Web 應用資安索引](README.md)。
