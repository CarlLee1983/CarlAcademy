# IAM 的身分與權限

「程式已經拿到 AWS 憑證，為什麼還是不能讀 S3？」這個問題要分成兩段：AWS 確認請求來自誰，以及這個主體能否執行眼前的操作。
**IAM（Identity and Access Management）管理 AWS 資源的存取權限；憑證有效，不代表請求一定獲准。**
見 [What is IAM?](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)。

帳戶、root user 與日常登入的入口概念見[帳戶、身分與權限](accounts-identities-and-access.md)；
本文進一步說明 policy、role 與授權評估。驗證與授權的共通原理，見[身分驗證與授權](../api/authentication-and-authorization.md)。

查證日期：2026-11-02。依據當日 AWS 官方文件；產品文件與支援範圍會持續更新。
本文僅做文件查證與本機格式檢查，未登入 AWS、呼叫 AWS API、建立資源、設定角色或實測政策效果。
以下帳戶、角色、bucket 與 ARN 均為假想教學資料，政策範例不是可直接套用的正式環境授權方案。

## 從一個請求讀出誰、操作、資源與情境

AWS 收到請求後，會整理 request context，再判定哪些政策適用。
除了主體，還包括要求的 action、目標 resource，以及來源 IP、時間、標籤等相關情境資訊。
見 [Processing the request context](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-reqcontext.html)。

以一個假想的文章匯出程式為例：

| 判斷項目 | 本例內容 | 閱讀政策時要問的問題 |
| --- | --- | --- |
| 主體（principal） | 程式使用 `ArticleReader` 的 role session | 請求實際代表哪個身分？是否已切換角色？ |
| 操作（action） | `s3:GetObject` | 允許的是讀取、寫入，還是其他操作？ |
| 資源（resource） | 某個 S3 bucket 裡的 `exports/intro.json` | 規則涵蓋整個 bucket、部分物件，還是這一個物件？ |
| 情境（context） | 適用的條件，例如時間或請求來源 | 這個請求是否符合政策的條件？ |

這是依官方 request context 整理的閱讀方式，不是宣稱所有服務支援相同的 action 或條件。
政策語法共同，但各服務提供的 action、resource type 與 condition key 不同，須讀該服務的授權文件。
見 [IAM JSON policy element reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html)。

**政策控制的是操作權限，不只是 Console 上有沒有按鈕。**同一項 action 的授權不因為改用 CLI 或 API 就消失；
另一方面，Console 為了顯示清單與詳細資訊，可能還需要額外操作權限，不能以某個頁面打得開當成完整授權證明。
前者見 [Policies and permissions in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html)，
後者可對照 AWS 的 [Console 存取權限範例](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html#access_policies_boundaries-delegate)。

## User、role 與 session：政策附在哪裡，請求又由誰發出

IAM user 與 IAM role 都能有權限政策。Role 不專屬於某一個人，也沒有一般 user 那樣的長期密碼或 access key；
符合信任與授權條件的主體可 assume role，取得用於 role session 的短期安全憑證。
AWS 服務、其他角色或經外部身分提供者驗證的身分，都可能在各自支援的流程中使用角色。
見 [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)。

Role 和 role session 有關聯，卻不是同一個 principal 表示法。例如以下都是假想 ARN：

- Role：`arn:aws:iam::111122223333:role/ArticleReader`
- 一次 session：`arn:aws:sts::111122223333:assumed-role/ArticleReader/export-job`

當程式使用該次 session 的短期憑證發出請求，呼叫主體是 role session。
這個差別在 resource-based policy 直接授權給 role ARN 或 session ARN 時會影響評估，不能只靠名稱看成同一種授權。
見 [Role session principals](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html#principal-role-session)。

IAM group 則用來整理 IAM users 的權限，不是能自行登入或作為 resource-based policy `Principal` 的身分。
見 [How to specify a principal](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html#Principal_specifying)。

## 三種常被混在一起的 policy

| 政策 | 附著位置與問題 | 具體例子 |
| --- | --- | --- |
| Identity-based policy | 附在 user、group 或 role，描述該身分可做什麼 | 允許 `ArticleReader` 讀某個 S3 物件 |
| Resource-based policy | 附在支援的資源，描述哪些 principal 可對它做什麼 | S3 bucket policy 允許指定角色存取物件 |
| Role trust policy | 附在 role 的 resource-based policy，決定誰可以 assume 這個 role | 信任指定帳戶中的角色呼叫 `sts:AssumeRole` |

分類依據見 [Policies and permissions：Policy types](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#access_policy-types)。
Trust policy 是 resource-based policy 的一種；它讓角色同時具有「可承接權限的身分」和「可被請求 assume 的資源」兩個面向。

Identity-based policy 不寫 `Principal`，因為主體由它附著的身分決定；resource-based policy 則以 `Principal` 指出授權或拒絕對象。
S3 bucket policy 也是如此。見 [Principal 元素](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html)與
[S3 policies and permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-policy-language-overview.html)。

Identity-based policy 還可按管理方式區分：managed policy 是可附給多個身分的獨立政策，inline policy 則直接隸屬單一身分。
AWS managed 與 customer managed 又區分由誰建立及管理；這些是政策的管理方式，不能單憑「managed」就推定符合目前工作的最小權限。
見 [Identity-based policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#policies_id-based)。

## AssumeRole：先能進入角色，再看角色能做什麼

假設帳戶 A 的 `ExportJob` 要 assume 帳戶 B 的 `ArticleReader`，再讀 B 裡的 S3 物件。
這裡有兩次不同的授權判斷：

1. **能不能 assume role？**B 的 `ArticleReader` trust policy 必須信任相應來源；A 的呼叫主體也必須獲准對目標 role ARN 執行 `sts:AssumeRole`。跨帳戶不能只設定其中一邊。
2. **取得 session 後能不能讀物件？**後續請求使用新 session 的憑證，按角色的權限、目標資源政策及其他適用限制評估。Trust policy 信任某人，不會自動授予 S3 讀取能力。

這個流程依 [AssumeRole：Permissions](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)整理。
成功回傳的短期憑證包含 access key ID、secret access key 與 session token；它們支持後續請求，但不是無限制權限。

不要把上述跨帳戶規則改寫成「任何 AssumeRole 都一定要額外附一份 caller identity policy」。
在**同帳戶 IAM user 被直接列為 trust policy 的 principal**等官方說明情境中，trust policy 本身可提供必要允許，不另要求該 user 的 identity-based Allow；
若 trust policy 是信任帳戶，再由帳戶委派給 user，則仍需要相應委派。
見 [AssumeRole 的同帳戶兩種方式](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)。
適用的明確拒絕與其他政策限制仍須評估。

## 一份只讀單一物件的政策怎麼讀

以下自創 **identity-based policy**，假設附在帳戶 `111122223333` 的 `ArticleReader` role。
`amzn-s3-demo-bucket-carlacademy-iam` 是假想 general purpose bucket，目標是其中一個已知 key，
不討論版本指定、額外 KMS 授權或 Console 瀏覽需求。範例只示範語意，不包含建立或套用步驟。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOneArticleExport",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::amzn-s3-demo-bucket-carlacademy-iam/exports/intro.json"
    }
  ]
}
```

- `Version` 是政策語言版本，不是這份文件建立日期。AWS 建議使用 `2012-10-17`，見 [Version 元素](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_version.html)。
- `Statement` 中的 `Effect`、`Action` 與 `Resource` 合起來表示：允許對該物件做 `s3:GetObject`。
  S3 bucket ARN 和 object ARN 不同；`s3:ListBucket` 是 bucket 層級的權限，並非 `s3:GetObject` 的別名。
  見 [S3 policy elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-policy-language-overview.html)。
- 本例沒有 `Principal`，因為是 identity-based policy；也沒有 `Condition`，所以這條 statement 沒有增加情境條件。
  這不代表其他適用政策沒有條件。見 [Principal](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html)與
  [JSON policy elements](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html)。

依這份政策本身推演，它沒有允許列出 bucket、讀另一個物件、上傳或刪除，也沒有授予 assume 此 role 的能力。
但**單看這份政策不能斷言最終一定獲准，也不能斷言該身分永遠沒有其他權限**：它可能還有其他 policies，或受到其他限制。
若物件使用 SSE-KMS，讀取還涉及所用 KMS key 的權限，不能由這個 S3 Allow 推得 KMS 已授權。
見 [SSE-KMS：Permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html)。

## 預設拒絕與明確拒絕，不是同一種原因

對本文討論的一般 IAM user／role 請求，可以先建立兩個概念：

- **Implicit deny（隱含拒絕）**：沒有沿適用評估路徑取得必要 Allow；沒寫 Deny 不等於允許。
- **Explicit deny（明確拒絕）**：某個適用 statement 的 `Effect` 是 `Deny`，而且 action、resource、principal 與條件符合這個請求。適用的明確拒絕優先於 Allow。

見 [How AWS enforcement code evaluates requests](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html)。
這裡不把 root user 當成一般無政策 user；root 的特殊地位與使用限制見帳戶入門文章。

沿用上面的單一物件範例，在「沒有其他授權或限制」這個教學假設下：

| 變動 | 推演結果 |
| --- | --- |
| 請求讀 `exports/intro.json`，政策適用 | 這份政策提供所需 Allow |
| 改讀 `exports/other.json` | 這份政策沒有涵蓋；若沒有其他允許路徑，就隱含拒絕 |
| 另一份適用政策明確 Deny 讀 `exports/intro.json` | 即使原政策 Allow，仍拒絕 |
| 只拿掉另一份政策的 Deny，卻也拿掉原本的 Allow | 沒有自動變成允許；仍需找到必要授權 |

這是依官方評估規則做的案例推演，並非 AWS 實測輸出。

## 為什麼不能把所有 policy 都取交集

**先分辨政策是在授權，還是在限制授權，再分辨請求是否跨帳戶。**
以下以一般 user／role 為討論對象，不是所有 AWS 服務與特殊 principal 的完整演算法。

### 同帳戶：可能由身分或資源政策提供 Allow

對多數支援的同帳戶資源請求，identity-based 或 resource-based policy 可提供 Allow，不必每次兩邊都各寫一次；
適用的明確拒絕仍優先。Role trust policy 與 KMS key policy 等有額外要求，不能將一般規則套用到所有資源。
見 [Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)與
[Resource-based policy evaluation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html)。

當另有 permissions boundary 或 session policy 時，resource-based policy 的 principal 指向方式很重要：

| 同帳戶資源政策直接授權的對象 | 需要注意的隱含拒絕行為 |
| --- | --- |
| IAM user ARN，且不是 federated user session | identity policy 或 permissions boundary 缺少 Allow，不會限制這個直接授權 |
| IAM role ARN | permissions boundary 或 session policy 缺少必要 Allow，仍會限制此授權 |
| IAM role session ARN | 直接授給 session 的權限，不受 identity policy、boundary 或 session policy 的隱含拒絕限制 |

表格依 [Permissions boundaries：Evaluating effective permissions](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html#access_policies_boundaries-eval-logic)整理；
**它不是略過 explicit Deny、SCP、RCP 或其他適用服務限制的通行證**。
`Principal` 搭配 `aws:PrincipalArn` 條件還有進一步差異，包含 wildcard principal 的特殊評估，
不能只看 ARN 字串便套用本表。進階用法須逐項對照 [IAM role principals](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html#principal-roles)與官方評估流程。

### 跨帳戶：直接存取資源需要雙邊評估通過

若 A 的 principal **直接讀取 B 的 S3 物件**，AWS 會分別評估主體所屬帳戶與資源所屬帳戶，兩邊都允許才放行。
A 的 identity-based policy 允許讀取，不能單方面打開 B 的資源；B 的 bucket policy 放行 A 的主體，也不能代替 A 的必要身分授權。
見 [Cross-account policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html)。

這與前面的「先 AssumeRole，再讀物件」不同：若先 assume B 的角色成功，讀取時是 B 的 role session 提出請求。
排查時要沿每次請求確認實際 principal，不能把原登入者 A 和後來使用的 B session 混在一起。
這是依 [Role session principals](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html#principal-role-session)與上述跨帳戶流程推得的判讀方式。

## Boundary、session policy 與 SCP 是限制，不是額外的權限來源

| 機制 | 限制什麼 | 不能從它推得什麼 |
| --- | --- | --- |
| Permissions boundary | 設定 user／role 的 identity-based policies 可授予的上限 | Boundary 有 Allow，不代表身分已獲授權；對 resource-based 授權還要看前述例外 |
| Session policy | 建立 session 時進一步限制該 session 從身分政策取得的權限 | 不能用它把角色原本沒有的權限加進去 |
| Organizations SCP | 對所涵蓋成員帳戶中的主體設定權限上限 | SCP 允許 S3，不等於任何人就能讀所有 S3 物件 |

前兩者見 [Permissions boundaries](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)與
[AssumeRole session policies](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)；
SCP 見 [Service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)。

在純粹從 identity-based policy 取得權限的路徑，身分政策提供 Allow，而適用 boundary、session policy、SCP 等都必須容許該請求。
這時「交集」是有用的理解方式；它不取代前節 resource-based policy 的規則。
SCP 也不是套在所有帳戶與主體上的全球防火牆：例如不影響 Organizations management account 中的 users／roles，且不限制 service-linked roles。
見 [SCP effects on permissions](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html#scp-effects-on-permissions)。

AWS 另有 RCP（resource control policy），限制組織帳戶中所涵蓋資源可被授予的權限；它也不授權。
實際路徑還可能有 VPC endpoint policy 等邊界，因此本文的表格不是所有政策類型清單。
見 [IAM policy types](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#access_policy-types)。

## 最小權限、短期憑證與 MFA 分別解決不同問題

AWS 建議人員透過身分聯合使用短期憑證，工作負載使用 IAM roles 取得短期憑證，並只授予工作需要的權限。
最小權限要同時縮小 action、resource 與適用條件，也要持續檢查不再使用的權限；只把政策名稱命名成 `ReadOnly` 並不足夠。
見 [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)。

短期憑證減少長期憑證的管理與暴露問題，但在有效期間內仍須保護；取得 session 不會自動具有管理員權限。
MFA 加強的是驗證：在支援的 AssumeRole 流程，trust policy 可要求 MFA 條件，呼叫者也須提供相應資訊。
它能成為授權條件，**不會因為通過 MFA 就自行增加 S3 權限**。
見 [AssumeRole：Using MFA](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)與
[IAM MFA 建議](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#enable-mfa-for-privileged-users)。
實際 MFA 要求與可用 context key 須按所用的登入、聯合身分及憑證流程判斷。

IAM 的資源不是按每個 Region 各建一份，但這不表示受 IAM 控制的服務資源也都變成全球資源。
例如 EC2 資源有 Region 邊界，跨 Region 不會自動複製；授權通過也不能替代選對目標資源與 endpoint。
見 [AWS Region 設定：IAM 無 Regional resources](https://docs.aws.amazon.com/sdkref/latest/guide/feature-region.html)與
[EC2 Regions and Zones](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html)。
AWS partition 之間另有獨立 IAM 邊界，opt-in Region 也有啟用與 IAM 資料傳播程序，不能把「全球」讀成無條件跨所有區域與 partition。
見 [Enable or disable AWS Regions](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-regions.html)。

## 讀到 AccessDenied，先把請求還原清楚

下列是依官方模型整理的排查順序，不是已執行的診斷結果：

1. 確認當次呼叫實際使用的 principal／session，而非只看一開始登入的使用者。
2. 找出被拒絕的 action、resource ARN 與相關條件；列 bucket 和讀 object 可能是不同請求。
3. 辨別是同帳戶、直接跨帳戶，還是跨帳戶 assume role 後再存取。
4. 分開檢查授權來源和限制來源；有 Allow 之後，仍要看適用 explicit Deny、boundary、session policy、SCP／RCP 與服務規則。
5. 若涉及其他服務，例如 SSE-KMS，再檢查相應資源與操作的授權。

判讀依據見 [IAM evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)、
[S3 policy elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-policy-language-overview.html)與
[SSE-KMS permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html)。
政策 JSON 可以成功解析，只代表格式通過；IAM 的政策檢查與 IAM Access Analyzer 能進一步檢查政策問題，
也不能把本機格式檢查宣稱成真實請求已驗證。見 [IAM policy element reference：Validation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html)。

## 相關文件

- [AWS 知識索引](README.md)：查看身分、服務與資源之間的閱讀入口。
- [帳戶、身分與權限](accounts-identities-and-access.md)：回查帳戶、root 與日常身分概念。
- [AWS 與使用者的責任](shared-responsibility.md)：確認誰負責資料與權限設定。
- [S3、EBS 與 EFS](s3-ebs-and-efs.md)：區分物件、區塊與檔案儲存的存取方式。
- [如何存取 AWS 服務](accessing-aws-services.md)：區分 Console、CLI 與 SDK 的操作入口。
- [KMS、Secrets Manager 與 Parameter Store](kms-secrets-manager-and-parameter-store.md)：對照 KMS Key Policy 與一般 IAM 政策的雙重授權要求。
- [SQS、SNS 與 EventBridge](sqs-sns-and-eventbridge.md)：跨服務發布與消費訊息時的 resource-based policy 與條件鍵邊界。
- [身分驗證與授權](../api/authentication-and-authorization.md)：回查跨產品的共通原理。
