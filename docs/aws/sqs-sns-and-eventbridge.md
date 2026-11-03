# SQS、SNS 與 EventBridge：佇列、發布訂閱與事件匯流排

當後端工作不需要在單一 HTTP 請求內同步完成，或一個狀態改變需要通知多個下游系統時，直接讓服務彼此同步呼叫會把可用性與尖峰流量綁在一起。**Amazon SQS 提供拉取式訊息佇列以緩衝工作；Amazon SNS 提供發布／訂閱（pub/sub）主題以一對多推播；Amazon EventBridge 則以事件匯流排與規則比對，將來自 AWS 服務、自訂應用或第三方 SaaS 的事件路由至目標。**見 [SQS 導論](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)、[SNS 導論](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)與 [EventBridge 導論](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html)。

本文接續 [EC2 與 Lambda](ec2-and-lambda.md)、[API 入口與程式執行](api-entry-and-program-execution.md)與 [IAM 的身分與權限](iam-identities-and-permissions.md)；重試與去重的共通原理見 [逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)，非同步狀態契約見 [長時間執行操作與非同步 API 契約](../api/long-running-operations-and-async-apis.md)。

查證日期：2026-11-03。僅查閱 AWS 官方文件，未登入 AWS、建立佇列／主題／事件匯流排，亦未執行 SDK 或 Lambda 觸發測試。文中的文章匯出與發布事件為本站自訂的假想例子，不列費率與固定配額。

## 三項服務解決哪三種不同的非同步分離問題？

雖然三者都常被歸在「非同步訊息與事件整合」，但訊息如何保存、誰決定接收者、以及由誰主動拉取或推送，有本質差異：

| 服務 | 核心模型 | 傳遞與消費方式 | 主要解決的問題 |
| --- | --- | --- | --- |
| Amazon SQS | 訊息佇列（Queue） | 消費者主動輪詢拉取（或由 Lambda event source mapping 代為輪詢），處理完後顯式刪除訊息 | 平滑尖峰流量（buffering）、控制下游處理速率，讓單一工作被一個消費者取走處理 |
| Amazon SNS | 發布／訂閱主題（Topic） | 發布者送一則訊息到 Topic，SNS 主動推送（fanout）給該 Topic 的所有訂閱端點 | 將同一則通知或事件同時廣播給多個獨立下游（如多個 SQS 佇列、Lambda、HTTP 端點） |
| Amazon EventBridge | 事件匯流排（Event Bus） | 事件進入匯流排後，依規則（Rules）比對事件結構內容（Event Pattern），再路由至匹配目標 | 依事件屬性做細粒度路由、整合 AWS 原生服務狀態事件，或排程觸發目標 |

## SQS：借出訊息、可見性逾時與死信佇列

理解 SQS 時，最重要的一點是：**`ReceiveMessage` 並不會把訊息從佇列中刪除，而是暫時將它「隱藏」起來。**見 [SQS Visibility Timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)。

```text
生產者 SendMessage ──→ [ SQS 佇列 ]
                           │
1. 消費者 A ReceiveMessage ┴──→ 訊息進入「不可見」狀態（Visibility Timeout 倒數）
2. 消費者 A 處理工作...
   ├─ 成功：呼叫 DeleteMessage ──→ 訊息正式從佇列移除
   └─ 崩潰或逾時未刪除 ──────────→ Visibility Timeout 到期，訊息重新變回可見，交給下一次讀取
```

### Visibility Timeout 與消費者冪等性

如果消費者處理一筆匯出工作需要 45 秒，佇列的 `VisibilityTimeout` 卻只設 30 秒：當第 30 秒一到，消費者 A 還沒跑完，SQS 就會以為消費者 A 失敗了，把同一則訊息再次交給消費者 B，造成兩個消費者同時處理同一筆工作。因此：

- 佇列的 `VisibilityTimeout` 必須大於消費者處理單批訊息的合理上限（搭配 Lambda event source mapping 時，AWS 官方建議佇列 visibility timeout 至少設為 Lambda function timeout 的數倍以上）。見 [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)。
- **Standard Queue** 採至少一次傳遞（at-least-once delivery）與盡力保持順序（best-effort ordering），可能出現重複訊息或順序交錯；**FIFO Queue** 則在特定 `MessageGroupId` 內保證先入先出，並提供去重視窗內的訊息去重，但消費者端的業務邏輯仍應具備冪等性。見 [SQS Standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html) 與 [SQS FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html)。

### 死信佇列（Dead-Letter Queue，DLQ）隔離反覆失敗的異常訊息

如果某則訊息格式損壞或觸發程式 bug，每次被讀取都拋出例外，它會在 `VisibilityTimeout` 到期後無限次回到佇列並反覆消耗資源。設定 redrive policy 與 `maxReceiveCount` 後，當同一則訊息被接收但未成功刪除的次數超過門檻，SQS 會將它移往指定的 **DLQ（死信佇列）**，避免阻塞正常訊息，並保留問題訊息供後續告警、檢視與重放（redrive）。注意：DLQ 的訊息保留期（retention period）計時通常從訊息最初進入原佇列時算起，應將 DLQ 保留期設得比原佇列更長。見 [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)。

## SNS 與 EventBridge：一對多廣播與結構化事件路由

當「文章發布完成」這件事同時需要觸發「更新搜尋索引」「發送訂閱通知」與「寫入分析統計」三個獨立下游時，若只用單一 SQS 佇列，第一個讀走訊息的消費者刪掉訊息後，另外兩個下游就收不到了。這時有兩種常見的 AWS 組合模式：

### 1. SNS + SQS Fanout（發布訂閱加上各自佇列緩衝）

發布者將事件發到一個 **SNS Topic**，再由三個下游各自建立專屬的 **SQS Queue** 訂閱該 Topic。SNS 會把同一則事件複製推送到三個 SQS 佇列中，讓三個下游各自按自己的速率拉取、重試與設定 DLQ，互不干擾。SNS 也支援 subscription filter policy，可依訊息屬性（message attributes）或訊息主體篩選各佇列要收的訊息。見 [Sending Amazon SNS messages to an Amazon SQS queue](https://docs.aws.amazon.com/sns/latest/dg/subscribe-sqs-queue-to-topic.html) 與 [SNS message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)。

### 2. EventBridge 事件匯流排與規則比對

**EventBridge** 以結構化 JSON 事件為核心（常見欄位包含 `source`、`detail-type`、`detail`），除了接收應用程式透過 `PutEvents` 發出的自訂事件，也能直接接收 AWS 服務產生的狀態事件（例如 ECS task 狀態變化、EC2 狀態通知、S3 事件）。以下為自訂的 EventBridge 事件與匹配規則概念示意：

```json
{
  "source": "academy.articles",
  "detail-type": "ArticlePublished",
  "detail": {
    "article_id": "42",
    "topic": "linux",
    "visibility": "public"
  }
}
```

匯流排上的 Rule 可以針對 `detail.visibility` 等深層欄位宣告 Event Pattern（例如只匹配 `"visibility": ["public"]`），並將事件轉送到指定目標（如 SQS、Lambda、Step Functions 或 API Destinations），也能支援事件封存（Archive）與重播（Replay）。見 [Amazon EventBridge events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-events.html) 與 [Event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)。

## 權限邊界：誰允許寫入，誰允許讀取？

非同步整合常跨越多個 AWS 服務，IAM 授權不能只看單一角色，必須區分「主動呼叫 API 的身分（identity-based policy）」與「被動接收跨服務寫入的資源（resource-based policy）」：

| 互動路徑 | 需要哪一種授權設定 | 常見疏漏 |
| --- | --- | --- |
| 應用程式呼叫 `sqs:SendMessage`／`sns:Publish`／`events:PutEvents` | 應用程式（如 Lambda execution role 或 ECS task role）具備對應動作與目標資源 ARN 的 IAM 權限 | 給了 `*` 資源權限，未限制特定 Queue／Topic／Event Bus |
| SNS Topic 推送訊息至 SQS Queue | **SQS Queue 的 resource-based policy（Queue Policy）** 必須允許服務 principal `sns.amazonaws.com` 執行 `sqs:SendMessage`，並以 `aws:SourceArn` 限制特定 SNS Topic | 只在 SNS 設定訂閱，卻漏了在 SQS 佇列政策放行，導致投遞直接失敗 |
| EventBridge Rule 投遞事件至 SQS／SNS／Lambda | 依目標類型設定對應資源政策（如 SQS Queue Policy、Lambda resource policy）或為 Rule 指定具權限的 execution role | 跨服務觸發時未以 `aws:SourceArn`／`aws:SourceAccount` 限制來源，留下混淆代理人（confused deputy）風險 |
| Lambda event source mapping 從 SQS 拉取訊息 | **Lambda 的 execution role** 必須具備對該佇列的 `sqs:ReceiveMessage`、`sqs:DeleteMessage` 與 `sqs:GetQueueAttributes` | 誤以為像 SNS 推 Lambda 一樣只需設 Lambda resource policy；SQS 整合是由 Lambda 服務以函式角色去輪詢佇列 |

上述各服務的授權模型與防範跨服務混淆代理人的條件鍵（`aws:SourceArn`、`aws:SourceAccount`），見 [IAM 的身分與權限](iam-identities-and-permissions.md)、[SQS access policy examples](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-Ex-queue-access-policies.html) 與 [EventBridge permissions](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-permissions.html)。

## 相關文件

- [AWS 知識索引](README.md)：回到 AWS 主題總覽。
- [EC2 與 Lambda](ec2-and-lambda.md)：理解事件驅動執行模型與常駐工作程序的差異。
- [API 入口與程式執行](api-entry-and-program-execution.md)：對照同步 API Gateway + Lambda 路徑與非同步處理的邊界。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：比較 identity-based policy 與 resource-based policy。
- [逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)：至少一次傳遞下的重複消費與冪等處理。
- [長時間執行操作與非同步 API 契約](../api/long-running-operations-and-async-apis.md)：將背景佇列工作封裝為對外可查詢的操作狀態契約。
- [Webhook、事件回呼與反向通知契約](../api/webhooks-and-event-callbacks.md)：對外推送事件時的簽章、重送與 SSRF 防護邊界。
