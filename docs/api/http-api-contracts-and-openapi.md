# HTTP API 契約與 OpenAPI

知道服務接受 `GET /articles/42`，還需要知道路徑中的值代表什麼、成功會回傳哪些資料，
以及找不到文章時如何回應。OpenAPI 把這些 HTTP 介面資訊整理成工具可以讀取的描述。
它讓文件、呼叫工具與其他衍生產物有共同的輸入，但仍需要作者記錄行為的意義。

本文接續[〈文件與契約描述〉](documentation-and-contract-description.md)，
先備概念是[資源、表示與訊息](resources-representations-and-messages.md)及
[方法與操作語意](methods-and-operation-semantics.md)。不要求特定框架或程式語言。

查證日期：2026-11-02。依據 OpenAPI Specification 3.2.1（2026-09-10）與 JSON Schema Draft 2020-12。
本文只查閱文件；自創 YAML 與 JSON 範例未經 OpenAPI 驗證器驗證，未部署服務或發送請求。

## 描述 HTTP 介面，不是指定實作框架

OpenAPI Specification（OAS）是與程式語言無關的 **HTTP API 介面描述規範**。
描述文件可用 JSON 或 YAML 編寫；它不是所有 API 的共同格式，也不要求某種框架或資料庫。
參考 [OAS 3.2.1：範圍](https://spec.openapis.org/oas/v3.2.1.html#what-is-the-openapi-specification)與
[格式](https://spec.openapis.org/oas/v3.2.1.html#format)。

可以從操作往內閱讀一份文件：

| 位置 | 回答的問題 |
| --- | --- |
| `paths` 與各路徑下的 `get`、`post` 等操作 | 哪個 HTTP 方法可以作用在哪個路徑？ |
| `parameters` | 路徑、查詢或標頭等位置有哪些輸入？ |
| `requestBody` | 若操作接受請求內容，支援哪些媒體類型與資料結構？ |
| `responses` | 各種預期狀態碼對應什麼回應與內容？ |
| `components` | 哪些描述被集中定義，供其他位置引用？ |

同一路徑下，GET 與 POST 是不同操作，可以有不同輸入與結果。
不要把 `paths` 的一個項目直接當成完整操作，也不要把 `components` 中定義的型別當成新端點。
參考 [Paths Object](https://spec.openapis.org/oas/v3.2.1.html#paths-object)與
[Operation Object](https://spec.openapis.org/oas/v3.2.1.html#operation-object)。

## 一份小型文章讀取契約

以下沿用文章資源，**另訂一個只展示 JSON 表示的唯讀教學介面**；
不宣告前篇的純文字服務已經增加這個功能，也與記憶體清單標題例子無關。
本例約定：找到文章時回傳編號與標題；沒有對應文章時回傳 404，該回應沒有內容。
讀取不要求修改文章。這份小文件完整展示一個操作，並非真實服務的完整產品規格。

```yaml
openapi: 3.2.1
info:
  title: 文章讀取教學介面
  version: '1.0.0'
paths:
  /articles/{articleId}:
    get:
      summary: 讀取指定文章
      description: 取得指定編號文章的 JSON 表示，不修改文章。
      parameters:
        - name: articleId
          in: path
          required: true
          description: 要讀取的文章編號，以字串表示。
          schema:
            type: string
      responses:
        '200':
          description: 找到文章，回傳其編號與標題。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Article'
        '404':
          description: 沒有對應編號的文章；本例不回傳內容。
components:
  schemas:
    Article:
      type: object
      required: [articleId, title]
      properties:
        articleId:
          type: string
          description: 這篇文章的編號，等於本次路徑中的 articleId。
        title:
          type: string
          description: 這篇文章的標題。
```

假設讀取 `/articles/42` 且文章存在，200 的 JSON 內容可以是：

```json
{"articleId":"42","title":"HTTP basics"}
```

`articleId` 在本例是字串，JSON 因而寫成 `"42"`，不是數字 `42`。
schema 要求兩個欄位存在且為字串，卻不會只因欄位同名就自動檢查回傳編號是否等於路徑值。
這項關係已寫在描述中，實作仍須履行。範例也沒有宣告只能出現這兩個欄位，不能自行推定拒絕其他欄位。

## 參數的位置與必填規則

`parameters` 的 `in` 指出資料位置：`path` 對應路徑模板，`query` 對應查詢參數，
`header` 對應請求標頭；規範還支援其他位置，這裡不逐項展開。
例如 `articleId` 對應 `{articleId}`，兩者名稱必須一致。
path 參數必須明寫 `required: true`；其他參數的 `required` 預設為 `false`。
參考 [Parameter Object](https://spec.openapis.org/oas/v3.2.1.html#parameter-object)。

「參數必須提供」不等於「值符合所有限制」。若需要限制空字串、格式或範圍，須另外描述。
集合或物件參數還需要確認序列化規則，不能只看到 schema 就自行決定如何放進 URL。
`Accept`、`Content-Type` 與 `Authorization` 不能當作一般 `in: header` 參數定義；OAS 會忽略這些定義。
媒體類型應讀相應的 `content`，認證則使用規範的安全描述機制；本文不展開認證設定。
參考 [Parameter Object：固定欄位](https://spec.openapis.org/oas/v3.2.1.html#parameter-object)。

## 請求內容、欄位存在與 null 是不同層次

本例 GET 不使用請求內容，所以沒有 `requestBody`。
對有請求內容的操作，`requestBody.content` 以 `application/json` 等媒體類型為鍵，
各自搭配 schema；`requestBody.required: true` 才要求整份請求內容存在，預設是 `false`。
參考 [Request Body Object](https://spec.openapis.org/oas/v3.2.1.html#request-body-object)。

資料物件裡的 `required: [title]` 則要求 `title` 屬性存在，與整份內容是否必填是兩件事。
第三個問題是值可否為 `null`：在 OAS 3.1 之後採用的 JSON Schema 寫法中，
例如 `type: [string, 'null']` 可接受字串或空值；本篇採 3.2.1，不沿用 3.0 的 `nullable: true` 寫法。
此處 `'null'` 加引號，表示型別名稱，避免 YAML 將它讀成空值。

因此，欄位可以是「必須存在但允許 null」，也可以是「可以省略，但出現時只能是字串」。
本例 `Article` 的兩個欄位必須存在，而且 `type: string` 不接受 `null`；空字串則沒有另外禁止。
參考 [JSON Schema 2020-12：type](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.1.1)與
[required](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.5.3)。

## 回應與重用描述

`responses` 先按狀態碼區分回應，再於各回應的 `content` 按媒體類型描述內容。
YAML 中的 `'200'`、`'404'` 使用字串鍵；不能只定義一個成功物件，就推定所有錯誤也採相同格式。
本例 404 沒有 `content`，並以文字明訂沒有內容；若產品要回傳錯誤資料，應再記錄其媒體類型與結構。
參考 [Responses Object](https://spec.openapis.org/oas/v3.2.1.html#responses-object)與
[Response Object](https://spec.openapis.org/oas/v3.2.1.html#response-object)。

`$ref: '#/components/schemas/Article'` 引用同一份文件內的共用 schema。
`components` 也能集中參數或回應；只有定義卻沒有被引用，不會自行對操作生效。
這能減少同一限制在不同位置重複維護，但不能證明所有使用情境都應共用同一份描述。
參考 [Components Object](https://spec.openapis.org/oas/v3.2.1.html#components-object)。

## 版本、工具與符合契約是三個問題

`openapi: 3.2.1` 指使用哪版規範；`info.version` 是 OpenAPI 文件版本，與規範版本及被描述的 API 版本有別。
專案需另外交代這份文件對應哪個 API 版本，不能只憑 `info.version` 推定部署狀態或相容性政策。
參考 [OpenAPI Object](https://spec.openapis.org/oas/v3.2.1.html#openapi-object)與
[Info Object](https://spec.openapis.org/oas/v3.2.1.html#info-object)。

3.2.1 的 Schema Object 預設使用以 JSON Schema Draft 2020-12 為基礎的 OAS dialect（方言）。
`jsonSchemaDialect` 與 schema 資源根部的 `$schema` 可以指定適用方言；本文例子使用預設值。
選工具時須確認規範版本與方言支援，不能將任何 JSON Schema 驗證器直接視為完整 OpenAPI 驗證器。
參考 [Schema Object](https://spec.openapis.org/oas/v3.2.1.html#schema-object)與
[Specifying Schema Dialects](https://spec.openapis.org/oas/v3.2.1.html#specifying-schema-dialects)。

一份描述符合規範，只能支持「描述格式與規則成立」；服務是否照著回傳資料，是另一項檢查。
即使某次 200 回應符合 schema，也不代表 404 條件、狀態關係與其他行為都已通過測試。
未寫清楚的錯誤意義、前提與狀態影響，仍要用文字補充；產生文件或程式碼不會自動補齊承諾。
維護方法見[文件與契約描述](documentation-and-contract-description.md)，行為檢查見 [API 測試](api-testing.md)。

## 相關文件

- [資源、表示與訊息](resources-representations-and-messages.md)：區分路徑、內容與媒體類型。
- [方法與操作語意](methods-and-operation-semantics.md)：理解方法本身的操作承諾。
- [API 共通知識索引](README.md)：查看 HTTP 與其他 API 分支。
