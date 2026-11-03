# VPC 與資源連線

**Amazon VPC（Virtual Private Cloud）是 AWS 中由你定義的邏輯隔離虛擬網路。**
它讓你安排 IP 範圍、子網路、路由與網路存取控制，決定部署其中的資源如何連線。
VPC 不是把帳戶裡所有 AWS 服務包進同一個私有網路；例如 S3 另有服務端點與存取政策。
見 [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)與
[Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)。

本文適合想理解 AWS 資源為何能連線、為何連不到的讀者，不要求先建立過 VPC。
部署位置可先看 [Region 與 Availability Zone](regions-and-availability-zones.md)；
IP、CIDR、路由、DNS、port 與服務綁定位址的共通原理見 [Linux 網路基礎](../linux/networking-basics.md)，此處集中說明 AWS 的邊界。

查證日期：2026-11-02。本文僅查閱 AWS 官方文件，未登入 AWS、執行 CLI、建立 VPC、修改規則或實測連通性。
以下位址、路由與網站均是假想概念例子，不是可直接套用的部署設定；完整條件須依使用的服務與 IP 家族確認。

## VPC 跨 AZ，子網路各屬於一個 AZ

VPC 屬於一個 Region，可以在該 Region 的多個 AZ 中建立子網路；
**子網路（subnet）是 VPC 的一段 IP 位址範圍，每個子網路完整位於一個 AZ，不能跨 AZ。**
因此，要讓網站的運算資源分布在兩個 AZ，會在不同 AZ 的子網路中分別部署資源。
見 [VPC basics](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-subnet-basics.html)與
[Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)。

VPC 必須關聯 IPv4 CIDR，也可以加入其他 IPv4 CIDR 與 IPv6 CIDR。
例如假想 VPC 使用 `10.0.0.0/16`，兩個子網路可分別使用 `10.0.1.0/24` 與 `10.0.2.0/24`；
子網路範圍須落在 VPC 範圍內，彼此不能重疊。它們都是私有 IPv4 範圍，卻不能據此判定子網路是 public 還是 private。
見 [VPC CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html)與
[Subnet CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html)。

## 路由決定路徑，public 是子網路的路由性質

子網路必須關聯路由表；沒有明確指定時，會使用 VPC 的 main route table。
一個子網路同時使用一張子網路路由表，多個子網路可以共用同一張表。
路由以目的地前綴或 prefix list 對應到下一個 target；一般以最長匹配前綴優先。
IPv4 的 `0.0.0.0/0` 不涵蓋 IPv6，IPv6 的預設路由另用 `::/0`。
見 [Subnet route tables](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html)。

**Public subnet 有直接通往 internet gateway（IGW，網際網路閘道）的路由；private subnet 沒有這條直接路由。**
IGW 必須附加於 VPC。典型 public subnet 的 IPv4 預設路由是 `0.0.0.0/0 → IGW`，
但這不是為每個資源授權，也不會自動把每台 EC2 變成可從網際網路連入的伺服器。
見 [Enable internet access using an internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)。

以下是假想路由的閱讀例子；`local` 用於 VPC 內部通訊，其他列代表不同的對外路徑：

| 所屬路由表 | 目的地 | Target | 意義 |
| --- | --- | --- | --- |
| 兩種子網路 | `10.0.0.0/16` | `local` | VPC 內部路由；仍受相關網路規則控制 |
| Public subnet | `0.0.0.0/0` | IGW | 未匹配更具體路由的 IPv4 流量走 IGW |
| Private subnet，可選 | `0.0.0.0/0` | Public NAT gateway | 讓資源主動透過 NAT 對外連線 |
| Private subnet，可選 | S3 的 AWS-managed prefix list | S3 gateway endpoint | 指定服務的流量走 endpoint |

路由表的 destination 與 target 定義見 [Configure route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html)；
NAT 與 endpoint 的條件見下節。表中的預設路由只是在解釋選路，並非防火牆放行規則。

### EC2 放在 public subnet，不等於服務已公開

以「網際網路客戶端直接連入 EC2 的 IPv4 網站」為例，至少要分開確認：

1. VPC 有 IGW，子網路的路由表有合適的 IGW 路由，回程也能正確選路。
2. EC2 有 public IPv4 或 Elastic IP；只有 private IPv4 不能直接經 IGW 與網際網路通訊。
3. Security group 與適用的 network ACL 允許所需流量；NACL 也須允許回應方向。
4. 主機防火牆與應用設定允許該路徑，程式確實在正確介面與 port 接收請求；只綁定 loopback 的服務不能直接接收外部連線。

AWS 端條件見 [Internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)與
[Infrastructure security in Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)；
主機與 socket 邊界見 [網路基礎：綁定在哪個位址](../linux/networking-basics.md#綁定在哪個位址影響誰能連進來)。
對 EC2 而言，IGW 會在公有與私有 IPv4 間執行位址轉換，不能要求應用把 AWS 配給的 public IPv4 當成本機網卡位址來綁定。
來源：[Internet gateway：IP addresses and NAT](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html#ip-addresses-and-nat)。

## Private subnet 如何對外連線

沒有直接 IGW 路由，不表示資源不能主動取得外部資料。要先問它要連到哪裡：

| 需求 | 常見路徑 | 限制與條件 |
| --- | --- | --- |
| 主動連到網際網路 IPv4 服務 | Private subnet → public NAT gateway → IGW | Public NAT gateway 搭配 Elastic IP 與適當路由；外界不能透過這個 NAT 主動建立未受邀連線 |
| 連到支援的 AWS 服務 | VPC endpoint | 只提供所支援服務的連線，不能代替一般網際網路出口 |
| 用原生 IPv6 主動連到網際網路 | Egress-only internet gateway | IPv6 專用，允許主動連線與回應，阻止外界主動建立 IPv6 連線；須有適當 IPv6 位址與路由 |

本文的 NAT 例子指 **public NAT gateway**。典型配置把它設於 public subnet，再將 private subnet 的流量導向它。
**Private NAT gateway 不提供網際網路出口**：它可配合 transit gateway 或 virtual private gateway 連向其他私有網路，
但把它的流量送往 IGW，IGW 會丟棄。不能把所有 NAT gateway 都解釋成上網工具。
見 [NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)。

Egress-only internet gateway 不做 IPv4 NAT，也不是用 NAT 把原生 IPv6 位址藏起來。
它以有狀態的方式控制 IPv6 連線方向；IPv6 的路由與過濾要另行確認，不能由 IPv4 設定推定。
NAT gateway 另可搭配 DNS64／NAT64 處理 IPv6 到 IPv4 的情境，這與原生 IPv6 egress-only 路徑不同。
見 [Egress-only internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html)與
[NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)。

## Security group 與 NACL：過濾不等於選路

路由回答「往哪裡送」，過濾規則回答「這種流量是否允許通過」。
有 SG 規則卻沒有路由，封包不會因此找到路；有路由卻被規則阻擋，也不會連通。
兩個資源都在同一個 VPC，仍須檢查這些條件。
見 [Infrastructure security in Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)。

| 比較 | Security group（SG，安全群組） | Network ACL（NACL，網路存取控制清單） |
| --- | --- | --- |
| 關聯邊界 | 與支援的資源關聯；EC2 透過網路介面關聯 SG | 與子網路關聯，控制進出該子網路的流量 |
| 規則 | Allow；多個 SG 的允許規則合併 | Allow 與 deny；由小到大比對規則編號，第一個匹配生效 |
| 狀態 | Stateful：已允許連線的回應流量自動允許 | Stateless：請求與回應各自須符合對應方向規則 |
| 回應流量 | 不必單為已允許連線的回應另加相反方向 SG 規則 | 必須考量反方向流量，包括客戶端暫時連接埠等條件 |

來源：[Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)、
[Security group rules](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)與
[Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html)。
Stateful 不代表可略過其他邊界：回應仍可能因 NACL、路由或主機防火牆失敗。
NACL 在封包進出子網路時評估，不能當成同一子網路內資源彼此隔離的唯一機制。

SG 也可以用另一個 SG 作為來源，表達「允許與這個 SG 關聯的資源」；
這不會複製另一個 SG 的規則，也不會替兩者建立路由。
例如應用程式的 SG 可只接受 ALB 的 SG 送來的應用 port，而不是接受整段 VPC 或所有外部來源。
見 [Security group referencing](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html#security-group-referencing)與
[ALB security groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html)。

## Endpoint 提供私有路徑，IAM 決定操作權限

VPC endpoint 是連到指定服務的入口，不是把整個服務搬進你的子網路。常見兩類：

- **Gateway endpoint**：用路由表把 S3 或 DynamoDB 的服務流量導向 endpoint，不必經 IGW 或 NAT。它不使用 AWS PrivateLink。
- **Interface endpoint**：使用 AWS PrivateLink，在選定子網路建立 endpoint network interface，讓程式連到私有位址；須確認服務支援、endpoint 的 SG、NACL 與 DNS 設定。

來源：[Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)與
[Interface VPC endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html)。
不同 endpoint 的路由、DNS 與可達範圍不同，不可把 gateway endpoint 的設定套用到所有 endpoint。

**能抵達 S3，不代表能讀取 bucket 內的物件。** 網路路徑與 IAM 授權是不同判定。
Endpoint policy 可限制經該 endpoint 使用服務的身分、資源與操作，但不會取代或覆寫 identity-based policy 與 resource-based policy；
服務也不一定支援 endpoint policy。不能因 endpoint policy 允許，就宣稱呼叫者取得所有服務權限。
見 [Control access using endpoint policies](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html)，
權限模型另見 [IAM 的身分與權限](iam-identities-and-permissions.md)。

此外，建立 endpoint 不會自動關掉服務的其他入口。以 S3 為例，仍可有 public service endpoint；
是否允許其他路徑的請求，取決於 bucket policy 等服務存取控制。
若要限制只經特定 endpoint 存取，須另設並驗證對應政策，也要考量管理與 AWS 服務自身的存取需求。
見 [Gateway endpoints for Amazon S3：Control access using bucket policies](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html)。

## DNS 是找到入口，不是連線或授權的證明

AWS 為 VPC 提供 Route 53 Resolver（AmazonProvidedDNS），協助解析名稱。
VPC 的 `enableDnsSupport` 控制使用 Amazon DNS 的解析支援，`enableDnsHostnames` 與主機名稱的提供有關；
interface endpoint 使用 private DNS 時，兩者都必須啟用。名稱如何解析也受 private hosted zone、自訂 DNS 與應用解析方式影響。
見 [Understanding Amazon DNS](https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html)與
[Interface endpoint prerequisites](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html)。

DNS 查到 IP，只表示找到了位址，不表示路由、SG、NACL、TLS 或 IAM 已滿足。
對 Route 53 Resolver 的 DNS 流量也不能一概用 SG／NACL 過濾，AWS 另有 DNS Firewall 等控制。
見 [Understanding Amazon DNS：Rules and considerations](https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html)。

應用自己的公開 API 與「放在哪個 VPC」是不同層次：例如 internet-facing ALB 的公開 DNS 名稱指向它的公有位址，
它再用私有位址把請求送往後端；後端不需要因此取得 public IP。
公開名稱、公開服務入口、後端所在子網路與呼叫權限，應分別描述。
見 [Elastic Load Balancing：Load balancer scheme](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html#load-balancer-scheme)。

## 假想網站：公開 ALB、私有應用、S3 endpoint

下面是本文自行設計的概念拓樸，**未部署、未實測，也不是完整可用的架構範本**。
以 IPv4 為主，假設同一 Region 的兩個 AZ 都有 public 與 private subnet：

```text
使用者 → 網站 DNS → internet-facing ALB（HTTPS listener）
                            ↑ 網際網路路徑經 VPC 的 IGW
┌─ 一個 Region 的 VPC：10.0.0.0/16 ───────────────────┐
│ AZ 甲                         AZ 乙                │
│ public subnet                 public subnet        │
│ 10.0.1.0/24                   10.0.2.0/24          │
│ [ALB 節點]                    [ALB 節點]           │
│          └─────── 私有位址的後端連線 ────┐          │
│ private subnet                private subnet       │
│ 10.0.11.0/24                  10.0.12.0/24         │
│ [應用 EC2]                    [應用 EC2]           │
│          └──────── S3 流量 ─────────────┘          │
│       私有子網路路由表 → S3 gateway endpoint        │
└───────────────────────────────────┬───────────────┘
                                    ↓
                             同 Region 的 S3 bucket
                             （不是 VPC 內的子網資源）
```

圖中箭頭表示請求路徑，不是網路封包捕捉，也沒有畫出每個回應方向或所有連線。
一般 ALB 使用至少兩個 AZ，internet-facing ALB 再以後端私有位址轉送，這也是圖中區分入口與應用的依據。
見 [How Elastic Load Balancing works](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html)。

逐段讀這條路徑：

1. **使用者到 ALB**：名稱指向 ALB，ALB 的 scheme、IP 類型、listener、HTTPS 憑證與網路設定須符合需求；public subnet 的 IGW 路由本身不等於 listener 已存在。
2. **ALB 到應用**：應用是已註冊的 target，須處理 target health、健康檢查與應用 port；ALB 與 target 的 SG 及相關 NACL 都要符合流量。應用服務須接收來自其私有介面的請求。
3. **應用到 S3**：私有子網路的路由表選用 S3 gateway endpoint；應用不因這條路徑而需要 public IP 或 NAT，但仍須正確解析 S3 名稱，並符合 SG、NACL、endpoint policy 與 S3／IAM 的授權判定。

ALB 條件見 [ALB security groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html)與
[ELB 運作方式](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html)；
S3 條件見 [Gateway endpoints for Amazon S3](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html)。
若應用還要下載網際網路套件或呼叫第三方 API，S3 endpoint 不涵蓋那些流量，須另外設計出口。
這個例子展示了後端可服務外部使用者、同時不直接接受公網連線的組合，沒有證明網站整體已安全或高可用。

## 相關文件與查證範圍

- [AWS 知識索引](README.md)：回查整體服務關係。
- [Region 與 Availability Zone](regions-and-availability-zones.md)：理解子網路的位置與故障範圍。
- [IAM 的身分與權限](iam-identities-and-permissions.md)：補足網路可達之外的操作授權。
- [Elastic Load Balancing 與 CloudFront](load-balancing-and-cloudfront.md)：區分服務入口、轉送與內容傳遞。
- [S3、EBS 與 EFS](s3-ebs-and-efs.md)：辨認儲存資源與其存取方式。
- [Linux 網路基礎](../linux/networking-basics.md)：回查 IP、路由、DNS、socket 與分層觀察。

來源集中於 AWS VPC、PrivateLink 與 Elastic Load Balancing 官方文件，並在對應敘述附近引用。
本文完成文件查證與靜態格式、連結檢查；沒有真實帳戶的路由、DNS、連線、授權或安全測試證據，也未估算費用。
