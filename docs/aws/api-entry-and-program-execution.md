# API 入口與程式執行

API Gateway 負責接住 API 請求、選擇整合並回傳 HTTP 結果；Lambda 執行後端程式，程式再依自己的權限存取資料。**入口收到請求、函式可被呼叫、資料查詢成功與用戶端收到成功回應，是不同的事。**本篇沿一筆文章查詢，追蹤資料、授權與失敗如何跨越這些邊界。整合模型見 [HTTP API Lambda proxy integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)。

先備概念見 [API Gateway 與後端整合](api-gateway-and-backend-integration.md)及 [EC2 與 Lambda](ec2-and-lambda.md)；本篇不重列產品種類與名詞表。

查證日期：2026-11-02。僅查閱 AWS 官方文件，未登入 AWS、建立 API／函式／資料表、部署或執行 HTTP、CLI、SDK 實測。文中的資源、識別值與資料均為假想，JSON 只說明交換格式，不是部署設定；不列費率或固定配額。

## 固定一條請求路徑

假設文章服務採用 **API Gateway HTTP API、`$default` stage、`GET /articles/{id}` route、Lambda proxy integration，payload format 明確選 `2.0`**。函式與 DynamoDB 資料表放在同一帳戶與 Region；入口採 JWT authorizer，要求自訂的 `articles:read` scope。這些是本例的設計選擇。

本例的 Lambda 僅指 **Event Function**，採原有 Invoke／handler 模型及預設執行環境；不討論 Durable Functions 或 Managed Instances。查證當日官方也提供 Web Functions 與 MicroVMs，因此不能把下文的事件 envelope 當成所有 Lambda 運算選項共同的輸入。見 [Lambda 運算模型](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)。

```text
用戶端：GET /articles/42，攜帶 access token
  → HTTP API：檢查入口授權，匹配 GET /articles/{id}
  → Lambda proxy integration：建立 payload 2.0 事件，同步呼叫
  → Lambda handler：驗證 id、檢查文章可讀性、查 DynamoDB
  ← DynamoDB：回傳文章或沒有 Item 的查詢結果
  ← Lambda：回傳 proxy response envelope
  ← API Gateway：轉為 HTTP status、headers、body
用戶端：取得文章或錯誤回應
```

這是邏輯資料流，並非所有 AWS 內部檢查的時序規格。Route 的匹配規則見 [HTTP API routes](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-routes.html)；API Gateway 對 Event Function 的呼叫為同步，會等待函式結果，見 [Lambda 與 API Gateway 整合](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway.html)。

## 三道授權，回答三個問題

| 邊界 | 本例檢查什麼 | 通過後仍不代表什麼 |
| --- | --- | --- |
| 用戶端 → HTTP API | JWT authorizer 驗證 token 與 route 所需 scope | 不代表此使用者有權閱讀文章 42 |
| API Gateway → Lambda | 函式的 resource-based policy 允許 API Gateway 呼叫對應函式 | 不代表函式能讀 DynamoDB |
| Lambda → DynamoDB | Execution role 的權限允許對指定資料表執行所需操作 | 不代表任意登入使用者都能讀取該表中的任意文章 |

第一道中，HTTP API JWT authorizer 依設定檢查簽章、issuer、audience、時間與 scope 等資訊，並將通過檢查的 claims 傳入 integration。`articles:read` 是本例自訂的權限名稱；後端仍需依可信 claims 與文章資料執行「是否可讀取這筆文章」的業務規則。見 [HTTP API JWT authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)。

第二道採用 **Lambda 函式資源政策**：授予服務 principal `apigateway.amazonaws.com` 所需的 `lambda:InvokeFunction`，並以來源 API／stage／route 對應的 `SourceArn` 等條件限制來源。它是附在 Lambda 資源上的政策，不是「HTTP API 的入口 resource policy」。API Gateway 主控台建立整合時可代為配置呼叫權限；其他建立方式不能假定已具備。見 [HTTP API Lambda 權限排查](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-troubleshooting-lambda.html)及 [Lambda resource-based policies](https://docs.aws.amazon.com/lambda/latest/dg/access-control-resource-based.html)。

第三道採用 **函式 execution role**。其 trust policy 允許 `lambda.amazonaws.com` 承擔角色，角色的權限政策則決定函式程式可做哪些 AWS 操作。本例只需對選定資料表讀取資料，例如 `dynamodb:GetItem`，另具備寫入所需日誌的權限；不是把用戶端的 JWT 當成 AWS 憑證使用。見 [Lambda execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)。

所以，把 DynamoDB 讀取權限加給函式角色，不能修復 Gateway 沒有 Invoke 權限的問題；讓 Gateway 成功 Invoke，也不能修復資料表拒絕存取。跨帳戶還須重新核對雙方政策，本篇的同帳戶例子不能直接作為跨帳戶設定。政策判定背景見 [IAM 的身分與權限](iam-identities-and-permissions.md)。

## HTTP 請求如何成為 event

以下是**自訂請求在 payload `2.0` 中的選取欄位**：JSON 可完整解析，但省略其他 headers 與 context，並非完整 AWS 事件輸出。Token 本身未列出，claims 亦只是本例假想的授權結果。

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
    "requestId": "gateway-request-example-1",
    "stage": "$default",
    "http": {
      "method": "GET",
      "path": "/articles/42"
    },
    "authorizer": {
      "jwt": {
        "claims": {
          "sub": "reader-example-7"
        },
        "scopes": ["articles:read"]
      }
    }
  },
  "isBase64Encoded": false
}
```

`routeKey` 是匹配的規則；`pathParameters.id` 是擷取出的文章識別字串；`rawPath` 是路徑資料，不能當成文章 ID 或請求識別。`requestContext.requestId` 才是 Gateway 為這筆 API 請求提供的識別。若使用自訂網域 API mapping，`2.0` 的 `rawPath` 不包含 mapping 值，不能拿它還原所有外部 URL。這些欄位與版本差異見 [官方 payload 格式](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)。

Handler 取得 `id` 後，仍須驗證格式、將它映射到資料主鍵，並決定該使用者可讀取哪些欄位。這是本例的應用邏輯，不是 route 參數自動提供的資料驗證或文章授權。

假設 DynamoDB 表以字串 `id` 為單一主鍵，程式透過 AWS SDK 呼叫 `GetItem`。該操作依完整主鍵取得 item；沒有符合資料時，結果沒有 `Item`，而不是 DynamoDB 自動產生公開 API 的 `404`。程式必須將結果轉成文章服務的契約；讀取一致性也須依需求選擇，`GetItem` 預設是 eventual consistency。見 [DynamoDB GetItem](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html)。資料模型背景見 [RDS 與 DynamoDB](rds-and-dynamodb.md)。

## 權限與網路是兩個條件

把三個服務放在同一帳戶或 Region，不會自動補上授權，也不代表所有連線設定都相同。本例的 Gateway 透過 Lambda 服務整合同步 Invoke，不是去連 handler 監聽的 TCP port。函式連到自己帳戶的 VPC，是讓程式存取該 VPC 資源的設定，應與 Gateway 可否 Invoke 分開檢查。見 [API Gateway 呼叫模型](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway.html)及 [Lambda VPC 連線](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)。

本例不為讀 DynamoDB 而額外附加客戶 VPC。若改成 VPC-connected Lambda，就必須安排程式到 DynamoDB 的可用路徑，例如合適的 DynamoDB gateway endpoint、路由與 endpoint policy；有 IAM 權限並不能取代網路可達性。反過來，endpoint 可達也不會取代 IAM 授權。Gateway endpoint 的用途與政策見 [DynamoDB gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-ddb.html)。

如果資料改放在 VPC 內的 RDS，還要另外處理子網路、路由、安全群組與資料庫登入等條件；函式附加到 public subnet 也不會因此取得 public IP 或網際網路存取。這是另一條下游連線路徑，不能把本例 DynamoDB 的設定原樣搬過去。見 [Lambda 存取 VPC 資源](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)。

## 函式結果如何變成 HTTP 回應

成功時，本例明確回傳下列 proxy response；這是自訂、有效的完整示例 envelope，並非 AWS 實測輸出。`body` 是已序列化的 JSON **字串**。

```json
{
  "statusCode": 200,
  "headers": {
    "content-type": "application/json",
    "x-request-id": "gateway-request-example-1"
  },
  "body": "{\"id\":\"42\",\"title\":\"API 入口與程式執行\"}",
  "isBase64Encoded": false
}
```

在本例沒有額外回應映射的前提下，用戶端收到 HTTP `200`、上述 headers，以及文章 JSON 內容；不會收到整個 `statusCode`／`body` envelope。`x-request-id` 是本例由程式主動回傳的關聯欄位，不宣稱 Gateway 自動加入。`2.0` 允許從未含 `statusCode` 的有效 JSON 推導回應，但本例刻意明寫狀態，讓應用契約清楚。見 [HTTP API response format](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)。

若文章不存在，本例契約由 handler 正常回傳以下結果；這是程式處理完「找不到文章」，不是拋出未處理例外。

```json
{
  "statusCode": 404,
  "headers": {
    "content-type": "application/json"
  },
  "body": "{\"code\":\"ARTICLE_NOT_FOUND\",\"message\":\"找不到文章\"}",
  "isBase64Encoded": false
}
```

應用可自行決定錯誤表示；函式捕捉錯誤並回傳正確格式，才能將預期的狀態與內容送到用戶端。未處理函式錯誤或格式錯誤是不同路徑，見 [API Gateway 的 Lambda 錯誤處理](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway-errors.html)。

## 哪一層成功，哪一層失敗

**Lambda Invoke API 的 HTTP 狀態、函式回傳的 `statusCode`、用戶端看到的 HTTP 狀態，不能混為同一欄。**同步 Invoke 成功回應的服務狀態可為 `200`，但若帶有 `FunctionError`，表示函式執行發生錯誤，詳細內容在 payload。這是 Lambda 服務 API 的語意，不是說 Gateway 對所有函式失敗都回 HTTP `200`。見 [Lambda Invoke response elements](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html)。

| 觀察到的情況 | 能確認的事 | 接下來看哪個邊界 |
| --- | --- | --- |
| 入口拒絕 token 或 scope | 請求沒有通過入口授權 | JWT authorizer 配置與 token；不能據此說 handler 壞了 |
| Gateway 無法取得 Invoke 權限 | 整合無法正常呼叫目標函式 | 函式 resource-based policy、目標與來源限制 |
| Handler 查資料被拒絕 | 程式已走到下游呼叫，但 AWS 授權失敗 | Execution role 及資料存取政策 |
| Handler 正常回傳 `statusCode: 404` | 應用完成判斷並表達找不到文章 | 對照公開契約與資料狀態 |
| Handler 未處理例外或回應格式錯誤 | 後端無法提供整合可用的正常結果 | 函式日誌、例外及 proxy 格式 |
| 等待逾時，沒有文章回應 | 沒在期限內取得所需結果 | 用戶端、整合、函式及下游各自的時間限制 |

表中是本例的排查分類；不能只憑一個狀態碼就確定根因。官方 Lambda 整合錯誤文件說明，Invoke 被拒絕與函式執行／格式錯誤會由 Gateway 轉成錯誤回應；HTTP API 文件建議記錄 `integrationErrorMessage` 以查明細節。見 [整合錯誤行為](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway-errors.html)及 [HTTP API troubleshooting](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-troubleshooting-lambda.html)。

### Timeout 不等於後端沒有完成

至少要分開看四個等待範圍：用戶端的請求期限、HTTP API integration timeout、Lambda function timeout、程式對 DynamoDB 等下游的呼叫 timeout。整合與函式各有設定；下游延遲也會消耗函式時間。見 [API Gateway integration timeout 設定](https://docs.aws.amazon.com/apigatewayv2/latest/api-reference/apis-apiid-integrations-integrationid.html)及 [Lambda function timeout](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html)。

由此可推導：若 Gateway 或用戶端先停止等待，不能用這個訊號證明函式未執行、已取消或下游變更已回復。Lambda 對同步呼叫也提醒，呼叫端可能在等待期間斷線；重試文件則明示，出錯時程式可能全部、部分或完全沒有執行。見 [Invoke 連線考量](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html)及 [Lambda retry behavior](https://docs.aws.amazon.com/lambda/latest/dg/invocation-retries.html)。即使本例只有讀取，也應先釐清是哪一層停止等待。

### 重試不是背景執行保證

本例為同步 Lambda proxy；官方明示 **API Gateway 不會重試 Lambda invocation，會把錯誤回應交回呼叫者**。不能把 Lambda 非同步事件的重試規則套到這條 GET 路徑。見 [API Gateway 錯誤處理](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway-errors.html)及 [依呼叫來源區分重試](https://docs.aws.amazon.com/lambda/latest/dg/invocation-retries.html)。

用戶端是否重送 GET、SDK 對 DynamoDB 是否重試，以及應用是否自行重試，要分別依各自契約與設定確認。本例的查詢須維持 GET 的安全讀取語意；若未來新增建立文章等操作，還需針對重複請求與結果不確定性設計冪等契約。串接 Gateway、Lambda 與資料庫本身不提供端到端 exactly-once 保證。完整共通原理見 [逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)。

## 用關聯識別找回同一筆請求

HTTP API 可為 stage 啟用 access logs 並送往 CloudWatch Logs；這需要配置，不應假定所有請求已自動留下完整內容。見 [HTTP API logging](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)。本例可按下列分工安排觀察：

| 紀錄位置 | 值得保留的關聯與結果 |
| --- | --- |
| Gateway access log | `$context.requestId`、route、stage、最終 `$context.status`、integration latency 與錯誤訊息 |
| Handler 應用日誌 | 事件的 `requestContext.requestId`、此次 Lambda invocation ID、文章 ID、處理結果與下游錯誤分類 |
| 對外錯誤回應 | 在契約允許時回傳可供查詢的 request ID，不暴露內部例外或憑證 |

這是本例的日誌設計建議。Gateway 的 `$context.integration.integrationStatus` 表示 Lambda 服務回應狀態，`$context.integration.status` 則表示函式程式回傳的狀態，`$context.status` 是最終方法回應狀態；欄位可用性與定義見 [HTTP API logging variables](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging-variables.html)。

Lambda 自己也有 invocation ID；例如 Node.js 的 handler context 以 `awsRequestId` 提供它。它與 event 內的 Gateway request ID 屬於不同邊界，應在程式紀錄中建立對應，不能假定相等、互相覆寫，或把外部隨意傳入的 header 當成可信授權資訊。Lambda ID 定義見 [Node.js context object](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html)。關聯識別幫助追查，不是使用者身分或冪等鍵。

查不到函式日誌時，先核對時間、Region、目標函式與日誌權限，再判斷是否未被呼叫；只有 Gateway 紀錄不能證明文章查詢正確，只有函式成功日誌也不能證明用戶端收到回應。CloudWatch 與 CloudTrail 的用途區分見 [CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)。

## 相關文件

- [AWS 知識索引](README.md)：回查服務與閱讀順序。
- [API Gateway 與後端整合](api-gateway-and-backend-integration.md)：產品種類、route、stage、integration 與入口授權機制。
- [EC2 與 Lambda](ec2-and-lambda.md)：Event Function 執行模型與責任邊界。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：角色、政策與 AWS 授權判定。
- [RDS 與 DynamoDB](rds-and-dynamodb.md)：資料模型與存取方式。
- [CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)：運作觀察與活動追查。
- [逾時、重試與冪等性](../api/timeouts-retries-and-idempotency.md)：結果不確定時的重送與副作用契約。
