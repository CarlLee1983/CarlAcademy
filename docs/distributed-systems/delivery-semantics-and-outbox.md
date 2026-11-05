# 投遞語意、Outbox 與 Inbox

訊息傳遞與業務效果需要分開定義；Outbox 保住狀態變更後的發布責任，Inbox 則可在明確的本地交易範圍內避免同一事件重複生效。

接續 [Saga 與業務補償](sagas-and-business-compensation.md)，文章匯出工作完成後，要更新資料庫並通知其他服務。補償流程並沒有消除這兩個系統之間的雙寫窗口。

查證日期：2026-11-05。參考 AWS 官方 Outbox 指南及 Apache Kafka 4.1 設計文件。所有表名、識別與故障歷程為概念推演，未部署 broker、執行 SQL 或故障注入。本篇聚焦分散式正確性的邊界；事件系統的完整操作主線見[訊息佇列與事件驅動架構](../event-driven-architecture/README.md)。

## 先說清楚「一次」發生在哪裡

| 語意 | 在明訂傳遞邊界上的意思 | 不能直接外推的結論 |
| --- | --- | --- |
| 至多一次（at-most-once） | 可漏掉，但不重複交付所定義的訊息 | 不保證每項業務意圖都有結果 |
| 至少一次（at-least-once） | 在保存、重試與恢復條件成立時，最終交付，可能重複 | 不代表每次執行都只造成一份效果 |
| 恰好一次處理（exactly-once processing） | 所定義的已提交輸出，如同每項輸入生效一次 | 不表示網路封包、程式計算或任意外部呼叫只發生一次 |

這些不是只靠先後提交 offset 就定義的通用協定；offset 是日誌系統的一種進度表示。訊息遺失、保存期限、永久儲存損毀與依賴永不恢復，也不能被「至少一次」口號排除。參考 [Kafka 4.1：Message Delivery Semantics](https://kafka.apache.org/41/design/design/#message-delivery-semantics)。

Kafka 的交易型讀取、處理、寫入可以把輸出 topic 與輸入 offset 一起提交，並配合正確的 consumer 隔離與恢復方式。目的地換成外部系統時，需要對方配合或另一個共同原子邊界；不能由 Kafka 內部交易推論郵件、付款或物件寫入也只生效一次。來源：[Kafka 4.1：Using Transactions](https://kafka.apache.org/41/design/design/#using-transactions)。

## 交換雙寫順序，沒有消除故障窗口

工作 `job-42` 完成後，若先提交成功狀態再發布事件，程序可能在兩步之間停止，下游便收不到通知。若先發布再提交，交易可能 rollback，下游卻已收到不成立的完成事實。

交易式寄件匣（transactional outbox）在同一個本地交易內保存成功狀態、結果識別與待發布事件 `evt-90`；relay 只讀已提交紀錄，負責發布、核對確認與恢復進度。這把「業務狀態成立」和「有人必須發布」綁在一起，不等於下游已收到。來源：[AWS：Transactional outbox，Motivation、Using an outbox table](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)。

Outbox 也能保存命令，但命令與事件語意不同：建立工作時的 `RunExport` 是待執行的要求，完成時的 `ExportCompleted` 才是已成立的事實。不能只因兩者都放在一張表，就混用它們的契約。

## 逐步歷程：發布成功後仍會重送

| 步驟 | 動作 | 持久證據 |
| --- | --- | --- |
| 1 | 完成交易提交 `job-42=succeeded` 與 `evt-90` | 工作與 Outbox 一起存在 |
| 2 | relay 發送 `evt-90`，取得符合需求的 broker 確認 | broker 已接受，Outbox 還未記錄交接完成 |
| 3 | relay 在補記前停止 | 恢復程序仍看見待發責任 |
| 4 | relay 恢復，以同一事件識別重送 | 接收端可能再次收到 `evt-90` |
| 5 | consumer 核對本地已處理紀錄 | 能否略過，取決於它是否與本地效果一起提交 |

若為避免第 4 步而先把 Outbox 標為已送，再做發布，程序停止就可能永久漏送。這個窗口說明為何可靠交接要容許重送；不表示每次故障都一定重複。來源：[AWS：Duplicate messages](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)。

relay 的確認條件、資料保留、並行 claim 與積壓恢復都要有明確政策；加一張表卻沒有人持續處理，不能保證最終發布。

## Inbox 與本地效果必須共同提交

收件匣（inbox）以 consumer 的責任範圍記錄已處理事件。例如統計 consumer 與搜尋 consumer 都應處理 `evt-90`，不能由全域一筆「已處理」阻擋另一個訂閱。

假設統計資料與 Inbox 同在一個資料庫，本例可採取：

1. 驗證事件身分，開啟本地交易。
2. 用唯一約束競爭建立 `(consumer, source, event_id)` 紀錄。
3. 若是新事件，在同一交易更新統計；任一步失敗都一起 rollback。
4. 提交後才依消費契約確認投遞；若提交結果未知，先依識別核對。
5. 確認已有同一事件的已提交紀錄，才可略過相同效果。

這是本例的交易設計，不是 Kafka 自動替外部資料庫執行的功能。資料庫的衝突與交易回復語意也須核對；不能捕捉所有唯一鍵錯誤就當作成功，因為錯誤可能來自另一個業務約束。詳細資料庫例子與競爭邊界見[資料庫與訊息的原子缺口](../event-driven-architecture/database-messaging-and-outbox.md)。

Inbox 若只表示「已接收並持久建立待辦」，其本地效果就是建立待辦，並非整個匯出完成。允許計算在交易外執行時，還必須有人掃描、接管與重試未完成工作；不能先記已處理，之後 crash 就讓工作永遠被略過。

## 外部效果仍是另一段契約

若 consumer 需要寄信，先寄再記 Inbox，可能寄出後 crash 而重寄；先記 Inbox 再寄，則可能永遠沒寄。把寄信呼叫放進 SQL 交易的程式區塊，不會讓外部寄送跟著 rollback。

可先在本地交易保存待送通知，再由 dispatcher 依供應者的冪等鍵、查詢與保留期恢復。若對方沒有足夠能力，未知結果就要保留為未知，由業務選擇容許重複、容許漏送或人工核對。補償可能減輕後果，卻不能收回已寄出的第一封信。可回查[冪等副作用](retries-and-idempotent-effects.md)及 [Saga](sagas-and-business-compensation.md)。

## 順序與保留期不由去重代辦

同一工作有版本 7 與版本 8 的事件，去重只能辨認同一事件，不能阻止版本 7 晚到後覆蓋版本 8。路由到同一分區有助形成某段傳輸順序，但平行 relay、重試與 consumer 執行仍可能影響實際次序。需要逐工作順序時，應共同設計發布次序、處理序列與版本檢查；缺版本也要決定等待、補讀或拒絕。詳見[消費並行、分區與順序](../event-driven-architecture/concurrency-partitions-and-ordering.md)。

刪除 Inbox 後，舊事件可能再次被當成新事件。保留期要涵蓋允許的重送、事故補救與歷史重播；沒有通用的七天或三十天答案。也不能只按事件時間戳拒絕所有舊訊息，就宣稱沒有漏做：真正尚未處理的舊事件也可能被丟掉。保留以外的事件需要明確的失效、對帳或重建契約。

常見錯誤推論是「Outbox 加 Inbox 等於整條鏈恰好一次」。它們能保護各自原子邊界內的責任與效果，邊界之間仍有傳播延遲、重送與未知結果。

下一篇[收斂、合併與 CRDT](convergence-and-crdts.md)轉向另一種問題：當資料可以安全合併時，哪些更新能容許暫時分歧，哪些不變式仍需要協調？
