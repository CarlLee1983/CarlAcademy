# Elastic Load Balancing 與 CloudFront

網站有多台伺服器時，需要決定把請求交給誰；使用者散布各地時，也需要減少每次都連回來源的等待。
**Elastic Load Balancing（ELB）負責把流量分送至目標；Amazon CloudFront 是全球內容傳遞網路（CDN），可從邊緣快取回應，或把請求轉送至來源。**
兩者處理不同邊界，可以放在同一條請求路徑上。
見 [ELB 導論](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html)與
[CloudFront 導論](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html)。

本文介紹服務分工與請求流向，不預設操作經驗。部署位置可先看 [Region 與 Availability Zone](regions-and-availability-zones.md)；
HTTP 表示與快取的共通語意見[資源、表示與訊息](../api/resources-representations-and-messages.md)及
[快取與條件請求](../api/caching-and-conditional-requests.md)。

查證日期：2026-11-02。本文僅查閱 AWS 官方文件，未登入 AWS、建立資源、套用設定、發送應用請求或執行部署測試。
以下網站、路徑與圖解均為假想教學情境，不是效能或可用性實測。

## ELB：提供入口，再選擇處理流量的目標

ELB 是一組負載平衡服務，不是一台自行管理的反向代理主機。
一個負載平衡器可把流量分送到多個已註冊的 **target（目標）**，例如 EC2 instance 或以 IP 位址註冊的服務；
AWS 管理負載平衡器本身的容量調整。後端運算容量仍須另外提供，負載平衡不會憑空增加應用伺服器。
例如 EC2 Auto Scaling 可與 ELB 整合，但兩者分別負責容量與流量。
見 [What is Elastic Load Balancing?](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html)。

負載平衡器部署在選定的 Region，啟用其中的 AZ，再將流量導向目標。
**跨 AZ 負載平衡不等於跨 Region 容災**；cross-zone load balancing 決定每個節點能否分送到其他已啟用 AZ 的目標，
具體行為與預設值依類型及設定而異。
Internet-facing 與 internal 則區分對外或內部入口，不能把所有 ELB 都想成公開網站入口。
見 [How Elastic Load Balancing works](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html)。

### ALB 看 HTTP，NLB 著重連線與傳輸

| 類型 | 主要處理層次 | 適合理解的例子 |
| --- | --- | --- |
| Application Load Balancer（ALB） | 應用層，理解 HTTP／HTTPS 請求 | 依主機名稱或 URL 路徑，把網站與 API 請求送至不同目標群組 |
| Network Load Balancer（NLB） | 傳輸層，依協定與流量特徵選擇目標 | 分送 TCP、UDP 等流量；不以 HTTP 路徑規則作為主要模型 |
| Gateway Load Balancer（GWLB） | 網路層，整合虛擬網路設備 | 在流量路徑中放入防火牆、入侵偵測等設備 |

ALB 與 NLB 的分層及路由模型見 [ALB overview](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)與
[NLB overview](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html)；
GWLB 用途見 [GWLB overview](https://docs.aws.amazon.com/elasticloadbalancing/latest/gateway/introduction.html)。
另有前一代的 Classic Load Balancer，因此 ELB 並非只有 ALB 與 NLB 兩種；AWS 建議從 Classic 遷移至當代類型。
見 [ELB 類型](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html)。
本文用 ALB 說明網站情境，不代表所有網路協定都應改用 ALB。

### Listener、規則、target group 的關係

在 ALB 中，**listener（接聽器）**定義接收連線的協定與連接埠，支援 HTTP 與 HTTPS。
收到請求後，listener 規則決定採取什麼動作；轉送動作會選定 **target group（目標群組）**，再由其中的目標處理請求。
見 [ALB listeners](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html)與
[ALB components](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)。

例如假想網站可讓 `/api/*` 送至 API 群組，其他頁面送至網站群組。
群組是路由與健康檢查的設定邊界，不等於一台伺服器，也不等於 Auto Scaling group；
ALB 的目標型別包含 instance、IP 及 Lambda，實際註冊方式依型別而異。
見 [ALB target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)。

### 健康檢查只看得到被檢查的行為

對啟用健康檢查的目標群組，ALB 會定期檢查目標，依協定、路徑、成功狀態碼、逾時與連續成功／失敗門檻判定健康狀態。
通常會把流量送至健康目標；但若群組中已註冊的目標全部不健康，ALB 會 **fail open**，仍把流量送至這些目標。
因此不能把健康檢查解讀為「不健康目標絕對不會收到請求」。
見 [ALB target group health checks](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)。

假設 `/health` 永遠回覆成功，即使付款或文章查詢已壞掉，這個檢查仍可能通過。
這是依檢查機制推演的例子：**target 可接受流量的判定，與整個業務流程成功，是不同觀察。**
應用須決定檢查什麼依賴，並另觀察實際請求與業務結果；負載平衡器不會自動理解「訂單真的成立了」。

## CloudFront：先判斷能否在邊緣回應

CloudFront 的 **distribution（分發設定）**描述來源與傳遞規則；
**viewer** 是發出請求的使用者端，**origin（來源）**是 CloudFront 取得內容的服務，例如 S3 或 HTTP 伺服器。
使用者請求會被導向適合服務它的 edge location（邊緣節點／POP），通常考慮網路延遲，不能簡化為地圖上最近的位置。
CloudFront 支援靜態與動態網頁內容，並非只傳圖片、CSS 或 JavaScript 檔案。
見 [CloudFront 導論](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html)。

簡化的讀取路徑是：

1. Viewer 向 CloudFront 發出請求。
2. CloudFront 依 distribution 與符合的 cache behavior 判定處理方式。
3. 若有符合請求且可重用的快取回應，從邊緣回覆。
4. 若需要向來源取回內容，便發出 origin request；取得回應後轉送給 viewer，符合快取條件時保存供後續使用。

實際路徑可能還有 regional edge cache 等快取層，不是每次 POP 未命中都直接到 origin。
見 [How CloudFront delivers content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HowCloudFrontWorks.html)。
CDN 的副本是用來重用 HTTP 回應的快取，不是資料庫 replica，也不提供資料庫交易或跨地區資料一致性的替代方案。

### Cache behavior 決定哪一組規則適用

一個 distribution 可有多個來源與 **cache behavior（快取行為）**。
請求路徑依設定順序比對 path pattern，第一個符合的行為決定來源與相關規則；未匹配其他行為時採用 default behavior。
這些規則可包含 viewer 的 HTTPS 政策、允許的 HTTP 方法與快取政策。
見 [Cache behavior settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html)。

「允許轉送」與「快取回應」是不同選項。CloudFront 可以允許 POST、PUT 等方法轉送給來源，
但不會把這些寫入方法的回應當成一般讀取快取；可快取的方法是 GET、HEAD，以及選擇啟用時的 OPTIONS。
因此 API 或不快取的個人化請求仍可經過 CloudFront，不是不能快取就一定要繞過 CDN。
見同份官方文件的 [Allowed HTTP methods 與 Cached HTTP methods](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html)。

### Cache key 與轉送資訊要一起設計

**Cache key（快取鍵）**用來辨認快取中的回應。CloudFront 的 cache policy 可決定把哪些 query string、cookie 與 header 納入鍵，
也管理 TTL 等設定。相同路徑若因語言或使用者而產生不同回應，不能只用路徑就假定可共用。
見 [Control the cache key with a policy](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/controlling-the-cache-key.html)。

**Origin request policy**則可把額外資訊送至來源，而不把它加入快取鍵；已納入 cache key 的這些值也會自動轉送。
所以「來源收到 cookie」不等於「快取已按 cookie 分開」。
見 [Control origin requests with a policy](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/controlling-origin-requests.html)。

假想的公開文章可以按語言區分表示；登入會員的私人頁面則應依需求停用共用快取，並正確轉送認證資訊。
這是內容設計的例子，不是一份可直接套用的安全政策。
省略不必要的鍵可提高重用機會，但若省掉會改變回應的資訊，就可能把不該共用的內容交給另一個人。
共用快取的基本限制回看[快取與條件請求](../api/caching-and-conditional-requests.md)。

### TTL 與 invalidation 不會改寫來源

TTL 描述快取的新鮮期限。CloudFront 的 Minimum／Default／Maximum TTL 與來源的 `Cache-Control`、`Expires` 共同影響快取時間；
過期後可能向來源重新驗證，冷門內容也可能在到期前就被移出快取。
特別要注意：**Minimum TTL 大於零時，即使來源回覆 `no-cache`、`no-store` 或 `private`，CloudFront 仍會至少快取該期限。**
不能只看應用的回應標頭，就假定分發設定已符合個人資料需求。
見 [Manage cache expiration](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)。

若需要在到期前移除邊緣副本，可執行 **invalidation（失效處理）**；也可用新的版本檔名讓後續請求取得新內容。
Invalidation 不會更新來源內容，也不會清除瀏覽器或公司代理已存的副本。
見 [Invalidate files to remove content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)。
來源更新與內容路徑的配合另見 [CDN 與內容來源](cdn-and-content-origins.md)。

## 假想網站：CloudFront → ALB → targets

以下只畫主要請求方向，省略 DNS、快取中間層與資料庫。假設 ALB 是 CloudFront 的 HTTP 來源，網站程式跨兩個 AZ：

```text
各地瀏覽器（viewer）
        │ HTTPS：viewer 連線
        ▼
CloudFront（全球邊緣網路）
        ├─ 可重用的快取回應 ───────────────→ 瀏覽器
        │
        │ 需要來源時：HTTPS origin request
        ▼
Region 甲：ALB（origin）
        │ listener 規則 → 網站 target group
        ├─→ AZ 甲一：網站 target
        └─→ AZ 甲二：網站 target
```

這是依 [CloudFront 使用 ALB 來源](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html)與
[ALB 元件](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)組合的教學架構。
快取命中時可減少到 ALB 的請求；需要來源時，ALB 再負責把流量分給目標。
若來源應用或資料依賴不可用，CloudFront 並不保證所有請求仍可成功，尤其是不快取的請求。

| 問題 | ELB／以 ALB 為例 | CloudFront |
| --- | --- | --- |
| 主要邊界 | Region 中的流量入口與後端目標分送 | 全球 viewer 與來源之間的內容傳遞 |
| 主要選擇依據 | Listener 規則、目標群組與健康狀態 | Cache behavior、快取鍵與是否有可重用回應 |
| 是否代替後端程式 | 否，目標仍須執行工作 | 否，未能由快取滿足時仍需要來源 |
| 是否就是資料副本方案 | 不負責複寫應用資料 | 保存回應快取，不是資料庫複寫 |
| 能否組合 | 可作為 CloudFront 的來源 | 可將來源請求交給 ALB |

此表是依前述官方運作模型整理的概念比較，不是完整功能選型表。

## HTTPS、來源防繞過與授權是不同邊界

**Viewer → CloudFront 與 CloudFront → origin 是兩段獨立連線。**
瀏覽器看見 HTTPS，不代表來源那一段也使用 HTTPS。
CloudFront 的 viewer protocol policy 與 custom origin 的 origin protocol policy 要分別決定；
CloudFront 在邊緣終止 viewer 的 TLS，再與來源建立自己的連線。
見 [Use HTTPS with CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https.html)。

使用自訂網域時，viewer 端需要相符的憑證；custom origin 使用 HTTPS 時，CloudFront 也會驗證來源憑證與對應名稱。
ALB 若再連向 HTTPS target，則又是另一段連線，不能從網站入口的鎖頭推定整條路徑的設定。
見 [Viewer HTTPS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-viewers-to-cloudfront.html)、
[Custom origin HTTPS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-cloudfront-to-custom-origin.html)與
[ALB target group routing](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)。

把網域指向 CloudFront，也不會自動禁止使用者直接存取公開 ALB。
若要求請求必須經過 CloudFront，就要限制來源的直接入口。AWS 說明可使用 VPC origins 連到私有 ALB；
公開 ALB 的方式則可結合 CloudFront 加入的秘密自訂標頭、ALB 規則與網路來源限制。
秘密標頭若洩漏，其他呼叫端也可能偽造；僅限制為 CloudFront 的網路來源，則不能單獨辨認是哪一個 distribution。
見 [Restrict access to Application Load Balancers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html)。
私有來源與 S3 的存取控制細節留在 [CDN 與內容來源](cdn-and-content-origins.md)。

ALB 到 target 的 listener 與健康檢查連接埠也須允許通訊；target 的 security group 可以限制只接受 ALB 的 security group 作為來源。
這是網路流量邊界，見 [Security groups for your ALB](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html)。
至於誰能建立、修改 AWS 資源，或應用是否允許目前使用者讀取某筆資料，則是另外的授權問題。
**網路可達、TLS 加密與 IAM／應用授權不能互相代替**；相關原理見 [IAM 的身分與權限](iam-identities-and-permissions.md)與
[VPC 與資源連線](vpc-and-resource-connectivity.md)。

## 相關文件

- [AWS 知識索引](README.md)：回查網路與內容傳遞的服務位置。
- [Region 與 Availability Zone](regions-and-availability-zones.md)：分清跨 AZ 與跨 Region。
- [VPC 與資源連線](vpc-and-resource-connectivity.md)：理解子網路、路由與網路存取控制。
- [CDN 與內容來源](cdn-and-content-origins.md)：延伸到 S3 私有來源、OAC 與更新內容的資料路徑。
- [資源、表示與訊息](../api/resources-representations-and-messages.md)：理解 CDN 傳遞的 HTTP 表示。
- [快取與條件請求](../api/caching-and-conditional-requests.md)：回看新鮮度、重新驗證與共用快取限制。
