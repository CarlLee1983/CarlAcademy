# KMS、Secrets Manager 與 Parameter Store：金鑰、機密與設定管理

應用程式執行時，常同時需要「加密資料的金鑰」「連接外部服務或資料庫的密碼／API token」以及「依環境切換的組態設定」。把這三者全都塞進程式碼或一般環境變數，既難以稽核存取，也難以安全輪替。**AWS KMS 管理加密金鑰與加解密操作；AWS Secrets Manager 專注於機密憑證的保存與自動輪替生命週期；AWS Systems Manager Parameter Store 則提供階層化的設定參數與選配 KMS 加密的 `SecureString`。**見 [AWS KMS 導論](https://docs.aws.amazon.com/kms/latest/developerguide/overview.html)、[Secrets Manager 導論](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)與 [Parameter Store 導論](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)。

本文接續 [IAM 的身分與權限](iam-identities-and-permissions.md)、[AWS 與使用者的責任](shared-responsibility.md)與 [RDS 與 DynamoDB](rds-and-dynamodb.md)；機密保護與輪替的跨平台共通原理見[機密與敏感資料的生命週期](../web-security/secrets-and-sensitive-data.md)。

查證日期：2026-11-03。僅查閱 AWS 官方文件，未登入 AWS、建立 KMS 金鑰、機密或參數，亦未執行 SDK 加解密或輪替實測。文中的資源路徑與政策概念均為自創示例，不列費率與配額。

## 三項服務的分工邊界

許多初學者疑問：「既然 KMS 能加密，Secrets Manager 和 Parameter Store 也都能存加密字串，三者差在哪裡？」關鍵在於**管理對象是金鑰本身、需要輪替的機密憑證，還是一般應用程式設定**：

| 服務 | 核心管理對象 | 與其他兩者的關係 | 典型使用情境 |
| --- | --- | --- | --- |
| AWS KMS | 加密金鑰（KMS Keys）與密碼學運算（加解密、簽章、產生資料金鑰） | 為 S3、EBS、RDS、Secrets Manager 與 Parameter Store `SecureString` 提供底層金鑰保護 | 產生資料金鑰做信封加密（envelope encryption）、控制誰能在什麼條件下解密資料 |
| AWS Secrets Manager | 具有生命週期與輪替需求的機密值（如資料庫帳密、第三方 API 私密金鑰、OAuth client secret） | 底層一律使用 AWS KMS 金鑰加密儲存機密內容 | 儲存 RDS 憑證並搭配託管輪替或自訂 Lambda 定期自動換密、跨帳戶安全共享機密 |
| Systems Manager Parameter Store | 應用程式設定參數（`String`、`StringList`）與敏感參數（`SecureString`） | 當型別選 `SecureString` 時，委由 AWS KMS 金鑰加密參數值 | 以 `/prod/academy/api-timeout` 等階層路徑集中管理各環境組態、功能旗標與非自動輪替型參數 |

## AWS KMS：主金鑰不離開服務，以信封加密保護大量資料

在 AWS KMS 中，對稱或非對稱的主金鑰（KMS key）保存在受保護的服務邊界內，**一般使用流程不是「把 KMS 主金鑰下載到應用程式記憶體裡自己加密檔案」**。面對較大或大量的資料（例如 S3 物件、EBS 磁碟區、RDS 儲存或應用層大欄位），KMS 採用 **信封加密（Envelope Encryption）**。見 [Envelope encryption in AWS KMS](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#enveloping)。

```text
加密階段：
  1. 呼叫 KMS GenerateDataKey(KeyId)
     ←── 回傳「明文資料金鑰 (Plaintext Data Key)」與「密文資料金鑰 (Encrypted Data Key)」
  2. 應用程式在本地用「明文資料金鑰」加密業務資料，得到密文資料
  3. 立即從記憶體清除「明文資料金鑰」，將「密文資料金鑰」與「密文資料」一起保存

解密階段：
  1. 取出保存的「密文資料金鑰」，送交 KMS Decrypt
     ←── KMS 驗證權限與 Encryption Context 後，回傳「明文資料金鑰」
  2. 應用程式在本地解密業務資料，使用後清除記憶體中的明文資料金鑰
```

### KMS 金鑰類型與關鍵授權規則

1. **AWS owned key、AWS managed key 與 Customer managed key**：
   - **AWS owned key**：由特定 AWS 服務在多帳戶間共用管理，客戶無法檢視、追蹤或修改其金鑰政策。
   - **AWS managed key**（別名常為 `aws/<service-name>`，如 `aws/rds`、`aws/secretsmanager`）：建立在客戶帳戶內並可於 CloudTrail 看到使用紀錄，但金鑰政策與輪替規則由服務固定管理，**無法由客戶自訂金鑰政策或用於跨帳戶解密授權**。
   - **Customer managed key（CMK）**：由客戶自行建立、定義 Key Policy、啟用自動年度金鑰輪替或設定刪除等待期；需要細粒度存取控制或跨帳戶共享加密資源時，必須使用 Customer managed key。見 [KMS key types](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#kms_keys)。
2. **KMS Key Policy 是必備條件**：與多數同帳戶資源只要 IAM identity-based policy 允許即可存取不同，**AWS KMS 評估存取時，該 KMS Key 的 Key Policy 必須明確允許（或透過預設根帳戶聲明將權限委派給 IAM policies），單靠 IAM Role 上的政策無法繞過未授權的 Key Policy**。見 [Key policies in AWS KMS](https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html)。
3. **Encryption Context（加密上下文）防範密文遭跨情境替換**：呼叫 KMS 加解密時可傳入一組非機密的鍵值對（例如 `{"app": "academy", "tenant_id": "t-42"}`），該上下文會被密碼學綁定到密文中並記錄於 CloudTrail。解密時必須提供完全一致的 Encryption Context 才能成功，而且可在 IAM 或 Key Policy 中以 `kms:EncryptionContext:*` 條件限制某個角色只能解密特定範圍的機密。見 [Encryption context](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#encrypt_context)。

## Secrets Manager 與 Parameter Store：機密輪替與組態階層

雖然 Parameter Store 的 `SecureString` 與 Secrets Manager 都透過 KMS 加密靜態資料，但兩者在應用架構中承擔不同職責：

| 比較面向 | AWS Secrets Manager | Systems Manager Parameter Store |
| --- | --- | --- |
| 加密預設行為 | 一律使用 KMS 加密（可選預設 `aws/secretsmanager` 或客戶自管 KMS key） | `String`／`StringList` 不加密；僅 `SecureString` 使用 KMS 加密 |
| 自動輪替（Rotation） | 內建輪替排程與版本標籤（如 `AWSCURRENT`、`AWSPENDING`、`AWSPREVIOUS`），原生支援 RDS 等資料庫自動換密 | 不內建機密輪替狀態機；若需換密須自行實作外部流程 |
| 階層式設定組織 | 雖可用 `/` 命名，但主要以單一機密物件（常為一包 JSON 憑證）管理 | 專為階層路徑（如 `/prod/web/log-level`）與 `GetParametersByPath` 批次讀取設計 |
| 跨帳戶共享 | 支援在 Secret 上直接配置 resource-based policy（搭配客戶自管 KMS key）跨帳戶讀取 | 標準參數主要限同帳戶存取（進階參數可搭配 RAM 共享，但模型不同） |

### 為什麼讀取 `SecureString` 或 Secret 時會遇到 `AccessDeniedException`？

這是實務排障最常遇到的雙重權限邊界：當 ECS Task 或 Lambda 函式讀取一個使用 **Customer managed KMS key** 加密的 Secret（或 `SecureString` 參數）時，執行角色必須**同時**通過兩道檢查：

1. 對機密或參數服務的讀取權限：`secretsmanager:GetSecretValue`（或 `ssm:GetParameter`／`ssm:GetParameters`）。
2. 對底層 KMS 金鑰的解密權限：**`kms:Decrypt`**（且該 KMS key 的 Key Policy 允許此角色或該帳戶 IAM 委派，若服務使用了 `kms:ViaService` 條件也須匹配）。

只給 `secretsmanager:GetSecretValue` 卻沒給對應 KMS key 的 `kms:Decrypt`，呼叫仍會因為無法解密而失敗。見 [Permissions reference for AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_iam-policies.html) 與 [How AWS Systems Manager Parameter Store uses AWS KMS](https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-paramstore-kms.html)。

## 執行期讀取與輪替：避免把機密固化在靜態環境變數

若在部署時把 Secrets Manager 的密碼轉寫成容器或 Lambda 的明文環境變數，不僅任何能檢視函式／任務定義描述（如 `lambda:GetFunctionConfiguration` 或 `ecs:DescribeTaskDefinition`）的人都能直接看到密碼，而且當 Secrets Manager 完成自動輪替後，舊環境變數並不會自動更新，立即就會造成資料庫連線驗證失敗。

較穩健的做法與邊界：

- **依最小範圍在執行期按需讀取並短期快取**：由應用程式在啟動或連線驗證失敗時呼叫 API（或透過官方提供的本地快取擴充元件）讀取 `AWSCURRENT` 版本的機密，並設定合理的本地記憶體快取 TTL，同時顧及輪替生效速度與 API 呼叫成本。
- **資料庫能用短期臨時憑證時，優先減少長效密碼**：例如對支援的 RDS 引擎或 DynamoDB，可評估使用 IAM 驗證或角色授權，從根本減少需要保管與輪替的靜態密碼（參見 [RDS 與 DynamoDB](rds-and-dynamodb.md#網路可達aws-權限與資料庫登入分別處理)）。
- **以 CloudTrail 追蹤誰在何時讀取或解密了哪筆機密**：KMS 的 `Decrypt`、Secrets Manager 的 `GetSecretValue` 與 Parameter Store 的 `GetParameter` 都會在 CloudTrail 留下管理事件紀錄，可搭配異常告警與稽核（參見 [CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)）。

## 相關文件

- [AWS 知識索引](README.md)：回到 AWS 主題總覽。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：理解身分政策、資源政策與條件鍵判定。
- [AWS 與使用者的責任](shared-responsibility.md)：託管服務提供加密機制，客戶仍負責金鑰授權、輪替與存取邊界。
- [RDS 與 DynamoDB](rds-and-dynamodb.md)：資料庫儲存加密、連線憑證與 IAM 驗證分工。
- [ECS 與 Fargate](ecs-and-fargate.md)／[EC2 與 Lambda](ec2-and-lambda.md)：運算環境的執行角色（task role / execution role）如何安全取得機密與設定。
- [CloudWatch 與 CloudTrail](cloudwatch-and-cloudtrail.md)：從 CloudTrail 追查 `Decrypt` 與 `GetSecretValue` 等敏感 API 呼叫。
- [機密與敏感資料的生命週期](../web-security/secrets-and-sensitive-data.md)：雜湊、加密、儲存、最小揭露與外洩輪替的共通原則。
