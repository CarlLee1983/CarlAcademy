# SSH、遠端連線與存取邊界

透過網路管理 Linux 主機時，不只關心「密碼或金鑰能不能登入」，還要確認「對面那台機器是不是原本預期的伺服器」。**SSH（Secure Shell）在不可信的網路上建立加密與完整性保護的通道，但主機身分驗證（host authentication）與使用者身分驗證（user authentication）是兩個獨立步驟，不能混為一談。**[來源：RFC 4251 §4](https://www.rfc-editor.org/rfc/rfc4251.html#section-4)、[ssh(1)](https://man.openbsd.org/ssh.1)

本文接續[使用者與權限](users-and-permissions.md)、[服務與日誌](services-and-logs.md)與[網路基礎](networking-basics.md)，並可與 Web 資安的[TLS、HTTPS 與傳輸安全邊界](../web-security/tls-https-and-transport-boundaries.md)及[機密與敏感資料的生命週期](../web-security/secrets-and-sensitive-data.md)對照。

查證日期：**2026-11-03**。依據 IETF RFC 4251 與 OpenSSH 官方手冊（`ssh(1)`、`sshd(8)`、`sshd_config(5)`、`ssh-keygen(1)`、`ssh-agent(1)`）。本文僅做文件查證，並在 Darwin 主機以 Bash 5.3.9 做 Bash 區塊 `bash -n` 語法檢查；**未對遠端主機發起連線或修改任何 SSH 設定**。命令與設定均為概念示例，不能當作實測紀錄。

## 兩道驗證：先認主機，再認使用者

SSH 協定將連線建立拆成三個主要層次：傳輸層協定（負責金鑰交換、伺服器主機驗證、加密與完整性）、使用者驗證協定（向伺服器證明客戶端使用者身分），以及連線協定（在單一加密通道上多工載送互動式 shell、遠端命令執行與連接埠轉發通道）。[來源：RFC 4251 §1](https://www.rfc-editor.org/rfc/rfc4251.html#section-1)

| 階段 | 誰向誰證明身分 | 憑證與核對位置 | 失敗時代表什麼風險 |
| --- | --- | --- | --- |
| 主機驗證（Host Authentication） | 遠端 `sshd` 向本機 `ssh` 證明主機身分 | 伺服器主機金鑰（`/etc/ssh/ssh_host_*_key.pub`）對照本機 `~/.ssh/known_hosts`（或 CA 簽章） | 可能連上冒牌主機（中間人攻擊），或伺服器重裝／換過主機金鑰 |
| 使用者驗證（User Authentication） | 本機使用者向遠端 `sshd` 證明登入身分 | 本機私鑰簽章對照遠端目標帳號的 `~/.ssh/authorized_keys`（或密碼、憑證） | 客戶端未提供正確私鑰、遠端檔案權限不合規，或伺服器政策禁止該方式登入 |

### Host key 警告不是例行跳過的提示

當首次連線到某台主機時，OpenSSH 預設（`StrictHostKeyChecking=ask`）會顯示伺服器主機公鑰的雜湊特徵值（fingerprint）並詢問是否寫入 `~/.ssh/known_hosts`。若日後同一主機名稱或 IP 回傳了不同的主機公鑰，`ssh` 會拒絕連線並發出 `REMOTE HOST IDENTIFICATION HAS CHANGED!` 警告。[來源：ssh(1) Verifying Host Keys](https://man.openbsd.org/ssh.1#VERIFYING_HOST_KEYS)

此時不應不經查證就直接刪掉 `known_hosts` 對應行或加上 `-o StrictHostKeyChecking=no`。應先向系統管理員或透過帶外管道（例如雲端主控台序列埠日誌、建置紀錄）核對主機金鑰雜湊是否確實因重建模組而變更，或改用 SSH 憑證授權中心（Host CA，`@cert-authority`）統一簽發主機憑證。

## 公鑰驗證的運作方式：私鑰永遠不離開客戶端

許多初學者誤以為公鑰登入是「把私鑰傳給伺服器比對」。實際上，**私鑰（private key）只保存在客戶端（或客戶端的 `ssh-agent` / 硬體金鑰中），永遠不會傳送到遠端伺服器**。[來源：sshd(8) Authorized_Keys File Format](https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT)

```text
本機客戶端 (ssh / ssh-agent)              遠端伺服器 (sshd)
  持有私鑰 (id_ed25519)                     持有 ~/.ssh/authorized_keys (公鑰)
           │                                         │
           ├──── 1. 主機驗證與加密通道建立 ─────────→│
           ├──── 2. 宣告要使用的公鑰與目標帳號 ─────→│
           │←─── 3. 檢查該公鑰是否授權，發起簽章挑戰 ─┤
  用私鑰對工作階段資料簽章                             │
           ├──── 4. 傳回簽章結果 (不含私鑰) ────────→│
           │                                 用公鑰驗證簽章是否有效
           │←─── 5. 驗證通過，開啟登入或命令通道 ────┤
```

### 為什麼 `authorized_keys` 放對了卻還是無法登入？

OpenSSH 的 `sshd` 預設啟用 `StrictModes yes`。如果遠端使用者家目錄、`~/.ssh` 目錄或 `~/.ssh/authorized_keys` 檔案允許「擁有者以外的人寫入」（例如權限設成 `0777` 或 `0666`），其他本機帳號就能私自寫入自己的公鑰進去；因此 `sshd` 發現權限過寬時，會直接拒絕使用該 `authorized_keys`。[來源：sshd_config(5) StrictModes](https://man.openbsd.org/sshd_config.5#StrictModes)、[sshd(8) ~/.ssh/authorized_keys](https://man.openbsd.org/sshd.8#FILES)

慣例上安全的最小權限配置：

- 家目錄（`/home/user`）：不可讓群組或其他人寫入（常見為 `0755` 或 `0750`）。
- `~/.ssh` 目錄：`0700`（僅擁有者本人可讀寫進入）。
- `~/.ssh/authorized_keys`：`0600`（僅擁有者本人可讀寫）。
- 本機私鑰（例如 `~/.ssh/id_ed25519`）：必須為 `0600`；若其他人可讀，`ssh` 客戶端會拒絕載入該私鑰。[來源：ssh(1) FILES](https://man.openbsd.org/ssh.1#FILES)

## 跳板與轉發：`ProxyJump` 與 `ForwardAgent` 的信任邊界

當內部主機不直接暴露在公開網路、必須經由跳板機（bastion / jump host）連線時，常見兩種做法的安全邊界差異很大：

| 做法 | 運作方式 | 跳板機若遭入侵的風險邊界 |
| --- | --- | --- |
| `ProxyJump`（`ssh -J bastion target`） | 本機透過跳板機建立到目標主機的端到端 SSH 通道，本機直接與目標主機完成金鑰交換與驗證 | 跳板機只轉送加密流量，**拿不到本機私鑰，也無法解密本機與目標主機之間的連線內容** |
| `ForwardAgent`（`ssh -A bastion` 再連 `target`） | 在跳板機建立 UNIX domain socket 轉發回本機的 `ssh-agent` | 跳板機上的 root（或同帳號權限者）在連線期間**可借用該 socket 要求本機 agent 簽章，冒充你登入任何允許該金鑰的主機** |

OpenSSH 官方手冊明確警告：**除非你完全信任中間主機，否則不要啟用 `ForwardAgent`**；雖然攻擊者無法從 agent 匯出私鑰原始檔，但只要連線活著，就能請你的 agent 代簽驗證挑戰。多跳連線應優先使用 `ProxyJump`（`-J`）。[來源：ssh_config(5) ForwardAgent 與 ProxyJump](https://man.openbsd.org/ssh_config.5#ForwardAgent)

### 連接埠轉發（Port Forwarding）的方向

SSH 也常被用來將特定 TCP 連接埠透過加密通道轉發，但不等於全機 VPN：

- **本地轉發（Local forwarding，`ssh -L 127.0.0.1:5432:db.internal:5432 bastion`）**：在本機監聽 `127.0.0.1:5432`，把連進來的流量經由 `bastion` 轉送到 `db.internal:5432`。若本機綁定位址未限制在 `127.0.0.1`（或啟用了 `GatewayPorts`），同網路其他機器也可能連進你的本地轉發埠。
- **遠端轉發（Remote forwarding，`ssh -R`）**：在遠端主機監聽連接埠，把流量導回本機可達的目標；須注意是否意外將內部服務暴露給遠端主機上的其他使用者。[來源：ssh(1) -L 與 -R](https://man.openbsd.org/ssh.1#L)

## 伺服器端加固與設定檢查流程

修改遠端 `/etc/ssh/sshd_config` 時，當語法錯誤或鎖錯條件，重啟服務就可能把自己鎖在門外。常見的存取邊界控制包括：

- `PermitRootLogin no`（或 `prohibit-password`）：禁止直接以 root 嘗試密碼登入，改由具名帳號登入後透過受稽核的權限提升機制管理。
- `PasswordAuthentication no`：在確認公鑰或憑證登入可用後，關閉純密碼猜測入口。
- `AllowUsers`／`AllowGroups`：明確限制允許透過 SSH 登入的帳號或群組。[來源：sshd_config(5)](https://man.openbsd.org/sshd_config.5)

以下為**語法與有效設定的檢查命令形式**（僅供對照，不在本機執行設定變更）：

```bash
# 檢查本機公鑰雜湊與演算法（只讀）
ssh-keygen -lf ~/.ssh/id_ed25519.pub

# 以詳細除錯模式觀察連線與驗證順序（不修改設定）
ssh -vvv example.invalid

# 在伺服器上重新載入 sshd 前，先驗證設定檔語法並印出最終生效值（需伺服器管理權限）
sshd -t
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication|strictmodes)'
```

重要實務習慣：在遠端修改 `sshd_config` 並執行 `systemctl reload sshd`（或 `ssh.service`，視發行版名稱而定）時，**務必保留原本已登入的終端機視窗不要關閉**，先開另一個新視窗測試能否成功登入，確認無誤後才結束原有連線。服務狀態與日誌排查可搭配 `journalctl -u ssh` 或 `journalctl -u sshd`，見[服務與日誌](services-and-logs.md)。

## 相關文件與參考來源

- [Linux 知識索引](README.md)：回到 Linux 主題總覽。
- [使用者與權限](users-and-permissions.md)：帳號、UID、檔案權限與 `sudo` 管理邊界。
- [服務與日誌](services-and-logs.md)：使用 `systemctl` 與 `journalctl` 觀察守護程序與驗證日誌。
- [網路基礎](networking-basics.md)：IP 位址、連接埠、路由與名稱解析。
- [TLS、HTTPS 與傳輸安全邊界](../web-security/tls-https-and-transport-boundaries.md)：對照加密通道與伺服器身分驗證的共通概念。
- [機密與敏感資料的生命週期](../web-security/secrets-and-sensitive-data.md)：私鑰保護、最小授權與金鑰輪替原則。

**一手來源：**

- [RFC 4251: The Secure Shell (SSH) Protocol Architecture](https://www.rfc-editor.org/rfc/rfc4251.html)
- [ssh(1) — OpenBSD manual pages](https://man.openbsd.org/ssh.1)
- [sshd(8) — OpenBSD manual pages](https://man.openbsd.org/sshd.8)
- [sshd_config(5) — OpenBSD manual pages](https://man.openbsd.org/sshd_config.5)
- [ssh_config(5) — OpenBSD manual pages](https://man.openbsd.org/ssh_config.5)
- [ssh-keygen(1) — OpenBSD manual pages](https://man.openbsd.org/ssh-keygen.1)
- [ssh-agent(1) — OpenBSD manual pages](https://man.openbsd.org/ssh-agent.1)
