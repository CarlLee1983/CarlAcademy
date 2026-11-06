# 首版靜態網站驗收

2026-11-03；來源為整合基準 `4805ec01ddf1d364d1a22ffab8229f886f3ad574`（tickets 01–07）加本次 ticket 08 變更。本次 code-review 修正以 `5a7a5496c53cfd8c6696e65bf9e56c4636d1adab` 為基準，補足主題表格與標題錨點，移除舊樣式並沿用共用測試 helper。修正後已完成兩軸獨立複審；此紀錄描述本機正式產物，不代表已發布。

環境：macOS arm64、Node.js 24.21.0、Python 3.9.6、Playwright 1.64.1 的 headless Chromium 156.0.8078.4；當時依賴由 `package-lock.json` 固定；目前已改用 `pnpm-lock.yaml` 與 pnpm 12.0.0。下方 npm 指令及 24 個測試結果是首版歷史證據，最新重跑請使用本節 pnpm 指令。沒有使用 Astro 開發伺服器替代產物驗收。

## 重跑

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run verify
```

只重跑整合巡檢：`pnpm run test:focused tests/integration.test.mjs`。測試在隔離暫存副本建置，掛載至 Python `http.server`；子路徑不是搬移根路徑產物。各測試使用哪份內容與 base，見下方「[測試分層](#測試分層2026-11-04)」。手動預覽命令見 [README](../README.md#本機建置與驗證)。

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

以下首版截圖描述 2026-11-03 的測試；2026-11-04 精簡後，雙 base／外觀的文章開場截圖、ELB／closing 截圖與表格比較截圖已不再產生，現行測試只保留 200% 文字縮放等少數截圖。代表截圖由測試保存在 repo 外：`/tmp/carlacademy-ticket08-evidence/`（雙 base／尺寸／外觀文章開場及文字放大），`/tmp/carlacademy-ticket08-elb-*.png`、`/tmp/carlacademy-ticket08-closing-*.png`，並沿用各測試的表格、程式碼、面板與搜尋截圖。主題說明的卡片（含無 JS）與比較截圖位於 `/tmp/carlacademy-review-{root|academy}-{topic}-{light|dark}-{js|nojs}-{cards|comparison}.png`，由表格測試產生；已檢視兩種 base 的無 JS 卡片與比較畫面。這些是可重建的本機證據，不是永久發布資產。

## 剩餘範圍

- macOS headless Chromium 的原生 select 未對 Arrow／Home／End 事件切換選項；其鍵盤證據以 Latin typeahead 主題導航與上述原生 Chrome 外觀選項操作補足，兩種操作方式分開記錄。
- 未執行 iOS Safari、Android Chrome 實機、原生 200% 文字縮放或真人試讀。Chromium 的 viewport 與外觀模擬不能代替上述證據。
- 目前框線圖沿用既定過渡呈現，未全面重繪 SVG；工具選型仍見 [網站設計](site-design.md)。
- 真實內容在 1440px 桌面寬度下，118 篇文章中有 13 篇正文起點超過 610px（最高 661.67px，例如 `aws/kms-secrets-manager-and-parameter-store`、`relational-databases/jsonb-and-semi-structured-data`），精簡前即存在。610px 原本只對 ELB／CloudFront 兩篇驗收，是否適用全部文章、要調整版面或門檻，尚未決定。
- 正式網域已指定為 `https://academy.gravito.dev/`；部署與實際發布尚未執行。


## 獨立審查與結案

固定初審範圍為 `ec97d90...5a7a549`；四項 findings 已在單一修正 worktree 處理。最終複審只看 `5a7a549...c4825d8039f7b4ad1e072c3ebb94408c7d39b09f` 與受影響呼叫端，兩位審查者均回報無剩餘 findings：

- Standards：舊版未使用 CSS、重複測試 helper 均已解決。
- Spec：主題頁八張表格的卡片／比較工具、五個主題標題原始錨點均已補足。

兩次複審皆在來源快照不變時完成；審查者以唯讀方式檢查程式與既有 70 頁產物，沒有重新執行會寫入產物的測試。完整 24／24 測試由實作工作樹執行，合併後已確認完整 tracked tree 相同（`c9fb7317bf9b464c5b63263a329d09623ec73a9b`），並序列重跑 root check／build／diff check。最終結案只更新本機 tracker 與此紀錄，產品程式及測試保持複審版本不變。


## SEO 與社群分享追加驗收（2026-11-03）

新增 `tests/seo.test.mjs`，對兩種 base 的所有公開頁面檢查摘要、canonical、Open Graph／X 卡片、JSON-LD 與 sitemap 一致性、PNG 圖片尺寸，並驗證無網域預覽與錯誤網域設定。`tests/share-tools.test.mjs` 在一般 HTTP 產物上驗證手機深色／桌面淺色、鍵盤複製、原生分享成功／取消／失敗、剪貼簿失敗與不存在、無 JS 平台連結、canonical 及 query／hash 清理。

原生分享及剪貼簿結果以瀏覽器 API mock 驗證，不代表 iOS／Android 分享面板或各社群平台已驗收。正式網域尚未發布，本機檢查不能證明搜尋收錄或平台預覽快取結果；建置與部署設定見 [README](../README.md#seo-與社群分享)。

## 測試分層（2026-11-04）

依 [測試套件精簡規格](../.scratch/test-suite-slimming/spec.md) 調整驗證方式；上方首版覆蓋表格保留為歷史證據，驗收範圍不變。來源為 `test/slim-suite` 整合分支（code review 修正後的最終提交）。

分層原則（刻意的取捨，不是遺漏）：

- **每項行為只在一處驗證**，用最便宜而可信的層級：HTML 層檢查 → 範例內容建置 → 瀏覽器 E2E。手機章節面板、表格鍵盤切換、無 JS 表格卡片與錯誤碼搜尋導向各只留一處；元件測試不再重複整頁溢出與字型載入斷言。
- **只有三個檢查使用完整真實內容**：全部公開頁面 HTTP 開啟、搜尋索引等於公開清單、首頁、全部主題索引與全部文章在兩種 base × 390／1440 下不溢出且自行託管字型載入，並在兩種 base 經網站搜尋介面與主題切換驗證執行期 base（`tests/integration.test.mjs`）；全站 SEO 與網站地圖（`tests/seo.test.mjs`）；每篇公開文件有單一 H1 與正文，導覽順序等於主題索引的建議閱讀順序，每個主題索引標題的錨點 id 與產品使用的 `github-slugger` 一致（`tests/site.test.mjs`）。
- **其餘測試使用手寫的範例內容**（`tests/fixtures/docs/`，每個檔案開頭註明觸發的網站功能）；範例沒有的主題自動補最小主題索引與一篇最小文件，因為主題頁需要至少一篇文件作為閱讀起點。預期值從範例內容與產品的主題定義讀出，不寫死真實文章。
- **介面行為只在子路徑 `/academy/` 驗證**。base path 由三處負責：每次建置都執行的輸出驗證器、`tests/site.test.mjs` 的直開／重新整理／內部文件 404（兩種 base）、整合巡檢（兩種 base）。
- **配色只在外觀測試切換**：整合巡檢與表格、程式碼工具、文章、閱讀導覽、閱讀設定預覽等元件測試只跑淺色；這些元件斷言只量排版與行為，外觀切換由 `tests/appearance.test.mjs` 驗證。
- **不再產生首版的人工檢視截圖**（ticket 04／05／06／08 的文章開場、表格比較、程式碼、面板與搜尋截圖）；它們是當時人工檢視的依據，不是斷言。需要重新人工檢視時，另行產生。
- **輸出驗證器的拒絕規則在 HTML 層驗證**（`tests/verify-output.test.mjs`，對手寫的產物目錄呼叫 `verifyOutput`，涵蓋全部拒絕規則與兩種 base）；建置階段的拒絕（缺少 H1、公開網址衝突、文件未列入主題索引）仍以修改範例內容後建置失敗驗證，同時證明檢查接在建置流程中。
- 測試前由 suite 一次準備四份共用 baseline：真實內容 `/`、真實內容 `/academy/`、範例內容 `/academy/`（預設網域）與範例內容 `/academy/`（`SITE_URL` 為空）；建置一律不繼承呼叫端環境的 `SITE_URL`。範例內容屬於建置輸入，測試期間變更仍會使結果失效。
- **桌面正文起點 ≤610px 只在範例文章驗證**：首版以 ELB／CloudFront 兩篇真實文章驗證；精簡後不再對真實長導言文章驗證，未決問題見「剩餘範圍」。

| 測試 | 內容與 base | 主要範圍 |
| --- | --- | --- |
| `tests/integration.test.mjs` | 真實內容，兩種 base；200% 模擬用範例 `/academy/` | 全部網址 200、Pagefind 索引等於公開清單、首頁／主題索引／全部文章 390／1440 淺色不溢出與字型、搜尋介面命中與主題切換選項的 base；200% 文字縮放下正文、跳至內容、外觀、搜尋與主題導覽可鍵盤觸及 |
| `tests/seo.test.mjs` | 真實內容，兩種 base；預覽用範例 `SITE_URL` 為空 | 全站摘要、canonical、Open Graph／X、JSON-LD、sitemap、社群圖片；無網域預覽與網域設定拒絕 |
| `tests/site.test.mjs` | 真實內容 `/`；範例 fixture | 每篇單一 H1 與正文、導覽順序；渲染範例、標題變更不改網址、直開與重新整理、主題標題錨點、同源資源 200、內部文件 404（兩種 base）；三種建置階段拒絕 |
| `tests/verify-output.test.mjs` | 手寫產物目錄 | 缺少目標、缺少段落與目錄網址錨點、內部來源、缺首頁、重複 id、部署路徑外與越界參照、缺目錄索引 |
| `tests/article.test.mjs`、`tests/appearance.test.mjs` | 範例 `/academy/` | 首頁與主題起點、閱讀順序、文件序號與前後篇、外觀切換、可見焦點、跳至內容；桌面正文起點 ≤610px、680px 正文、固定目錄、文末收尾帶；手機精簡開場 |
| `tests/tables.test.mjs` | 範例 `/academy/` | 無 JS 手機卡片與欄名；鍵盤切換、工具列不跳動；寬表格 680–880px 且只在自身捲動；主題索引收合區每張表格的卡片與切換工具（JS 開／關） |
| `tests/code-tools.test.mjs` | 範例 `/academy/` | 語言標籤、精確原文複製、超寬換行與尺寸切換可逆、捲動提示、失敗回饋；框線圖保留排版、無 JS 局部捲動 |
| `tests/reading-navigation.test.mjs`、`tests/reading-settings.test.mjs` | 範例 `/academy/` | 固定目錄、目前段落與進度；手機章節面板（唯一一處）；閱讀設定的保存、鍵盤、毀損值復原、儲存遭拒與無 JS |
| `tests/search.test.mjs` | 範例 `/academy/` | 中文標題與正文、英文詞、主題標籤、零結果、安全文字、過期查詢；首次模組與索引失敗後重試及錯誤碼命中導向（唯一一處） |
| `tests/share-tools.test.mjs` | 範例 `/academy/`，兩種 `SITE_URL` | 複製乾淨網址、原生分享成功／取消／失敗、剪貼簿失敗與不存在、無 JS 平台連結與瀏覽器分享提示 |

首版覆蓋表格各列的去向：

| 首版列 | 現行位置 |
| --- | --- |
| `npm run build`、`tests/site.test.mjs` | 頁數、單一來源與閱讀順序、站內目標與錨點：每次建置的輸出驗證器與 `tests/site.test.mjs`（真實內容）；主題標題錨點與 fragment 導航、直開與重新整理、內部文件排除：`tests/site.test.mjs`（範例內容，兩種 base）；拒絕規則：`tests/verify-output.test.mjs` 與建置階段拒絕測試 |
| `tests/integration.test.mjs` | 同檔，真實內容；拿掉深色維度，增加首頁與主題索引頁 |
| `tests/article.test.mjs`、`tests/appearance.test.mjs` | 同檔，範例 `/academy/`；ELB／CloudFront 正文起點改由範例文章 A 驗證 |
| `tests/tables.test.mjs` | 同檔，範例 `/academy/`；主題索引表格以範例主題索引驗證 |
| `tests/code-tools.test.mjs` | 同檔，範例 `/academy/`；超寬程式碼與框線圖移入範例文章 A |
| `tests/reading-navigation.test.mjs` | 同檔，範例 `/academy/`；手機章節面板只在此驗證 |
| `tests/search.test.mjs` | 同檔，範例 `/academy/`；根路徑搜尋的執行期 base 由 `tests/integration.test.mjs` 驗證 |

本次結果：code review 修正後的最終版本 `pnpm run verify` 連續兩次 **56／56 通過**，牆鐘 60.6、57.9 秒（精簡前約 150 秒），macOS arm64 本機、無其他負載。CI 結果見整合分支的 PR。


## 教材圖解介面更新（2026-11-05）

- 對應設計：`docs/site-design.md` 的「現行設計」，v7 原型正式實作。保留淺色／深色／跟隨系統、現有 Pagefind 與全部閱讀工具。
- 最終功能來源：本輪未提交變更（基底 `e3073d8`）。`pnpm run verify` 成功：Astro **0 errors / 0 warnings / 0 hints**；**57 tests / 57 pass / 0 fail**。測試段約 79.2 秒；包含 137 個公開網址與 548 組頁面／尺寸／base 檢查。
- 新增外觀檢查：兩個代表 API 頁面的圖解可存取名稱、圖說、淺／深／系統切換與重新整理後文字對比至少 4.5:1；360／768／1440 寬的圖中文字至少 14px、文件標題點擊高度至少 44px；停用 JS 時圖解配色跟隨系統。
- 外觀測試新增部分使用真實 API 文件（原有基本外觀測試仍用範例），以覆蓋指定文章的概念圖。這是前述範例／真實內容分層的有界擴充。
- 代理畫面檢查：首頁、API 主題與代表文章，1440／390 寬、淺／深；另查 768 平板圖解。截圖與執行紀錄保存在 `~/Documents/design-experience/CarlAcademy/visual-language/prototypes/v7/production-shots/`。
- 修正過的回歸：正文起點超過 610px、表頭分隔由 2px 變成 1px、平板圖解縮小、文件連結點擊高度不足。前兩項由既有測試抓出，後兩項由獨立唯讀審查指出；修正後針對性 7/7、完整 57/57 通過，複查沒有剩餘 material findings。
- 已知測試不穩定：完整驗證有一次在 200% 模擬中，原生主題選單輸入 API 時跳到 AWS，導致等候網址逾時；未修改產品或放寬測試，原案例單獨重跑及後續完整驗證皆通過。保留這項時序現象，不把重跑當成已修復測試不穩定。
- 未執行正式部署、實機 Safari／Android 或真人長文試讀；桌面／手機結果來自 Chromium。沒有新增依賴。


## 首頁紙雕小卡上線（2026-11-06）

- 使用者接受 v10 並授權部署；首頁整合真實標題、篇數與首篇閱讀路徑，新增最佳化 WebP 圖集與首頁專屬樣式。
- `pnpm run verify`：57/57 通過，Astro 0 errors / warnings / hints；137 個公開網址、548 組尺寸／base 檢查。新增桌面字級、手機溢出／觸控目標、閱讀入口無下劃線及兩種 base 圖集載入檢查。
- 獨立唯讀複查修正舊大圖測試與搜尋結果下劃線後，沒有剩餘 material findings。瀏覽器人工確認候選首頁與搜尋，正式首頁已載入；手機尺寸由 Chromium 自動測試覆蓋，未聲稱實機驗證。
- 以 `SITE_URL=https://academy.gravito.dev BASE_PATH=/ pnpm run build` 建置；來源為基底 `e3073d84c5a6c487ce7368ed01120f2d8aba6254` 上的未提交工作。未 commit 或 push。
- Cloudflare `carlacademy` 正式網址：<https://academy.gravito.dev/>。版本 `93762a74-0b31-45ae-9542-81a716dfc111`，部署 `3f10a8ee-43a8-44fe-a68b-0ceb1f507927`，100% 流量。
- 候選與正式端均逐檔比對 339 個檔案／137 頁，SHA-256 `677c20732d40af1b70b0784ffdf35065743020d4ac003eda157fcaffba43c429`；內部文件與不存在路徑回應 404，無尾斜線網址正常轉址。正式驗證時間 `2026-11-06T02:11:07Z`。
- 封存產物、來源指紋、上傳／部署紀錄及 HTTP 驗證收據：`.wrangler/releases/carlacademy-home-cgq3t_i3/`（本機忽略目錄）。前版 `07a63098-f990-4411-aba9-a4fca0d7c6de` 保留供必要時回復；本輪未執行回復。
