# 快取與條件請求

再次讀取文章時，不一定要重新傳送整篇內容。HTTP 快取可以重用已儲存的回應；
需要確認能否繼續使用時，則可以透過條件請求比對表示的驗證器。
相同的條件請求機制，也能在寫入時表達「只有版本仍符合預期，才執行更新」。

本文接續[〈資源、表示與訊息〉](resources-representations-and-messages.md)與
[〈方法與操作語意〉](methods-and-operation-semantics.md)，聚焦快取控制、驗證器與更新條件。

查證日期：2026-11-02。依據固定版本 RFC 9111 與 RFC 9110（皆為 2022 年 6 月）。
本文只查閱文件，未執行服務或發送範例請求；文章服務、標籤及操作步驟均為自創教學情境。
所有訊息區塊都是欄位或訊息節錄，省略部分標頭與內容，不能視為完整線路訊息。

## 先分清楚儲存與重用

HTTP **快取（cache）**包含回應的本地儲存，以及控制儲存、讀取與刪除的機制。
它重用先前回應來滿足後續請求，目的是減少延遲與傳輸量。
「可以儲存」與「這次可以直接重用」是不同判斷，不能只因找到同一個 URI 就回傳舊資料。
參考 [RFC 9111 §1](https://www.rfc-editor.org/rfc/rfc9111.html#section-1)、
[§3](https://www.rfc-editor.org/rfc/rfc9111.html#section-3)與[§4](https://www.rfc-editor.org/rfc/rfc9111.html#section-4)。

| 類型 | 服務對象 | 常見位置 |
| --- | --- | --- |
| 私有快取（private cache） | 單一使用者 | 瀏覽器等使用者代理的一部分 |
| 共用快取（shared cache） | 多位使用者 | 中介代理、CDN 等；具體服務仍有自己的設定 |

分類取決於回應供誰重用，不是只看機器位於用戶端還是伺服器端。
共用快取尤其需要避免把甲的個人回應提供給乙；快取政策必須符合資料與存取控制需求。
兩類快取的定義見 [RFC 9111 §1](https://www.rfc-editor.org/rfc/rfc9111.html#section-1)。

## 新鮮度與重新驗證回答不同問題

**新鮮度（freshness）**決定已存回應能否在不詢問來源伺服器的情況下重用。
**重新驗證（validation／revalidation）**則透過請求，確認已存回應是否仍適用於目前這次讀取。
一份回應變成過期（stale），不代表內容一定已改變；仍新鮮（fresh），也不是伺服器保證其狀態完全沒改變。
這是快取重用政策與當下狀態的區別。
參考 [RFC 9111 §4.2](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2)與[§4.3](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.3)。

例如回應給出 `Cache-Control: max-age=60`，代表以 60 秒作為明確的新鮮期限。
判斷時看回應目前的年齡（age），不能一律從「這個用戶端剛收到它」再起算完整 60 秒。
`Date`、沿途快取提供的 `Age` 與停留時間等會參與計算；`Expires` 也能提供明確到期時間，
但已有 `max-age` 時，新鮮期限的選擇以它優先於 `Expires`；共用快取另可能受 `s-maxage` 控制。
本文不展開完整年齡算法。
參考 [RFC 9111 §4.2.1](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2.1)、
[§4.2.3](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2.3)與[§5.1](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.1)。

沒有明確到期資訊也不等於完全不能快取：在規範允許的情況下，可以採用啟發式新鮮期限。
過期回應也不必立刻刪除；可能重新驗證後使用，或在規則明確允許時提供過期回應。
不能把離線時可用舊資料當成所有快取的預設保證。
參考 [RFC 9111 §4.2.2](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2.2)與[§4.2.4](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2.4)。

## Cache-Control 的幾個常見回應指令

以下討論的是**回應標頭**中的指令；`no-cache` 與 `private` 採不帶欄位名稱參數的形式。
指令可以組合，但仍須遵守其他儲存與重用限制，不能把任一指令當成全部政策。

| 指令 | 主要意義 | 容易誤讀的地方 |
| --- | --- | --- |
| `max-age=60` | 指定新鮮期限為 60 秒 | 不保證內容 60 秒內不會改變，也不保證快取一定保留它 |
| `no-cache` | 可儲存，但用於後續請求前必須成功驗證 | 不是禁止儲存；即使仍在新鮮期限內也受此限制 |
| `no-store` | 禁止儲存這次請求與回應，也不得拿這份回應滿足其他請求 | 不是遠端清除所有既有副本的命令 |
| `private` | 共用快取不得儲存；私有快取仍可能依規則儲存 | 不提供加密，也不是授權檢查 |
| `public` | 明確允許快取，包含部分原本受限制的情況 | 不是公開存取權限宣告，也不是要求每個快取一定儲存 |

各指令見 [RFC 9111 §5.2.2.1](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.1)、
[§5.2.2.4](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.4)、
[§5.2.2.5](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.5)、
[§5.2.2.7](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.7)與[§5.2.2.9](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.9)。

`no-store` 約束遵循協定的快取，不能保證資料已從所有地方抹除，也不能單獨確保隱私。
例如請求端送出 `no-store`，若以既有快取滿足該請求，這個指令不會套用到那份已存回應。
參考 [RFC 9111 §5.2.1.5](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.1.5)與[§5.2.2.5](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.5)。

含 `Authorization` 的請求另有共用快取限制；某些明確回應指令可以允許重用，仍須符合其條件。
因此不能推論「有認證就一律不能快取」，也不能推論「加上 public 就適合共用個人資料」。
參考 [RFC 9111 §3.5](https://www.rfc-editor.org/rfc/rfc9111.html#section-3.5)。

## 驗證器：用標籤或時間描述表示的版本

**驗證器（validator）**是用於觀察資源狀態與判斷條件的中繼資料，常見的是 `ETag` 與 `Last-Modified`。
`ETag` 的值是對呼叫端不透明的標籤，例如 `"article-42-v7"`；呼叫端不應自行拆解它來推算版本順序。
來源伺服器可用修訂編號、雜湊或其他機制產生標籤，ETag 本身並不等同內容雜湊，
也不會自動證明內容符合業務規則或沒有程式錯誤。
參考 [RFC 9110 §8.8](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8)與[§8.8.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.1)。

| 形式 | 保證與用途 |
| --- | --- |
| 強 ETag：`"article-42-v7"` | 表示資料有可觀察的改變時，標籤必須改變；可用於需要精確一致的條件 |
| 弱 ETag：`W/"article-42-v7"` | 允許把不完全相同的資料視為可替代的表示；適合允許這種等價性的快取驗證 |

強比較要求兩個標籤都不是弱標籤，而且不透明值逐字相同；弱比較只要求不透明值相同。
例如 `W/"v7"` 與 `"v7"` 在弱比較時相符，在強比較時不相符。
弱標籤的 `W/` 不能由用戶端自行去掉，假裝取得更強的保證。
參考 [RFC 9110 §8.8.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1)與[§8.8.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2)。

`Last-Modified` 表達來源伺服器判定的表示修改時間，可搭配 `If-Modified-Since` 讀取條件。
時間精度有限，例如同一秒內可能修改兩次，所以它通常是弱驗證器，只有符合規範條件時才可視為強驗證器。
若同時有 `If-None-Match`，接收端須忽略 `If-Modified-Since`，不是把兩條件自行合併。
參考 [RFC 9110 §8.8.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2)、
[§8.8.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2)與[§13.1.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.3)。

## 用條件 GET 確認已存文章仍可使用

假設 `https://example.com/articles/42` 回傳文章表示，並附上以下回應欄位：

```http
Cache-Control: private, max-age=60
ETag: "article-42-v7"
```

私有快取依其他條件儲存這份回應。在新鮮期限內，若這次請求與已存回應匹配且沒有其他限制，可以直接重用。
之後需要重新驗證時，對同一 URI 送出以下 GET 節錄；本例假設選取的表示及其他讀取條件不變：

```http
GET /articles/42 HTTP/1.1
If-None-Match: "article-42-v7"
```

`If-None-Match` 使用弱比較。本例若選定表示仍與該標籤相符，來源伺服器回覆 `304 Not Modified`，
不再傳送文章內容；快取按規則識別對應的已存回應、更新標頭，再使用已存內容滿足讀取。
若表示已變成不相符的 `"article-42-v8"`，正常成功讀取則可回覆 `200 OK` 與新表示。
這不排除請求因其他原因失敗；條件請求不保證一定收到 200 或 304。
參考 [RFC 9110 §13.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2)、
[§15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5)與[RFC 9111 §4.3.3–§4.3.4](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.3.3)。

304 沒有內容，不是把文章清空；它需要與既有回應配合使用，不能當成一篇可獨立呈現的新文章。
同一 URI 也可能因表示選擇而不同，例如回應給出 `Vary: Accept-Language`，
快取選擇已存回應時，便須考慮原請求與新請求的 `Accept-Language` 是否匹配，不能只按 URI 混用不同語言。
參考 [RFC 9111 §4.1](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.1)；本文不展開快取鍵的完整設計。

## If-Match：在寫入前確認沒有覆蓋他人的更新

另假設一個允許管理文章的服務，支援以強 ETag 作為更新條件。
這與前面的唯讀情境分開；以下步驟是本例契約的推演，不是服務實測：

1. 甲、乙都讀到文章與強 ETag `"article-42-v7"`。
2. 甲以 PUT 提交新表示，附上 `If-Match: "article-42-v7"`；條件符合，服務完成更新，之後的表示標籤為 `"article-42-v8"`。
3. 乙仍以舊版本為基礎提交不同內容，也附上 `If-Match: "article-42-v7"`。
4. 服務評估條件時，強比較不相符，便不執行乙這次更新；本例回覆 `412 Precondition Failed`。
5. 乙重新讀取、處理差異後，才能決定是否基於新版本再次提交；不能只換標籤就無條件覆寫。

`If-Match` 使用強比較，目的是避免遺失更新（lost update）。弱 ETag 不能提供這裡需要的匹配。
條件為假時，不得執行該方法；通常可以用 412 表達失敗。
規範也允許在要求的狀態變更看來已完成時回覆 2xx，因此不能把「條件不符」寫成一律只會收到 412。
參考 [RFC 9110 §13.1.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1)。

服務必須在執行更新的邊界落實條件，不能讓檢查通過後的另一筆更新被悄悄覆蓋。
PUT 的冪等性討論重複請求的預期效果，不保證多人同時更新不會衝突；可回看[方法與操作語意](methods-and-operation-semantics.md)。
條件請求也不是權限檢查：來源伺服器應先完成正常請求檢查，再在執行操作前評估前置條件。
參考 [RFC 9110 §13.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.2.1)。

## 相關文件

- [資源、表示與訊息](resources-representations-and-messages.md)：回看表示、標頭與內容的差別。
- [方法與操作語意](methods-and-operation-semantics.md)：區分冪等、重試與多人更新衝突。
- [相容性與演進](compatibility-and-evolution.md)：快取政策若是公開承諾，也須評估改變對使用者的影響。
- [HTTP API 契約與 OpenAPI](http-api-contracts-and-openapi.md)：將 HTTP 操作與回應整理成可讀的介面描述。
- [API 共通知識索引](README.md)：查看 HTTP 分支與相關概念。
