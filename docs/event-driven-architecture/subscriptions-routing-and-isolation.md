# 訂閱拓樸、路由與隔離

通知服務故障時，搜尋仍應能更新、統計仍應能前進。這個需求不只是在圖上多畫三個 consumer，而是讓三種責任各有進度、錯誤處理與允許的資料範圍。

本文接續[事件封套、Schema 與相容演進](event-envelopes-and-schema-evolution.md)，沿用 `ExportCompleted` 的 `evt-90`。**拓樸（topology）**指發布來源、路由元件、訂閱與消費者之間的連接安排；本文用概念表格追蹤它如何隨需求改變。

查證日期：2026-11-04。Google Cloud Pub/Sub 使用當日線上文件，Kafka 固定 4.1；不是各產品共用 API。全部歷程與容量數字為自創推演，未部署、壓測或執行故障測試。

## 三種下游，先分開三份責任

起初 `cmd-42` 只需要匯出 worker 接手。`job-42` 完成後，產品增加通知、搜尋與統計需求；此時若三種程序共用一份競爭消費進度，通知拿走 `evt-90` 並不代表搜尋也能取得。

**訂閱（subscription）**在此表示一份獨立的接收及確認責任；**subscriber** 則是執行接收的程序。在 Google Pub/Sub 模型中，同 topic 的不同 subscription 各自接收訊息，同一 subscription 的多個 subscriber 分攤投遞。參考 [Pub/Sub overview：Core concepts](https://docs.cloud.google.com/pubsub/docs/pubsub-basics)。本例先假設三份訂閱都已建立，且沒有過濾條件排除完成事件：

| 獨立訂閱 | 訂閱內程序 | 對 `evt-90` 的責任 |
| --- | --- | --- |
| `export-notifications` | 通知 A、B | 依通知契約安排外部寄送 |
| `export-search` | 搜尋 C、D | 更新可查詢的結果投影 |
| `export-statistics` | 統計 E | 更新約定的匯出統計 |

通知 A 和 B 競爭同一訂閱中的投遞；搜尋 C 和 D 競爭搜尋的投遞。增加通知 B 是擴大相同責任的處理能力，不是增加另一種業務反應。每一份訂閱仍可能重送；A 失敗後 B 接手，不能假定 A 完全沒做過效果。

在一次歷程中，搜尋完成並確認 `evt-90`，統計也已保存結果；通知遇到外部服務暫時不可用，繼續重試。通知的未確認狀態不應拉回搜尋的確認位置。獨立訂閱允許各自設定重試與死信策略，但這不表示共用 broker、帳戶配額或資料庫不會一起受影響。

## 路由條件決定送哪裡，不決定誰有權

**路由（routing）**決定事件進入哪些目的地，**過濾（filter）**依條件保留或排除訊息。假設通知只關注完成與失敗事件，搜尋關注完成與刪除，統計關注完成；這些是各自用途的篩選，不是讓事件永遠只准一個下游讀取。

Google Pub/Sub 的 subscription filter 比對訊息 attributes，不比對 data；不匹配訊息由服務自動確認。因此不能直接把 CloudEvents JSON 裡的 `data.tenant_id` 寫進條件，就假定服務會解析。若把事件類型等欄位另映射到傳輸 attributes，producer 與接收端需明訂一致性驗證，避免封套是 completed、attribute 卻是 failed。參考 [Pub/Sub：Filter messages from a subscription](https://docs.cloud.google.com/pubsub/docs/subscription-message-filter)。

Google Pub/Sub 的 filter 建立後不可直接修改；調整條件需要建立替代訂閱並遷移。下文的「修改路由」是概念需求，不表示能對既有 subscription 原地更新 filter。替代訂閱的建立時間、保留與切換安排需要一併核對，不能刪掉舊訂閱後才發現缺少歷史。參考同一份 [filter 文件：Update the filter](https://docs.cloud.google.com/pubsub/docs/subscription-message-filter#update_the_filter_for_a_subscription)。

自動確認也改變故障判讀。某次 filter 拼錯類型，subscription backlog 可能保持很低，卻沒有一筆應有的通知進入 consumer。這不是 consumer 處理速度變快，而是路由把責任排除了。本例要求保留設定變更紀錄，並比較預期事件數、符合條件數與消費完成數；指標定義仍須按產品核對。

**授權（authorization）**則決定某個身分可對某資源做什麼。`tenant_id = tenant-a` 的 filter 不能取代權限：能改 filter、另建訂閱或直接讀另一資源的身分，可能繞過原條件；有發布權的人也可能偽造租戶欄位。

| 信任邊界 | 本例要約束的事情 | 單靠 filter 為何不足 |
| --- | --- | --- |
| Publisher 身分 | 匯出服務只能向准許來源發布；租戶來自受驗證的工作 | payload 宣稱的來源與租戶不是身分證明 |
| Subscriber 身分 | 通知只能消費通知資源，並查取通知所需資料 | 路由命中不授予讀取匯出檔的權限 |
| 資源政策與管理權 | 誰可建立訂閱、連接 topic、修改條件與授權 | 管理者能改變誰取得副本 |
| 租戶資料邊界 | tenant A 的程序不能查取 tenant B 的結果 | 即使收錯事件，結果服務也必須拒絕越權 |

Google Pub/Sub IAM 可在 project 或個別資源設定權限，區分向 topic 發布與從 subscription 消費等能力。這支持按責任配置身分的設計，但具體跨專案連接、管理權與繼承仍需核對所用角色，不能把本表當成完整 IAM 設定。參考 [Pub/Sub：Access control with IAM](https://docs.cloud.google.com/pubsub/docs/access-control)。

## 獨立進度還不是獨立容量

假設通知突然重試十倍，三個 consumer 雖然使用不同訂閱，仍共用資料庫連線池與對外網路。若通知佔滿這些資源，搜尋依然可能停住。容量隔離要依實際瓶頸處理，例如每個責任有並行上限、獨立連線池、重試預算與速率限制；必要時才拆更強的資源邊界。

租戶也有同樣問題。大租戶瞬間產生大量完成事件，若所有租戶共用同一排程與消費池，小租戶可能等待很久。依租戶計量、限制在途量或公平排程，和「每租戶一個 topic」是不同選擇；增加 topic 數量不必然增加 broker 總容量，也會增加資源與政策管理成本。

Kafka 4.1 的多租戶指南分別討論 ACL 與 quota；quota 可限制客戶端的頻寬與請求資源。這說明存取與資源使用是兩個設計面向，不能由獨立 consumer group 推論已有完整隔離。參考 [Kafka 4.1：Multi-Tenancy](https://kafka.apache.org/41/operations/multi-tenancy/)。本例不把特定 quota 推成所有共享依賴都能受它保護。

**Fanout（扇出）**是一次發布形成多份下游接收責任。假設每秒 100 個完成事件，三份無過濾訂閱，則概念上有每秒 300 份下游處理責任，還沒算重送、保留、DLQ 與重播。這是工作量算例，不是帳單公式。Pub/Sub 的不匹配 filter 訊息也有特定計費規則，不能概括說「過濾掉就完全免費」；實際費用需按當日計價與保存設定計算。參考上述 [filter 文件的費用說明](https://docs.cloud.google.com/pubsub/docs/subscription-message-filter)。

訂閱的擁有者也要負責保存成本與錯誤處置。本例通知團隊負責通知的積壓、DLQ 與補寄政策，搜尋負責投影的新舊版本，統計負責重複計數與補算。若只新增資源卻無人維護，獨立進度可能只是把故障藏到另一個地方。設定保留上限與告警後，仍需說明超過恢復窗口時，誰判斷補建、丟棄或人工核對。

一次路由變更可先用不執行副作用的觀察路徑比對新舊條件，確認哪些事件新增、哪些消失，再安排交接。這是可採用的設計策略，本文沒有執行比對。若新舊通知 consumer 同時有效，應共用可辨認同一通知意圖的效果鍵；以新 subscription 名稱另起一套去重，可能把切換交疊變成重寄。若完全不交疊，則必須有可證明無缺口的接續方式。

## 拓樸改動也有歷史邊界

| 演進時點 | 改動 | 必須另答的歷史問題 |
| --- | --- | --- |
| 只有匯出工作 | 一份 worker queue | 完成狀態由哪裡查詢？ |
| 新增三種反應 | 三份獨立訂閱 | 訂閱生效前的事件從哪裡補？ |
| 搜尋增加刪除事件 | 修改接收契約與路由 | 舊 filter 排除的刪除事件還保存嗎？ |
| 通知拆租戶資源 | 新舊訂閱切換 | 交疊期間如何去重，缺口如何對帳？ |

新訂閱不會憑名稱取得所有歷史。Google Pub/Sub 是否可讀取建立前的訊息，涉及 topic retention 等重播設定；seek 與 snapshot 也有各自前提。參考 [Pub/Sub：Replay and purge messages with seek](https://docs.cloud.google.com/pubsub/docs/replay-overview)。其他產品應另外核對，不能把這項能力推廣成 Pub/Sub 的普遍承諾。

本例切換租戶通知時先保留可核對的交接位置與事件身分，限制新舊 consumer 的副作用，再確認責任已接續才移除舊路徑。若保存範圍不涵蓋缺口，需從工作來源對帳補建，不能用一個舊 offset 假裝資料仍在。

下一篇討論[重播、投影與歷史資料](replay-projections-and-history.md)：有了獨立讀取位置，仍要判斷哪些歷史足夠重建、哪些效果不應再次發生。

## 相關文件

- [訊息佇列與事件驅動架構知識索引](README.md)：回到閱讀主線。
- [Queue、Pub/Sub 與持久日誌](queues-pubsub-and-logs.md)：分工與獨立進度的基本模型。
- [重試、死信與安全重送](retries-dead-letters-and-redrive.md)：每份訂閱自己的恢復責任。
