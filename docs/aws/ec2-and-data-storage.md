# EC2 與資料儲存

一台 EC2 instance 執行網站，不代表網站的所有資料都放在這台機器裡，也不代表機器終止時所有資料都會一起消失。**先追問程式透過什麼介面讀寫，再追問那份資料由什麼資源保存，才能判斷停止、換機與誤刪的影響。**EC2 的生命週期與儲存差異見 [EC2 instance state changes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)。

本文接續 [EC2 與 Lambda](ec2-and-lambda.md)及 [S3、EBS 與 EFS](s3-ebs-and-efs.md)，不重列完整產品比較，而以一個假想文章網站串起資料路徑、生命週期與復原。讀者只需知道 instance 是執行程式的虛擬伺服器；裝置、檔案系統與掛載的共通背景可回查 [Linux：儲存與檔案系統](../linux/storage-and-filesystems.md)。

查證日期：2026-11-02。本文僅查閱 AWS 官方文件，未登入 AWS、建立資源、執行 CLI／SDK、掛載儲存、刪除資料或實測還原。以下網站、路徑與故障流程都是概念例子，不是已驗證的部署步驟；不列費率或硬性配額。範圍以一般 AWS Region、Linux EBS-backed EC2、S3 general purpose bucket 與 EFS 為主。

## 先替網站的每種資料找出保存位置

假設網站提供文章與圖片上傳，還有背景程序處理圖片，以及兩台網站節點共同讀取的匯入目錄。以下安排只是為了同時看見幾種資料路徑，不表示每個網站都需要全部服務。

| 網站需要的資料 | 假想保存位置 | 程式如何接觸資料 | 遺失後的期望 |
| --- | --- | --- | --- |
| OS、套件與已部署程式 | EBS root volume | guest OS 從區塊裝置上的檔案系統讀取 | 能以映像與部署設定重建 |
| 圖片轉換的中間檔 | 支援 instance store 的機型所提供的本機暫存 | OS 經區塊裝置與檔案系統使用假想的 `/scratch` | 能從原圖重新產生 |
| 使用者上傳的原圖與完成的縮圖 | S3 bucket 中的物件 | 應用以 bucket、key 呼叫物件 API | 機器替換後仍能取得；誤刪另靠保留機制 |
| 多台節點共同使用的匯入檔 | EFS 檔案系統 | NFS 用戶端掛載假想的 `/shared` | 新節點重新掛載後接續使用 |

這是依 [EBS volume](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)、[instance store](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/InstanceStorage.html)、[S3 物件模型](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)與 [EFS 運作方式](https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html)組合的編輯例子。Instance store 並非所有機型都有；`/scratch` 只是本文自訂名稱，不能從 `/tmp` 或任何路徑名稱推斷其底層必然是 instance store。

```text
假想 Region
  AZ-A
    EC2 A：網站／背景程序
      ├─ OS 檔案 I/O → guest 檔案系統 → 區塊裝置 → EBS root volume（AZ-A）
      ├─ 暫存檔 I/O → guest 檔案系統 → 區塊裝置 → instance store（所在主機）
      ├─ SDK／HTTPS 物件 API ───────────────────────→ S3 bucket
      └─ NFS 用戶端 → 網路 → EFS mount target A ──┐
                                                 │
  AZ-B                                           ├→ 同一個 EFS Regional 檔案系統
    EC2 B → NFS 用戶端 → 網路 → EFS mount target B ┘
      └─ 自己的 OS volume：EBS（AZ-B）
```

圖中的 S3 使用 S3 Standard、EFS 使用 Regional 作為例子；並非所有 S3 storage class 或 EFS 類型都跨 AZ 保存。**圖中沒有讓 AZ-B 的 EC2 直接附加 AZ-A 的 EBS volume**：EBS volume 與 instance 必須在同 AZ。位置限制見 [EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)，單 AZ 例外見 [S3 storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)與 [EFS features](https://docs.aws.amazon.com/efs/latest/ug/features.html)。

## 三條資料路徑，各有自己的控制邊界

### EBS：先附加裝置，再由 OS 使用檔案系統

EC2 的管理介面把 EBS volume 附加給 instance；進入 guest OS 後，OS 看見的是區塊裝置，上層才是分割區、檔案系統與掛載路徑。空白資料 volume 要先具備適當檔案系統才能當一般目錄使用；由 snapshot 建立的 volume 則可能已包含檔案系統。**「附加成功」與「應用已能從指定路徑讀取正確資料」是不同結果。**見 [EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)及 [EBS-backed AMI 的 volume 說明](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating-an-ami-ebs.html)。

這也分出兩種權限：誰能呼叫附加、建立或刪除 volume 的 AWS API，以及 guest OS 內哪個程序能讀寫裝置與檔案。不能把授予 instance role 某個 AWS 管理動作，理解為 OS 自動替應用完成掛載和檔案權限設定。AWS 管理授權背景見 [EBS 與 IAM](https://docs.aws.amazon.com/ebs/latest/userguide/security_iam_service-with-iam.html)，OS 層連回 [Linux：儲存與檔案系統](../linux/storage-and-filesystems.md)。

### S3：程式呼叫服務 API，並未獲得一顆磁碟

假想上傳流程是「網站接收圖片 → 應用呼叫 `PutObject` → 記錄 bucket 與 key」；讀圖時再以對應物件 API 取得內容。S3 的 bucket 不會因為 EC2 使用它，就成為 guest OS 的 EBS 裝置。另用工具把物件呈現成目錄時，也要另查其檔案語意，不能直接假定與一般 POSIX 檔案系統相同。見 [S3 運作與存取方式](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)。

EC2 上的應用可透過 instance profile 中的 IAM role 取得暫時憑證，簽署 AWS API 請求；不必把長期 access key 寫進系統映像。**有 role 不等於有全部 S3 權限**：角色與其他適用政策仍要允許指定操作及資源，網路也要能抵達服務端點。見 [EC2 應用使用 IAM role](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html)及 [S3 access control](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-management.html)。網路與政策的分工見 [VPC 與資源連線](vpc-and-resource-connectivity.md)、[IAM 的身分與權限](iam-identities-and-permissions.md)。

### EFS：掛載的是遠端檔案系統

EC2 的 NFS 用戶端透過 mount target 連到 EFS，掛載後應用以檔案與目錄操作使用它。另一台 instance 可以掛載同一個檔案系統；它不是取得同一顆 EBS 區塊裝置，也不是各自持有一份互不相干的目錄。見 [How EFS works](https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html)。

連線與存取至少要分三層理解：

1. **網路**：用戶端須能連到 mount target 的 NFS TCP 2049，相關路由、security group 與網路 ACL 必須容許流量及回程。見 [EFS network access](https://docs.aws.amazon.com/efs/latest/ug/network-access.html)。
2. **檔案權限**：EFS 使用數值 UID／GID 與 Unix-style mode 判斷檔案操作；兩台主機顯示同一個使用者名稱，不保證對應同一個數值身分。見 [EFS NFS users and permissions](https://docs.aws.amazon.com/efs/latest/ug/accessing-fs-nfs-permissions.html)。
3. **可選的 NFS client IAM 授權**：要使用 EFS mount helper 並配置 IAM 授權，不能只給 EC2 一個 role 就以為已啟用。沒有自訂 file system policy 時，預設政策不以 IAM 驗證可連線的匿名用戶端；檔案層權限仍另外適用。見 [EFS IAM authorization](https://docs.aws.amazon.com/efs/latest/ug/iam-access-control-nfs-efs.html)。

共享也需要應用協調。若兩個背景程序同時重寫同一份匯入檔，EFS 不會替業務決定誰的版本正確；它的 NFS 檔案鎖是 advisory locking，程序必須遵守鎖定與一致性語意。見 [EFS consistency and file locking](https://docs.aws.amazon.com/efs/latest/ug/features.html)。

EBS Multi-Attach 也不能省略這件事：它是在支援條件下，讓同 AZ 多台 instance 存取同一個特定類型 volume；一般 ext4／XFS 並不是可由多台主機安全同時寫入的叢集檔案系統，寫入順序與協調仍由適當的檔案系統及應用負責。見 [EBS Multi-Attach](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes-multi.html)。

## 重開機、停止、終止與換機，資料會怎樣？

下表的 stop 指一般停止，不含 hibernation；reboot 指一般重新開機，不涵蓋所有硬體故障。記憶體中尚未寫出的資料和磁碟上已保存的資料，不能合稱為「還在機器裡」。

| 資料或狀態 | Reboot | Stop／start | Terminate | 以另一個 instance 替換 |
| --- | --- | --- | --- | --- |
| RAM、程序執行狀態 | 不保留原執行狀態 | 不保留 | 不保留 | 不會移轉到新機器 |
| EBS 上已保存的內容 | 保留 volume | 保留 volume | 每個 volume 依 `DeleteOnTermination` | 須選擇重新使用保留 volume，或由 snapshot／AMI 建立新 volume |
| Instance store 上的內容 | 一般 reboot 保留 | 遺失 | 遺失 | 不會從舊 instance store 自動帶過去 |
| S3 物件、EFS 檔案 | 不因這次 instance 狀態操作而刪除 | 同左 | 同左 | 新 instance 仍須取得權限及正確連線／掛載設定 |
| 機器內的設定 | 磁碟設定可保留；程序仍須啟動 | EBS 設定可保留；程序仍須啟動 | 隨保存位置及刪除設定判斷 | 新機器只會取得映像／部署流程明確帶入的內容 |

EC2、RAM、EBS 與 instance store 的狀態差異依 [EC2 lifecycle](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)及 [instance store persistence](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-store-lifetime.html)整理；S3／EFS 與新用戶端的關係依前述 [S3 介面](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)、[EFS 介面](https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html)推導。這裡假設沒有應用清理程序、其他操作者或自動化同時刪除外部資料。

**Root volume 與 data volume 都要核對實際 `DeleteOnTermination`，不能只靠名稱判斷。**`true` 表示隨 instance 終止刪除，`false` 表示保留。Root 在啟動時通常預設刪除；data volume 的預設還受附加時機、操作入口與 AMI 映射影響。見 [Preserve data when an instance is terminated](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html)。

例如假想圖片只留在 instance store，即使一般 reboot 沒丟失，也不能據此宣稱它是持久儲存；stop、terminate 或底層磁碟故障仍可能使它消失。見 [instance store persistence](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-store-lifetime.html)。Hibernation 另有前提，會把 RAM 保存至 EBS root volume；不能把這個例外當成一般 stop 的行為。見 [EC2 hibernated instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)。

## 保存原資料、做備份與能重建，是三件事

### Snapshot 與 AMI 分別保存什麼？

EBS snapshot 保存 volume 的時間點資料，可用來建立新 volume。一般 Region 的 snapshot 資料跨 AZ 保存，因此可以在同 Region 的其他 AZ 建立還原 volume；原本的 EBS volume 仍不能直接跨 AZ 附加。建立 EBS volume 本身不會自動替資料安排定期 snapshot，須另配置排程與保留。見 [EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)。

AMI 則是啟動 instance 的映像與 block device mapping。EBS-backed AMI 使用對應的 EBS snapshot 來建立新機器的磁碟；它不會持續追蹤來源機器後來的所有變更，也不會把外部 S3 bucket、EFS 內容或 RAM 包成整個網站的備份。EBS-backed AMI 也不保存來源 instance store 的內容。映像範圍見 [AMI](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html)與 [Create an EBS-backed AMI](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating-an-ami-ebs.html)。

因此，假想網站的重建資料要分別記錄：啟動哪個映像與程式版本、使用哪些 bucket／key、掛載哪個檔案系統，以及所需角色、網路與程序啟動設定。這是依上述資源分工推導的責任清單；只保存一份舊 AMI，不能證明整個網站可復原。

### 備份取得當下，應用是否處於一致狀態？

EBS snapshot 只包含提出快照要求時已寫入 volume 的資料，不包含應用或 OS 還留在快取中的內容。AWS 建議在取 snapshot 前暫停寫入；root volume 則建議先停止 instance。跨多個 volume 的工作還要確認是否採用協調的 multi-volume snapshot，而不能把不同時間各取一份視為同一個應用時間點。見 [Create EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-creating-snapshot.html)。

建立 EBS-backed AMI 預設會經由關機／重開機使磁碟處於靜止狀態；略過這個過程時，AWS 不保證檔案系統完整性。支援的檔案系統可用 freeze／unfreeze 協助控制 I/O，但其適用方式仍要依檔案系統與工作負載確認。見 [AMI creation consistency](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating-an-ami-ebs.html)。

若 EBS 上還放了自管資料庫，則需進一步問「資料庫能否從這個狀態恢復」：僅 freeze 檔案系統，不等於已證明資料庫交易與多個資料檔案一致。是否需要先做資料庫原生備份、檢查點、交易日誌保存或暫停寫入，須依資料庫官方備份程序判定。這是依快照不含快取、以及檔案系統與應用分層所作的推論，本文未驗證任何資料庫的還原相容性，也不提供一套通用 freeze 指令。

EFS 備份期間若檔案仍被寫入、改名、移動或刪除，也可能得到不一致內容；AWS 建議在備份期間暫停修改程序，或安排在沒有變動的時段。自動備份預設值依建立入口與檔案系統類型而異，須核對實際 backup plan、保留與完成狀態。見 [EFS backup consistency](https://docs.aws.amazon.com/efs/latest/ug/awsbackup.html)。

### 複寫與冗餘不會自動提供任意歷史版本

冗餘保存有助於承受某些基礎設施故障；復原誤刪則要有刪除前可用的資料。S3 Versioning 預設未啟用；啟用後可保存多個版本，但非目前版本仍可能因 Lifecycle 或明確刪除版本而消失。見 [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)。

S3 Replication 要核對規則涵蓋的物件、是否已完成複寫及 delete marker 的處理；不能宣稱來源的每次刪除都會同步，也不能宣稱永遠不會同步。EFS Replication 會把來源變更同步到目的端，須觀察 last synced time，而不是任選過去時間的備份歷史。見 [S3 replication scope and deletions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-what-is-isnot-replicated.html)與 [EFS replication](https://docs.aws.amazon.com/efs/latest/ug/efs-replication.html)。

因此，是否保留歷史、保留多久、誰能刪除備份及能否還原，應與複寫目的分開確認。備份存在也仍需驗證還原後的資料與應用，不能由排程成功直接推論網站一定能恢復。

## 兩種故障，沿保存機制走不同的復原路徑

以下是推演，沒有執行任何復原或刪除動作；步驟順序用來辨認依賴，不是可直接照做的操作手冊。

### 情境一：網站 instance 已終止，圖片還在嗎？

1. **先找資料資源**：確認 OS／資料 volume 的實際保留結果，並確認 S3 物件與 EFS 仍存在。不要把 instance 已終止誤判成所有儲存都消失。終止與保留依 [EC2 preservation settings](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html)。
2. **重建運算與本機資料**：由合適的 AMI／部署流程建立新 instance。保留的 EBS volume 可在同 AZ 交由新 instance 使用；若 volume 已刪除但有可用 snapshot，則建立新 volume，並以那個時間點的資料為起點。機制見 [EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)、[EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)。
3. **重接外部資料**：新應用須使用正確的 bucket／key、有效 IAM 權限與服務連線；共享目錄則重新具備 NFS 連線、掛載與檔案權限。Instance store 中間檔從原圖重算。機制見 [EC2 role](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html)、[EFS access](https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html)與 [instance store persistence](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-store-lifetime.html)。
4. **核對網站關聯**：檢查文章指向的圖片是否存在、程序是否載入正確設定，以及尚未完成的處理能否安全重試。這是本情境的應用驗收條件，不是 AWS 自動完成的業務檢查。

若唯一原圖曾只存在已遺失的 instance store，或已刪除的 EBS 沒有任何可用備份，重新啟動一台 EC2 並不能重新產生那份原始內容；復原能力取決於之前實際保存了什麼。

### 情境二：Instance 還在，但 S3 圖片被誤刪

1. **先辨認物件與事件**：確認正確 bucket、key 與刪除前版本，不把 API 存取失敗一律判為內容已永久刪除。
2. **檢查歷史是否仍保留**：若刪除前已啟用 Versioning，且操作是一般未指定 version ID 的刪除，可能只是目前版本變成 delete marker；仍保留的舊版本可供取得。明確永久刪除的版本、或已依保留政策清掉的內容，不能只靠 Versioning 找回。機制見 [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)與 [replication deletion semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-what-is-isnot-replicated.html)。
3. **從保留的內容恢復可讀版本**：概念上可把指定舊版本複製成新的目前版本，再核對圖片內容與網站引用；這不是還原 EC2 磁碟。見 [Restoring previous versions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RestoringPreviousVersions.html)。
4. **沒有舊版本時找其他保存來源**：確認事先配置的備份或複寫目的端是否確實還有需要的內容；若沒有，就不能保證能復原。換 instance、重掛 EBS 或讀取 OS 的 AMI 都不會憑空補回獨立 S3 物件。

同理，EFS 檔案被共享用戶端誤刪，換一台 instance 掛載仍會看見刪除後的檔案系統；要評估先前的 recovery point，依需要進行完整或項目層級還原，再驗證內容。這種還原能力見 [EFS backups and restores](https://docs.aws.amazon.com/efs/latest/ug/awsbackup.html)，並不表示本網站已配置或測試過備份。

## 資料保留與成本，分開作決定

停止 instance 後，保留的 EBS 仍有儲存費用；終止 instance 後保留的 volume 也會繼續計費。Snapshot、S3 舊版本、EFS 資料與備份各有自己的保存與計費生命週期。依據見 [EC2 state billing](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)、[EBS preservation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html)、[snapshot storage](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)、[S3 version costs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)及 [EFS pricing](https://aws.amazon.com/efs/pricing/)。

因此，成本管理要追蹤獨立資源，保留政策則先回答需要復原到哪個時間點、可接受多少資料損失，以及多久要恢復服務。清除舊資源前，也須辨認它是否仍是唯一可用的還原來源。本文不據此計算費用；用量與預算觀察見[用量與成本的基本觀察](usage-and-cost-observation.md)。

## 網站團隊要留下的責任清單

以下是由前述邊界整理出的設計與驗收問題，不代表已完成的設定或操作結果：

- **資料位置**：每類資料究竟在 RAM、哪個 volume、哪個 bucket／key 或哪個 EFS 路徑？哪些暫存可重新計算？
- **刪除與保留**：各 EBS 裝置的 `DeleteOnTermination` 為何？S3 的版本與 Lifecycle、EFS 的備份保留，是否符合資料需求？
- **換機重建**：AMI、程式版本、啟動設定、IAM、網路與掛載資訊是否足以讓新 instance 使用仍存在的資料？
- **寫入協調**：是否有兩台程序修改同一份資料？檔案鎖、工作擁有權與重試是否由應用明確處理？
- **備份一致性**：何時暫停寫入、如何保存資料庫狀態、備份是否完成，以及哪些時間點實際能還原？
- **復原驗收與成本**：誰負責還原、驗證文章與圖片關聯，以及追蹤保留 volume、版本、snapshot 與備份的用量？

這些問題把「EC2 能再開一台」推進到「網站資料與功能能恢復」；答案取決於事前設定與驗證，本文的文件查證不能替代還原演練。

## 相關文件

- [AWS 知識索引](README.md)：服務分組與閱讀入口。
- [EC2 與 Lambda](ec2-and-lambda.md)：instance、AMI 與程式執行生命週期。
- [S3、EBS 與 EFS](s3-ebs-and-efs.md)：三種儲存模型、位置與存取控制。
- [VPC 與資源連線](vpc-and-resource-connectivity.md)：服務連線與網路控制。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：程式存取 AWS 資源的身分與政策。
- [用量與成本的基本觀察](usage-and-cost-observation.md)：保留資源後的用量與成本觀察。
- [Linux：儲存與檔案系統](../linux/storage-and-filesystems.md)：裝置、檔案系統、掛載與備份的共通知識。
