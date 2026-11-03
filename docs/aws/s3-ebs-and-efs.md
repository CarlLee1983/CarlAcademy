# S3、EBS 與 EFS

儲存一張圖片、保存作業系統，以及讓多台主機讀寫同一個目錄，都涉及保存資料，程式使用的介面卻不同。**S3 提供物件儲存，EBS 提供區塊儲存，EFS 提供可共享的網路檔案系統。**先分清資料單位與存取方式，才能理解三者的責任與限制。
產品定位見 [S3 導論](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)、[EBS 導論](https://docs.aws.amazon.com/ebs/latest/userguide/what-is-ebs.html)與 [EFS 導論](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html)。

查證日期：2026-11-02。本文僅查閱 AWS 官方文件，未登入 AWS、建立資源、執行 CLI／SDK、掛載檔案系統或進行效能實測。以下情境均為假想例子，不提供費率或特定工作負載的選型建議。

本文以一般 AWS Region 中的 S3 general purpose bucket、EC2 使用的 EBS volume，以及 EFS 檔案系統為主；涉及單 AZ 類型時另行標示，不將一般情況套用到所有部署形式。
Linux 的裝置、檔案系統與掛載點關係，見[儲存與檔案系統](../linux/storage-and-filesystems.md)；EC2 如何串接資料路徑與生命週期，見 [EC2 與資料儲存](ec2-and-data-storage.md)。

## 三種模型：程式到底在操作什麼？

| 服務與模型 | 資料如何組織 | 程式的典型存取方式 | 誰管理檔案系統？ |
| --- | --- | --- | --- |
| S3：物件（object） | bucket 中以 key 識別物件，物件帶有內容與中繼資料 | 對服務端點呼叫物件 API，例如上傳與下載 | 使用者不在 bucket 上自行建立 ext4 等磁碟檔案系統 |
| EBS：區塊（block） | 一個 volume 提供區塊裝置 | 附加到 EC2 後，由 OS 進行區塊 I/O；上層可使用檔案系統 | 使用者管理 guest OS 內的檔案系統與掛載 |
| EFS：檔案（file） | 託管檔案系統中的檔案與目錄 | NFS 用戶端透過網路掛載，再用檔案操作介面讀寫 | AWS 管理檔案儲存基礎設施；使用者管理用戶端掛載、檔案權限與應用 |

表中介面分工依 [S3 物件模型](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)、[EBS volume](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)與 [EFS 運作方式](https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html)整理。
Console、CLI 或 SDK 可以管理這些資源，但「建立 volume 的 API」與「應用透過磁碟讀寫資料」是不同路徑；EFS 建立檔案系統的管理介面也不等於應用的 NFS 存取介面。

## S3：bucket、key 與物件 API

在 general purpose bucket 中，bucket 是物件的容器；key 是物件在 bucket 內的名稱。例如假想圖片使用 key `images/course-cover.jpg`，`images/` 是名稱前綴。Console 可把它顯示成資料夾，但這種 bucket 的底層名稱空間是平面的，沒有對應的一層實體子目錄。見 [S3 物件命名](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html)與 [Console 的資料夾表示法](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-folders.html)。

應用可對指定 bucket 與 key 呼叫 `PutObject`、`GetObject` 等 API。這不等於 OS 得到一顆一般 POSIX 磁碟，也不能因為 key 含有斜線，就假定應用原有的檔案開啟、原地修改與鎖定語意全都適用。資料模型與 API 入口見 [S3 導論](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)。若另外使用把物件呈現成檔案的工具，仍須依該工具確認支援的操作，不能把顯示成目錄當作語意完全相同。

### S3 的位置與保留方式

Bucket 建立時會選擇 Region，但資料是否跨 AZ 冗餘保存，還要看 bucket 類型與物件的 storage class：

- 一般 Region 內的 S3 Standard、Standard-IA 等類別，資料會冗餘保存於多個 AZ。
- **S3 One Zone-IA** 保存在單一 AZ，不能抵抗該 AZ 的實體損失。
- **S3 Express One Zone** 使用 directory bucket，在選定的單一 AZ 保存資料。Directory bucket 是另一種 bucket 類型，有自己的組織方式與功能限制；不能直接套用 general purpose bucket 的全部規則。

範圍與例外見 [S3 storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)及 [S3 bucket 類型](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)。這裡不是所有 S3 bucket 類型或 Local Zone／Outposts 部署的完整清單。

物件不依附某台 EC2 的運行生命週期；但資料仍可能因刪除、覆寫或 Lifecycle 到期而改變。General purpose bucket 可啟用 Versioning 保存物件版本，協助復原誤刪或覆寫；版本保留與生命週期政策仍需管理。見 [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)與 [S3 儲存管理功能](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)。

## EBS：附加到 EC2 的區塊裝置

EBS volume 可作為 EC2 的系統磁碟或資料磁碟。**Volume 與附加的 instance 必須位於同一 AZ。**它的資料會在該 AZ 內冗餘保存，不代表 volume 已自動跨 AZ 提供同一個可附加裝置。見 [EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)與 [EBS 資料保護](https://docs.aws.amazon.com/ebs/latest/userguide/what-is-ebs.html)。

對 Linux 而言，可將關係理解為「EBS volume → guest OS 看見的區塊裝置 → 檔案系統 → 掛載目錄」。空白 volume 並不自帶使用者需要的檔案系統；以既有快照還原的 volume 則可能已有格式與資料。附加裝置、建立檔案系統與掛載是不同動作，不能把新附加的既有資料磁碟當成空白磁碟重新格式化。區塊層與掛載層背景見 [Linux：儲存與檔案系統](../linux/storage-and-filesystems.md)，產品介面見 [EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)。

### 持久不代表終止後一定留下

EBS 可獨立於 EC2 的運行生命週期存在；不過終止 instance 時，每個 EBS 裝置映射的 **`DeleteOnTermination`** 會決定 volume 是否一併刪除。值為 `true` 時刪除，`false` 時保留。預設值受到 AMI、附加時機與操作入口等條件影響，不能只憑「這是資料磁碟」判斷。見 [EC2 終止時保留資料](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html)。

EBS snapshot 是 volume 的時間點備份，可由它建立新的 volume。**AWS 不會僅因建立 EBS volume，就自動定期備份內容**；使用者要建立快照，或配置 Data Lifecycle Manager、AWS Backup 等排程與保留政策。一般 Region 的 snapshot 資料跨 AZ 保存，可在該 Region 的其他 AZ 還原成新 volume，這與讓原 volume 跨 AZ 同時附加不同。見 [EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)。

### Multi-Attach 的例外邊界

一般理解 EBS 時，可先從「某台 EC2 使用附加的區塊裝置」開始，但不能寫成 EBS 永遠只允許一台 instance 使用。Multi-Attach 能讓啟用此功能的 `io1`／`io2` Provisioned IOPS SSD volume，附加到同 AZ 的多台支援 Nitro instance；OS、volume 與 instance 類型仍有支援條件，並非所有 EBS 類型都適用。

**多台主機看見同一個區塊裝置，不代表它們可以安全地同時寫入一般 ext4 或 XFS。**應用與檔案系統仍須具備協調共享寫入所需的能力；Multi-Attach 不會自動處理寫入順序或讓一般檔案系統變成叢集檔案系統。完整條件見 [EBS Multi-Attach](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes-multi.html)。

## EFS：多個用戶端共享一個檔案系統

EFS 提供 NFSv4 檔案存取，可讓多個用戶端同時使用同一份檔案與目錄。EC2 不必各自建立一份檔案系統再自行同步內容；它們透過 EFS mount target 的網路端點存取同一個遠端檔案系統。Mount target 是存取入口，不是另一份供使用者管理的獨立資料磁碟。見 [EFS 運作方式](https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html)。

EFS 的兩種檔案系統類型有不同故障範圍：

| 檔案系統類型 | 資料保存範圍 | 要注意的邊界 |
| --- | --- | --- |
| Regional | 同一 Region 的多個 AZ 冗餘保存 | 跨 AZ 儲存不等於已部署好每個用戶端的網路、mount target 與應用容錯 |
| One Zone | 單一 AZ 保存 | 若該 AZ 損壞或喪失，資料可能遺失；其他 AZ 的用戶端能連線也不會改變資料保存位置 |

類型差異見 [EFS features：Availability and durability](https://docs.aws.amazon.com/efs/latest/ug/features.html)，跨 AZ 用戶端與 mount target 關係見 [How EFS works](https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html)。因此，不能把「EFS 支援多台用戶端」寫成「所有 EFS 都跨 AZ 保存」。

檔案系統不依附任一台用戶端的運行生命週期；但共享同一檔案系統也表示，一個有權限的用戶端刪除檔案，會影響其他用戶端。EFS 提供 NFS 檔案鎖定，鎖是 advisory locking；應用仍須遵循 NFS 的一致性與協作規則，不能假定所有並行修改都會被自動序列化。見 [EFS data consistency 與 file locking](https://docs.aws.amazon.com/efs/latest/ug/features.html)。

備份則是另一項配置。EFS 整合 AWS Backup；自動備份預設值會隨建立入口及檔案系統類型而不同，因此應核對實際備份排程、保留與還原安排，不能從「託管」推得所有檔案都有所需歷史版本。見 [Backing up EFS file systems](https://docs.aws.amazon.com/efs/latest/ug/awsbackup.html)。

## 存取權限、網路與加密是不同邊界

三者都需要授權管理，但控制落點不相同：

| 邊界 | S3 | EBS | EFS |
| --- | --- | --- | --- |
| AWS 身分與 API 權限 | IAM 與 bucket 等政策判定物件操作 | IAM 控制建立、附加、刪除等資源管理操作 | IAM 控制資源管理；NFS 用戶端亦可配置 IAM 授權 |
| 資料存取入口 | S3 服務端點與物件 API | 附加後由 instance 的 OS 進行磁碟 I/O | 經網路連至 mount target，再透過 NFS 操作 |
| 檔案層控制 | 不能把 POSIX mode 套用到一般物件 | 使用者管理 guest OS 的檔案權限 | 以數值 UID／GID 及 Unix-style mode 管理檔案與目錄 |

S3 權限模型見 [S3 access control](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-management.html)，EBS 管理權限見 [EBS 與 IAM](https://docs.aws.amazon.com/ebs/latest/userguide/security_iam_service-with-iam.html)，EFS 見 [NFS client IAM authorization](https://docs.aws.amazon.com/efs/latest/ug/iam-access-control-nfs-efs.html)與 [NFS users and permissions](https://docs.aws.amazon.com/efs/latest/ug/accessing-fs-nfs-permissions.html)。EBS 的管理授權與 OS 讀寫權限分工也可對照 [AWS 與使用者的責任](shared-responsibility.md)。

對 EFS，security group 控制到 mount target 的 NFS 網路流量；連得上並不代表某個 UID 可以修改每個目錄。反過來，取得 IAM 權限也不會自動打通網路。NFS client 使用 IAM 授權須搭配 EFS mount helper；沒有自訂 file system policy 時，預設政策不使用 IAM 驗證可連線用戶端，不能以為 EC2 有 role 就已啟用這層保護。見 [EFS security groups](https://docs.aws.amazon.com/efs/latest/ug/network-access.html)、[EFS IAM 授權與預設政策](https://docs.aws.amazon.com/efs/latest/ug/iam-access-control-nfs-efs.html)。

加密保護資料保存或傳輸時的內容，但不替代上述授權：

- S3 新上傳物件預設有伺服器端靜態加密；使用 SSE-KMS 時，相關操作還涉及 KMS key 權限。S3 的物件讀取權限與 KMS 的解密權限要分別判斷。見 [SSE-S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingServerSideEncryption.html)與 [SSE-KMS permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html)。
- EBS encryption 使用 KMS key，保護 volume、相應 snapshot，以及 instance 與 EBS 之間的資料傳輸；這不是限制 guest OS 裡每個程序能讀哪些檔案的機制。見 [EBS encryption](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-encryption.html)。
- EFS 分別提供靜態與傳輸中加密；靜態加密涉及 KMS key 管理，傳輸加密則保護用戶端與檔案系統間的流量。檔案存取仍須由政策、網路與檔案權限控制。見 [EFS encryption](https://docs.aws.amazon.com/efs/latest/ug/encryption.html)與 [Encryption at rest](https://docs.aws.amazon.com/efs/latest/ug/encryption-at-rest.html)。

## 把三種模型放回假想網站

以下是解釋介面的例子，不是部署處方或成本比較：

| 網站中的資料 | 假想安排 | 此例要辨認的介面與責任 |
| --- | --- | --- |
| 課程封面圖片 | 圖片作為 S3 物件，以 bucket 與 key 識別 | 應用透過物件 API 上傳／取得內容；圖片是否可公開由有效權限決定 |
| 一台 EC2 的作業系統 | 使用 EBS-backed 系統 volume | OS 從區塊裝置使用檔案系統；終止時是否刪除須看裝置映射設定 |
| 多台應用節點共同使用的匯入目錄 | 用戶端掛載同一個 EFS 檔案系統 | 透過 NFS 共享路徑；網路、UID／GID 與應用協作都要一致理解 |

這些是假想資料需求對照前述產品介面的編輯例子。單一網站可以同時包含多種儲存介面，但「都是檔案」不能推出它們具有相同的讀寫、鎖定、故障或刪除語意。

**可用性、持久性與可復原性也要分開觀察。**前者問當下能否服務讀寫，持久性問資料是否仍保存，而復原還涉及誤刪前的版本、快照或備份是否存在，以及是否能還原。跨 AZ 冗餘並不會自動撤銷合法的刪除操作。上述區分依 [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)、[EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)與 [EFS backups](https://docs.aws.amazon.com/efs/latest/ug/awsbackup.html)的復原機制整理，本文未測試任何還原流程。

## 相關文件

- [AWS 知識索引](README.md)：服務分類與閱讀入口。
- [Region 與 Availability Zone](regions-and-availability-zones.md)：理解資源位置與故障範圍。
- [AWS 與使用者的責任](shared-responsibility.md)：託管儲存與資料管理的分界。
- [EC2 與資料儲存](ec2-and-data-storage.md)：將儲存接到 EC2 的資料路徑與生命週期。
- [VPC 與資源連線](vpc-and-resource-connectivity.md)：連線路徑與網路控制。
- [Linux：儲存與檔案系統](../linux/storage-and-filesystems.md)：區塊裝置、檔案系統、掛載與備份的共通知識。
