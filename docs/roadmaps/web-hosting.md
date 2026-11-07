# 架設網站從零到上線

本篇從本地最小 HTTP 伺服器出發，循序推進至網域解析、Linux 伺服器常駐、Nginx 反向代理、HTTPS 加密、PostgreSQL 狀態持久化、身分驗證與基礎資安防禦，提供端到端可驗證的架站學習路徑。
不依賴高層次的一鍵託管黑盒子，著眼於資料流如何穿過網路、作業系統與應用程式邊界，協助開發者建立清晰且具備排錯能力的系統心智模型。

## 學習地圖全貌與推薦技術棧

全路線由八個漸進式里程碑組成。每個里程碑皆具備明確的交付目標、原理解析、動手實作與驗證指令：

1. **階段 0：本地運作 (Localhost)** —— 理解 Client/Server、Socket 與 HTTP 請求回應模型。
2. **階段 1：網路定址 (Public IP & DNS)** —— 理解公網／私網 IP、NAT、連接埠與網域名稱解析。
3. **階段 2：主機託管 (Linux VPS & systemd)** —— 掌握 SSH 安全連線、行程生命週期與系統服務常駐。
4. **階段 3：反向代理 (Nginx Reverse Proxy)** —— 實現特權連接埠隔離、靜態資源卸載與統一入口轉發。
5. **階段 4：傳輸加密 (HTTPS & Let's Encrypt)** —— 理解 TLS 握手、公私鑰密碼學與憑證自動化更新。
6. **階段 5：狀態持久化 (PostgreSQL & 連線池)** —— 理解關聯模型、ACID、連線池資源管理與資料庫遷移。
7. **階段 6：身分識別與 API 授權 (Auth & Session)** —— 處理 HTTP 無狀態性、密碼雜湊與 Cookie 安全防線。
8. **階段 7：生產防衛與維運 (Security & Operations)** —— 佈署 UFW 防火牆、防範 SQLi/XSS、日誌監控與自動備份。

### 推薦實踐技術棧（Golden Standard Stack）

為避免在初學階段陷入過度工具選型的疲勞，本路徑選用業界成熟、抽象層透明的經典技術組合：

- **作業系統**：Ubuntu 24.04 LTS（文件齊全、社群支援廣泛）。
- **後端執行環境**：Node.js（TypeScript）或 Python（FastAPI）；本篇以輕量易讀的 Node.js 原生與 Express/Hono 邏輯示範。
- **行程守護器**：Linux 原生 `systemd`（學習標準作業系統服務治理，不依賴第三方封裝）。
- **反向代理**：Nginx（學習高並發事件驅動架構與轉發標頭）。
- **關聯式資料庫**：PostgreSQL（嚴格型別約束與成熟交易機制）。
- **傳輸安全**：Let's Encrypt 搭配 Certbot（現代自動化 TLS 憑證事實標準）。

---

## 階段 0：本地運作（從靜態 HTML 到最小 HTTP 伺服器）

### 實踐目標
在個人電腦上運行最簡後端伺服器程式，並在瀏覽器輸入 `http://localhost:3000` 獲取回應網頁。

### 解開黑盒子：HTTP 請求與回應的本質
當在瀏覽器網址列敲下 Enter 時，瀏覽器會透過作業系統的 Socket 介面發起 TCP 連線，並發送一段符合 HTTP 規格的純文字：

```http
GET / HTTP/1.1
Host: localhost:3000
User-Agent: Mozilla/5.0 ...
Accept: text/html
```

伺服器應用程式監聽該通訊埠（Port 3000），讀取請求文字後，依據路由邏輯回傳對應的文字回應：

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Content-Length: 48

<!DOCTYPE html><html><body><h1>Hello World</h1></body></html>
```

### 最小後端實作（Node.js 原生示範）
建立 `server.js`：

```javascript
const http = require('node:http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>我的第一個網站：本地運作成功</h1>');
});

server.listen(3000, '127.0.0.1', () => {
  console.log('伺服器監聽於 http://127.0.0.1:3000');
});
```

### 動手驗證指令
不只透過瀏覽器渲染畫面，更要用命令列觀察未經包裝的原始 HTTP 封包：

```bash
# -i 參數顯示回應標頭 (Headers)
curl -i http://localhost:3000
```

相關概念深化見 [API 共通知識：狀態碼與錯誤表示](../api/status-codes-and-error-representations.md)。

---

## 階段 1：網路定址與公網門牌（IP, Port & DNS）

### 實踐目標
註冊或取得一個網域名稱（Domain Name），並將 DNS A 紀錄正確指向雲端主機的公有 IP 位址。

### 解開黑盒子：封包如何找到目標主機？
1. **私有 IP vs 公有 IP**：`127.0.0.1` 僅限本機內部迴路；`192.168.x.x` 或 `10.x.x.x` 是區域網路內網位址，由家用路由器透過 NAT（網路位址轉換）共享對外連線。要在網際網路上公開提供服務，主機必須具備獨立的「公有 IPv4/IPv6 位址」。
2. **通訊埠（Port）**：IP 位址決定哪一台實體或虛擬伺服器，Port 決定由該伺服器上的哪一個應用程式處理連線。Web 協定預設通訊埠為 `80`（HTTP）與 `443`（HTTPS）。
3. **網域名稱系統（DNS）解析**：
   - 使用者輸入網域名稱後，本機發起 DNS 查詢。
   - 遞迴解析器（Recursive Resolver）依序向根伺服器（Root）、頂級網域（TLD 如 `.com`）查詢，最終抵達權威 DNS 伺服器（Authoritative Name Server）。
   - **A 紀錄**：將網域對應至 IPv4（例如 `example.com -> 203.0.113.10`）。
   - **CNAME 紀錄**：將子網域別名指向另一個網域（例如 `www.example.com -> example.com`）。

### 動手驗證指令
在終端機診斷 DNS 紀錄是否生效並追蹤解析層級：

```bash
# 查詢網域的 A 紀錄數值
dig +short example.com

# 追蹤階層式解析路徑
dig +trace example.com
```

相關概念深化見 [電腦網路：IP 位址與 CIDR](../networking/ip-addressing-and-subnets.md) 與 [電腦網路：DNS 網域名稱解析系統](../networking/dns-resolution-and-records.md)。

---

## 階段 2：主機託管與常駐行程（Linux VPS & systemd）

### 實踐目標
遠端連入 Ubuntu Linux 虛擬主機，配置安全的金鑰登入，並將後端應用程式註冊為 `systemd` 服務，實現關閉連線後持續運作與故障自動重啟。

### 解開黑盒子：行程管理與 SIGHUP 訊號
當透過 SSH 終端機連線並直接執行 `node server.js` 時，該程式為目前 Shell 工作階段的子行程（Child Process）。一旦斷開 SSH 連線，控制終端機關閉會對前台行程廣播 `SIGHUP` 訊號，導致網站立即中斷。

生產環境的解決方案是將應用程式交付給 Linux 的初始化系統兼服務管理器：`systemd`（PID 1）。它負責：
- 系統開機自動掛載並啟動服務。
- 監控行程狀態，若程式拋出例外崩潰，按策略自動拉起。
- 收集 stdout/stderr 標準輸出，寫入統一的系統日誌庫（`journald`）。

### 關鍵設定：systemd 服務配置
建立服務單元檔案 `/etc/systemd/system/web-app.service`：

```ini
[Unit]
Description=Production Web Application
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/web-app
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
Environment=PORT=3000 NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

啟用並檢查服務：

```bash
# 重新載入設定檔並啟動服務
sudo systemctl daemon-reload
sudo systemctl enable --now web-app

# 檢查目前運行狀態
sudo systemctl status web-app

# 即時追蹤程式輸出日誌
journalctl -u web-app -f
```

相關概念深化見 [Linux：SSH 遠端連線安全邊界](../linux/ssh-and-remote-access.md) 與 [Linux：服務與系統日誌管理](../linux/services-and-logs.md)。

---

## 階段 3：反向代理與 Port 隔離（Nginx）

### 實踐目標
安裝 Nginx 伺服器，對外監聽標準 HTTP Port（80），並將流量內部轉發（Proxy Pass）給在 `127.0.0.1:3000` 運行的後端應用程式。

### 解開黑盒子：為什麼不讓後端直接監聽 80 Port？
1. **最小特權原則（Least Privilege）**：Linux 系統中，`1024` 以下的連接埠屬於特權埠（Privileged Ports），傳統上需要 `root` 權限才能綁定。直接以 root 身分運行包含龐大第三方相依套件的 Node/Python 程式具有極高的資安外洩風險。
2. **反向代理（Reverse Proxy）的職責分工**：
   - **連線優化**：Nginx 以高並發 C 語言事件驅動架構編寫，能高效吸收慢速連線（Slow Clients）與大量 Keep-Alive，避免後端 Worker 執行緒被佔滿。
   - **靜態檔案卸載**：圖片、CSS、JS 檔案由 Nginx 直接透過核心 `sendfile` 零拷貝機制回應用戶端，完全不耗損後端應用記憶體。
   - **多網站整併（Virtual Hosting）**：單一實體 IP 可藉由讀取 HTTP 請求中的 `Host` 標頭，分別導流向不同的後端服務。

### 關鍵實作：Nginx 虛擬主機設定
編輯 `/etc/nginx/sites-available/example.com`：

```nginx
server {
    listen 80;
    server_name example.com www.example.com;

    # 靜態資源由 Nginx 直接供應
    location /static/ {
        alias /var/www/web-app/public/;
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }

    # 動態請求轉發給後端應用
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # 保留客戶端真實 IP 與協定資訊
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

建立軟連結並重載：

```bash
sudo ln -s /etc/nginx/sites-available/example.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

相關概念深化見 [電腦網路：L4/L7 負載平衡與反向代理](../networking/load-balancing-and-reverse-proxy.md)。

---

## 階段 4：傳輸加密與憑證自動化（HTTPS & TLS 1.3）

### 實踐目標
為網站部署 TLS 憑證，強制所有 HTTP 流量 301 重定向至 HTTPS，獲取瀏覽器安全鎖頭標章。

### 解開黑盒子：TLS 握手與憑證認證機制
HTTP 傳輸的明文資料在途經 Wi-Fi 熱點或公共骨幹網路時，可輕易被封包嗅探器（Packet Sniffer）攔截讀取。TLS 提供三大核心防護：
- **保密性（Confidentiality）**：使用對稱加密演算法（AES-GCM、ChaCha20）加密對話內容。
- **完整性（Integrity）**：透過 MAC 訊息驗證碼防範資料遭到中間人竄改。
- **身份驗證（Authentication）**：憑證頒發機構（CA）以其數位簽章證明伺服器公鑰合法對應當前網域。

Let's Encrypt 採用 ACME 協定進行自動化挑戰：Certbot 在主機上暫存隨機產生的 Token 檔案，Let's Encrypt 伺服器自外網訪問 `/.well-known/acme-challenge/<TOKEN>`，驗證通過即核發有效期限 90 天的 X.509 數位憑證。

### 動手驗證指令
使用 Certbot 自動偵測 Nginx 設定並安裝憑證：

```bash
sudo apt update && sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

測試自動續期排程（systemd timer 或 cron）：

```bash
sudo certbot renew --dry-run
```

相關概念深化見 [電腦網路：TLS 傳輸層安全協定](../networking/tls-and-secure-transport.md) 與 [Web 資安：TLS/HTTPS 與傳輸邊界](../web-security/tls-https-and-transport-boundaries.md)。

---

## 階段 5：狀態持久化與關聯式資料庫（PostgreSQL）

### 實踐目標
安裝 PostgreSQL 資料庫，建立結構化資料表，並透過後端程式使用參數化查詢與連線池執行讀寫操作。

### 解開黑盒子：為什麼不能把資料寫入本機檔案？
1. **並行寫入衝突（Race Condition）**：多個 HTTP 請求同時修改本機同一個 JSON 檔案時，會發生覆蓋破壞或檔案鎖定異常。
2. **ACID 交易保證**：
   - **原子性（Atomicity）**：交易內的步驟要嘛全成、要嘛全敗回滾。
   - **一致性（Consistency）**：嚴格遵守型別、主鍵唯一性與外鍵約束。
   - **持久性（Durability）**：透過 WAL（預寫日誌）確保系統即使在斷電重開後，已提交的資料絕不丟失。
3. **連線池（Connection Pool）效益**：
   - 資料庫連線背後伴隨完整的 TCP 三向交握、TLS 驗證與行程建立開銷。
   - 透過連線池常駐固定數量的連線並重複借調，避免並發流量瞬間壓垮資料庫行程上限。

### 關鍵 SQL 與後端連線示範
資料表初始化結構：

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

Node.js（`pg` 模組）連線池與參數化查詢：

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: 5432,
  user: process.env.DB_USER || 'app_user',
  password: process.env.DB_PASSWORD,
  database: 'production_db',
  max: 20, // 連線池上限
});

async function getArticleById(id) {
  // 嚴禁字串拼接！一律採用 $1 參數化查詢防範 SQL Injection
  const { rows } = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);
  return rows[0];
}
```

相關概念深化見 [關聯式資料庫：關聯模型與資料實體](../relational-databases/relational-model.md) 與 [關聯式資料庫：分割表與連線資源管理](../relational-databases/partitioning-and-connection-management.md)。

---

## 階段 6：身分識別與 API 授權（Auth & Session）

### 實踐目標
實作使用者註冊、密碼雜湊儲存、安全 Cookie 派發與受保護路由的驗證攔截。

### 解開黑盒子：無狀態協定如何記住「你是誰」？
HTTP 本質是無狀態的，伺服器處理完一個請求後便結束連線。為了維持登入狀態，業界具備兩種經典模式：
1. **Session-Cookie 模式**：
   - 伺服器驗證帳密後，在記憶體或資料庫儲存一筆 Session 記錄（包含使用者 ID），並指派隨機不重複的 `session_id`。
   - 伺服器透過 `Set-Cookie` 標頭發送該 ID，瀏覽器後續的每個請求自動附帶 `Cookie: session_id=...`。
   - 優點：伺服器擁有完全控制權，可隨時廢止（Revoke）特定 Session 立即強制登出。
2. **密碼安全性底線**：
   - **嚴禁明文或使用單純 MD5/SHA256 存儲密碼**。
   - 必須使用具備工作因子（Work Factor）與自動加鹽（Salting）的慢速雜湊演算法（如 Argon2id 或 bcrypt），抵禦彩虹表與 GPU 暴力破解。

### 關鍵防禦：Cookie 的三大安全旗標
伺服器簽發 Cookie 時必須宣告嚴格屬性：

```http
Set-Cookie: session_id=s7x2...; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400
```

- **`HttpOnly`**：禁止前端 JavaScript（`document.cookie`）讀取該值，防範 XSS 惡意腳本竊取憑證。
- **`Secure`**：限定瀏覽器僅能在 HTTPS 加密通道中傳送，防止網路嗅探。
- **`SameSite=Lax`**：阻擋跨站第三方發起的請求攜帶憑證，防禦大多數 CSRF 攻擊。

相關概念深化見 [Web 資安：登入、工作階段與身分保持](../web-security/login-and-sessions.md) 與 [API 共通知識：Token、JWT 與金鑰架構](../api/tokens-jwt-and-jwks-architecture.md)。

---

## 階段 7：生產防衛與維運基礎（Security & Operations）

### 實踐目標
配置主機網路防火牆（UFW），防範三大 Web 核心弱點，並建立定時資料庫自動備份機制。

### 解開黑盒子：睡得安穩的四道生產防線

#### 1. 主機防火牆邊界（UFW）
只向公網開放對外通訊埠，內部資料庫（5432）與應用通訊埠（3000）嚴禁暴露：

```bash
# 預設阻擋所有連入，允許所有連出
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 僅開放 SSH, HTTP, HTTPS
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 啟用防火牆
sudo ufw enable
```

#### 2. Web 三大攻擊防護
- **SQL 注入（SQL Injection）**：全數使用參數化查詢（Prepared Statements），禁止字串拼接 SQL。詳見 [Web 資安：SQL 注入防禦](../web-security/sql-injection.md)。
- **跨站腳本（XSS）**：對於未信任的使用者輸入，渲染至 HTML 前一律進行轉義，或採用現代前端框架（React/Vue）自帶的防禦機制。詳見 [Web 資安：跨站腳本攻擊 (XSS)](../web-security/cross-site-scripting.md)。
- **跨站請求偽造（CSRF）**：依賴 `SameSite` Cookie 與 CSRF Token 機制。詳見 [Web 資安：CSRF 與瀏覽器信任邊界](../web-security/csrf-and-browser-boundaries.md)。

#### 3. 自動化備份排程
硬碟損壞與人為誤刪是資料庫的最大威脅。使用 Linux `cron` 每日自動匯出 PostgreSQL 備份。需特別注意：在非互動式的排程任務中，若僅依賴本機 Peer 認證或缺少連線主機宣告，可能因作業系統使用者不符導致認證失敗；若未啟用管線錯誤攔截，`gzip` 仍可能輸出一個空檔案而形成假備份。

因此，應透過安全受保護的密碼檔與獨立備份腳本確保原子性與正確性：

```bash
# 1. 配置非互動式認證檔 ~/.pgpass（權限嚴格設為 0600，格式為 主機:連接埠:資料庫:使用者:密碼）
echo "localhost:5432:production_db:app_user:YourStrongPassword" > ~/.pgpass
chmod 0600 ~/.pgpass

# 2. 建立具備錯誤攔截的備份腳本 /usr/local/bin/backup-db.sh
cat << 'EOF' > /usr/local/bin/backup-db.sh
#!/usr/bin/env bash
set -eo pipefail # 任一環節（含 pg_dump）失敗即終止，避免產出損毀或空白備份檔

BACKUP_DIR="/var/backups/postgres"
mkdir -p "${BACKUP_DIR}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TEMP_FILE="${BACKUP_DIR}/db_${TIMESTAMP}.sql.gz.tmp"
FINAL_FILE="${BACKUP_DIR}/db_${TIMESTAMP}.sql.gz"

# 經由本機 TCP 搭配 ~/.pgpass 完成非互動式驗證，輸出成功後原子替換
/usr/bin/pg_dump -h localhost -U app_user -d production_db | gzip > "${TEMP_FILE}"
mv "${TEMP_FILE}" "${FINAL_FILE}"
EOF

chmod +x /usr/local/bin/backup-db.sh
```

排程設定：
```bash
# 於使用者 crontab (crontab -e) 排定每日凌晨 3:00 執行
0 3 * * * /usr/local/bin/backup-db.sh >> /var/log/backup.log 2>&1
```

---

## 學習地圖與 CarlAcademy 深度專案索引對照

當在實際操作過程中需要深入理解底層原理、排查非預期錯誤或進行架構決策時，請連回以下各專案主題進行深度查閱：

| 實戰里程碑 | 當前實作環節 | CarlAcademy 深入主題對照 |
|---|---|---|
| **階段 0 & 1** | HTTP 語意、狀態碼、DNS、IP 定址 | [電腦網路知識索引](../networking/README.md)、[API 共通知識索引](../api/README.md) |
| **階段 2** | SSH 登入、行程生命週期、systemd 治理 | [Linux 知識索引](../linux/README.md) |
| **階段 3** | Nginx 反向代理、虛擬主機、轉發標頭 | [電腦網路：L4/L7 負載平衡與反向代理](../networking/load-balancing-and-reverse-proxy.md) |
| **階段 4** | HTTPS 加密傳輸、TLS 1.3 握手、Certbot | [電腦網路：TLS 安全傳輸協定](../networking/tls-and-secure-transport.md)、[Web 資安：TLS 傳輸邊界](../web-security/tls-https-and-transport-boundaries.md) |
| **階段 5** | 資料表規劃、SQL 約束、連線池資源 | [關聯式資料庫索引](../relational-databases/README.md) |
| **階段 6** | 登入 Session、Cookie 安全屬性、JWT | [Web 資安：登入與工作階段管理](../web-security/login-and-sessions.md)、[API：Token 與 JWT 架構](../api/tokens-jwt-and-jwks-architecture.md) |
| **階段 7** | SQLi、XSS、CSRF、UFW 防火牆邊界 | [Web 應用資安索引](../web-security/README.md) |
