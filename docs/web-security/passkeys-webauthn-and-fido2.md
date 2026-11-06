# Passkeys、WebAuthn 與無密碼防釣魚架構

傳統以密碼為基礎的身分驗證體系正面臨嚴重的系統性崩潰：密碼容易被撞庫與外洩，簡訊驗證碼（SMS OTP）易遭 SIM 劫持，而即便是以時間為基礎的動態驗證碼（TOTP），也早已能被中間人反向代理（Adversary-in-the-Middle, AitM）即時釣魚攔截。
基於 FIDO2 / WebAuthn 規範的**通行密鑰（Passkeys）**，透過非對稱密碼學與瀏覽器底層的 Origin 網域強制綁定，從物理原理上徹底消滅了釣魚攻擊。

## 傳統身分驗證體系的崩潰與 AitM 釣魚原理

為什麼傳統的多因素驗證（MFA）依然會被攻陷？核心原因在於「共用秘密（Shared Secret）」與「缺乏通道綁定」：

```
使用者 ──> [ 惡意釣魚伺服器 (AitM 代理 / Evilginx) ] ──> [ 真實認證伺服器 ]
             - 偽造完全相同的登入畫面                      - 取得真實登入挑戰碼
             - 攔截使用者輸入的密碼與 6 位數 TOTP  ──────> - 成功登入並取得 Session Cookie!
             - 竊取 Session Cookie 登入使用者帳號
```

在 AitM 即時代理釣魚架構下，攻擊者註冊一個外觀極其相似的網域名稱（例如 `carlacademy-security.com`）。
當使用者在假網站輸入帳號、密碼與 Google Authenticator 產生的 6 位數 TOTP 時，釣魚伺服器在數十毫秒內將這些憑證即時轉發給真實伺服器完成登入，並截獲伺服器簽發的有效 Session Cookie。使用者無論密碼設得多複雜、TOTP 算得多精準，皆無法抵禦這種即時中間人轉發。

## WebAuthn / FIDO2 的物理密碼學核心

WebAuthn（Web Authentication API，W3C 與 FIDO 聯盟標準）捨棄了一切形式的共用秘密，其安全性建立在三大底層支柱上：

1. **非對稱公開金鑰密碼學（Asymmetric Cryptography）**：
   - 伺服器端（Relying Party, RP）**只儲存公開金鑰（Public Key）**，完全不儲存任何密碼或雜湊值；即使伺服器資料庫被駭客全量拖庫，攻擊者也僅能拿到公鑰，無法憑空偽造身分。
   - **私鑰（Private Key）由用戶端硬體晶片生成並永久封印**（例如 Apple 的 Secure Enclave、Windows 的 TPM 晶片或 YubiKey 實體硬體）。私鑰永不離開設備，甚至連作業系統核心與瀏覽器本體都無法讀取私鑰內容。
2. **本機使用者驗證（User Verification, UV）**：
   - 呼叫私鑰進行簽名時，必須先通過設備本機的生物辨識（Touch ID 指紋、Face ID 人臉）或本機鎖屏 PIN 碼。這項認證完全在設備本地完成，生物特徵絕不上傳網路。
3. **終結釣魚的根本機制——Origin 網域強制物理綁定**：
   - 當瀏覽器執行 WebAuthn 呼叫時，**瀏覽器核心會自動提取當前網址列的頂層有效網域（Origin，如 `https://academy.gravito.dev`）**，強制寫入名為 `clientDataJSON` 的二進位結構體中。
   - 硬體私鑰所簽署的資料，正包含了這個由瀏覽器不可篡改寫入的 `clientDataJSON` 與伺服器挑戰碼（Challenge）。
   - **防釣魚實效**：若使用者不慎點進了釣魚網站 `https://carlacademy-phish.com`，瀏覽器在簽章時寫入的 Origin 是釣魚網站的網址；當釣魚網站將簽名送交真實伺服器時，真實伺服器核對發現 Origin 不符，**簽章在數學上必然驗證失敗**。任何 AitM 代理皆無法跨網域轉發簽名。

## WebAuthn 雙核心流程深度時序

### 1. 憑證註冊流程（Registration / Attestation）

```
[ 用戶端 (瀏覽器) ]                                              [ 伺服器 (RP) ]
        │                                                              │
        │─── 1. 發起註冊 (POST /webauthn/register/start) ─────────────>│
        │                                                              │ (生成隨機 Challenge)
        │<── 2. 回傳註冊選項 (Challenge, RP ID: "gravito.dev") ───────│
        │
(瀏覽器呼叫 navigator.credentials.create)
(本機安全晶片生成全新公私鑰對，由 Touch ID 解鎖)
        │
        │─── 3. 回傳認證回應 (Credential ID, Public Key, Attestation) ─>│
        │                                                              │ (校驗 Challenge & Origin)
        │                                                              │ (資料庫儲存 Credential ID 與公鑰)
        │<── 4. 註冊成功 ──────────────────────────────────────────────│
```

### 2. 登入認證流程（Authentication / Assertion）

```
[ 用戶端 (瀏覽器) ]                                              [ 伺服器 (RP) ]
        │                                                              │
        │─── 1. 發起登入 (POST /webauthn/login/start) ────────────────>│
        │                                                              │ (生成防重放 Challenge)
        │<── 2. 回傳登入挑戰碼 (Challenge, 允許的 Credential IDs) ──────│
        │
(瀏覽器呼叫 navigator.credentials.get)
(使用者刷臉 / 蓋指紋，安全晶片以私鑰對 Challenge + Origin 進行數位簽名)
        │
        │─── 3. 回傳 Assertion (Signature, AuthenticatorData) ─────────>│
        │                                                              │ (以公鑰驗證簽章合法性)
        │                                                              │ (確認 Challenge, Origin, UV 標記)
        │<── 4. 驗證通過，簽發本地 Session Cookie ─────────────────────│
```

## Passkeys 的兩大形態：Synced Passkeys vs Device-bound

在推行無密碼化時，必須區分通行密鑰的兩種物理儲存模型：

| 特性比較 | 同步通行密鑰（Synced Passkeys / Multi-device） | 綁定設備金鑰（Device-bound Credentials） |
|---|---|---|
| **金鑰存放媒介** | 作業系統生態同步鏈（Apple iCloud 鑰匙圈、Google 密碼管理員） | 實體硬體安全金鑰（YubiKey）或受限專用 TPM |
| **金鑰導出能力** | 透過端對端加密（E2EE）在使用者名下的所有裝置間自動同步 | **私鑰嚴格鎖死在單一硬體內部**，不可導出、不可同步 |
| **裝置遺失復原** | 換新手機登入相同 Apple/Google 帳號即可無縫恢復登入 | 實體金鑰遺失即永久失效，必須出示備用金鑰或走帳號重置 |
| **安全等級** | 極高（抵抗所有遠端網路釣魚，但依賴雲端主帳號安全） | **最高級別（軍事與金融級）**，杜絕任何數位雲端同步途徑 |
| **適用對象** | 一般終端大眾、消費者應用、一般企業員工日常登入 | 系統管理員、雲端基礎設施 root 帳號、關鍵財務主管 |

## 實務整合關鍵：條件式 UI（Conditional UI / Autofill）

為了讓使用者感受不到密碼學的複雜度，WebAuthn 支援 **條件式使用者介面（Conditional UI）**：
- 當使用者點擊登入頁面的「使用者名稱」輸入框時，瀏覽器原生輸入法下拉選單會直接彈出「使用 Passkey 登入」提示。
- 使用者輕觸指紋，整個登入流程在 1 秒內無感完成，無需輸入帳號、密碼或切換 App 查閱驗證碼。

## 相關文件與參考來源

- [Web 安全：第三方登入、OAuth 與 OIDC 邊界](oauth-and-federated-login.md)：了解前端轉址與身分驗證基礎。
- [Web 安全：登入、Cookie 與 Session](login-and-sessions.md)：理解登入後本地會話的維護與終止。
- [API 授權：Token 架構、JWT 簽章與 JWKS 金鑰輪替](../api/tokens-jwt-and-jwks-architecture.md)：掌握非對稱數位簽章演算法。
- W3C, *Web Authentication: An API for accessing Public Key Credentials Level 3 (WebAuthn)*.
- FIDO Alliance, *FIDO2: WebAuthn & CTAP specifications*.
- Cybersecurity & Infrastructure Security Agency (CISA), *Implementing Phishing-Resistant MFA*.
