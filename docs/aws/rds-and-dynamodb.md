# RDS 與 DynamoDB

網站需要保存文章標題、作者與發布時間時，可以把資料交給託管資料庫，但仍須決定如何組織與查詢。
**Amazon RDS 提供託管關聯式資料庫；Amazon DynamoDB 提供託管的鍵值與文件資料模型。**
兩者的差別不只是「有沒有伺服器要管」，也包括資料如何被辨認、查詢如何表達，以及應用要承擔哪些設計工作。
見 [RDS 導論](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)與 [DynamoDB 導論](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)。

本文只補足理解這兩項服務所需的資料模型背景，不是完整的資料庫設計或 SQL 教程。
共通原理與自創 SQL 範例見[關聯式資料庫索引](../relational-databases/README.md)。
可先讀 [AWS 與使用者的責任](shared-responsibility.md)，理解託管服務的管理邊界。

查證日期：2026-11-02。僅查閱 AWS 官方文件，未登入 AWS、建立資料庫、執行 SQL、呼叫 DynamoDB API，亦未實測備份、效能或故障切換。
下文文章網站與資料均為本站自訂的假想例子，不是 AWS 官方範本或選型建議；本文不列費率與硬性配額。

## RDS：託管的是資料庫平台，資料設計仍由應用負責

關聯式資料庫以表格的列與欄組織資料，用 schema 定義結構、型別與約束，透過鍵建立資料關係。
SQL 用來表達查詢與資料修改；交易（transaction）把一組操作放進共同的提交或回復邊界。
例如文章與作者分表後，可以依作者識別碼建立關係，再查詢作者所寫的文章。
這裡只建立閱讀定位，交易隔離與約束的具體行為仍須看所選引擎。
見 [AWS：What is a Relational Database?](https://aws.amazon.com/rds/what-is-a-relational-database/)。

RDS 提供不同的資料庫引擎（DB engine），例如 PostgreSQL、MySQL、MariaDB、Oracle Database、Microsoft SQL Server 與 IBM Db2。
**RDS 不是一種新的 SQL 方言**；引擎決定 SQL、驅動程式與許多資料庫功能，功能支援也受版本及 Region 影響。
DB instance 是託管的資料庫環境；instance class 表示其運算與記憶體容量，不等於一張資料表或一個使用者建立的 database。
見 [RDS：DB engines、DB instances 與 instance classes](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)。

AWS 處理一般 RDS 的底層主機、OS 與資料庫軟體維護，客戶仍負責 schema、查詢與索引設計、應用相容性、資料及存取設定。
查詢調校明確屬於客戶責任，見 [RDS shared responsibility model](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)。
維護也有客戶決策：需要理解待套用更新、維護時段及版本變更對應用的影響；部分維護可能中斷服務，維護時段也不是作業完成時間的保證。
見 [Maintaining a DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Maintenance.html)。
本文以一般 RDS 說明，不將 RDS Custom 的管理方式視為相同。

## Instance、cluster、備援與讀取副本分開看

看到 cluster 一詞，不能推定所有 RDS 引擎都有相同拓樸與資料複寫方式。
以下整理的是不同機制的用途，不表示每個引擎、版本與 Region 都支援全部選項。

| 機制 | 主要用途與邊界 |
| --- | --- |
| Multi-AZ DB instance deployment | primary 與另一個 AZ 的 standby 提供故障切換；standby 不接受讀取流量 |
| Multi-AZ DB cluster deployment | writer 與分散在其他 AZ 的 reader instances 組成部署；reader 同時可服務讀取並支援故障切換 |
| DB instance read replica | 從來源非同步複寫，將適合的讀取負載導向副本；可能讀到尚未跟上來源的資料 |
| 備份與 PITR | 保存復原所需資料，以復原至備份或可用時間點；不是持續服務的 reader |

Multi-AZ 兩類部署見 [Configuring and managing a Multi-AZ deployment](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html)，
cluster 支援範圍與結構見 [Multi-AZ DB cluster deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html)。
讀取副本的非同步複寫與引擎差異見 [Working with DB instance read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)；
例如 Db2 standby mode、Oracle mounted mode 的副本不接受使用者連線，不能一概視為可讀。
備份定位見 [RDS：Introduction to backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)。

Amazon Aurora 也有 DB cluster，但它由 DB instances 與跨 AZ 的 cluster volume 組成；writer 與 Aurora readers 存取相同的 cluster storage。
即使只有一個 DB instance，Aurora 仍可稱為 cluster。不能把這種儲存架構套用到所有 RDS instance 或 Multi-AZ cluster。
見 [Amazon Aurora DB clusters](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.html)。

因此，規劃時要把三件事分別說清楚：**高可用性如何切換、讀取如何分攤、資料如何復原**。
讀取副本不會替所有寫入擴充容量；即使可以提升副本作為復原手段，也仍須安排應用連線與切換流程。
這是依 [RDS read replica 用途與運作方式](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)整理的區分。
Multi-AZ 與跨 Region 的位置差異，見 [Region 與 Availability Zone](regions-and-availability-zones.md)。

## DynamoDB：從存取模式設計鍵與索引

DynamoDB 不要求客戶建立與維護資料庫伺服器，也不提供讓客戶登入的底層 OS。
它支援 key-value 與 document 模型；沒有關聯式資料庫的 JOIN operator，但不能因此推論 NoSQL 沒有資料結構或交易能力。
見 [What is Amazon DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)。

理解資料時先分清楚三個名詞：table 是 item 的集合；item 是一筆可辨認的資料；attribute 是 item 的欄位，可包含巢狀文件資料。
除了主鍵外，不必預先宣告所有 attribute 與型別，每筆 item 可以有不同 attributes。
這種彈性不會替應用決定必填欄位、資料意義或版本相容規則。
見 [Core components：Tables, items, and attributes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html)。

每張 table 都需要主鍵，有兩種形式：

- **只有 partition key**：其值唯一辨認 item。
- **Partition key 加 sort key**：兩者組合唯一；不同 item 可以共享 partition key，但 sort key 必須不同。

Partition key 的值會參與內部雜湊，影響資料分區；sort key 讓相同 partition key 的資料按鍵值排序。
這些鍵不是 S3 路徑、資料夾或檔案名稱；即使用 `ARTICLE#42` 這類字串，也只是應用選定的 attribute 值。
主鍵規則見 [DynamoDB：Primary key](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html)。

**存取模式（access pattern）是「用哪些已知條件，取得哪些資料」**。
DynamoDB 的 `Query` 需要指定一個 partition key 值，再用可選的 sort key 條件縮小範圍；它不是任意 SQL 條件的同義詞。
見 [Querying tables in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html)。
AWS 的建模範例也按存取模式安排資料與索引，見 [Example of modeling relational data in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-modeling-nosql-B.html)。

需要其他查詢入口時，可以使用 secondary index：GSI 可使用不同於基表的 partition key 與 sort key；LSI 保留基表的 partition key，改用另一個 sort key。
索引會投影所需 attributes，並由 DynamoDB 維護，仍有儲存與更新等資源影響。
GSI 的 global 指橫跨基表的資料分區，**不表示跨 Region 複寫**；跨 Region 功能稱為 global tables。
索引定義見 [Improving data access with secondary indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/SecondaryIndexes.html)，
global table 定義見 [How DynamoDB global tables work](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables_HowItWorks.html)。

## 一致性與交易：要看操作及資料來源

Eventually consistent read 可能尚未反映剛完成的寫入；strongly consistent read 則反映先前成功寫入的最新資料。
DynamoDB 的一般讀取預設採 eventual consistency；支援的讀取操作可以用 `ConsistentRead` 要求強一致性，但範圍有別：

| 讀取來源 | 一致性定位 |
| --- | --- |
| 基表、LSI | 可選 eventual 或 strong consistency |
| GSI、DynamoDB Streams | 讀取為 eventual consistency，不能要求 strong consistency |
| Global table | 還須辨認 MREC 或 MRSC 模式，不能只看是否設定 `ConsistentRead` |

定義與一般讀取範圍見 [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)。

Global tables 的 **MREC**（multi-Region eventual consistency）模式在 Region 之間非同步複寫；本地 strong read 不保證看到剛在另一個 Region 完成的寫入。
**MRSC**（multi-Region strong consistency）模式則在成功回應寫入前同步複寫至另一個 Region，對 replica 的 strong read 提供跨 Region 的最新 item 視圖。
MRSC 有自己的部署及功能限制，GSI 讀取仍是 eventual consistency。
因此，「DynamoDB 全部最終一致」與「global table 全部跨區強一致」都不正確。
見 [Global tables：Consistency modes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables_HowItWorks.html)。

DynamoDB 也支援 `TransactWriteItems` 與 `TransactGetItems`，將多項操作放在全有或全無的交易中；其目標表須位於同一帳戶與 Region。
交易不是任意批次請求的自然效果，例如 `BatchWriteItem` 可能只有部分操作成功。
見 [DynamoDB Transactions：How it works](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)。
交易能力與跨 Region 一致性是不同問題，不能把某個 Region 的交易保證擴大成全球交易。

## 假想文章網站：同一需求如何落在兩個模型

假設需要保存 `article_id`、`author_id`、`title` 與 `published_at`，並支援「按文章 ID 讀取」和「按作者列出文章」。
以下是自訂概念設計，**沒有建立 schema、索引或執行查詢**；省略分頁、時間格式、更新衝突與容量設計。

| 問題 | RDS 的一種表達 | DynamoDB 的一種表達 |
| --- | --- | --- |
| 儲存文章 metadata | `articles` 表含上述欄位，`article_id` 為主鍵；可另有 `authors` 表 | `Articles` table 每個 item 含上述 attributes，以 `article_id` 為 partition key，無 sort key |
| 讀文章 `a42` | SQL 以 `article_id` 條件取得資料 | `GetItem` 提供完整主鍵 `article_id = a42` |
| 列出作者 `u7` 的文章 | SQL 以 `author_id` 篩選，按發布時間排序；按需求設計索引 | 另設 GSI，以 `author_id` 為 partition key、`published_at` 為 sort key，再 `Query` 作者 `u7` |
| 寫入後立即確認 | 確認交易提交與實際讀取來源，避免把非同步副本當最新來源 | 若要求最新 item，可對基表做 strong read；作者 GSI 清單仍可能稍後才反映寫入 |

這個 DynamoDB 例子不是先用作者 GSI 找到文章才能讀 ID；兩種讀法使用不同入口。
若需求改成「按主題與狀態列出文章」，就要重新檢視資料與索引是否支援，不能只因 item 已有這些 attributes 就推定有對應的鍵查詢。
示例依據為 [DynamoDB 主鍵與索引](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html)、
[Query 規則](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html)及前述一致性文件。
兩種方案的實際選擇仍須以資料關係、查詢需求、一致性與營運條件評估，本文沒有驗證其中一種必然較快或較便宜。

## 備份、PITR 與復原後的應用

RDS 的 automated backups 依設定的保留期保存，支援在可復原範圍內做 point-in-time recovery（PITR）；也能手動建立 snapshot。
對 DB instance 的備份涵蓋整個 instance，不是只挑其中一個 database；cluster 的備份則須依其部署文件確認。
見 [RDS：Introduction to backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)。
RDS DB instance 的 PITR 會建立新 instance，而不是直接把原本 instance 倒轉時間；復原時仍須確認網路與參數等設定，並安排應用轉接。
見 [Restoring a DB instance to a specified time](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)。

DynamoDB 提供 on-demand backup 與須啟用的 PITR；PITR 在可用復原期間持續保留復原點，復原會建立新 table。
有備份不表示應用已自動改讀新 table；復原後也要檢查設定，例如 tags 不會隨復原 table 保留，可能影響以標籤為條件的授權。
見 [Backup and restore for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Backup-and-Restore.html)。
對 global table 的 replica 啟用 PITR，也不表示復原後仍自動屬於原 global table，見 [Point-in-time backups](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Point-in-time-recovery.html)。

假如編輯誤刪文章，另一個可用副本可能同樣收到刪除；高可用性無法取代歷史復原點。
團隊仍須決定容許遺失多少資料、能等待多久，以及如何驗證復原後可用。
這是依 [AWS Well-Architected：Back up data](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/back-up-data.html)整理的復原問題，不是本文已驗證的復原方案。

## 網路可達、AWS 權限與資料庫登入分別處理

RDS 至少要辨認三層：

1. **網路**：程式是否有到 DB endpoint 的路徑，security group 是否允許所需流量？見 [Controlling access with security groups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.RDSSecurityGroups.html)。
2. **AWS 管理權限**：誰能建立、修改或刪除 RDS 資源？這與能否執行資料庫內的 SQL 是不同層次，見 [RDS 存取與安全概觀](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)。
3. **資料庫驗證與授權**：程式使用什麼資料庫身分、可讀寫哪些表？支援的引擎可設定 IAM database authentication，但它仍須相應資料庫帳號與權限，不會由「能修改 RDS」自然取得。見 [IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html)。

因此，託管 OS 不會消除憑證、連線加密或資料存取設計的責任。

DynamoDB 一般透過服務 API 存取，使用 IAM 管理驗證與授權，不是讓程式先用傳統 SQL 帳號登入一台資料庫主機。
見 [IAM and DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/identity-and-access-mgmt.html)。
網路仍須能到服務端點；可依連線需求使用 gateway endpoint 或 PrivateLink interface endpoint，但私有路徑不會取代權限政策。
見 [AWS PrivateLink for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/privatelink-interface-endpoints.html)。
資料敏感度、資料用途及適用安全要求仍由客戶判斷，見 [Security and compliance in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/security.html)。

## 相關文件

- [AWS 知識索引](README.md)：回查服務與閱讀入口。
- [關聯式資料庫索引](../relational-databases/README.md)：資料模型、約束、交易與索引的共通原理。
- [AWS 與使用者的責任](shared-responsibility.md)：理解平台託管與客戶設定的分界。
- [Region 與 Availability Zone](regions-and-availability-zones.md)：辨認 Multi-AZ、multi-Region 與故障位置。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：理解身分、政策與服務授權。
- [VPC 與資源連線](vpc-and-resource-connectivity.md)：理解資料庫連線所需網路條件。
- [用量與成本的基本觀察](usage-and-cost-observation.md)：分別觀察運算、儲存、請求與其他計量項目；本文沒有做成本比較。
