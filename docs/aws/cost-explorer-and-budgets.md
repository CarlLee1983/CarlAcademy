# Cost Explorer 與 Budgets

**Cost Explorer 用來找出成本與用量在哪裡改變；AWS Budgets 用來持續追蹤目標，並在符合條件時通知或執行另行設定的動作。**
前者回答分析問題，後者把關心的範圍變成監控條件。AWS 的定位分別見
[Cost Explorer 概覽](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)與
[Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)。

本文適合已讀過[用量與成本的基本觀察](usage-and-cost-observation.md)的讀者。
該篇負責用量、費率、當期估計、預測與已結算帳單的基本區分；本文補上工具的分析方式、存取範圍與通知限制。

查證日期：2026-11-02。本文僅查閱 AWS 官方文件，未登入 AWS 帳戶、查閱真實帳單、啟用成本服務，
也未建立 budget、SNS topic、角色或呼叫計費 API。下文是概念與假想調查，不是實際設定步驟或驗帳結果；不提供價格估算或方案購買建議。

## Cost Explorer：縮小問題的範圍

分析一張圖時，可以把控制條件分成三件事。這是本站依官方圖表與篩選功能整理的閱讀方法：

- **範圍（scope）**：決定這次比較的帳戶、期間、粒度與成本指標。先固定它們，才有可比較的總額。
- **篩選（filter）**：只留下某個子集合，例如某個 linked account 中的一項服務。
- **分組（group by）**：把留下的資料按選定維度拆開，例如按 Region 看各區域的貢獻。

官方功能見 [Modifying your chart](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-modify.html)與
[Filtering the data that you want to view](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-filtering.html)。
例如，篩選某個服務後再按 Region 分組，圖中各組都是該服務的區域成本，不是每個區域的全部服務成本。
一般包含式篩選中，同一維度選多個值採 OR，不同維度之間採 AND；「服務 A 或 B，且位於區域 C」就是取交集。
這也是為什麼分享圖表時，不能只提供總額而省略條件。

常用維度包括 Service、Region、Linked account、Usage type、Charge type 與成本分配標籤。
完整維度表與未標記成本的閱讀原則見[用量與成本的基本觀察](usage-and-cost-observation.md)，此處不再列一份。
注意 **Charge type 是費用種類，Usage type 是計量項目**：
前者可幫助區分退款、抵用金、預付費用等；後者用來追問變動是哪種用量。
官方定義見 [Filter and group options](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-filtering.html)。

## 成本指標：同一批資料可以回答不同問題

Cost Explorer 的成本指標不是圖表外觀選項。下表依
[Choosing advanced options](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-advanced.html)整理：

| 指標 | 呈現重點 | 解讀時要保留的差異 |
| --- | --- | --- |
| Unblended cost | 用量成本；按 Charge type 分組時，折扣可呈現為獨立項目 | 不能把單一用量項目的數值直接當作已包含所有折扣的最終淨額 |
| Amortized cost | 將適用的預付與定期承諾費用攤到對應期間，呈現有效成本 | 平滑成本曲線不代表付款日期改變；未使用的承諾也可能留下成本 |
| Net unblended cost | 納入折扣後的 unblended 成本 | 與未採 net 的圖比較時，要先確認折扣與其他費用包含條件 |
| Net amortized cost | 在攤提基礎上納入適用折扣 | 同時改變費用分配時間與折扣口徑，不能與 unblended 的每日尖峰逐點等同 |
| Blended cost | 合併帳務家庭內的平均成本口徑 | 與個別帳戶的 unblended 成本不同，不宜把平均費率視為每筆用量各自適用的費率 |

Savings Plans 也顯示這些差異：官方說明，`Savings Plan covered usage` 在 unblended 檢視採隨需成本，
在 amortized 檢視則採 Savings Plans 成本；covered usage 另有對應的 negation 項目抵銷。
因此只看某一種 charge type，可能漏掉應一起理解的費用項目。
見 [Charge type](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-filtering.html)。

分析結果轉成 budget 時，應記錄成本指標以及稅、抵用金、退款、支援費等包含條件。
Budgets 支援多種上述成本指標，也可包含或排除特定費用；**兩個工具都出現「成本」，不代表它們目前比較的是同一個集合**。
見 [Budgets 的成本口徑](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)。
這裡的 net 是產品分析指標，不是「一定等於發票應付額」的保證；正式帳務狀態仍須回到
[用量與成本的基本觀察](usage-and-cost-observation.md)的區分。

## 歷史、預測與粒度：詳細不等於即時

Cost Explorer 預設提供當月及先前最多 13 個月的日、月粒度資料；另有可選的多年資料與細粒度資料。
細粒度功能區分每日資源層級資料、全服務每小時資料，以及 EC2 instance 的每小時資源層級資料，
不是每種服務都天然具備相同的逐資源明細。見
[Exploring more data for advanced cost analysis](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-advanced-cost-analysis.html)與
[Granular data](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-granular-data.html)。

歷史圖呈現已進入成本資料的活動；forecast 則根據過去資料推估未來，可能與實際費用不同。
資料不足時可能沒有預測，尤其尚無完整帳務週期的帳戶；組織加入新成員後，預測也需要時間分析新的支出模式。
見 [Forecasting with Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-forecast.html)。
此外，官方圖表文件指出，分組圖不提供 forecasting；想看整體預測時，須理解與分組歷史分析不同的檢視條件。
見 [Grouping data by filter type](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-modify.html)。

首次啟用後，當月資料約需 24 小時，其他歷史資料可能再多等幾天。
後續成本資料至少每 24 小時更新一次，但上游帳務資料可能晚到，部分更新會超過這段時間。
**每小時粒度是資料分桶方式，不是每小時保證完成入帳，更不是即時花費串流。**
前述等待與更新規則見 [Cost Explorer 概覽](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)。

一般 Cost Explorer 使用者介面可免費檢視，但 API 要求及選用的每小時粒度有另外的計費條件；
不能把「可免費看圖」理解成所有資料選項與自動查詢都免費。
本文不列費率，當次條件以 [Cost Explorer Pricing](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/)為準。

## 帳戶可見範圍與啟用，也是一道邊界

一般 AWS Organizations 合併帳務情境中，管理帳戶可見管理帳戶與成員帳戶的成本資料，
成員帳戶只能看自己的 Cost Explorer 資料。管理帳戶的偏好設定可控制全體成員帳戶的存取，
帳戶內的個別使用者另需相應 IAM 權限。
若採用 Billing Conductor，成員檢視還可能是 pro forma 成本，須按 billing group 配置判讀。
見 [Controlling access to Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-access.html)。
這裡的 linked account 是成員帳戶，不是 IAM user；身分與授權的共通背景見
[帳戶、身分與權限](accounts-identities-and-access.md)與 [IAM 的身分與權限](iam-identities-and-permissions.md)。

啟用 Cost Explorer 會啟動資料準備；官方也說明，啟用流程會自動配置 Cost Anomaly Detection 的服務監控與每日摘要通知，
該異常偵測另可退出。啟用不是單純讀取一個既有靜態檔案，而且 Cost Explorer 啟用後不能停用。
見 [Enabling Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-enable.html)與
[Cost Explorer 概覽](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)。
本文沒有進入啟用流程。

## Budgets：把關心的事情寫成可追蹤條件

Budgets 的「預算」不只代表金額。其類型分別追蹤以下目標，見
[Customizing a budget](https://docs.aws.amazon.com/cost-management/latest/userguide/custom-budgets.html)：

| 類型 | 追蹤的目標 |
| --- | --- |
| Cost budget | 某個範圍的成本相對於目標金額 |
| Usage budget | 選定用量類型或用量群組相對於目標用量；須使用相容的計量單位 |
| RI／Savings Plans utilization | 已有承諾的利用率是否低於目標 |
| RI／Savings Plans coverage | 合適用量被承諾方案涵蓋的比例是否低於目標 |

利用率與涵蓋率不等於支出額，也不是看到通知就應購買方案的建議。
各類型的通知方向與定義見 [Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)；
用量群組須具有相同計量單位，見 [Creating a usage budget](https://docs.aws.amazon.com/cost-management/latest/userguide/create-usage-budget.html)。

以 cost budget 為例，一個完整的監控定義至少要交代：

- **期間與目標**：日、月、季、年或自訂期間，是否週期重設，以及目標金額。金額可固定、按期規劃或依歷史模式自動調整；預算時間採 UTC。
- **資料範圍**：監控哪些帳戶、服務與其他篩選條件，並採用哪種成本指標與費用包含條件。
- **門檻的依據**：Actual 針對已累計成本；Forecasted 針對預測成本。門檻可用絕對金額或目標金額的百分比表達。
- **接收與處置**：通知誰、透過什麼通道，是否另配置動作。

期間、金額方法與門檻的官方欄位見 [Creating a cost budget](https://docs.aws.amazon.com/cost-management/latest/userguide/create-cost-budget.html)。
例如「當月實際成本超過目標的 80%」與「預測當月成本超過目標的 100%」是兩個不同條件；
百分比只是這裡的假想監控設計，不是 AWS 建議的通用門檻。

## 通知送給誰，不能只看有沒有填地址

Budgets 可直接寄送 email，或送往 Amazon SNS topic。依查證當日的
[Adding email recipients to a budget notification](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-email-recipients.html)，
每個通知最多可有 10 個直接 email 收件者；新增地址須透過 AWS User Notifications 驗證才會收信。
驗證按「地址與 AWS 帳戶」計算，同帳戶已驗證的地址可沿用；既有 legacy 收件者另有相容安排。
因此，不能把「已填寫 email」直接當作「通知已可送達」。本文沒有寄送驗證信。

SNS 是另一條通知路徑：topic 必須與 budget 在同一帳戶，而且 topic 的資源政策須允許 Budgets 發布。
使用需要確認的訂閱端點時，還要完成 SNS 訂閱確認；若 topic 使用 KMS 加密，另需相應 key 權限。
直接 email 驗證與 SNS 訂閱確認是不同流程。
見 [Creating an Amazon SNS topic for budget notifications](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html)。

Budget 本身的可見性也有帳戶邊界：管理帳戶建立一個追蹤成員成本的 budget，不代表該成員自動看得到此 budget。
Budget 的存取權與其追蹤資料範圍要分開管理；若進一步使用共享 billing view，也有額外資料與 budget 權限要求。
見 [Budgets 的存取說明](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)與
[Creating a budget 的 Billing view prerequisites](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-create.html)。

## 動作必須另外配置，預算不是硬性支出上限

Budgets 資訊每日最多更新三次，通常距前次更新約 8–12 小時；資源使用到帳務入帳還有上游延遲。
因此通知前就可能已超過門檻，通知後成本也可能繼續變動。
見 [Budgets 的更新與延遲說明](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)。

Cost 或 usage budget 可另附動作，例如套用 IAM policy、SCP，或停止指定的 EC2／RDS instance；
動作可自動執行或等待人工核准，且需要授權給 Budgets 的 service role。
配置不完整時，不能假設服務可以代為執行。
見 [Configuring a budget action](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html)與
[Setting up a role for AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-role.html)。

這些動作有目標限制：只有管理帳戶能套用 SCP；管理帳戶可對另一帳戶套用 SCP，卻不能藉該 budget 動作停止另一帳戶的 EC2／RDS instance。
見 [Configuring budget actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html)。
限制新建資源不會消除既有資源的所有費用；停止某台運算資源也不表示儲存等費用歸零。
後者的生命週期差異見[用量與成本的基本觀察](usage-and-cost-observation.md)。
所以，**單純建立 budget 不會自動停止資源，也不構成即時硬性支出上限**。

## 假想調查：成本變高之後，如何接到監控

以下是本站依上述功能設計的假想推演，沒有真實金額、帳單或操作輸出，也不要求讀者現在建立任何設定。

| 問題進展 | 分析或設計 | 可以得到的結論與保留條件 |
| --- | --- | --- |
| 團隊認為本期成本變高 | 固定相同長度期間、UTC 日期、帳戶範圍與成本指標，再比較歷史資料 | 先排除比較條件不同；尚未證明是哪個資源造成 |
| 想知道增加集中在哪裡 | 在 Cost Explorer 按 Service 分組，再篩選增加較明顯的服務 | 找到值得追查的服務子集合，不能把此子集合視為全部成本 |
| 該服務跨多個帳戶與區域 | 在可見權限內依 linked account、Region 縮小範圍，再按 Usage type 與 Charge type 看 | 區分用量變化與預付、折扣等費用變化；必要時分次分析不同維度 |
| 發現儲存項目增加 | 對照同口徑用量與成本，提出「保留資料增加」的待查假設 | 成本資料指出方向；須再由資源狀態與操作紀錄驗證，不能單靠成本曲線歸因 |
| 希望之後及早收到提醒 | 設計同範圍、同成本口徑的月 cost budget，分別定義 Actual 與 Forecasted 門檻及收件者 | 監控的是選定範圍與條件；未包含的服務或帳戶仍可能另外產生成本 |
| 要決定收到通知後做什麼 | 約定由有權限的人檢查變動；若考慮動作，另評估目標、角色與人工核准 | 通知是調查入口；動作也只作用於明確配置的邊界，不保證總費用封頂 |

資源運作與 API 活動的查證可銜接 [CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)。
成本圖、運作指標與操作紀錄回答不同問題；把它們串起來，才有機會驗證上述假設。

## 相關文件

- [AWS 知識索引](README.md)：回查服務與概念入口。
- [用量與成本的基本觀察](usage-and-cost-observation.md)：回查用量、成本與帳務狀態的共同概念。
- [帳戶、身分與權限](accounts-identities-and-access.md)：理解管理帳戶、成員帳戶與登入身分。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：理解存取、角色與政策的授權邊界。
- [CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)：將成本調查接到運作觀察與操作追查。
