# 如何存取 AWS 服務

**AWS Management Console、AWS CLI 與 AWS SDK，是人或程式操作 AWS 服務的不同入口。**
網頁按鈕、終端機命令與程式方法，最後都會形成服務請求；換一個入口，不會自動換得更大的權限。
先理解「誰提出什麼請求、送到哪裡、如何判斷結果」，再學某一種工具的語法，會比較容易看懂操作的邊界。

本文不要求 AWS 帳戶或程式語言背景；API 契約、HTTP、錯誤與重試等共通知識，見 [API 共通知識索引](../api/README.md)。
查證日期：2026-11-02。CLI 說明以 AWS CLI v2 為範圍，SDK 設定須另核對所用語言與版本。
本文僅查讀官方文件，未登入 AWS、取得憑證、建立資源，亦未執行 CLI 或 SDK；以下查詢是概念情境，不是實測結果。

## 三種入口，各自把操作表達成什麼

| 入口 | 操作方式 | 適合理解的使用情境 |
| --- | --- | --- |
| AWS Management Console | 透過瀏覽器中的服務頁面、表單與按鈕操作 | 人查看資源、理解設定與處理偶發管理工作 |
| AWS CLI | 在命令列選擇服務、操作及參數，取得文字或結構化輸出 | 人從終端機操作，或以 shell 串起重複工作 |
| AWS SDK | 應用程式使用語言套件提供的用戶端、方法與資料型別 | 把 AWS 服務操作整合進應用流程 |

Console 是集中提供各服務控制台入口的網頁應用；CLI 則直接存取 AWS 服務的公開 API，也有簡化複雜工作的高階命令。
見 [Console 導論](https://docs.aws.amazon.com/awsconsolehelpdocs/latest/gsg/what-is.html)與
[AWS CLI 導論及 v2 範圍](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-welcome.html)。
SDK 與 CLI 通常代辦 AWS API 請求的簽章，不必由使用者手寫簽章演算法；
見 [AWS Signature Version 4](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html)。

可以把管理服務的流程簡化為：

```text
人使用 Console／CLI，或程式使用 SDK
  → 準備操作、資源與參數，使用目前的身分與憑證
  → 向目標服務 endpoint 發送 API 請求
  → AWS 驗證身分並評估權限
  → 服務處理操作並回應
  → 入口顯示結果，或程式繼續處理結果
```

這是概念流程，不是 Console 內部實作的逐步追蹤。Console 的一次畫面操作可能涉及多項請求，
也不表示每個畫面功能都與一個 CLI 命令或 SDK 方法一一對應。
AWS 將 Console、API 與 CLI 都列為 principal 提出請求的方式，授權仍依請求中的操作、資源及環境判斷；
見 [How IAM works](https://docs.aws.amazon.com/IAM/latest/UserGuide/intro-structure.html)。

## 每次操作都要分清的五件事

這五項是本文整理的理解框架，不是 AWS 規定的五個必填欄位。

| 項目 | 回答的問題 | 容易混淆之處 |
| --- | --- | --- |
| Principal（提出請求的主體） | AWS 將這次請求歸屬於誰？ | 使用電腦的人與實際發出請求的 role session 不一定是同一種身分表示 |
| Credentials（憑證） | 用什麼證明這個身分？ | 登入密碼與 API 憑證用途不同；profile 名稱不是憑證 |
| Session（工作階段） | 這次取得的存取資格何時有效？ | 已登入不等於永遠有效，也不等於所有工具都共用相同 session |
| Region（區域） | 要在哪個服務區域操作？ | 選到某區域不會搬移資源，也不會授予那個區域的權限 |
| Endpoint（服務端點） | 請求實際送往哪個服務入口 URL？ | endpoint 與資源的地理範圍相關，但不是所有服務都使用同一種端點規則 |

Principal 與驗證、授權的關係見 [IAM 請求與主體](https://docs.aws.amazon.com/IAM/latest/UserGuide/intro-structure.html)；
短期憑證與有效期限見 [Temporary security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html)；
Region 與 endpoint 的規則見 [AWS service endpoints](https://docs.aws.amazon.com/general/latest/gr/rande.html)。

例如人先登入組織的身分系統，再取得某個 AWS 帳戶中角色的存取資格。
之後向服務送出的請求使用該角色的短期憑證，而不是把人的登入密碼塞進每次 API 呼叫。
以 STS 取得的短期 API 憑證包含 access key ID、secret access key 與 session token；token 是必要的一部分。
過期後需要取得新的一組，不能把原憑證的期限延長。
見 [Use temporary credentials with AWS resources](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_use-resources.html)。

## 驗證成功，仍可能沒有操作權限

**Authentication（驗證）確認請求所代表的身分；authorization（授權）判斷這個身分能否對指定資源執行操作。**
憑證有效而請求被拒絕，與憑證已失效，是不同問題。Console 能登入首頁，也不代表能查看或修改所有服務資源。
AWS 會依請求內容及適用政策評估權限；相關機制見 [How IAM works](https://docs.aws.amazon.com/IAM/latest/UserGuide/intro-structure.html)。
本文只區分層次，政策種類、跨帳戶與拒絕規則另見 [IAM 的身分與權限](iam-identities-and-permissions.md)。

AWS 對人員與工作負載提出不同的憑證取得方式，但都優先使用短期憑證：

- **人員操作**：透過身分提供者進行聯合存取，取得角色的短期憑證；組織集中管理可使用 IAM Identity Center。
- **工作負載操作**：EC2、Lambda 等執行環境可向程式提供其 IAM role 的短期憑證；AWS 外的程式也可透過適當的聯合身分機制取得短期存取資格。

來源：[IAM security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)。
這不是要求所有程式都模擬人員開啟瀏覽器登入，也不是把開發者的長期金鑰放進應用程式。
本文不需要讀者建立或貼出任何金鑰；帳戶與身分的整體關係見 [帳戶、身分與權限](accounts-identities-and-access.md)。

### Identity Center 的登入與角色憑證，也有不同期限

在 CLI v2 的 Identity Center 設定中，工具可利用已快取的 Identity Center session，取得 profile 指定角色的 AWS 憑證。
角色憑證到期時，在有效登入條件下可自動重新取得；Identity Center session 本身到期，則需要重新登入。
`SSO session` 也不是 STS 回傳的 `session token` 的另一個名字。
見 [Configuring IAM Identity Center authentication with the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)。

因此，「瀏覽器中看起來還登入著」不足以推定某個 CLI 或程式所用的憑證仍有效。
查問題時要先確認工具實際採用的憑證來源與 session，而不是反覆換工具試同一個操作。

## Profile 與 SDK 的設定，會影響實際使用的身分

CLI 的 **profile** 是一組有名稱的設定，可包含憑證來源、角色、預設 Region 與輸出格式等。
未指定時可使用 `default`；部分設定也可能被環境變數或命令列參數覆寫。
見 [AWS CLI configuration and credential files](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)。

依此可知，把 profile 取名為 `test` 或 `read-only`，不會建立測試環境隔離或唯讀權限。
那只是本機設定名稱：實際帳戶、角色與授權才決定操作範圍。
預設 Region 同樣是請求設定，不能當成防止操作正式資源的安全邊界；
需要的權限限制應由身分與政策機制提供，而非依靠名稱提醒。

SDK 常透過 **credential provider chain（憑證提供者鏈）**尋找憑證，可能包含明確程式設定、環境變數、共用設定檔、
Identity Center、容器或 EC2 執行環境的來源。**不同語言、版本與執行環境的支援及順序不能假設完全相同。**
AWS 的共通文件明確指出，不是所有 SDK 都支援所有 provider；應沿文件連到所用 SDK 的版本說明。
見 [Standardized credential providers](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html)。

這也解釋為什麼「同一台電腦上 CLI 能查，程式卻不能查」：兩者可能沒有選到同一來源或同一個角色。
檢查時應辨識目前來源、帳戶與角色，不應把秘密憑證內容印進日誌或貼到問題回報中。

## Region 與 endpoint：操作位置不由權限名稱決定

對 EC2 這類具有區域範圍的資源，在某個 Region 的查詢不會自動列出其他 Region 的同類資源。
SDK 與 CLI 通常會依服務與 Region 選擇預設 endpoint；例如 DynamoDB 的區域端點可包含區域代碼。
但 IAM、CloudFront 等服務有跨 Region 的全域端點，不能把所有 AWS API 都當成相同的區域服務。
見 [AWS service endpoints：Regional and global endpoints](https://docs.aws.amazon.com/general/latest/gr/rande.html)。

因此，查不到預期資源時，先分辨「回應失敗」與「查詢成功但範圍不符」。
帳戶、角色、Region、篩選條件都值得確認；對全域服務則依該服務的資源與端點規則判讀。
不要僅憑 URL 是否含 Region，就推定所有資料儲存與服務行為。
區域、AZ 與資源位置的背景見 [Region 與 Availability Zone](regions-and-availability-zones.md)。

## 同一個假想查詢，從三個入口理解

假設團隊已經有 EC2 資源，要問的是：「指定帳戶、指定 Region 裡，目前有哪些執行中的 instance？」
這是閱讀情境，不要求讀者真的登入、安裝工具或查詢任何帳戶。

| 入口 | 概念上的操作 | 應檢查的結果 |
| --- | --- | --- |
| Console | 確認帳戶與角色，切到目標 Region，在 EC2 instance 清單以狀態篩選 | 畫面是否完成載入、是否有權限錯誤、篩選與區域是否正確 |
| CLI v2 | 選擇預期設定來源與 Region，表達 EC2 查詢及狀態篩選 | 操作是否成功、輸出是否完整、是否只顯示篩選後的資料 |
| SDK | 建立使用預期憑證與 Region 的 EC2 client，呼叫對應查詢並處理回應 | 例外、分頁、回應資料與應用自己的判斷是否正確 |

EC2 的 `DescribeInstances` API 可依 instance ID 或 filter 查詢；官方也要求注意分頁、結果順序與最終一致性。
見 [DescribeInstances](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html)與
[EC2 API pagination](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-pagination.html)。
表中描述的是同一個查詢目標，不聲稱 Console 只發送一次 `DescribeInstances`，也不假設三者會輸出一模一樣的欄位。

如果結果為空，不能立刻說「AWS 沒有 instance」。那可能只是這次查詢範圍內沒有符合條件的資料；
如果查詢剛修改的資源，還須考慮服務文件說明的一致性行為。
若只取得第一頁，則更不能把它當成完整清單。這些都與使用哪個入口分開判斷。

## 收到成功回應，不等於服務工作已完成

結果至少要分三層看：

1. **連線與 HTTP 回應**：是否收到回應？HTTP 狀態表示什麼？
2. **API／工具層**：服務有沒有回報錯誤？CLI 或 SDK 的回傳、例外及資料代表什麼？
3. **資源／任務層**：請求啟動的工作是否到達需要的狀態？應用是否真的可用？

共通語意見 [API 共通知識索引](../api/README.md)。具體 AWS 例子是 EC2 的 `RunInstances`：
服務接受啟動請求後，仍要另外觀察 instance 狀態；官方說明可用 `DescribeInstances` 查狀態。
見 [RunInstances](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_RunInstances.html)。
即使 instance 已進入 `running`，團隊的網站是否已啟動並能處理請求，仍是另一個應用層問題。

另一個例子是 Lambda 的同步 `Invoke`：API 的 HTTP 狀態碼不反映函式執行時的錯誤，仍須檢查 `FunctionError` 與回應內容。
非同步呼叫則先排入佇列，不代表函式工作已成功完成。見 [Lambda Invoke](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html)。

所以 SDK 回傳一個 response 物件，不是所有服務任務都完成的共同保證。
該檢查哪個狀態、是否需要等待或重試，以各服務操作契約為準；
若發生逾時，也不能只憑「沒看到回應」就假設操作未執行而直接重送寫入。

## 唯讀查詢也有邊界

「沒有建立或刪除資源」不等於「沒有外部效果」。查詢仍會送出網路請求，
結果可能包含資源識別、IP、標籤或其他不宜公開的資訊；例如 EC2 的查詢契約就包含多種 instance 資訊，
見 [DescribeInstances response](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html)。
本文據此提醒，分享輸出或除錯紀錄時，也需要考慮資料內容。

讀取也不保證免費。例如 S3 列出請求、資料擷取與傳輸等計價項目，實際費用依操作、儲存類別、路徑與適用條件決定。
見 [Amazon S3 Pricing](https://aws.amazon.com/s3/pricing/)。這不是說前面的每次 EC2 查詢都會另外收取 API 費用，
而是不能由「唯讀」推定所有服務都零成本。成本的整體觀察見 [用量與成本的基本觀察](usage-and-cost-observation.md)。

## 相關文件

- [AWS 知識索引](README.md)：回查服務與主題入口。
- [帳戶、身分與權限](accounts-identities-and-access.md)：理解帳戶與存取主體。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：深入授權與角色邊界。
- [Region 與 Availability Zone](regions-and-availability-zones.md)：理解資源位置與區域範圍。
- [用量與成本的基本觀察](usage-and-cost-observation.md)：理解操作與成本資訊的關係。
- [API 共通知識索引](../api/README.md)：回查介面契約、錯誤、重試與冪等性。
