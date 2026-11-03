# 參考 CarlStack，以 Astro 建置靜態文件站

CarlAcademy 原先選擇 VitePress 與 Pagefind；在使用者提出 CarlStack 作為參考後，實際查閱其 Astro 設定、Content Collections、統一內容入口、版型、靜態路由與搜尋程式，經使用者確認，改採 Astro＋Content Collections＋Pagefind。保留 `docs/` 作為唯一內容來源，參考 CarlStack 的分層方式，自行實作主題導覽、文件側欄與本文目錄；公開網址仍遵守 [ADR 0001](0001-public-document-urls.md)。

保留 VitePress 可使用現成文件介面，但仍需整合本專案的網址、來源連結與搜尋；採 Astro 則可沿用 CarlStack 的內容渲染與建置經驗，代價是自行維護文件導覽與版型。CarlStack 是部落格，資料欄位、日期排序與固定根路徑的連結不能直接套用：本專案須保留文件的閱讀順序，將公開網址、資源與搜尋載入統一納入 base path，並排除內部規劃及 ADR。CarlStack 的 Cloudflare 部署、留言、分析與互動功能不因此成為本專案需求。

本決定取代先前的 VitePress 選型，未改變靜態輸出、託管可替換、單一 Markdown 來源及既定驗收條件。完整責任邊界與驗收以 [PLAN.md](../../PLAN.md#靜態文件站架構) 為準；此為已確認的架構決定，不代表網站已實作或驗收。
