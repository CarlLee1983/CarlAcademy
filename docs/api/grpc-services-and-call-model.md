# gRPC 的服務與呼叫模型

gRPC 以「呼叫遠端服務的方法」組織 API：先定義服務提供哪些方法，
每個方法接收與回傳哪些訊息，再由用戶端與伺服器依這份定義互動。
它也支援一次呼叫傳送多個訊息的串流，不限於一問一答。

本文先說明服務、訊息與產生程式碼的分工，再看四種呼叫模式、完成狀態、期限與取消。
先備概念可讀[〈介面、契約與責任〉](interface-contract-responsibility.md)與
[〈輸入、輸出與失敗語意〉](input-output-failure-semantics.md)，不需要先熟悉特定語言 SDK。

查證日期：2026-11-02。本文依據查證當日的 gRPC 官方指南、官方儲存庫 `master` 分支的
HTTP/2 協定文件，以及 Protobuf proto3 指南；這些來源持續更新，不代表固定 SDK 版本。
本文只查閱文件；自創 `.proto` 範例未編譯，未產生 stub、啟動服務或執行呼叫測試。

## 服務方法、訊息與兩端程式

**服務（service）**是一組可遠端呼叫的方法；**方法（method）**指定操作名稱及輸入、輸出訊息型別。
**訊息（message）**則定義傳遞資料的結構，例如文章識別碼與標題欄位。
服務定義描述可用入口，仍需要伺服器實作真正的處理行為。
參考 [gRPC：服務定義](https://grpc.io/docs/what-is-grpc/core-concepts/#service-definition)。

gRPC 常以 Protocol Buffers（Protobuf）同時作為介面描述語言（IDL）與訊息序列化格式。
IDL 描述服務與資料形狀；序列化則把訊息轉成可傳送的位元組，接收端再解碼。
Protobuf 是 gRPC 的預設選擇，官方也允許其他替代方式；更不能把它當作所有 RPC 唯一的格式。
參考 [gRPC 導論](https://grpc.io/docs/what-is-grpc/introduction/)與
[核心概念](https://grpc.io/docs/what-is-grpc/core-concepts/#service-definition)。

在常見的 Protobuf 用法中，編譯器搭配 gRPC 外掛，從 `.proto` 產生兩端所需的程式碼：

| 角色 | 負責什麼 |
| --- | --- |
| 用戶端 stub | 提供本地可呼叫的服務方法入口，透過 gRPC 將呼叫送往遠端；部分語言直接稱為 client |
| 伺服器實作 | 實現服務方法的應用行為，例如依識別碼查詢文章 |
| gRPC 執行環境 | 接合呼叫、訊息編解碼與通訊，將收到的呼叫交給服務實作 |

這讓呼叫形式接近一般方法呼叫，卻沒有消除遠端延遲或失敗。
產生 stub 也不會自動補出業務規則、授權、正確資料或可靠性保證。
參考 [gRPC 導論：兩端角色](https://grpc.io/docs/what-is-grpc/introduction/#overview)與
[Protobuf proto3：Defining Services](https://protobuf.dev/programming-guides/proto3/#services)。

## 一份短服務定義

以下是**本站自創的獨立文章服務例子**，包含全部引用的訊息型別；它不是前面記憶體內「設定清單標題」的實作。
`GetArticle` 示範取得單篇文章，`ListArticles` 示範逐筆傳回文章；本例不定義實際資料來源。

```proto
syntax = "proto3";
package carlacademy.example;

service ArticleService {
  rpc GetArticle(GetArticleRequest) returns (Article);
  rpc ListArticles(ListArticlesRequest) returns (stream Article);
}

message GetArticleRequest {
  string article_id = 1;
}

message ListArticlesRequest {
  string topic = 1;
}

message Article {
  string article_id = 1;
  string title = 2;
}
```

`service` 內的 `rpc` 宣告方法，`message` 定義資料欄位，`stream` 標出串流的一側。
欄位後的 `1`、`2` 是欄位編號，用於 Protobuf 二進位訊息格式中的識別，不是預設值。
這份範例採 proto3 語法，不代表 Protobuf 只有這一種語法版本。
參考 [Protobuf proto3：訊息與欄位編號](https://protobuf.dev/programming-guides/proto3/#defining-a-message-type)。

`string title = 2` 只宣告字串欄位，不會自動附帶前篇自訂的「1 到 20 個 Unicode 碼位」限制。
文章不存在時的結果、`topic` 的意義、列表順序與何時結束，也不能只從型別推知。
這些仍須寫入服務契約並由實作履行；可回看[〈文件與契約描述〉](documentation-and-contract-description.md)。

## 四種呼叫模式

四種模式描述的是**單次 RPC 內，兩個方向如何傳遞應用訊息**，不是四種資料編碼。
下表描述正常互動形式；發生錯誤時，不保證仍能取得成功回應訊息。

| 模式 | 用戶端 → 伺服器 | 伺服器 → 用戶端 | 自創用途示意 |
| --- | --- | --- | --- |
| 一元（unary） | 一個請求訊息 | 一個回應訊息 | `GetArticle` 取得單篇文章 |
| 伺服器串流（server streaming） | 一個請求訊息 | 一串回應訊息 | `ListArticles` 逐筆傳回文章 |
| 用戶端串流（client streaming） | 一串請求訊息 | 一個回應訊息 | 逐筆提交資料，最後取得彙整結果 |
| 雙向串流（bidirectional streaming） | 一串請求訊息 | 一串回應訊息 | 雙方持續交換更新 |

串流不表示兩邊必須一來一回交替，也不表示永遠不結束。
在單次 RPC 中，每個方向的訊息順序會被保留；雙向的兩條訊息流彼此獨立，
應用可選擇交替處理，或先收一些訊息再送出結果，不能推定第 n 個回應必定對應第 n 個請求。
參考 [gRPC：四種服務方法](https://grpc.io/docs/what-is-grpc/core-concepts/#service-definition)。

## 訊息編碼與傳輸，是不同層次

`.proto` 定義訊息，不等於訊息已經送出；Protobuf 編碼也不等於完整的 gRPC 呼叫。
官方 gRPC over HTTP/2 協定另外規定方法路徑、標頭、帶長度前綴的訊息及結尾資訊，
並把它們映射到 HTTP/2 frame。HTTP/2 的 DATA frame 邊界也不必等於應用訊息邊界。
因此，直接對某個網址送一般 JSON，不能只因使用 HTTP/2 就當成有效的 gRPC 呼叫。
參考 [gRPC over HTTP/2：協定與訊息框架](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md)。

Protobuf 另有 JSON 表示方式，但支援 JSON 表示不會自動把上述服務變成普通 JSON endpoint。
若另外提供轉換層，還需要該層自己的路由與映射約定。
參考 [Protobuf proto3：JSON Mapping](https://protobuf.dev/programming-guides/proto3/#json)。

## 收到資料之後，還要看完成狀態

呼叫除了應用訊息，也有 **status**，用來表達完成結果；狀態碼由服務應用或 gRPC 函式庫產生。
例如 `OK` 表示成功，`INVALID_ARGUMENT` 表示參數無效，`DEADLINE_EXCEEDED` 表示期限已過。
具體語言可能把非成功狀態呈現為例外或其他結果形式。
參考 [gRPC：Status Codes](https://grpc.io/docs/guides/status-codes/)。

用戶端呼叫 stub 後，兩端交換必要的呼叫資訊與訊息；正常完成時，伺服器送出最終狀態。
對伺服器串流，只讀到第一篇文章，不足以宣稱整次列表呼叫成功：後續仍可能失敗。
使用者應依所用 SDK 的介面讀取訊息與最終結果。
參考 [gRPC：RPC life cycle](https://grpc.io/docs/what-is-grpc/core-concepts/#rpc-life-cycle)。

**metadata** 是與 RPC 關聯的額外資訊；initial metadata 在資料前傳遞，
trailing metadata 則隨伺服器結束呼叫的 trailers 傳遞，並可包含自訂資訊。
參考 [gRPC：Metadata](https://grpc.io/docs/guides/metadata/)。
在官方 HTTP/2 協定中，`grpc-status` 位於 trailers；HTTP 的 `:status` 與 gRPC status 是兩回事。
例如 HTTP `200` 仍可搭配失敗的 gRPC 狀態，不能把兩套狀態碼直接逐一對照。
參考 [gRPC over HTTP/2：Responses](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md#responses)。

## deadline 限制等待，不證明伺服器沒做事

**deadline** 是不願再等待的時間點；**timeout** 是允許經過的最長時間。
例如「最多等 2 秒」是 timeout，在開始呼叫時加上目前時間，便可換算成 deadline。
不同語言 API 採用的形式可能不同。gRPC 預設不設定 deadline，用戶端可能持續等待，
官方因此建議用戶端明確設定符合實際需求的期限，而不是假定 stub 自帶合理上限。
參考 [gRPC：Deadlines](https://grpc.io/docs/guides/deadlines/)。

用戶端收到 `DEADLINE_EXCEEDED`，表示未能在期限內完成它所等待的呼叫，
不表示伺服器沒有修改資料；官方指出，改變狀態的操作可能已成功，只是回應抵達得太晚。
這延續[〈輸入、輸出與失敗語意〉](input-output-failure-semantics.md)的區分：失敗訊號不必然等於無副作用。
是否重試仍需操作契約與結果確認方式，不能單憑逾時就任意重送。
參考 [gRPC：DEADLINE_EXCEEDED](https://grpc.io/docs/guides/status-codes/)。

## cancellation 需要應用程式配合停止

用戶端不再需要結果時可取消 RPC；期限到期與 I/O 錯誤也可能觸發取消。
取消不是回滾：取消前已完成的資料改變不會因此自動撤銷。
參考 [gRPC：Cancellation](https://grpc.io/docs/guides/cancellation/)與
[核心概念：Cancelling an RPC](https://grpc.io/docs/what-is-grpc/core-concepts/#cancelling-an-rpc)。

gRPC 函式庫通常無法直接中斷應用程式正在執行的 handler。
伺服器需觀察取消訊號、停止不再需要的處理，並自行照顧為這次 RPC 衍生的工作。
若處理過程還呼叫其他服務，也要確認取消與 deadline 如何向後傳遞；語言與實作的自動支援不同。
不能只取消最外層呼叫，就假定所有背景工作已停止。
參考 [gRPC：取消處理](https://grpc.io/docs/guides/cancellation/#cancelling-an-rpc-call-on-the-client-side)與
[Deadlines：Server 與 Propagation](https://grpc.io/docs/guides/deadlines/#deadlines-on-the-server)。

## 相關文件

- [輸入、輸出與失敗語意](input-output-failure-semantics.md)：區分訊息型別、結果意義與副作用。
- [相容性與演進](compatibility-and-evolution.md)：理解訊息可解析與行為相容的差異。
- [API 測試](api-testing.md)：從公開結果與狀態檢查契約，避免只驗證訊息形狀。
- [方法與操作語意](methods-and-operation-semantics.md)：對照 HTTP 方法的語意；gRPC 方法仍要另訂操作保證。
- [逾時、重試與冪等性](timeouts-retries-and-idempotency.md)：將期限、取消與重試放回遠端操作的共同問題。
- [API 共通知識索引](README.md)：查看共通概念、HTTP 與其他技術分支。
