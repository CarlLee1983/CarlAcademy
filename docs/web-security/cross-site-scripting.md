# XSS 與瀏覽器輸出邊界

同一段使用者文字可以安全地顯示在畫面，也可以在錯誤的輸出方式下變成瀏覽器執行的內容。
跨網站指令碼（Cross-Site Scripting，XSS）要從「資料最後進入哪個解析器」理解。

查證日期：2026-11-02。依 OWASP、MITRE CWE-79 與 MDN 文件整理；網頁持續更新。
本次未建立網頁或執行瀏覽器／攻擊測試，範例只說明文字輸出的邊界。

## 文字被當成程式的問題

使用者控制的內容若進入網頁，卻沒有在適當位置維持資料與程式的區隔，就可能形成 XSS。
影響可能包括冒用頁面所擁有的能力、讀取頁面可取得的資料或修改使用者看到的內容。
參考 [MITRE CWE-79](https://cwe.mitre.org/data/definitions/79.html)。

常見來源包括：

| 情境 | 資料如何抵達輸出 |
| --- | --- |
| 反射型 | 請求中的內容被直接放入當次回應 |
| 儲存型 | 留言或筆記先保存，之後在其他人的頁面出現 |
| DOM 型 | 頁面腳本把 URL 等來源的內容交給危險的 DOM 操作 |

這些描述不同資料路徑，不是互斥且窮盡的防護分類；都要追到實際輸出位置。
存進自己的資料庫不會自動成為可信 HTML。

## 要顯示純文字，就用純文字介面

假設頁面已有 `<p id="note-title"></p>`，以下 JavaScript 用固定 ID 找到一般文字容器：

```javascript
const title = document.getElementById("note-title");
title.textContent = "<b>今天的筆記</b>";
```

這會將內容當成文字；不以 HTML 解析 `<b>`。
若改用 `innerHTML`，相同字串就會被當成 HTML。這個例子不提供任何執行攻擊的內容。
`textContent` 的安全性要連同目標看待：此處是普通段落，不能據此往 `script` 等可執行位置放入外部文字。
參考 [MDN：Node.textContent，與 innerHTML 的差異](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent#differences_from_innerhtml)。

## 輸出編碼取決於上下文

伺服器模板或前端框架的預設文字跳脫能提供保護，但要知道哪些介面會繞過它。
HTML 文字、屬性、URL、CSS、JavaScript 都有不同解析規則；不能先做一次通用替換，就把結果任意插進所有位置。
有些危險上下文應直接避免使用外部資料。
參考 [OWASP XSS Prevention：Output Encoding](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html#output-encoding)。

例如顯示標題與設定連結是不同需求。標題可走文字介面；連結除了正確設定屬性，還需依產品政策限制 URL scheme 與目標。
HTML 跳脫不會自動把不允許的 URL 變成允許。
這是輸出邊界的應用，不是所有網址都必須採同一個允許清單。

若產品確實允許富文字 HTML，純文字跳脫會改變功能；此時要定義允許的標記與屬性，使用持續維護的 HTML 清理器。
不要自行以正規表示式刪除幾個關鍵字，或在清理後又拼入未處理內容。
參考 [OWASP：HTML Sanitization 與 Safe Sinks](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html#html-sanitization)。

## CSP 與 HttpOnly 的用途

Content Security Policy（CSP）讓網站限制允許載入及執行內容的來源或條件，可作為額外防線。
具體政策須依實際腳本、nonce／hash 與資源需求設計；只加一個寬鬆的 CSP 標頭，不等於 XSS 已消失。
參考 [MDN：Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)。

HttpOnly 能限制腳本直接讀取特定 Cookie，但惡意同源腳本仍可能讀畫面內容或發出帶 Cookie 的請求。
所以「Cookie 讀不到」不能當成 XSS 沒有影響的證據。Cookie 的個別作用見[登入與 Session](login-and-sessions.md)。

## 如何驗證輸出需求

對純文字筆記，可在受控測試中輸入含 `<`、`>`、引號及一般標記形式的文字，確認顯示結果與原文字一致，沒有產生額外元素。
再檢查列表摘要、搜尋結果與匯出畫面是否使用相同保護；富文字則另外驗證允許與拒絕的結構。
這些是教學案例的驗證方向，本文未執行，不代表完整漏洞掃描。

## 相關文件

- [信任邊界](trust-boundaries.md)：保存資料與信任資料是不同判斷。
- [CSRF](csrf-and-browser-boundaries.md)：跨站請求與頁面內程式執行的差異。
- [Web 應用資安索引](README.md)。
