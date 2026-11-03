# 逾時、重試與冪等性

遠端操作沒有及時回應時，呼叫端面對的往往是「不知道結果」，而不只是「操作失敗」。
重新送出可能讓暫時故障恢復，也可能重複建立工作，或讓過載的服務承受更多請求。
時間限制、重試策略與冪等契約必須一起理解。

本文接續[〈輸入、輸出與失敗語意〉](input-output-failure-semantics.md)，
整理跨語言遠端操作的共同問題；HTTP 與 gRPC 是具體對照，不把各自規則套用到所有 API。

查證日期：2026-11-02。HTTP 語意依固定版本 RFC 9110（2022 年 6 月）；
gRPC 與 AWS Builders' Library 採查證當日的官方文章，未視為固定版本的 SDK 契約。
本文只查閱文件，未執行服務或程式測試；例子均為本站自創的概念互動。

## Timeout 限制多久，deadline 指出何時停止等待

**逾時限制（timeout）**是一段允許耗費的時間；**期限（deadline）**是一個不願再等下去的時間點。
例如「最多等 3 秒」是時間長度，「到本次開始後第 3 秒為止」則給整次操作一個截止點。
gRPC 官方文件以這個差異說明兩種 API 表達方式；具體參數與預設值依語言實作而異。
參考 [gRPC Deadlines：Overview](https://grpc.io/docs/guides/deadlines/#overview)。

遠端操作的時間不只有伺服器執行邏輯。建立連線、TLS 交握、送出資料、排隊與等待回應，都可能消耗預算。
**連線逾時**與**請求逾時**控制的階段不同；而同名選項在不同函式庫裡，也可能涵蓋不同工作。
AWS 特別提醒，有些 timeout 不涵蓋 DNS 查詢或 TLS 交握，不能只看到有設定就當成完整時間上限。
參考 [AWS：Timeouts, retries, and backoff with jitter，Timeouts](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)。

若整次互動只有 3 秒，第一次等待用了 2 秒，剩餘預算便只有約 1 秒；
重試與退避也要算在其中，不能每重試一次就替使用者重新開始完整的 3 秒。
這是採用整體期限後的預算推論，不是本文建議所有服務一律使用 3 秒。
gRPC 的期限傳遞會扣除已耗費時間；哪些語言自動傳遞、哪些須啟用，仍須讀該實作文件。
參考 [gRPC Deadlines：Deadline Propagation](https://grpc.io/docs/guides/deadlines/#deadline-propagation)。

期限設太長會持續占用資源，設太短又會製造本可成功的逾時與重試。
應依實際延遲、可接受等待時間及負載觀察選擇，而不是複製另一個服務的固定數字。
參考 [AWS：Timeouts](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)。

## 停止等待與取消，不會證明操作沒做

呼叫端逾時，只能確認自己沒有在限制內取得所需結果。
gRPC 明確說明，伺服器可能認為呼叫成功，呼叫端卻因回應晚於期限而認為失敗。
因此，「沒有收到成功」不能推導成「沒有產生副作用」。
參考 [gRPC 核心概念：RPC termination](https://grpc.io/docs/what-is-grpc/core-concepts/#rpc-termination)。

**取消（cancellation）**可傳達呼叫端已不需要結果，讓服務有機會停止浪費資源。
但服務處理程式仍須配合觀察取消並停止自己啟動的工作，不能假設本機呼叫取消後遠端運算瞬間消失。
參考 [gRPC Cancellation](https://grpc.io/docs/guides/cancellation/#cancelling-an-rpc-call-on-the-client-side)。

取消也不是 rollback。gRPC 的契約明示：取消前已做的變更不會因此回復。
若應用需要撤銷已建立的匯出工作，必須另有取消工作的業務操作與狀態規則，不能依賴傳輸層取消替代它。
參考 [gRPC 核心概念：Cancelling an RPC](https://grpc.io/docs/what-is-grpc/core-concepts/#cancelling-an-rpc)。

## 重試是在增加一次負載，不是免費補救

**重試（retry）**是再次嘗試操作，適合處理部分或短暫故障，但會耗用額外的服務資源。
若原本問題是過載，立即大量重送可能讓恢復更困難。
AWS 的經驗是限制重試次數，並在嘗試之間安排退避，而不是無限制持續送出。
參考 [AWS：Retries and backoff](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)。

多層重試還會乘倍。假設 A 呼叫 B、B 呼叫 C，且每層最多嘗試 3 次（含首次），
一個 A 的操作最多就可能引發 9 次 C 的呼叫；再增加一層相同策略就可能到 27 次。
這是自創簡化推算，前提是每次上層嘗試都觸發完整下層嘗試。
因此要知道 SDK、代理與應用各自是否重試，並明確安排哪一層負責；
AWS 也指出各層獨立重試會讓最底層負載相乘。
參考 [AWS：Retries and backoff](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)。

| 策略 | 要解決的問題 | 仍有哪些限制 |
| --- | --- | --- |
| 有限次數與整體時間預算 | 避免持續消耗資源與無限等待 | 次數用完仍可能無法確定第一次的結果 |
| 退避（backoff） | 在重試之間等待，降低立即重送的壓力 | 等待也消耗時間，服務可能仍無法恢復 |
| 隨機抖動（jitter） | 分散許多呼叫端同時重送的時間 | 減少同步尖峰，不保證成功或消除過載 |

退避與 jitter 的作用見 [AWS：Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)。
具體演算法、上限與參數須依服務需求決定，本文不給跨服務通用數值。

決定重試前，可依契約依序確認：錯誤是否被辨識為可恢復的暫時狀況、
重複執行是否安全，以及剩餘時間是否足以等待並再嘗試。
若只是輸入不符合規則，原樣重送通常沒有幫助；也不能只看見 5xx 就假定所有操作都能重試。
這是綜合錯誤語意、時間預算與下述冪等限制的使用判斷，不是新的協定規則。

在 HTTP 裡，`Retry-After` 可用日期或秒數表達後續請求應等待多久；
它要連同所屬回應的語意判讀，例如 503 表示預期服務暫時無法使用的時間。
它不是所有錯誤必備的欄位，也不會替不適合重送的操作補上冪等保證。
參考 [RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)。

## 冪等承諾限制的是重複操作的效果

**冪等性**讓多次相同操作的預期效果與一次相同，不要求每次回應完全一致。
HTTP 在讀到回應前發生通訊失敗時，允許自動重試冪等請求；非冪等方法則不應自動重試，
除非知道實際語意已具冪等性，或能確認原請求未被套用。
RFC 也建議不要在一次自動重試仍失敗後繼續自動重試。
參考 [RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)。

「安全讀取」也不等於零副作用，例如 HTTP 安全方法仍可留下每次存取紀錄。
HTTP 方法的完整對照與限制見[〈方法與操作語意〉](methods-and-operation-semantics.md)，本文不再重列方法表。
參考 [RFC 9110 §9.2.1–§9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1)。

建立資源也可以透過額外契約支援重試，例如用呼叫端提供的**冪等鍵（idempotency key）**
或操作識別，表達「這次是同一項意圖的重送」。相同內容不一定代表同一意圖：
使用者可能真的需要建立兩份內容相同的匯出工作，不能只憑參數相同就合併。
參考 [AWS：Making retries safe with idempotent APIs，Reducing client complexity](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-apis/)。

鍵本身沒有去重能力；服務必須能把它與原操作、結果及副作用一致地關聯。
否則可能已建立工作卻沒記下鍵，重送仍再次建立；反過來也可能記了鍵卻沒有完成建立。
AWS 的文章要求其所述設計將記錄識別與相關變更作為具原子性及一致性等保證的操作。
這是服務要履行的可靠性邊界，不是呼叫端多放一個字串就能解決。
參考 [AWS：Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-apis/)。

API 文件還須說明鍵的作用範圍、保留期、同鍵不同參數的結果，以及原操作尚在處理時如何回應。
AWS 的做法以同一呼叫者及識別判斷重送，保存原參數，對同識別不同參數回報驗證錯誤；
其文章也強調保留需求因服務與資源而異，不能套用固定通用期限。
參考 [AWS：Making retries safe with idempotent APIs，Late arriving requests 與參數變更段落](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-apis/)。

## 自創例子：匯出工作已建立，回應卻遺失

假設一個服務提供「建立文章匯出工作」，採呼叫者範圍內的操作識別去重。
在約定保留期內，同識別、同參數會指向同一工作；同識別卻改參數會拒絕。
以下是純文字概念互動，不是真實 API、HTTP 訊息或可執行程式：

```text
用戶端 → 服務：建立匯出工作，操作識別 export-intent-7，格式純文字
服務：建立工作 job-42，保存與操作識別的對應
服務 → 用戶端：已建立 job-42；但回應在途中遺失
用戶端：等待逾時，目前不知道工作是否建立
```

若預算與契約允許，用戶端可帶**相同識別與相同參數**重送；本例服務回報同一工作 job-42，
不再建立另一份。若服務另支援按該識別查詢，也可先查原工作的狀態。
這些都是本例明訂能力，不能假定所有帶鍵的 API 都支援查詢。

若改用新識別重送，服務可能理解為另一份匯出意圖，建立 job-43。
若已超過去重紀錄保留期，也不能只憑舊鍵推斷「一定不重複」或「原操作沒成功」。
此時可能需要仍可查詢的業務操作 ID、工作清單或人工核對流程；這些查核能力與保留規則也必須另訂。
保留期外的不確定性，是有限保留契約的推論；來源背景見
[AWS：Late arriving requests and the life span of unique client request identifiers](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-apis/)。

最後，取得 job-42 只確認建立工作的結果，不表示匯出檔已產生。
是否完成仍要查工作狀態；去重、成功建立與背景工作完成是不同承諾。
這個例子沒有宣稱傳輸或所有內部處理都具有 exactly-once 保證。

## 相關文件

- [輸入、輸出與失敗語意](input-output-failure-semantics.md)：理解失敗訊號與狀態影響的區別。
- [方法與操作語意](methods-and-operation-semantics.md)：對照 HTTP 的安全與冪等方法。
- [狀態碼與錯誤表示](status-codes-and-error-representations.md)：解讀可辨識原因、202 與錯誤內容。
- [API 共通知識索引](README.md)：回到跨語言概念與各協定分支。
