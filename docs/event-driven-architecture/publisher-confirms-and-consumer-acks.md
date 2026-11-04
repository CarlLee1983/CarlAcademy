# 發布確認與消費確認

發布者收到成功、worker 收到訊息，以及匯出結果已保存，是三件不同的事。
確認訊號只對它所涵蓋的邊界提供證據，不能沿著流程自動延伸到其他系統。

本文承接[傳遞模型與獨立進度](queues-pubsub-and-logs.md)，沿用 `cmd-42` 與 `job-42`，逐一檢查交接的停止點。**確認（acknowledgment，ack）**的含義要連同發送者、接收者與觸發條件一起閱讀。

查證日期：2026-11-04。RabbitMQ 使用當日標示 4.4 的文件，具體方法限定 AMQP 0-9-1；SQS 為當日文件，Kafka 固定 4.1。故障窗口為依文件行為作的概念推演，未執行 broker、SDK 或故障測試。

## 先標出每個觀察點

| 訊號或紀錄 | 誰提供證據 | 能證明的範圍 | 不能直接證明的事 |
| --- | --- | --- | --- |
| 發布確認（publisher confirm） | broker 回覆 producer | 依產品與設定接受發布 | consumer 已處理、外部資料庫已提交 |
| Consumer 收到訊息 | consumer 的接收結果 | 有一次投遞到達 | 檔案已完成、之後不會重投 |
| Consumer ack／SQS delete | consumer 對 broker 的進度操作 | 依協定結束該投遞或刪除訊息 | broker 已查驗業務效果 |
| 工作成功與結果紀錄 | 業務服務／儲存邊界 | 達到應用契約的完成條件 | 通知與其他下游也全部成功 |

RabbitMQ 明確區分 publisher confirms 與 consumer acknowledgments，兩者互不知情。producer 可以在 consumer 尚未啟動時取得 confirm；consumer ack 也不會反向告訴 producer 哪筆業務已完成。參考 [RabbitMQ：Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)。

## 發布確認：要問是否路由，也要問保存到哪裡

在 RabbitMQ AMQP 0-9-1 中，可路由訊息的 confirm 與目標 queues 接受有關；無法路由到 queue 的訊息也可能收到 confirm。若使用 `mandatory`，未路由訊息會先 `basic.return` 再 confirm，因此 producer 必須處理 return，不能把單一 confirm 當成「工作 queue 一定已收到」。參考 [RabbitMQ：When Will Published Messages Be Confirmed by the Broker?](https://www.rabbitmq.com/docs/confirms#when-will-published-messages-be-confirmed-by-the-broker)。

保存條件也要明示。**Durable queue** 描述 queue 的重啟保存屬性；**persistent message** 是訊息的保存模式，兩者不是同一個開關。對 persistent 訊息送入 durable queue，文件將確認條件連到落盤；quorum queue 則涉及 quorum replicas 接受。這不表示任意數量的永久節點損毀都能恢復，也不表示副作用與訊息一起提交。參考 [RabbitMQ：Queues，Durability](https://www.rabbitmq.com/docs/queues#durability)、[Quorum Queues，Data Safety](https://www.rabbitmq.com/docs/quorum-queues#data-safety)。

本例若 producer 發出 `cmd-42` 後斷線，沒有取得 confirm，結果就是未知：訊息可能沒被接受，也可能已被接受但確認遺失。若重送，consumer 就可能再次看到同一命令。確認協定縮小未知範圍，不能消除所有重複。

## 消費確認：太早可能漏做，太晚可能重做

RabbitMQ manual ack 由應用在處理後送出；未確認投遞在 channel／connection 關閉時可重新排入 queue。auto ack 則在傳送時視為成功，consumer 停止可能留下未處理的工作。參考 [RabbitMQ：Consumer Acknowledgement Modes、Automatic Requeueing](https://www.rabbitmq.com/docs/confirms)。

下面假設成功效果是「保存可用檔案，並提交 `job-42` 成功狀態」，且 broker 與業務儲存不共享交易：

| 歷程 | 停止時發生的事 | 恢復後風險 |
| --- | --- | --- |
| 先 ack，再保存結果 | broker 已允許移除投遞，worker 在效果前停止 | 這條訊息路徑無法保證再處理，可能漏做 |
| 先保存結果，再 ack | 成功效果已保存，worker 在 ack 前停止 | 訊息可再投遞，可能重做 |
| 保存結果、送出 ack，但連線中斷 | worker 不確定 broker 是否收到 ack | 仍須承受可能的再投遞 |

所以「處理後才 ack」通常有助避免提早丟掉工作，但它仍要求重複處理安全。應用需核對 `job-42` 的既有結果，並把去重與適用的業務變更放在可靠邊界內。若檔案、資料庫與外部通知分屬不同系統，不能只加一張去重表就宣稱所有效果恰好一次。原子邊界的基礎見[從重送請求到冪等副作用](../distributed-systems/retries-and-idempotent-effects.md)。

## SQS：收到後暫時不可見，不是已刪除

SQS 的 `ReceiveMessage` 不移除訊息；**visibility timeout（可見性逾時）**期間訊息暫時不可見，處理完成還要呼叫 `DeleteMessage`。未及時刪除，訊息會再次可見；standard queue 即使在 timeout 內也不能保證沒有重複投遞。參考 [SQS：Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)。

用自訂數值推演：worker A 需要 45 秒，可見性期限是 30 秒；第 30 秒訊息再次可見，worker B 可能取得它，A 卻仍在執行。這不表示 broker 已證明 A 失敗，也沒有遠端終止 A 的程序。

可以按處理時間規劃期限並在需要時延長，但延長不是外部資源寫入鎖。若兩個 worker 同時修改結果，應由業務儲存與處理契約拒絕不合法的重複或過期更新。這是由投遞與程序執行分離推得的限制，不是 visibility timeout 自帶的保護。

## Kafka：提交位置也需要對照效果

在本文使用的 Kafka traditional consumer group 模型中，consumer 提交位置供恢復使用；它不是刪除某筆紀錄，也不證明外部資料庫已寫入。先提交位置再做效果，停止可能造成漏處理；先做效果再提交位置，停止可能造成重做。參考 [Kafka 4.1：Design，Consumer position、Message Delivery Semantics](https://kafka.apache.org/41/design/design/)。

Kafka 內部的交易處理有自己的適用範圍與設定；寫到外部目的系統仍需配合。不能把某個平台的 exactly-once 名稱延伸成「檔案、通知與所有資料庫各發生一次」。本篇只建立提交位置與業務效果分離的觀察方式。

## 用停止點核對設計

對 `cmd-42` 問四件事：producer 取得什麼發布證據？未路由如何得知？worker 何時可以結束投遞？效果已發生卻未確認時，重投會做什麼？若答案只是「有 ack」，還沒有說明足夠的邊界。

下一篇接續[消費並行、分區與順序](concurrency-partitions-and-ordering.md)，之後以重試、死信與 Outbox 處理恢復及雙寫。它們各自解決不同問題；不能只憑確認訊號宣稱完整流程可靠。

## 相關文件

- [訊息佇列與事件驅動架構知識索引](README.md)：查看完整十二篇主線。
- [同步呼叫與非同步工作邊界](async-work-boundaries.md)：回查整段受理、交接與完成歷程。
- [命令、工作與事件](commands-jobs-and-events.md)：應用識別與 broker 投遞識別的不同責任。
