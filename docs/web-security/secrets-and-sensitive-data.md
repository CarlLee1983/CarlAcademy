# 機密與敏感資料的生命週期

使用者的密碼、應用的資料庫憑證，以及筆記中的個人資料都需要保護，但不能用同一種儲存方式一概處理。
先問資料用來做什麼、誰需要取得原值，以及取得後能獲得什麼能力。

查證日期：2026-11-02。依 OWASP Secrets Management、Password Storage 與 Logging 文件整理。
本次未取得、建立、輪替或撤銷任何真實憑證，未進行部署或事件處置；案例是概念說明。

## 分清三種需求

| 資料 | 使用需求 | 保護重點 |
| --- | --- | --- |
| 使用者登入密碼 | 驗證輸入是否正確，通常不需取回原密碼 | 適當的密碼雜湊與 salt，不存明文 |
| 資料庫密碼、API secret、私鑰 | 服務可能需要原始憑證才能呼叫或簽署 | 受控保管、最小權限、可輪替與撤銷 |
| 私人筆記、個人聯絡資料 | 獲准功能可能需要讀出內容 | 減少蒐集、限制存取、保護儲存與傳輸、定義保留時間 |

密碼雜湊用來支援驗證；可解密的資料加密用於其他讀回需求。
Base64 只是編碼，不提供機密性；快速的一般雜湊也不能替代專用密碼雜湊。
參考 [OWASP Password Storage：Hashing vs Encryption](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#hashing-vs-encryption)。

表中的私人資料不全是「secret」，卻仍可能有機密性要求。
是否應保存、保存多久與由誰讀取，要由產品需求與適用規範決定；本文不提供法律或合規認證。

## 從建立到失效都要有責任人

機密管理包括建立、提供給消費者、存取稽核、輪替、撤銷與到期。
只把值移出原始碼，還不能回答「哪個服務能讀」「外洩時如何停止使用」。
參考 [OWASP Secrets Management：Secret Lifecycle](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html#27-secret-lifecycle)。

對假想筆記服務，可把需求具體化：

| 問題 | 案例中的安排 |
| --- | --- |
| 誰需要資料庫憑證？ | 應用服務需要，瀏覽器不需要 |
| 能做哪些操作？ | 只授予服務所需資料與操作，遷移管理權限另行處理 |
| 測試與正式環境是否共用？ | 分開身分與憑證，避免測試環境直接取得正式能力 |
| 誰記得輪替後的相依者？ | 記錄消費者與版本，能確認應用已切換，再按政策停用舊值 |

這是教學安排，不指定機密管理產品。環境變數或檔案是提供方式，仍須評估程序、除錯輸出、備份與存取者；
不能因為使用 `.env` 就宣告已完成機密管理。

## 瀏覽器拿得到的內容不是伺服器專用機密

前端程式、靜態資源與網路回應會交給用戶端。
若某把憑證必須只由伺服器持有，就不能把它放進前端組態，再期待改名或壓縮讓使用者無法取得。
公開的識別值與私密憑證也要依提供者契約區分；有些公開 key 是設計給瀏覽器用，不能只憑名稱判斷。
這是由[信任邊界](trust-boundaries.md)推導的部署責任，具體產品規則須另查官方文件。

靜態加密和 HTTPS 分別處理儲存與傳輸，卻不會讓獲准解密的服務免於權限錯誤。
加密金鑰本身也要有獨立的存取與輪替政策，不能把金鑰與密文的保護當成同一個問題。
參考 [OWASP Secrets Management：Encryption](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html#7-encryption)。

## 日誌不能變成另一份憑證庫

診斷通常需要時間、操作類型、結果與適量的主體／資源識別資訊，不必保存完整 Authorization 標頭、Cookie、密碼或私鑰。
私人筆記全文與連線字串也不該因為方便除錯就無限制寫入。
日誌需要自己的存取控制、保留與刪除規則；不能只遮蔽畫面上的值，卻把原值送進集中式日誌。
參考 [OWASP Logging：Data to Exclude](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude)。

以本例而言，拒絕讀取可以記錄「哪個受控識別的主體、哪類操作、結果」，
不需連同被拒絕的私人文字一起記錄。這是資訊最小化的案例推演，不是固定的日誌 schema。

## 外洩後要改變可用的能力

若資料庫憑證可能外洩，只刪掉貼出的文字不會讓已複製的憑證失效。
處置需要確認影響、在提供者端撤銷或輪替、更新受影響消費者並檢查舊值不能再用；
同時保存經過適當保護的事件證據。具體順序要考慮立即暴露風險與服務相依，不能機械地等待所有服務切換後才撤銷。
參考 [OWASP Secrets Management：Revocation 與 Incident Response](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html#273-revocation)。

這裡只解釋原理，不是已發生事件或已執行輪替的報告。
同樣地，修改使用者密碼不會天然撤銷所有 Session，相關政策見[登入與 Session](login-and-sessions.md)。

## 相關文件

- [Web 應用的存取控制](access-control.md)：判斷誰能讀取敏感內容。
- [SQL Injection](sql-injection.md)：限制資料庫憑證權限與保護查詢邊界。
- [TLS、HTTPS 與傳輸安全邊界](tls-https-and-transport-boundaries.md)：傳輸層保護與伺服器私鑰管理。
- [軟體供應鏈、第三方套件與前端腳本邊界](supply-chain-and-dependency-security.md)：防止套件腳本或外部前端資源讀取並外洩憑證。
- [AWS 身分與權限](../aws/iam-identities-and-permissions.md)：雲端身分的具體情境。
- [Web 應用資安索引](README.md)。
