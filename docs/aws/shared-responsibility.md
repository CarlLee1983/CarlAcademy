# AWS 與使用者的責任

把應用放上 AWS 後，機房、硬體與部分軟體由 AWS 維護，但資料該讓誰讀取、程式有沒有漏洞，仍需要有人負責。
**責任共擔模型（shared responsibility model）用來劃分 AWS 與客戶各自管理的範圍；分界會隨服務改變。**
它不是將安全工作平均分成兩半，也不是購買服務後就把所有控制外包。
見 [AWS：Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/)。

本文聚焦 AWS 的責任邊界；若需要雲端與服務模式背景，可先讀[雲端運算與服務模式](cloud-computing-and-service-models.md)。
查證日期：2026-11-02。僅查閱官方文件，未登入 AWS、建立資源、執行 CLI／SDK 或驗證產品操作；本文不列費率。
以下情境均為假想例子，不代表實測結果。服務功能與政策會更新，不能把某項產品的分工套用到所有 AWS 產品。

## Security of the cloud 與 security in the cloud

AWS 用兩個容易混淆的介系詞描述分工：

| 用語 | 責任方向 | 例子 |
| --- | --- | --- |
| 雲端本身的安全（security **of** the cloud） | AWS 保護支撐服務的基礎設施 | 實體設施、硬體、底層網路與服務基礎軟體 |
| 雲端之中的安全（security **in** the cloud） | 客戶管理自己使用服務的方式 | 資料、存取權限、可配置的安全設定；依服務管理 OS 與應用 |

因此，不能只問「網路安全歸誰」。底層網路的保護與客戶設定的連線規則，是不同工作。
分工依服務、整合方式與適用要求而定，見 [AWS 責任共擔模型](https://aws.amazon.com/compliance/shared-responsibility-model/)。
例如在 EC2，客戶要配置 VPC 與 security group 來控制 instance 的網路存取，也要管理登入憑證和 instance 的 IAM role。
見 [Security in Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security.html)。

## 同一項工作，到了不同服務會有不同分界

以下只比較一般 EC2 instance、S3 與 Lambda 事件函式的代表性工作，不是完整責任清單。

| 服務 | AWS 管理的部分 | 使用者仍要管理的部分 |
| --- | --- | --- |
| EC2 | 底層實體基礎設施與虛擬化層 | 客體 OS、修補、自行安裝的軟體、登入憑證、網路規則與 IAM role 權限 |
| S3 | 儲存服務的基礎設施、OS 與平台 | 資料分類、物件擁有權、存取設定、加密選項與所需偵測控制 |
| Lambda | 函式執行的底層基礎設施；支援中託管 runtime 的安全更新發布 | 應用程式與所帶入的依賴、權限及資料使用；依部署與更新模式承接 runtime 更新工作 |

EC2 分工見 [EC2 安全文件](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security.html)與
[AWS 責任共擔模型](https://aws.amazon.com/compliance/shared-responsibility-model/)；
S3 分工見 [S3 安全文件](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security.html)；
Lambda 分工見 [Lambda 安全文件](https://docs.aws.amazon.com/lambda/latest/dg/lambda-security.html)、
[runtime 責任分工](https://docs.aws.amazon.com/lambda/latest/dg/runtime-management-shared.html)與
[runtime 文件](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)。

**EC2 的客體 OS（guest OS）是使用者 instance 裡的作業系統，不是 AWS 主機底層的 OS。**
AWS 維護底層主機，並不會因此替客戶修補自行安裝在 guest OS 裡的網站伺服器。
見 [EC2：Security in the cloud](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security.html)。

S3 這類抽象化服務則以服務端點提供資料存取，使用者不必登入 S3 的底層主機修補 OS。
這項管理負擔移交給 AWS，資料與權限的決策仍在客戶端。
見 [AWS：Abstracted services](https://aws.amazon.com/compliance/shared-responsibility-model/)。

Lambda 還說明了「AWS 發布修補」與「既有應用採用修補」的差別。
託管 runtime 的 Auto 模式由 Lambda 套用 runtime 更新；Function update 模式須由客戶定期更新函式，才帶入更新；Manual 模式須自行選用更新版本。
若使用容器映像，AWS 發布更新的基底映像，客戶仍須重新建置並部署自己的映像。
見 [Lambda runtime management shared responsibility](https://docs.aws.amazon.com/lambda/latest/dg/runtime-management-shared.html)。
跨語言主要版本的升級則由客戶主導，不能視為 runtime 自動修補的一部分。
見 [Lambda Event Function runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)。

## 資料、身分與設定不會因託管而消失

以 S3 為例，客戶仍須辨認資料敏感程度、管理物件擁有權與加密、設定 IAM 及服務存取權限，並啟用所需的偵測控制。
見 [S3：Security in the cloud](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security.html)。
可以把這些工作理解成幾個相連的問題：

- **資料分類**：這是公開圖片、內部文件，還是含有個人資訊的資料？分類提供後續保護要求的依據。
- **身分與權限**：哪些人或程式可讀取、寫入、刪除資料？應用能存取資料，不代表整個帳戶都應有同等權限。
- **服務設定**：資源是否允許公開存取？設定是否符合資料預期用途？
- **加密與可觀察性**：選用的加密方式與存取控制是否符合需求？需要哪些操作紀錄與偵測能力？

以上是依官方責任項目整理的檢視問題，不是對特定工作負載的設定處方。
**加密也不能取代授權。**S3 將加密與資料存取管理分別列為責任項目；即使資料有加密，仍要管理誰可以透過服務讀取它。
見 [Security in Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security.html)。

## 共用控制：名稱相同，執行的對象不同

責任共擔也適用於 IT 控制。AWS 區分可繼承的控制、共用控制，以及客戶特有控制。
其中 **shared controls 不表示雙方共同操作同一套設定**，而是同類控制分別作用在各自的環境。

| 控制類型 | 如何理解 |
| --- | --- |
| 可繼承的控制（inherited controls） | 例如由 AWS 執行的實體與環境控制，客戶不必自己營運 AWS 機房 |
| 共用控制（shared controls） | 例如 AWS 修補基礎設施，客戶修補自己管理的 guest OS 與應用；雙方也各自訓練自己的員工 |
| 客戶特有控制（customer-specific controls） | 例如依應用需求安排資料的安全區域與通訊保護 |

分類與例子見 [AWS：IT controls](https://aws.amazon.com/compliance/shared-responsibility-model/)。
讀到「AWS 有修補管理」時，應接著確認它涵蓋的層次，而不能推得自己的應用已完成修補。

## 三個假想情境：責任落在哪裡

### EC2 的網站套件出現漏洞

團隊把網站部署到 EC2，在客體 Linux 裡安裝網站伺服器。套件出現安全更新後，AWS 機房仍正常運作，並不代表套件已更新。
客戶須管理 guest OS 與其中的應用修補，也須確認 instance 的連線規則與角色權限。
這些是 [EC2 安全文件](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security.html)明列的客戶範圍。
此例的分界在「網站套件由誰管理」，與硬體放在哪裡無關。

### S3 裡的內部報表被錯誤設定為可公開讀取

假設團隊調整了公開存取保護與 bucket policy，使內部報表可被公開讀取；這不是要求客戶去修補 S3 底層 OS 的問題，而是資料存取設定的問題。
S3 提供 Block Public Access，在適用層級阻擋公開存取；能否公開還須看實際政策與有效設定，不能僅由「建立了 bucket」推斷。
見 [Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)。
團隊應檢查報表分類、預期讀者與有效權限；AWS 管理儲存平台，不會替團隊決定內部報表的業務讀者。
資料與權限責任見 [S3 安全文件](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security.html)。

### Lambda 的 runtime 已更新，部署包裡的依賴仍有漏洞

團隊使用託管 runtime 與 Auto 更新模式，卻在部署包內帶入有漏洞的第三方套件。
runtime 的更新不等於部署包也被重寫；客戶仍要更新自行包含的依賴並重新部署。
官方 runtime 文件將部署包中的函式程式與依賴更新列為客戶責任，見
[Lambda runtimes：Shared responsibility model](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)。
若改用容器映像，即使 AWS 已發布新的基底映像，既有函式也仍須由客戶重建與部署才能採用，見
[Lambda runtime 責任分工](https://docs.aws.amazon.com/lambda/latest/dg/runtime-management-shared.html)。

## AWS 的合規證據，不能直接當成整個應用的合規結論

使用已納入某合規計畫的服務，可取得對應的 AWS 控制證據，但客戶自己的資料用途、權限、流程與設定仍須符合要求。
S3 官方文件明確區分第三方對 AWS 的稽核，以及由資料敏感度、組織目標與適用法規決定的客戶責任；也提供服務涵蓋範圍與 AWS Artifact 報告的入口。
見 [Compliance validation for Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-compliance.html)。

因此，「可繼承實體機房控制」不能擴大解讀成「自動繼承所有合規要求」。
同樣地，託管服務並不免除權限管理，AWS 修補底層也不代表所有應用依賴已更新。
判斷責任時，先列出具體資源與工作，再讀各項服務的安全及維護文件，才能辨認真正移交與保留的部分。

## 相關文件

- [AWS 知識索引](README.md)：回查服務分類與閱讀入口。
- [雲端運算與服務模式](cloud-computing-and-service-models.md)：理解服務交付層次。
- [帳戶、身分與權限](accounts-identities-and-access.md)：辨認帳戶、身分、驗證與授權。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：深入理解權限配置。
- [EC2 與 Lambda](ec2-and-lambda.md)：比較運算服務的管理邊界。
- [S3、EBS 與 EFS](s3-ebs-and-efs.md)：比較資料存取方式與儲存用途。
