# Linux 知識索引

從基本概念與日常操作開始，逐步深入系統運作。

**目前狀態：本索引列出的 14 篇文章已整理，涵蓋九篇基礎與五篇深入主題。**
各篇分別記錄適用範圍、來源與範例的驗證情況；文件查證不等於已在 Linux 執行。

## 建議閱讀順序

先讀[認識 Linux](what-is-linux.md)，分清核心、發行版與使用者空間；
再讀[終端與 Shell](terminal-and-shell.md)，理解指令如何被解讀與執行；
接著讀[檔案與目錄](files-and-directories.md)，把路徑與檔案操作放回目錄樹中理解。
日常操作可接續[文字處理](text-processing.md)、[使用者與權限](users-and-permissions.md)與[程序](processes-and-jobs.md)；
需要管理系統時，再讀套件、服務與網路三篇。
深入主題各自連回所需基礎，可依腳本、開機、儲存、效能或核心問題選讀。
也可以依問題直接查找，不需要依序完成。

## 基礎

1. **[認識 Linux](what-is-linux.md)**：作業系統、核心、發行版，以及 Linux 的使用情境。
2. **[終端與 Shell](terminal-and-shell.md)**：終端機、Shell、指令基本形式、說明文件與環境變數。
3. **[檔案與目錄](files-and-directories.md)**：檔案系統、目錄結構、路徑、檔案操作與連結。
4. **[文字處理](text-processing.md)**：檔案內容、搜尋與篩選、標準輸入輸出、重新導向與管線。
5. **[使用者與權限](users-and-permissions.md)**：使用者、群組、擁有者、權限與管理員操作。
6. **[程序](processes-and-jobs.md)**：程序、工作、前景與背景、訊號與程序狀態。
7. **[軟體與套件](software-and-packages.md)**：套件、相依關係、套件來源、安裝與更新。
8. **[服務與日誌](services-and-logs.md)**：服務管理、啟停狀態、日誌與基本問題排查。
9. **[網路基礎](networking-basics.md)**：介面、位址、路由、名稱解析、連接埠與連線觀察。

## 後續深入

- **[Shell 腳本與工作自動化](shell-scripting-and-automation.md)**：從互動命令走向可重複的腳本，處理輸入、錯誤、暫存資料與排程。
- **[開機流程與系統管理](boot-and-system-administration.md)**：韌體、載入器、核心、initramfs 與 PID 1 的分工，以及 systemd 系統的管理入口。
- **[儲存、掛載與檔案系統](storage-and-filesystems.md)**：裝置、分割區、檔案系統與掛載的關係，容量、持久掛載與資料保護。
- **[CPU、記憶體、I/O 與效能觀察](performance-observation.md)**：用工作負載、資源與時間範圍判讀指標，從觀察縮小瓶頸。
- **[Linux 核心與系統呼叫](kernel-and-system-calls.md)**：使用者空間與核心的介面、函式庫包裝、錯誤處理及呼叫追蹤。

每篇先把主題解釋清楚，再按需要補例子與操作。涉及特定發行版、版本或工具時，在該篇說明適用範圍與參考來源。

## 相關主題

- [AWS 知識索引](../aws/README.md)：閱讀 EC2 等服務時，區分客體作業系統與雲端服務的管理邊界。
- [專案入口](../../README.md)與[現行規劃](../../PLAN.md)：查看其他主題與內容維護原則。
