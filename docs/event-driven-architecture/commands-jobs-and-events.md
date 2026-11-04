# 命令、工作與事件

訊息是一種傳遞資料的載體；它承載的可能是要求執行的意圖，也可能是已經發生的事實。
區分兩者，才能說清誰負責處理、何時可以宣布完成，以及重送究竟重送了什麼。

上一篇已把[接受工作、交付與完成](async-work-boundaries.md)分開。本文沿用 `job-42`，替其中的命令與完成事件建立應用契約；不預設特定 broker 或封套標準。

查證日期：2026-11-04。來源為 Microsoft Azure 架構文件及 CloudEvents 1.0.2；JSON、識別及歷程均為自創概念例子，未執行程式或訊息服務。

## 三種概念，分別回答不同問題

本文採用以下設計用語。它們是分析責任的方法，不是所有產品 API 都強制使用的訊息分類。Microsoft 的事件驅動架構指南將事件描述為已發生的事實，並說明 producer 與 consumer 的分離；本文據此區分「請做」與「已發生」。參考 [Azure：Event-driven architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven)。

| 概念 | 本例名稱 | 語意與責任 |
| --- | --- | --- |
| 命令（command） | `GenerateExport` | 要求匯出服務產生檔案；由該服務決定執行、拒絕或失敗 |
| 工作（job） | `job-42` | 持續存在的執行追蹤物件，保存狀態、結果與錯誤 |
| 事件（event） | `ExportCompleted` | 宣告匯出已達到約定的完成條件；下游各自決定如何反應 |

「一個負責的服務」不等於「永遠只執行一次」。同一命令可能被多次投遞，也可能由不同 worker 接手；責任仍屬匯出服務。工作則不是每次投遞都另建一筆，同一工作可以經歷多次處理嘗試。

事件的發生與事件的送達也分開。通知 consumer 還沒收到 `ExportCompleted`，不代表匯出尚未完成；它只是還不知道這個事實。反過來，匯出完成事件也不能證明通知已送達使用者。

## 用兩則訊息，寫出意圖與事實

本例命令參考已存在的工作，讓接收端能核對目前狀態與存取規則。它不是 CloudEvents 或任何 broker 的標準格式：

```json
{
  "command_id": "cmd-42",
  "type": "GenerateExport",
  "job_id": "job-42",
  "intent_id": "export-intent-7",
  "format": "text"
}
```

`GenerateExport` 沒有宣稱檔案存在。假設匯出服務已保存檔案，並提交可查詢的成功結果，才產生下列事實事件：

```json
{
  "event_id": "evt-90",
  "type": "ExportCompleted",
  "source": "academy.exports",
  "job_id": "job-42",
  "result_id": "artifact-18"
}
```

本例使用結果識別而非長效公開下載網址，讓讀取仍經既有授權路徑；這是案例設計選擇，格式本身不提供授權。事件也不必攜帶整份匯出內容，每個欄位都應有明確用途與資料邊界。

若把訊息取名 `ExportCompleted`，卻在檔案保存前就送出，下游便可能收到一個當下不成立的事實。「晚點應該會成功」不符合本例事件契約。若要描述接受工作，應另定 `ExportAccepted` 等事件及其成立條件。

## 一個工作，為何需要多種識別

| 識別 | 辨認的範圍 | 重送時的本例規則 |
| --- | --- | --- |
| 意圖識別 `export-intent-7` | 使用者這一次匯出意圖 | 在受理端約定範圍與保留期內保持相同 |
| Request ID | 一次網路請求嘗試 | 重送請求可有新的追蹤識別 |
| 工作識別 `job-42` | 可查詢的工作 | 多次嘗試仍指向同一工作 |
| 命令識別 `cmd-42` | 同一項執行要求 | 重送該命令保持相同，接收端仍需實作去重 |
| 事件識別 `evt-90` | 同一個已發生事實 | 應用重送同事件保留識別；不同事實另給識別 |

同一工作可先後產生 `ExportAccepted`、`ExportCompleted` 等不同事件。因此只用 `job_id` 去掉所有重複事件，可能把真正不同的事實一起丟掉。反過來，每次投遞都給同一事實一個新事件識別，又會讓依事件識別去重的 consumer 無法辨認重送。

CloudEvents 1.0.2 以 `source + id` 識別事件；同事件重送可使用相同 `id`。這是標準的事件識別規則，不是「同工作所有事件用同一 id」，也沒有替業務效果實作去重。本文 JSON 使用自訂 `event_id`，尚未採用完整 CloudEvents 封套。參考 [CloudEvents 1.0.2：id、source](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#required-attributes)。

這些應用識別也不等於 broker 自動產生的 message ID 或投遞憑據。實際重新發布、搬移或 redrive 時，要另外查產品規則，不能把本例的身分契約套到所有傳輸欄位。

## 沿同一歷程，看失敗由誰處理

1. API 受理 `export-intent-7`，保存 `job-42`，安排 `cmd-42`。若交接失敗，受理端仍要找出未交付工作。
2. worker 處理命令，發現來源文章不符合本例匯出規則。匯出服務負責把工作帶到可解釋的失敗狀態；不能發布 `ExportCompleted`。
3. 若匯出成功，匯出服務保存結果並安排 `evt-90`。保存結果與發布事件仍有雙寫缺口；把訊息命名為事件並不會解決它。
4. 通知與搜尋各自收到 `evt-90`。通知暫時失敗時，匯出結果仍然成立；通知端依自己的處理契約恢復。

如果產品需求是「匯出檔案與通知都完成才算整項流程完成」，應另建流程狀態與完成條件，分開追蹤匯出完成與通知完成。不能讓同一個 `ExportCompleted` 在不同 consumer 心中代表不同終點。

## 使用事件，仍然存在契約依賴

producer 不必直接呼叫每個下游，不代表彼此完全沒有依賴。事件的成立時點、欄位含義、保存及重送方式都會影響 consumer。Azure 指南也提醒事件驅動架構的最終一致性、錯誤處理與 schema 演進等挑戰。參考 [Azure：Event-driven architecture，Challenges](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven#challenges)。

命令也可以經佇列非同步傳遞；事件也可以透過同步 HTTP 呼叫送出。通訊方式與業務語意是兩個選擇，不能只看 `topic` 或 `queue` 的名稱判定。

下一篇讓同一事件分送給不同下游，比較[Queue、Pub/Sub 與持久日誌](queues-pubsub-and-logs.md)如何安排各自的消費進度。

## 相關文件

- [訊息佇列與事件驅動架構知識索引](README.md)：回到主線。
- [Webhook、事件回呼與反向通知契約](../api/webhooks-and-event-callbacks.md)：對外傳遞事件時的契約與防護。
- [從重送請求到冪等副作用](../distributed-systems/retries-and-idempotent-effects.md)：識別如何和實際業務效果連在一起。
