# 軟體與套件

安裝一個文字編輯器，看起來只是把程式放進電腦；但系統還得知道它需要哪些函式庫、檔案放在哪裡、如何更新，以及移除時該留下什麼。
**套件管理把這些工作連成可追蹤的流程。**理解這層分工，就能分清「下載了安裝檔」、「更新可用版本資訊」與「真的替換系統軟體」。

本文適合已讀過[認識 Linux](what-is-linux.md)與[終端與 Shell](terminal-and-shell.md)的讀者，不要求會寫程式。
主要範例限定 **Debian 13（trixie）的 APT/dpkg 系統**，並以 **Ubuntu 24.04 LTS（noble）**官方手冊交叉核對基本命令；
Fedora 的 DNF5/RPM 只作分層對照，不延伸發行版選型、環境搭建或跨版本升級教學。
版本名稱見 [Debian trixie 發行資訊](https://www.debian.org/releases/trixie/)與 [Ubuntu noble 的 apt 手冊](https://manpages.ubuntu.com/manpages/noble/man8/apt.8.html)。

查證日期：2026-11-02。本文依官方文件整理；撰寫主機為 macOS/Darwin，**沒有運行 Linux，也沒有執行下列 Linux 命令**。
查詢與管理命令都只做文件及 Shell 語法核對，沒有實測輸出；管理命令僅供理解，並非要求現在照做。

## 軟體、原始碼與套件的差別

**軟體（software）**是程式與相關內容的廣義稱呼；**原始碼（source code）**是開發者撰寫、用來建置或執行程式的內容。
**套件（package）**則是套件系統用來交付與管理軟體的單位，包含檔案與描述它們的資訊。
以 Debian 為例，二進位套件通常是 `.deb` 檔，可包含執行檔、設定、手冊與授權資訊；
原始碼套件則另包含原始碼及 Debian 的打包資料，兩者不能直接當成同一種安裝檔。
參考 [Debian FAQ：套件的組成](https://www.debian.org/doc/manuals/debian-faq/pkg-basics.en.html)。

「二進位套件」也不表示裡面每個檔案都是機器碼：其中可以有腳本、圖片或文件。
軟體也不必恰好對應一個套件；主程式、函式庫與文件可能分開交付。
因此，應用程式的名稱、套件名稱與安裝後的命令名稱，不應預設完全相同。
Debian 對套件內容與相依欄位的定義見 [Debian Policy：binary packages](https://www.debian.org/doc/debian-policy/ch-binary.html)。

直接從原始碼建置軟體也是一條路，但「已把檔案複製到系統」不代表 dpkg 就有它的安裝紀錄。
這個差別會影響後續查詢與移除：套件資料庫只能回答它所追蹤的內容。
例如 `dpkg-query` 查的是 dpkg 資料庫，不是替整台電腦掃描所有可能存在的軟體；見 [dpkg-query(1)](https://manpages.debian.org/trixie/dpkg/dpkg-query.1.en.html)。

## 中繼資料、相依關係與套件庫如何合作

套件的**中繼資料（metadata）**描述名稱、版本、架構、相依條件等資訊。
**相依關係（dependency）**表示這個套件要正常工作，還需要其他套件或特定版本條件。
例如編輯器需要某個函式庫，套件管理器就必須一起考慮它；也可能遇到互相衝突、不能同時安裝的組合。
`Depends`、`Recommends` 與 `Conflicts` 等欄位的強度和意義不同，不能一律解讀成「必裝」。
參考 [Debian Policy：套件關係](https://www.debian.org/doc/debian-policy/ch-relationships.html)。

**套件庫（repository，亦稱套件來源）**提供套件與索引等資料；**套件管理器（package manager）**讀取這些資料，
再依來源、版本規則與本機狀態規劃要安裝、更新或移除的組合。
APT 的來源設定指定套件從哪裡取得，以及使用哪個發行系列與元件；同一個網域不代表所有版本都能互換。
參考 [sources.list(5)](https://manpages.debian.org/trixie/apt/sources.list.5.en.html)。

```text
設定好的套件來源
    │ 取得索引與版本、相依等資訊
    ▼
本機 APT 中繼資料 ──── 本機已安裝套件狀態
    │                   │
    └───── APT 規劃變更 ──┘
                 │ 下載所需套件、交給 dpkg 處理
                 ▼
       系統檔案與 dpkg 套件資料庫
```

這是理解分工的簡化圖。不是每次查詢都會連上套件庫，也不是只要找到套件名稱就一定能安裝：
來源未提供相容架構、相依條件無法滿足或索引過舊，都可能影響結果。
APT 快取可以離線查詢，但內容取決於先前更新的資料；見 [apt-cache(8)](https://manpages.debian.org/trixie/apt/apt-cache.8.en.html)。

## APT 與 dpkg 是上下層的合作

在 Debian/Ubuntu，**APT** 是處理來源、取得套件與相依解析的一組工具；`apt` 是其中面向互動使用者的命令介面。
**dpkg** 則處理 `.deb` 的解開、設定、移除及套件狀態。
日常透過 APT 安裝時，底層仍由 dpkg 處理本機套件；見 [Debian FAQ：套件管理工具分層](https://www.debian.org/doc/manuals/debian-faq/pkgtools.en.html)。

dpkg 會檢查相依條件，但不會像 APT 一樣自動從套件庫下載所缺的相依套件。
因此，拿到一個 `.deb` 檔與取得一整組可正常運作的軟體環境，是不同的事。
參考 [Ubuntu：dpkg 與 APT](https://ubuntu.com/server/docs/how-to/software/package-management/#dpkg)。

| 系統範圍 | 處理來源與相依的較高層工具 | 本機套件與資料庫工具 | 常見套件檔 |
| --- | --- | --- | --- |
| 本文 Debian/Ubuntu 情境 | APT，例如 `apt` | `dpkg`、`dpkg-query` | `.deb` |
| Fedora 傳統 RPM 套件管理情境 | DNF5，例如 `dnf5` | `rpm` | `.rpm` |

Fedora 的 [DNF5 套件介紹](https://packages.fedoraproject.org/pkgs/dnf5/dnf5/)說明它處理 RPM 套件的安裝、升級與移除；
[RPM 官方手冊](https://rpm.org/docs/latest/man/rpm.8)則描述本機套件查詢與安裝等功能。
Fedora 41 的 [Switch to DNF5 變更文件](https://fedoraproject.org/wiki/Changes/SwitchToDnf5)記錄 `dnf` 預設提供者切換為 DNF5。
這不表示所有叫 `dnf` 的系統都有同一版本，也不表示所有 Fedora 變體都以相同方式修改主系統。
這裡只比較概念；DNF5 的命令應另查 [DNF5 上游手冊](https://dnf5.readthedocs.io/en/latest/commands/index.html)，不要將 APT 選項逐字搬過去。

## 先查「來源有什麼」與「本機有什麼」

以下以套件名稱 `nano` 示範，僅展示查詢，不需要管理員權限。
是否有套件資料、實際版本與輸出內容，仍取決於本機來源及安裝狀態。

```bash
apt search nano
apt show nano
apt-cache policy nano
apt-cache depends nano
```

- `apt search` 搜尋本機已取得的可用套件資訊；`apt show` 顯示套件描述等資訊。
- `apt-cache policy` 用來觀察已安裝版本、候選版本及來源優先序；候選版本是 APT 依目前規則考慮採用的版本。
- `apt-cache depends` 顯示相依資訊，幫助理解它會牽涉哪些套件。

這些查詢依據 [apt(8)](https://manpages.debian.org/trixie/apt/apt.8.en.html)與 [apt-cache(8)](https://manpages.debian.org/trixie/apt/apt-cache.8.en.html)，
不會因為查到一個結果就把它安裝進系統。
要看本機套件狀態與記錄的檔案，則可查：

```bash
dpkg-query -s nano
dpkg-query -L nano
```

`-s` 顯示套件狀態，`-L` 列出該套件記錄的檔案。
套件不存在時可能回報找不到；狀態也可能是只剩設定檔或安裝未完成，不能僅憑名稱出現在資料庫就說它可用。
`-L` 也不是列出程式執行後產生的所有使用者資料。
參考 [dpkg-query(1)](https://manpages.debian.org/trixie/dpkg/dpkg-query.1.en.html)與 [dpkg 套件狀態](https://manpages.debian.org/trixie/dpkg/dpkg.1.en.html)。

## 更新索引、安裝與升級是不同動作

**`apt update` 更新的是本機套件資訊；`apt upgrade` 才會變更已安裝的套件。**
「讀取了新目錄」和「把目錄裡的新東西裝進系統」是兩件事。
此處的 update/upgrade 語意來自 [apt(8)](https://manpages.debian.org/trixie/apt/apt.8.en.html)，不要推廣為所有套件管理器的通用命名。

以下命令**只展示，不執行**。它們修改系統層級狀態，正常情境需要管理權限；`sudo` 代表依系統政策以較高權限執行。
先理解[使用者與權限](users-and-permissions.md)，不要只因為命令顯示在教學裡就授予權限。

| 示範命令 | 改變什麼 | 確認什麼 |
| --- | --- | --- |
| `sudo apt update` | 下載並更新本機套件索引 | 每個預期來源是否成功更新、有無簽章或連線錯誤 |
| `sudo apt install nano` | 安裝套件，必要時一併處理相依套件；也可能更新既有版本 | 來源、版本、連帶安裝／移除項目、下載與磁碟用量 |
| `sudo apt upgrade` | 更新已安裝套件，必要時可新增相依套件，但不移除既有套件 | 更新範圍、保留未更新的套件及可能的服務影響 |

表格的基本安裝流程也見 [Ubuntu：APT](https://ubuntu.com/server/docs/how-to/software/package-management/#apt)。
APT 會提出變更摘要；讀完再決定是否繼續，不能把提示當作不必理解的形式。
下載需要網路與時間，套件與索引需要儲存空間；安裝還可能執行維護腳本、改動設定或影響服務。
維護腳本的用途見 [Debian Policy：maintainer scripts](https://www.debian.org/doc/debian-policy/ch-maintainerscripts.html)，
服務影響另見[服務與日誌](services-and-logs.md)。

`apt full-upgrade` 允許為完成整體升級而移除既有套件，不能把它理解成只是「升級得更徹底」。
即使執行一般 `apt upgrade`，也不表示把 Debian 13 升到下一個 Debian 主版本；跨發行版升級有另外的前提與發行說明。
兩種 APT 升級行為見 [Ubuntu noble：apt(8)](https://manpages.ubuntu.com/manpages/noble/man8/apt.8.html)，
跨版流程的入口見 [Debian trixie 發行資訊](https://www.debian.org/releases/trixie/)。

如果更新索引失敗，不應把舊索引查到的結果當成最新狀態，更不應為了消除錯誤而關閉來源驗證。
先分辨來源、網路與認證問題，再看錯誤文字；APT 預設會拒絕未經適當驗證的來源，見 [apt-secure(8)](https://manpages.debian.org/trixie/apt/apt-secure.8.en.html)。

## 移除程式，不等於清除它的所有資料

以下仍是**僅展示的管理操作**，不是要連續執行的清理清單：

| 示範命令 | 行為 |
| --- | --- |
| `sudo apt remove nano` | 移除套件，但通常保留由套件管理的設定檔 |
| `sudo apt purge nano` | 也移除套件管理的設定；不是清空使用者家目錄 |
| `sudo apt autoremove` | 提議移除先前自動安裝、目前不再需要的相依套件；必須審閱清單 |

`remove` 與 `purge` 的差別見 [dpkg(1)：remove/purge](https://manpages.debian.org/trixie/dpkg/dpkg.1.en.html)；
自動相依清理與家目錄資料的界線見 [Ubuntu noble：apt(8)](https://manpages.ubuntu.com/manpages/noble/man8/apt.8.html)。
例如，移除編輯器不表示你用它寫的筆記也會消失；反過來，purge 刪除的系統設定可能正是日後要保留的內容。
移除前應了解受影響套件與資料位置，不要把「看起來不用了」當成足夠理由。

## 套件來源的信任與版本判讀

APT 不只是下載檔案。以 Debian 套件庫為例，來源簽署 Release 資料，透過其中的校驗值連結套件索引與套件檔案，
讓 APT 驗證取得的內容是否符合受信任來源提供的資料。
這主要是來源完整性與認證機制，**不是宣告程式沒有漏洞或惡意行為**；來源維護者、簽署金鑰或主要伺服器遭入侵仍是風險。
它也不同於逐一檢查每個 `.deb` 的獨立簽章。參考 [apt-secure(8)：信任鏈與限制](https://manpages.debian.org/trixie/apt/apt-secure.8.en.html)。

加入第三方來源，代表把更多軟體供應者納入信任與更新範圍。
必須核對供應者身分、金鑰取得方式、適用發行版及架構；不要為了裝上一個套件就混用不同發行系列的來源。
APT 的 `Signed-By` 可將來源驗證限定於指定金鑰，但仍需先決定該信任誰；設定語意見 [sources.list(5)](https://manpages.debian.org/trixie/apt/sources.list.5.en.html)。
本文不提供新增來源或略過簽章驗證的命令。

另一個常見誤解是「上游版本號較舊，所以一定沒有安全修補」。
Debian stable 可能將修補回移（backport）到既有版本，降低行為改變；應比對**完整的發行版套件版本**、安全公告與變更紀錄。
不能只拿程式顯示的上游版本，和另一個發行版或上游下載頁做大小比較。
參考 [Debian Security FAQ：舊版本與安全修補](https://www.debian.org/security/faq)。

能否取得更新，也取決於發行版的支援期間、套件範圍與啟用的來源；查到候選版本不等於獲得永久維護保證。
例如 Debian 13 的完整支援與後續 LTS 有不同期間及架構範圍，應回查 [Debian trixie 支援資訊](https://www.debian.org/releases/trixie/)。
這些規則不能直接代替 Ubuntu 或 Fedora 各自的支援政策。

## 系統套件、語言套件與容器各有管理邊界

遇到「更新軟體」時，先指出要更新哪一份安裝：

| 邊界 | 典型例子 | 要注意的責任 |
| --- | --- | --- |
| 發行版系統套件 | APT 管理的 Python 直譯器或函式庫 | 由發行版套件工具追蹤與更新 |
| 語言生態套件 | Python 專案透過 pip 管理的相依套件 | 依專案與虛擬環境管理；不能假設 APT 同時更新它們 |
| 容器映像 | 映像內的程式、函式庫與套件 | 更新映像來源與建置內容，再依部署流程替換執行中的環境 |

Python 官方包裝指南建議以虛擬環境隔離專案套件，避免不同專案與系統管理範圍互相干擾；見 [PyPA：pip 與虛擬環境](https://packaging.python.org/en/latest/guides/installing-using-pip-and-virtual-environments/)。
不要以系統管理權限隨意覆蓋發行版管理的語言套件，再期待兩套工具能共同維持一致狀態。

Docker 映像包含執行環境所需檔案並具有不可變的特性，因此「主機已更新」不表示既有映像中的使用者空間套件已更新；
需要產生並採用新的映像。這是由 [Docker：映像的組成與不可變性](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/)推得的管理邊界，
不是在容器內執行一次安裝就能取代整個交付流程。
容器內也可能再有語言套件；分層隔離並不免除各層的更新責任。

## 相關文件

- [Linux 知識索引](README.md)：查看其他基礎主題。
- [認識 Linux](what-is-linux.md)：套件管理為什麼取決於發行版。
- [檔案與目錄](files-and-directories.md)：理解套件檔案與設定所在的位置。
- [使用者與權限](users-and-permissions.md)：理解查詢與系統管理的權限差別。
- [服務與日誌](services-and-logs.md)：軟體安裝後的服務狀態與問題排查。
- [開機流程與系統管理](boot-and-system-administration.md)：系統維護與重啟的脈絡。
