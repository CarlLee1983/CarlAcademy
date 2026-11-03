# REST 的架構約束

一個 API 使用 HTTP、回傳 JSON，並以名詞命名 URI，是否就符合 REST？
這些特徵還不足以回答。REST 描述的是元件如何互動的一組架構約束，
需要一起看請求、表示、狀態、快取與控制流程。

本文以[〈資源、表示與訊息〉](resources-representations-and-messages.md)及
[〈方法與操作語意〉](methods-and-operation-semantics.md)為先備概念，
從 Fielding 的原始定義理解 REST，不把它當作 HTTP API 的統一命名規則。

查證日期：2026-11-02。依據 Fielding 2000 年博士論文第五章與 RFC 9110（2022 年 6 月）。
本文只查閱文件；文章服務與 HTML 片段是自創教學例子，未發送請求、執行程式或實測服務。

## REST 是架構風格，HTTP 是協定

REST（Representational State Transfer）是一種為分散式超媒體系統提出的**架構風格**。
它抽象化元件的實作與協定語法，聚焦角色、互動限制，以及資料如何被理解。
HTTP 可以支援這種互動，但採用 HTTP 並不會自動使應用符合全部約束。
Fielding 也明確指出 REST 不限定單一通訊協定。
參考 [Fielding §5.2](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_2)
與[§5.3.2](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_3_2)。

因此，REST 不是 JSON 格式、特定框架，或把資料庫 CRUD 換成 HTTP 方法的對照表。
CRUD 是建立、讀取、更新與刪除資料的操作分類；光有這些操作，
還不能說明用戶端是否依賴伺服器記住互動進度，或如何得知下一步可以做什麼。

## 六項約束如何分工

Fielding 逐步加入下列約束，其中 code-on-demand 是選用項目。
以下是閱讀入口，後面再展開容易誤解的部分。

| 約束 | 對互動施加的限制 |
| --- | --- |
| 用戶端與伺服器（client-server） | 分離介面使用與資料儲存等關注點，讓兩端能各自演進 |
| 無狀態互動（stateless） | 每個請求帶有理解它所需的資訊，不依賴伺服器保留先前請求的會話脈絡 |
| 快取（cache） | 回應資料須依明示或隱含規則區分可快取與不可快取 |
| 統一介面（uniform interface） | 透過共同介面語意互動，而不是每種資源都另造一套呼叫機制 |
| 分層系統（layered system） | 元件的互動視野限於直接接觸的層，不依賴整條處理路徑的內部拓樸 |
| 按需程式碼（code-on-demand，選用） | 允許下載並執行程式碼，以擴充用戶端能力 |

六項的原始推導見 [Fielding §5.1.2–§5.1.7](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_1_2)。
「選用」只適用於 code-on-demand，不能擴大成其他約束也都可任意省略。
這組約束一起形成 REST；單獨做到其中一項，不足以證明整體符合。

分層允許中介者參與，例如來源伺服器前方有代理或快取，
用戶端仍透過同一套介面互動，不必知道請求經過哪些內部服務。
它能隱藏複雜度，但中介處理也會增加額外成本與延遲。
按需程式碼則能增加部署後的擴充能力，同時降低互動的可見性，因此被列為選用。
參考 [Fielding §5.1.6](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_1_6)
與[§5.1.7](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_1_7)。

## Stateless 限制的是互動脈絡，不是所有資料

「伺服器無狀態」容易讓人誤以為伺服器不能保存文章、帳戶或任何資料。
REST 的限制是：理解目前請求，不能依賴伺服器替這個用戶端記住先前的會話進度。
資源本身仍有狀態，來源伺服器也仍負責提供與改變它。
參考 [Fielding §5.1.3](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_1_3)
與[§5.2.3](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_2_3)。

以自創文章服務推演，這兩種狀態應分開：

| 情況 | 如何判讀 |
| --- | --- |
| 伺服器保存第 42 篇文章的標題與內容 | 這是資源資料，不能只因它被保存就判定違反 stateless |
| 請求明確指出要讀第 42 篇文章 | 目標在本次請求中，不必靠前一次讀取才能知道對象 |
| 請求只說「下一篇」，目標完全取決於伺服器記住這個用戶端剛讀哪篇 | 理解請求需要先前會話脈絡，不符合這裡的 stateless 約束 |

無狀態也不表示不能驗證身分；RFC 9110 的 HTTP 認證模型要求，
驗證請求所需的資訊應由該請求提供，而不是依賴伺服器記住先前請求。
不能僅憑有無登入、cookie，或某項技術名稱含有 session 就判定符合與否；
要看請求是否依賴伺服器保存的會話脈絡。具體認證設計不在本文範圍。
參考 [RFC 9110 §16.4.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-16.4.2)。

HTTP 協定本身的 stateless 也不會替應用排除會話依賴。
RFC 將其解釋為請求訊息的語意可獨立理解，連線與訊息的關係不影響訊息解讀；
不能把「HTTP 無狀態」直接當成「這個 HTTP 應用已符合 REST」。
參考 [RFC 9110 §3.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.3)。

## Cache 要能判斷可否重用

REST 的快取約束要求回應資料有可快取或不可快取的判斷依據，
可以由明確資訊提供，也可以來自已定義的隱含規則；不是每個回應都必須被快取。
能重用回應可以減少互動，但過時資料也可能使結果與直接請求不同。
參考 [Fielding §5.1.4](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_1_4)。

在文章例子中，可以依服務規則允許暫時重用文章表示；另一種結果也可以禁止重用。
重點是接收端能按共同規則判斷，而不是從「這看起來像文章」自行猜測。
HTTP 的具體快取控制、有效期限與重新驗證，見[快取與條件請求](caching-and-conditional-requests.md)。

## Uniform interface 包含四部分

統一介面不是要求所有資源長得一樣，也不只是統一 JSON 欄位命名。
Fielding 明列四個組成約束：

| 組成 | 在文章服務中如何理解 |
| --- | --- |
| 資源識別（identification of resources） | 識別「第 42 篇文章」，而非把內部物件或資料表當成外部必須理解的結構 |
| 透過表示操作資源（manipulation through representations） | 傳遞表達目前或期望狀態的表示；不把伺服器內部物件直接暴露成必須同步的實作 |
| 自我描述訊息（self-descriptive messages） | 共同的方法、媒體類型及控制資訊提供解讀依據，讓訊息能被相應接收端理解 |
| 超媒體驅動應用狀態（hypermedia as the engine of application state） | 用戶端從目前收到的表示中，辨識並選擇下一步可採取的轉移 |

參考 [Fielding §5.1.5](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_1_5)、
[§5.2.1](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_2_1)及
[§5.3.3](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_3_3)。
自我描述不表示接收端不需要先懂協定或媒體類型；它需要共同語意，並非靠猜測內容。

### 從「閱讀下一篇」看超媒體

另假設文章服務回傳 HTML 表示，下面只摘出內容片段，省略完整 HTTP 訊息：

```html
<article>
  <h1>HTTP 基礎</h1>
  <p>這是第 42 篇文章的內容。</p>
  <a href="/articles/57" rel="next">閱讀下一篇</a>
</article>
```

這是本站自創內容；第 42 篇與第 57 篇的關係由本例服務決定，不從編號計算。
用戶端取得這份表示後，可以選擇回應所提供的「閱讀下一篇」連結，前往 `/articles/57`。
控制下一步的資訊來自目前表示，而非先把每一篇的下一個 URI 全部寫死在呼叫端。
這裡的應用狀態是閱讀流程所處的位置；不是要求伺服器不保存文章內容。

Fielding 將這種互動描述為：應用檢查目前表示提供的可選轉移，再選擇進入下一個狀態。
用戶端不必是瀏覽器，也可以是能理解相關語意的自動程式。
參考 [Fielding §5.3.3](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_3_3)。

這個片段只示範一種控制資訊，不能證明整個服務符合 REST。
同樣地，在 JSON 加一個名為 `links` 的欄位，如果用戶端根本不依其語意推進，
或其他必要約束未成立，也不足以完成 REST 的判斷。
超媒體是原定義中統一介面的一部分，不能省略後仍宣稱完整符合該定義。

## 為什麼選這組限制，也可能不選

統一互動能改善可見性，讓實作與服務分離並各自演進；
代價是標準化傳遞形式未必像專門替某個應用打造的介面一樣有效率。
Fielding 明確以 Web 常見的大粒度超媒體傳輸為最佳化方向，並不聲稱適合所有互動。
參考 [Fielding §5.1.5](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_1_5)。

實務溝通有時以「REST API」泛指採 HTTP 方法與資源 URI 的 API。
遇到這種稱呼，可以進一步確認實際契約與約束，區分產品慣用名稱和 Fielding 的架構定義。
HTTP API 沒有完整採用 REST，也不因此沒有使用價值；需要評估的是所選設計是否符合需求，
並清楚交代它提供哪些保證。名詞 URI、CRUD 或 JSON 都無法單獨完成這項評估。

## 相關文件

- [資源、表示與訊息](resources-representations-and-messages.md)：理解資源、URI、表示與媒體類型。
- [方法與操作語意](methods-and-operation-semantics.md)：確認 HTTP 方法的共同語意。
- [API 共通知識索引](README.md)：查看 REST、HTTP 與具體技術的內容邊界。
