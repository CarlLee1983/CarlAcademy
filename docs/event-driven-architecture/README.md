# 訊息佇列與事件驅動架構知識索引

從文章匯出工作出發，理解非同步交接、訊息傳遞與消費進度，再逐步處理確認、恢復及事件契約。
主線先問誰負責、什麼算完成，以及失敗後能知道什麼，再對照不同 broker 的模型與保證。

**目前狀態：主線 12 篇已全數撰寫，依下列四個階段閱讀。**
查證日期：2026-11-04。全系列依 RFC 9110、CloudEvents 1.0.2、RabbitMQ 當日標示 4.4 的文件、Kafka 4.1（Java API 當日標示 clients 4.1.2）、Avro 1.12.0、AsyncAPI 3.0.0，以及 Microsoft、Google Cloud 與 AWS 官方文件整理。案例均為自創概念推演，未部署 broker、量測效能或執行故障注入；版本與保證範圍見各篇。

## 先備與閱讀方式

讀者需理解請求回應與基本資料庫交易。不要求先讀完分散式系統主題；需要的共通概念會在當篇簡短回顧，再連到已存在的文章。

建議第一次依 01–12 閱讀：先建立責任與確認，再處理順序及恢復，接著檢查契約、隔離與重播，最後以觀測與整合回查承諾。熟悉概念的讀者也可直接查當篇的模型、歷程與限制。

## 第一階段：責任、傳遞與確認（已撰寫）

| 順序與文章 | 當篇要回答的問題 | 案例推進 |
| --- | --- | --- |
| 01 [同步呼叫與非同步工作邊界](async-work-boundaries.md) | 接受工作、交給 worker 與產生結果，有哪些不同證據？ | 保存 `job-42`，交付 `cmd-42`，指出雙寫與確認窗口 |
| 02 [命令、工作與事件](commands-jobs-and-events.md) | 要求執行與已發生事實，分別由誰負責？ | 區分 `GenerateExport`、工作狀態與 `ExportCompleted` |
| 03 [Queue、Pub/Sub 與持久日誌](queues-pubsub-and-logs.md) | 分攤工作與各自收到事件，要如何安排進度？ | 通知、搜尋與統計分開消費，對照保存與讀取位置 |
| 04 [發布確認與消費確認](publisher-confirms-and-consumer-acks.md) | Confirm、ack、delete 與 offset，各自證明到哪裡？ | 沿停止點檢查漏做、重做與未知結果 |

完成這一階段後，應能畫出或列出一段訊息歷程，指出受理、發布、投遞、業務效果與確認的不同邊界。這四篇建立基本觀察方式；後續 07 處理雙寫缺口，12 回收完整流程的設計與限制。全系列仍是概念文件，並非已驗證的產品實作。

## 第二階段：順序與故障恢復（已撰寫）

5. [消費並行、分區與順序](concurrency-partitions-and-ordering.md)：依 02–04 的識別與確認，分開發生、進入分區、投遞、處理與提交順序；檢查 key／group／partition 的範圍。
6. [重試、死信與安全重送](retries-dead-letters-and-redrive.md)：承接確認與順序，區分可恢復錯誤及永久錯誤，安排隔離、修復與重送；不把 DLQ 當成業務未發生的證明。
7. [資料庫與訊息的原子缺口](database-messaging-and-outbox.md)：回到 01 的雙寫窗口，以本地交易、Outbox relay 與消費去重分析重送；外部副作用另訂契約。

## 第三階段：契約、獨立下游與歷史（已撰寫）

8. [事件封套、Schema 與相容演進](event-envelopes-and-schema-evolution.md)：承接事件識別與恢復，區分格式版本和業務語意，核對新舊 reader 的相容方向。
9. [訂閱拓樸、路由與隔離](subscriptions-routing-and-isolation.md)：承接獨立進度與契約，安排過濾、權限、租戶及容量邊界。
10. [重播、投影與歷史資料](replay-projections-and-history.md)：檢查保留期、讀取位置、schema 及資料刪除；重建搜尋投影與重寄通知有不同副作用，事件驅動不必等於事件溯源（event sourcing）。

## 第四階段：端到端證據與整合（已撰寫）

11. [積壓、觀測與故障驗證](backlogs-observability-and-fault-checks.md)：同時追蹤傳遞進度與業務終態，安排回應遺失、consumer 暫停及壞事件的檢查歷程。
12. [整合案例：匯出完成後的多下游處理](designing-event-driven-exports.md)：回收前文的狀態、契約與故障窗口，列出恢復方法及仍不保證的事項。

## 與其他主題的分工

- [API](../api/README.md)：對外受理、查詢與 Webhook 契約；本主題聚焦內部交接與消費責任。
- [AWS 訊息服務](../aws/sqs-sns-and-eventbridge.md)：SQS／SNS／EventBridge 的產品組合入口；本主題從共通問題出發，產品限制仍按官方來源核對。
- [分散式系統](../distributed-systems/README.md)：部分失敗、冪等副作用、背壓與因果的共通基礎；不要求先讀尚未完成的篇章。
- [關聯式資料庫](../relational-databases/README.md)：單資料庫交易與約束；不能直接延伸成 broker 與外部副作用的共同交易。

完整串流運算的 event time、watermark、視窗與遲到資料，以及特定產品部署、基準測試與進階治理，留作後續方向。
