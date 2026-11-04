# 資料庫與訊息的原子缺口

資料庫提交成功，不代表完成事件已發布；broker 接受事件，也不代表資料庫一定提交。當同一項業務變更要寫兩個系統，必須找出它們之間的故障窗口。

上一篇已說明[重試與安全重送](retries-dead-letters-and-redrive.md)。本文以 `export-intent-7`、`job-42`、`cmd-42` 與 `evt-90` 為例，讓本地狀態與發布責任一起保存，再限制消費去重真正涵蓋的範圍。基本交易原子性可回查[交易與隔離](../relational-databases/transactions-and-isolation.md)。

查證日期：2026-11-04。Outbox 參考當日 AWS Prescriptive Guidance，唯一約束與交易語意對照 PostgreSQL 18；事件身分沿用 CloudEvents 1.0.2。所有表名、流程與世代規則是自創概念設計，未執行 SQL、relay 或故障測試。

## 調換雙寫順序，只會調換風險

假設完成契約是「檔案已按規則保存，工作結果可查」，worker 還要發布 `ExportCompleted`。若資料庫與 broker 沒有共同交易，兩種直覺安排都有問題：

| 順序 | 停止的位置 | 可觀察的不一致 |
| --- | --- | --- |
| 先提交 `job-42=succeeded`，再發布 `evt-90` | 資料庫成功後、發布前 | 使用者查到成功，下游卻永遠不知道 |
| 先發布 `evt-90`，再提交成功 | broker 接受後、資料庫 rollback | 下游收到完成事實，工作卻沒有已提交的成功結果 |
| 發布後再補記「已送出」 | broker 接受後、補記前 | 恢復程序無法分辨未送出與已送出但未記錄 |

第三列還會出現在修復機制內，不能靠捕捉例外、把發布放進 `finally` 或立即重試消除。資料庫交易也不會因程式在交易區塊裡呼叫 broker，就把 broker 納入交易。AWS 的 Outbox 指南以相同的雙寫故障作為動機。參考 [AWS：Transactional outbox pattern，Motivation](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)。

## Outbox：一起保存狀態與待發布責任

**Transactional Outbox（交易式寄件匣）**在擁有業務狀態的資料庫裡，保存待發布訊息，讓業務變更與該紀錄共用本地交易。另一個 **relay（轉送程序）**只讀已提交的紀錄，負責發布與追蹤交接結果。

本例完成交易包含：將 `job-42` 從合法的執行中狀態轉成成功、選定結果識別，以及建立內容固定的 Outbox 紀錄 `evt-90`。交易 rollback 時，成功狀態與待發布事件一起回復；提交時，兩者一起存在。它保證的是「狀態成立時，有可恢復的發布責任」，不是事件已即時送達所有訂閱。參考 [AWS：Transactional outbox pattern，Using an outbox table](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)。

API 受理端也可在同一交易建立 `job-42` 與命令 `cmd-42` 的 Outbox 紀錄，補上第一篇「工作已存在、命令未交付」的缺口。命令與事件仍有不同語意，Outbox 只是它們共用的可靠發布方法。

Relay 需要明確的待送／確認狀態、重試、積壓告警與清理政策。多個 relay 併行時，要以資料庫 claim 等方式協調紀錄所有權；同一工作若需要順序，也要保存並遵守工作版本，不能只靠讀取時間排序。可以使用輪詢，也有依資料庫變更紀錄的 CDC 路徑；選擇須核對產品能力，新增元件並非模式成立的必要條件。

## Relay 的重複是預期情況

假設 relay 把 `evt-90` 送到 broker，broker 已接受，但 relay 在保存已送狀態前停止。下次仍會讀到待送紀錄，於是再次發布同一事件。若反過來先記已送再發布，停止就可能永久漏送。

因此 relay 必須容許重送，consumer 也必須安全處理重複；AWS 指南亦明列 duplicate messages 的考量。重送時保留同一 `evt-90`，不能每次產生新 ID。Outbox 的事件身分要持久保存，不能只在 relay 記憶體裡暫時產生。

事件抵達不同訂閱的時刻仍可能不同。Outbox 本身也不自動保序：平行 relay、重試與 broker 路由都會影響次序。需要每工作保序時，應連同前篇的 key、版本與消費執行規則一起設計；單一事件表不能代替整段契約。

## Inbox：去重紀錄要和自己的效果一起提交

**Inbox（收件匣）／已處理訊息表**記錄某個 consumer 已完成哪些事件。本例鍵設為 `(consumer, source, event_id)`：搜尋 consumer 與統計 consumer 各有責任，不能由一個全域 `evt-90 已處理` 阻止另一個下游執行。`source + id` 的事件身分來自應用契約，與 CloudEvents 1.0.2 的規則對應。參考 [CloudEvents 1.0.2：Required Attributes](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#required-attributes)。

以效果和 Inbox 都在統計服務同一資料庫為例：

1. 驗證事件契約，開始本地交易。
2. 嘗試建立有唯一約束的 `(statistics, academy.exports, evt-90)` 紀錄。
3. 若為新紀錄，在同一交易更新統計資料；若效果失敗，整筆交易 rollback，不能留下「已處理」。
4. 交易提交成功後才結束投遞。若提交結果因斷線未知，恢復後依鍵核對，不能憑例外斷言已 rollback。
5. 再收到同事件時，若確認已有已提交的 Inbox 紀錄，即可略過同一效果；競爭中的未提交紀錄不能被直接當成完成證據。

唯一約束是在資料庫邊界裁決競爭；「先查不存在，再各自更新」沒有同等保護。PostgreSQL 18 支援組合欄位唯一約束，但衝突如何回復、何時需重開交易，仍要依實際資料庫與驅動實作，不能捕捉錯誤後假定原交易可繼續。參考 [PostgreSQL 18：Unique Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS)。

這個邊界下，Inbox 和業務變更要麼一起提交，要麼一起回復：若先提交 Inbox 再做效果，可能永久漏做；若先提交效果再寫 Inbox，則重送可能重做。去重保留期也需涵蓋允許的重送與歷史補救，刪掉紀錄後，舊事件不會繼續被這個鍵辨認。

## 檔案與通知，仍在本地交易之外

匯出檔案通常不在工作資料庫裡。本例沿用第五篇的世代規則，把「可能重做計算」和「選定正式結果」分開，而不宣稱檔案只建立一次：

| 階段 | 本例做法 | 故障後留下什麼 |
| --- | --- | --- |
| 取得工作 | 資料庫原子授予處理世代；過期接手須符合恢復政策 | 舊 worker 仍可能執行，但失去選定結果的資格 |
| 產生檔案 | 每次嘗試寫入專用、不可覆寫的候選檔，確認可依契約讀取 | 完成前停止可留下孤兒候選檔 |
| 選定結果 | 同一資料庫交易檢查目前世代、預期版本與 `running`，再選定檔案、轉成功並寫 `evt-90` Outbox | 條件不符則不改狀態、不建立完成事件 |
| 清理候選檔 | 依保留與引用關係，回收確定未選用且不再執行中的檔案 | 清理須避免刪掉有效結果或仍在寫入的候選檔 |

最後的世代檢查必須和完成更新原子執行；在寫檔前查一次資格並不足夠。這是應用設計：它允許多份候選產物，只選定一份正式結果；不把檔案系統加入資料庫交易，也不保證儲存本身永不故障。結果保存期限、權限與清理政策仍須維護。

通知更不能靠本地 Inbox 就承諾只寄一次。先寄信再記錄，可能寄出後停止而重寄；先記錄再寄，可能漏寄。在通知資料庫先保存通知工作與自己的 Outbox，能保住再次交付責任；真正外部寄送還要依供應者的冪等鍵、結果查詢與保留期契約核對。若對方沒有這些能力，就須明示可能重複或未知，不能用資料庫 rollback 收回已寄出的信。共同原理見[從重送請求到冪等副作用](../distributed-systems/retries-and-idempotent-effects.md)。

## 用一段歷程核對三個邊界

`export-intent-7` 的受理交易先建立 `job-42` 與 `cmd-42` Outbox；relay 交付命令。worker 的合法世代保存候選檔，再由完成交易選定結果並保存 `evt-90`。relay 發布後、補記前停止，恢復後重送同事件。統計 consumer 第一回在同一交易提交 Inbox 與統計效果，第二回核對紀錄後不再累加；通知端則依自己的外部寄送契約恢復。

這段概念歷程分別保住受理責任、完成事實與單一 consumer 的本地效果，沒有把 API、檔案、broker 和通知綁成一筆全球交易。Outbox 尚未送完、下游尚未追上時，資料可以暫時不同步；恢復還依賴 relay 有人維護、訊息未過期及資源恢復，不能只加資料表便宣稱必定完成。

下一篇把這些身分與版本放入[事件封套、Schema 與相容演進](event-envelopes-and-schema-evolution.md)，檢查多年後的 consumer 是否仍能理解同一個事實。

## 相關文件

- [訊息佇列與事件驅動架構知識索引](README.md)：閱讀主線。
- [同步呼叫與非同步工作邊界](async-work-boundaries.md)：工作建立與交接的原始缺口。
- [發布確認與消費確認](publisher-confirms-and-consumer-acks.md)：broker 證據與業務提交分離。
- [約束與資料完整性](../relational-databases/constraints-and-data-integrity.md)：唯一約束的資料庫責任。
