# 雲端運算與服務模式

要讓一個網站運作，需要有地方執行程式、保存資料，並讓讀者透過網路連進來。
**雲端運算（cloud computing）讓我們透過網路，隨需求取得這些 IT 資源與服務。**
AWS 的入門定義以透過網際網路、按需取得運算能力、儲存與資料庫等服務，搭配按用量付費來說明它，
見 [AWS：What is cloud computing?](https://aws.amazon.com/what-is-cloud-computing/)。

但「使用雲端」還沒有說明由誰維護作業系統、誰更新網站程式。
理解 **IaaS、PaaS、SaaS**，就是理解服務交付到哪一層，以及使用者保留哪些控制與管理工作。
本文不要求先會寫程式或操作 AWS；重點是概念與責任分工，不提供服務選型或部署步驟。

查證日期：2026-11-02。依據 AWS 官方文件與 NIST SP 800-145；產品文件會持續更新。
本文僅做文件查證，未登入 AWS、建立資源，亦未執行 CLI、SDK 或產品操作測試。
下列網站情境是本站自訂的概念例子，不是實測結果。

## 雲端提供的資源，仍由實體設備支撐

「雲端」不是資料不需要電腦，也不是所有東西都只存在瀏覽器裡。
NIST 將雲端描述為：透過網路，按需存取可配置的共享資源池，資源能以較少管理工作或供應商人工介入快速取得與釋放。
資源包括網路、伺服器、儲存、應用與服務；其基礎同時包含實體硬體與建立在硬體上的抽象層。
見 [NIST SP 800-145，第 2 節與註 2](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf)。

以假想的文章網站為例，可以把需求拆成三件事：

| 資源 | 在這個例子中做什麼 |
| --- | --- |
| 運算（compute） | 執行網站程式，處理讀者的請求 |
| 儲存（storage） | 保存文章、圖片與其他資料 |
| 網路（networking） | 讓讀者連上網站，讓網站元件彼此通訊 |

這是理解需求的簡化方式，不是規定三者一定各用一項產品。
例如 EC2 提供可按需取得、可調整的運算容量；其中的 instance 是 AWS 雲端上的虛擬伺服器，
使用者可配置安全與網路並管理儲存。見 [Amazon EC2 導論](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)。
若不熟悉作業系統與程式的關係，可先讀[認識 Linux](../linux/what-is-linux.md)，不必在這裡重學一套作業系統概念。

## 差別不只是把伺服器搬到別人的機房

NIST 列出五項雲端的核心特徵。以下是依其定義整理的白話說明，不代表每項服務都沒有使用條件或限制。
來源為 [NIST SP 800-145：Essential Characteristics](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf)。

| 特徵 | 代表什麼 |
| --- | --- |
| 隨需自助（on-demand self-service） | 使用者可依需求取得能力，不必每次都由供應商人員人工處理 |
| 廣泛網路存取（broad network access） | 透過網路與標準機制存取，讓不同類型的用戶端使用 |
| 資源共享（resource pooling） | 供應商整合資源池，依需求動態分配給多個使用者 |
| 快速彈性（rapid elasticity） | 資源可快速擴增與縮減，部分情況可自動進行 |
| 可計量服務（measured service） | 資源使用可被計量、監控與報告，例如儲存量、處理量或活躍帳戶數 |

**共享資源池不等於使用者可以互看資料。**這個詞描述的是供應商如何調配底層資源，
不是授予其他客戶讀取資料的權限；資料與權限仍有管理邊界。
例如 AWS 在 S3 等抽象化服務上管理基礎設施與平台，客戶仍須管理自己的資料及適當權限。
見 [AWS 責任共擔模型](https://aws.amazon.com/compliance/shared-responsibility-model/)。

假想網站原本由團隊自行購買硬體、架設並維護機房設備，那麼擴充前通常要先處理採購與安裝。
改用雲端後，可向供應商取得所需容量，而不必為每一次擴充購買實體伺服器。
這個對照是為了凸顯資源取得方式；AWS 也以不必先擁有與維護實體資料中心、改為按需使用服務來說明雲端。
見 [AWS 雲端運算介紹](https://aws.amazon.com/what-is-cloud-computing/)。

彈性表示具備調整容量的能力，**不表示只要網站放上雲端，就已完成自動擴縮設定**。
NIST 的定義也只說部分情況能自動調整；EC2 官方則將協助維持所需 instance 數量的 Auto Scaling 列為相關服務。
見 [NIST 的快速彈性定義](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf)與
[EC2：Related services](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)。

## IaaS、PaaS、SaaS：你取得的是哪一層能力

三個名稱中的「as a Service」可以先理解為「以服務方式提供」。
依 NIST 的服務模式定義，差別在於使用者取得基礎設施、部署應用的平台，還是已由供應商運作的應用軟體。
下表是概念分層，不是任何產品的完整責任契約。
來源為 [NIST SP 800-145：Service Models](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf)。

| 工作層次 | IaaS：基礎設施即服務 | PaaS：平台即服務 | SaaS：軟體即服務 |
| --- | --- | --- | --- |
| 實體設備與底層雲端基礎設施 | 供應商管理 | 供應商管理 | 供應商管理 |
| 客體作業系統與程式執行平台 | 使用者管理作業系統與自行安裝的軟體 | 供應商提供並管理受支援的平台 | 供應商管理 |
| 應用程式 | 使用者部署與維護 | 使用者部署與維護 | 供應商提供並維護應用 |
| 使用者可控制的範圍 | 作業系統、部署的應用、儲存與部分網路設定 | 部署的應用與部分應用執行環境設定 | 服務允許的應用設定 |

**IaaS（Infrastructure as a Service）**提供基礎運算、儲存與網路能力。
使用者不管理供應商底層的實體設備，但仍管理自己的作業系統與應用。
例如 AWS 明確將 EC2 歸為 IaaS，並指出客戶須管理客體作業系統更新、修補與安裝的應用軟體。
見 [AWS：Customer responsibility](https://aws.amazon.com/compliance/shared-responsibility-model/)。

**PaaS（Platform as a Service）**提供能部署應用的平台。
使用者以供應商支援的語言、工具與服務部署程式，不必自行管理底層作業系統，
但仍控制自己的應用；平台支援範圍也是邊界的一部分。
見 [NIST 的 PaaS 定義](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf)。

**SaaS（Software as a Service）**提供可直接使用的應用。
例如網頁電子郵件：使用者寄信與收信，供應商維護郵件應用及其底層系統。
使用者不必先部署郵件程式，仍須在服務提供的範圍內管理自己的使用方式與設定。
見 [AWS：SaaS](https://aws.amazon.com/types-of-cloud-computing/)。

這些模式也不是由初級到高級的學習階梯。
從 IaaS 到 SaaS，交給供應商的工作增多，使用者可直接控制的技術層次也改變；
「自己能改作業系統」與「不用自己維護作業系統」分別代表不同的工作邊界。
這是根據上列分層的比較，不是本文對特定產品的選型建議。

## 同一個文章網站，三種分工方式

假設團隊要提供一個讓編輯登入、發布文章、上傳圖片的網站。
以下用同一個需求說明三種模式；SaaS 情境是假想的網站服務，不代表某個 AWS 產品具備這些功能。
分工依前述 NIST 模型簡化，實際產品仍須查自己的文件與契約。

| 團隊要處理的事 | 採用 IaaS | 採用 PaaS | 採用 SaaS |
| --- | --- | --- | --- |
| 讓網站執行 | 取得虛擬伺服器，安裝所需環境並部署網站 | 將自己的網站程式部署到平台支援的環境 | 使用供應商已提供的網站應用 |
| 作業系統與執行環境 | 團隊維護客體 OS、網站伺服器與自行安裝的 runtime | 平台管理底層，團隊配合支援範圍與版本政策 | 由供應商維護 |
| 新增編輯功能或修復程式錯誤 | 團隊修改與部署程式 | 團隊修改與部署程式 | 使用供應商提供的功能與更新 |
| 發布什麼內容、誰能編輯 | 團隊決定並實作／設定 | 團隊決定並實作／設定 | 團隊在服務允許的功能中設定 |
| 資料保留與復原需求 | 團隊規劃並建立相應機制 | 團隊確認平台與外部資料服務能否滿足需求 | 團隊確認供應商提供的保留、匯出與復原能力 |

例如編輯不小心刪除一張圖片，問題不會只剩下「這個網站是不是 SaaS」。
還要知道服務是否保留舊資料、能復原到哪個時間點，以及團隊是否有可用的副本。
這是自訂情境用來提醒讀者檢查需求；AWS 的可靠性文件也把備份資料與定期復原驗證列為獨立工作，
見 [AWS Well-Architected：Back up data](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/back-up-data.html)。

## 用 AWS 產品觀察邊界，不強迫每項服務歸類

EC2 是前面 IaaS 的具體例子。若要觀察較高層的應用部署方式，可以看 **AWS Elastic Beanstalk**：
團隊建置與部署應用，由服務協助建立運算資源、配置負載平衡、健康監控與環境擴縮。
見 [Elastic Beanstalk 導論](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/Welcome.html)。
這能幫助理解平台代辦部分管理工作的方向，但不能只貼上 PaaS 標籤，就推定使用者不必再關心平台維護。
例如 managed platform updates 可依設定在維護時段自動套用修補或次要版本更新，但不支援跨平台分支的更新；
使用者仍須確認更新設定與應用相容性，不能推定所有版本變更都會自動完成。
見 [Managed platform updates](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/environment-platform-update-managed.html)。
其平台支援政策也指出，退役的平台分支不再收到維護與安全更新，使用者需要更新至受支援版本。
見 [Elastic Beanstalk platform support policy](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/platforms-support-policy.html)。

另一個例子是 **AWS Lambda**，官方定位為 serverless 運算服務，讓使用者執行程式而不必佈建或管理伺服器，
底層基礎設施管理由服務處理。見 [AWS Lambda 導論](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)。
這裡的「無伺服器」描述使用者不必管理伺服器，不是底層沒有伺服器。
本文不把 serverless 加成與 IaaS、PaaS、SaaS 平行的第四種模式，也不把它直接等同某一種模式；
理解產品時應接著問：供應商管理到哪裡，自己的程式與資料還有哪些工作？

AWS 也說明，IaaS、PaaS、SaaS 是傳統分組，而實際需求可能跨越多種類型。
因此，不必先替每個 AWS 服務強行找一格；服務組合與各自文件，比單一分類名稱更能說明實際分工。
見 [AWS：Types of Cloud Computing](https://aws.amazon.com/types-of-cloud-computing/)。

## 三個不能從「已上雲端」推得的結論

- **託管不等於零責任。**供應商代管的層次變多，仍不表示資料、權限或應用設定都自動正確。
  AWS 明確說明，客戶責任隨所選服務改變。見 [AWS 責任共擔模型](https://aws.amazon.com/compliance/shared-responsibility-model/)。
- **有雲端服務不等於已達成備份與高可用目標。**備份要對應資料復原需求，還要驗證復原流程；
  需要高可用的工作負載，也要針對元件故障設計韌性。不能僅憑「託管」兩字推定所有資料都有所需備份，或整個網站不會中斷。
  見 [Back up data](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/back-up-data.html)與
  [Design your workload to withstand component failures](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/design-your-workload-to-withstand-component-failures.html)。
- **按用量付費不等於永遠更便宜。**可計量描述用量能被追蹤，不代表每項產品都按每次請求計費；AWS 多數服務採按用量付費，也有其他計價安排。
  本文據此提醒：成本仍需按實際使用與計價項目評估，不能由服務模式直接推定總成本。
  見 [AWS Pricing](https://aws.amazon.com/pricing/)。本文不列費率，也未做成本比較實驗。

另外，**服務模式與部署模式回答不同問題**：IaaS、PaaS、SaaS 說明交付的能力與控制範圍；
公有雲（public cloud）、私有雲（private cloud）、混合雲（hybrid cloud）等部署模式則區分基礎設施供誰使用、如何組合。
例如 NIST 的私有雲可由組織或第三方管理，也可在組織內或外；不能只用「機器在不在公司」判斷。
見 [NIST SP 800-145：Deployment Models](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf)。

閱讀後續服務文件時，可以帶著三個問題：我取得的是資源、部署平台，還是可直接使用的應用？
哪些層次由服務管理？我的資料、設定與程式還需要做什麼？
更細的 AWS 與使用者責任，接續 [AWS 與使用者的責任](shared-responsibility.md)；各項產品仍以自己的責任與支援文件為準。

## 相關文件

- [AWS 知識索引](README.md)：回查服務分組與後續整理方向。
- [認識 Linux](../linux/what-is-linux.md)：理解作業系統、核心與應用的分工。
- [API 共通知識索引](../api/README.md)：需要介面、HTTP 等背景時回查共同概念。
- [現行規劃](../../PLAN.md)：查看本站定位與內容安排。
