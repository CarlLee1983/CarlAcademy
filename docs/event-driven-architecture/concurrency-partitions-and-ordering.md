# 消費並行、分區與順序

增加 worker 可以分攤工作，卻不會自動維持每項工作的狀態順序。要避免舊結果覆蓋新結果，必須同時說清訊息怎麼排列，以及最後由誰裁決寫入。

上一篇拆開[發布與消費確認](publisher-confirms-and-consumer-acks.md)。本文沿用 `export-intent-7`、`job-42`、`cmd-42` 與完成事件 `evt-90`，先區分順序，再處理失去消費權的 worker。

查證日期：2026-11-04。Kafka 設計文件固定 4.1，該路徑 Java API 當日標示 clients 4.1.2；SQS 為當日線上文件，資料庫條件更新對照 PostgreSQL 18。所有歷程與世代規則是自創概念推演，未部署或執行並行測試。

## 「先發生」至少有五個觀察點

| 次序 | 本例觀察 | 為何不能直接推到下一欄 |
| --- | --- | --- |
| 業務發生順序 | `job-42` 先進入執行中，後來完成 | producer 暫停或網路延遲，可能晚送較早的事實 |
| 追加順序 | broker 將紀錄依序寫入某分區 | 只描述該分區接受的次序，不替不同來源重建因果 |
| 投遞順序 | consumer 先收到位置 20，再收到 21 | 收到後仍可能分派到不同執行緒 |
| 執行順序 | 兩個 handler 開始或結束的先後 | 較早開始的工作可能較晚結束 |
| 提交順序 | 資料庫效果或消費位置被持久保存 | 業務提交與 offset commit 又是兩個不同邊界 |

時間戳可用來分析，但不同程序的時鐘與延遲不能替上述邊界提供全域順序。需要「先完成 A 才能做 B」時，應表達業務依賴、版本或狀態轉移，不能只比較訊息時間。

## Key 是路由材料，分區才是排序範圍

Kafka 的順序範圍是單一 partition。若 producer 使用約定的路由，把相同 `job_id` 送到同一分區，就能以該分區的追加順序讀取；不同工作分區間沒有全域先後。這依賴實際 partitioner、路由設定及分區數等條件，不能只因 payload 有 `job_id` 欄位就宣稱保序。路由規則改變也必須重新評估原來的假設。參考 [Kafka 4.1：Introduction，Topics and Partitions](https://kafka.apache.org/41/getting-started/introduction/)。

在 **traditional consumer group** 中，一個 partition 同時分配給 group 內一個 consumer；不同 partition 可由不同 consumer 處理。若只有兩個 partition，增加到十個 consumer 並不會得到十份分區消費並行。這個說法限定傳統群組；Kafka 4.1 的 **share group** 是 preview，允許同一 partition 的紀錄分配給多個 consumer 並逐筆確認，不可套用相同的獨佔模型。參考 [Kafka 4.1：Design，The Consumer、Share groups](https://kafka.apache.org/41/design/design/)。

即使只有一個 consumer 讀分區，它若把收到的紀錄放入 worker pool，效果仍可能亂序。最直接的設計是同一工作依序完成，不同工作才並行；更細的 key 排程能提高吞吐，但要額外維護排隊、失敗與進度，應由實際需求決定。

SQS FIFO 的排序單位則是 `MessageGroupId`。本例可選 `job-42` 為 group，使不同工作有並行空間；不同 group 沒有共同排序。一次 receive 可能取得同 group 的多則訊息，應用仍需依序處理該批，不能全部平行送出後期待效果保序。參考 [SQS：FIFO queue delivery logic，Receiving messages](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html)。

## 並行完成，不能把提交位置跳過缺口

假設某 Kafka partition 的下一恢復位置是 20，consumer 讀到 offset 20、21、22，分派後 21、22 先完成，20 還在執行。若此時提交 23，程序停止後就可能從 23 恢復，讓 20 的未完成效果被跳過。

正確性要求提交位置只越過**已完成的連續前綴**：這批已交付紀錄中，最早的未完成工作還在 20，恢復位置就不能越過它；等 20 完成，才可涵蓋整批。不能用「最大已完成 offset 加一」替代這個判斷。Kafka API 也要求並行處理時協調完成與提交，避免進度超前。參考 [Kafka 4.1 Java API：KafkaConsumer，Multi-threaded Processing](https://kafka.apache.org/41/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)。

「連續」指實際讀取進度中的未完成缺口，不是每個整數 offset 都一定有一筆可讀紀錄。壓縮或交易等情況可以留下 offset 間隙；程式需依讀取批次與下一位置維護進度，不能永遠等待一個不存在的整數位置。上述 API 的 Offsets and Consumer Position 明示這項限制。

## 失去分區，不等於舊程序已停止

Rebalance 是群組重新分配 partition 的過程。consumer 太久沒有 poll 等情況可失去分配，後續 offset commit 可能失敗；這不會撤銷已送出的資料庫寫入。參考 [Kafka 4.1 Java API：Detecting Consumer Failures](https://kafka.apache.org/41/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)。SQS visibility 到期也有相同的應用風險：新 worker 接手時，舊 worker 可能仍在跑。

本例因此在工作資料列保存遞增的 `generation`，代表目前獲准的處理世代，另以 `version` 表達狀態版本。接手與世代遞增須由資料庫原子裁決，依明訂的逾期／恢復政策進行；收到重複訊息本身不足以任意取代現任 worker。這是應用所有權規則，與 Kafka group generation 不是同一個值。

1. `export-intent-7` 已建立 `job-42`，worker A 接到 `cmd-42`，原子取得世代 1，狀態為 `running`。
2. A 停頓，恢復程序依契約判定可接手。worker B 原子取得世代 2；A 的世代即使還在記憶體裡，也已過期。
3. A、B 分別把檔案寫到自己嘗試專用、不可覆寫的候選位置。兩者都不能直接覆蓋共用的正式結果路徑。
4. B 完成後，以「工作仍為 `running`、目前世代等於 2、狀態版本符合預期」作同一筆條件更新；成功才選定 B 的候選檔為結果並推進版本。
5. A 晚到的完成更新因世代不符而影響零筆，不能選定結果或發布完成事實。A 的候選檔可成為待清理孤兒；這不代表 A 從未執行。
6. 只有獲准的成功轉移才安排 `evt-90`。如何把成功狀態與待發布事件一起提交，由第七篇的 Outbox 接續。

條件判斷與寫入必須是同一個原子操作；先查世代、離開交易後無條件寫入，仍有競爭窗口。PostgreSQL 18 的 Read Committed 條件更新在等待競爭寫入後會重查條件，可作為一種具體實作基礎；其他資料庫需核對等價保證。參考 [PostgreSQL 18：Transaction Isolation，Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED)。這項保護只涵蓋接受條件檢查的資源，不能阻止舊 worker 任意呼叫外部服務。

## 版本較新，也不一定能跳過所有舊訊息

對下游投影，若每筆訊息包含完整狀態快照，且版本由同一工作權威來源單調遞增，consumer 可用原子條件只接受較新版本，避免晚到的 `running` 覆蓋已完成結果。前提是快照真的足以取代舊狀態，而且沒有每筆都必須執行的副作用。

若訊息是增量，例如「增加已處理文章數」，版本 4 不能任意跳過缺少的版本 3。consumer 需偵測缺口，等待、補讀或取得可信快照再恢復；單純丟掉所有較舊版本，可能永久漏掉一段變更。版本去重、事件去重與增量完整性是不同問題。

順序策略最終要回答：在哪個範圍序列化、哪個資料庫條件拒絕舊寫入，以及遇到缺口要停等還是恢復。下一篇討論其中的失敗紀錄如何[重試、隔離與安全重送](retries-dead-letters-and-redrive.md)。

## 相關文件

- [訊息佇列與事件驅動架構知識索引](README.md)：閱讀主線。
- [Queue、Pub/Sub 與持久日誌](queues-pubsub-and-logs.md)：回查分區與獨立消費進度。
- [從重送請求到冪等副作用](../distributed-systems/retries-and-idempotent-effects.md)：原子邊界與外部效果的限制。
