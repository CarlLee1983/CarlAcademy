# 細粒度授權、ReBAC 與策略引擎

OAuth Scope 能夠有效劃定系統的功能範圍（例如「具備文章讀取權限」或「具備文章修改權限」），但它無法回答真實業務中複雜的資料層級問題：「使用者 A 是否能修改組織 B 內部處於『審核中』狀態的文章 C？」。
將授權邏輯從業務程式碼中抽離，並以細粒度授權（Fine-Grained Authorization, FGA）與策略即程式碼（Policy-as-Code）統一治理，是解決權限邏輯失控與提升系統可審計性的必經之路。

## 授權模型的演進歷程

隨著系統規模與協同複雜度的增長，業界的授權模型歷經了三個重要階段：

```
[ 1. RBAC (角色型) ] ──(面臨角色爆炸)──> [ 2. ABAC (屬性型) ] ──(面臨關聯圖複雜)──> [ 3. ReBAC (關係型) ]
依據靜態角色名稱授權                     依據主體、資源與環境屬性評估                     依據實體之間的圖論關係鏈遞移
(Admin, Editor, Reader)                 (Status, Dept, Time, IP)                       (Owner, Member, Parent Folder)
```

### 1. RBAC（Role-Based Access Control，角色存取控制）
- **機制**：將權限賦予角色（Role），再將角色賦予使用者。
- **痛點——角色爆炸（Role Explosion）**：
  當業務需要支援多租戶、資料隔離或局部管理時，單純的角色模型會迅速崩潰。例如系統被迫建立 `Finance_Editor`、`Marketing_Viewer`、`Dept_A_Reviewer` 等數百個專屬角色，導致指派維護混亂且權限難以回收。

### 2. ABAC（Attribute-Based Access Control，屬性存取控制）
- **機制**：透過布林表達式動態評估四維屬性：
  - **主體屬性（Subject）**：使用者部門、安全等級、職級。
  - **資源屬性（Resource）**：文章作者、所屬專案、機密等級、審核狀態（如 `status == "draft"`）。
  - **操作屬性（Action）**：讀取、編輯、發布、刪除。
  - **環境屬性（Environment）**：存取時間、使用者 IP 來源、裝置合規狀態。
- **痛點**：表達力極強，但在查詢「列出我能看的所有文章」時，難以進行跨資料庫反向索引與高效圖譜遞移。

### 3. ReBAC（Relationship-Based Access Control，關係存取控制）
- **起源**：由 Google 在其全球授權系統論文 *Zanzibar: Google’s Consistent, Global Authorization System*（USENIX ATC 2019）中提出，成為現代 Google Drive、GitHub、Figma 等協同軟體的標準底層模型。
- **機制**：將世界上的所有權限抽象為一組**關係三元組（Relation Tuples）**：
  $$\langle \text{object} \rangle \# \langle \text{relation} \rangle @ \langle \text{user / object\#relation} \rangle$$
  - `document:42#owner@user:carl`（Carl 是文章 42 的擁有者）
  - `folder:tech#viewer@group:engineers#member`（工程師群組的所有成員是 tech 資料夾的檢視者）
  - `document:42#parent@folder:tech`（文章 42 的上層目錄是 tech 資料夾）
- **遞移計算**：系統透過圖論遍歷（Graph Traversal）判定權限。若文章 42 宣告「檢視權繼承自 parent 的 viewer」，則系統能沿圖自動推導出工程師群組的所有人皆可檢視文章 42。

## 策略即程式碼（Policy-as-Code）：解除業務與權限的耦合

在傳統系統中，授權判斷經常被硬編碼分散在各個 Controller 或 Service 之中：

```go
// 脆弱且難以審計的硬編碼授權
if user.Role == "admin" || (article.AuthorID == user.ID && article.Status == "draft") {
    // 允許編輯
}
```

這種做法存在顯著弊端：權限規則分散四處、無法即時調整（改規則需重新編譯上線）、跨多個微服務無法統一復用，且資安稽核團隊無法查驗全站的確切授權邊界。

### 核心架構：PEP 與 PDP 的職責解耦
依據 XACML 規範，現代架構將授權流程切分為兩大角色：

1. **策略強制點（Policy Enforcement Point, PEP）**：
   - 位於 API 閘道、微服務中介軟體（Middleware）或業務入口。
   - 負責攔截請求，收集主體與環境資訊，向 PDP 發起詢問：「使用者 A 欲對資源 B 執行操作 C，是否放行？」，並無條件執行 PDP 的決策。
2. **策略決策點（Policy Decision Point, PDP）**：
   - 獨立的授權引擎（如 Open Policy Agent / OPA、AWS Cedar、OpenFGA）。
   - 引擎載入獨立的聲明式策略檔案（Policy Files），在記憶體中以極致速度（通常小於 1 毫秒）完成規則計算並回傳 `allow / deny`。

```
[ 用戶端請求 ] ──> [ 策略強制點 (PEP / API Gateway / Service) ] ──(放行)──> [ 業務邏輯執行 ]
                                   │                        ▲
                     1. 詢問決策 (Check Request)     2. 回應決策 (Allow/Deny)
                                   ▼                        │
                       [ 策略決策點 (PDP / OPA / Zanzibar 引擎) ]
                                   │
                         讀取聲明式規則庫 (Rego / Cedar Policies)
```

## 列表查詢過濾難題：Partial Evaluation（部分求值）

細粒度授權最棘手的架構瓶頸，在於**集合列表查詢（List APIs）**。

### 「遍歷過濾」的效能災難
假設資料庫有 500,000 篇文章，使用者呼叫 `GET /articles`：
- 若先從資料庫拉出全部 50 萬筆資料，再於記憶體中逐筆呼叫 PDP 檢查 `can_read(user, article)`，不僅會撐爆應用程式記憶體，更會產生高達數秒的毀滅性延遲。

### 解法：策略下推至 SQL（Query Rewriting / Partial Evaluation）
現代授權引擎具備「部分求值」能力：
1. PEP 向 PDP 詢問：「在已知目前使用者身分的前提下，請給我該使用者能讀取文章的**先決抽象條件**。」
2. 授權引擎將複雜的策略規則編譯為抽象語法樹（AST），回傳簡化後的布林表達式：
   ```text
   (status == "published") OR (author_id == "user-42") OR (tenant_id == "tenant-8" AND role == "editor")
   ```
3. 應用層的 ORM 或資料存取層將此條件無縫拼裝為 SQL 的 `WHERE` 子句：
   ```sql
   SELECT * FROM articles
   WHERE (status = 'published' OR author_id = 42 OR (tenant_id = 8 AND is_editor = true))
   ORDER BY created_at DESC
   LIMIT 20;
   ```
資料庫得以直接利用索引在磁碟層過濾資料，在保證細粒度授權約束的同時，維持百萬級資料的高效分頁查詢。

| 授權引擎生態 | 核心模型 | 策略語言 | 適用情境 |
|---|---|---|---|
| **Open Policy Agent (OPA)** | 廣義 ABAC / 通用策略 | Rego | Kubernetes 準入控制、API 閘道邊界驗證、微服務授權 |
| **Google Zanzibar / OpenFGA** | ReBAC（關係圖譜） | DSL（基於關聯三元組） | 跨組織協同、大型 SaaS、資料夾巢狀繼承與分享權限 |
| **AWS Cedar** | 高效 ABAC / RBAC | Cedar | 具備自動化推理與數學證明的極致效能授權判定 |

## 貫穿案例：文章與知識庫系統的階層授權設計

在 CarlAcademy 的組織專欄中，權限呈現階層結構：

1. **關係定義**：
   - 使用者可以加入某個技術組織（`organization:carl-team#member@user:alice`）。
   - 專欄屬於特定組織（`column:distributed-systems#owner@organization:carl-team`）。
   - 文章屬於特定專欄（`article:raft-consensus#parent@column:distributed-systems`）。
2. **策略宣告（以 ReBAC 語意）**：
   - 「能編輯專欄的條件是：為該專欄的 owner，或是該專欄 parent 組織的 admin。」
   - 「能檢視文章的條件是：文章為公開狀態，或是該文章上層專欄的 member。」
3. 透過圖論引擎（如 OpenFGA），任何文章繼承與權限異動皆為圖節點指標變更，完全不需要在資料庫每筆文章記錄上重複寫入冗餘的角色欄位。

## 相關文件與參考來源

- [微服務與 API 閘道授權架構](microservices-and-api-gateway-authorization.md)：了解服務間身分傳遞與 Token Exchange。
- [OAuth 2.0 授權模式與許可類型](oauth-authorization-flows-and-grant-types.md)：回顧粗粒度 Scope 的界限。
- [Web 安全：Web 應用的存取控制](../web-security/access-control.md)：掌握 IDOR 與垂直／水平越權基礎防護。
- Radha Jagadeesan et al., *Zanzibar: Google’s Consistent, Global Authorization System*, USENIX ATC, 2019.
- Cloud Native Computing Foundation (CNCF), *Open Policy Agent Documentation*.
- OpenFGA (CNCF Sandbox Project), *Relationship-Based Access Control Architecture Guide*.
