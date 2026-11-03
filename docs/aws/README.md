# AWS 知識索引

從雲端基礎建立整體認識，再依服務用途與實際問題查閱。
本主題整理 AWS 特有的概念、服務及其關係，共通知識連回相關主題。

**目前狀態：本索引列出的 20 篇文章已整理，涵蓋六篇雲端基礎、十篇服務分組與四篇服務關係。**
各篇標示來源、查證日期與驗證範圍，內容可依問題獨立閱讀。

查證日期：2026-11-02。本次僅查閱官方文件，未建立 AWS 資源或驗證操作範例。
下列分類、選題與閱讀順序是本站的編輯安排，不是 AWS 的官方分類，也不列舉所有服務。
AWS 官方服務分類另見 [AWS services by category](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/amazon-web-services-cloud-platform.html)。

## 建議閱讀順序

1. **雲端與責任邊界**：先讀[雲端運算與服務模式](cloud-computing-and-service-models.md)，理解資源如何提供，以及管理責任如何隨服務模式改變；再讀 [AWS 與使用者的責任](shared-responsibility.md)。
2. **帳戶、身分與部署位置**：讀[帳戶、身分與權限](accounts-identities-and-access.md)與 [Region 與 Availability Zone](regions-and-availability-zones.md)，需要政策判定細節再看 [IAM](iam-identities-and-permissions.md)。
3. **運算、儲存與網路**：從 [EC2 與 Lambda](ec2-and-lambda.md)、[S3、EBS 與 EFS](s3-ebs-and-efs.md)、[VPC](vpc-and-resource-connectivity.md)理解執行程式、保存資料與連線的分工。
4. **資料與應用介面**：依問題選讀[資料庫](rds-and-dynamodb.md)、[API Gateway](api-gateway-and-backend-integration.md)或[容器服務](ecs-and-fargate.md)。
5. **觀察、成本與服務組合**：從[用量與成本](usage-and-cost-observation.md)、[CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)讀起，再以本文下方四篇服務關係文章串起情境。

這是閱讀建議，可依問題直接查找，不要求先學完 Linux 或依序完成。

## 雲端基礎

| 文章 | 內容邊界與官方閱讀入口 |
| --- | --- |
| [雲端運算與服務模式](cloud-computing-and-service-models.md) | 隨需取得運算、儲存等 IT 資源；認識 IaaS、PaaS、SaaS 的管理責任差異。見 [What is cloud computing?](https://aws.amazon.com/what-is-cloud-computing/) |
| [AWS 與使用者的責任](shared-responsibility.md) | 責任隨服務改變；例如 EC2 的客體作業系統由使用者管理，不能把託管服務理解成免除所有責任。見 [Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/) |
| [帳戶、身分與權限](accounts-identities-and-access.md) | 認識帳戶中的身分、驗證與授權，以及 IAM 如何控制 AWS 資源存取。見 [What is IAM?](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html) |
| [Region 與 Availability Zone](regions-and-availability-zones.md) | Region 是地理區域，AZ 是 Region 內的隔離位置；區分區域與可用區資源、故障範圍。見 [Regions and Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html) |
| [如何存取 AWS 服務](accessing-aws-services.md) | 區分 Console、CLI 與 SDK 等操作入口；不預設程式語言或操作環境。見 [AWS 服務存取入口](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/amazon-web-services-cloud-platform.html) |
| [用量與成本的基本觀察](usage-and-cost-observation.md) | 以 Cost Explorer 理解成本與用量，以 Budgets 設定預算與通知；具體費率在操作文章另查。見 [Cloud Financial Management](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/aws-cost-management.html) |

## 服務分組

各組先選代表服務作為閱讀入口。下列用途是簡要定位，服務選型與設定細節留待各篇說明。

### 身分與存取

- **[IAM 的身分與權限](iam-identities-and-permissions.md)**：整理誰能對哪些 AWS 資源執行哪些操作，以及驗證與授權的區別。
- 官方入口：[IAM 導論](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)。

### 運算與容器

- **[EC2 與 Lambda](ec2-and-lambda.md)**：由虛擬伺服器與不必自行管理伺服器的程式執行方式，理解管理邊界。見 [Compute](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/compute-services.html)。
- **[ECS 與 Fargate](ecs-and-fargate.md)**：ECS 負責容器編排，Fargate 是可供容器使用的運算選項；兩者分別介紹。見 [ECS 導論](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)。

### 儲存

- **[S3、EBS 與 EFS](s3-ebs-and-efs.md)**：分別從物件儲存、供 EC2 使用的區塊儲存及檔案系統切入，整理資料如何存取。
- 官方入口：[Storage](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/storage-services.html)。

### 網路與內容傳遞

- **[VPC 與資源連線](vpc-and-resource-connectivity.md)**：整理虛擬網路、子網路、路由與存取控制的關係。
- **[Elastic Load Balancing 與 CloudFront](load-balancing-and-cloudfront.md)**：分別認識把流量分送至目標的負載平衡，以及內容傳遞網路（CDN）。
- 官方入口：[Networking and content delivery](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/networking-services.html)。

### 資料庫

- **[RDS 與 DynamoDB](rds-and-dynamodb.md)**：由託管關聯式資料庫，以及鍵值／文件資料庫的不同資料模型切入。
- 官方入口：[Databases](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/database.html)。關聯式資料模型、SQL 與交易的共通原理見[關聯式資料庫索引](../relational-databases/README.md)，各服務文章補充產品差異。

### 應用介面

- **[API Gateway 與後端整合](api-gateway-and-backend-integration.md)**：認識建立與管理 API 的入口，以及它如何連接 Lambda 或其他後端。
- 官方入口：[API Gateway 導論](https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html)。API 契約與 HTTP 語意連回 [API 共通知識索引](../api/README.md)。

### 觀察、管理與成本

- **[CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)**：分別從日誌、指標與警報觀察運作，以及從 AWS API 活動紀錄追查操作。見 [Management and governance](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/management-governance.html)。
- **[Cost Explorer 與 Budgets](cost-explorer-and-budgets.md)**：整理成本／用量分析及預算通知的分工。見 [Cloud Financial Management](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/aws-cost-management.html)。

## 服務之間的關係

下列是本站選定的閱讀例子，不是所有應用都必須採用的架構。

| 文章 | 要串起的關係與官方依據 |
| --- | --- |
| [EC2 與資料儲存](ec2-and-data-storage.md) | EBS 提供供 EC2 使用的持久區塊儲存；S3 是物件儲存。先分清存取方式，再談選擇。見 [Storage](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/storage-services.html) |
| [容器編排與運算容量](container-orchestration-and-compute-capacity.md) | ECS 部署與管理容器化應用，容量可使用 EC2 或 Fargate 等選項；編排與執行容量分開理解。見 [ECS 導論](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html) |
| [API 入口與程式執行](api-entry-and-program-execution.md) | API Gateway 可將 API 請求連到 Lambda，Lambda 執行後端程式；介面與程式執行分別整理。見 [API Gateway 導論](https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html) |
| [CDN 與內容來源](cdn-and-content-origins.md) | CloudFront 可使用 S3、負載平衡器或 EC2 作為來源；內容傳遞與來源服務分別整理。見 [Networking and content delivery](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/networking-services.html) |

上述組合的權限與維運責任仍須分別檢查，回讀 [IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html) 與 [責任共擔模型](https://aws.amazon.com/compliance/shared-responsibility-model/)。

## 共通知識與相關主題

- [Linux 知識索引](../linux/README.md)：EC2 等文章需要作業系統背景時，連回程序、檔案、權限、服務與網路主題；AWS 文章補充雲端服務的差異。
- [API 共通知識索引](../api/README.md)：介面契約、HTTP、錯誤、逾時、重試與冪等性集中整理；AWS 服務文章補充該服務規則。
- [網站首頁](../../README.md)：回查全站主題與閱讀起點。

各主題的內容範圍以各自索引為準；本文篇目不代表涵蓋 AWS 的所有服務或操作情境。
後續新增操作範例時，須另記適用範圍、查證日期與實際驗證情況；本次文件查證不代表操作已實測。
