# Web 應用的存取控制

「登入成功」與「可以修改這一筆資料」之間，還有應用程式必須執行的政策。
本篇接續[〈身分驗證與授權〉](../api/authentication-and-authorization.md)，不另定義一套共通術語；
重點是 Web 服務的入口、物件、欄位與背景工作如何遵守同一個存取規則。

查證日期：2026-11-02。依 OWASP Authorization 與 IDOR 防護文件整理。
本次僅查證文件，未測試服務。以下是自創的私人筆記政策，不是本站功能。

## 先定義政策，再找檢查位置

假設筆記只有擁有者能讀寫，沒有公開分享或管理員例外：

| 請求主體 | 讀甲的筆記 | 改甲的文字 | 改擁有者 |
| --- | --- | --- | --- |
| 未登入 | 拒絕 | 拒絕 | 拒絕 |
| 已登入的甲 | 允許 | 允許 | 拒絕：本例無轉移功能 |
| 已登入的乙 | 拒絕 | 拒絕 | 拒絕 |

這張表是教學案例政策，不是所有筆記系統都必須如此設計。
它讓「自己的資料」成為能檢查的關係，也指出擁有者不一定能改每一個欄位。
OWASP 建議最小權限、預設拒絕與每次請求的權限檢查。
參考 [OWASP Authorization：Recommendations](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#recommendations)。

## ID 用來定位，不能替代許可

`GET /notes/42` 的 `42` 只指出目標。伺服器要確認目前主體能讀這筆資料；
換成 UUID 或隱藏網址，不會改變這項責任。缺少物件層級檢查可能形成 IDOR。
參考 [OWASP：Insecure Direct Object Reference Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)。

以下是概念流程，不是可執行的框架程式：

```text
主體 = 從可信的驗證結果取得
目標 = 在該主體允許存取的資料集合中尋找請求 ID
若不存在或不允許：拒絕，結束
依本操作允許的欄位讀取或修改
```

由用戶端傳來的 `user_id`、`owner_id` 或 `is_admin` 不能自行變成可信驗證結果。
本文政策下，新筆記的擁有者由伺服器的主體決定，文字修改也不接受順便換擁有者。
這是依案例政策推導的輸入邊界；細節須由實際模型與更新介面決定。

## 規則要涵蓋所有取得資料的方式

單筆讀取有檢查，不代表列表、搜尋、匯出、下載與批次修改也已受保護。
例如乙的列表若包含甲的標題與摘要，即使點進去被擋下，受保護資料也已流出。
背景工作不由畫面直接呼叫，也要有明確的服務身分與執行範圍。

這些都是對筆記政策的推演。實作可共用授權機制，不必在每個方法複製判斷，
但共用機制要覆蓋所有受保護入口，並在回傳或變更受保護資料前生效。
參考 [OWASP：檢查位置與安全失敗](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#verify-that-authorization-checks-are-performed-in-the-right-location)。

如果歸屬或分享狀態可以在操作中途改變，還要考慮檢查與使用之間的狀態變化。
不可只憑稍早畫面的資料就更新；具體一致性需求可用交易或條件更新等機制落實，
但交易本身不會替應用程式定義誰有權限。參見[交易與隔離](../relational-databases/transactions-and-isolation.md)。

## 用允許與拒絕案例一起驗證

對本文政策，測試應包含甲正常讀寫、乙改 ID、未登入請求，以及列表與批次入口。
拒絕時不只看狀態碼，也要確認回應無私人內容、資料沒有先被修改；
修改文字時額外帶入 `owner_id`，也不能讓歸屬改變。這些是驗證建議，未在本次執行。

授權拒絕可以留下適量事件紀錄，以便調查；不要為了追查而把整份私人筆記或憑證寫進日誌。
HTTP 401、403、404 的表達另見[〈狀態碼與錯誤表示〉](../api/status-codes-and-error-representations.md)，
選對狀態碼仍須配合真正的存取控制。

## 相關文件

- [信任邊界](trust-boundaries.md)：辨認可信主體與資料來源。
- [登入與 Session](login-and-sessions.md)：建立及延續身分。
- [API 測試](../api/api-testing.md)：觀察資料與狀態結果。
- [Web 應用資安索引](README.md)。
