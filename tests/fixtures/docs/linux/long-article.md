<!-- 範例內容：長篇文章 A。觸發本文提要與粗體、3 個以上 h2 與巢狀標題、3 欄 3 列表格、超過 680px 的 4 列寬表格、超寬程式碼（含 tab、空白與結尾空行）、框線圖、視窗縮放時才溢出的程式碼、不溢出的短程式碼、英文錯誤碼與中文詞的搜尋。 -->
# 範例長篇文章

容器啟動前必須先**拉取映像**，拉取失敗時任務會停在啟動之前。
本文是測試用範例，內容與真實文件無關，用來觸發長篇文章的版面功能。
發生 CannotPullContainerError 時，先確認映像名稱、版本與拉取權限。

查證日期：2026-01-01。本文為手寫範例，未驗證任何操作。

## 映像拉取失敗的排查

排查時從錯誤碼 `CannotPullContainerError` 開始，再依原因分流。

### 權限與名稱

映像名稱拼錯與權限不足是不同原因，不要一律增加權限。

#### 名稱檢查

先確認映像名稱與版本標籤存在。

### 網路與空間

網路逾時與磁碟空間不足都會讓拉取失敗。

| 症狀 | 常見原因 | 處理方向 |
| --- | --- | --- |
| 找不到映像 | 名稱或版本錯誤 | 核對名稱 |
| 存取被拒 | 權限不足 | 檢查角色 |
| 連線逾時 | 網路不通 | 檢查路徑 |

## 隔離等級對照

下表的內容刻意較長，讓表格寬度超過閱讀欄寬。

| 等級 | 主要觀察 |
| --- | --- |
| Level One | 最低的等級；查詢直接讀取目前的資料 |
| Level Two | 預設等級；一般查詢以語句開始時的快照讀取 |
| Level Three | 使用穩定快照，連續查詢看到相同的資料 |
| Level Four | 所有成功交易的效果須可對應逐一執行順序 |

## 程式碼與圖解

下列指令刻意拉長，用來驗證超寬程式碼的換行與捲動。

```bash
printf "保留空白與換行"
	very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument very-long-argument 

```

下圖保留框線排版：

```text
┌──────────────┐
│ 應用程式     │
└──────┬───────┘
       │ 要求服務
       ▼
┌──────────────┐
│ 核心         │
└──────────────┘
```

縮放視窗時，下列指令必須保持原樣：

```sh
printf "resize-to-fit: preserve this command while resizing the viewport"
```

短指令沒有溢出，不應出現換行按鈕：

```sh
pwd
```

結尾段落回到[GraphQL 範例短文](graphql-short.md)。
