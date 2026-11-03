# 首版靜態網站驗收

2026-11-03；來源為整合基準 `4805ec01ddf1d364d1a22ffab8229f886f3ad574`（tickets 01–07）加本次 ticket 08 變更。本次 code-review 修正以 `5a7a5496c53cfd8c6696e65bf9e56c4636d1adab` 為基準，補足主題表格與標題錨點，移除舊樣式並沿用共用測試 helper。修正後已完成兩軸獨立複審；此紀錄描述本機正式產物，不代表已發布。

環境：macOS arm64、Node.js 24.21.0、Python 3.9.6、Playwright 1.64.1 的 headless Chromium 156.0.8078.4；當時依賴由 `package-lock.json` 固定；目前已改用 `pnpm-lock.yaml` 與 pnpm 12.0.0。下方 npm 指令及 24 個測試結果是首版歷史證據，最新重跑請使用本節 pnpm 指令。沒有使用 Astro 開發伺服器替代產物驗收。

## 重跑

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run verify
```

只重跑整合巡檢：`pnpm run test:focused tests/integration.test.mjs`。測試在隔離暫存副本分別以 `/` 與 `/academy/` 建置，掛載至 Python `http.server`；子路徑不是搬移根路徑產物。手動預覽命令見 [README](../README.md#本機建置與驗證)。

## 覆蓋與結果

本次結果：`npm test` **24／24 通過**（約 127 秒）；`npm run check` **0 errors／warnings／hints**；`npm run build` **70 頁、70 筆 Pagefind 索引及完整站內目標／錨點驗證通過**；`git diff --check` 通過。完整測試包含兩種 base 的獨立建置，不只根路徑的最後一次建置。

| 入口 | 已驗證範圍 |
| --- | --- |
| `npm run build`、`tests/site.test.mjs` | 現有 64 篇文章、5 個主題索引與首頁共 70 頁；單一來源、閱讀順序、站內目標、所有段落錨點、五個主題來源標題錨點的 HTTP fragment 導航、深層網址直開及重新整理；內部管理文件及 Markdown 原始檔不混入產物，錯誤內容以非零狀態拒絕 |
| `tests/integration.test.mjs` | 依公開文章來源動態取得清單，兩種 base 的全部 70 個網址 HTTP 200；Pagefind 全索引網址與公開清單完全相等，沒有管理文件；所有文章在 390×664／1440×900、淺／深外觀、兩種 base 共 512 組，等待 `document.fonts.ready` 後無整頁水平溢出，自行託管字型、腳本與樣式請求無失敗 |
| `tests/article.test.mjs`、`tests/appearance.test.mjs` | 首頁、主題起點及閱讀順序、系統／淺／深外觀、可見焦點及跳至內容；ELB／CloudFront 桌面正文起點 ≤610px、680px 正文、固定目錄、文末收尾帶與前後篇；手機精簡開場與正文導言；無 JS 的閱讀與導航 |
| `tests/tables.test.mjs` | 文章表格，以及四個主題索引展開後的八張表格，無 JS 手機卡片與欄名；鍵盤切換原表格／卡片，工具列位置差 ≤1px；交易隔離表格延伸至最多 880px、列不換行、只在自身區域捲動；兩種 base 與外觀 |
| `tests/code-tools.test.mjs` | 超寬程式碼捲動提示、精確原文複製、失敗回饋、換行及尺寸切換後可逆；框線圖過渡呈現維持原排版；無 JS 局部捲動；兩種 base 與外觀 |
| `tests/reading-navigation.test.mjs` | 固定目錄、目前段落與進度；手機閱讀列出現條件、面板鍵盤焦點／返回、選擇後標題距頂 72px，繼續閱讀；減少動態與無 JS 原生章節連結 |
| `tests/search.test.mjs` | 兩種 base 的「容器編排」與 `CannotPullContainerError` 命中 `container-orchestration-and-compute-capacity`，主題、摘要及導向；空查詢、無結果、安全文字呈現、過期查詢；首次模組、入口 JSON、內部 `.pf_meta` 及 `.pf_fragment` 失敗後重試皆可回復 |

200% 文字測試採 **CSS 文字縮放模擬**：在 390×664 與 1440×900 的容器文章頁，先取得各元素原本的 computed font-size，再逐一設為兩倍（正文由 16px 成為 32px）。檢查整頁不溢出，動態搜尋結果產生後會重新套用縮放，檢查搜尋框、關閉按鈕與結果仍可經焦點捲動觸及；以鍵盤操作跳至內容、搜尋與主題導航，保留焦點回復。外觀檢查涵蓋鍵盤焦點及 `selectOption` 切換狀態。此方法沒有改變 viewport，**不是原生瀏覽器縮放、系統字體設定或實機測試**，也不代表所有文章都完成 200% 測試。

追加原生 Chrome 驗證：primary 對 ticket 08 完成後的正式產物快照，以獨立本機 HTTP 網址開啟自有測試分頁；先用 Tab 將焦點移至「外觀」，再以原生 macOS 空白鍵、方向鍵與 Return 依序選取深色、淺色並恢復系統。原生 accessibility tree 的選取值及實際頁面外觀均確認變更；這補足外觀選單鍵盤選項切換的證據，沒有將 headless 的選單模擬誤計為通過。此項沒有執行原生文字縮放。

本次修正：文字放大時頁首改為可換行，避免手機工具列超出；手機文章標題平衡換行，保留 40px 字級，移除容器文章末字獨占一行。HTTP 測試伺服器捨棄逐請求 stderr 日誌，避免完整巡檢填滿未讀 pipe 而卡住。

代表截圖由測試保存在 repo 外：`/tmp/carlacademy-ticket08-evidence/`（雙 base／尺寸／外觀文章開場及文字放大），`/tmp/carlacademy-ticket08-elb-*.png`、`/tmp/carlacademy-ticket08-closing-*.png`，並沿用各測試的表格、程式碼、面板與搜尋截圖。主題說明的卡片（含無 JS）與比較截圖位於 `/tmp/carlacademy-review-{root|academy}-{topic}-{light|dark}-{js|nojs}-{cards|comparison}.png`，由表格測試產生；已檢視兩種 base 的無 JS 卡片與比較畫面。這些是可重建的本機證據，不是永久發布資產。

## 剩餘範圍

- macOS headless Chromium 的原生 select 未對 Arrow／Home／End 事件切換選項；其鍵盤證據以 Latin typeahead 主題導航與上述原生 Chrome 外觀選項操作補足，兩種操作方式分開記錄。
- 未執行 iOS Safari、Android Chrome 實機、原生 200% 文字縮放或真人試讀。Chromium 的 viewport 與外觀模擬不能代替上述證據。
- 目前框線圖沿用既定過渡呈現，未全面重繪 SVG；工具選型仍見 [網站設計](site-design.md)。
- 託管平台、網域、部署與實際發布未指定或執行。


## 獨立審查與結案

固定初審範圍為 `ec97d90...5a7a549`；四項 findings 已在單一修正 worktree 處理。最終複審只看 `5a7a549...c4825d8039f7b4ad1e072c3ebb94408c7d39b09f` 與受影響呼叫端，兩位審查者均回報無剩餘 findings：

- Standards：舊版未使用 CSS、重複測試 helper 均已解決。
- Spec：主題頁八張表格的卡片／比較工具、五個主題標題原始錨點均已補足。

兩次複審皆在來源快照不變時完成；審查者以唯讀方式檢查程式與既有 70 頁產物，沒有重新執行會寫入產物的測試。完整 24／24 測試由實作工作樹執行，合併後已確認完整 tracked tree 相同（`c9fb7317bf9b464c5b63263a329d09623ec73a9b`），並序列重跑 root check／build／diff check。最終結案只更新本機 tracker 與此紀錄，產品程式及測試保持複審版本不變。
