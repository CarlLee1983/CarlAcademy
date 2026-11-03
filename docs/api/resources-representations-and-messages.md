# 資源、表示與訊息

讀取一篇文章時，URI 指出要與哪個資源互動，HTTP 方法表達操作目的，
伺服器再透過回應訊息傳回結果。回應裡可能包含文章的某種表示，卻不等於把伺服器內部的文章物件搬過來。
把這幾層分清楚，才不會把 API 理解成「一個網址回傳一份 JSON」。

本文接續[〈介面、契約與責任〉](interface-contract-responsibility.md)，
聚焦 HTTP 的 URI、請求／回應、標頭、內容與媒體類型，不要求先熟悉特定程式語言。

查證日期：2026-11-02。依據固定版本 RFC 9110、RFC 9112（皆為 2022 年 6 月）與 RFC 3986（2005 年 1 月）。
本文只查閱文件；教學訊息為自創，未發送範例 HTTP 請求，也未實測服務。

## 資源是互動的對象，表示是傳達狀態的資訊

HTTP 把請求所針對的對象稱為**資源（resource）**，不限制它必須是哪一種事物。
它可以是一篇文章、文章集合，也可以是隨時間改變的概念，例如某地目前的天氣。
**表示（representation）**則是用可傳送的形式，表達某個資源過去、目前或期望狀態的資訊；
它包含表示資料，以及描述這些資料的中繼資料（metadata）。
參考 [RFC 9110 §3.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.1)與[§3.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.2)。

以下使用**本站假想的唯讀文章服務**：`https://example.com/articles/42` 識別「編號 42 的文章」。
它與前文的記憶體清單例子是不同情境，不替那些操作新增網路契約。

| 概念 | 本例如何理解 |
| --- | --- |
| 資源 | 編號 42 的文章這個互動對象 |
| URI | 識別這篇文章的 `https://example.com/articles/42` |
| 表示 | 用純文字、HTML 或 JSON 等形式表達這篇文章的狀態 |
| 訊息 | 用戶端送出的 HTTP 請求，或伺服器傳回的 HTTP 回應 |
| 內部實作 | 文章資料如何儲存、查詢與組合；本例沒有約定 |

資源不必對應單一資料庫列或磁碟檔案，也不能直接等同回應中的 JSON。
例如這篇文章的表示可以由多份內部資料組合產生；使用者能依賴的是公開介面的承諾，不能從 URI 推定儲存方式。
HTTP 以可傳送的表示進行溝通，使資源本身與內部實作可以留在介面後方。
參考 [RFC 9110 §3.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.2)。

**同一個資源可以有多種表示。**本例可以提供適合閱讀的 HTML，也提供適合程式處理的 JSON；
這不是兩篇不同文章的必要證據，也不表示每個服務都必須支援兩種格式。
圖片也能作為資源的表示，HTTP 並未預設所有資料都是 JSON。
伺服器可從可用表示中選擇適合這次請求的一種，稱為「選定的表示」。
參考 [RFC 9110 §3.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.2)。

## URI 識別什麼，方法要求做什麼

**URI（Uniform Resource Identifier，統一資源識別符）**的基本用途是識別資源，
不能把所有 URI 都當成可連線取得資料的網路地址。
HTTP 常用的 `http` 與 `https` URI，另有各自的識別與存取規則。
參考 [RFC 3986 §1.1.3](https://www.rfc-editor.org/rfc/rfc3986.html#section-1.1.3)與
[RFC 9110 §4.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2)。

把本例的 URI 加上查詢與片段，可以看出不同部分：

```text
https://example.com/articles/42?view=brief#intro
```

| 部分 | 本例的值 | 如何閱讀 |
| --- | --- | --- |
| scheme | `https` | 指定 URI 使用的綱要及其規則 |
| authority | `example.com` | 本例只有主機名稱 |
| path | `/articles/42` | 路徑資料；不能據此推定伺服器有同名目錄 |
| query | `view=brief` | 與路徑共同參與資源識別；本例假設服務將它解讀為簡要版本 |
| fragment | `intro` | 用戶端處理的片段識別；如何解讀取決於表示的媒體類型 |

`view=brief` 的意義是本例的設計，URI 通用語法沒有規定這個參數，也沒有規定所有 query 都只能用於篩選。
path、query 與 fragment 的定義見 [RFC 3986 §3.3–§3.5](https://www.rfc-editor.org/rfc/rfc3986.html#section-3.3)。

發送 HTTP 請求時，**目標 URI（target URI）不包含 fragment**，
因此 `#intro` 不會作為請求目標送到伺服器。它與 `?view=brief` 的角色不同。
參考 [RFC 9110 §7.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1)。

URI 識別對象，**方法（method）**是請求語意的主要來源。
例如 `GET` 要求取得目標資源目前的選定表示；不能只憑 `/articles/42` 的名稱就知道這次要求什麼操作。
參考 [RFC 9110 §9.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1)與[§9.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1)。
URI 採用名詞，也不足以證明整個 API 符合 REST；設計風格的定位可先回看 [API 索引](README.md)。

## 請求與回應各自是一則訊息

**請求（request）**由用戶端表達意圖；**回應（response）**由伺服器表達處理結果。
HTTP 訊息的共同概念包括控制資料、標頭欄位，以及可能存在的內容；
協定也支援尾端欄位（trailer fields），本文先不展開。
參考 [RFC 9110 §3.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.4)與[§6](https://www.rfc-editor.org/rfc/rfc9110.html#section-6)。

| 部分 | 請求中的用途 | 回應中的用途 |
| --- | --- | --- |
| 控制資料 | 表達方法、請求目標等資訊 | 表達狀態碼等資訊 |
| 標頭欄位（header fields） | 補充請求條件、偏好或內容資訊 | 補充回應與表示的資訊 |
| 內容（content） | 若有，依方法與欄位解讀其用途 | 若有，依方法、狀態碼與欄位解讀其用途 |

欄位不是只有格式設定；不同欄位有自己的語意。
內容也不是每則訊息都必須有，而且不能把所有回應內容都當成目標資源目前的表示。
例如對 GET 的 `200 OK` 回應，其內容是目標資源的表示；其他回應要按各自語意判讀。
參考 [RFC 9110 §6.2–§6.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.2)。

### 看一次 HTTP/1.1 訊息交換

以下自創請求讀取原本的 `https://example.com/articles/42`，不帶 query 或 fragment，也沒有請求內容：

```http
GET /articles/42 HTTP/1.1
Host: example.com
Accept: text/plain

```

這裡使用 HTTP/1.1 直接向來源伺服器請求時的常見形式：請求列放 path，另以 `Host` 指出主機。
不表示完整 URI 只剩 path；本例的 `https` 也不是從 `Host` 那一行單獨得知。
參考 [RFC 9112 §3.2.1](https://www.rfc-editor.org/rfc/rfc9112.html#section-3.2.1)與[§3.3](https://www.rfc-editor.org/rfc/rfc9112.html#section-3.3)。

假設伺服器選擇純文字表示，回應如下；日期同樣是教學值：

```http
HTTP/1.1 200 OK
Date: Mon, 02 Nov 2026 00:00:00 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 11

HTTP basics
```

`200` 表示這次請求成功；本例的內容是文章的純文字表示 `HTTP basics`。
`Content-Length: 11` 以位元組計算內容長度；這 11 個 ASCII 字元不含結尾換行。
區塊為了排版顯示的最後換行不屬於內容；起始列與每一行標頭在 HTTP/1.1 傳送時以 CRLF 結束，
標頭後另有空白行。請求的空白行後就結束；沒有 `Content-Length` 或 `Transfer-Encoding` 的這個請求沒有訊息主體。
參考 [RFC 9110 §15.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.1)、
[RFC 9112 §2.1](https://www.rfc-editor.org/rfc/rfc9112.html#section-2.1)與[§6.3](https://www.rfc-editor.org/rfc/rfc9112.html#section-6.3)。

這是 **HTTP/1.1 的文字訊息形式**，不是 HTTP/2 或 HTTP/3 的線路格式。
各版本共享許多語意，但訊息編碼與分界方式不同，不能把這段文字直接當成所有版本的傳送格式。
參考 [RFC 9110 §6](https://www.rfc-editor.org/rfc/rfc9110.html#section-6)與[§6.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.2)。

## Content-Type 描述內容，Accept 表達偏好

本例的 `Content-Type: text/plain; charset=utf-8` 告訴接收端：
這份表示的媒體類型是純文字，文字以 UTF-8 解讀。
媒體類型（media type）描述資料格式與預期的處理方式；不是「文章」「使用者」等業務資源分類。
`Content-Type` 描述相關表示；有內容時通常是內容所攜帶的表示，部分無內容訊息也可用它描述選定表示。
缺少這個欄位不代表內容自動成為 JSON。
參考 [RFC 9110 §8.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3)與[§8.3.1–§8.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.1)。

請求中的 `Accept: text/plain` 則表達用戶端可接受的回應媒體類型偏好，
不是宣告請求自己帶著純文字，也不保證伺服器一定有純文字表示或一定回傳它。
若可用表示都不符合偏好，伺服器可能拒絕，也可能忽略該偏好；呼叫端仍須檢查實際回應。
參考 [RFC 9110 §12.4.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.4.1)與[§12.5.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.1)。

讀取 HTTP API 文件時，可以沿著「目標資源 → 方法 → 回應結果 → 表示與媒體類型」理解一次互動。
欄位與內容解決如何表達、如何解讀的問題；文章欄位有哪些、哪些輸入有效等應用規則，仍須由 API 契約說明。
方法的安全性與冪等性見[方法與操作語意](methods-and-operation-semantics.md)，回應結果見[狀態碼與錯誤表示](status-codes-and-error-representations.md)，表示的重用與驗證見[快取與條件請求](caching-and-conditional-requests.md)。

## 相關文件

- [介面、契約與責任](interface-contract-responsibility.md)：區分公開承諾與內部實作。
- [輸入、輸出與失敗語意](input-output-failure-semantics.md)：回看資料格式以外，仍須說明的限制、意義與副作用。
- [API 共通知識索引](README.md)：查看 HTTP 分支與共通概念。
