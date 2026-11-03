# 正規化與資料依賴

正規化（normalization）依資料之間的依賴整理資料表，減少同一事實被重複維護而產生的矛盾。
它不是把表拆得越多越好，也不是看到兩個相同字串就一定要另建一表。
關鍵在於：什麼決定什麼，以及拆開後能否正確還原事實。

先備背景：[鍵與資料關係](keys-and-relationships.md)。查證日期：2026-11-02。
本文採關聯理論的概念例子，沒有可執行 SQL，也未啟動資料庫。
自創情境的依賴條件會明列，不能從少數範例資料自行推定普遍規則。

## 重複事實怎麼造成異常

假設把報名、學員、課程與講師資料都放在一張表：

| student_id | student_name | course_id | course_title | instructor_id | instructor_name | enrolled_on |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 小林 | 10 | SQL 基礎 | 90 | 陳老師 | 2026-11-01 |
| 2 | 小陳 | 10 | SQL 基礎 | 90 | 陳老師 | 2026-11-02 |
| 1 | 小林 | 20 | Linux 入門 | 91 | 林老師 | 2026-11-02 |

本例規定同一學員對同一課程只報名一次；每門課只有一位目前負責的講師，每位講師只有一個目前姓名。
如果課程可多人授課，或要保存每次報名時的講師快照，就不符合這組前提，不能套用同一拆法。

在目前前提下，課程 10 改名要改兩列；只改一列便出現兩個版本，這是**修改異常**。
新課程還沒有人報名時，沒有自然的完整報名列可以放它，是**新增異常**。
刪掉課程 20 的唯一報名，還可能把課程及講師資料一起抹掉，是**刪除異常**。
正規化減少重複與不一致依賴的目的，見
[Microsoft Learn：Description of normalization](https://learn.microsoft.com/en-us/previous-versions/troubleshoot/microsoft-365/microsoft-365-apps/access/database-normalization-description#description-of-normalization)。

## 函數相依是規則，不是統計相關

記號 `X → Y` 表示：只要兩列的 X 相同，Y 就必須相同。
它不表示 X 導致 Y，也不表示可以從現在的資料分布學出業務保證。
函數相依、候選鍵與分解的理論背景見
[Berkeley CS 186：DB Design](https://cs186berkeley.net/notes/note13/)。

依自創規則，我們知道：

```text
student_id → student_name
course_id → course_title, instructor_id
instructor_id → instructor_name
(student_id, course_id) → enrolled_on
```

最後一項依賴整個配對：同一學員的不同課程可能有不同報名日，同一課程的學員也可能不同日報名。
`student_name` 不必唯一，因此沒有反向的 `student_name → student_id` 保證。

## 從第一到第三正規形式

第一正規形式（1NF）以每個欄位位置保存其定義域中的單一值為基礎，避免用 `course1`、`course2` 或逗號清單承載可變數量的報名。
例如把 `10,20` 塞進一個課程欄位，會讓外鍵、查詢與單筆取消難以維持；應改成各自獨立的報名列。
入門拆解動機見 [Microsoft Learn：First normal form](https://learn.microsoft.com/en-us/previous-versions/troubleshoot/microsoft-365/microsoft-365-apps/access/database-normalization-description#first-normal-form)。
「單一值」仍依模型的定義域判斷，不是所有可再分解的字串都必須拆到單字。

第二正規形式（2NF）在 1NF 基礎上，要求非主屬性不只依賴任一候選鍵的真子集；
主屬性指屬於某個候選鍵的屬性。本例的鍵是 `(student_id, course_id)`，
但學員姓名只依賴 `student_id`、課程資料只依賴 `course_id`，所以把它們拆出去。
形式定義見 [SJSU CS157a：1NF and 2NF](https://www.cs.sjsu.edu/faculty/pollett/157a.3.18f/Lec20181008.html)。

```text
students(student_id, student_name)
courses(course_id, course_title, instructor_id, instructor_name)
enrollments(student_id, course_id, enrolled_on)
```

第三正規形式（3NF）再處理非鍵事實之間的傳遞依賴。此例 `course_id → instructor_id → instructor_name`，
因此講師改名不應要求修改所有他負責的課程，改為：

```text
students(student_id, student_name)
instructors(instructor_id, instructor_name)
courses(course_id, course_title, instructor_id)
enrollments(student_id, course_id, enrolled_on)
```

形式上，3NF 要求每個非平凡函數相依 `X → A`，X 是超鍵，或 A 是主屬性。
「非鍵欄位只依賴鍵」是入門口訣，遇到多個重疊候選鍵時不能取代形式定義。
形式定義見 [SJSU CS157a：Third Normal Form](https://www.cs.sjsu.edu/faculty/pollett/157a.3.18f/Lec20181008.html)。
上述自創例子的候選鍵沒有重疊問題，故可直接依列出的依賴檢查。

## 拆開還要能正確接回來

把原表拆成「學員與課程」以及「學員與報名日」，再只用學員編號接回，
可能把同一人的每門課都配上他的每個報名日，產生原本不存在的組合。
因此分表不是只看每張表都比較短，還要檢查是否**無損分解**。
本例保留 `(student_id, course_id, enrolled_on)` 的配對，正是為了保留日期屬於哪次報名。
參考 [Berkeley CS 186：Lossless Decomposition](https://cs186berkeley.net/notes/note13/#lossless-decomposition)。

BCNF 比 3NF 更嚴格：每個非平凡函數相依的決定項都必須是超鍵。
分解還應注意能否在各表分別維護原有依賴；無損不代表必然保留所有依賴。
參考 [Berkeley CS 186：BCNF Decomposition](https://cs186berkeley.net/notes/note13/#bcnf-decomposition)與
[Dependency Preserving Decompositions](https://cs186berkeley.net/notes/note13/#dependency-preserving-decompositions)。

## 歷史快照與效能資料需要說明自己的責任

若交易要求保留「下單當時的課名與成交價」，快照與「課程目前的名稱和售價」代表不同時間的事實，
不能把快照當成不小心重複的現值，並要求課程改名時全部同步。
應明確命名與記錄產生時間，讓讀者知道它保存的是歷史契約。

若為查詢效能刻意保存報名總數，則需要指定誰更新、如何處理取消、重試及失敗，並驗證是否真的改善查詢。
這是反正規化的維護成本；加了快取欄位不會自動維持一致。
先看查詢計畫，通常比憑感覺把所有表合併更能找到瓶頸。

## 相關文件

- [約束與資料完整性](constraints-and-data-integrity.md)：把設計依賴變成可執行規則。
- [交易與隔離](transactions-and-isolation.md)：同時更新多處資料的責任。
- [索引與查詢計畫](indexes-and-query-plans.md)：依證據評估查詢成本。
- [JSONB、半結構化資料與混合建模](jsonb-and-semi-structured-data.md)：固定關聯欄位與彈性屬性如何劃分邊界。
- [關聯式資料庫索引](README.md)。
