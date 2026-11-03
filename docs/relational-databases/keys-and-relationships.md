# 鍵與資料關係

鍵回答「這是哪一筆資料」，關係回答「這筆資料與其他資料如何相連」。
若用姓名識別學員，同名或改名便會讓程式難以確認對象；若只存一個不存在的課程編號，報名紀錄便失去意義。
鍵的選擇與跨表約束，是把這些問題變成明確規則的方法。

先備背景：[關聯模型](relational-model.md)。查證日期：2026-11-02；SQL 例子採 PostgreSQL 18。
本文僅查閱文件，未執行 SQL；情境、編號與資料均為本站自創。

## 候選鍵不是「目前看起來沒重複」

**超鍵（superkey）**是足以唯一識別一列的欄位集合；**候選鍵（candidate key）**是不能再刪減欄位而仍保持識別能力的超鍵。
從候選鍵選一個作為主要識別，便是主鍵（primary key）；其他候選鍵也可以另外宣告唯一性規則。
「最小」指不能刪減，不代表所有候選鍵的欄位數都相同。
參考 [Berkeley CS 186：DB Design，Functional Dependencies](https://cs186berkeley.net/notes/note13/)。

例如本例規定每位學員有不重複且不可缺的 `student_id` 與學員代碼 `student_code`。
兩者各自可當候選鍵，而 `(student_id, student_code)` 雖也能識別，卻不是最小的候選鍵。
這是業務與結構的承諾，不能只因現有三位學員的姓名不同，就把姓名當成候選鍵。

**自然鍵**取自業務有意義的值，**代理鍵**則是為識別而引入的值。
本例以內部數字 ID 為主鍵、學員代碼另設唯一約束，降低代碼政策改變對其他表的影響。
代理鍵不會自動防止同一真人被建成兩筆；哪些資料代表同一人的判斷仍需另訂。

## 一對多把外鍵放在「多」的一側

一位學員可以有多筆報名，每筆報名只屬於一位學員。
`enrollments.student_id` 因而指向 `students.student_id`。
外鍵（foreign key）限制參照值必須能在目標鍵找到對象；它不要求參照端的值只出現一次。
參考 [PostgreSQL 18：Foreign Keys](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-FK)。

以下建表片段可在新的 PostgreSQL 18 schema 中搭配[關聯模型篇](relational-model.md)的 `courses` 表理解：

```sql
CREATE TABLE students (
    student_id bigint PRIMARY KEY,
    student_code text NOT NULL UNIQUE,
    name text NOT NULL
);

CREATE TABLE enrollments (
    student_id bigint NOT NULL REFERENCES students (student_id),
    course_id bigint NOT NULL REFERENCES courses (course_id),
    enrolled_on date NOT NULL,
    PRIMARY KEY (student_id, course_id)
);
```

這裡的複合主鍵規定「同一學員對同一課程最多一筆報名」。
若需求允許重修多次，此鍵就不符合需求，應先建模課程場次或報名次數，再選識別方式。
不是把唯一約束拿掉就完成重修設計，因為那樣也會失去分辨每次報名的依據。

## 多對多由關聯表保存兩邊的配對

一位學員可報名多門課，一門課也可有多位學員，因此 `students` 與 `courses` 是多對多。
上面的 `enrollments` 把它轉成兩個一對多，並保存「報名日」這個屬於配對的事實。
報名日不應放在學員表，否則無法表達同一人不同課程的日期。

```text
students 1 ← 多 enrollments 多 → 1 courses
```

圖中的「1」表示每筆報名連到一位學員或一門課，不表示每位學員必須有報名。
外鍵與 `NOT NULL` 可以要求每筆報名有對象，卻不會要求每門課至少有一位學員。
最大數量（至多一個或很多個）與最小參與數量（可為零或至少一個）要分開描述。
關係建模背景見 [Berkeley CS 186：Relationship Constraints](https://cs186berkeley.net/notes/note13/#relationship-constraints)。

## 一對一還需要唯一性

假設每位學員至多有一份擴充設定，可以把設定表的 `student_id` 同時設為主鍵與外鍵。
主鍵限制每人至多一份，外鍵限制設定必須屬於存在的學員。
但它仍允許學員尚未建立設定；如果要求每位學員必有一份，需要連同建立流程或其他設計處理。

```sql
CREATE TABLE student_preferences (
    student_id bigint PRIMARY KEY REFERENCES students (student_id),
    locale text NOT NULL
);
```

如果只有一般外鍵，卻沒有主鍵或唯一約束，同一學員可以有很多份設定，結構就仍是一對多。
主鍵與唯一約束的產品語意見 [PostgreSQL 18：Primary Keys](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-PRIMARY-KEYS)。

## 刪除政策是關係的一部分

刪除課程時，是拒絕刪除、連帶刪掉報名，還是保留歷史但停止開放？這些是不同業務行為。
本例未指定級聯刪除，不應假設刪除課程會自動清除所有報名。
若選 `ON DELETE CASCADE`，必須真的接受子資料被連帶刪除，不能只因程式報外鍵錯誤就加上它。
選項細節見 [PostgreSQL 18：Foreign Keys，刪除動作](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-FK)。

ID 也不是顯示順位或無缺口流水號。若使用 PostgreSQL sequence 產生值，取消交易不會歸還已取的序號，
因此缺號不能證明資料被刪除；生成值也不能取代 `PRIMARY KEY` 的唯一性約束。
參考 [PostgreSQL 18：Transaction Isolation，sequence 特例](https://www.postgresql.org/docs/18/transaction-iso.html)。

## 相關文件

- [約束與資料完整性](constraints-and-data-integrity.md)：NULL、外鍵與唯一規則的界線。
- [正規化與資料依賴](normalization.md)：依鍵判斷哪些事實應放在同一表。
- [SQL 查詢與資料變更](sql-queries-and-data-changes.md)：用關聯表連接資料。
- [關聯式資料庫索引](README.md)。
