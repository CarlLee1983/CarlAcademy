# 重試、死信與安全重送

重試是再次嘗試完成原來的責任；死信佇列則把反覆無法處理的訊息隔離，讓正常工作繼續。兩者都需要停止條件與恢復責任，不能把「稍後再試」當成完整設計。

上一篇說明[並行、分區與順序](concurrency-partitions-and-ordering.md)。本文沿用 `export-intent-7` 所建立的 `job-42`、命令 `cmd-42` 與完成事件 `evt-90`，區分處理失敗、效果未知，以及有意重新發起工作。

查證日期：2026-11-04。SQS 使用當日線上文件，退避原則參考 AWS Builders’ Library；事件身分對照 CloudEvents 1.0.2。以下重試數值、流程及責任分工為自創設計，未操作 DLQ 或執行故障測試。

## 先分類，再決定是否重試

| 觀察到的問題 | 本例判斷 | 下一步 |
| --- | --- | --- |
| 依賴暫時無法連線、明確限流 | 可能恢復，但仍須看工作期限 | 有上限地延後重試，降低並行與流量 |
| 不支援的事件版本、必要欄位缺漏 | 相同內容短時間重試不會修好 | 隔離、告警，交由契約或程式負責人處理 |
| 匯出來源已依法刪除，不再符合業務規則 | 可能是合法的終止結果 | 依契約保存失敗／取消，不發布完成事件 |
| 外部呼叫逾時 | 效果未知，不能直接說未執行 | 先按識別核對結果，依冪等契約決定重試 |
| 權限或憑證設定錯誤 | 系統設定問題，不是每筆業務都壞了 | 停止擴大流量、修復依賴，避免把整批資料判成永久失敗 |

分類是應用判斷，不是只靠某個 HTTP 狀態碼或例外名稱。相同錯誤在不同期限、輸入及依賴契約下，可能有不同處置。對無法解析的訊息，也應保留可診斷的受控證據，不能為了紀錄錯誤而把完整敏感 payload 複製到公開日誌。

特別是「效果已發生，確認還沒保存」：再次處理前要查既有工作或消費紀錄。AWS 的重試設計明示，逾時不代表副作用沒有發生，重試也會增加依賴負載。參考 [AWS：Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)。

## 退避有上限，總預算也要有上限

**退避（backoff）**逐步拉長嘗試間隔；**抖動（jitter）**把等待時間分散，避免大量 consumer 同時恢復、同時再打壞依賴。可以自訂每次等待上界為 `min(30 秒, 1 秒 × 2^重試次數)`，再從零到上界抽取等待時間。這是概念策略，並非 SQS 的預設設定或建議常數。

等待時間封頂不等於重試已受限。還要定義最多嘗試次數、最長經過時間、整項工作的有效期限，以及到期後交給誰。若 SDK、handler 與 broker 每層都重試，次數會相乘；應指定哪一層負責哪一種失敗，保留整段預算。相關負載放大與 jitter 原則同樣見上述 AWS 文件。

broker 的 receive count 也不等於真正執行副作用的次數：consumer 可能收到後就停止，或單次 handler 裡已呼叫依賴多次。可見性期限應容納合理處理時間，但延長期限不能替代前篇的世代檢查。重試期間也不能一直占住無限執行緒或立即重新入列；如何實作延遲須核對選定產品的能力。

## DLQ 隔離訊息，不替業務宣告失敗

**Dead-letter queue（死信佇列，DLQ）**保存未能依消費策略完成的訊息，供診斷與補救。以 SQS 為例，redrive policy 的 `maxReceiveCount` 設定移入 DLQ 前的接收次數。它描述傳遞策略，不證明 `job-42` 從未完成，更不能證明通知從未寄出。參考 [SQS：Using dead-letter queues，Policies](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)。

本例匯出團隊負責命令 DLQ，通知團隊負責通知訂閱的 DLQ。每個責任都要有告警接收者、檢查期限、敏感內容存取規則與修復方式；只有一個無人查看的 queue，等於把失敗藏起來。正常消費者恢復後，也要檢查舊的隔離訊息是否仍需要處理。

保存政策影響可補救時間。SQS standard 訊息移入 DLQ 後，過期仍依原入列時間計算；DLQ 的 oldest-age 指標則反映移入後的年齡，不能直接當成訊息總年齡。FIFO 移入 DLQ 時會重設入列時間。應依偵測與修復時間規劃保留，standard DLQ 保留時間通常需長於來源 queue，卻仍不是永久存檔。參考 [SQS：Understanding message retention periods for dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html#understanding-message-retention-periods)。

排序也有代價。把一筆失敗訊息抽到 DLQ，後面的訊息可能繼續前進；若後者依賴前者，業務順序已被切斷。SQS 官方明示，要求精確操作順序時，不應把 FIFO 配 DLQ 當成無代價的解法。此時要選擇暫停該工作序列、修復缺口，或有明訂的跳過／補償規則，不能同時承諾永不阻塞與所有相依效果嚴格保序。

## 安全 redrive 要保留哪一種身分

**Redrive（重新驅動）**把隔離訊息送回來源或其他處理目的地。本文契約是：若重送同一個已發生事實，應用封套仍保留 `source=academy.exports`、`event_id=evt-90`；每次投遞可以另有新的傳輸識別與操作稽核紀錄。CloudEvents 1.0.2 也以 `source + id` 區分事件；這不替 consumer 實作去重。參考 [CloudEvents 1.0.2：id](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#id)。

SQS 的產品規則與應用識別不同：redrive 把訊息視為新訊息，配置新的 `messageID`、`enqueueTime` 並重設保留期；FIFO 訊息移往 FIFO DLQ 時，deduplication ID 會被原 message ID 取代。不能只靠 SQS message ID，跨 redrive 辨認 `evt-90`。redrive 也可能與目的地新訊息交錯，並不恢復原始完整業務順序。參考 [SQS：Configuring dead-letter queue redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)。

同一事實重送不應任意改成新的事件 ID 來繞過去重。若使用者明確要求重新寄信或重新產生匯出，那是新的業務意圖，要建立新的識別與責任；不能偷偷把歷史 `ExportCompleted` 改造成「請再做一次」。

## 沿同一工作走一次隔離與恢復

1. `export-intent-7` 已建立 `job-42`；worker 處理 `cmd-42` 時讀取來源暫時失敗。匯出服務保留工作，使用原命令識別做有限退避，沒有因此另建工作。
2. 依賴恢復後，獲准世代的 worker 完成並保存結果，安排 `evt-90`。完成事實不因某個下游失敗而回復為未完成。
3. 通知 consumer 收到 `evt-90`，卻不支援目前事件版本。反覆接收無法修好它，訊息依該訂閱策略進入通知 DLQ；搜尋的進度不必一起停止。
4. 通知團隊確認原因、修正 reader，並核對此事件是否曾產生通知效果。DLQ 中有它，不能排除「寄出後、確認前停止」的另一種歷程。
5. 操作者挑出本次修復涵蓋的範圍，先小量、限速 redrive，保留 `evt-90` 的應用身分與補救紀錄。若 broker 原生 redrive 無法依所需條件篩選，要先安排適當隔離或經審核的處理路徑。
6. consumer 依既有去重與外部通知契約處理；核對成功效果、重複率、錯誤及新積壓，再逐步放大。僅看到 DLQ 變少，仍不能宣布通知完成。

重送前還需確認資料未過期、授權與刪除政策仍允許處理、去重紀錄仍在保留期內，以及依賴有足夠容量。原始錯誤若未修，整批 redrive 只會再形成重試風暴。

## 隔離後仍有未完成責任

「進 DLQ 就沒有副作用」「換新 message ID 就是新事實」「修好程式就能全速重送」都超過目前證據。可恢復流程需要錯誤分類、有限重試、有人負責的隔離、效果核對，以及受控重送。下一篇把完成狀態、事件與去重紀錄放回[資料庫與訊息的原子缺口](database-messaging-and-outbox.md)，說明哪些事情可以一起提交。

## 相關文件

- [訊息佇列與事件驅動架構知識索引](README.md)：閱讀主線。
- [逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)：對外重試契約。
- [過載、時間預算與背壓](../distributed-systems/overload-deadlines-and-backpressure.md)：重試預算與容量。
