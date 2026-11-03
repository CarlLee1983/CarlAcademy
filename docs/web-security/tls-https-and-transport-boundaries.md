# TLS、HTTPS 與傳輸安全邊界

當瀏覽器網址列顯示已使用 HTTPS，代表這段連線透過 **TLS（Transport Layer Security）** 保護傳輸中的資料，防止路徑上的網路節點側錄或惡意修改。
但在實際部署的 Web 應用中，請求往往會先經過 CDN、反向代理或負載平衡器，再轉發給後端應用伺服器；如果不清楚 **TLS 在哪裡終止**、**首次連線如何避免降級為明文**，以及**反向代理與後端之間如何傳遞協定狀態**，即便對外啟用了 HTTPS，仍可能留下憑證外洩或標頭偽造的破口。

先備概念見[信任邊界與威脅思考](trust-boundaries.md)、[登入、Cookie 與 Session](login-and-sessions.md)與 [Linux 網路基礎](../linux/networking-basics.md)。
查證日期：2026-11-03。依 RFC 8446（TLS 1.3）、OWASP Transport Layer Security／HSTS Cheat Sheet 與 MDN 整理。
本次僅查證文件，未建立憑證或部署代理伺服器；以下為自創的筆記服務情境。

## TLS 保護了什麼，又沒有保護什麼

HTTP over TLS（HTTPS）在傳輸層提供三項核心保證：

| 保證面向 | 在筆記服務連線中的意義 | 常見誤解（TLS 不負責的事） |
| --- | --- | --- |
| 機密性（Confidentiality） | 傳輸路徑上的路由節點無法直接讀出請求中的密碼、Session Cookie 或私人筆記內容 | 不會自動把資料庫裡的靜態資料加密，也不會防止瀏覽器端惡意腳本讀取頁面 |
| 完整性（Integrity） | 傳輸途中若封包被插入或修改，接收端可偵測並拒絕，避免回應在半路被塞入惡意腳本 | 不會檢查請求者在業務上「有沒有權限修改這篇筆記」（見[存取控制](access-control.md)） |
| 端點身分驗證（Authentication） | 瀏覽器透過公開信任的憑證機構（CA）鏈與主機名稱核對，確認連線對象真的是目標網域伺服器 | 只證明「對方擁有該網域的合法憑證」，不代表該網站本身的程式沒有漏洞或非釣魚網站 |

參考 [RFC 8446：The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446.html)與 [OWASP Transport Layer Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html)。

## 首次明文請求、HSTS 與混合內容

即使伺服器已設定「收到 `http://` 請求時回傳 `301 Moved Permanently` 轉往 `https://`」，當使用者在網址列只輸入網域名稱、或點擊舊的 `http://` 連結時，瀏覽器發出的**第一個請求仍然是明文 HTTP**。
若攻擊者位於同一個區域網路並中途截獲這第一個明文請求，就能在轉址發生前擷取未標記 `Secure` 的 Cookie，或直接偽造回應阻止瀏覽器升級到 HTTPS。

為了解決這道邊界，必須搭配三項瀏覽器端防護：

1. **HTTP Strict Transport Security（HSTS）**：伺服器在 HTTPS 回應中帶上 `Strict-Transport-Security` 標頭，告知瀏覽器在指定期限內，凡是連往該網域的請求一律由瀏覽器內部直接升級為 HTTPS，不再發出明文 HTTP，且遇到憑證錯誤時不允許使用者略過。
   ```http
   Strict-Transport-Security: max-age=31536000; includeSubDomains
   ```
   注意：瀏覽器只在**已透過無憑證錯誤的 HTTPS 連線**收到此標頭時才會採信；若加上 `includeSubDomains`，必須先確認所有子網域都已支援有效 HTTPS，以免子網域服務無法連線。細節見 [MDN：Strict-Transport-Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security)與 [OWASP HSTS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html)。
2. **禁止混合內容（Mixed Content）**：HTTPS 頁面若仍透過 `http://` 載入腳本、樣式或圖片，路徑上的攻擊者只要中途修改該 `http://` 腳本，就能完全控制整個 HTTPS 頁面；所有子資源與 API 呼叫都應統一使用 `https://`。見 [MDN：Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)。
3. **Cookie 必設 `Secure` 屬性**：確保即使發生任何明文 `http://` 請求，瀏覽器也絕不在明文通道中附帶 Session Cookie。見[〈登入、Cookie 與 Session〉](login-and-sessions.md)。

## 反向代理終止 TLS 時的轉發標頭邊界

現代架構常由最外層的負載平衡器或反向代理負責**終止 TLS（TLS termination）**，解密後再將 HTTP 請求轉給內部的筆記應用伺服器：

```text
使用者瀏覽器
    │ 1. 外部網路：HTTPS（TLS 加密，核對公開憑證）
    ▼
反向代理／負載平衡器（終止外部 TLS，設定 X-Forwarded-Proto: https）
    │ 2. 內部網路：轉發至應用伺服器（可能為內部 TLS 或受隔離的內部 HTTP）
    ▼
筆記應用伺服器（根據受信任代理標頭，判斷原始請求是否為安全連線）
```

這種分工會產生兩個很常忽略的信任邊界問題：

1. **誰有權設定 `X-Forwarded-Proto` 或 `Forwarded` 標頭**：
   當後端應用與反向代理之間走內部 HTTP 時，後端應用常透過讀取 `X-Forwarded-Proto: https` 來決定「是否允許發出 `Secure` Cookie」或「是否還需要重定向至 HTTPS」。
   如果應用伺服器沒有設定**只信任來自反向代理 IP 的轉發標頭**，且反向代理也未覆寫客戶端原本帶來的同名標頭，攻擊者就能直接連向應用或透過明文連線偽造 `X-Forwarded-Proto: https`，誘導後端誤以為連線已加密。
2. **內部網路是否真的可信**：
   終止外部 TLS 後，從反向代理到應用伺服器、再到資料庫的內部連線，若跨越了共享網路或不受控節點，明文流量依然可能被內部側錄；高敏感環境仍會要求內部服務間也啟用 TLS，並限制私有子網路存取（見 [VPC 與資源連線](../aws/vpc-and-resource-connectivity.md)）。

## 憑證生命週期與後端對外連線驗證

TLS 的安全性依靠私鑰不外洩與憑證有效：

- **自動化續期與過期監控**：TLS 憑證具有明確效期；當憑證過期，瀏覽器與開啟 HSTS 的用戶端會直接阻斷連線，造成服務中斷。憑證更新應納入自動化流程並監控剩餘天數。
- **私鑰等同伺服器身分機密**：憑證的公開部分會傳給所有連線者，但對應的私鑰（private key）必須依[〈機密與敏感資料的生命週期〉](secrets-and-sensitive-data.md)嚴格限制讀取權限；若私鑰外洩，必須撤銷舊憑證並更換新金鑰對，只換同一把金鑰重簽憑證無法消除風險。
- **後端對外呼叫切勿關閉憑證驗證**：當筆記伺服器作為用戶端呼叫外部 OAuth IdP、Webhook 或雲端 API 時，開發期間常見為了跳過自簽憑證錯誤而設定「忽略 TLS 憑證檢查」；若這項設定流入正式環境，後端對外交換 token 或傳送敏感資料時就會完全失去防範中間人攻擊的能力。

## 相關文件

- [信任邊界與威脅思考](trust-boundaries.md)：分段檢查瀏覽器、反向代理與後端應用之間的通道邊界。
- [登入、Cookie 與 Session](login-and-sessions.md)：`Secure` 與 `__Host-` Cookie 前綴如何依賴 HTTPS。
- [機密與敏感資料的生命週期](secrets-and-sensitive-data.md)：TLS 私鑰的保管、輪替與外洩處置。
- [Elastic Load Balancing 與 CloudFront](../aws/load-balancing-and-cloudfront.md)：雲端入口與來源伺服器之間的分工。
- [Web 應用資安索引](README.md)。
