# 軟體供應鏈、第三方套件與前端腳本邊界

現代 Web 應用很少從零手寫每一行程式：後端與建置工具會安裝數十個開源套件（及其背後的數百個傳遞相依套件），前端頁面也常引入外部字型、分析工具或客服小工具腳本。
但**引入外部程式碼，就等於把執行權限借給了外部維護者與發布管道**。當套件帳號遭到接管、安裝腳本被塞入惡意指令，或外部 CDN 上的前端腳本被惡意修改，攻擊者不需突破應用程式自己寫的驗證邏輯，就能直接站在信任邊界內部存取機密或讀寫頁面。

先備概念見[信任邊界與威脅思考](trust-boundaries.md)、[XSS 與瀏覽器輸出邊界](cross-site-scripting.md)與[機密與敏感資料的生命週期](secrets-and-sensitive-data.md)。
查證日期：2026-11-03。依 OWASP NPM Security／Third Party JavaScript Management Cheat Sheet、MITRE CWE-829／CWE-1357 與 MDN 整理。
本次僅查證文件，未執行套件掃描或弱點利用；以下為自創的筆記服務情境。

## 第三方程式碼跨越了哪一道信任邊界

將未受充分控管的外部功能納入系統，對應常見弱點分類中的 [MITRE CWE-829：Inclusion of Functionality from Untrusted Control Sphere](https://cwe.mitre.org/data/definitions/829.html)與 [CWE-1357：Reliance on Insufficiently Trustworthy Component](https://cwe.mitre.org/data/definitions/1357.html)。
在筆記服務中，供應鏈風險主要出現在三個完全不同的執行位置：

```text
1. 開發機與 CI 建置環境：執行套件安裝與建置腳本
   ──→ 擁有原始碼、建置產物與 CI 環境變數（如部署 token）的讀取與修改權

2. 後端應用伺服器：執行 import 的直接與傳遞相依套件
   ──→ 擁有與主應用相同的內部網路、資料庫連線與伺服器機密存取權

3. 使用者瀏覽器：載入 <script src="https://cdn.example/...">
   ──→ 擁有與筆記服務主站同源（Same-Origin）的 DOM、畫面內容與同源請求控制權
```

這意味著：如果某個用於格式化日期的小型套件在更新時被塞入惡意程式碼，它在後端執行時可以讀取應用程序的環境變數，在前端執行時則等同於全站生效的 [XSS](cross-site-scripting.md)。

## 後端與建置管線的套件供應鏈防護

相依套件的風險不只來自「已公開登記的舊版漏洞（CVE）」，也常來自「安裝當下下載到非預期的版本或偽冒套件」。
參考 [OWASP NPM Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Npm_Security_Cheat_Sheet.html)。

| 風險來源 | 發生原因 | 工程防護原則 |
| --- | --- | --- |
| 傳遞相依偏移（Transitive drift） | 只在 `package.json` 寫寬鬆範圍（如 `^1.2.0`），每次部署重新解析最新相依樹，無意間拉入剛發布就被放入惡意程式的次要版本 | 將鎖檔（如 `pnpm-lock.yaml`）納入版本控制，並在 CI／正式建置一律使用 `--frozen-lockfile`，確保建置結果可重現 |
| 名稱近似與命名空間混淆（Typosquatting / Dependency Confusion） | 打錯套件名稱，或私有套件名稱未固定來源設定，導致套件管理員跑去公開倉庫下載同名的高版本惡意套件 | 仔細核對套件名稱與範圍（scope），固定內部與外部 registry 路由，不隨意新增來路不明的微小套件 |
| 安裝期腳本任意執行（Install scripts） | 套件在 `preinstall`／`postinstall` 階段自動執行 shell 或 Node 腳本，在尚未執行主程式前就讀取並外傳開發機或 CI 憑證 | 預設限制或審查安裝期腳本，並搭配最小發佈等待期策略，避免新版本剛推上公開倉庫的幾分鐘內就被自動拉入正式環境 |
| CI 建置環境權限過大 | 執行測試與打包的工作階段直接掛載了正式環境資料庫密碼或高權限雲端金鑰 | 依[〈機密與敏感資料的生命週期〉](secrets-and-sensitive-data.md)隔離建置與部署階段，一般 PR 驗證只給唯讀權限，不暴露正式憑證 |

## 瀏覽器端的第三方腳本、SRI 與隔離邊界

當筆記服務的 HTML 寫下 `<script src="https://third-party.example/widget.js"></script>` 時，瀏覽器不會因為這個檔案來自外部網域，就限制它在目前頁面的權限——只要它是以 `<script>` 載入到主文件中，它就能讀取頁面上顯示的私人筆記 DOM、監看使用者輸入，並替使用者發出同源請求。
參考 [OWASP Third Party JavaScript Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html)。

管理前端外部資源時，應區分以下四種手段的保護範圍與限制：

1. **優先自行託管（Self-hosting）經過版本固定的資源**：
   對於字型、基礎函式庫與靜態資源，在建置階段納入受控倉庫並由自己的網站提供，不僅減少對外部 CDN 可用性的依賴，也能避免外部伺服器單方面替換檔案內容，同時減少使用者瀏覽器向第三方洩漏連線資訊。
2. **子資源完整性（Subresource Integrity，SRI）**：
   若確實需要從外部 CDN 載入固定版本的靜態腳本或樣式，可在 `<script>` 或 `<link>` 標籤加上 `integrity` 屬性與雜湊值：
   ```html
   <script
     src="https://cdn.example.com/lib-1.4.2.min.js"
     integrity="sha384-BASE64_HASH_OF_EXPECTED_FILE"
     crossorigin="anonymous"
   ></script>
   ```
   瀏覽器下載後會先核對檔案雜湊是否相符，不符就拒絕執行，防止外部 CDN 遭入侵後惡意修改該檔案。
   但要注意 SRI 的界線：**SRI 只保證檔案內容與當初計算雜湊時一模一樣**；如果該版本原本就含有漏洞，SRI 不會阻止它；且對於外部提供者會隨時動態改變內容的不固定網址（如 `analytics.js`），若未鎖定版本路徑，直接加 SRI 會在對方更新時因雜湊不符而中斷載入。參考 [MDN：Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)。
3. **以沙盒 `<iframe>` 隔離不需存取主頁面的嵌入式元件**：
   若第三方功能只是獨立顯示區塊（如外部表單或嵌入內容），不需要讀取筆記主頁面的 DOM，可放入獨立來源的 `<iframe sandbox="...">`，依最小權限開啟所需能力，避免直接給予主頁面腳本執行權。
4. **以 Content Security Policy（CSP）收緊允許載入的來源**：
   在[〈XSS 與瀏覽器輸出邊界〉](cross-site-scripting.md)提到的 CSP 標頭中，限制 `script-src` 只允許受控的腳本來源或對應雜湊／nonce，並不在顯示高度敏感私人筆記的核心頁面隨意載入非必要的第三方行銷或追蹤腳本。

## 盤點相依與修補優先順序

沒有任何外部套件能保證永遠不出現漏洞。日常維護的重點不是追求「零外部相依」，而是讓相依關係保持**少而明確、可盤點、可安全升級**：

- **新增前先評估必要性**：若只需幾行標準函式庫就能完成的功能，不必為了省幾分鐘而引入帶有大量傳遞相依樹的外部套件。
- **區分漏洞通報與實際暴露面**：收到相依套件的漏洞通報時，先確認該套件是僅用於本機開發測試（`devDependencies`），還是會進入正式執行環境或瀏覽器產物；再檢查應用程式是否實際呼叫了受影響的功能或暴露給不受信任的輸入，按真實風險安排升級與回歸測試。

## 相關文件

- [信任邊界與威脅思考](trust-boundaries.md)：引入外部套件與外部腳本時，誰進入了系統的信任邊界。
- [XSS 與瀏覽器輸出邊界](cross-site-scripting.md)：第三方前端腳本與同源執行權限、CSP 的關係。
- [機密與敏感資料的生命週期](secrets-and-sensitive-data.md)：保護 CI 建置環境與正式環境憑證，避免被套件腳本讀取。
- [軟體與套件](../linux/software-and-packages.md)：作業系統層級的套件來源、簽章與相依概念。
- [Web 應用資安索引](README.md)。
