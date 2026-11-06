# CarlAcademy

按主題整理工程與技術知識的公開文件，各主題由基礎概念逐步深入，持續累積與擴充。Linux 是其中一個主題；AWS 及其各項服務、網路、程式開發、資安與系統設計等，也可以各自整理成主題。

不限定程式語言或框架。API 等共通知識集中整理成完整主題，不同語言的實作範例連回同一套概念文件。

完整定位、內容組織與近期整理方向見 [現行規劃](PLAN.md)。

## 知識主題

- [Linux 知識索引](docs/linux/README.md)：已有索引所列的 16 篇文章，從系統與 Shell 基礎延伸至管理、儲存、效能、核心、容器隔離與 SSH 遠端連線邊界。
- [AWS 知識索引](docs/aws/README.md)：已有索引所列的 22 篇文章，涵蓋雲端基礎、代表服務（含 KMS／Secrets Manager／Parameter Store 與 SQS／SNS／EventBridge）與服務組合。
- [API 共通知識索引](docs/api/README.md)：已有 23 篇概念文章，涵蓋共通基礎、延伸議題（含身分授權、OAuth 2.0 許可模式、Token/JWT/JWKS 架構、微服務授權、細粒度 ReBAC 策略引擎、金融級 FAPI/DPoP、長時間操作與 Webhook 事件回呼）、HTTP、REST、gRPC 與 GraphQL；語言實作按需求補充。
- [關聯式資料庫索引](docs/relational-databases/README.md)：已有 13 篇文章，涵蓋資料模型、鍵與關聯、SQL、約束、正規化、交易隔離、索引、MVCC 與鎖定、結構演進與遷移、檢視表與觸發器、CTE 與視窗函數、JSONB 混合建模，以及分割表與連線資源管理；產品範例明示適用範圍。
- [Web 應用資安索引](docs/web-security/README.md)：已有 16 篇文章，涵蓋信任邊界、登入與 Session、存取控制、SQL Injection、XSS、CSRF、機密與敏感資料、檔案上傳、SSRF、第三方登入與 OIDC 身分聯邦、Passkeys 無密碼防釣魚（WebAuthn/FIDO2）、企業級 SSO/SAML 橋接與 SCIM 2.0 帳號配置、TLS 傳輸邊界、限流與配額防護，以及軟體供應鏈邊界。
- [電腦網路知識索引](docs/networking/README.md)：已有 16 篇文章，涵蓋封包交換與網路模型、IP 位址與 CIDR、路由轉送、TCP／UDP 傳輸、DNS 解析、TLS 1.2／1.3 安全傳輸、HTTP 協定演進（HTTP/1.1~HTTP/3 QUIC）、L4／L7 負載平衡與反向代理、網路診斷與 ICMP／tcpdump 觀測、NAT 穿透（STUN／TURN／ICE）、IPv6 架構與雙堆疊過渡、BGP 跨域路由與 Anycast、SDN 與 Overlay 虛擬化（VXLAN／Geneve）、零信任與 mTLS 雙向認證，以及 CDN 邊緣快取與動態傳遞架構。
- [分散式系統知識索引](docs/distributed-systems/README.md)：完整主線 18 篇已撰寫，從部分失敗、冪等、時鐘與多副本契約，深入共識、Raft、租約與分片，接續原子提交、Saga、Outbox／Inbox、CRDT、故障歷程驗證及文章匯出整合案例。
- [訊息佇列與事件驅動架構知識索引](docs/event-driven-architecture/README.md)：已完成 12 篇，從非同步工作邊界、命令與事件、傳遞模型與確認，深入並行順序、重試與死信、Outbox、Schema 演進、訂閱隔離、重播、觀測及多下游匯出整合。
- [快取與資料存取架構知識索引](docs/caching/README.md)：已完成主線 12 篇，涵蓋記憶體階層、讀寫模式（Cache-Aside 至 Write-Behind）、過期機制與 TTL 抖動、穿透／擊穿／雪崩防禦（空值快取、Bloom Filter、Mutex、Lease）、LRU 至 W-TinyLFU 逐出演算法、記憶體碎片與序列化、Redis 執行模型與資料結構、持久化複寫與 Cluster 槽位路由，以及雙寫一致性（CDC）與三層快取端到端實踐。
- [程式執行與並行處理知識索引](docs/concurrency/README.md)：已完成主線 12 篇，涵蓋程式執行本質與行程空間、Process vs Thread 排程與 Context Switch、協程與虛擬執行緒（M:N 排程）、CPU 快取階層與 MESI（False Sharing）、指令重排與 Happens-Before 記憶體模型、Mutex 與 Linux Futex、RWLock 與條件變數、死鎖防護與 Coffman 條件、CAS 原子操作與 ABA 防護、無鎖佇列與 Disruptor 環狀緩衝、I/O 多工模型演進（epoll 到 io_uring），以及生產環境執行緒池容量配置與背壓實務。
- [學習地圖知識索引](docs/roadmaps/README.md)：以端到端實踐目標串聯各領域技術，涵蓋架設網站從零到上線的完整里程碑、推薦技術棧與系統原理解析。

各主題可以獨立閱讀與擴充，不要求先學完 Linux 才閱讀其他內容。需要其他主題的背景知識時，以相關文件連結補充。

文件頁預設本文為 18px、行高 1.8；標題下方及手機閱讀列的「閱讀設定」可調整 16／18／20／22px 字級、標準／寬鬆行距，以及桌面 680／800px 欄寬。設定面板提供與正文同步的字級、行距預覽，桌面欄寬則套用於背景文章。設定立即套用並保存在目前瀏覽器，跨文件及重新整理沿用，可還原預設；瀏覽器無法儲存時，當頁仍可調整。字級隨瀏覽器根字級縮放；停用 JavaScript 時仍提供預設排版與原有內容導覽。

文件著重概念、原理與具體例子，依需要補上指令、圖解、常見問題與參考來源。每篇聚焦一個概念、服務或問題，讓讀者可以循序閱讀，也可以直接查找。

目前已實作靜態網站、教材圖解風格介面（保留淺色／深色／跟隨系統）、表格與程式碼閱讀工具、章節導覽、閱讀設定及全文搜尋，尚未發布。正式產物的驗收範圍與剩餘缺口見 [網站驗收紀錄](docs/site-validation.md)。先前學習產品方向的歷史紀錄與適用界線見 [現行規劃](PLAN.md#目前狀態與文件入口)。


## 本機建置與驗證

需要 Node.js 22.23.4 以上的受支援版本（本次驗證使用 Node.js 24.21.0）、pnpm 12.0.0 及 Python 3。`packageManager` 固定 pnpm 版本，`pnpm-lock.yaml` 是唯一依賴鎖檔。`pnpm-workspace.yaml` 僅對遷移前已使用的 `astro@7.4.5` 保留發佈等待期例外，其餘套件沿用 pnpm 預設規則。

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
python3 -m http.server 4321 --bind 127.0.0.1 --directory dist
```

開啟 `http://127.0.0.1:4321/`。建置從現有公開主題 Markdown 讀取內容，並檢查標題、網址衝突、閱讀順序、公開輸出、站內連結與段落錨點；任何檢查失敗皆以非零狀態結束。文章保留單一 H1 作為頁面標題，新文章須由所屬主題索引連結，網址由英文來源路徑推導。

開發時可使用 `pnpm run dev`；正式產物驗收使用上方的一般靜態伺服器，或 `pnpm run preview` 作人工預覽。

以子路徑建置時，base path 也會套用到連結與資源：

```sh
BASE_PATH=/academy/ pnpm run build
```

將輸出掛載在伺服器的 `/academy/` 下再開啟，例如：

```sh
site_preview=$(mktemp -d)
mkdir "$site_preview/academy"
cp -R dist/. "$site_preview/academy/"
python3 -m http.server 4321 --bind 127.0.0.1 --directory "$site_preview"
```

開啟 `http://127.0.0.1:4321/academy/`。這是不同的建置設定，不能把根路徑產物直接搬過去。`BASE_PATH` 使用 `/` 或由英文、數字、連字號及底線組成的路徑段。正式網域為 `https://academy.gravito.dev/`；尚未發布。

## SEO 與社群分享

正式網址預設為 `https://academy.gravito.dev/`，可在建置時以 `SITE_URL` 覆寫。此設定只接受 HTTP(S) origin；子路徑由 `BASE_PATH` 設定，不能放在 `SITE_URL` 中：

```sh
SITE_URL=https://academy.gravito.dev BASE_PATH=/academy/ pnpm run build
```

首頁、主題與文章各有摘要、canonical、Open Graph、X 卡片與 JSON-LD；文章與主題另有麵包屑結構化資料。摘要沿用 Markdown 第一段的首句，不另存重複內容。共用社群圖片為 `public/social-card.png`（1200×630），使用本站字型與配色；調整後以 `node scripts/generate-social-card.mjs` 重建，需已安裝 Playwright Chromium。

`sitemap.xml` 只包含公開首頁、主題與文章，不虛構更新日期。`robots.txt` 宣告 sitemap；部署至子路徑時，搜尋引擎只會讀取 origin 根目錄的 `/robots.txt`，需由託管端整合這段宣告。預覽若不應索引，請用 `SITE_URL='' pnpm run build`：頁面會帶 `noindex`，不產生 canonical、絕對圖片或 JSON-LD，sitemap 為空，robots 禁止抓取。正式發布應使用正確網址重新建置。

文章文末提供 LINE、Facebook、X、複製連結與支援裝置上的原生分享。停用 JavaScript 時仍可開啟平台分享連結；剪貼簿失敗時顯示可選取的完整網址。分享使用 canonical，不攜帶追蹤查詢參數與章節錨點。平台連結只在讀者點擊時開啟，不載入第三方 SDK。

全站分頁圖示為 `public/favicon.svg`，沿用鈷藍與幾何 C 識別，資源路徑支援 `BASE_PATH`。分享區以藍底複製按鈕與細線平台按鈕區分操作層次，支援淺深外觀、鍵盤焦點與手機換行；內嵌圖示採 Lucide，授權見 `public/licenses/lucide.txt`。

頁首品牌標誌為 `public/logo.svg`；首頁紙層插畫源檔為 `src/assets/knowledge-folio.png`（內建 imagegen 生成），由 Astro 輸出為 WebP，不呼叫外部圖片服務。插畫僅作品牌裝飾，與正文知識圖解分開。

本機測試驗證 metadata 與分享資料，未向社群平台實際貼文，也尚未驗證正式網域的爬蟲抓取、平台快取與搜尋收錄。

執行完整驗證（Astro 檢查、正式建置、產物測試與變更檔案的空白檢查）：

```sh
pnpm exec playwright install chromium
pnpm run verify
```

`verify` 依序執行檢查、從同一份來源快照各建置一次根路徑與 `/academy/`，再讓未修改來源的正向測試共用這兩份不可變產物。每個瀏覽器案例使用隔離的 HTTP 副本與瀏覽器狀態；修改來源的回歸案例仍各自建置。驗證與獨立的 `check`、`build`、`test` 使用工作區鎖，重疊執行會直接失敗，避免共享建置目錄互相覆寫。

測試以正式建置及一般 Python HTTP 伺服器為邊界，包含根路徑與 `/academy/`、實際公開清單、全部文章的手機／桌面與淺／深外觀、全文搜尋與失敗重試、表格／程式碼工具、閱讀導覽、鍵盤及停用 JavaScript。錯誤標題、網址衝突、壞連結、壞錨點及漏列文章的回歸案例使用隔離副本，不修改原始文件。200% 文字縮放為 CSS 模擬；實機及真人試讀尚未執行。

只重跑整合巡檢：

```sh
pnpm run test:focused tests/integration.test.mjs
```

`pnpm test` 會準備兩份 baseline 並執行全部測試；`test:focused` 只執行指定檔案，正向案例在沒有 suite 產物時自行建置隔離副本。只做空白檢查可執行 `pnpm run check:diff`，涵蓋未暫存、已暫存及未追蹤的新文字檔；不會修改檔案或安裝 hooks。

GitHub Actions 在 `main` 的 push 與所有 pull request 上執行 `pnpm install --frozen-lockfile`、安裝 Chromium 與系統依賴，再執行 `pnpm run verify`，空白檢查比較 PR base 或 push 前的版本，亦檢查工作目錄。工作流程使用 Node.js 24.21.0、固定官方 actions SHA 與唯讀 repository contents 權限，不發布網站。

工具版本、各測試涵蓋範圍與未驗證項目見 [網站驗收紀錄](docs/site-validation.md)。

目前建站依據為 [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/) 與 [Markdown 處理器文件](https://docs.astro.build/en/guides/markdown-content/)。採 Unified 管線整合相對連結轉換、CJK 粗體及 GFM；關閉單波浪刪除線，避免數字範圍被誤渲染。Cheerio 用於建置後 HTML 檢查，Playwright 用於靜態網站的瀏覽器驗收；Node 內建 test runner 執行測試，版本由 lockfile 固定。
