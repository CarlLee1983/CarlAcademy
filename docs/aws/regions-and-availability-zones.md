# Region 與 Availability Zone

把網站部署到 AWS，除了決定用什麼服務，還要知道資源放在哪裡。
**Region（區域）是獨立的地理區域；Availability Zone（可用區，簡稱 AZ）是同一個 Region 內彼此隔離的位置。**
把多台伺服器放在同一個 AZ，與分散在不同 AZ，面對位置故障時的結果可能不同。
見 [AWS Regions and Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html)。

本文從部署位置、資源範圍與故障邊界切入，不要求先操作過 AWS。
可先讀[雲端運算與服務模式](cloud-computing-and-service-models.md)，理解運算與儲存等資源的用途。

查證日期：2026-11-02。本文僅查閱 AWS 官方文件，未登入 AWS、建立資源，亦未執行 CLI、SDK 或部署測試。
以下網站與拓樸是本站自訂的概念例子，不是實測結果，也不是特定地區的選型建議。

## Region 裡有多個 AZ，AZ 不等於一棟機房

一個 Region 內有多個 AZ。AZ 之間有低延遲、高頻寬且具備備援的網路連線，
但實體設施彼此分離，讓某個位置的故障較不容易同時影響其他位置。
**一個 AZ 包含一個或多個獨立資料中心**，因此不能把 AZ 直接理解成「一棟機房」。
AWS 的底層資料中心與其電力、網路設施，才是承載服務的實體基礎。
見 [AWS：Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html#availability-zones)。

以下圖只畫出部分位置，用來說明包含關係，不表示任何 Region 或 AZ 的實際數量：

```text
AWS
├─ Region 甲
│  ├─ AZ 甲一：一個或多個資料中心
│  ├─ AZ 甲二：一個或多個資料中心
│  └─ ……
└─ Region 乙
   ├─ AZ 乙一：一個或多個資料中心
   ├─ AZ 乙二：一個或多個資料中心
   └─ ……
```

Region 之間也以隔離為設計原則。多數 AWS 服務的資源隸屬於建立時所選的 Region，
不會因為 AWS 在其他 Region 也提供同名服務，就自動出現另一份相同資源。
見 [AWS：Regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html#regions)。

這裡的「隔離」描述故障邊界，不表示網路永遠不能互通，也不是保證所有故障都只影響一個位置。
AWS Well-Architected 仍要求檢查應用元件之間的依賴：如果另一個位置的服務仍依賴故障位置，
單純分散部署未必達到預期的韌性。見 [REL10-BP01：Deploy the workload to multiple locations](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_fault_isolation_multiaz_region_system.html)。

## Region code、AZ name、AZ ID 各自辨認什麼

閱讀資源資料時，會遇到不同層次的識別方式：

| 名稱 | 例子 | 意義 |
| --- | --- | --- |
| Region 名稱 | US East (N. Virginia) | 給人閱讀的區域名稱 |
| Region code | `us-east-1` | 在設定與 API 等地方使用的區域代碼 |
| AZ name | `us-east-1a` | Region code 加上字母，用來表示帳戶所見的某個 AZ |
| AZ ID | `use1-az1` | 跨帳戶一致的可用區識別碼 |

Region 名稱與代碼見 [AWS service endpoints](https://docs.aws.amazon.com/general/latest/gr/rande.html)；
AZ 名稱格式見 [EC2：Availability Zones](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html)。
AZ ID 的意義見 [AWS RAM：Availability Zone IDs](https://docs.aws.amazon.com/ram/latest/userguide/working-with-az-ids.html)。
**表中列的是格式例子，不是在宣告 `us-east-1a` 對應 `use1-az1`。**

AZ 名稱中的字母對應**可能因帳戶而不同**。帳戶甲看到的 `us-east-1a`，
不一定是帳戶乙看到的 `us-east-1a` 所在的實體位置；也不能反過來說兩個帳戶一定不同。
要跨帳戶確認是否為同一個 AZ，應比對 AZ ID。
例如兩個帳戶的資源都位於 `use1-az1`，才表示相同的 AZ。
AWS 目前也區分帳戶建立時間：較早建立的帳戶在部分舊 Region 採獨立映射；自 2025 年 11 月起建立的帳戶採一致映射。
見 [AWS Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html)與
[AWS RAM：跨帳戶 AZ 對應與 AZ ID](https://docs.aws.amazon.com/ram/latest/userguide/working-with-az-ids.html)。

在單一帳戶裡規劃分散部署時，AZ 名稱很實用；若涉及跨帳戶共享子網路，
只用「我們都選 a」溝通，就可能誤判資源位置。這是依上述映射規則整理的情境。

## Region、帳戶、VPC 回答不同問題

Region 說明地理部署位置；帳戶與身分權限則關係到誰能管理或存取資源。
一個 AWS 帳戶可在多個可用 Region 中建立資源，不是每換一個 Region 就換一個帳戶。
可用區域也受帳戶類型影響，不能把一般 AWS 帳戶與中國區域、GovCloud 的存取範圍混為一談。
見 [AWS Regions：Account types](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)與
[IAM 導論](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)。

**VPC（Virtual Private Cloud）是邏輯隔離的虛擬網路，不是 Region 本身。**
一個 Region 可以建立多個 VPC；VPC 的範圍涵蓋該 Region 的 AZ，而一個 subnet（子網路）只位於一個 AZ。
所以可以在同一個 VPC 裡，用分屬不同 AZ 的子網路放置網站元件。
見 [Configure a VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-your-vpc.html)、
[VPC basics](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-subnet-basics.html)與
[Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)。
網路如何連線與限制存取，另見 [VPC 與資源連線](vpc-and-resource-connectivity.md)。

## 資源的範圍，要看具體資源類型

「某服務在這個 Region 提供」與「這個資源跨多少位置運作」是兩個問題。
以下是辨認資源範圍的例子，不是所有 AWS 服務的完整分類：

| 範圍 | 具體例子 | 閱讀時要注意 |
| --- | --- | --- |
| AZ／zonal | EC2 instance | 啟動於特定 AZ，不會因為 EC2 是區域服務就自動跨 AZ 執行 |
| AZ／zonal | EBS volume | 要與掛載它的 EC2 instance 位於同一個 AZ |
| Region／regional | AMI、VPC | 屬於特定 Region；VPC 可涵蓋區域內多個 AZ |
| 全域／global | IAM、CloudFront | 其資源不是一般的逐 Region 獨立資源；仍有各自的運作與故障依賴 |

AMI 與 instance 的範圍見 [Manage your EC2 resources](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/resources.html)；
EBS 的同 AZ 限制見 [Amazon EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)；
VPC 範圍見 [VPC basics](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-subnet-basics.html)。

全域服務也不表示「每個操作都在所有 Region 獨立運作」，更不是應用資料會自動複製到全球。
例如 AWS 的故障隔離文件區分全域服務的控制平面與資料平面：
管理資源的操作，與實際處理服務流量的部分，可能有不同部署範圍。
IAM 的全域範圍還須放在 AWS partition（例如一般 AWS、GovCloud、中國區域）的邊界下理解。
見 [AWS Fault Isolation Boundaries：Global services](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/global-services.html)。
入門時先記住：**查資源本身的範圍，不要只替整項服務貼一個標籤。**

## 選定 Region，還要確認服務與存取入口

AWS 提供某個 Region，不代表每一項服務與功能都已在該處提供。
準備部署時，要確認所需服務、功能與資源選項的支援範圍；部分 Region 也需要先啟用才能使用，稱為 opt-in。
見 [AWS Regions：服務支援與 Opt-in status](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)。

另一個相關名詞是 **endpoint（服務端點）**，也就是程式連到服務的入口 URL。
多數服務提供區域端點，例如 DynamoDB 的 `https://dynamodb.us-west-2.amazonaws.com` 指向 `us-west-2`。
SDK 或 CLI 的區域設定會影響所用端點；切換區域不是把原本的資源搬過去。
全域端點與部分特殊端點有自己的規則，不能假設所有 AWS URL 都是同一個格式。
見 [AWS service endpoints](https://docs.aws.amazon.com/general/latest/gr/rande.html)。

因此，找不到資源時，Region 是值得核對的上下文之一；也要確認帳戶、權限與服務種類。
這是依前述範圍整理的查找方向，不是本文已執行的疑難排解流程。

## 假想網站：兩台伺服器不一定跨越兩個故障位置

假設團隊有一個文章網站，網站程式跑在 EC2，資料庫暫時自行管理。
以下只比較位置與依賴，不是推薦的正式架構：

| 部署情境 | 遇到什麼情況可能有差別 | 還欠缺什麼 |
| --- | --- | --- |
| 兩台網站 EC2 都在 AZ 甲一 | 可分散個別 instance 故障的影響，但同一 AZ 故障可能同時影響兩台 | 另一個 AZ 的運作能力 |
| 一台在 AZ 甲一，一台在 AZ 甲二；資料庫只有甲一的一份 | 網站程式分散了，但甲二的網站仍可能因資料庫不可用而無法服務 | 資料層的跨位置設計與切換方式 |
| 網站與資料層都具備跨 AZ 運作能力 | 可針對單一 AZ 不可用設計持續服務 | 健康檢查、流量轉移、足夠容量及故障情境驗證 |
| 另外在 Region 乙準備部署與資料副本 | 可針對區域級事件規劃復原 | 跨區域同步、切換與切回、一致性及依賴管理 |

這個比較依 AWS Well-Architected 的多位置設計原則整理：運算分散後，
仍須讓流量能到健康的元件，並處理資料的可用性；跨 Region 也必須準備相應的基礎設施與資料。
見 [REL10-BP01：多 AZ 與多 Region 的實作考量](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_fault_isolation_multiaz_region_system.html)。

**Multi-AZ 表示跨同一 Region 的多個 AZ；multi-Region 表示跨多個 Region。**
前者不能直接當作區域級事件的復原方案。後者也增加同步與維運複雜度，
不能只由「位置更多」推定整體更可靠。相同官方文件也將不必要地採用多 Region，
以及忽略元件依賴，列為應避免的模式。

## 故障隔離、自動切換與備份分開理解

位置分散提供隔離基礎；**是否自動 failover（故障切換），取決於服務能力、設定與應用設計**。
例如跨 AZ 的網站還要有健康檢查與流量轉移，自行管理的資料庫也需要自己的複寫與切換機制。
不能把「建在兩個 AZ」當成這些機制已完成。
見 [Well-Architected：Deploy the workload to multiple locations](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_fault_isolation_multiaz_region_system.html)。

備份則處理另一個問題：能否把資料復原到需要的狀態。
在網站情境中，即使另一個 AZ 仍可服務，編輯誤刪文章後，團隊仍需要可用的復原機制。
AWS 把備份資料、應用與設定，以及定期實際復原來驗證流程，列為獨立工作。
見 [Well-Architected：Back up data](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/back-up-data.html)。
因此，跨位置副本、服務不中斷與資料可復原，應分別確認。

## 跨區域資料、延遲與費用

跨 Region 部署時，要明確知道哪些資料會被複製、何時抵達，以及另一端是否已可使用。
以 S3 為例，Cross-Region Replication 可在不同 Region 的 bucket 之間非同步複製物件，
但必須設定複寫；一般 live replication 不會自動補齊設定前已存在的所有物件，既有物件另有 Batch Replication。
這個例子用來說明：支援跨區域複寫，不等於已經有完整且即時一致的副本。
見 [S3：Replicating objects within and across Regions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html)。

延遲、資料所在地要求與服務支援範圍，都是理解部署位置時應帶入的條件。
AWS 說明，接近主要使用者的 Region 可降低網路延遲；實際需求仍須考量服務與功能。
這不表示本文能單憑地圖距離推定網站延遲，也不提供合規或地區選型判斷。
見 [AWS Regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)。

費用也不能只算多開幾台伺服器。資料傳輸、另一端的儲存與複寫請求都可能形成計價項目，
實際依服務、方向、Region 與方案而異，不能把「AWS 內部傳輸」一概當成免費。
例如 S3 的價格頁分列資料傳輸與 replication 成本，EC2 也另外說明 Data Transfer。
見 [S3 Pricing](https://aws.amazon.com/s3/pricing/)與 [EC2 On-Demand Pricing](https://aws.amazon.com/ec2/pricing/on-demand/)。
本文不列費率，也未做跨區域效能或成本實驗。

## 相關文件

- [AWS 知識索引](README.md)：回查整體閱讀入口。
- [AWS 與使用者的責任](shared-responsibility.md)：辨認實體基礎設施與應用設計的責任邊界。
- [VPC 與資源連線](vpc-and-resource-connectivity.md)：理解 VPC、子網路與連線。
- [EC2 與 Lambda](ec2-and-lambda.md)：比較不同運算服務的管理方式。
- [S3、EBS 與 EFS](s3-ebs-and-efs.md)：進一步辨認儲存方式及範圍。
