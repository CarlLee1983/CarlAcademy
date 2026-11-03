# ECS 與 Fargate

容器化網站需要有人決定「執行哪個版本、維持幾份、失敗後如何補上」，也需要真正執行程式的 CPU 與記憶體。
**Amazon ECS（Elastic Container Service）負責容器編排；AWS Fargate 提供不必自行管理伺服器的容器運算容量。**
兩者處理不同層次，可以一起使用，不是互相競爭的兩套容器編排系統。
見 [ECS 導論](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)。

本文介紹產品分工與基本名詞，不提供映像建置、上傳或部署步驟。
查證日期：2026-11-02。僅查閱 AWS 官方文件，未登入 AWS、建立資源、執行 CLI／SDK，亦未實測容器、網路或故障替換；本文不列費率。
下列文章網站為假想例子，不代表實際部署結果。

## 編排與運算容量分別做什麼

ECS 提供 AWS 管理的控制平面（control plane），負責排程及管理容器化應用；使用者不必自行維護 ECS 控制平面。
但容器仍須在某種運算容量上執行。本文用自行管理的 EC2 容量與 Fargate 比較常見的責任差異：

| 層次／選項 | 負責的事 | 使用者仍需決定或維護的事 |
| --- | --- | --- |
| ECS 編排 | 依應用定義排程 task，以 service 管理持續運行的應用 | 應用定義、期望數量、健康檢查、更新方式及權限 |
| ECS 搭配自行管理的 EC2 容量 | 在登錄到 cluster 的 EC2 instance 上執行容器 | instance 類型、容量、主機 OS 與 ECS agent 維護等工作 |
| ECS 搭配 Fargate | 由 AWS 提供與管理執行 task 的底層運算基礎設施 | task 的 CPU／記憶體需求、映像、應用安全、網路與資料設定 |

來源：[ECS 的容量與控制層](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)、
[standalone task 的容量管理](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html)及
[ECS 安全責任](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security.html)。

這不是所有容量選項的完整列表。ECS 也有 **Amazon ECS Managed Instances**，由 AWS 管理底層 EC2 的配置、修補與擴縮；
另有 ECS Anywhere 等選項。不能把「使用 EC2」一律等同於本文的自行管理模式。
見 [ECS 容量選項](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)。
管理邊界的背景可回讀 [AWS 與使用者的責任](shared-responsibility.md)。

Fargate 也能供 **Amazon EKS** 執行 Kubernetes Pod；這時編排系統是 EKS／Kubernetes，並不會變成 ECS task 或 ECS service。
所以「使用 Fargate」尚不足以說明採用哪個編排系統。
見 [EKS 與 Fargate](https://docs.aws.amazon.com/eks/latest/userguide/fargate.html)。本文後續名詞都以 ECS 為範圍。

## 從映像到運行中的服務

假設網站程式與執行所需依賴已包裝成容器映像，ECS 會依設定取得映像並執行；映像可以存放在 Amazon ECR 等 registry。
映像是執行來源，不能把它當成已經運行的網站程序。
ECS 中各物件的關係如下，依據 [ECS task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)與
[ECS clusters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/clusters.html)整理：

| 名詞 | 在假想網站中代表什麼 |
| --- | --- |
| 容器映像（container image） | 網站程式與依賴的封裝；task definition 指定每個容器使用哪個映像 |
| Task definition | 應用的執行藍圖，定義一個或多個容器、映像、CPU／記憶體、網路模式、日誌與角色等設定 |
| Task | 某個 task definition 在 cluster 裡的一次具體執行；同一份定義可產生多個 task |
| Service | 管理一組 task，維持指定的期望數量，適合持續運行的網站 |
| Cluster | task 與 service 的邏輯群組，關聯可供排程的運算容量；不是單一容器或單一 EC2 instance |

可以依序理解成：**映像被 task definition 引用，task 按定義執行，service 管理 task，而 task／service 位於 cluster 中。**
一個 task 可以包含多個需要一起執行的容器，因此「兩個 task」也不必然代表「兩個容器」。
見 [Task definition 的容器與執行關係](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)。

### Service 維持的是期望狀態

假設文章網站的 service 將 `desiredCount` 設為 2，表示希望持續運行兩份該 task。
若其中一份停止或被判定不健康，service scheduler 會安排替代 task，朝期望數量恢復。
替換的先後順序及同時運行的數量受到健康檢查、部署與 service 參數影響，不是保證每個時刻都恰好有兩份健康網站。
Service 也能與負載平衡器整合，把請求分送到 task。
見 [ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)。

這裡替換的是一份執行個體，不是讓停止的原 task 帶著原本程序狀態復活。
Service Auto Scaling 可以依政策調整期望數量；它與「某份 task 停止後補回既定數量」是兩個不同動作。
見 [Service auto scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)。

### 做完就停止的工作可用 standalone task

假想網站每天產生一次文章摘要，工作完成就結束，便可用 standalone task 表達，不必為了執行容器一定建立 service。
Standalone task 本身沒有 service 持續補足份數的語意；若需要排程，可另外整合 EventBridge Scheduler。
見 [ECS standalone tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html)。
這只是任務形式的例子，不代表失敗重試、避免重複產出與業務完成條件都由 ECS 自動處理。

## Fargate 仍需要明確的資源與生命週期設定

不必選伺服器，不等於不必估算資源。ECS 的 Fargate task 必須指定 task 層級的 CPU 與記憶體，並採用受支援的組合；
支援條件還受到 OS、CPU 架構與平台版本影響，部分 EC2 task definition 參數在 Fargate 不支援或行為不同。
不能假設原本在主機上的所有容器設定都能原樣移過來。
見 [Fargate task definition 差異與 CPU／記憶體](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)。

Task 的生命週期包含配置、等待、啟動、運行及停止等狀態，例如 `PROVISIONING`、`PENDING`、`RUNNING`、`STOPPED`。
建立 task 不代表應用已開始回應請求；容量、映像取得與啟動等工作需要完成，應用健康也須另外觀察。
見 [ECS task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)。

Fargate task 有暫存儲存（ephemeral storage），可容納映像與工作資料；映像本身也會占用這份空間。
例如 Linux 平台版本 1.4.0 以上預設提供至少 20 GiB，能以設定提高到 200 GiB；此數字與平台範圍須一起閱讀，不能套用所有環境。
見 [Fargate ephemeral storage](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html)。

**需要跨 task 替換保存的資料，應另外設計持久儲存，不能依賴 task 的暫存空間。**
以文章網站為例，這是本文的設計推論：文章、上傳檔案與需要保留的狀態應放到適當的外部儲存或資料庫；
新 task 依既定資料來源重新工作，而不是假設它會繼承舊 task 的本機檔案。
暫存生命週期的依據見 [ECS bind mounts](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/bind-mounts.html)。

## Task role 與 execution role 的權限給不同對象

「網站有權讀 S3」與「平台有權下載網站映像」是不同需求：

| 角色 | 誰使用權限 | 假想網站的例子 |
| --- | --- | --- |
| Task IAM role | task 內的應用程式 | 網站透過 AWS API 讀取指定 S3 資料 |
| Task execution IAM role | ECS container agent／Fargate agent | 從私有 ECR 取得映像、使用 `awslogs` 傳送日誌，或依 task definition 取得指定秘密值 |

Task role 的權限提供給 task 內容器，execution role 的權限供 agent 執行相關工作，不會直接提供給容器內的應用。
不能藉由替 execution role 加上 S3 權限，就推定網站程式已有相同權限。
見 [Task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)與
[Task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)。
兩者都應依實際工作限制權限；人員操作 ECS 的身分與權限還是另一個問題，見 [IAM 的身分與權限](iam-identities-and-permissions.md)。

## Task 網路同時影響網站連線與啟動

ECS 的 Fargate task 使用 `awsvpc` 網路模式，每個 task 配有網路介面（ENI）與私有 IP；
啟動時指定的子網路（subnet）與 security group 決定它所處的網路與允許的流量。
同一 task 內的容器能透過 `localhost` 通訊，不代表不同 task 共用同一個 localhost。
見 [Fargate 網路要求](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)與
[Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)。

除了讀者連進網站，task 啟動時也可能需要對外取得映像、取得秘密值及傳送日誌。
以 IPv4 網路為例，從網際網路取得映像通常需要可用的出口路徑：公有子網路中的 task 可搭配公有 IP，私有子網路則可經 NAT 等方式連出。
若使用 ECR 的私有連線，可配置相應 VPC endpoints；具體端點需求須依平台版本與服務判斷，例如 ECR 映像層下載還涉及 S3，日誌也可能需要 CloudWatch Logs 端點。
見 [Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)與
[ECR VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html)。

因此，映像無法取得時，應分開辨認「agent 是否有權讀取」與「網路是否可到達 registry／相關端點」。
IAM 允許不會自動補上路由，開放 security group 也不會自動取得 AWS API 權限。
這是依上述角色與網路文件整理的判斷方式；VPC、路由與 security group 的基本關係見 [VPC 與資源連線](vpc-and-resource-connectivity.md)。

## 成本要看容量與周邊服務

Fargate 成本與所請求的 vCPU、記憶體、執行時間及需付費的額外暫存儲存等維度有關；Region、OS 與 CPU 架構也會影響計價。
計費時間包含映像開始下載至 task 終止的期間，並有依環境而異的最低計費時間。
所以網站 CPU 暫時閒置，不代表仍在執行的 task 完全沒有費用。
見 [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)。

自行管理 EC2 容量時，要看配置的 EC2、儲存等底層資源；Fargate 則以其容量計價。
EC2 與 Fargate 這兩種 ECS 選項沒有另外的 ECS 編排費，但不能擴大解讀成所有 ECS 容量或功能都免費，
例如 Managed Instances 有自己的管理計價。負載平衡、日誌、網路出口、資料傳輸及資料儲存也可能產生額外費用。
見 [Amazon ECS Pricing](https://aws.amazon.com/ecs/pricing/)與 [Fargate Pricing](https://aws.amazon.com/fargate/pricing/)。
本文未估算成本，也不由「serverless」推定一定比 EC2 便宜。

## 相關文件

- [AWS 知識索引](README.md)：回查容器與其他服務入口。
- [AWS 與使用者的責任](shared-responsibility.md)：理解託管層次與保留責任。
- [VPC 與資源連線](vpc-and-resource-connectivity.md)：理解子網路、路由與流量控制。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：理解角色及授權。
- [容器編排與運算容量](container-orchestration-and-compute-capacity.md)：透過情境串起容量供應與 task 放置，不重複本文的基本名詞。
