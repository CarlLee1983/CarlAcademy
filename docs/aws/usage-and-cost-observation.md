# 用量與成本的基本觀察

雲端資源可以按需取得，但要理解帳單，不能只問「開了幾台機器」。
還要知道哪些項目被計量、以什麼單位計價，以及畫面上的數字涵蓋哪個期間與帳戶。
**用量是計量結果，成本是套用計價與帳務規則後的金額；兩者相關，卻不是同一件事。**
AWS 將成本與用量分析、預算管理等能力整理在 Cloud Financial Management 之下，見
[AWS：Cloud Financial Management](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/aws-cost-management.html)。

本文適合已理解[雲端運算與服務模式](cloud-computing-and-service-models.md)、想建立成本閱讀觀念的讀者。
重點是如何解讀數字；Cost Explorer、Budgets 的設定與資料口徑限制，另見
[Cost Explorer 與 Budgets](cost-explorer-and-budgets.md)。

查證日期：2026-11-02。本文僅查閱 AWS 官方文件，未登入 AWS 帳戶、查閱真實帳單、建立資源，
也未啟用成本功能或執行計費 API。假想表格是概念示例，不是真實帳單或費率，不提供費用估價或節省承諾。

## 從資源活動到帳單，中間有幾層

一個網站沒有訪客時，程式可能仍在執行，磁碟也仍保存資料。
因此，觀察應用忙不忙，與觀察 AWS 對哪些項目計費，需要分開。
以下是本文的閱讀分層；AWS 成本與用量報告則以 `UsageAmount`、`UnblendedRate`、`UnblendedCost`
等欄位分別記錄用量、費率及成本，見 [AWS：Line item details](https://docs.aws.amazon.com/cur/latest/userguide/Lineitem-columns.html)。

| 層次 | 要問的問題 | 概念例子 |
| --- | --- | --- |
| 資源與應用活動 | 資源在做什麼，工作負載多忙？ | CPU 使用率、網站請求、保存的資料 |
| 計費用量（billable usage） | 服務實際量測哪種項目，單位是什麼？ | 運算時間、儲存容量與期間、傳輸資料量、請求次數 |
| 價格與費率（price／rate） | 哪種配置與購買方式適用哪個單價？ | 某項用量的每單位費率 |
| 成本與帳務金額 | 用量費之外，是否還有折抵、承諾費用、稅等？ | 用量成本、預付費用、抵用金、最終帳單 |

對適用的用量明細，可以用「計費用量 × 對應費率」理解基本計算；官方的 `UnblendedCost` 欄位即採此關係。
但不能把它擴張成整張帳單只有這一條公式，因為帳務另有不同費用與調整類型。
見 [AWS：Line item details 的 UnblendedCost 與 LineItemType](https://docs.aws.amazon.com/cur/latest/userguide/Lineitem-columns.html)。
AWS 也提供按用量、固定方案及承諾用量等不同計價安排，不能把所有服務都理解成每次請求才產生成本。
見 [AWS Pricing](https://aws.amazon.com/pricing/)。

**不同單位的用量不能直接相加。**運算小時加上傳輸 GB，不會得到有意義的「總用量」。
AWS 的 Cost Explorer API 文件也明確提醒，彙總 `UsageQuantity` 時不會自動處理單位差異；
應按用量類型或相容的用量群組解讀。見
[AWS：GetCostAndUsage 的 Metrics 說明](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html)。
這裡引用 API 文件說明資料語意，本文沒有呼叫 API。

## 估算、當期累計與已結算，回答不同問題

「這個月多少錢」可能是在問尚未使用的方案，或已發生但仍在更新的費用。
比較數字前，先辨認它的狀態。

| 數字的狀態 | 表示什麼 | 閱讀時的邊界 |
| --- | --- | --- |
| 使用前估算 | 依預期配置、用量等假設計算 | 假設沒涵蓋的項目，不會自動變成估算的一部分 |
| 當期累計估計值 | 當月截至目前已進入帳務資料的用量與費用 | 月份尚未結束，資料也可能尚未全部到齊 |
| 預測（forecast） | 根據既有資料推估未來費用 | 不是已發生用量，也不是保證的月底金額 |
| 已結算帳單／發票 | 帳務期間關閉後產生的正式帳務文件 | 應連同期間、發票與後續調整理解，不能用不同口徑的分析圖直接代替 |

使用前估算可由 AWS Pricing Calculator 建立，但結果只涵蓋輸入的資訊，且不含可能適用的稅，見
[AWS：What is AWS Pricing Calculator?](https://docs.aws.amazon.com/pricing-calculator/latest/userguide/what-is-pricing-calculator.html)。
AWS Bills 文件區分未關閉期間的 `Pending` 估計費用與已開立的 `Issued` 帳單；當月摘要在活動關閉、最終費用計算前還不是發票。
見 [AWS：Understanding your bill](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/getting-viewing-bill.html)。
預測則依歷史成本推估，見 [AWS：Choosing advanced options](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-advanced.html)。

當期累計也不是即時計價儀表。Cost Explorer 的更新取決於上游帳務資料，部分資料可能晚於其一般更新週期才出現，見
[AWS：Analyzing your costs and usage with AWS Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)。
因此，「剛停止資源，圖表卻還在增加」不能單憑畫面判定停止失敗；可能是先前用量晚到，也可能是其他計費項目仍存在。
這是由資料延遲與資源分別計費所推得的查核方向，不是真實帳戶診斷。

## 先固定觀察範圍，再比較變化

只說「成本增加」還不夠完整。以下是閱讀或分享成本數字時，本文建議一併記錄的條件。

- **期間與時區**：完整月份、月初至今，還是某幾天？Cost Explorer 以 UTC 定義日期；台灣當地的一天與 UTC 的一天邊界不同。
  月初至今不宜直接與上個完整月比較。官方的日期定義見
  [AWS：Modifying your chart](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-modify.html)。
- **帳戶範圍**：單一帳戶、某個 linked account，還是組織的合併費用？管理帳戶與成員帳戶可見範圍不同。
  見 [AWS：Understanding your bill 的 Charges by account](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/getting-viewing-bill.html)。
  帳戶與身分的區別可回讀[帳戶、身分與權限](accounts-identities-and-access.md)；不能把 linked account 當作某位 IAM 使用者。
- **幣別與帳務狀態**：確認圖表單位、帳單幣別，以及數字是否仍是估計值；Bills 可同時顯示 USD 與另一發票幣別。
  見 [AWS：Understanding your bill 的 AWS bill summary](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/getting-viewing-bill.html)。
- **包含哪些費用**：是否含稅、退款、抵用金與折扣？成本工具可使用不同包含條件與成本指標。
  見 [AWS：Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)。

範圍一致後，才用維度追問「哪一部分改變」。Cost Explorer 支援服務、Region、用量類型、linked account 與 tag 等維度，
見 [AWS：Filtering the data that you want to view](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-filtering.html)。

| 觀察維度 | 能幫助回答的問題 |
| --- | --- |
| Service | 成本主要出現在哪個服務分類？ |
| Region | 是否集中在某個部署區域？ |
| Usage type | 變化來自運算時間、儲存、傳輸，還是其他計量項目？ |
| Linked account | 哪個成員帳戶產生這部分費用？ |
| 成本分配標籤（cost allocation tag） | 按專案、環境等自訂分類看時，費用如何分布？ |

這些是切分同一批資料的角度，不能把不同角度的合計再次相加。
例如某個專案的儲存費已包含在服務合計內，再加一次就會重複計算；這是基本的資料彙總原則。

標籤也不是天然完整的成本歸屬：成本分配標籤須啟用才能用於相應成本報告，並且仍可能存在未標記成本。
所以某個 tag 篩選結果不能直接當作整個帳戶的所有費用。見
[AWS：Organizing and tracking costs using AWS cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html)。

## 一個假想網站，如何拆看費用

以下是**本站自訂的點數模型，不是 AWS 費率、真實計量單位或帳單**。
為了只說明計算，假設每種單位固定費率，沒有折扣、稅、分級或最低計費條件。

| 假想項目 | 用量 | 自訂費率 | 點數成本 |
| --- | --- | --- | --- |
| 執行網站程式 | 10 個運算單位 | 每單位 3 點 | 30 點 |
| 保留網站資料 | 20 個儲存期間單位 | 每單位 2 點 | 40 點 |
| 傳送網站內容 | 5 個傳輸單位 | 每單位 4 點 | 20 點 |
| 合計 | 不相加不同用量單位 | — | 90 點 |

假設下一段同長期間停止程式執行，運算與傳輸用量都變為零，但資料仍保留相同期間，
這個模型仍有 40 點儲存成本。重點不是這個數字，而是停止一類活動沒有消除另一類用量。

真實 AWS 也需要分別看資源生命週期：停止 EC2 instance 後仍可能有儲存費用；
終止 instance 是否刪除 EBS volume 取決於設定，而刪除 volume 也不會自動刪除既有 snapshot。
S3 等其他儲存服務也有自己的費用。見
[AWS：Understanding unexpected charges 的 EC2、EBS volumes and snapshots 與 storage services](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/checklistforunwantedcharges.html)。
資源如何組合與保留資料，另見 [EC2 與資料儲存](ec2-and-data-storage.md)。本文不提供刪除資源的操作步驟。

## 成本下降，不一定代表用量下降

抵用金（credits）、退款（refunds）與折扣可能改變成本數字，而應用活動未必改變。
AWS 會把 credit、refund 等區分為不同 charge type，見
[AWS：Filtering the data that you want to view 的 Charge type](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-filtering.html)。
所以看到淨額下降時，應先確認調整項目，再判斷是否真的少用了資源。

另外，**unblended cost 與 amortized cost 是不同分析口徑**。
前者保留用量費用及相關明細的呈現；後者把適用的預付、定期承諾費用攤提到對應期間，便於觀察有效成本。
同一份資料因此可能呈現不同的每日曲線，攤提不表示 AWS 改成每天收取那筆款項。
見 [AWS：Choosing advanced options](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-advanced.html)。
此處只建立辨識觀念；實際指標、折扣與包含條件的差異，回讀[Cost Explorer 與 Budgets](cost-explorer-and-budgets.md)。

「免費」也要看適用範圍，不能把服務提供免費額度理解成整個帳戶保證零帳單。
AWS Free Tier 依帳戶方案、服務、額度與抵用金適用條件而異；付費方案在抵用金不足或不適用時可能產生費用。
見 [AWS：Explore AWS services with AWS Free Tier](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html)。
本文不以舊有的單一免費期限規則概括所有帳戶。

## 分析與通知，各自補上哪一塊

**Cost Explorer 用來分析成本與用量的變化；Budgets 用來追蹤目標與門檻通知。**
前者幫助追問「哪個服務或哪段期間改變」，後者可在已發生或預測費用達到設定條件時提醒。
這是功能分工，不是要求讀者現在啟用工具。見
[AWS：Cloud Financial Management 的 Cost Explorer 與 Budgets](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/aws-cost-management.html)。

預算門檻不是即時斷電總開關。AWS 明確提醒，用量發生、帳務入帳與通知之間存在延遲，
通知前可能已超過門檻，通知後成本也可能繼續變動。Budgets 雖支援另行設定的動作，
不能由「建立預算」推定已設定停止所有資源或所有費用的措施。
見 [AWS：Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)。
相關設定邊界與動作限制，由[工具專文](cost-explorer-and-budgets.md)說明。

讀一張成本圖時，可以依序確認：這是估計、預測還是已結算數字？期間與帳戶範圍是否一致？
單位與費用口徑是什麼？最後才把變化拆到服務、區域與用量類型，對照資源實際活動。
這個閱讀順序是本站依前述文件整理的方法，不是已對真實帳戶驗證過的查帳流程。

## 相關文件

- [AWS 知識索引](README.md)：回查整體閱讀入口。
- [雲端運算與服務模式](cloud-computing-and-service-models.md)：理解按需取得資源與管理邊界。
- [帳戶、身分與權限](accounts-identities-and-access.md)：分辨帳戶範圍與存取身分。
- [Cost Explorer 與 Budgets](cost-explorer-and-budgets.md)：延伸理解工具、設定與資料口徑限制。
- [EC2 與資料儲存](ec2-and-data-storage.md)：理解停止運算與保留資料的不同生命週期。
