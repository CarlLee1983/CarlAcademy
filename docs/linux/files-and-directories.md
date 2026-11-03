# 檔案與目錄

在 Linux 上找設定、整理下載檔或執行程式，都會用到路徑。先分清楚「檔案放在哪裡」「目前站在哪個目錄」，再理解檔名與檔案的關係，就能看懂多數日常檔案操作。

本文適合已能開啟終端機、輸入指令的讀者；可先讀 [認識 Linux](what-is-linux.md) 與 [終端與 Shell](terminal-and-shell.md)。

> 適用範圍與查證：2026-11-02，依 Linux man-pages 6.19、GNU Coreutils 9.11 線上手冊、Bash 線上手冊與 FHS 3.0 查證。指令假設 GNU/Linux、Bash 及 GNU Coreutils；不保證 BusyBox、其他 Shell 或 macOS 內建工具的選項相同。本次工作環境是 macOS，未取得 Linux 執行環境；以下範例均未在 Linux 執行，文字描述的是依手冊推得的預期行為，沒有實測輸出。

## 一棵目錄樹，可以接上多個檔案系統

檔案系統（filesystem）負責組織檔案與相關資訊，例如檔案內容、類型及時間。目錄則組織名稱，讓我們能沿路徑找到檔案。Linux 區分一般檔案、目錄、符號連結，也有裝置檔案、socket 等類型；因此看到一個路徑，不代表它一定是儲存在磁碟上的普通文字檔。[Linux man-pages：inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)

Linux 的目錄樹從根目錄 `/` 開始，路徑以 `/` 分隔各層。下面只是示意，不是每台主機的完整配置：

```text
/
├── etc/
├── home/
│   └── alice/
│       └── notes/
│           └── linux.txt
├── usr/
├── var/
└── mnt/
    └── backup/       ← 可以是另一個檔案系統的掛載點
```

掛載（mount）把一個檔案系統接到某個目錄；接點稱為掛載點。例如另一顆儲存裝置的檔案系統掛在 `/mnt/backup`，就能從 `/mnt/backup/report.txt` 存取其中的檔案。整棵樹看似連續，不代表底下只有一個檔案系統。掛載期間，該路徑會通往被掛上的檔案系統，原來目錄底下的內容會被遮住，而非被刪除。這裡只說明概念，不操作掛載。[Linux man-pages：path_resolution(7)](https://man7.org/linux/man-pages/man7/path_resolution.7.html)

## 常見目錄：先記用途，再查實機

FHS（Filesystem Hierarchy Standard）協調常見檔案的擺放位置。它提供慣例與要求，但發行版、安裝方式及管理員決策仍會造成差異；不能把這張表當成所有 Linux 系統都完全相同的保證。以下用途依 [FHS 3.0 原文（Debian 保存版本）](https://sources.debian.org/data/main/d/debian-policy/4.7.4.1/fhs-3.0.html) 整理。

| 路徑 | 常見用途 |
| --- | --- |
| `/etc` | 主機的系統設定 |
| `/home` | 一般使用者家目錄，例如 `/home/alice`；實際位置可不同 |
| `/root` | root 使用者的家目錄；與根目錄 `/` 不同 |
| `/usr` | 系統程式、函式庫及共享資料；不是一般使用者的個人文件夾 |
| `/usr/local` | 管理員在本機另行安裝的軟體 |
| `/var` | 運作中會變動的資料，例如 `/var/log` 日誌 |
| `/tmp` | 暫存資料；不可假設會永久保留 |
| `/run` | 本次開機期間的執行狀態資料 |
| `/boot` | 開機載入所需的檔案 |
| `/dev` | 裝置檔案 |
| `/media`、`/mnt` | 可移除媒體、臨時掛載的慣用位置 |
| `/opt`、`/srv` | 額外應用程式套件、此主機提供服務的資料 |

`/proc` 與 `/sys` 常是虛擬檔案系統的掛載點，用來呈現程序、核心或裝置資訊；不能把它們當作普通文件夾任意修改。[Linux man-pages：hier(7)](https://man7.org/linux/man-pages/man7/hier.7.html)

老文件常將 `/bin`、`/sbin`、`/lib` 分別描述為基本指令、系統管理指令及函式庫。在採用 **merged-/usr** 的系統上，它們可能是指向 `/usr` 對應位置的符號連結。例如 Debian 12 採用這種布局，`/bin` 指向 `/usr/bin`。這是發行版的布局選擇，閱讀舊路徑時要連同實際連結理解，不必自行搬移系統目錄。[Debian 12 發行說明：merged-/usr](https://www.debian.org/releases/bookworm/arm64/release-notes/ch-information.html#a-merged-usr-is-now-required)

## 路徑從哪裡開始？

**絕對路徑**從 `/` 開始，例如 `/home/alice/notes/linux.txt`。**相對路徑**不以 `/` 開始；日常 Shell 指令通常從目前工作目錄尋找，例如目前位於 `/home/alice`，`notes/linux.txt` 就指向上述檔案。`.` 表示目前目錄，`..` 表示上一層；根目錄的 `..` 仍是根目錄。[Linux man-pages：path_resolution(7)](https://man7.org/linux/man-pages/man7/path_resolution.7.html)

在 Bash 中，字詞開頭未加引號的 `~` 會展開為家目錄，通常取自 `$HOME`，所以 `~/notes` 是方便的寫法。這是 Shell 的展開規則，不是核心替每個程式解讀的特殊路徑；`"~/notes"` 裡的 `~` 不會如此展開，需加引號時可寫成 `"$HOME/notes"`。[Bash：Tilde Expansion](https://www.gnu.org/software/bash/manual/html_node/Tilde-Expansion.html)

以點開頭的名稱，例如 `.bashrc`、`.config`，常稱為 dotfiles 或隱藏檔案。GNU `ls` 預設略過它們，`ls -a` 才會一併列出。這是顯示慣例，並不是保密或權限保護。[GNU Coreutils：ls](https://www.gnu.org/s/coreutils/manual/html_node/ls-invocation.html)、[列出哪些檔案](https://www.gnu.org/s/coreutils/manual/coreutils.html#Which-files-are-listed)

## 在暫存目錄整理一份筆記

以下每段各自建立新的暫存目錄，請完整執行一段。外層 `(...)` 讓 `cd` 只影響子 Shell；`mktemp` 或 `cd` 失敗就結束該段。所有新增、改名與刪除都限定於新建的暫存目錄，不動既有筆記。`mktemp -d` 建立目錄並傳回其名稱；隨機名稱每次不同。[GNU Coreutils：mktemp](https://www.gnu.org/software/coreutils/manual/coreutils.html#mktemp-invocation)

```bash
(
  workspace=$(mktemp -d) || exit 1
  cd -- "$workspace" || exit 1
  pwd
  mkdir -p -- notes/archive
  touch -- notes/linux.txt notes/.draft
  ls -- notes
  ls -la -- notes
  cp -i -- notes/linux.txt notes/archive/linux-copy.txt
  mv -i -- notes/archive/linux-copy.txt notes/archive/linux-v1.txt
  rm -i -- notes/archive/linux-v1.txt
)
```

預期先看到暫存目錄的路徑；第一次 `ls` 不列出 `.draft`，第二次會列出它。複製後，原檔仍在，副本獨立存在；改名後，副本改用 `linux-v1.txt` 這個名稱。最後 `rm -i` 會詢問是否刪除，確認要刪除這個練習副本才輸入 `y`。此段保留暫存目錄與其餘練習檔案，不自動遞迴清除。

| 指令 | 此處的作用與界線 | 手冊 |
| --- | --- | --- |
| `pwd` | 顯示目前工作目錄；Bash 也有內建版本，細節可能與外部程式不同 | [pwd](https://www.gnu.org/s/coreutils/manual/html_node/pwd-invocation.html) |
| `ls -la` | `-l` 顯示詳細資訊，`-a` 包含點開頭名稱 | [ls](https://www.gnu.org/s/coreutils/manual/coreutils.html#ls-invocation) |
| `mkdir -p` | 建立目錄及缺少的父目錄，已有的目錄不視為錯誤 | [mkdir](https://www.gnu.org/software/coreutils/manual/coreutils.html#mkdir-invocation) |
| `touch` | 檔案不存在時建立空檔；已存在時更新時間，不是清空內容 | [touch](https://www.gnu.org/s/coreutils/manual/coreutils.html#touch-invocation) |
| `cp -i` | 複製檔案；即將覆寫既有目標檔時詢問 | [cp](https://www.gnu.org/s/coreutils/manual/html_node/cp-invocation.html) |
| `mv -i` | 移動或改名；即將覆寫既有目標時詢問 | [mv](https://www.gnu.org/s/coreutils/manual/coreutils.html#mv-invocation) |
| `rm -i` | 刪除前詢問；預設不刪目錄，並非移到桌面垃圾桶 | [rm](https://www.gnu.org/s/coreutils/manual/html_node/rm-invocation.html) |

範例中的 `"$workspace"` 用雙引號包住，讓展開後的路徑即使有空白也仍是一個參數；`--` 表示後續參數不再當作選項。不要假設 `cp`、`mv` 預設一定詢問才覆寫，這也是範例明確加上 `-i` 的原因。[GNU Coreutils：cp](https://www.gnu.org/s/coreutils/manual/html_node/cp-invocation.html)、[rm 的選項終止符](https://www.gnu.org/s/coreutils/manual/html_node/rm-invocation.html)

`mv` 也不一定只是修改名稱：跨檔案系統時，GNU `mv` 可能改為複製成功後再移除來源，因此不能把跨檔案系統移動視為一次不可分割的改名。[GNU Coreutils：mv](https://www.gnu.org/s/coreutils/manual/coreutils.html#mv-invocation)

## 同一份內容，兩種連結

要理解連結，先把「名稱」與「檔案」分開。inode 保存檔案的中繼資料，如類型、大小、時間與硬連結數；目錄中的名稱連到對應 inode。inode 號碼只保證在同一個檔案系統內唯一，不能只比兩個不同檔案系統的 inode 號碼就認定是同一檔案。[Linux man-pages：inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)

| 比較 | 硬連結（hard link） | 符號連結（symbolic link，symlink） |
| --- | --- | --- |
| 連到什麼 | 同一個 inode，等於同一檔案多一個名稱 | 自己是另一個檔案，保存目標路徑字串 |
| 修改內容 | 從任一名稱修改同一檔案，都會看到變化 | 一般讀寫會沿連結操作目標 |
| 移除原先的名稱 | 其他硬連結仍可使用，沒有誰是「主檔」 | 如果目標路徑消失，連結便失效 |
| 跨檔案系統 | 不可以 | 可以，但目標須能從該路徑存取 |
| 指向目錄 | Linux 不允許一般的目錄硬連結 | 可以 |

這些差異源自硬連結參照物件、符號連結參照名稱的不同。符號連結即使指向不存在的路徑也能建立，稱為失效連結（dangling symlink）。[Linux man-pages：symlink(7)](https://man7.org/linux/man-pages/man7/symlink.7.html)

下面用另一個全新的暫存目錄觀察。`ln` 預設建立硬連結，`ln -s` 建立符號連結；相對符號連結的目標以「連結所在目錄」為基準，不是日後執行指令時的工作目錄。[GNU Coreutils：ln](https://www.gnu.org/software/coreutils/manual/html_node/ln-invocation.html)

```bash
(
  workspace=$(mktemp -d) || exit 1
  cd -- "$workspace" || exit 1
  printf 'Linux notes\n' > original.txt
  ln -- original.txt hard.txt
  ln -s -- original.txt shortcut.txt
  ls -li -- original.txt hard.txt shortcut.txt
  rm -i -- original.txt
  cat -- hard.txt
  ls -l -- shortcut.txt
  cat -- shortcut.txt
)
```

預期 `ls -li` 顯示 `original.txt` 與 `hard.txt` 的 inode 號碼相同；`shortcut.txt` 是另一個 inode，長格式會呈現它指向的名稱。確認刪除 `original.txt` 後，`hard.txt` 仍能讀到 `Linux notes`，但最後讀取 `shortcut.txt` 會因目標路徑不存在而失敗。這段最後的失敗是刻意展示失效連結，暫存檔會保留。

刪除檔名實際上移除的是連結；最後一個硬連結被移除，且沒有程序仍開啟檔案時，空間才能回收。因此「刪掉原始名稱就會讓所有硬連結失效」是誤解。[Linux man-pages：unlink(2)](https://man7.org/linux/man-pages/man2/unlink.2.html)

另外，`rm shortcut.txt` 刪的是符號連結本身，不是它指向的檔案。其他指令是否跟隨符號連結要看各自規則，尤其複製目錄時應先讀選項說明，不能把一種指令的行為套用到全部工具。[Linux man-pages：symlink(7)](https://man7.org/linux/man-pages/man7/symlink.7.html)

## 相關閱讀與來源

- [Linux 知識索引](README.md)
- [認識 Linux](what-is-linux.md)：核心、發行版與使用情境。
- [終端與 Shell](terminal-and-shell.md)：參數、引號與 Shell 如何處理指令。
- [使用者與權限](users-and-permissions.md)：區分檔案內容與目錄項目的存取權限。
- [儲存、掛載與檔案系統](storage-and-filesystems.md)：從目錄樹深入裝置、容量與掛載管理。
- [Linux man-pages](https://man7.org/linux/man-pages/index.html)：本文引用的路徑、inode 與連結行為。
- [GNU Coreutils 手冊](https://www.gnu.org/software/coreutils/manual/coreutils.html)：本文指令選項的依據；本次部分頁面直接讀取逾時，查證使用官方頁面的搜尋擷取內容。
- [Bash 手冊](https://www.gnu.org/software/bash/manual/html_node/Tilde-Expansion.html)：`~` 展開規則；本次由官方頁面的搜尋擷取內容查閱。
- [FHS 3.0 原文（Debian 保存版本）](https://sources.debian.org/data/main/d/debian-policy/4.7.4.1/fhs-3.0.html)：目錄用途；Linux Foundation 原站本次拒絕存取。

權限、磁碟分割、檔案系統格式化與掛載管理各有獨立問題，本文只建立辨認路徑與安全操作練習檔案所需的基礎。
