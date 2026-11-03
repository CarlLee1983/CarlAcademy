# GraphQL 的型別與執行模型

GraphQL 讓提供者描述可供查詢的型別與欄位，讓使用者在這個範圍內選擇需要的資料。
要理解它，須分開看 schema 提供哪些能力、一次操作選取什麼，以及執行後如何呈現資料與錯誤。
它不是一種資料庫，也不能只理解成「一個 HTTP 端點回傳 JSON」。

本文接續[〈介面、契約與責任〉](interface-contract-responsibility.md)與
[〈輸入、輸出與失敗語意〉](input-output-failure-semantics.md)，不要求特定語言或框架。

查證日期：2026-11-02。語言與執行規則採固定的 **GraphQL October 2021 Edition**，不宣稱此版為最新版。
HTTP 部分採查證當日的官方指南；它對應的 GraphQL over HTTP 規範仍是草案，並非定稿。
本文只查閱文件；自創 SDL、操作與 JSON 範例未由 GraphQL 工具驗證或執行，未實測服務。

## schema 描述可用的資料與操作

GraphQL schema 定義型別，以及從根操作型別可以進入的欄位。
**物件型別（object type）**由欄位構成；**純量（scalar）**是沒有子欄位的值，例如 `String`、`Boolean` 與 `ID`。
參數與變數使用輸入型別；複合輸入可用 `input` 宣告的 Input Object，不能直接拿輸出物件型別代替。
Scalar 與 Enum 可同時用於輸入及輸出；本篇不展開所有型別種類。
參考 [October 2021：Type System](https://spec.graphql.org/October2021/#sec-Type-System)與
[Input and Output Types](https://spec.graphql.org/October2021/#sec-Input-and-Output-Types)。

以下是**本站自創的最小文章查詢 schema**，以 SDL（Schema Definition Language）表示。
它與 HTTP 篇的文章服務是分開的教學介面，不表示已經建置 GraphQL 版本：

```graphql
schema {
  query: Query
}

type Query {
  article(id: ID!): Article
}

type Article {
  id: ID!
  title: String!
}
```

`Query.article` 接受名為 `id` 的參數，輸出 `Article` 或 `null`。
本例另外約定：查無文章時回傳 `null`，找到時回傳該編號文章；讀取不修改文章。
「null 表示查無文章」是本例的業務規則，不能只從 `Article` 型別推導。
`ID` 用於識別，不是用來計算的整數；輸出會序列化為字串，例如 `"42"`。
參考 [ID](https://spec.graphql.org/October2021/#sec-ID)。

schema 能確認欄位與型別是否允許這種用法，不能自動回答文章目前是否存在、呼叫者能否讀取，
或標題是否符合產品的內容政策。業務規則與存取控制仍須由提供者實現並說明。

## null 與清單要逐層閱讀

GraphQL 型別預設允許 `null`，後綴 `!` 表示 Non-Null。
本例 `article` 可以是 `null`；若取得一個 Article，其 `id`、`title` 就不能以 `null` 作為正常結果。
`String!` 仍可能是空字串，不能把 Non-Null 解讀成「非空白文字」。

List 與 Non-Null 可以組合；以下以回傳值為例，`T` 代表某個型別：

| 型別 | 整份清單可為 null | 元素可為 null |
| --- | --- | --- |
| `[T]` | 可以 | 可以 |
| `[T!]` | 可以 | 不可以 |
| `[T]!` | 不可以 | 可以 |
| `[T!]!` | 不可以 | 不可以 |

這四種寫法都沒有禁止空清單 `[]`。是否至少要有一個元素，仍是另外的限制。
參考 [Non-Null](https://spec.graphql.org/October2021/#sec-Non-Null)與
[Combining List and Non-Null](https://spec.graphql.org/October2021/#sec-Combining-List-and-Non-Null)。

「輸出不可為 null」也不代表呼叫端每次都必須選取這個欄位。
而在本例輸入端，`id: ID!` 沒有預設值，所以不能省略，也不能提供 `null`。
缺值與空值的處理須依所在位置及預設值規則判斷，不宜只背一個「必填」口訣。

## 選取決定資料形狀，變數承載輸入值

以下操作選取文章的編號與標題：

```graphql
query ReadArticle($id: ID!) {
  article(id: $id) {
    id
    title
  }
}
```

操作名稱是 `ReadArticle`；`$id` 是操作宣告的變數，`article(id: $id)` 將它傳給欄位參數。
變數值可分開提供，例如以下 JSON；這裡展示資料值，尚未指定 HTTP 訊息如何包裝：

```json
{"id":"42"}
```

假設文章存在，成功結果的 JSON 表示可以是：

```json
{"data":{"article":{"id":"42","title":"HTTP basics"}}}
```

`data.article` 對應選取的 `article`，裡面的 `id`、`title` 對應其子選取。
若這次只選 `title`，就不會因 schema 也有 `id` 而自動將它加入該物件結果。
這是選擇公開欄位，不是允許任意查詢內部資料庫；未知欄位會使操作無法通過驗證。
參考 [Selection Sets](https://spec.graphql.org/October2021/#sec-Selection-Sets)、
[Variables](https://spec.graphql.org/October2021/#sec-Language.Variables)與
[Field Selections](https://spec.graphql.org/October2021/#sec-Field-Selections)。

選取資料可以減少回傳不需要的欄位，但不保證整體一定更快。
成本還取決於欄位解析如何取得資料、呼叫多少下游系統，以及實際選取的深度與數量。
本例沒有提供解析函式（resolver）或儲存層，也沒有量測效能。

## query、mutation 與 subscription 如何執行

**query** 從查詢根型別開始執行選取。欄位解析負責取得欄位值，然後依型別完成結果。
一般欄位可以用執行器選擇的順序處理，也可以平行處理；不能依查詢文字順序安排有副作用的工作。
規格要求頂層 mutation 欄位以外的欄位解析沒有副作用且冪等。
參考 [Query](https://spec.graphql.org/October2021/#sec-Query)與
[Normal and Serial Execution](https://spec.graphql.org/October2021/#sec-Normal-and-Serial-Execution)。

**mutation** 用來表達可能修改狀態的操作；同一次 mutation 的**頂層欄位**依序執行。
這不代表所有巢狀欄位都依序，也不代表不同請求會排成一條全域佇列。
尤其依序執行不是資料庫交易保證：第二項工作失敗，不能據此推定第一項修改會全部回復。
若需要原子性、回復或重試保證，必須另訂業務契約。
參考 [Mutation](https://spec.graphql.org/October2021/#sec-Mutation)與
[Normal and Serial Execution](https://spec.graphql.org/October2021/#sec-Normal-and-Serial-Execution)。

**subscription** 先建立來源事件流（Source Stream），再將每個來源事件對應成一次選取執行的結果，
形成回應事件流（Response Stream）。建立訂閱可能失敗；成功建立也不等於必定先回傳完整資料快照。
規格不指定特定傳輸、序列化或訊息重送品質，因此 subscription 不等於一定使用 WebSocket。
本例 schema 只有 query，沒有宣告 mutation 或 subscription 能力。
參考 [Subscription](https://spec.graphql.org/October2021/#sec-Subscription)。

## data 與 errors 要一起判讀

GraphQL 將開始執行前的 **request error**，與執行欄位時發生的 **field error** 分開處理：

| 情況 | 結果的閱讀方式 |
| --- | --- |
| 語法、驗證或變數值等問題使操作無法開始 | 回應包含 `errors`，不包含 `data` |
| 執行期間某欄位失敗 | 回應包含 `data`，並記錄 `errors`；可能保留其他成功資料，`data` 也可能為 null |
| 執行成功而沒有錯誤 | 回應提供 `data`，不加入空的 `errors` 清單 |

例如本例若選取不存在的 `summary` 欄位，是執行前的驗證問題；
若 `title` 解析時出錯，則可能在執行期間形成 field error。
因此收到部分資料不表示所有選取都成功，也不能把 `errors` 存在一律理解成完全沒有執行。
參考 [Response Format](https://spec.graphql.org/October2021/#sec-Response-Format)與
[Errors](https://spec.graphql.org/October2021/#sec-Errors)。

若失敗欄位是 Non-Null，不能只把該欄位填成 null；錯誤會往上傳播到可為 null 的位置。
本例 `title: String!` 失敗，會使該 `article` 成為 null；`errors` 仍記錄錯誤。
若一路沒有可容納 null 的父層，整份 `data` 可能成為 null。
這是回應資料的處理規則，不能解讀成先前副作用已經回復。
參考 [Handling Field Errors](https://spec.graphql.org/October2021/#sec-Handling-Field-Errors)。

## HTTP 是另外一層對應

GraphQL 描述語言、型別與執行規則，不指定服務使用哪種程式語言、儲存方式或網路傳輸。
官方 HTTP 指南說明 HTTP 是常見承載方式，但其建議對應的 **GraphQL over HTTP 規範仍是草案**。
不能把 HTTP 方法、媒體類型或狀態碼的對應直接當作 October 2021 語言規格的一部分。
參考[規格導言](https://spec.graphql.org/October2021/#sec-Introduction)與
[官方 Serving over HTTP 指南](https://graphql.org/learn/serving-over-http/)。

HTTP 200 不足以證明 GraphQL 沒有錯誤；包含資料與欄位錯誤的結果仍可能使用成功的 HTTP 狀態碼。
用戶端要分別判讀 HTTP 層結果與 GraphQL 的 `data`、`errors`，並確認所用媒體類型及服務採用的對應規則。
參考[官方指南：Status Codes](https://graphql.org/learn/serving-over-http/#status-codes)。

## 相關文件

- [輸入、輸出與失敗語意](input-output-failure-semantics.md)：區分資料限制、結果意義與副作用。
- [HTTP API 契約與 OpenAPI](http-api-contracts-and-openapi.md)：對照 HTTP 介面描述的範圍。
- [API 共通知識索引](README.md)：查看共通概念與其他技術分支。
