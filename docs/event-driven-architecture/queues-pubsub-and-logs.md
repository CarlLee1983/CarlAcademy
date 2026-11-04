# Queue、Pub/Sub 與持久日誌

一個工作需要由某個 worker 接手，多個獨立下游則需要各自保有處理進度。
選擇傳遞模型時，先問誰應該收到、進度存在哪裡，以及消費後還能否讀取歷史。

本文接續[命令、工作與事件](commands-jobs-and-events.md)：`GenerateExport` 由匯出服務負責，`ExportCompleted` 則供通知、搜尋及統計各自反應。這三個下游名稱是本例需求，不代表每個匯出服務都需要這些元件。

查證日期：2026-11-04。RabbitMQ 使用當日頁首標示 4.4 的線上文件，Kafka 固定 4.1，Google Cloud 使用當日文件。全部拓樸與歷程是概念推演，未部署或量測產品。

## 工作佇列：分攤同一種責任

**工作佇列（work queue）**讓多個 worker 分攤同一類工作。假設匯出 queue 內有 `cmd-42`、`cmd-43`，worker A 與 B 都具備完整匯出能力，broker 可把兩筆投遞分派給不同 worker。

這個設計想達成「每項工作有處理者」，不是「每個 worker 都收到所有工作」。RabbitMQ 一般 active consumers 分攤同 queue 的投遞；priority、prefetch 與 Single Active Consumer 等設定會影響分配。也不能由分攤規則推論業務效果只做一次，失敗重投仍須處理。參考 [RabbitMQ：Consumers](https://www.rabbitmq.com/docs/consumers)。

如果把通知、搜尋與統計三種不同能力的程序放進同一競爭佇列，讓它們各拿一部分事件，需求就不成立：通知程序處理了 `evt-90`，不代表搜尋也會取得它。需要三種反應時，要安排三份獨立消費責任。

## 發布訂閱：先拆開下游進度，再擴大各自 worker

**發布／訂閱（publish/subscribe，Pub/Sub）**讓發布者送出一項內容，由不同訂閱各自接收。以 Google Cloud Pub/Sub 的文件模型為例，同 topic 上的兩個 subscription 各自收到訊息；同一 subscription 內的多個 subscriber 則分攤投遞。參考 [Google Cloud：Pub/Sub overview](https://docs.cloud.google.com/pubsub/docs/pubsub-basics)。

本例先建立三個獨立訂閱，並假設沒有過濾條件排除 `evt-90`：

| 訂閱責任 | 訂閱內的處理程序 | `evt-90` 完成代表什麼 |
| --- | --- | --- |
| 通知 | 通知 worker A、B | 通知端達成自己的處理契約 |
| 搜尋 | 搜尋 worker C、D | 搜尋端完成索引更新 |
| 統計 | 統計 worker E | 統計端完成自己的紀錄 |

通知 A 與 B 分攤通知工作；它們不與搜尋 C、D 競爭同一份進度。通知卡住時，搜尋可以繼續，但仍可能共用 broker、配額與其他依賴，獨立訂閱不是絕對容量隔離。

RabbitMQ 可以用 exchange 把訊息路由到不同 queue，再讓各 queue 內的 worker 分攤。其 fanout exchange 將訊息送往每個綁定目的地；direct 與 topic exchange 則依不同比對規則路由。這裡的 `topic exchange` 是 RabbitMQ 的路由類型，不能直接當作 Kafka topic 或 Google Pub/Sub topic 的同義物。參考 [RabbitMQ：Exchanges](https://www.rabbitmq.com/docs/exchanges)。

## 持久日誌：資料保存與讀取位置分開

**持久日誌（durable log）**把紀錄追加到可保存的歷史中，consumer 以位置追蹤讀到哪裡。消費某筆紀錄，不必等於從共享歷史刪除該筆紀錄。

Kafka topic 可分成多個 **partition（分區）**，事件追加到分區內，**offset（位移）**標示分區中的位置。順序範圍是單一 partition，不能由它推論跨 partition 的全域順序。事件消費後不立即刪除，保存仍由 topic 設定控制。參考 [Kafka 4.1：Introduction](https://kafka.apache.org/41/getting-started/introduction/)。

在 Kafka 4.1 的 **traditional consumer group** 模型裡，同 group 分攤分區，不同 group 保有各自進度。因此可讓通知、搜尋、統計分屬不同 group，再在各 group 內擴大 worker。4.1 也另有預覽的 share group，分工與確認方式不同；本篇只用 traditional 模型說明位置。參考 [Kafka 4.1：Design，The Consumer、Share groups](https://kafka.apache.org/41/design/design/)。

下面以同一 partition 為例。表中「下次讀取位置」採本例示意，commit 的位置不能用來證明業務已完成：

| 觀察時點 | 歷史與各自進度 | 推論 |
| --- | --- | --- |
| 發布後 | offset 20 是 `evt-90`；通知與搜尋下一筆都在 20 | 兩者尚未依各自進度越過此事件 |
| 搜尋先處理 | 搜尋提交下一位置 21，通知仍在 20 | 搜尋的進度沒有代替通知前進 |
| 搜尋重建 | 在資料仍保留時，搜尋重新從 20 讀取 | 可再次取得事件，但必須另處理重播副作用 |
| 歷史已清理 | offset 20 的紀錄已不在可讀範圍 | 保有舊位置不會憑空恢復被移除資料 |

日誌也不是某個品牌的專屬模型。RabbitMQ streams 支援非破壞讀取與按大小／年齡保留，和 classic／quorum queue 的消費模型不同。參考 [RabbitMQ：Streams](https://www.rabbitmq.com/docs/streams)。

## 三個問題，比產品分類更有用

| 要回答的問題 | 工作佇列視角 | 獨立訂閱視角 | 日誌視角 |
| --- | --- | --- | --- |
| 誰應處理同一筆？ | 同責任 worker 分攤 | 每個符合條件的訂閱有自己的進度 | 每個讀取群組可有自己的位置 |
| 什麼代表前進？ | 該投遞按協定結束 | 該訂閱按自身協定前進 | 讀取／提交位置；仍需核對效果 |
| 能否取得歷史？ | 不能由 queue 名稱推論 | 取決於保存與重播能力 | 仍受保存及清理政策限制 |

這是三種分析視角，並非互斥的產品分類。一個產品可以同時提供競爭消費、獨立訂閱與可重讀資料；相同名稱也可能有不同保證。選型時應把需求改寫成可核對的問題：搜尋離線一天後能否追上？通知失敗是否拖住搜尋？已確認訊息能保存到何時？

## 對照本例的最小演進

起初只需要一組匯出 worker，工作 queue 即可表達分攤責任。當完成事實需要多個下游反應，再加入獨立訂閱。當搜尋需要重建歷史，還要確認保存政策、起始位置與重播契約；不能只新增一個訂閱，就假定過去所有事件都能取得。

每次增加元件都對應具體需求，沒有要求先把 queue、Pub/Sub 與 log 全部部署。下一篇回頭檢查：這些傳遞方式的[發布確認與消費確認](publisher-confirms-and-consumer-acks.md)，到底各自證明什麼？

## 相關文件

- [訊息佇列與事件驅動架構知識索引](README.md)：閱讀主線與後續方向。
- [SQS、SNS 與 EventBridge](../aws/sqs-sns-and-eventbridge.md)：AWS 產品組合的對照入口；產品保證仍須按當日官方條件核對。
