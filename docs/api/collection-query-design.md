# 集合查詢設計

「列出文章」看似只要回傳陣列，實際還有幾個契約問題：哪些文章會進入結果、按什麼順序排列、
一次回傳多少，以及兩次請求之間資料改變時，讀者究竟能取得什麼。
只列出 `filter`、`sort`、`page` 幾個參數名稱，無法回答這些問題。

本文接續[介面、契約與責任](interface-contract-responsibility.md)及
[輸入、輸出與失敗語意](input-output-failure-semantics.md)，以假想文章集合說明查詢與分頁的選擇。
HTTP 的 URI 與表示可先讀[資源、表示與訊息](resources-representations-and-messages.md)。

查證日期：2026-11-02。參考當日的 Google AIP-132、AIP-158、AIP-160（持續更新的設計指南），
以及固定主版本 PostgreSQL 18 官方文件。本文只查閱文件，未執行查詢、服務或 HTTP 請求。
例子為本站自創，不宣稱遵循 Google AIP 的全部規則，也不是通用查詢參數標準。

## 先定義要查哪一個集合

集合查詢不只是儲存資料的入口，也要界定使用者可看見的範圍。
例如「某個作者的文章」「全站已發布文章」「管理員可見的草稿」是不同的查詢能力。
先說清楚集合邊界，再決定是否需要篩選、排序與分頁。
Google 的 List 設計模式可作為具體參考，但不是所有 API 必須使用的介面：
見 [AIP-132：Guidance](https://google.aip.dev/132#guidance)。

| 契約面向 | 需要回答的問題 |
| --- | --- |
| 篩選（filtering） | 哪些項目符合條件；沒有提供條件時選哪些？ |
| 排序（ordering／sorting） | 欄位順序、方向、同值時的先後與預設順序是什麼？ |
| 分頁（pagination） | 每次最多取多少、如何接續、何時才算走到結尾？ |
| 一致性 | 不同頁看到同一時間點的集合，還是各次請求當下的集合？ |
| 失敗與限制 | 不支援的條件、無效 token、過大頁面如何處理？ |

HTTP query 只是承載輸入的一種方式，不會替這些參數決定語意。
即使都使用 `filter`，兩個 API 的語法、型別轉換與比對規則仍可能不同。
AIP-160 就另外定義了自己的篩選語法、限制與驗證方式，不能直接套用到未採用它的服務。
參考 [AIP-160：Guidance](https://google.aip.dev/160#guidance)、[Limitations](https://google.aip.dev/160#limitations)與[Validation](https://google.aip.dev/160#validation)。

## 篩選條件要連同比對規則說明

文件除了列出可篩選的欄位，也應交代允許的運算子、組合與優先順序。
文字相等是否區分大小寫、是否依語系處理字母、缺值與 `null` 是否相同，都不能由參數名稱推定。
排序也要說清楚字串按什麼規則比較，時間按時間點還是文字比較，以及空值放在何處。
AIP-132 的排序指南便要求在不採欄位自然比較方式時記錄差異；
AIP-160 則有特定的缺值與型別規則。這些是各自契約的選擇。
參考 [AIP-132：Ordering](https://google.aip.dev/132#ordering)與[AIP-160：Comparison Operators](https://google.aip.dev/160#comparison-operators)、[Traversal operator](https://google.aip.dev/160#traversal-operator)。

本例只查詢已發布文章，不提供任意條件語言，採以下**自訂契約**：

| 項目 | 本例規則 |
| --- | --- |
| 集合 | `https://example.com/articles` 中，目前呼叫者有權讀取的已發布文章摘要 |
| 篩選 | 省略 `filter` 或提供精確字串 `status=published`；其餘值均回報輸入無效，不自動轉小寫或移除空白 |
| 排序 | 省略 `sort` 或提供 `published_at:desc,id:desc`；其餘值均回報輸入無效 |
| 排序型別 | `published_at` 是非空時間點，依時間先後比較；同時間以非空、唯一且不變的正整數 `id` 數值降冪排列 |
| 頁面大小 | `page_size` 省略時為 20；提供時必須是 1–100 的十進位整數；超限或無效即拒絕 |
| 輸出 | 本頁摘要陣列 `items`，以及可能存在的 `next_page_token`；本例不回傳總數 |
| 接續 | token 表達向後接續的位置；每頁依該次讀取時的資料與權限決定結果，不提供跨頁快照 |

這個範例刻意只支援少數輸入，避免讓「有 filter」被誤解成能搜尋任何欄位。
頁面大小超限的拒絕規則也是本站例子的選擇；Google AIP-158 則建議將超大值縮至上限，兩者不同。
參考 [AIP-158：Guidance](https://google.aip.dev/158#guidance)。

## 排序確定，不代表跨頁資料不變

只按發布時間降冪，若兩篇文章時間相同，它們的先後仍沒有被完整定義。
本例再加入唯一的 `id` 作為同值排序依據（tie-breaker），讓同一份資料有確定的完整順序。
PostgreSQL 18 官方文件也提醒，LIMIT/OFFSET 若沒有約束成唯一順序，就可能取得不可預測的子集合。
這是資料庫實例，不表示每個 API 都直接使用 SQL。
參考 [PostgreSQL 18：LIMIT and OFFSET](https://www.postgresql.org/docs/18/queries-limit.html)。

然而，兩次請求若看到不同資料，排序再確定也無法讓它們自動變成同一份快照。
新增、刪除、改變排序欄位、改變篩選條件是否成立，以及權限改變，都可能影響後續結果。
以下用自創資料推演兩種接續方式；不涉及資料庫實作或效能實測。

### Offset：按位置跳過前面的項目

假設依完整排序得到 `[A, B, C, D]`，頁面大小為 2。
第一頁取 `[A, B]`，第二頁以 offset 2 跳過當時前兩筆：

| 第一頁後的變動 | 第二次讀取時的集合 | offset 2 的結果 | 問題 |
| --- | --- | --- | --- |
| 前方插入 X | `[X, A, B, C, D]` | `[B, C]` | B 重複出現 |
| 刪除 A | `[B, C, D]` | `[D]` | C 被跳過 |

這些是由位置位移推演出的結果，不是排序不穩造成的。
offset 也可能有較高的深頁成本；例如 PostgreSQL 必須計算被 OFFSET 跳過的列，大 offset 可能不夠有效率。
這是該資料庫的具體行為，不能直接斷定每個 offset API 都有相同成本。
參考 [PostgreSQL 18：LIMIT and OFFSET](https://www.postgresql.org/docs/18/queries-limit.html)。

### Keyset：從已知排序邊界繼續

本例選擇以最後一筆的排序位置作為接續邊界，概念上屬於 keyset pagination。
若上一頁最後一筆是 `(published_at = T, id = 42)`，下一頁取發布時間早於 T，
或時間等於 T 且 id 小於 42 的項目，再按同一規則排序。
這段說明是服務的概念契約，呼叫端只接收並原樣傳回 token，不自行組合或解析邊界。

依這個邊界推演，在前方新增一筆不會像 offset 那樣推移起點；但新增在邊界之前的文章也不會出現在後面的頁。
若某篇已讀文章的發布時間後來被移到邊界之後，它還可能再次出現；未讀文章移到前方則可能漏掉。
因此 keyset 解決的是位置接續方式，不能單獨保證在資料變動下「全程不重複、不遺漏」。
若產品需要固定時間點的完整匯出，還須另定快照、保留期限或其他一致性契約；本例沒有提供。

「cursor」常被用來稱呼接續位置或 token，但名稱沒有保證實作一定是 keyset。
不透明 token 也可能指向伺服器保存的查詢狀態；不能從它看不懂，就推論它包含快照或永遠有效。
AIP-158 要求 token 不透明，目的是避免讓內部細節變成呼叫端依賴的介面。
參考 [AIP-158：Opacity](https://google.aip.dev/158#opacity)。

## 頁面沒裝滿，也可能還沒走完

以下是第一頁的示意 URI；參數名稱、編碼後的值與規則都是本站例子，不是完整 HTTP 訊息：

```text
https://example.com/articles?filter=status%3Dpublished&sort=published_at%3Adesc%2Cid%3Adesc&page_size=2
```

假設回應內容是以下可獨立解析的 JSON；只示範內容，省略 HTTP 狀態與標頭：

```json
{
  "items": [
    {"id": 44, "published_at": "2026-11-02T00:00:00Z", "title": "HTTP"},
    {"id": 42, "published_at": "2026-11-02T00:00:00Z", "title": "API"}
  ],
  "next_page_token": "token-example-1"
}
```

下一次保留原查詢，增加 `page_token=token-example-1`，並依 URI 的編碼規則傳送。
本例 token 是教學佔位值，不能拿去呼叫服務，也不代表真實 token 的格式。
本例允許每頁少於要求數量，甚至暫時為空；**只有缺少 `next_page_token` 才表示此次分頁已到結尾**。
因此不能用「收到不到 2 筆」或「收到空陣列」取代接續訊號。
AIP-158 也允許未到結尾時回傳較少或零筆，並以接續 token 表達尚未結束。
參考 [AIP-158：Guidance](https://google.aip.dev/158#guidance)。

## Token 與總數都需要自己的契約

本例規定 token 自發出後有效 30 分鐘，只適用原呼叫者、原集合及原始的篩選與排序規則。
接續時維持原本的 `page_size`；不匹配、無效或過期時，回報可區分的查詢條件不符、token 無效或 token 過期，
不悄悄從第一頁開始。這些是本例選擇，不是 Google AIP 規定的統一政策；AIP-158 允許接續時改頁面大小。
呼叫端不應手工解析或修改 token，服務也必須在每次請求重新執行存取控制。
token 只協助接續，不授予讀取資源的權限；這點與 AIP-158 的要求一致。
參考 [AIP-158：Guidance](https://google.aip.dev/158#guidance)、[Opacity](https://google.aip.dev/158#opacity)與[Expiring page tokens](https://google.aip.dev/158#expiring-page-tokens)。

集合回應不必一定包含 `total`。若提供，須說明是篩選前還是篩選後、是否限於可見項目、
精確值或估算，以及對應哪個讀取時間點；否則呼叫端可能把估算總數當成完整讀取的檢查依據。
AIP-132 允許總數是估算，並要求在有篩選時反映篩選後集合；其他 API 仍須公布自己的定義。
即使某次總數精確，後續資料若會改變，也不能自動保證所有頁面加總仍等於它。
參考 [AIP-132：Response message](https://google.aip.dev/132#response-message)。

## 相關文件

- [介面、契約與責任](interface-contract-responsibility.md)：確認公開承諾與內部實作的邊界。
- [輸入、輸出與失敗語意](input-output-failure-semantics.md)：把查詢限制與失敗結果寫成可辨識的規則。
- [相容性與演進](compatibility-and-evolution.md)：評估改變預設排序、上限或原本不分頁的行為，是否影響既有用法。
- [API 共通知識索引](README.md)：查看其他共通議題與 HTTP 分支。
