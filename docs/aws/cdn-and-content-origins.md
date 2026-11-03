# CDN 與內容來源

一個網站可以由 S3 保存圖片與程式檔，再由應用伺服器產生 API 回應；使用者卻透過同一個 CloudFront 網域存取兩者。**CloudFront 負責傳遞與快取回應，origin（來源）負責提供內容；選擇來源、限制來源入口、授權讀者及更新內容，是相互連接但不同的工作。**CloudFront 支援 S3 bucket 與 ALB 等來源，見 [CloudFront 來源類型](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html)。

查證日期：2026-11-02。本文僅查閱 AWS 官方文件，未登入 AWS、建立 bucket 或 distribution、套用政策、執行 AWS CLI／SDK／API、向範例服務發送 HTTP 請求或進行部署實測。下文網站、路徑與設定皆為假想教學情境，不能視為已驗證的部署組態。

CloudFront 與 ELB 的基本產品概念、cache key 與 TTL 的完整分工，先看 [Elastic Load Balancing 與 CloudFront](load-balancing-and-cloudfront.md)；物件模型見 [S3、EBS 與 EFS](s3-ebs-and-efs.md)。本文聚焦它們接在一起後的資料與權限邊界。

## 同一個入口，兩種來源

假設課程網站有以下需求：公開的圖片與前端檔案放在 S3；登入會員的課程進度由 API 程式產生。這裡選擇 **S3 general purpose bucket 的 REST 端點**與**受限的 internet-facing ALB**，不使用 S3 website endpoint；私有 ALB 的 VPC origin 留在後文比較。

| Viewer 請求 | 假想來源 | 本文的處理意圖 |
| --- | --- | --- |
| `/assets/*` | S3 REST origin，bucket 維持私有，搭配 OAC | 公開靜態檔案可由 CloudFront 快取，S3 不提供匿名直連讀取 |
| `/api/*` | 受限公開 ALB，再轉送 API targets | 會員資料停用 CloudFront 快取，來源仍驗證使用者與資料權限 |
| 其餘路徑 | Default behavior 指向同一 ALB | 由應用回覆網站頁面或拒絕不存在的路徑；本例同樣停用快取 |

這是編輯安排。CloudFront 的 cache behavior 依路徑模式順序比對，第一個匹配者決定來源及規則，最後才使用 default behavior。建立兩個 origins 並不會自動依內容分流，還要有對應 behaviors；path pattern 也不是應用授權規則。見 [Cache behavior settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html)。

```text
瀏覽器：同一個 CloudFront 網域
             │ HTTPS
             ▼
CloudFront：比對 behavior，執行 viewer 存取規則
   │
   ├─ /assets/* → 查可重用快取
   │                 ├─ 命中 → 回覆瀏覽器
   │                 └─ 需要來源 → HTTPS＋OAC 簽章
   │                                      ▼
   │                                私有 S3 bucket
   │                                REST 端點／物件
   │
   └─ /api/* → 本例停用快取 → HTTPS＋秘密來源標頭
                                          ▼
                                   受限公開 ALB
                                          ▼
                                  API target／應用授權
```

圖省略 DNS、regional edge cache 等中間環節；POP 未命中不代表一定立刻連到來源，中間快取仍可能滿足請求。見 [How CloudFront delivers content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HowCloudFrontWorks.html)。

### 靜態檔案：命中時不必讀取 S3

假設 viewer 請求 `/assets/app.a1b2.js`，且 S3 中的物件 key 是 `assets/app.a1b2.js`；本例沒有額外 origin path 或路徑改寫。若 CloudFront 有符合 cache key 且可重用的回應，便回覆快取內容；若需要來源，則向 S3 取回物件，再依政策保存與傳遞回應。過期副本也可能先向來源重新驗證，而不是每次都重傳整份內容。見 [內容傳遞流程](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HowCloudFrontWorks.html)與 [Cache expiration](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)。

因此，S3 保存來源物件，CloudFront 保存可重用的回應副本。**覆寫 S3 物件、移除 CloudFront 副本及修改網頁中的引用，不是同一筆共同交易。**這是依官方的來源更新與快取流程整理的邊界：來源改了，尚未失效的邊緣副本仍可能回覆舊內容。見 [Update existing content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/UpdatingExistingObjects.html)。

### API：經過 CDN，也可以每次都到來源

本例 `/api/progress` 是個人資料，選擇 AWS managed cache policy **CachingDisabled**，其 Minimum、Default、Maximum TTL 都是零。正常請求不會由 CloudFront 重用這份會員回應，而會經 ALB 交給應用。這是本例刻意停用快取，不能推論所有 API 都不能快取。見 [Managed cache policies：CachingDisabled](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)。

停用快取還不夠：來源需要的認證、cookie、query string 與其他資訊，也須正確轉送。Origin request policy 可以轉送未加入 cache key 的資訊；所以「來源收到登入 cookie」並不保證快取按使用者區分。若未來要快取公開 API，須重新檢查哪些輸入會改變回應。見 [Control origin requests with a policy](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/controlling-origin-requests.html)。

尤其 **Minimum TTL 大於零時，即使來源帶有 `private`、`no-store` 或 `no-cache`，CloudFront 仍至少快取該期限**。不能僅靠應用回應標頭判斷個人內容是否安全；詳細政策分工回看[核心篇](load-balancing-and-cloudfront.md)，HTTP 共通限制見[快取與條件請求](../api/caching-and-conditional-requests.md)。此例涉及的產品行為見 [Cache expiration 警告](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)。

## S3 REST origin：OAC 讓來源維持私有

**Origin access control（OAC）**讓 CloudFront 向 S3 發送經驗證的來源請求；AWS 建議新設定使用 OAC，而非舊的 OAI。本文只討論一般 S3 bucket origin，沒有把 access point、Multi-Region Access Point 等其他入口混入同一設定。見 [Restrict access to an Amazon S3 origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)。

本例需一起理解三個條件：

- **簽章**：選擇 OAC 的 always sign requests，CloudFront 到 S3 使用 HTTPS；不能把未簽章等其他選項也當作同一保證。
- **Bucket policy**：允許 CloudFront service principal 讀取必要物件，並以 `AWS:SourceArn` 條件限縮至指定 distribution；本例只有讀取需求，不應順手給予寫入或刪除權限。
- **物件與金鑰**：Object Ownership 採 Bucket owner enforced；若來源物件使用 SSE-KMS，還須在 KMS key policy 給該 distribution 所需權限，不能只處理 S3 政策。

上述條件見 [OAC prerequisites、bucket policy 與 SSE-KMS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)。這裡只描述權限意圖，不提供真實帳號、distribution ARN、金鑰或可直接套用的政策。

這條路徑不需要把 bucket 或物件改成公開，也不需要為了 CloudFront 放寬 S3 Block Public Access。OAC 的授權是對指定 CloudFront 來源存取開放，與匿名讀取不同；仍須檢查是否存在其他另行授權的入口。見 [OAC 來源限制](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)與 [S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)。

### Website endpoint 是另一種來源

S3 REST 端點與 static website endpoint 不可互換：

| 邊界 | 本例的 S3 REST origin | S3 website endpoint |
| --- | --- | --- |
| CloudFront 中的來源型態 | S3 bucket origin | Custom origin |
| OAC／OAI | 可使用，本例選 OAC | 不能使用 |
| CloudFront → S3 的 HTTPS | 本例以 OAC always sign 使用 HTTPS | Website endpoint 不支援 HTTPS |
| 網站入口語意 | 取得指定物件，不自動等同網站託管功能 | 提供網站 index、重新導向及網站錯誤文件等功能 |

來源型態與網站功能見 [Use S3 origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html)，OAC 邊界見 [OAC notes](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)，端點與 HTTPS 差異見 [S3 website endpoints](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteEndpoints.html)。

即使 viewer 到 CloudFront 使用 HTTPS，website endpoint 那一段仍不能使用 HTTPS；CloudFront 沒有替端點增加它不支援的協定。需要私有 bucket 與 OAC 時，應先確認選的是 REST origin，而非把 website endpoint 加入後再嘗試套用 OAC。見 [HTTPS for custom origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-cloudfront-to-custom-origin.html)。

## ALB：防止繞過 CloudFront，不等於會員授權

本文選的 ALB 仍是 internet-facing：把網站 DNS 指向 CloudFront，不會關閉 ALB 原有入口。依 AWS 的受限公開來源模型，可讓 CloudFront 在來源請求加入秘密自訂 HTTP 標頭，ALB listener 只轉送符合標頭的請求，其餘以固定拒絕回應處理；來源連線使用 HTTPS，且須有相符的有效憑證。秘密標頭名稱與值應視同憑證保護並輪替。見 [Restrict access to Application Load Balancers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html)與 [HTTPS origin certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-cloudfront-to-custom-origin.html)。

還可讓 ALB security group 只接受 CloudFront 的 AWS-managed origin-facing prefix list，以限制網路來源。但這份 prefix list 代表 CloudFront 來源網路，**不能單獨證明請求來自本站指定的 distribution**；這是由其網路範圍推得的限制。秘密標頭也依賴保密，洩漏後可被偽造。兩層限制都不會判斷會員是否能讀取某筆課程進度。見 [ALB 來源限制與 prefix list](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html)。

另一條路是使用 **VPC origin**，將 ALB 放在私有子網路，讓 CloudFront 經私有連線連到來源。這與上述公開 ALB 加入口限制是不同方案，不是在普通公開來源旁勾一個選項就完成；仍有支援 Region、VPC、服務管理 ENI 與 security group 等前提，應依實際文件核對。本文未設計這條路徑的部署組態。見 [Restrict access with VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)。

私有連線解決來源暴露邊界，應用仍須驗證使用者與資料權限。這是網路與應用授權分工的推論，不是 VPC origin 自動提供的會員系統；相關觀念見 [VPC 與資源連線](vpc-and-resource-connectivity.md)及 [IAM 的身分與權限](iam-identities-and-permissions.md)。

## Viewer 授權與來源授權分開設計

假設網站新增付費下載檔案，S3 bucket 私有並搭配 OAC，仍不能推論「只有付費會員可透過 CloudFront 下載」。OAC 處理 **CloudFront → S3**；讀者能否使用 CloudFront URL，屬於 **viewer → CloudFront** 的另一個邊界。可用 CloudFront signed URL 或 signed cookie 限制讀者存取：單一下載檔案常適合 signed URL，多個受限檔案或不想改動現有 URL 時可考慮 signed cookie。見 [Choose signed URLs or signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-choosing-signed-urls-cookies.html)與 [OAC 來源存取](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)。

應用先判斷會員是否有資格，再簽發帶有效期間等限制的 URL；CloudFront 使用 trusted key group 中的公開金鑰驗證簽章。這些 viewer 簽章與 OAC 的來源請求簽章用途不同，也不是把 S3 presigned URL 改個網域。對受限檔案的 GET／HEAD，即使回應可由快取提供，仍須符合 viewer 存取規則；不能只在回源時檢查讀者資格。見 [How signed URLs work](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html)。

## 更新內容：先準備來源，再改引用

假設目前 HTML 引用 `/assets/app.a1b2.js`，新版本要改成 `/assets/app.c3d4.js`。AWS 建議以檔名或目錄中的版本識別碼區分內容，並更新引用；這種 **versioned file name** 與 S3 Object Versioning 是不同機制，啟用 bucket 版本保存不會自動改變 viewer 請求的 URL。見 [Update existing files using versioned file names](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/UpdatingExistingObjects.html)。

依這個模型，本例採以下發佈順序；這是教學推演，未實際執行：

1. 先將新 JS、CSS、圖片等完整放入來源，使用新檔名，不覆寫仍有人引用的舊版本。
2. 確認新資產可由預期路徑取得之後，再更新 HTML 或 manifest 的引用。
3. 讓 HTML／manifest 使用符合更新需求的快取期限；新資產則可有不同期限。
4. 保留舊資產一段由應用需求決定的時間，讓舊頁面、既有工作階段及回復版本仍能載入相依檔案。

先備資產再切引用、保留舊檔，是由官方的版本檔名與多層快取模型推得的安排；**不代表全球瀏覽器與邊緣節點在同一瞬間原子切版**。HTML 可能仍在瀏覽器或代理快取中，並繼續要求舊資產。見 [Versioned file names](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/UpdatingExistingObjects.html)與 [Invalidation and versioning](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)。

若必須沿用同一 URL，可在更新來源後，對 CloudFront 執行 **invalidation（失效處理）**，使後續需要該內容的請求重新向來源取得。Invalidation 不會替你上傳新來源，也不會清掉瀏覽器或公司代理的副本；若先失效、來源卻仍是舊檔，後續回源仍可能拿到舊內容。見 [Invalidate files to remove content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)。

TTL 則控制既有副本何時需重新確認新鮮度；來源 `Cache-Control` 與 CloudFront cache policy 要協調，瀏覽器與 CDN 也可有不同保存期限。它不是內容發佈交易，更不是刪除來源後就立即撤回所有已傳出的副本。刪除 S3 來源內容後，CloudFront 仍可能在副本過期前繼續回覆；若涉及敏感內容撤回，須一併考慮入口授權與其他已取得的副本。見 [Cache expiration](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)及 [Remove content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/UpdatingExistingObjects.html)。

## 相關文件

- [AWS 知識索引](README.md)：回查服務定位與閱讀入口。
- [Elastic Load Balancing 與 CloudFront](load-balancing-and-cloudfront.md)：服務核心、cache key、TTL 與連線分工。
- [S3、EBS 與 EFS](s3-ebs-and-efs.md)：物件來源與其他儲存介面的差異。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：理解有效政策與權限邊界。
- [VPC 與資源連線](vpc-and-resource-connectivity.md)：私有子網路、路由與 security group。
- [快取與條件請求](../api/caching-and-conditional-requests.md)：HTTP 新鮮度、重新驗證與共用快取的共通語意。
