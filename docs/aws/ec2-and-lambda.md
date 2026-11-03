# EC2 與 Lambda

讓程式在 AWS 執行，可以從兩個不同的管理單位理解：**EC2 提供虛擬伺服器 instance；Lambda Event Functions 讓使用者部署函式，由服務安排執行環境與呼叫。**
前者保留客體作業系統的控制與維護工作，後者把伺服器管理交給服務，但程式、資料與設定仍需有人負責。
見 [Amazon EC2 導論](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)與 [AWS Lambda 導論](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)。

本文假設讀者已了解[雲端運算與服務模式](cloud-computing-and-service-models.md)，不要求先會操作 AWS。
查證日期：2026-11-02。僅查閱 AWS 官方文件，未登入 AWS、建立資源、執行 CLI／SDK 或進行操作實測；不列費率，也不比較價格。
網站與圖片處理均為假想情境，用於說明執行模型，並非部署教學或產品選型結論。

**本文的 Lambda 範圍是一般事件函式（Event Functions）的預設執行模型。**
查證時官方已將原本的 Lambda functions 稱為 Event Functions，並另列 Web Functions 與 MicroVMs；Managed Instances 也有不同的執行及並行模型。
因此，下文的 handler、單次呼叫與環境重用說明，不能直接套用到所有 Lambda 運算選項。
見 [Lambda 運算模型比較](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)與 [execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)。

## EC2：取得一部虛擬伺服器

Amazon Elastic Compute Cloud（EC2）提供隨需、可調整的運算容量；**instance 是 AWS 雲端上的虛擬伺服器**。
程式在其中的客體作業系統（guest OS）執行，例如網站伺服器、背景工作程序或排程工作。
EC2 提供不同 CPU、記憶體、儲存與網路資源組合，見 [EC2 基本概念](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)。

三個常見名詞各自回答不同問題：

| 名詞 | 說明 | 在假想文章網站中的意義 |
| --- | --- | --- |
| Instance | 實際啟動的虛擬伺服器 | 執行網站程式的那一部機器 |
| AMI（Amazon Machine Image） | 建立並開機所需的軟體映像與區塊裝置對應設定 | 決定初始 OS 與已包含的軟體 |
| Instance type | 提供給 instance 的硬體資源組合 | 決定可用運算、記憶體等資源的規格 |

AMI 必須與所選 instance type 相容；同一份 AMI 可建立多個 instance，映像本身不是正在執行的機器。
見 [Amazon Machine Images](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html)。

### OS 與網站程式仍由使用者管理

使用 EC2 不必自行維護 AWS 機房與實體主機，但客戶仍須管理 guest OS、自行安裝的軟體、更新與安全修補，以及 instance 的連線和角色權限。
例如網站套件有漏洞時，底層 AWS 主機正常，不代表 guest OS 裡的套件已更新。
見 [Security in Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security.html)。
完整責任分工見 [AWS 與使用者的責任](shared-responsibility.md)；OS 與應用的共通背景可回查 [Linux 知識索引](../linux/README.md)。

### Instance 有生命週期，停止和終止不同

常見狀態可簡化成以下關係；這不是所有狀態轉換的完整圖，亦未展開休眠等選項：

```text
建立 → pending → running → stopping → stopped
                      ↑                 │
                      └── pending ← 啟動 ┘

running 或 stopped → shutting-down → terminated
```

`pending` 代表準備啟動，`running` 代表已執行；`stopped` 代表關閉後可再啟動，`terminated` 則代表永久刪除該 instance，不能再把同一個 instance 啟動回來。
一般停止／啟動適用於以 EBS 作為根磁碟的 instance；停止不是把記憶體裡的程序暫停後原地續跑。
見 [EC2 instance state changes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)。

**Instance 的狀態與資料的生命週期要分開看。**停止不會連帶刪除所有儲存：EBS 磁碟區會保留，而 instance store 的資料在停止時會失去。
終止時，EBS 是否刪除由磁碟區的 `DeleteOnTermination` 設定控制，不能只看到 instance 消失就推定全部資料都刪除或全部保留。
見 [EC2 生命週期與儲存差異](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)。
持久儲存、暫存與備份的關係接續 [EC2 與資料儲存](ec2-and-data-storage.md)。

## Lambda：由服務安排一次函式呼叫

在本文範圍內，可以把 Lambda function 理解成「部署的程式及其執行設定」，不是一部要自行登入管理的伺服器。
程式提供 **handler** 作為事件處理入口，服務在呼叫（invocation）時把事件交給它。
事件可能來自 API 呼叫、S3 物件建立通知，或其他整合來源。
見 [Lambda 導論](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)與 [invocation methods](https://docs.aws.amazon.com/lambda/latest/dg/lambda-invocation.html)。

| 名詞 | 在執行流程中的角色 |
| --- | --- |
| Event | 這次交給函式處理的輸入資料，例如圖片所在物件的資訊 |
| Invocation | 對函式的一次呼叫；不能把一份部署程式與一次執行混為一談 |
| Runtime | 支援特定語言的環境，負責在 Lambda 與程式之間傳遞事件、執行資訊及回應 |
| Execution environment | 執行函式所需的隔離環境，包含 runtime 與相關資源 |

Runtime 可由 Lambda 提供，也可自行建立；語言主要版本的變更仍需要客戶處理。
見 [Lambda Event Function runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)。

### 同步與非同步，是呼叫方式的差異

同步呼叫會等待函式處理事件並回應；非同步呼叫則由 Lambda 接受事件排入處理後先回應，並不代表工作已成功完成。
另外，事件來源整合不只有「來源直接推送」一種方式：串流或佇列來源可透過 event source mapping，以一批紀錄呼叫函式。
見 [Lambda invocation methods](https://docs.aws.amazon.com/lambda/latest/dg/lambda-invocation.html)。
API 入口與執行程式的分工接續 [API 入口與程式執行](api-entry-and-program-execution.md)。

### 環境可能重用，但不能依賴它永久存在

一般執行環境生命週期包含初始化（Init）、呼叫（Invoke）與關閉（Shutdown）。
需要建立新環境時，runtime 與函式初始化會帶來啟動工作，通常稱為 cold start；已有可用環境時，Lambda 可能重用它。
服務也可能凍結或移除環境，因此不能要求下一次事件一定回到同一個環境。
見 [Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)。

這不代表每次執行前記憶體與檔案都必然清空。環境重用時可能留下先前的狀態；反過來，這些狀態也不是下一次一定可取得的保證。
Lambda 的 `/tmp` 是每個執行環境各自的暫存空間，不是所有呼叫共用的持久磁碟。
圖片轉換可把中間檔放在這裡，但原圖、處理結果與必須保留的進度應安排在符合需求的外部儲存，而不能只靠 `/tmp`。
前兩項服務行為見 [execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)與 [ephemeral storage](https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html)；圖片資料安排是依此推導的設計例子。

### Concurrency、擴縮與 timeout

**並行量（concurrency）是同時還在處理中的呼叫數量**，不等於每秒收到的請求數。
在本文的預設模型中，一個忙碌的執行環境一次處理一個呼叫；收到更多同時進行的請求時，Lambda 可建立更多環境並行處理。
因此，處理時間拉長，即使到達速率相同，也可能需要更多並行量。
自動擴縮仍受並行配額與控制設定限制，不能推定無上限地立即接住任意流量。
見 [Understanding Lambda Event Function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)。

**Timeout 是單次執行允許的時間上限**。處理大圖、下載輸入或等候其他服務，都可能增加執行時間；平均一次很快，不保證較大的輸入也能在期限內完成。
具體上限依執行選項而異，本文不把某個數字當成所有 Lambda 工作的共同規則。
見 [Configure Lambda Event Function timeout](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html)。

## 放在同一個網站情境中看

以下是自訂的需求分析例子，用來比較工作邊界，不代表其中一項服務必然更適合所有網站。

| 假想需求 | 從 EC2 模型思考 | 從 Lambda 事件函式模型思考 |
| --- | --- | --- |
| 文章網站的後端 | 在 guest OS 裡執行網站程序；團隊管理程序、部署、OS 與容量安排 | 把適合單次呼叫的處理寫成 handler；另確認請求入口、初始化、timeout 與並行需求 |
| 上傳圖片後建立縮圖 | 可讓 instance 裡的背景工作程序接收工作並處理 | 可把 S3 物件事件交給函式，再保存縮圖 |
| 一個不能中斷、持續執行很久的既有程序 | 分析所需 OS、資源、故障復原與程序管理 | 先確認是否符合單次呼叫期限，能否拆成有進度紀錄的工作；不能直接假設原程序可原封不動搬入 handler |

S3 可在物件建立時非同步呼叫 Lambda，事件包含物件資訊；函式再依所需權限讀取圖片與寫出結果。
若輸出又符合原本的觸發條件，還可能反覆觸發自己，因此這個流程也要定義輸入與輸出的界線。
見 [Process Amazon S3 event notifications with Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html)。

「事件驅動」描述程式如何因應事件而工作，不是 Lambda 獨有的能力。
例如背景程式也能從 SQS 接收訊息；若將它部署在 EC2，工作仍可由事件帶動，只是程序與伺服器管理由團隊安排。
SQS 的訊息接收模型見 [Amazon SQS short and long polling](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html)；EC2 背景程式是本文據此組合的假想例子。

## 管理交給服務，不代表程式自動正確

Lambda 的 serverless 是不必自行佈建與管理伺服器，不是沒有底層伺服器；也不是把應用邏輯、依賴更新與資料正確性一起交給 AWS。
託管 runtime 的更新責任仍依更新模式不同；使用容器映像時，客戶須重建並部署映像才能採用更新。
見 [Lambda 導論](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)與 [runtime management shared responsibility](https://docs.aws.amazon.com/lambda/latest/dg/runtime-management-shared.html)。

同樣地，呼叫一次不代表業務效果必然「恰好一次」（exactly once）。
錯誤發生時，程式可能尚未執行、執行一部分或已執行完成；重試方式由呼叫模式與來源決定。
重複收到同一事件時，程式需要避免重複產生不希望的副作用，例如替同一張原圖建立多筆互相衝突的處理紀錄。
見 [Understanding retry behavior](https://docs.aws.amazon.com/lambda/latest/dg/invocation-retries.html)。

比較這兩種模型時，可以先寫清楚：工作是否需要自行控制 OS？一次處理多久？哪些狀態必須保存？流量增加時誰安排容量？失敗後從哪裡恢復？
再把答案對上實際服務的執行與責任邊界。這些問題比「哪個產品比較新」更能指出需要查證的限制。

## 相關文件

- [AWS 知識索引](README.md)：回查服務分組與閱讀入口。
- [AWS 與使用者的責任](shared-responsibility.md)：理解 EC2 與託管 runtime 的責任差異。
- [Region 與 Availability Zone](regions-and-availability-zones.md)：了解資源部署位置與故障範圍。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：理解程式存取 AWS 資源的權限。
- [VPC 與資源連線](vpc-and-resource-connectivity.md)：了解運算元件如何連到其他資源。
- [S3、EBS 與 EFS](s3-ebs-and-efs.md)：比較物件、區塊與檔案儲存。
- [EC2 與資料儲存](ec2-and-data-storage.md)：分清 instance、磁碟與資料生命週期。
- [API 入口與程式執行](api-entry-and-program-execution.md)：區分 API 接收請求與後端執行的工作。
