# 檔案上傳與內容處理邊界

當筆記服務允許使用者上傳圖片或附件時，伺服器收到的不只是一串名字叫 `photo.png` 的位元組，而是一份完全由外部控制的內容、檔名與標頭宣告。
檔案上傳的風險不只在於「上傳瞬間」，更常發生在後續三個邊界：**儲存在哪裡**、**後端如何解析或轉檔**，以及**其他人的瀏覽器如何開啟這份檔案**。

先備概念見[信任邊界與威脅思考](trust-boundaries.md)、[Web 應用的存取控制](access-control.md)與 [XSS 與瀏覽器輸出邊界](cross-site-scripting.md)。
查證日期：2026-11-03。依 OWASP File Upload Cheat Sheet、MITRE CWE-434 與 MDN HTTP 標頭文件整理。
本次僅查證文件，未部署儲存服務或執行上傳測試；案例為自創的筆記附件情境。

## 為什麼不能相信檔名與 Content-Type

瀏覽器上傳檔案時附帶的檔名（filename）與 `Content-Type` 標頭，都可以由請求發送端任意構造。
若伺服器只檢查檔名結尾是不是 `.png`，或只看請求標頭是不是 `image/png`，攻擊者仍可能傳入可被伺服器執行或可被瀏覽器解讀為腳本的內容。
這種未充分限制危險檔案類型的弱點見 [MITRE CWE-434：Unrestricted Upload of File with Dangerous Type](https://cwe.mitre.org/data/definitions/434.html)。

```text
使用者上傳請求（檔名、Content-Type、二進位內容皆不可信）
    │
    ▼
接收與驗證邊界：驗證身分與配額、限制大小、白名單檢查格式與內容特徵
    │
    ├─→ 儲存邊界：伺服器自訂隨機識別碼命名、隔離於不可執行目錄或物件儲存
    │
    └─→ 下載與呈現邊界：檢查讀取權限、獨立來源或安全標頭，避免同源執行腳本
```

因此，上傳防護必須把「請求宣告的資訊」與「伺服器實際採納的處置」拆開，不能直接拿使用者提供的檔名去拼出檔案系統路徑。
參考 [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)。

## 從接收、儲存到回應的四道防線

對假想的私人筆記附件功能，可以把防護責任拆成四個具體問題：

| 檢查階段 | 要防範的風險 | 案例中的處理原則 |
| --- | --- | --- |
| 1. 權限與資源配額 | 未授權上傳、超大檔案耗盡記憶體或磁碟 | 先驗證登入與權限，在串流接收層限制單檔大小、總量與上傳頻率 |
| 2. 類型與內容檢查 | 偽裝副檔名、夾帶主動腳本（如 HTML 或含腳本的 SVG） | 採用明確允許的格式白名單，結合實際檔案結構驗證，不只看請求標頭 |
| 3. 命名與儲存位置 | 路徑穿越（`../`）覆寫系統檔案、放進可作為程式執行的目錄 | 由伺服器產生隨機 UUID 作為儲存鍵；原始檔名僅在正規化後保存為顯示中繼資料 |
| 4. 讀取授權與瀏覽器回應 | 猜測網址讀取他人私人附件、瀏覽器把附件當同源網頁執行 | 每次下載檢查筆記權限；設定明確 `Content-Type`、`X-Content-Type-Options: nosniff` 與適當處置標頭 |

檔案系統路徑與目錄結構的背景見 [Linux 檔案與目錄](../linux/files-and-directories.md)；若使用雲端物件儲存，公開與私有儲存空間的責任邊界另見 [S3、EBS 與 EFS](../aws/s3-ebs-and-efs.md)。

## 圖片與附件也可能在瀏覽器端觸發 XSS

即使伺服器本身不會把上傳檔案當成後端程式執行，若瀏覽器從筆記服務的同一個源（origin）直接開啟某個上傳檔案，且將它解讀成 HTML 或 SVG，檔案內的腳本就會在筆記服務的同源環境中執行，形成儲存型 [XSS](cross-site-scripting.md)。

常見的瀏覽器端邊界失守包括：

1. **允許直接內嵌顯示 SVG 或 HTML 附件**：SVG 本質上是 XML 文件，可包含 `<script>` 或事件處理器；若與主站同源且以 `image/svg+xml` 直接在瀏覽器頂層開啟，腳本便可能在主站源下執行。
2. **缺少內容類型推測防護**：若伺服器回傳不明確的 `Content-Type`，部分瀏覽器可能依內容猜測類型。加上 `X-Content-Type-Options: nosniff` 可要求瀏覽器遵守宣告的 `Content-Type`，不自行升級成可執行類型。參考 [MDN：X-Content-Type-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options)。
3. **未區分內嵌預覽與附件下載**：對不應直接在頁面中渲染的檔案，回應可加上 `Content-Disposition: attachment` 提示瀏覽器下載保存，而非當成網頁開啟。參考 [MDN：Content-Disposition](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Disposition)。
4. **與主站共用同一個 Origin 提供使用者內容**：實務上常將使用者上傳的靜態內容放在不共享主站 Cookie 與 DOM 權限的獨立網域（sandbox domain）提供，降低萬一被瀏覽器解析時的影響範圍。

## 轉檔、解壓縮與非同步處理的風險

有些系統在收到檔案後，會緊接著解壓縮、產生縮圖、讀取文件屬性或交給惡意程式掃描引擎檢查。
這代表「檔案內容」進入了後端解析器這道新的信任邊界：

- **惡意壓縮檔與路徑穿越（Zip Slip）**：很小的壓縮檔解開後可能放大成數十 GB 耗盡磁碟，或內含 `../../` 路徑覆寫預期目錄外的檔案；解壓時必須逐筆檢查目標路徑與累積大小。
- **影像與文件解析器漏洞**：複雜格式解析可能消耗大量 CPU／記憶體，或觸發解析程式本身的外部資源讀取；較重的轉檔與掃描工作宜放在受資源限制、最小權限且與主應用隔離的工作環境中非同步執行。
- **掃描完成前不對外提供**：若系統設計了非同步檢查流程，檔案在通過檢查前應維持隔離狀態，不能一面掃描、一面已允許其他人下載開啟。

## 相關文件

- [信任邊界與威脅思考](trust-boundaries.md)：追蹤檔案從外部進入儲存、解析與瀏覽器輸出的每個邊界。
- [XSS 與瀏覽器輸出邊界](cross-site-scripting.md)：理解同源腳本執行的影響。
- [Web 應用的存取控制](access-control.md)：私人附件的下載網址仍須驗證擁有權，不能只靠難猜的檔名。
- [S3、EBS 與 EFS](../aws/s3-ebs-and-efs.md)：雲端物件儲存與本機檔案系統的分工。
- [Web 應用資安索引](README.md)。
