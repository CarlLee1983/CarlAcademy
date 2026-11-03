# 帳戶、身分與權限

一個團隊在 AWS 執行文章網站，至少要分清三件事：資源屬於哪個帳戶、目前是誰提出要求，以及這個身分被允許做什麼。
**AWS account 是資源與管理的邊界；登入身分與操作權限則是邊界內需要另行管理的事。**
AWS 以帳戶容納資源，並提供身分、存取及帳務管理能力，見 [What is an AWS account?](https://docs.aws.amazon.com/accounts/latest/reference/accounts-welcome.html)。

本文是 AWS 帳戶與身分概念的入口，不要求先建立帳戶，也不提供 root、憑證或權限設定步驟。
一般的驗證與授權概念沿用[〈身分驗證與授權〉](../api/authentication-and-authorization.md)；
政策如何決定允許或拒絕，另見[〈IAM 的身分與權限〉](iam-identities-and-permissions.md)。

查證日期：2026-11-02。依據 AWS 官方文件；產品規則與管理功能可能更新。
本文僅做文件查證，未登入 AWS、建立資源、變更權限或執行 CLI／SDK；以下團隊與網站情境均為假想例子。

## AWS account 不等於一個人的登入帳號

日常會說「用我的 AWS 帳號登入」，但這句話可能混合了兩個層次：

| 層次 | 回答的問題 | 假想網站團隊的例子 |
| --- | --- | --- |
| AWS account（本文稱「AWS 帳戶」） | 資源在哪個管理與帳務邊界內？ | 正式網站的運算、圖片與資料庫放在正式環境帳戶 |
| Identity（身分） | 誰在要求存取？ | 工程師的聯邦身分、網站程式使用的角色工作階段 |
| Permission（權限） | 這個主體能對什麼做什麼？ | 工程師能看監控資料；網站程式能讀取指定圖片 |

AWS 帳戶有自己的唯一識別碼，可容納多個身分與資源；它不是要求每個工作者都共用同一組登入資料。
帳戶也是身分與存取的隔離邊界：跨帳戶存取需要明確允許，不能因為兩個帳戶屬於同一團隊就推定彼此可讀資料。
帳戶同時是成本歸屬的基本單位；即使之後彙整付款，仍可按帳戶理解用量與成本。
見 [AWS 帳戶的資源、安全與帳務邊界](https://docs.aws.amazon.com/accounts/latest/reference/accounts-welcome.html)。

另一個容易混淆的詞是 **Region（區域）**。帳戶與區域不是同一層：
一個 AWS 帳戶可在其可用的多個區域建立資源，切換區域不等於切換帳戶。
區域可用性也受帳戶類型與啟用狀態影響，不能推定任何帳戶都能使用全球每個區域。
見 [AWS Regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)；
部署位置另讀[〈Region 與 Availability Zone〉](regions-and-availability-zones.md)。

## root、IAM user 與 role 是不同概念

**IAM（Identity and Access Management）**是 AWS 管理資源存取的服務。
它提供控制身分驗證與授權的基礎，讓團隊管理誰可使用哪些資源。
見 [What is IAM?](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)。
閱讀 AWS 文件時，先分清下列名稱：

| 名稱 | 是什麼 | 不應誤認為 |
| --- | --- | --- |
| AWS account root user | 帳戶的特殊高權限身分；一般建立帳戶流程以註冊的電子郵件與密碼登入 | 團隊每個人的日常共用身分 |
| IAM user | 在某個 AWS 帳戶內建立的身分，可代表人或工作負載，並按用途配置憑證 | AWS 帳戶本身，或現代人員存取的必備起點 |
| IAM role（角色） | 具有特定權限、可由獲允許的主體承擔的身分 | 一個人專屬、附固定密碼的登入帳號 |
| Role session（角色工作階段） | 承擔角色後，以短期憑證進行存取的一段使用情境 | 角色設定本身，或永久有效的權限憑證 |

root 的定位見 [AWS account root user](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user.html)；
IAM user 的定義與憑證類型見 [IAM users](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users.html)；
角色與短期工作階段見 [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)。

角色沒有一般的長期密碼或 access key；獲允許的主體承擔角色（assume role）後，會取得該工作階段的短期安全憑證。
人、應用程式或 AWS 服務都可能在適當的信任與權限設定下使用角色。
角色名稱也不代表任何人都能使用它，或承擔後就能操作所有資源。
見 [IAM roles：角色與委派存取](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)。

例如，團隊可設計「檢視正式環境」與「部署測試環境」兩種角色。
工程師在不同工作情境取得不同角色的工作階段；角色代表工作需要的 AWS 權限，不是另造一個共用人員帳號。
這是本文的概念安排，未定義任何實際政策。

## 人員存取：聯邦身分與 IAM Identity Center

**身分聯邦（identity federation）**讓已由身分提供者（Identity Provider，IdP）管理的身分，依信任關係取得 AWS 存取能力。
例如工程師先透過公司的身分系統驗證，再取得被授予的 AWS 存取；不必為每個 AWS 帳戶各建立一個長期 IAM user。
AWS 建議人員優先使用聯邦存取與短期憑證，見 [Identity providers and federation into AWS](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers.html)。

**AWS IAM Identity Center**提供集中管理工作人員存取的能力，可連接既有 IdP，也可直接管理使用者與群組。
它能讓人員透過 AWS access portal 進入獲指派的帳戶與應用；管理 AWS 帳戶存取使用的是 organization instance，
不能把只支援部分應用的 account instance 理解為同樣的多帳戶存取入口。
見 [What is IAM Identity Center?](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)。

把前面的網站團隊串起來，可以想成：

1. 工程師以個人工作身分完成驗證。
2. 團隊的存取安排決定他能進入哪些 AWS 帳戶、使用哪些角色或權限配置。
3. 工程師取得相應的短期工作階段，向 AWS 服務提出要求。
4. 服務再判斷該次操作是否獲准。

這是概念流程，具體登入路徑取決於採用的身分來源與配置；聯邦登入不表示所有員工自動得到所有帳戶的存取權。
聯邦與短期憑證的關係見 [Federation with IAM Identity Center](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers.html)，
服務端仍需授權的流程見 [IAM：Access management](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)。

## 程式存取：工作負載也需要自己的身分

網站後端讀取圖片、背景程式產生報表，都是**工作負載（workload）**需要呼叫 AWS 服務的情境。
它們不應依靠某位工程師每天登入，也不應拿 root 憑證當作網站設定。
AWS 建議工作負載使用 IAM role 與短期憑證；在 EC2、Lambda 等 AWS 運算服務上，服務可把角色的短期憑證提供給運算資源，
SDK 可發現並使用這些憑證，不必把 IAM user 的長期金鑰散發到程式裡。
見 [IAM：工作負載使用短期憑證](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)。

在假想網站中，可把人員與程式分開：

| 主體 | 工作需要 | 不由這個需要推得的能力 |
| --- | --- | --- |
| 值班工程師 | 查看運作狀態與錯誤資訊 | 修改所有身分或刪除所有資料 |
| 網站後端 | 讀取指定位置的圖片 | 管理團隊成員或調整帳務 |
| 背景整理程式 | 處理它負責的資料 | 沿用工程師的全部權限 |

這是自訂需求表，實際允許範圍仍須由政策落實。
「最小權限」就是只授予完成工作所需的能力，不是因為程式在 AWS 上執行，就自動能存取同帳戶所有服務。
見 [IAM：Apply least-privilege permissions](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)。

網站讀者的登入則是另一個邊界：讀者能編輯自己的文章，不代表他能管理承載網站的 AWS 帳戶。
應用登入可以採用不同機制；若確實需要讓應用使用者直接取得 AWS 資源存取，AWS 也有對應的聯邦與 Cognito 身分集區機制。
見 [Federation with Amazon Cognito identity pools](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers.html)。
本例只區分應用權限與基礎設施權限，不要求網站採用任何特定登入服務。

## 憑證是用來存取的資料，不是權限清單

憑證要連同用途理解，不能看到一串 key 就把它當成所有入口通用的密碼。

- **Console password** 用於相應身分的互動登入。
- **Access key ID 與 secret access key** 是一組用來簽署程式化要求的資料，不是 Console 登入密碼。
- **短期安全憑證**會在限定期間後失效，可支援角色與聯邦存取；短期不表示允許範圍一定小，權限仍須另外管理。

密碼與 access key 的用途見 [IAM users and credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users.html)，
簽署要求的金鑰組見 [Manage access keys for IAM users](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html)，
短期憑證的期限與用途見 [AWS security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/security-creds.html)。
使用 CLI 或 SDK 不代表必須先建立長期 access key；它們也可使用適當流程提供的短期憑證。

AWS 優先建議短期憑證；IAM user 與長期 access key 仍有部分不支援聯邦或角色的特定用途，不能說它們已全面不存在。
但「想用程式呼叫 AWS」本身不足以構成選用長期金鑰的理由。
見 [IAM roles：When to create an IAM user](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)。
本文不提供金鑰範例，也不把建立長期金鑰設成入門步驟。

## root 與 MFA：高權限身分的保護

root 應保留給確實需要 root 層級權限的工作，不用於部署網站、查看監控等日常工作。
例如**不屬於 AWS Organizations 的獨立帳戶**，變更 root 電子郵件或關閉帳戶需要 root 憑證；
但不能因此宣稱所有帳務、聯絡資料或成員帳戶管理都只能用 root。
Organizations 的集中管理能力會改變部分工作所需的存取方式。
見 [Tasks that require root user credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user.html)。

即使一個 IAM user 或角色具有管理員權限，它也不因此變成 root；兩種身分的特殊能力與管理方式不同。
見 [IAM users](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users.html)。
同樣地，EC2 虛擬機器作業系統裡的 Linux root，與 AWS account root user 也屬於不同系統的權限邊界。

**多因素驗證（MFA）**為登入增加額外驗證因素，不能取代授權規則。
AWS 的身分管理最佳實務建議人員存取採取適當的 MFA 保護，並在能採用時優先使用防網路釣魚的 passkey 或 security key；
使用外部 IdP 或 Identity Center 時，需依實際身分來源理解 MFA 在哪裡執行。
見 [IAM：Require multi-factor authentication](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)。

團隊不應把 root 當成日常共用登入，或為網站建立 root access key。
應保護 root 登入與帳戶復原機制，只在必要工作下由獲授權人員依管理流程使用。
AWS 官方也提供 Organizations 成員帳戶的集中 root 存取管理，可移除成員帳戶的長期 root 憑證；
因此不能假設每個成員帳戶都一定保有可供日常登入的 root 密碼。
見 [Root user best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html)。
這裡說明保護方向，不提供修改 root 或 MFA 的操作教學。

## 多帳戶管理：隔離環境，不是多開幾個人員帳號

團隊規模擴大時，可用不同 AWS 帳戶區分正式、測試或其他工作負載，讓資源、存取與成本有更清楚的邊界。
**AWS Organizations**用來集中管理多個帳戶、分組、套用治理政策與彙整帳務；它不把多個帳戶合併成同一個帳戶。
見 [What is AWS Organizations?](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_introduction.html)。

在這個假想安排中，同一名工程師可以被指派測試帳戶的部署權限，卻只有正式帳戶的檢視權限。
「同一個人」與「同一套權限」並不畫上等號；跨帳戶治理、身分來源與每個帳戶內的權限要一起理解。
這是示意分工，不是要求所有新手立刻建立固定數量的帳戶。

## 登入成功之後，仍要看本次操作

假設工程師已進入正式環境帳戶，但嘗試刪除網站圖片時收到拒絕。
這不必然代表密碼錯誤：登入驗證成功，與刪除圖片獲准，是不同階段的判斷。
IAM 官方也以進入 Console 後選取服務為例，說明服務仍會依身分與適用政策處理授權。
見 [IAM：Access management](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)。

因此，閱讀服務文章或分析拒絕結果時，可先確認：目前是哪個帳戶、哪個主體或角色工作階段，
要對哪個資源執行哪個操作？這能把「帳戶、身分、權限」落到同一個要求上。
具體政策類型與判斷規則留到[〈IAM 的身分與權限〉](iam-identities-and-permissions.md)，
Console、CLI 與 SDK 等入口的差異則讀[〈如何存取 AWS 服務〉](accessing-aws-services.md)。

## 相關文件

- [AWS 知識索引](README.md)：查看本主題的閱讀入口。
- [雲端運算與服務模式](cloud-computing-and-service-models.md)：先理解資源如何提供。
- [AWS 與使用者的責任](shared-responsibility.md)：理解使用者仍須管理的資料與存取責任。
- [身分驗證與授權](../api/authentication-and-authorization.md)：回查主體、資源、操作與授權的共同概念。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：接著理解 AWS 權限政策。
- [Region 與 Availability Zone](regions-and-availability-zones.md)：分清管理邊界與部署位置。
- [如何存取 AWS 服務](accessing-aws-services.md)：區分操作入口與憑證來源。
