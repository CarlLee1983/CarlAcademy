# Saga 與業務補償

Saga 把跨服務工作拆成各自提交的本地交易，再用業務補償處理失敗；它允許中間狀態被觀察，不提供整段流程的資料庫 rollback 或全域隔離。

接續[原子提交與兩階段提交](atomic-commit-and-two-phase-commit.md)，假設文章匯出服務不希望長時間保留跨資料庫的預備交易，而且業務允許「先保留配額，失敗後釋放」。這時可以重新定義工作契約，而不是假裝多個普通 API 呼叫仍是一筆原子交易。

查證日期：2026-11-05。參考 AWS 與 Microsoft 的官方 Saga、補償模式文件。下列單據、狀態與故障歷程為自創概念設計，未執行服務部署或補償測試。

## 補償是新的業務動作

本地交易一旦提交，其他流程可能已讀到它的結果；之後的補償是在目前世界中執行另一個動作，不是把整個世界倒帶。

例如保留一次配額後，取消該保留可以恢復可用額度，但「使用者曾看見處理中」這件事不會消失。已寄出的郵件也不能用資料庫 rollback 撤回，最多依業務規則寄更正通知。補償未必是原操作的算術反向，也未必按完全相反的次序執行。來源：[Microsoft：Compensating Transaction，Solution](https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction)。

因此設計 Saga 前要先問：哪些中間狀態可以公開？哪些資源可以釋放？哪些動作不可逆？如果需求禁止任何中間狀態可見、又沒有可接受的補救，Saga 不能只靠改名就滿足需求。

## 匯出流程的正向步驟與補償

本例為每次匯出建立流程識別 `saga-A`，每筆配額保留有自己的 `reservation-A`：

| 正向步驟 | 本地提交的證據 | 失敗後可採取的補償 |
| --- | --- | --- |
| 保留配額 | 建立 `reservation-A=reserved`，同交易更新可用額度 | 只釋放這一筆仍可釋放的保留 |
| 建立工作 | `job-A` 與原流程識別建立唯一對應 | 按工作狀態取消；已完成時需另訂政策 |
| 執行匯出 | 保存工作嘗試、候選檔案及合法完成狀態 | 停止後續發布、清理未選用產物；已對外提供的結果不能假裝未存在 |
| 結算與通知 | 消耗該保留、建立通知意圖 | 退款或補發等獨立業務決定，不能把已寄通知回滾 |

這些是多個本地交易，不是一筆包住整張表的交易。若「建立工作」回覆逾時，協調者應先用穩定識別核對結果或同鍵重試，不能立即認定工作未建立，卻同時釋放它仍可能使用的配額。

AWS 官方指南把參與者冪等性、缺乏交易隔離與補償複雜度列為考量；最終能完成或補救，仍依賴依賴服務恢復和持續處理，並非模式名稱自帶的無條件收斂保證。來源：[AWS：Saga orchestration，Issues and considerations](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html)。

## 協調與協同：責任放在哪裡

協調式（orchestration）由流程協調者記錄步驟並下達命令；協同式（choreography）由各服務依事件觸發下一步。兩者都需要有人能判斷整體進度、恢復未知結果，並處理卡住的工作，事件串接不會使這些責任消失。參考 [Microsoft：Saga pattern，Choreography、Orchestration](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga)。

本例採協調式，持久保存 `running`、`compensating`、`completed`、`compensated` 或 `needs_review` 等流程狀態，以及每步的操作識別和已知結果。協調者重啟後從紀錄恢復；它在發出命令後、記錄結果前停止，會留下不確定窗口，因此參與者仍須支援核對與安全重送。

若出現兩個恢復者，也需要版本條件或所有權協定限制相互衝突的推進；「進度寫進資料庫」本身不等於所有並行問題已解決。可回查[租約與 fencing](leases-locks-and-fencing.md)。

## 逐步反例：重複補償釋放了別人的配額

假設帳戶最多可保留一個匯出名額，錯誤設計只有整體計數，取消端點不辨認保留單據：

| 步驟 | 事件 | 已使用名額 |
| --- | --- | --- |
| 1 | A 保留一份配額 | 1 |
| 2 | A 的工作確定未建立，首次取消扣減計數，但回覆遺失 | 0 |
| 3 | B 成功保留名額並開始工作 | 1 |
| 4 | A 的協調者重試取消，端點再次直接減一 | 0，但 B 仍在執行 |
| 5 | C 看見有空額度，也取得名額 | B、C 同時占用，超出一份限制 |

問題在第 4 步的重複扣減。單純「A 的首次取消晚到，將原本 A、B 合計兩份降為一份」未必是錯誤，不能把這種合理釋放誤寫成反例。

本例的修正是把取消綁定 `reservation-A`，以本地交易同時檢查 `reserved → released` 與返還額度。A 的首次取消成功後，重送只讀回既有結果；它不能修改 `reservation-B`。對已 `consumed` 的保留則按結算規則處理，不能盲目釋放。

這是本例的不變式設計，不表示每個 Saga 都必須加全域遞增 token。若用帳戶最新世代直接拒絕所有舊保留的清理，反而可能使仍應釋放的舊單據永遠卡住；識別、版本與權限範圍要對準實際資源。

## 沒有全域隔離，業務狀態必須能解釋

各步已提交的中間狀態可以被其他流程看到。這不是資料庫讀到未提交資料的同一種「髒讀」，而是整體業務尚未結束，本地資料已經成立。

例如 A 保留額度後，B 暫時被拒絕；A 稍後失敗釋放，不代表 B 當時看到的是一筆未提交交易。產品需能解釋保留中的額度、可取消時機與重試方式。若使用語意鎖或 `pending` 狀態限制操作，也要為卡住的狀態訂恢復政策，不能只增加一個永不清除的旗標。來源：[AWS Saga：Transaction isolation](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html)。

## 補償也會失敗

補償請求可能成功但回覆遺失，也可能因依賴故障暫時無法執行。流程需保存未完成責任，針對可重試錯誤退避重試，並以同一補償識別核對結果。

遇到永久拒絕、資料規則衝突或無法安全判斷的外部效果時，應保留證據並進入有負責人的人工處理流程。告警、隔離工作或死信佇列可以協助交接，但「放入死信」不代表補償完成，更不要求每種實作都一定使用 DLQ。來源：[Microsoft：Compensating Transaction，Problems and considerations](https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction)。

常見錯誤推論是「正向失敗就把已執行步驟反著呼叫一遍」。正確處置還需要確定各步是否真的成功、能否補救、重送是否安全，以及並行操作是否已改變可接受的結果。

下一篇[投遞語意、Outbox 與 Inbox](delivery-semantics-and-outbox.md)會處理另一個缺口：流程已記錄成功，如何讓待發布事件在故障後仍有人接續，而不把重複訊息當成異常例外？
