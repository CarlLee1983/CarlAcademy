# API Gateway 與後端整合

Amazon API Gateway 是管理 API 入口的 AWS 託管服務：接收用戶端呼叫，依 API 設定選擇後端整合，再把結果回給用戶端。後端可以是 Lambda、HTTP 服務或支援的 AWS 服務操作；API Gateway 不會因為建立了一條路由，就替你寫出文章查詢、付款或資料權限等應用邏輯。見 [API Gateway 導論](https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html)。

本文聚焦 API Gateway 的產品種類、路由、部署與整合邊界。HTTP 語意、REST 架構約束與介面契約集中在 [API 共通知識](../api/README.md)，此處補充 AWS 產品規則。

查證日期：2026-11-02。僅查閱 AWS 官方文件；未登入 AWS、建立資源、部署服務、執行 CLI／SDK，亦未進行 HTTP 或 API 實測。文中的文章查詢是自訂概念情境，JSON 是格式示意，不是可部署設定；不列費率或固定配額。

## API 入口與後端實作各負責什麼

可以先把請求經過的邊界看成：

```text
用戶端 → API Gateway 的入口與路由 → Integration → 後端能力
用戶端 ← 對外 API 回應             ← 整合結果    ← 處理結果
```

API Gateway 的 integration 是「入口如何連到後端」的設定。例如把某個 route 連到 Lambda，或將請求送往已有的 HTTP 服務。處理業務規則的程式仍在後端；直接整合 AWS 服務時，則是讓特定服務 API 承接該操作，不一定需要中間再放一個函式。見 [HTTP API integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations.html)與 [AWS service integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-aws-services.html)。

因此要分別設計對外契約與後端介面。公開的 `GET /articles/{id}` 不必與後端函式名稱、資料表名稱相同；但路徑參數如何傳入、成功與失敗如何對外表達，必須能在整合前後對得起來。契約的共通背景見 [HTTP API 契約與 OpenAPI](../api/http-api-contracts-and-openapi.md)。

## HTTP API、REST API 與 WebSocket API

**HTTP API 與 REST API 在此是 API Gateway 的兩種產品名稱。**兩者都能提供以 HTTP 呼叫的介面，不能把「使用 HTTP API」理解為不准採用 REST 設計，也不能把「選了 REST API」當作已符合 REST 所有架構約束。AWS 自身也把兩者並列為 RESTful API products；產品差異應以功能需求判斷。見 [HTTP APIs 與 REST APIs 比較](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)；架構風格另讀 [REST 的架構約束](../api/rest-architectural-constraints.md)。

| 產品 | 先理解的用途與模型 |
| --- | --- |
| HTTP API | 以路由連接 Lambda、HTTP 與支援的 AWS 服務，提供較精簡的 API 管理模型 |
| REST API | 同樣能提供 HTTP 請求／回應介面，另有較完整的 API 管理功能，例如 usage plan、API keys 與 request validation |
| WebSocket API | 維持雙向連線，依訊息內容選擇路由；後端也能對已連線用戶端發送訊息 |

前兩項差異見 [官方比較表](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)；第三項見 [WebSocket APIs 概觀](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-overview.html)。WebSocket 的訊息路由與 `$connect`、`$disconnect` 等生命週期路由，不應直接套用下文 HTTP method 加 path 的模型。

本文以 HTTP API 為主線；REST API 的不同處會明確標示。需要某項功能時，應先核對所選 API type 的官方文件，而不是把所有 API Gateway 教學中的設定拼在一起。

## Route、method、path、stage 與 deployment

在 HTTP API 中，route 通常由 **HTTP method 與 resource path** 組成，例如 `GET /articles/{id}`。請求 `GET /articles/42` 的 `id` 是 `42`；`POST /articles/42` 則是另一個 method，不能只因 path 相同就當作同一個 route。HTTP API 也有 `ANY` 與 `$default` route：前者處理未另行指定的方法，後者承接未匹配其他 route 的請求；它們都不是文章查詢必須使用的設定。見 [HTTP API routes 與匹配順序](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-routes.html)。

REST API 的設定則以 resource 與其 method 組織，再為 method 設定整合；不能直接把 HTTP API 的 route 設定欄位搬過去。兩種產品的整合模型入口分別見 [HTTP API integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations.html)與 [REST API integration types](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-integration-types.html)。

HTTP API 的 deployment 是 API 設定的快照，stage 則是指向 deployment 的具名參照，可用 `dev`、`prod` 等名稱表示生命週期中的入口。HTTP API 可以啟用自動部署，讓設定變更自動發布；不能因此推論所有 API Gateway 產品都會自動發布。見 [HTTP API stages](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-stages.html)。REST API 的 API 定義變更通常須重新部署到 stage；stage settings 的變更則另有規則，見 [Deploy REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-deploy-api.html)。

以預設網域的 HTTP API 為例，具名 stage 的入口可包含 `/prod`；`$default` stage 則可直接從 API 基底 URL 呼叫。**`$default` stage 與 `$default` route 是不同概念**：前者決定部署入口，後者決定未匹配的請求由哪個 route 處理。自訂網域的 mapping 又會影響外部網址，不能只看網址有沒有 `/prod` 判定部署情況。見 [HTTP API stages](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-stages.html)與 [route selection](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-routes.html)。

Stage 也不是完整隔離環境的保證。若 `dev` 與 `prod` 最終指向同一個後端或資料來源，只是取了不同名稱，並不會自動隔離測試資料；這是依 stage 與 integration 的角色推導的設計提醒。

## 四種常見整合方向

以下按「連到哪裡、如何交付資料」比較，不是四個互斥的 AWS 設定值；例如 private integration 可以採 HTTP proxy 模型。

| 方向 | HTTP API 的含義 | REST API 閱讀時須分開確認的地方 |
| --- | --- | --- |
| Lambda proxy | 把 HTTP 請求整理成事件呼叫 Lambda，再解讀函式回應；有 payload format 版本 | 有 Lambda proxy 與 custom integration，輸入輸出及 mapping 規則另有定義 |
| HTTP 後端 | 以 HTTP proxy integration 接上 HTTP endpoint | 可選 HTTP proxy 或 HTTP custom integration；custom 需要設定請求／回應映射 |
| AWS 服務 | 以 first-class integration 呼叫支援的服務操作，例如送訊息到 SQS | 使用 AWS integration 的設定模型，不能套用 HTTP API 的 integration subtype 配置 |
| VPC 內的私有後端 | 透過 VPC link 連到支援的私有整合目標 | VPC link 與目標支援須查該產品及版本的文件，不照搬 HTTP API 設定 |

Lambda 與 HTTP 的差異見 [HTTP API HTTP proxy](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-http.html)、[HTTP API Lambda proxy](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)及 [REST API integration types](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-integration-types.html)；服務操作見 [HTTP API AWS service integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-aws-services.html)。不同產品即使出現同名 integration type，也不能據此推定支援範圍相同。

HTTP API 的私有整合可透過 VPC link 連接 Application Load Balancer、Network Load Balancer，或 AWS Cloud Map 發現的資源，仍須滿足帳戶、網路及目標設定條件。這裡的 **private 指 API Gateway 到後端這一段**；它不代表用戶端呼叫的 API 入口也變成只能從 VPC 存取。見 [HTTP API private integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-private.html)。

「API 入口是 private endpoint」與「整合私有後端」是兩個不同問題，前者應另查 API endpoint type；目前官方比較也把它們分列在 endpoint 與 integration 欄位。見 [API 類型比較](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)。本文不把某個私有整合範例當作所有 API 類型通用的網路方案。

## 假想範例：取得一篇文章

假設選擇 **HTTP API、`$default` stage、Lambda proxy integration，payload format 為 `2.0`**，並已有 `GET /articles/{id}` route。這裡的 Lambda 指 **Event Function**：原有透過 Invoke／handler 處理事件的模型。查證時 Lambda 官方另列 Web Functions 與 MicroVMs；以下事件格式不能直接當成 Web Function 收到的原生 HTTP request。見 [Lambda 運算模型](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)。

成功路徑可分成五步；這只是說明資料邊界，不表示所有安全檢查的內部執行順序：

1. 用戶端向已發布的入口送出 `GET /articles/42`。
2. API Gateway 選定 stage，再匹配 `GET /articles/{id}` route；需要的入口存取檢查也必須通過。
3. Lambda proxy integration 將請求轉為 `2.0` 事件，把 `id` 傳入函式。
4. 後端程式驗證文章 ID，執行文章可讀性規則並取得資料。
5. 函式回傳符合整合格式的結果；API Gateway 將其解讀成 HTTP 回應交給用戶端。

Route 規則見 [HTTP API routes](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-routes.html)，proxy 資料交換見 [HTTP API Lambda proxy 格式](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)；文章 ID、可讀性與查詢規則是本例自訂的應用責任。

下面是事件中與此例相關的**欄位摘錄**：JSON 完整可解析，但刻意省略其他 context 與 headers，不能當作完整 AWS 事件 schema 或部署輸入。

```json
{
  "version": "2.0",
  "routeKey": "GET /articles/{id}",
  "rawPath": "/articles/42",
  "rawQueryString": "",
  "pathParameters": {
    "id": "42"
  },
  "requestContext": {
    "http": {
      "method": "GET",
      "path": "/articles/42"
    },
    "stage": "$default"
  },
  "isBase64Encoded": false
}
```

同一個 `2.0` 整合中，函式可以明確回傳以下 envelope。`body` 是字串，其中包含序列化後的文章 JSON；整個 envelope 是函式交給整合層的資料，不是用戶端最終收到的文章物件。

```json
{
  "statusCode": 200,
  "headers": {
    "content-type": "application/json"
  },
  "body": "{\"id\":\"42\",\"title\":\"API Gateway 入門\"}",
  "isBase64Encoded": false
}
```

用戶端可看到 HTTP 狀態 `200`、JSON 媒體類型，以及解碼後的文章內容。`2.0` 也有省略 `statusCode` 時推導回應格式的規則；此例刻意明寫，以便看清楚整合契約。HTTP API 還支援 `1.0` payload，但其欄位與重複標頭／查詢參數處理方式不同；REST API 的 Lambda proxy 也須查自己對應的事件規則。以上 payload 與回應行為見 [官方格式文件](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)。

## 驗證、授權與 API key

入口收到請求後，還要回答「呼叫者的身分或憑證是否可信」以及「是否允許這個操作」。兩者的共通區別見 [API 的身分驗證與授權](../api/authentication-and-authorization.md)；API Gateway 的機制則依產品而異。

- **IAM authorization**：HTTP API route 啟用 IAM 授權時，用戶端須以 AWS 憑證採 SigV4 簽署請求，並具備對應的 `execute-api` 權限。這不是只把任意 token 放進標頭。見 [HTTP API IAM authorization](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html)。
- **JWT authorizer**：HTTP API 可驗證 token 的簽章與 issuer、audience、時間等 claims，並可為 route 要求 scope。驗證通過後可把 claims 傳給 integration；這不會自動替應用判斷「這位使用者能否讀取文章 42」。見 [HTTP API JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)。
- **Lambda authorizer**：以另一段函式邏輯判斷存取，API Gateway 依其結果決定是否放行；authorizer 與實際處理文章查詢的 backend function 角色不同。若啟用快取，identity sources 與授權結果涵蓋的 routes 必須一致，不能假設每次請求都會重新呼叫 authorizer。見 [HTTP API Lambda authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html)。

REST API 有自己的 IAM、Lambda authorizer 與 Cognito user pool 整合；HTTP API 的原生 JWT authorizer 不是可直接貼到 REST API 的同一項配置。這是產品機制差異，不代表 REST API 後端不能使用 JWT。見 [授權功能比較](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)。

REST API 的 API keys 與 usage plans 用來識別用戶端及管理使用量。**AWS 明確提醒不要以 API keys 作為身分驗證或授權機制**；應另外採用適合的 IAM、authorizer 或 Cognito 等存取控制。Usage plan 也不能替代文章層級的業務授權。見 [Usage plans 與 API keys](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html)。

呼叫者可否進入 API、API Gateway 可否呼叫後端、後端可否讀取資料，是不同權限邊界；端到端的兩道服務權限與失敗位置接續 [API 入口與程式執行](api-entry-and-program-execution.md)，IAM 政策模型見 [IAM 的身分與權限](iam-identities-and-permissions.md)。

## CORS 處理的是瀏覽器跨來源存取

CORS 配合瀏覽器對跨來源腳本請求的規則運作，讓前端能依回應中的允許條件存取跨來源資源。它不是使用者登入，也不能阻止非瀏覽器用戶端直接呼叫 API；開啟 CORS 不等於 API 已具備任意安全保證。見 [HTTP API CORS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html)。

設定時尤其要分清產品：

| 情境 | 回應由誰處理 |
| --- | --- |
| HTTP API 已配置 API 層 CORS | API Gateway 可自動回應 preflight `OPTIONS` 並加入配置的 CORS headers；會忽略後端回傳的 CORS headers |
| REST API 的 Lambda／HTTP proxy integration | 後端須負責回傳相應 CORS headers；不能直接套用上一列的行為 |

分別見 [HTTP API CORS 配置](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html)與 [REST API proxy CORS](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html)。若 HTTP API 的 `$default` route 同時設定 authorizer，preflight 還有特別的路由考量；瀏覽器錯誤須檢查實際 CORS 回應，不能只確認後端主請求成功。

## 節流與觀察仍有邊界

API Gateway 的 throttling 以速率及 burst 控制為核心，HTTP API 可在 stage／route 設定目標；超量時可能收到 `429 Too Many Requests`。AWS 明確說明這是 best-effort 的目標，不是保證不會超出的請求天花板。因此，不能只設定入口節流，就承諾 Lambda、資料庫或第三方服務永遠不會過載。見 [HTTP API throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html)。REST API usage plan 的節流與 quota 也不是硬上限，見 [Usage plan 限制](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html)。

依此推導，流量設計仍須對照後端容量、每次請求的下游呼叫數及處理時間；需要重試時也須避免讓所有用戶端同時重送。共通原理見 [逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)，不是由 Gateway 的節流設定自動完成。

HTTP API 可為 stage 啟用送往 CloudWatch Logs 的 access logs，並選擇 request ID、route、狀態等記錄欄位。這是需要配置的觀察能力，不能因服務是託管的就假定已留有所有請求內容。見 [HTTP API logging](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)。

Access logs 與 execution logs 也不同：官方產品比較區分兩者，HTTP API 與 REST API 的支援不完全相同。分析時要把入口紀錄與後端程式紀錄對照，並自行安排關聯資訊；僅看到 Gateway 回應狀態，仍不足以證明文章查詢結果符合契約。產品支援見 [Monitoring 比較](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)，觀察服務的分工見 [CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)。

## 相關文件

- [AWS 知識索引](README.md)：回查服務分組與背景。
- [EC2 與 Lambda](ec2-and-lambda.md)：比較後端程式的執行與管理模型。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：理解 AWS 身分、角色與政策。
- [API 入口與程式執行](api-entry-and-program-execution.md)：以跨服務情境追蹤權限及失敗邊界。
- [CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)：區分執行觀察與 AWS 活動追查。
- [HTTP API 契約與 OpenAPI](../api/http-api-contracts-and-openapi.md)：檢查公開介面與整合前後的契約一致性。
