# 事件封套、Schema 與相容演進

事件能成功送達，不代表接收端仍能正確理解。當通知已升級、搜尋仍用舊程式，或統計需要重讀半年前的資料時，同一事件契約必須同時回答「這是哪個事實」與「這些值當時代表什麼」。

本文接續[資料庫與訊息的原子缺口](database-messaging-and-outbox.md)，沿用完成事件 `evt-90`。事件的可靠保存與發布不會替代相容性設計；反過來，格式正確也不能修補雙寫缺口。

查證日期：2026-11-04。CloudEvents 固定 1.0.2、Avro 固定 1.12.0、AsyncAPI 固定 3.0.0。下列 JSON、版本與升級歷程是自創概念例子，未部署 broker、執行 SDK 或測試相容性工具。

## 封套、資料格式與業務契約分開

**事件封套（envelope）**是包住業務資料的共同脈絡，例如來源、識別及類型。**Schema（結構描述）**定義欄位與型別等可檢查規則；JSON 是資料表達方式，並不自行規定 `size` 的單位。業務契約還需定義事件何時成立、欄位意義、允許的缺值及存取邊界。

第二篇的自訂格式使用 `event_id: evt-90`、`source: academy.exports`。若採 CloudEvents，不能只改欄位名稱就宣稱完成：必須選定來源命名空間並保留身分映射。本例把舊來源映射到 `urn:academy:exports`，舊 `event_id` 映射到 `id`；重送這個事實時使用相同配對。這項遷移規則由本例擁有，broker 不會自行知道兩種封套指向同一事件。新舊格式交疊時，consumer 必須先依受控、已驗證來源的遷移規則轉成同一個 canonical 事件鍵，再檢查 Inbox；既有去重紀錄也需能對應，避免換封套後把同一事實算兩次。不能接受任意 producer 自行宣稱另一個來源的別名。

```json
{
  "specversion": "1.0",
  "id": "evt-90",
  "source": "urn:academy:exports",
  "type": "academy.export.completed.v1",
  "subject": "jobs/job-42",
  "time": "2026-11-04T02:00:00Z",
  "datacontenttype": "application/json",
  "data": {
    "schema_version": 1,
    "job_id": "job-42",
    "result_id": "artifact-18",
    "size_bytes": 4096
  }
}
```

CloudEvents 1.0.2 必要屬性為 `id`、`source`、`specversion`、`type`。`source` 是非空 URI-reference，建議使用絕對 URI；本例 URN 符合這個命名目的，不是供 consumer 下載的網址。事件身分是 `source + id`，不能單看 `evt-90` 就跨所有來源去重。參考 [CloudEvents 1.0.2：Required Attributes](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#required-attributes)。

`specversion: 1.0` 表示採用的 CloudEvents 規格，雖然文件版本是 1.0.2，這裡仍填 `1.0`。`data.schema_version` 與 `type` 尾端的版本則是本例的業務契約選擇；兩者需保持一致，不能讓消費者猜哪個優先。`subject`、時間與資料內容類型提供額外脈絡，但不證明授權、處理順序或業務效果恰好一次。參考同規格的 [specversion](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#specversion)。

## 先寫出兩個讀取方向

假設搜尋程式的部署比 producer 慢一天。**Writer schema** 是寫入時實際採用的結構；**reader schema** 是讀取程式期待的結構。「向後相容」等術語容易因工具視角不同而誤會，因此先把問題寫成「新 reader 讀舊 writer 的資料」或反方向。

以下借 Avro 1.12.0 的 record resolution 規則分析欄位；上面的 CloudEvents JSON 並未因此變成 Avro 編碼。假設 record 名稱及其他欄位型別相同，沒有 alias 等額外設定，每列各自和 v1 比較：

| v1 到 v2 的改動 | 新 reader 讀舊 writer | 舊 reader 讀新 writer |
| --- | --- | --- |
| 新增 `locale`，新 reader 定義 default `und` | 可用新 reader 的 default 補值 | 舊 reader 忽略多出的欄位 |
| 新增 `locale`，新 reader 沒有 default | 缺欄位，resolution 失敗 | 舊 reader 忽略多出的欄位 |
| 刪除 v1 的 `size_bytes`，舊 reader 沒有 default | 新 reader 忽略舊資料中的欄位 | 舊 reader 缺所需欄位，失敗 |
| 刪除 `size_bytes`，舊 reader 原有合法 default | 新 reader 忽略多出欄位 | 舊 reader 使用自己已有的 default |

這些規則來自 [Avro 1.12.0：Schema Resolution](https://avro.apache.org/docs/1.12.0/specification/#schema-resolution)。表格判斷的是解碼方向，還沒判斷補出的數值是否符合業務需要。舊 reader 是否有 default 由已部署版本決定，不能事後在新 writer 加個 default，就修好舊程式。

Avro 的欄位 default 用於讀取 writer 沒有該欄位的舊資料；它不讓 writer 在編碼時任意省略自己 schema 中的欄位，也不代表「有欄位但值為 null」或「空字串」應被替換。`locale` 未曾記錄時用 `und` 表示未知，是本例設計；若填 `zh-TW`，則是在補造歷史沒有提供的事實。參考 [Avro 1.12.0：Records](https://avro.apache.org/docs/1.12.0/specification/#records)。

## 可解碼不等於意思相同

假設 v1 的 `size_bytes: 4096` 在 v2 仍是整數欄位，producer 卻把值改成 KiB。舊搜尋可能顯示 4 bytes，新統計也可能把舊 4096 當成 4096 KiB。結構檢查全過，兩邊仍都理解錯誤。

本例採用新欄位 `size_kib`，明示計算與取整規則；過渡期間保留 `size_bytes`，直到所有即時 consumer 與允許的歷史重播 reader 都完成遷移。若事件成立條件改成「檔案尚未保存，只完成排程」，更應另定事件類型，不應延用 `ExportCompleted` 掩蓋事實變化。這是語意設計推論，不是 Avro 自動提供的檢查。

一次具體升級可依序追蹤：

1. v1 `evt-90` 已存在歷史中，搜尋仍須能正確解碼。
2. v2 producer 新增帶 default 的 `locale`；先確認所有在用 reader 對額外欄位的實際規則，不把 Avro 規則外推到任意 JSON 驗證器。
3. 新通知程式接受 v1 與 v2；未知語系走明訂的預設通知策略，不把未知當成使用者同意。
4. 淘汰舊欄位前盤點即時訂閱、離線工作與重播需求；只看最近一天的流量不能證明半年後不會有人讀舊資料。

相容性樣本應包含缺欄位、明確 null、未知 enum、邊界數值及舊版事件，而非只有新 producer 配新 consumer 的正常樣本。本文提供檢查方向，未宣稱這些樣本已執行。

## 發布新版本前，列清能保留多久的讀取承諾

欄位增加之外，允許值增加也需要檢查。假設 Avro enum 原本只有 `TEXT`、`PDF`，新 producer 加入 `HTML`；舊 reader 收到這個新 symbol 時，只有其 enum 定義已有合法 default 才能回退，否則 resolution 失敗。因此「沒有刪欄位，只多支援一種格式」也可能破壞舊 consumer。若回退值是 `UNKNOWN`，應先確認消費者真的能處理未知，而非解碼後又在業務分支拋錯。參考 [Avro 1.12.0：Enums 與 Schema Resolution](https://avro.apache.org/docs/1.12.0/specification/#schema-resolution)。

版本識別應可回到確定的定義。本例可用受控文件索引把 `academy.export.completed.v1` 與 `schema_version: 1` 對應到成立條件、單位及 schema；定義變了就留新版本，不能覆寫舊定義讓歷史失去解釋。CloudEvents 另提供可選的 `dataschema` URI，不相容結構變更應使用不同 URI；它提供識別線索，不會替每個 consumer 下載、驗證或升級程式。參考 [CloudEvents 1.0.2：dataschema](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#dataschema)。

實際停止支援 v1 前，應知道哪些訂閱仍讀 v1、DLQ 是否留有 v1、歷史重建是否仍需要 v1，以及 consumer 的部署回滾是否會回到只懂 v1 的程式。若事件保存一年，producer 停發 v1 一週不代表可以移除 v1 reader；若只願支援有限重播期間，需在契約直接寫清期限與過期後的補救來源。相容窗口也包含停機追趕，不只正常即時流量。

## 契約文件要保留應用視角

AsyncAPI 3.0.0 可以描述 application 的 operations、channels 與 messages；`send` 表示被描述應用發送，`receive` 表示它接收。本例匯出服務發送完成事件，通知服務則接收；不能直接複製對方文件，再把所有操作機械反轉。規格文件能記錄封套、payload 與傳輸 binding，卻不自行部署權限或強制每個 consumer 驗證。它的規格版號也不等於 `data.schema_version`。參考 [AsyncAPI 3.0.0：Operation Object、Message Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0)。

## 契約也包含不該散播的資料

通知需要寄信，不表示完成事件就應放電子郵件、全文、權杖或長效下載連結。每個新增訂閱、DLQ、追蹤記錄及歷史備份都可能增加副本；之後刪除 payload 欄位，也不會自動刪掉先前保留的副本。CloudEvents 的安全章節提醒脈絡屬性也可能被記錄或檢視，因此敏感資料不應隨意放進來源、subject 或擴充屬性。參考 [CloudEvents 1.0.2：Privacy and Security](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#privacy-and-security)。

本例保留 `job_id` 與 `result_id`，由具權限的 consumer 按用途查取必要資料；查詢失敗、資料已刪除與權限撤銷都要有明確處理。查取當下狀態也不等於恢復事件發生時的內容，通知若需要當時版本，必須另有受控保存契約。資料最小化降低暴露，但仍需和歷史重建的需求一起取捨。

下一篇把這份契約交給三個獨立下游，檢查[訂閱拓樸、路由與隔離](subscriptions-routing-and-isolation.md)：誰能收到事件、能讀哪些資料，以及一個消費者卡住會影響誰。

## 相關文件

- [訊息佇列與事件驅動架構知識索引](README.md)：回到閱讀主線。
- [命令、工作與事件](commands-jobs-and-events.md)：意圖、工作與事件身分的原始案例。
- [Webhook、事件回呼與反向通知契約](../api/webhooks-and-event-callbacks.md)：對外契約與驗證邊界。
