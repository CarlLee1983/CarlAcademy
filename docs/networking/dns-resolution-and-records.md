# DNS 網域名稱解析系統

DNS 將人類易記的階層式網域名稱轉換為機器路由所需的 IP 位址，是網際網路最核心的全球分散式階層資料庫。
如果沒有 DNS，所有網路連線都必須手動輸入不易記憶的 IPv4 或 IPv6 數值位址，且服務遷移伺服器時將造成全體用戶連線中斷。

本文接續[UDP 與無連線傳輸](udp-and-connectionless-transport.md)、[TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)與[IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)，並在資安邊界銜接[SSRF 與伺服器對外請求邊界](../web-security/ssrf-and-outbound-requests.md)。

## 階層式樹狀網域名稱空間

DNS 採用倒置的樹狀結構組織全球名稱，所有網域名稱皆以隱含的**根網域（Root Domain，表示為一個點 `.`）**為起點：

```
                    . (根網域 Root)
               /       |       \
            .com      .org     .tw (頂級網域 TLD)
           /            \        \
      example          iana      gov (二級網域 SLD)
       /    \
     www    api (主機名稱 / 子網域)
```

1. **根網域（Root Domain）**：全球共有 13 組邏輯根名稱伺服器（A 到 M，各自背後透過 Anycast 技術由全球數百個實體伺服器節點提供高可用支援）。
2. **頂級網域（TLD, Top-Level Domain）**：
   - 通用頂級域（gTLD）：如 `.com`, `.org`, `.net`。
   - 國家代碼頂級域（ccTLD）：如 `.tw`, `.jp`, `.us`。
3. **二級網域（Second-Level Domain）**：由機構或個人向註冊商（Registrar）購買並註冊的名稱，如 `example.com`。
4. **子網域與主機名稱（Subdomain / Hostname）**：網域擁有者自行劃分並指派的特定服務名稱，如 `api.example.com`。完整寫法最後應帶有點號以表示絕對網域（FQDN, Fully Qualified Domain Name），如 `api.example.com.`。

## 遞迴解析器 vs 權威名稱伺服器

理解 DNS 的第一要務，是明確區分兩種類型與職責截然不同的伺服器：

- **遞迴解析器（Recursive Resolver / Local DNS）**：
  - **角色**：用戶端的「代理跑腿者」。
  - 通常由網路服務供應商（ISP）、公司內部 IT 或公共 DNS 服務（如 Cloudflare `1.1.1.1`、Google `8.8.8.8`）提供。
  - 當用戶端向其發起查詢時，遞迴解析器負責替用戶端在全世界奔走，向多層權威伺服器反覆打聽，直到取得最終 IP 並回傳給用戶端，同時在本地建立快取。
- **權威名稱伺服器（Authoritative Name Server）**：
  - **角色**：真正擁有並儲存該網域官方記錄的「真理來源」。
  - 例如託管在 AWS Route 53 或 Cloudflare 的名稱伺服器。
  - 權威伺服器只對自己負責管轄的網域做出權威答覆（Authoritative Answer），不會替別人代為查詢其他網域。

## 完整遞迴解析流程（以查詢 `api.example.com` 為例）

當使用者在瀏覽器輸入 `https://api.example.com` 且本機沒有快取時，解析步驟如下：

```
[ 用戶端 (瀏覽器) ]
        |
        | 1. 遞迴查詢
        v
[ 遞迴解析器 (如 8.8.8.8) ]
   |                    |                    |
   | 2. 問根伺服器      | 4. 問 .com 伺服器   | 6. 問 example.com 權威
   v                    v                    v
[ 根名稱伺服器 (.) ]  [ TLD 伺服器 (.com) ] [ 權威伺服器 (ns.example.com) ]
   |                    |                    |
   | 3. 回覆：去找 .com | 5. 回覆：去找權威   | 7. 回覆：A 記錄為 93.184.216.34
   v                    v                    v
[ 遞迴解析器 (快取結果) ]
        |
        | 8. 回傳最終 IP
        v
[ 用戶端 (建立連線) ]
```

1. 用戶端先檢查瀏覽器快取、作業系統快取及本地 `/etc/hosts`。若無命中，將查詢發送給配置的遞迴解析器。
2. 遞迴解析器若無快取，先向**根名稱伺服器**詢問 `api.example.com`。
3. 根伺服器回答：「我不知道完整的 IP，但 `.com` 是由這些 TLD 伺服器管轄，請去問它們」，並附上 TLD 的 NS 記錄。
4. 遞迴解析器轉向 **`.com` TLD 伺服器**發起查詢。
5. TLD 伺服器回答：「去找 `example.com` 的權威伺服器」，並回傳其 NS 記錄。
6. 遞迴解析器向 **`example.com` 的權威名稱伺服器**詢問。
7. 權威伺服器回傳精確記錄：「`api.example.com` 的 IPv4 位址是 `93.184.216.34`，TTL 為 300 秒」。
8. 遞迴解析器將該筆結果寫入本地快取（維持 300 秒），並將最終 IP 回傳給用戶端。

## 常見 DNS 記錄類型（Resource Records）

DNS 規格（RFC 1035）定義了多種資源記錄（RR），每種類型承載特定用途的對應資料：

| 記錄類型 | 記錄內容與用途 | 範例與說明 |
| --- | --- | --- |
| **A** | Address：將網域名稱對應到 **32 位元 IPv4 位址** | `api.example.com. IN A 93.184.216.34` |
| **AAAA** | IPv6 Address：將網域名稱對應到 **128 位元 IPv6 位址** | `api.example.com. IN AAAA 2606:2800:220:1:248:1893:25c8:1946` |
| **CNAME** | Canonical Name：**網名別名**，將一個網名指到另一個規範網名 | `www.example.com. IN CNAME example.com.`（不可指向 IP） |
| **MX** | Mail Exchange：郵件交換伺服器，附帶優先級（數值愈小愈優先） | `example.com. IN MX 10 mail.example.com.` |
| **TXT** | Text：任意文字字串，廣泛用於網域所有權驗證與防垃圾郵件（SPF、DKIM） | `example.com. IN TXT "v=spf1 include:_spf.google.com ~all"` |
| **NS** | Name Server：指定哪一台名稱伺服器對該網區（Zone）具有權威管轄權 | `example.com. IN NS ns1.example.com.` |
| **PTR** | Pointer：反向解析，將 IP 位址映射回網域名稱（Reverse DNS） | `34.216.184.93.in-addr.arpa. IN PTR api.example.com.` |

### CNAME 的關鍵限制：不可與其他同名記錄並存

根據 RFC 1034 規範，若一個網域名稱配置了 CNAME 記錄，則該名稱**不能再擁有任何其他類型的記錄**（例如 TXT、MX、NS 或 A）。
這意味著網域根部（Apex Domain，如 `example.com`）絕對不能設定 CNAME，因為根部必須存在 NS 記錄與 SOA 記錄；雲端廠商為此提出了非標準的擴充機制（如 AWS Route 53 的 Alias Record 或 Cloudflare 的 CNAME Flattening），在權威伺服器端動態合成 A 記錄以規避此限制。

## TTL（存活時間）與快取特性

每筆 DNS 記錄都附帶一個整數值 **TTL（Time To Live，單位為秒）**：
- **快取的效益**：TTL 告訴遞迴解析器與用戶端作業系統，這筆紀錄在本地可以信任並重用多久，無須每次網路請求都重新查詢，大幅降低全網延遲與權威伺服器負載。
- **快取的代價**：當伺服器更換 IP 時，必須等待舊 TTL 完全倒數過期，全球所有解析器才會重新向權威伺服器抓取新 IP。因此在進行正式服務遷移前，通常需要提前數天將 TTL 調小（如由 86400 秒降至 300 秒）。
- **負向快取（Negative Caching）**：若網域名稱不存在（回傳 NXDOMAIN），解析器也會依據 SOA 記錄中的 Minimum TTL 快取這個「不存在」的結論一段時間，避免遭受惡意暴力查詢耗盡資源。

## 相關主題與參考來源

- [IP 位址、子網路遮罩與 CIDR](ip-addressing-and-subnets.md)：理解 DNS 解析後得到的 IPv4/IPv6 位址模型。
- [SSRF 與伺服器對外請求邊界](../web-security/ssrf-and-outbound-requests.md)：理解應用層透過 DNS 解析伺服器外部請求時可能遭遇的 DNS 重新綁定（DNS Rebinding）威脅。
- [RFC 1034 - Domain Names - Concepts and Facilities](https://www.rfc-editor.org/rfc/rfc1034.html)：DNS 概念與階層架構基礎規範。
- [RFC 1035 - Domain Names - Implementation and Specification](https://www.rfc-editor.org/rfc/rfc1035.html)：DNS 封包格式與記錄類型實作標準。
