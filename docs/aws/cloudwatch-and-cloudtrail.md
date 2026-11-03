# CloudWatch 與 CloudTrail

網站開始出錯時，我們需要知道錯誤有多少、從何時開始，以及程式留下什麼線索；有人改了 AWS 設定時，則需要追查是哪個身分、何時做了什麼操作。**CloudWatch 主要協助觀察系統運作，CloudTrail 主要留下 AWS 帳戶活動的稽核線索。**兩者可以整合，但不能彼此取代資料來源。參考 [CloudWatch Logs 導論](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html)與 [CloudTrail 概念](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html)。

本文以 CloudWatch 的指標、日誌與指標警報，以及 CloudTrail 的管理／資料事件為主，不列舉兩項產品的全部功能。先備知識可讀 [AWS 與使用者的責任](shared-responsibility.md)與 [IAM 的身分與權限](iam-identities-and-permissions.md)；主機上服務與日誌的共通觀念見 [Linux：服務與日誌](../linux/services-and-logs.md)。

查證日期：2026-11-02。本文依當日 AWS 官方文件整理；服務功能、可用性及計價可能調整，實際使用前須確認適用 Region 與當時文件。

**驗證範圍：**僅查閱官方文件及檢查本文格式、引用與連結；未登入 AWS、查閱真實日誌、建立警報或 trail，也未建立資源或呼叫 AWS 服務 API。下文網站、門檻與時間線皆為假想說明，不是操作實測或建議直接套用的設定。

## 先把問題分成兩條線

| 想回答的問題 | 主要資料 | 判讀界線 |
| --- | --- | --- |
| CPU 是否上升、請求是否變慢、錯誤率是否超標？ | CloudWatch metrics（指標） | 必須先有正確來源送入指標，並選對資源與統計方式 |
| 程式在哪一步失敗、發生什麼例外？ | 已送入 CloudWatch Logs 的應用或服務日誌 | 只有被產生、收集且仍保存的內容可查 |
| 哪個身分修改 AWS 資源設定或呼叫受支援的操作？ | CloudTrail events（事件） | 取決於服務支援、事件類型及實際記錄範圍 |

CloudTrail 可以將 trail 事件送到 CloudWatch Logs，供集中查詢或監控；此時 CloudWatch Logs 是事件的目的地之一，事件本身仍由 CloudTrail 記錄。看到同一筆資料出現在兩個產品，不表示應用日誌也會自動成為 CloudTrail 稽核事件。參考 [CloudTrail trails](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-trails.html)。

## CloudWatch metrics：先定義正在量什麼

指標是隨時間排列的數值資料，例如某台 EC2 的 CPU 使用率。對本文討論的傳統 CloudWatch 指標而言，namespace、metric name 與 dimensions 共同識別一條指標；Region 也是查找時必須確認的範圍。參考 [Metrics concepts](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html)。

| 名詞 | 意義 | 假想判讀例子 |
| --- | --- | --- |
| Namespace（命名空間） | 分隔指標的容器 | `AWS/EC2` 與自訂 `Academy/Web` 中同名指標不是同一條資料 |
| Metric name（指標名稱） | 量測的變數名稱 | `CPUUtilization` 或自行定義的 `ErrorCount` |
| Dimensions（維度） | 識別資源或分類的名稱／值組合 | `InstanceId` 指向特定 EC2；自訂 `Environment=prod` 可區分環境 |
| Period（期間） | 每一個統計值涵蓋多長時間 | 一分鐘與五分鐘圖表呈現不同的聚合粒度 |
| Statistic（統計量） | 如何彙整期間內的樣本 | `Sum` 加總、`Average` 平均、`Maximum` 最大值 |

維度不是隨意加上的顯示標籤；不同組合可代表不同指標，自訂指標也不能假定拿掉一個維度便自動加總。namespace、維度及 period 的規則見 [Metrics concepts](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html)。統計量定義見 [CloudWatch statistics definitions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Statistics-definitions.html)。

例如應用在每次請求發生錯誤時送出數值 `1`，同一期間的 `Sum` 才能表示這種設計下的錯誤數；樣本的平均值不等於錯誤率。若要談錯誤率，還要知道同一範圍的總請求數與零流量時的處理方式。回應時間則可觀察平均值或合適的百分位數，例如 p95，以分辨典型狀況與較慢請求。這是教材的量測設計示例；各服務現成指標的名稱、單位與適用統計量仍須讀該服務文件。統計量與百分位數見 [Statistics definitions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Statistics-definitions.html)。

### 有預設監控，不代表所有資料都已收集

許多 AWS 服務會發布內建指標，但應用內部的訂單失敗數、EC2 客體作業系統的記憶體使用率，不能一概視為預設就有。CloudWatch agent 可依設定收集主機內部指標與日誌，例如記憶體指標；應用也可發布自訂指標。安裝 agent、選擇收集項目與提供寫入權限是另外的設定工作。參考 [CloudWatch agent](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html)及 [agent 收集的指標](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/metrics-collected-by-CloudWatch-agent.html)。

因此圖上沒有記憶體資料時，先確認是否收集與送達，而不是判定「沒有使用記憶體」；也不能把某台主機的 CPU 正常推論成整個網站正常。

## CloudWatch Logs：日誌要先送進來才查得到

一筆 log event 包含事件時間與訊息；同來源的事件形成 log stream，多個 stream 再歸到 log group。log group 可共用保留、監控與存取設定。例如每個網站執行個體各有 stream，歸在同一應用的 group，方便以應用邊界管理。參考 [CloudWatch Logs concepts](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogsConcepts.html)。

日誌的路徑應分成三段理解：

1. **產生**：應用或 AWS 服務實際寫出訊息，決定有沒有錯誤碼、request ID 等線索。
2. **收集與匯入（ingestion）**：透過 agent 或服務整合，把選定的日誌送入 CloudWatch Logs；EC2 上有一個檔案，不表示它已送入雲端。
3. **儲存與查詢**：選對 log group、時間與條件，再用搜尋或 Logs Insights 分析已匯入的事件。

CloudWatch Logs 支援多種來源與查詢，agent 則負責其中一類收集路徑；不是所有服務都必須透過同一個 agent。參考 [Logs 導論](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html)及 [CloudWatch agent](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html)。

保留時間（retention）套用在 log group，過期事件會被刪除。應依排障、稽核需求與成本選擇期限，不能因為今天看得到，就預期半年後也一定存在。metric filter 則能把符合條件的匯入日誌轉成指標資料點，再交給指標監控；它不是讓所有文字自動變成有意義的指標。參考 [Logs concepts：Retention settings 與 Metric filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogsConcepts.html)。

## CloudWatch alarm：門檻判定與修復是不同工作

本文以 metric alarm（指標警報）為例。它監看指標或指標運算結果，依門檻及期間判定狀態；可另外設定通知或動作。建立警報本身不表示已經有修復流程，更不保證修復成功。參考 [Using CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html)。

| 狀態 | 意義 |
| --- | --- |
| `OK` | 被監看的指標或運算結果位於設定門檻內 |
| `ALARM` | 依設定的評估規則判定已超出門檻 |
| `INSUFFICIENT_DATA` | 剛開始、指標不可用，或資料不足以判定 |

這些是警報的判定結果；`OK` 不等於應用所有功能都正確。狀態定義見 [Alarm evaluation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-evaluation.html)。

假設自訂的錯誤率指標每分鐘產生一個有效資料點，教材警報採「大於 5%」，`Period=60`、`Evaluation Periods=3`、`Datapoints to Alarm=2`。在資料齊全的簡化情境下，評估的三個期間中，有兩個超標便符合條件，不要求兩個相鄰；一個短暫尖峰與持續異常因而可以分開。這組數字只是說明，真實門檻要考慮流量與服務目標。參考 [Alarm evaluation settings](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-evaluation.html)。

資料缺失也需要明確定義。可選擇視為超標、未超標、維持目前狀態，或保留為 missing；例如 `missing` 在評估範圍資料全部缺失時會轉為 `INSUFFICIENT_DATA`。但不是每缺一點便直接套用選項：CloudWatch 可能先使用評估範圍內足夠的實際資料點。持續回報的健康訊號突然中斷，與只在錯誤時送資料的稀疏指標，適合的處理可能不同。參考 [Alarms and missing data](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html)。

若要通知人員，需設定 SNS 等通知路徑；若要自動擴縮或執行其他修復，還要另外設定對應動作及權限。應分別驗證「警報有判定」「通知有送達」「動作有執行」「服務已恢復」。參考 [Alarm actions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-actions.html)。

## CloudTrail：把 AWS 活動留下來

CloudTrail 記錄其支援的 AWS 帳戶活動，包含 API 活動及部分非 API 活動，例如登入事件。Console、CLI 或 SDK 是不同入口，背後的受支援活動都可能留下事件；不能因此宣稱所有服務的所有 API 必然都有紀錄。要確認某個操作，仍須查該服務的 CloudTrail 整合文件。參考 [CloudTrail concepts](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html)。

常見事件欄位提供追查方向：`eventTime` 是 UTC 的請求完成時間，`userIdentity` 描述呼叫身分，`eventSource`、`eventName` 與 `awsRegion` 說明服務、操作與 Region；依事件可能還有資源、請求參數及錯誤資訊。角色工作階段不一定直接等於某一位自然人，需連同身分與工作階段脈絡判讀。欄位有適用條件與大小限制，不能保證保存完整請求 payload 或回應內容。參考 [CloudTrail record contents](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html)。

CloudTrail 不會因此知道應用的每一段業務流程或完整例外堆疊。網站「訂單驗證失敗」應由應用日誌描述；「哪個角色改了 AWS 資源設定」才是 CloudTrail 主要提供的線索。

### 管理事件、資料事件與讀寫是兩組分類

| 分類 | 主要意思 | 例子 |
| --- | --- | --- |
| Management events（管理事件） | 管理資源的控制平面操作 | 建立資源、修改權限或設定；讀取設定也可能是管理事件 |
| Data events（資料事件） | 對資源內資料或資源本身的資料平面操作 | S3 物件的 `GetObject`、`PutObject`，Lambda `Invoke` 等受支援活動 |
| Read / Write（讀／寫） | 依事件的操作性質區分讀取與可能修改 | 讀取不等於資料事件，修改也不等於管理事件 |

管理事件的讀寫可以依需求選擇記錄；資料事件也有讀寫分類及可用的 selector 條件。trail 與 event data store 預設不記錄資料事件，要依支援的資源類型及篩選設定啟用，且可能產生大量事件與額外費用。不能因為看到 bucket 的設定變更，就推論所有物件讀取都已記錄。參考 [Logging management events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-management-events-with-cloudtrail.html)與 [Logging data events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-data-events-with-cloudtrail.html)。

### Event history、trail 與 Lake 的保存邊界

| 方式 | 用途與範圍 | 需注意的限制 |
| --- | --- | --- |
| Event history | 帳戶預設可查看各 Region 過去 90 天的管理事件 | 不是資料事件的完整清單；查詢受帳戶、Region、時間與篩選限制 |
| Trail | 依設定持續將事件投遞到指定 S3 bucket，可另整合 CloudWatch Logs | 需配置事件選擇、Region 涵蓋範圍與投遞目的地；S3 保存策略另外管理 |
| CloudTrail Lake | 以 event data store 保存選定事件，供 SQL 查詢 | 有獨立的收集、保留與費用設定，且目前有新客戶限制 |

截至 **2026-11-02**，Event history 的官方範圍仍是過去 **90 天、單一 Region 的管理事件**，與另外建立的 trail 或 event data store 分開；它不顯示資料事件、Insights 或網路活動事件。查不到時要先核對範圍，不能把空結果視為從未發生。參考 [Working with CloudTrail event history](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html)。

trail 適合需要持續保存紀錄的情境；單一 Region 與多 Region trail 的涵蓋不同，後者涵蓋帳戶已啟用的 Region。持續投遞並不等於 S3 物件永不刪除，仍要為目的地設計存取與保存政策。參考 [Working with CloudTrail trails](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-trails.html)。

**Lake 可用性變更：AWS 已自 2026-05-31 起停止對新客戶開放 CloudTrail Lake。**既有客戶可繼續使用，但帳戶層級與組織層級 event data store 對新增帳戶的涵蓋不同，不能假定既有設定會自動延伸。此限制針對 Lake，並不表示 CloudTrail trails 停止服務；新規劃應依官方替代方案重新評估。參考 [CloudTrail Lake availability change](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-lake-service-availability-change.html)。Lake 的 selector、保留及 SQL 查詢概念見 [Working with CloudTrail Lake](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-lake.html)。

CloudTrail 投遞也不是同步交易紀錄或即時阻擋機制。官方說明 trail 日誌通常在 API 呼叫後平均約五分鐘送達，但不保證此時間；事件在檔案中也不保證依呼叫順序排列。因此剛發生的操作不一定立刻查得到，應依事件時間重建時間線。參考 [Getting and viewing CloudTrail log files](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/get-and-view-cloudtrail-log-files.html)與 [CloudTrail concepts](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html)。

## 假想案例：網站錯誤率上升，誰改了 bucket 設定？

假設某個網站依賴 S3 內容，團隊收到錯誤率警報。以下是排查思路，不是實際事件或要求讀者變更資源：

1. **先查運作線。**確認帳戶、Region、環境、指標維度與統計量，找出錯誤率何時上升。到同環境的應用 log group，限定時間及 request ID 等條件，確認是 S3 存取遭拒、應用錯誤或其他原因。
2. **再查活動線。**在對應 CloudTrail 記錄範圍中，尋找同一 bucket 的設定變更活動，核對服務、操作名稱、身分／角色工作階段及錯誤欄位。不能把一次失敗的變更請求當作設定已成功改變。
3. **把兩條線對到相同時區。**假設應用在台北時間 `2026-11-02 10:02 +08:00` 出現存取遭拒，而 CloudTrail 有 `2026-11-02T02:00:00Z` 的相關變更事件，兩者相隔約兩分鐘，不是八小時。還要分清事件發生時間與資料送達時間；CloudTrail 的 `eventTime` 定義見 [Record contents](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html)。
4. **驗證關聯。**時間接近只是候選原因，還需對照實際設定、受影響的資源與應用錯誤。若問題是「誰讀了某個物件」，則要另外確認當時是否已記錄對應資料事件；事後才啟用，不會讓先前未收集的活動憑空出現。
5. **依原因處理並確認恢復。**修正需另有權限與變更安排；再以成功請求、錯誤率及新日誌確認結果。警報回到 `OK` 只代表所設定的訊號恢復門檻內。

這個案例把「服務怎麼壞」與「AWS 上發生什麼變更」串起來，但仍保留兩種資料各自能證明的範圍。

## 權限、敏感資料與費用都屬於監控設計

讀取日誌、寫入日誌、管理警報，以及修改原始資源，是不同的權限。能改網站使用的資源，不代表可以讀應用日誌；能讀日誌，也不表示可以改 bucket policy。監控的使用者角色、收集代理角色與服務投遞角色應依用途授權，查無結果時還要分辨是無資料、篩選太窄，還是無權讀取。CloudWatch Logs 的資源與權限模型見 [Managing access permissions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/iam-access-control-overview-cwl.html)；授權共通原理見 [IAM](iam-identities-and-permissions.md)。

日誌可能含身分、IP、URL 或應用自行記錄的敏感欄位。應在產生時避免寫入密碼、token 與不必要的個資，限制讀取與匯出，並選擇合適保留期限；加密不會自動取代讀取授權。CloudWatch Logs 提供加密與敏感資料遮罩等能力，但內容與安全設定仍有使用者責任。參考 [Data protection in CloudWatch Logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/data-protection.html)。

成本也不是只有「有沒有開監控」：CloudWatch 的自訂指標、警報、日誌匯入、儲存與查詢等用量會影響費用；CloudTrail 的資料事件、額外事件副本、S3 儲存與 Lake 的匯入、保存及查詢也有不同計價面向。Event history 可免費查看，不代表所有稽核保存架構免費。本文不列費率，應依選用功能、Region 與當時 [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)、[CloudTrail pricing](https://aws.amazon.com/cloudtrail/pricing/)及 [Lake 文件](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-lake.html)確認，並回讀[用量與成本的基本觀察](usage-and-cost-observation.md)。

## 相關文件

- [AWS 知識索引](README.md)：依服務用途查閱其他文章。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：分辨收集、查詢與資源變更的授權。
- [AWS 與使用者的責任](shared-responsibility.md)：理解監控內容與設定的責任邊界。
- [用量與成本的基本觀察](usage-and-cost-observation.md)：持續觀察監控及其他服務的用量。
- [API 入口與程式執行](api-entry-and-program-execution.md)：串起 API 請求、後端執行及其觀察位置。
- [Linux：服務與日誌](../linux/services-and-logs.md)：理解主機上的服務狀態、日誌來源與時間範圍。
