# 交易與隔離

交易（transaction）把一組資料庫操作放在共同的成功或失敗邊界，隔離（isolation）則決定多個交易同時執行時如何互相影響。
「已經包進交易」不能回答所有並行問題，也不代表資料庫外的寄信、付款與訊息發送能一起回復。

先備背景：[資料變更](sql-queries-and-data-changes.md)與[約束](constraints-and-data-integrity.md)。
查證日期：2026-11-02。產品行為明確以 PostgreSQL 18 為準。
本文僅查閱文件，未執行 SQL、故障測試或雙連線並行測試；以下排程與預期結果為自創推導。

## ACID 各自解決不同問題

| 性質 | 要理解的責任 |
| --- | --- |
| Atomicity，原子性 | 交易範圍內的資料修改共同提交或撤銷 |
| Consistency，一致性 | 操作應把有效狀態帶到另一個有效狀態，依賴正確規則與程式邏輯 |
| Isolation，隔離性 | 並行交易的可見性與互動有明確保證 |
| Durability，持久性 | 提交成功的資料依資料庫的持久性設定保存 |

交易的整體目的與 `BEGIN`、`COMMIT`、`ROLLBACK` 見
[PostgreSQL 18：Transactions](https://www.postgresql.org/docs/18/tutorial-transactions.html)。
持久性仍有設定前提，例如 PostgreSQL 的非同步提交允許回應成功後、WAL 寫入持久儲存前的視窗；
不能只看 ACID 字樣就推定所有設定與故障型態都等價。
參考 [PostgreSQL 18：Asynchronous Commit](https://www.postgresql.org/docs/18/wal-async-commit.html)。

## 先看清楚交易沒有自動做的事

假設一個計數目前為 10，兩個請求都先讀到 10，各自在程式中計算 11，再寫回 11。
即使兩邊都包交易，最後仍可能是 11，而不是預期的 12；這是以舊值覆蓋新結果的更新遺失情境。
交易的原子性並沒有替應用選擇正確的讀改寫方式。

在 PostgreSQL 18 的 Read Committed，對同一列的更新會等待並行更新，然後依更新後的版本重檢條件。
因此單一語句 `SET value = value + 1` 與寫死 `SET value = 11` 的語意不同。
參考 [PostgreSQL 18：Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED)。

另一種方式是樂觀並行控制：更新條件包含先前讀取的版本，成功後增加版本；
影響零列表示狀態已改變，須重新讀取與判斷，不能當成更新成功。
它仍需每個相關寫入者遵守版本規則，不能只在其中一條路徑加欄位。

## 自創例子：只有一個剩餘名額

以下是獨立 PostgreSQL 18 範例，不沿用其他篇的課程表：

```sql
CREATE TABLE course_capacity (
    course_id bigint PRIMARY KEY,
    remaining integer NOT NULL CHECK (remaining >= 0)
);
CREATE TABLE seat_reservations (
    request_id text PRIMARY KEY,
    course_id bigint NOT NULL REFERENCES course_capacity (course_id)
);
INSERT INTO course_capacity (course_id, remaining) VALUES (10, 1);
```

一次預約在交易內先做條件更新：

```sql
BEGIN;
UPDATE course_capacity
SET remaining = remaining - 1
WHERE course_id = 10 AND remaining > 0
RETURNING course_id, remaining;
```

**這是有分支的應用流程，不能不看結果就執行後面的 INSERT。**
若回傳恰好一列，應用才執行以下成功分支；若零列，就 `ROLLBACK` 並回報沒有名額或課程不存在。
`RETURNING` 回傳被改動列的能力見
[PostgreSQL 18：Returning Data from Modified Rows](https://www.postgresql.org/docs/18/dml-returning.html)。

```sql
INSERT INTO seat_reservations (request_id, course_id)
VALUES ('reserve-intent-7', 10);
COMMIT;
```

若新增預約失敗，應用須回復交易，名額扣減也會撤銷。
在 PostgreSQL 18 Read Committed 下，兩個請求競爭最後一個名額時，第二個更新等待後會重檢 `remaining > 0`，
不能假設兩邊都成功。這依賴上述條件更新與錯誤分支，並非只因為有 `BEGIN`。

本例的 `request_id` 只能阻止同 ID 重複保存；它還不是完整的 API 冪等契約。
重送時仍需辨識既有成功紀錄、比對原參數並回傳同一結果，不能把主鍵錯誤直接宣稱為預約失敗。
若其他寫入路徑繞過扣減流程，名額與預約筆數也可能不一致。

## 隔離等級要連同產品實現理解

下表只描述 **PostgreSQL 18**，不宣稱其他產品同名等級具有相同實現：

| 等級 | 主要觀察 |
| --- | --- |
| Read Uncommitted | PostgreSQL 按 Read Committed 處理 |
| Read Committed | 預設等級；一般查詢以語句開始時的快照讀取，連續兩次查詢可看見不同已提交狀態 |
| Repeatable Read | 使用穩定快照，PostgreSQL 也阻止幻讀，但仍可能有序列化異常 |
| Serializable | 所有成功交易的效果須可對應某種逐一執行順序；應用須準備完整重試 |

細節見 [PostgreSQL 18：Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html)。
髒讀是讀到別人未提交的資料；不可重複讀是再讀同一資料卻看到別人提交後的新值；
幻讀是再次依條件查詢時符合的列集合改變。
穩定快照仍不等於所有跨列業務規則都安全，例如兩位值班者各看到另一人仍在，便同時退出，最後可能無人值班。

## 鎖與重試有自己的成本

`SELECT ... FOR UPDATE` 可鎖住選出的列，讓需要先讀再判斷的流程控制並行修改。
但沒有選到的列不會因此自動被鎖住；「查不到報名所以可新增」仍要靠唯一性或其他正確同步邊界。
鎖可能造成等待與死結，PostgreSQL 會中止其中一個死結交易。
固定鎖定順序、縮短交易時間，能減少衝突機會。
參考 [PostgreSQL 18：Row-Level Locks 與 Deadlocks](https://www.postgresql.org/docs/18/explicit-locking.html)。

遇到序列化失敗，應重跑整個交易，包括先前的讀取與決策；只重送最後一個 UPDATE 可能仍使用過期前提。
應有有限次數、時間預算與可識別錯誤，不能把所有錯誤一律無限重試。
參考 [PostgreSQL 18：Serialization Failure Handling](https://www.postgresql.org/docs/18/mvcc-serialization-failure-handling.html)。

## 提交結果與外部效果需要分開處理

如果資料庫已提交，回應卻在途中遺失，呼叫端只能說「結果未知」，不能安全地假定未提交。
如果先寄出通知再回復交易，信不會自動收回；如果先提交再寄信，程序又可能在寄信前中止。
這是兩個不同邊界之間的空隙，通常需要可重試的工作紀錄、去重與對帳等設計；本文未提供完整訊息系統實作。

PostgreSQL 的 sequence 也有特例：已取用值不因交易回復而歸還，不能要求 ID 完全無缺口。
參考 [PostgreSQL 18：Sequence Manipulation Functions](https://www.postgresql.org/docs/18/functions-sequence.html)。

## 相關文件

- [API 逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)：處理結果未知與重送意圖。
- [約束與資料完整性](constraints-and-data-integrity.md)：交易仍須有正確不變條件。
- [索引與查詢計畫](indexes-and-query-plans.md)：索引改變成本，不替代隔離契約。
- [關聯式資料庫索引](README.md)。
