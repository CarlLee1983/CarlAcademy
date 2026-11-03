# 資料表結構演進與遷移

在開發機上執行一行 `ALTER TABLE` 很快完成，不代表在持續服務使用者的正式資料庫上也能用同樣方式直接執行。
資料表結構演進（schema evolution）與資料遷移（migration）關心兩個核心問題：**資料庫在改結構時會鎖住什麼**，以及**新舊版本的應用程式如何同時與這張表安全互動**。

先備背景：[約束與資料完整性](constraints-and-data-integrity.md)與[多版本並行控制與鎖定](locking-and-mvcc.md)。
查證日期：2026-11-03。產品行為明確以 PostgreSQL 18 為準；不同資料庫的線上 DDL 與鎖定機制差異很大。
本文僅查閱官方文件，未在資料庫執行遷移腳本或壓測鎖定時間；以下步驟為自創教學範例。

## 為什麼語法正確的 DDL 仍可能造成線上中斷

許多 `ALTER TABLE` 子命令需要取得高強度的表級鎖（例如 `ACCESS EXCLUSIVE` 或 `SHARE UPDATE EXCLUSIVE`）。
即使某個結構變更本身只需幾毫秒，若它需要 `ACCESS EXCLUSIVE` 鎖，而表上剛好有一個執行中的長查詢持有 `ACCESS SHARE`，`ALTER TABLE` 就必須排隊等待；更關鍵的是，排在 `ALTER TABLE` 後面的所有新 `SELECT` 與 `UPDATE`，也會跟著被擋在佇列後面。
鎖模式與子命令差異見 [PostgreSQL 18：ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)與 [Explicit Locking](https://www.postgresql.org/docs/18/explicit-locking.html)。

此外，不同變更在底層付出的工作量完全不同：

| 變更類型 | PostgreSQL 18 的主要觀察 | 線上部署要注意的風險 |
| --- | --- | --- |
| 新增可為 NULL 的欄位（無預設值，或固定常數預設值） | 通常只需更新系統目錄中繼資料，不需立即改寫整張表 | 雖不改寫舊列，取得短暫高階表鎖時仍可能被長交易卡住 |
| 直接把既有欄位設為 `SET NOT NULL` | 若無既有約束證明，需掃描整張表確認沒有 NULL | 表很大時，掃描與持鎖時間隨資料量成長 |
| 新增一般索引 `CREATE INDEX` | 會擋住同時對該表的寫入，直到索引建立完成 | 線上大表可評估 `CREATE INDEX CONCURRENTLY`，但需處理失敗遺留的 invalid 索引 |
| 修改欄位型別（需重寫資料者） | 可能重寫整張資料表與相關索引，期間持有排他鎖 | 重寫期間讀寫受阻，且需要額外磁碟空間 |

因此，評估遷移腳本時不能只看「測試環境那十筆資料有沒有跑過」，必須查明該命令在目標資料庫版本是否會掃描全表、重寫資料表，以及需要哪一種鎖。
關於並行建立索引的限制與兩階段掃描，見 [PostgreSQL 18：Building Indexes Concurrently](https://www.postgresql.org/docs/18/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)。

## 應用程式與資料庫很少在同一個瞬間切換

在滾動部署（rolling deployment）或多實例環境中，常見情況是：資料庫遷移先執行，接著部分舊版應用程式與新版應用程式同時運行一段時間。
如果遷移腳本直接把 `courses` 表的 `title` 改名為 `course_title`，舊版應用程式一執行 `SELECT title FROM courses` 就會立即報錯。

為了讓結構變更具備前後相容性，實務上常採用**擴張與收束（expand and contract）**的分階段遷移，把一次破壞性變更拆成多個可獨立驗證、可安全回退的步驟：

```text
階段 1（擴張 Expand） ：新增可相容的新結構（例如新欄位或新表），舊結構保留
階段 2（雙寫與回填）  ：部署支援新舊結構的應用，並分批回填歷史資料
階段 3（切換讀取）    ：確認資料一致後，應用程式改讀寫新結構，不再依賴舊欄位
階段 4（收束 Contract）：確認無任何舊版程式使用後，再移除舊欄位或舊結構
```

這個順序與 [API 相容性與演進](../api/compatibility-and-evolution.md) 的「先新增、再遷移使用者、最後棄用移除」是同一個工程原則，只是作用在應用程式與資料表之間的契約上。

## 自創例子：為課程表補上不可缺的課程代碼

假設既有 `courses(course_id, title, price)` 已經在線上運作，現在要新增必填的 `course_code`，且不能讓正在查詢課程的請求長時間卡住。
直接對大表執行 `ALTER TABLE courses ADD COLUMN course_code text NOT NULL;`（且每列需填入不同業務代碼）並不可行，因為舊資料還沒有對應的代碼。

可以拆成以下概念階段（獨立示意，非可直接執行的完整部署腳本）：

1. **先新增可為 NULL 的欄位，並設好鎖等待保護**：
   ```sql
   SET lock_timeout = '2s';
   ALTER TABLE courses ADD COLUMN course_code text;
   ```
   若 2 秒內拿不到鎖就主動失敗重試，避免讓線上查詢卡死在鎖佇列後面。
2. **應用程式先支援寫入新欄位，並分批回填舊資料**：
   新版程式在建立或修改課程時一併寫入 `course_code`；背景工作則分批為舊課程補上代碼，避免單一大型交易長時間鎖住全表。
3. **以較低衝擊的方式驗證約束**：
   在 PostgreSQL 18，若直接加 `CHECK` 或 `FOREIGN KEY`，可先加上 `NOT VALID`（只對新寫入生效、不立刻掃描舊列），稍後再執行 `VALIDATE CONSTRAINT`（使用衝突較少的 `SHARE UPDATE EXCLUSIVE` 鎖掃描舊資料）：
   ```sql
   ALTER TABLE courses
   ADD CONSTRAINT courses_code_present
   CHECK (course_code IS NOT NULL) NOT VALID;

   ALTER TABLE courses
   VALIDATE CONSTRAINT courses_code_present;
   ```
   當資料庫已擁有有效的 `CHECK (course_code IS NOT NULL)` 約束後，再將欄位標記為 `SET NOT NULL` 時，PostgreSQL 18 可利用既有約束跳過重複的全表排他掃描。
   參考 [PostgreSQL 18：ALTER TABLE，ADD table_constraint NOT VALID 與 SET NOT NULL](https://www.postgresql.org/docs/18/sql-altertable.html)。

若還要加上唯一約束，也可先以 `CREATE UNIQUE INDEX CONCURRENTLY` 建立唯一索引，再將其掛載為約束，減少阻斷線上寫入的時間視窗。

## 資料回填、失敗回復與備份不是同一件事

把「結構修改（DDL）」與「大量資料回填（DML）」寫在同一個長交易裡，常會同時帶來高階表鎖與大量待清理的舊版 tuple。
將結構變更與分批資料回填拆開，比較容易觀察進度、控制每批鎖定範圍，並在異常時暫停。

同時要注意，應用程式常見的 `up`／`down` 遷移腳本不等於完整災難復原：

- 如果 `up` 執行了 `DROP COLUMN`，撰寫一個把欄位加回來的 `down` 腳本，並不會找回已被刪除的欄位值。
- 涉及破壞性移除或複雜資料轉換時，應先確認備份可還原、保留相容觀察期，再執行最終的收束移除步驟。

## 相關文件

- [約束與資料完整性](constraints-and-data-integrity.md)：`NOT NULL`、`UNIQUE` 與外鍵保證的資料規則。
- [多版本並行控制與鎖定](locking-and-mvcc.md)：表級鎖排隊、長交易與大量更新後的空間回收。
- [索引與查詢計畫](indexes-and-query-plans.md)：新增或移除索引對讀寫成本的影響。
- [相容性與演進](../api/compatibility-and-evolution.md)：跨版本並存與漸進移除的共通原則。
- [關聯式資料庫索引](README.md)。
