# CarlAcademy

按主題整理工程與技術知識的公開文件，各主題由基礎概念逐步深入，持續累積與擴充。Linux 是其中一個主題；AWS 及其各項服務、網路、程式開發、資安與系統設計等，也可以各自整理成主題。

不限定程式語言或框架。API 等共通知識集中整理成完整主題，不同語言的實作範例連回同一套概念文件。

完整定位、內容組織與近期整理方向見 [現行規劃](PLAN.md)。

## 知識主題

- [Linux 知識索引](docs/linux/README.md)：已有索引所列的 14 篇文章，從系統與 Shell 基礎延伸至管理、儲存、效能與核心。
- [AWS 知識索引](docs/aws/README.md)：已有索引所列的 20 篇文章，涵蓋雲端基礎、代表服務與服務組合。
- [API 共通知識索引](docs/api/README.md)：已有 16 篇概念文章，涵蓋共通基礎、延伸議題、HTTP、REST、gRPC 與 GraphQL；語言實作按需求補充。
- [關聯式資料庫索引](docs/relational-databases/README.md)：已有 7 篇基礎文章，涵蓋資料模型、鍵與關聯、SQL、約束、正規化、交易隔離與索引；產品範例明示適用範圍。
- [Web 應用資安索引](docs/web-security/README.md)：已有 7 篇基礎文章，涵蓋信任邊界、登入與 Session、存取控制、SQL Injection、XSS、CSRF，以及機密與敏感資料管理。

各主題可以獨立閱讀與擴充，不要求先學完 Linux 才閱讀其他內容。需要其他主題的背景知識時，以相關文件連結補充。

文件著重概念、原理與具體例子，依需要補上指令、圖解、常見問題與參考來源。每篇聚焦一個概念、服務或問題，讓讀者可以循序閱讀，也可以直接查找。

目前已實作可瀏覽公開內容的基本靜態網站；定稿視覺、閱讀工具與全文搜尋尚待後續 tickets 完成，尚未發布。先前學習產品方向的歷史紀錄與適用界線見 [現行規劃](PLAN.md#目前狀態與文件入口)。


## 本機建置與驗證

需要 Node.js 22.23.4 以上的受支援版本（本次驗證使用 Node.js 24.21.0）及 Python 3。

```sh
npm ci
npm run check
npm run build
python3 -m http.server 4321 --bind 127.0.0.1 --directory dist
```

開啟 `http://127.0.0.1:4321/`。建置從現有公開主題 Markdown 讀取內容，並檢查標題、網址衝突、閱讀順序、公開輸出、站內連結與段落錨點；任何檢查失敗皆以非零狀態結束。文章保留單一 H1 作為頁面標題，新文章須由所屬主題索引連結，網址由英文來源路徑推導。

開發時可使用 `npm run dev`；正式產物驗收使用上方的一般靜態伺服器，或 `npm run preview` 作人工預覽。

以子路徑建置時，base path 也會套用到連結與資源：

```sh
BASE_PATH=/academy/ npm run build
```

將輸出掛載在伺服器的 `/academy/` 下再開啟；這是不同的建置設定，不能把根路徑產物直接搬過去。`BASE_PATH` 使用 `/` 或由英文、數字、連字號及底線組成的路徑段。尚未指定託管平台或網域。

執行完整產物測試：

```sh
npx playwright install chromium
npm test
```

測試會在隔離暫存副本建置根路徑與子路徑網站，透過 Python 靜態伺服器與停用 JavaScript 的 Chromium 操作，並驗證缺少標題、網址衝突、壞連結、壞錨點及未列入索引的文章會失敗；不修改原始文件。測試不代表已完成定稿視覺、全文搜尋、實機或真人試讀驗收。

目前建站依據為 [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/) 與 [Markdown 處理器文件](https://docs.astro.build/en/guides/markdown-content/)。採 Unified 管線整合相對連結轉換、CJK 粗體及 GFM；關閉單波浪刪除線，避免數字範圍被誤渲染。Cheerio 用於建置後 HTML 檢查，Playwright 用於靜態網站的瀏覽器驗收；Node 內建 test runner 執行測試，版本由 lockfile 固定。
