# 容器編排與運算容量

**「希望網站有六份 task」是應用的需求；「哪裡有足夠資源執行六份」是容量與排程問題。**
ECS service 可以持續補足 task，但只有期望數量，仍不足以讓網站開始服務。
還要選擇運算容量、找到符合條件的位置、取得映像、啟動應用，並通過適用的健康檢查。
這些階段的依據見 [ECS 排程](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/scheduling_tasks.html)與
[task 生命週期](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)。

本文用假想文章網站串起上述關係。映像、task definition、task、service、cluster 的基本分工，請先讀
[ECS 與 Fargate](ecs-and-fargate.md)；子網路與路由背景見 [VPC 與資源連線](vpc-and-resource-connectivity.md)。

查證日期：2026-11-02。本文僅查閱 AWS 官方文件，未登入 AWS、執行 AWS CLI／SDK、建置或推送映像、部署容器、建立容量或實測故障。
以下圖、份數與情境是概念示意，不是可直接執行的設定、容量建議或效能比較；本文不列費率。

## 一個網站，有兩種不同的工作需求

假設網站已有可取得的容器映像，平常希望維持兩份網站 task；活動期間需要增加到六份。
網站另有每天夜間執行一次的摘要產生工作，做完便結束。
本文的安排是：網站由 service 維持，夜間工作則使用獨立的 standalone task，可由 EventBridge Scheduler 觸發。
這對應 [ECS 排程文件](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/scheduling_tasks.html)所區分的持續服務與單次工作。

兩者可以位於同一個 cluster，但不共用「應該維持幾份網站」的意思：夜間 task 不會自動成為網站的第七份副本，
完成摘要也不代表網站 service 該縮容。若它們使用同一批 EC2 容量，則會一起消耗那批 instance 的資源。
Standalone task 沒有 service 持續補足副本的保證；業務是否完成、失敗後是否重試及如何避免重複摘要，仍須另外設計。
見 [Standalone tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html)。

把本例從需求一路讀到讀者請求，可以畫成：

```text
可取得的網站映像 ──→ task definition（映像、資源、網路、角色等）
                                   │
                  ┌────────────────┴─────────────────┐
                  ↓                                  ↓
        網站 service：2 → 6 份                夜間 standalone task
        維持數量、替換、更新                    執行工作後結束
                  └────────────────┬─────────────────┘
                                   ↓
                    capacity provider strategy
                    選擇供應容量的來源
                                   ↓
                  可用運算資源 + task 放置條件
                  （容量不足或不相容，可能無法啟動）
                                   ↓
                 網路配置／ENI、映像取得、容器啟動
                                   ↓
                      網站 task 執行與健康判定
                                   ↑
           讀者 → ALB listener → target group → 網站 task

夜間 task 不必加入網站的 target group。
圖中的先後是理解邊界的順序；實際配置與啟動工作可能交錯進行。
```

容量選擇依據見 [Launch types 與 capacity providers](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-launch-type-comparison.html)，
啟動階段依據見 [Task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)，
網站流量整合見 [ECS service load balancing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)。
圖沒有表示每種容量模式都由使用者選擇實體主機，也沒有表示 task 一進入 `RUNNING` 就通過負載平衡器健康檢查。

## Capacity provider 接起需求與容量來源

Capacity provider 讓 ECS 知道該從哪一種容量來源滿足 task 需求；strategy 則描述 task 如何分配到關聯的 providers。
它不是映像倉庫，也不代表已經預留足夠容量。主要選項如下：

| 容量選項 | 容量如何提供 | 本例仍須面對的條件 |
| --- | --- | --- |
| 自行管理 EC2，搭配 Auto Scaling group capacity provider | 在已登錄到 cluster 的 EC2 container instances 執行 task；可啟用 ECS managed scaling 管理群組擴縮 | Instance 選擇與主機管理、群組上限、可用資源、agent 與放置限制 |
| Fargate／Fargate Spot capacity providers | AWS 管理底層容器運算基礎設施，不必自行供應 EC2 主機池 | 支援的 task 設定、資源配額、可用容量、網路；Spot 還有中斷風險 |
| Amazon ECS Managed Instances capacity provider | 使用 EC2 能力，由 AWS 管理配置、擴縮、修補與維護 | 應用資源需求、provider 與網路設定，及此模式自己的支援條件 |

來源：[容量選項比較](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-launch-type-comparison.html)、
[ASG capacity providers](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/asg-capacity-providers.html)、
[Fargate capacity providers](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)與
[ECS Managed Instances](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ManagedInstances.html)。
因此，「底層使用 EC2」不能一律解讀成使用者自己修補、維護全部主機；後續的 ASG 擴縮例子特指表中第一種模式。

在同一個 service 或啟動 task 的設定中，`capacityProviderStrategy` 與 `launchType` 是互斥的選擇，不能把兩者都填上。
Task definition 的 `requiresCompatibilities` 則是相容性要求，不是另一份容量供應策略。
見 [Service definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html)與
[容量設定比較](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-launch-type-comparison.html)。

同一 cluster 可以關聯不同類型的 providers，但**一份 strategy 不可任意混合 ASG、Managed Instances 與 Fargate 這些類型**；
`FARGATE` 與 `FARGATE_SPOT` 可搭配使用。
見 [Managed Instances：Capacity providers](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ManagedInstances.html)與
[Fargate capacity providers](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)。

### Base 與 weight 是分配規則，不是健康保證

以 Fargate 的概念策略為例：指定 `FARGATE` 的 base 為 2，剩餘需求再按 `FARGATE` 與 `FARGATE_SPOT` 的相對 weight 分配。
Base 表示先滿足指定 provider 的最低 task 數，只有一個 provider 可設定 base；weight 描述之後的相對分配比例。
它不是 CPU 比例，也不是「一定有兩份健康網站」的可用性承諾。實際還須符合 provider 關聯、狀態與有效權重等條件。
見 [Capacity provider strategy 參數](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html)。

這只是閱讀分配規則的例子，沒有提供可部署 JSON，也沒有斷言六份 task 在任意時間一定呈現某個精確分布。
網站與夜間 task 可以採不同策略，例如讓可重跑的夜間工作使用 Spot；是否適合，取決於工作能否承受等待與中斷，而非單看份數。

## 從兩份增加到六份，是兩個控制回路

Service Auto Scaling 透過 **Application Auto Scaling** 調整 service 的期望 task 數，
可依 CPU、記憶體等指標的政策或排程擴縮；service scheduler 再努力讓實際 task 數達到期望。
這與某份 task 停止後補回原來兩份，是不同的觸發原因。
見 [Service Auto Scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)。

| 回路 | 觀察與調整的對象 | 本例的結果 |
| --- | --- | --- |
| 應用份數 | Service Auto Scaling 依政策調整 service 的 `desiredCount` | 把網站需求從 2 改成 6；不是直接增加 EC2 instance |
| 自行管理 EC2 的容量供應 | ASG capacity provider 啟用 managed scaling 後，由 ECS 評估待放置需求、透過相關指標與擴縮機制調整 ASG 容量 | 增加可登錄到 cluster 的 EC2 資源，再讓 scheduler 放置 task |

第二個回路的依據見 [ECS managed scaling behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/managed-scaling-behavior.html)。
兩個回路各有政策、限制與反應時間；把 service 上限設為六份，不會自動把 ASG 的上限、instance 規格或帳戶配額一併調整。

假設網站原有兩份 task，EC2 池也只剩足夠維持它們的資源。需求升為六份後，新增的四份不會憑空取得 CPU 與記憶體：
沒有可放置資源時，會出現未達期望數量、task 等待啟動的情況。依所處階段可能是 `PENDING`；
等待 ASG 容量的 task 也可能停在 `PROVISIONING`。必須讀實際狀態與事件，不能把所有等待都叫成同一種錯誤。
見 [Task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)與
[ASG capacity providers 的容量限制](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/asg-capacity-providers.html)。

Managed scaling 也有前提：使用這個 capacity provider strategy 的需求才會參與相應擴容；
只指定 launch type 的 pending task 不會因此驅動 provider 擴容。
若 ASG 已到上限、instance 無法供應，或 task 大到不符合群組最小 instance 類型，擴縮仍可能無法滿足需求。
見 [Managed scaling behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/managed-scaling-behavior.html)。

Fargate 則省去自行擴大 EC2 池的工作，但並非無限或即時容量。
仍須符合 CPU／記憶體組合與平台支援，並受到區域配額、當下可用資源、子網路 IP 與網路配置影響。
見 [Fargate task requirements](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)、
[服務配額與整合限制](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/operating-at-scale-service-quotas.html)及
[Service event messages](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-event-messages-list.html)。

## 有空位，仍要符合放置條件

在自行管理 EC2 的例子中，scheduler 先找符合 CPU、記憶體、GPU、port 等需求的 container instances，
再考量 placement constraints 與 strategies。`spread` 可表達分散，`binpack` 可表達依 CPU 或記憶體集中利用空間。
Strategy 是盡力滿足的偏好，constraint 是必須符合的條件；不相容的限制可能直接阻止放置。
見 [Task placement strategies](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-placement-strategies.html)。

例如「整個 cluster 還有足夠記憶體」不能證明某一台 instance 放得下完整 task；
採 `awsvpc` 時，也要考慮 ENI 附加容量。只看平均 CPU 使用率無法回答所有放置問題。
見 [Service events：資源不足與 ENI 限制](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-event-messages-list.html)。
以上 EC2 placement 設定不能原樣套到 Fargate；Fargate 不支援相同的 task placement constraints。
Managed Instances 亦有自己的資源、ENI 與 AZ 放置邏輯。
見 [Fargate 參數差異](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)與
[Managed Instances auto scaling and task placement](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/managed-instance-auto-scaling.html)。

### 多 AZ 與替換 task 解決的問題不同

網站可讓 task 分布在不同 AZ，降低單一位置故障的集中影響；service scheduler 預設會考量跨 AZ 分散。
但仍須有對應子網路、可用容量與正確放置設定，不能只因 `desiredCount = 2` 就宣稱已跨兩個 AZ。
見 [ECS scheduling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/scheduling_tasks.html)。

當 task 不健康或更新版本，service 會啟動替代執行，而不是把原程序連同記憶體狀態搬到新位置。
本例因此把文章、上傳檔案與摘要進度放到適當的外部持久資料來源，讓新 task 能重新讀取；這是設計推論，
不能假設舊 task 的暫存檔會自動隨替換保存。EC2 host bind mount 可能依附主機，但也不是跨主機自動搬移資料的機制。
儲存生命週期見 [ECS bind mounts](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/bind-mounts.html)。

Rolling deployment 的 `minimumHealthyPercent` 與 `maximumPercent` 控制更新期間的健康下限與同時執行數量上限。
若要先啟動新 task 再停止舊 task，就可能需要超過平常六份的暫時容量；不合理的百分比組合也可能讓更新無法前進。
這些參數是 scheduler 的操作邊界，無法創造容量或讓故障應用健康。
見 [ECS rolling deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)。

## 容量之後還有映像、權限、網路與健康

以本例的 Fargate 網站為例，每份 task 配有 ENI 與私有 IP；選定子網路及 security group 之後，
仍須有取得映像、秘密值與日誌服務所需的連線。Private subnet 可以使用 NAT 出口，或依依賴配置適用的 VPC endpoints。
使用私有 ECR endpoint 時，映像層取得還涉及 S3；例如 Fargate Linux 1.4.0 以上的 ECR 私有路徑需要相應的 ECR API、DKR endpoints 與 S3 gateway endpoint，
使用 `awslogs` 且沒有其他出口時還須考慮 CloudWatch Logs endpoint。
見 [Fargate networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)與
[ECR VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html)。

權限則要問「誰正在做哪一步」：

- **啟動支援工作**：本例 Fargate 的 agent 使用 task execution role，取得私有 ECR 映像、依設定取得秘密值及傳送 `awslogs` 日誌。
- **應用工作**：網站或摘要程式使用 task role 呼叫被允許的 AWS API，例如讀取指定 S3 內容。

來源：[Execution role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)與
[Task role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)。
自行管理 EC2 的 ECR 映像拉取還須依該模式檢查 container instance role，不能把 Fargate 的判斷直接套用。
見 [CannotPullContainer errors](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_cannot_pull_image.html)。

因此，「網站有讀取資料的 task role」無法證明 agent 拉得到映像；
「execution role 有 ECR 權限」也無法證明 DNS、路由、endpoint policy 與 SG 已允許實際連線。
權限原理回讀 [IAM 的身分與權限](iam-identities-and-permissions.md)，連線原理回讀 [VPC 與資源連線](vpc-and-resource-connectivity.md)。

網站 task 啟動後，ALB 仍要有正確的 listener、target group、應用 port 與健康檢查設定，才能正常轉送流量。
Task 的 `RUNNING`、容器健康狀態與 target health 是不同證據；應用可能活著卻回錯誤，或健康檢查根本無法到達應用。
見 [ECS load balancing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)與
[ECS service parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html)。
入口分工另見 [Elastic Load Balancing 與 CloudFront](load-balancing-and-cloudfront.md)。

## Spot 中斷與重新執行，必須回到應用需求

Fargate Spot 使用可回收的閒置容量，AWS 需要收回時會提供兩分鐘中斷通知。
Service 會嘗試補上 Spot task，但容量可能暫時不可用，而且不會自動把缺少的 Spot 容量換成一般 Fargate 容量。
見 [Fargate Spot termination notices](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)。

本例若讓夜間摘要使用 Spot，就應讓程式處理停止訊號、保存可恢復的進度，並在重試時避免重複寫入結果；
這是基於中斷特性的設計推論，不是 ECS 自動提供的業務重試保證。
即使網站保留一般 Fargate 的 base，仍須評估中斷後剩餘健康 task 能否承擔請求，不能把分配策略當成網站可用性的證明。

## 三個假想故障，如何沿邊界找證據

以下是調查方向，並非本文實際觀察到的故障或已驗證修復。
先對齊同一個 service、task／task definition 版本與時間範圍，再比較期望數、實際數與健康數，避免把不同啟動嘗試混為一談。

| 假想現象 | 優先取得的證據 | 證據如何縮小範圍 |
| --- | --- | --- |
| 期望六份，只有兩份運行，其餘等待 | Service events、task 狀態、使用的 provider；EC2 再看 container instance 可用 CPU／記憶體／ENI、ASG 擴縮活動與上限 | 區分沒有可放置位置、provider 沒被需求驅動、擴容失敗或限制不相容；Fargate 則查看 quota／capacity 等事件，不能推定它也有使用者 ASG |
| 新 task 拉不到映像 | Stopped task 的完整原因與 `CannotPullContainerError`、映像名稱／版本是否存在、該模式拉取映像的角色、registry 與端點可達路徑 | 權限拒絕、名稱錯誤、網路逾時與空間不足是不同原因；不要看到拉取失敗就一律增加 task role 權限 |
| Task 已運行，但健康網站不足 | Service／deployment events、容器日誌與健康檢查、ALB target health 原因、健康檢查 path／port／回應、網路規則 | 區分程式啟動失敗、應用回應不符、LB 無法抵達，及更新參數或容量使替換停滯；新增更多相同故障 task 未必有效 |

事件與資源判讀見 [Service event messages](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-event-messages-list.html)與
[Managed scaling behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/managed-scaling-behavior.html)；
拉取失敗見 [CannotPullContainer errors](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_cannot_pull_image.html)；
健康與更新限制見 [Rolling deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)。

CloudWatch 可承接設定好的指標、日誌與警報；CloudTrail 可協助追查相關 API 操作，但不是應用每次 HTTP 請求的執行日誌。
證據種類的分工見 [CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)。
觀察成本時，也要一起看實際供應容量、負載平衡、網路與日誌，而非只數網站 task；回讀 [用量與成本的基本觀察](usage-and-cost-observation.md)。

## 相關文件與查證範圍

- [AWS 知識索引](README.md)：回查服務分組與關係文章。
- [ECS 與 Fargate](ecs-and-fargate.md)：基本名詞、產品分工及責任邊界。
- [VPC 與資源連線](vpc-and-resource-connectivity.md)：task 啟動與服務流量所需的路徑。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：區分角色、授權與操作對象。
- [Elastic Load Balancing 與 CloudFront](load-balancing-and-cloudfront.md)：入口轉送與內容傳遞。
- [CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)：區分運作證據與操作紀錄。
- [用量與成本的基本觀察](usage-and-cost-observation.md)：觀察容量與周邊服務的成本。

本文依 ECS、ECR 官方文件整理概念並在敘述附近附來源，完成靜態格式、引用與站內連結檢查。
未驗證任何真實帳戶的策略、配額、容量、擴縮時間、網路、權限、健康檢查或恢復行為，也未估算成本。
