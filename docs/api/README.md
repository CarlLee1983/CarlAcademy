# API 共通知識索引

從介面與契約理解 API，再依需要閱讀 HTTP、設計風格與具體技術。
本索引不指定主要程式語言或框架。

**目前狀態：本索引列出的 18 篇概念文章已整理；各語言、框架與服務的實作範例按需求另行補充。**
內容涵蓋五篇共通基礎、五篇共通延伸、五篇 HTTP，以及 REST、gRPC、GraphQL 三篇專題。

查證日期：2026-11-02。分類與閱讀順序是本站的編輯提案，並非通用標準分類。

## 先分清楚討論範圍

API（Application Programming Interface）不只存在於網路服務。
例如 Python/C API 提供擴充或嵌入直譯器的介面；這類介面不必透過 HTTP 呼叫。
因此不能把所有 API 都理解成網址、請求／回應或 JSON 資料。
參考 [Python/C API 導論](https://docs.python.org/3/c-api/intro.html)。

本索引先整理介面提供者與使用者之間的共同問題，再處理不同情境：

| 討論面向 | 閱讀時要區分的概念 |
| --- | --- |
| 介面與契約 | 可用能力、輸入輸出、失敗語意，以及雙方責任 |
| 互動與通訊 | 程序內呼叫、遠端呼叫、串流等情境；HTTP 是應用層協定 |
| 設計風格與技術 | REST 的架構約束、gRPC 的服務方法、GraphQL 的型別與查詢模型 |
| 描述與編碼 | 契約描述方式、訊息格式與實際傳送方式，分別說明 |

HTTP 的協定定位見 [RFC 9110 §1](https://www.rfc-editor.org/rfc/rfc9110.html#section-1)。
REST 是架構風格，不能只因使用 HTTP 或 JSON 就稱為 REST；其定義包含一組架構約束。
參考 [Fielding 第五章](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm)。

gRPC 以服務方法及訊息定義描述遠端呼叫，也支援串流；其 HTTP/2 協定另有具體定義。
GraphQL 定義查詢語言與執行語意，官方文件說明它不要求特定的用戶端／伺服器協定。
因此 HTTP、REST、gRPC、GraphQL 不能當作同一層互斥的四種類別。
參考 [gRPC 核心概念](https://grpc.io/docs/what-is-grpc/core-concepts/)、
[gRPC over HTTP/2](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md)、
[GraphQL 規格導言](https://spec.graphql.org/October2021/#sec-Introduction)與
[GraphQL over HTTP 說明](https://graphql.org/learn/serving-over-http/)。

## 建議閱讀順序

1. **[介面與契約](interface-contract-responsibility.md)**：先知道誰提供能力、誰使用，以及承諾了什麼。
2. **[資料與失敗語意](input-output-failure-semantics.md)**：理解輸入限制、輸出意義與錯誤如何被使用者辨識。
3. **[相容性](compatibility-and-evolution.md)、[文件](documentation-and-contract-description.md)與[測試](api-testing.md)**：理解契約如何被記錄、驗證與演進。
4. **選擇情境**：處理 HTTP 服務時從[資源、表示與訊息](resources-representations-and-messages.md)開始；遇到特定技術時讀對應分支。
5. **閱讀實作**：回到使用中的語言、框架或雲端服務，對照共通概念與實際差異。

這是閱讀建議，可以依問題直接查找，不需要依序完成。

## 共通概念

| 文章 | 內容邊界 |
| --- | --- |
| [介面、契約與責任](interface-contract-responsibility.md) | 提供者／使用者、公開介面與實作細節、前置與後置條件 |
| [輸入、輸出與失敗語意](input-output-failure-semantics.md) | 資料型別、限制、驗證、錯誤與副作用；不預設 HTTP 狀態碼 |
| [相容性與演進](compatibility-and-evolution.md) | 行為改變、破壞性變更、版本與棄用；區分原始碼、二進位及訊息契約 |
| [文件與契約描述](documentation-and-contract-description.md) | 能力、限制、例子與描述工具；工具依介面種類選擇 |
| [API 測試](api-testing.md) | 使用者可觀察的行為、邊界與失敗案例，以及契約與整合測試 |

以下延伸依情境閱讀，不把每個議題套用到所有 API：

- **[身分驗證與授權](authentication-and-authorization.md)**：在有身分與存取控制需求時，整理身分、操作與資源的關係。
- **[逾時、重試與冪等性](timeouts-retries-and-idempotency.md)**：以遠端操作為重點，整理重複執行、部分失敗及副作用。
- **[集合查詢設計](collection-query-design.md)**：有集合介面時，整理篩選、排序、分頁與一致性的取捨。
- **[長時間執行操作與非同步 API 契約](long-running-operations-and-async-apis.md)**：操作無法在單次請求期限內完成時，分離受理請求與完成工作，整理操作資源、輪詢、取消與保留期。
- **[Webhook、事件回呼與反向通知契約](webhooks-and-event-callbacks.md)**：由事件來源主動推送通知時，整理角色反轉、至少一次投遞、簽章防重放與對外連線邊界。

## HTTP API

此分支集中處理 HTTP 語意，其他分支引用所需部分。
方法、狀態碼與欄位的定義以 [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)為基礎；
快取規則另見 [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html)。

| 文章 | 內容邊界 |
| --- | --- |
| [資源、表示與訊息](resources-representations-and-messages.md) | URI、請求／回應、標頭、內容與媒體類型；不預設 JSON |
| [方法與操作語意](methods-and-operation-semantics.md) | GET、POST 等方法、安全方法（safe methods）與冪等性；連回副作用與重試概念 |
| [狀態碼與錯誤表示](status-codes-and-error-representations.md) | HTTP 層結果與應用程式錯誤、輸入驗證的對應方式 |
| [快取與條件請求](caching-and-conditional-requests.md) | 快取控制、驗證器與條件請求的作用及限制 |
| [HTTP API 契約與 OpenAPI](http-api-contracts-and-openapi.md) | 路徑、操作、參數、回應與文件的一致性 |

OpenAPI 是與程式語言無關的 **HTTP API 介面描述規範**，不是所有 API 的統一契約格式。
本次查閱 [OpenAPI 3.2.1 的範圍說明](https://spec.openapis.org/oas/v3.2.1.html#what-is-the-openapi-specification)。

## 設計風格與具體技術

- **[REST 的架構約束](rest-architectural-constraints.md)**：資源、表示、統一介面與超媒體；討論約束與取捨。
- **[gRPC 的服務與呼叫模型](grpc-services-and-call-model.md)**：服務定義、一元呼叫與串流、期限及狀態；區分訊息與通訊層。
- **[GraphQL 的型別與執行模型](graphql-types-and-execution.md)**：schema、查詢、變更與訂閱；另述 HTTP 對應方式。

各篇先引用共同契約、相容性及失敗概念，再補該技術的規則；不承諾每項技術適用於同一需求。

## 語言、框架與服務實作

目前以概念文章為主，尚未編寫語言、框架或服務的實作教學；有具體需求時再補充，不預先建立多語言的重複教學。
每篇引用共通概念後，說明該工具的寫法、預設行為、限制與適用版本。
AWS 或其他服務若有專屬驗證、錯誤或重試規則，也在服務文件補充差異。
操作範例須記錄實際驗證情況；本次僅查證文件，未執行服務或程式測試。

## 相關主題

- [關聯式資料庫](../relational-databases/README.md)：理解儲存層的模型、交易與查詢；API 重試與資料庫提交結果須一起考慮。
- [Web 應用資安](../web-security/README.md)：將驗證與授權概念延伸到 Session、瀏覽器及資料處理邊界。

## 參考來源與對應範圍

以下為本次實際查閱的一手來源；可變動的官方導覽頁以查證日期為準。

| 來源 | 對應主題 |
| --- | --- |
| [Python/C API 導論](https://docs.python.org/3/c-api/intro.html) | 非 HTTP 的介面實例 |
| [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)／[RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) | HTTP 語意、方法、狀態、欄位與快取 |
| [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) | HTTP Problem Details 錯誤表示 |
| [OpenAPI 3.2.1](https://spec.openapis.org/oas/v3.2.1.html) | HTTP API 描述的適用範圍 |
| [Fielding 第五章](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm) | REST 架構風格與約束 |
| [gRPC 核心概念](https://grpc.io/docs/what-is-grpc/core-concepts/)／[HTTP/2 協定](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md) | 服務方法、串流與通訊協定的區別 |
| [GraphQL October 2021 規格](https://spec.graphql.org/October2021/)／[HTTP 說明](https://graphql.org/learn/serving-over-http/) | 語言、執行模型與 HTTP 使用情境；此版不是最新版本的宣告 |
| [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | 身分、資源、操作與權限檢查 |
| [AWS Builders' Library：重試與退避](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)／[冪等 API](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-apis/) | 遠端操作的時間限制、重試與去重契約 |
| [Google AIP-132](https://google.aip.dev/132)／[AIP-151](https://google.aip.dev/151)／[AIP-158](https://google.aip.dev/158)／[AIP-160](https://google.aip.dev/160) | 集合查詢、長時間操作、分頁與篩選的具體設計指南，並非所有 API 的通用規定 |
| [RFC 2104](https://www.rfc-editor.org/rfc/rfc2104.html)／[OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) | Webhook 訊息驗證碼（HMAC）與伺服器對外回呼請求的防護邊界 |
