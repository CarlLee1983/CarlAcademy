# TLS 傳輸層安全：交握協商、密鑰交換與安全通道

在不可靠且未經加密的網際網路中，傳輸層安全協定（Transport Layer Security, TLS）透過非對稱密碼學、數位憑證與對稱加密通道，為端對端通訊建立機密性、完整性與身分驗證防護。
無論是網頁瀏覽（HTTPS）、安全郵件（SMTPS）還是 API 調用，TLS 皆作為承接傳輸層（TCP / QUIC）與應用層（HTTP）之間的關鍵安全護盾。

本文接續[TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)與[HTTP 演進：從 HTTP/1.1、HTTP/2 到 HTTP/3 (QUIC)](http-evolution-and-quic.md)，並與 Web 資安[信任邊界與威脅思考](../web-security/trust-boundaries.md)及[機密與敏感資料的生命週期](../web-security/secrets-and-sensitive-data.md)對照。

## TLS 的三大安全承諾

在開放網路中傳輸明文資料，隨時面臨封包監聽、內容竄改與伺服器偽造三大威脅。TLS（前身為 SSL，現代規範為 RFC 8446 定義的 TLS 1.3）向通訊雙方提供三大核心保證：

1. **機密性（Confidentiality / Encryption）**：所有應用層酬載皆經由高強度對稱密鑰加密傳輸，任何中間路由設備或竊聽者只能看見密文亂碼。
2. **完整性（Integrity）**：使用帶有關聯資料的認證加密（AEAD）或訊息鑑別碼（MAC），任何在傳輸途中遭遇惡意篡改或意外位元反轉的封包，皆會被接收端立即偵測並拒絕。
3. **真實性（Authentication）**：透過公開金鑰基礎設施（PKI）與數位憑證，驗證連線遠端伺服器（或用戶端）的真實身分，防範中間人攻擊（Man-in-the-Middle, MitM）。

## 公開金鑰基礎設施（PKI）與數位憑證

要建立加密通道，用戶端必須先確定正在通訊的對象就是真正的目標伺服器，而非惡意偽裝的中間人。這套信任架構建立在 **X.509 數位憑證** 與 **憑證授權單位（Certificate Authority, CA）** 之上：

### 1. 信任鏈（Chain of Trust）

- **根憑證（Root CA）**：作業系統與瀏覽器出廠時，皆內建了一組受嚴格審核的受信任根憑證清單。
- **中介憑證（Intermediate CA）**：根憑證平時離線封存以策安全，由中介 CA 負責日常簽發終端憑證。
- **伺服器憑證（Leaf Certificate）**：伺服器向 CA 證明自己對特定網域名稱擁有控制權後，CA 用其私鑰對該伺服器的公鑰與網域名稱簽署數位簽章。用戶端連線時取得這條憑證鏈，依序向上驗證簽章，直到回溯至作業系統內建的根 CA。

### 2. SNI 與 ALPN 擴充

- **伺服器名稱指示（SNI, Server Name Indication / RFC 6066）**：在單一實體 IP 託管數百個不同網域名稱的虛擬主機或 CDN 架構中，用戶端在發起 TLS 握手的明文 `ClientHello` 封包中，必須先帶上目標網域名稱（SNI），伺服器才能正確選擇對應的憑證與私鑰回傳。
- **應用層協定協商（ALPN, Application-Layer Protocol Negotiation / RFC 7301）**：允許在 TLS 握手過程中同時協商上層應用協定（如 `h2` 代表 HTTP/2、`http/1.1` 代表 HTTP/1.1），避免交握完成後還需額外進行協定探測的往返延遲。

## TLS 1.2 vs TLS 1.3：交握流程的革命性演進

TLS 的生命週期分為兩大階段：**交握協定（Handshake Protocol）**負責身分驗證與協商密鑰，**紀錄協定（Record Protocol）**負責後續資料的對稱加密傳輸。

```
[TLS 1.2 Handshake (2-RTT)]
Client                                           Server
  | ----- 1. ClientHello (Ciphers, Random_C) --------> |
  | <---- 2. ServerHello, Certificate, ECDHE_Key ---- |
  | ----- 3. Client_Key, [ChangeCipherSpec], Fin ----> |
  | <---- 4. [ChangeCipherSpec], Finished ------------ | (2 RTT 耗時)
  | <==== 雙向加密應用資料傳輸 =======================> |

[TLS 1.3 Handshake (1-RTT)]
Client                                           Server
  | ----- 1. ClientHello (Key Share, Ciphers) -------> |
  | <---- 2. ServerHello, Certificate, Finished ------ | (1 RTT 完成!)
  | <==== 3. 雙向加密應用資料傳輸 ====================> |
```

### 1. TLS 1.2 握手流程（2 RTT）

傳統 TLS 1.2（RFC 5246）需要經歷兩次完整的往返往返時間（2 RTT）：
1. 用戶端送出支援的密碼套件清單與隨機數；
2. 伺服器挑選演算法、出示憑證與 Diffie-Hellman 金鑰片段；
3. 用戶端驗證憑證後計算出預主密鑰（Pre-Master Secret），回傳客戶端金鑰交換資訊與 `Finished` 驗證訊息；
4. 伺服器確認無誤回傳 `Finished`，雙方正式切換至對稱加密通道。

### 2. TLS 1.3 核心革新（RFC 8446）

2018 年發布的 TLS 1.3 帶來了重大的安全與效能躍升：

- **延遲減半（1-RTT Handshake）**：用戶端大膽推測伺服器支援的主流橢圓曲線演算法（如 X25519），在第一步 `ClientHello` 中直接附帶自己的金鑰共享片段（Key Share）。伺服器收到後即可直接計算出對稱密鑰，並在第二步回傳自己的金鑰片段與已加密的憑證與 `Finished`。通訊雙方在 1 RTT 內即可開始傳輸加密資料。
- **棄用不安全演算法**：徹底廢除靜態 RSA 金鑰交換、CBC 模式區塊加密、RC4、MD5 與 SHA-1，僅保留經安全驗證的現代 AEAD 加密套件。
- **強制完美前向保密（PFS, Perfect Forward Secrecy）**：全面採用臨時金鑰交換（如 ECDHE）。即使未來伺服器的私鑰不幸外洩，攻擊者也無法回溯解密過去曾截獲錄製的歷史加密通訊流量。
- **0-RTT 早期資料（Early Data）**：若先前已建立過連線，用戶端可利用快取的會話票據（Session Ticket），在發送第一個交握封包時一併夾帶應用層請求資料。需要注意的是，**0-RTT 資料不具備前向保密且容易遭受重放攻擊（Replay Attack）**，通常僅限於嚴格等冪的 HTTP GET 請求。

## 紀錄協定（Record Protocol）與對稱加密

一旦交握成功，雙方推導出獨立的通訊對稱密鑰（發送與接收金鑰分離），隨後進入**紀錄協定**階段：

1. **認證加密（AEAD, Authenticated Encryption with Associated Data）**：現代 TLS 僅支援 AEAD 演算法（如 `AES-128-GCM`、`AES-256-GCM`、`CHACHA20-POLY1305`）。它在將明文切塊加密的同時，產出固定長度的認證標籤（Auth Tag），一次性解決機密性與防篡改保證。
2. **防重放序號（Implicit Sequence Number）**：TLS 紀錄層在內部維護遞增的 64 位元整數序號，該序號參與認證標籤運算，但不隨封包明文傳送。這能確保攻擊者無法調換封包順序、刪除封包或將先前的封包重新發送一次。

## 實務邊界與常見誤解

- **TLS 終止（TLS Termination）**：在企業與雲端架構中，公網流量常在邊界反向代理、負載平衡器或 CDN 上解密（終止 TLS），內網再以明文或內部專屬憑證轉發後端服務。這意味著端對端的安全邊界只延伸到邊界反向代理，後端服務網段仍需具備適當的網路隔離。
- **憑證過期與撤銷檢查**：憑證包含明確的有效起始與到期日。過期憑證會觸發瀏覽器強烈的危險攔截警告。憑證撤銷查詢機制（CRL 與 OCSP Stapling）可讓伺服器預先向 CA 取得最新的撤銷證明並釘選在交握中，避免用戶端阻斷等待驗證。
- **SNI 明文洩漏與 ECH**：在標準 TLS 1.3 中，雖然憑證與後續流量已加密，但最初 `ClientHello` 攜帶的 SNI 網域名稱仍是明文可見的，中間網路業者仍能得知用戶正在訪問哪個網站。最新發展的 ECH（Encrypted Client Hello）正致力於將整個 ClientHello 完全加密，進一步保護用戶隱私。

## 相關主題與參考來源

- [TCP 基礎：連線生命週期與流量控制](tcp-connection-and-flow-control.md)：理解 TLS 握手所依託的可靠底層傳輸通道。
- [HTTP 演進：從 HTTP/1.1、HTTP/2 到 HTTP/3 (QUIC)](http-evolution-and-quic.md)：理解 TLS 1.3 如何與 QUIC 深度整合實現極致低延遲。
- [負載平衡與反向代理：L4、L7 與流量調度](load-balancing-and-reverse-proxy.md)：探討邊界設備上的 TLS 卸載（Offloading）與安全通道分工。
- [機密與敏感資料的生命週期](../web-security/secrets-and-sensitive-data.md)：理解密鑰安全存放、憑證輪替與外洩因應原則。
- [RFC 8446 - The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446.html)：IETF TLS 1.3 核心協定規範。
- [RFC 5246 - The Transport Layer Security (TLS) Protocol Version 1.2](https://www.rfc-editor.org/rfc/rfc5246.html)：IETF TLS 1.2 協定標準。
- [RFC 6066 - Transport Layer Security (TLS) Extensions](https://www.rfc-editor.org/rfc/rfc6066.html)：定義 Server Name Indication (SNI) 等核心擴充。
