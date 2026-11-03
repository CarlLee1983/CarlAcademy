# 使用者與權限

同一台 Linux 主機可能同時執行個人 Shell、網站服務與排程工作。權限讓每個身分只能接觸需要的資料：例如網站服務可以讀取公開圖片，卻不應因此讀得到你的私人筆記。遇到 `Permission denied`，先確認「哪個程序、用什麼身分、想對哪個物件做什麼」，比直接放寬所有權限更能找出原因。

本文適合已理解路徑及基本 Shell 操作的讀者，可先讀 [終端與 Shell](terminal-and-shell.md)與[檔案與目錄](files-and-directories.md)。

> 適用範圍與查證：2026-11-02，依 Linux man-pages 6.19、GNU Coreutils 9.11 線上手冊及 sudo 官方專案手冊查證。指令以 Bash 與 GNU/Linux 為準。此次環境是 Darwin（macOS）、Bash 5.3.9，沒有可用的 Linux Docker daemon；未安裝或啟動 Linux 環境。文中的暫存目錄範例已在本機執行並做 Bash 語法檢查，但使用 macOS 的檔案工具；這不構成 Linux 權限、ACL 或跨使用者行為的實測。所有 Linux 行為均以官方文件查證。

## 使用者名稱是入口，UID 才是數字身分

使用者帳號除了代表登入的人，也可代表服務。核心處理身分時使用數字識別碼：使用者有 UID（user ID），群組有 GID（group ID）。程序帶著自己的身分執行，檔案也記錄擁有者 UID 與所屬群組 GID；顯示工具再把數字轉成人容易辨識的名稱。名稱相同不保證兩台主機的 UID 相同。[Linux man-pages：credentials(7)](https://man7.org/linux/man-pages/man7/credentials.7.html)、[GNU Coreutils：名稱與 ID](https://www.gnu.org/software/coreutils/manual/html_node/Disambiguating-names-and-IDs.html)

一個程序通常有主要群組，還可帶有多個**補充群組**（supplementary groups）。因此「使用者屬於一個群組」不能理解成只能有一個。檔案的一般群組權限可由程序的主要群組或補充群組匹配；不是只看登入畫面上的帳號名稱。Linux 的檔案存取精確而言使用 filesystem UID/GID，通常與 effective UID/GID 相同；入門操作先以一般登入後沒有切換身分的程序理解即可。[Linux man-pages：credentials(7)](https://man7.org/linux/man-pages/man7/credentials.7.html)

以下只讀指令可查看目前執行身分，不會修改帳號：

```bash
id
id -u
id -g
id -Gn
```

`id` 顯示 UID、GID 與群組資訊；`-u`、`-g` 分別只顯示 effective UID、GID，`-Gn` 顯示群組名稱。輸出隨主機而異。沒有指定帳號的 `id` 反映目前程序帶有的群組；管理員變更帳號群組後，既有 Shell 不一定立即取得新群組，通常需要重新登入建立新的工作階段，不能只因帳號資料已改就假設既有程序也改了。[GNU Coreutils：id](https://www.gnu.org/software/coreutils/manual/coreutils.html#id-invocation)、[Linux man-pages：程序憑證的繼承](https://man7.org/linux/man-pages/man7/credentials.7.html)

## 讀懂 owner、group、other

下面是 `ls -l` 長格式的示意，並非本次 Linux 實測輸出：

```text
-rw-r----- 1 alice editors 120 Nov  2 10:00 notes.txt
│└─┬──┬──┬┘  │     │
│  │  │  │   │     └─ 所屬群組
│  │  │  │   └─ 擁有者
│  │  │  └─ other：其他身分
│  │  └─ group：符合所屬群組的身分
│  └─ owner：擁有者
└─ 類型；- 是一般檔案，d 是目錄
```

九個權限字元拆成 `rw-`、`r--`、`---`。`r`、`w`、`x` 是讀、寫、執行／搜尋，`-` 表示該位未授權。這裡 alice 可以讀寫，符合 editors 群組且不是擁有者的身分可讀，其他身分沒有這些權限。查看目錄本身時用 `ls -ld 目錄`；沒有 `-d` 通常列出的是目錄內容。需要看數字 UID/GID 時可用 `ls -ln`。[GNU Coreutils：ls 顯示資訊](https://www.gnu.org/software/coreutils/manual/coreutils.html#What-information-is-listed)

先排除 ACL、特權與其他額外機制，傳統模式的選擇順序是：

1. 程序的檔案系統 UID 符合檔案擁有者，使用 **owner** 三個位元。
2. 否則，檔案 GID 符合程序的檔案系統 GID 或任一補充群組，使用 **group** 三個位元。
3. 都不符合，使用 **other** 三個位元。

**選中一組後，就以那一組判斷需要的權限，不會因為不足再退回另一組，也不把三組做 OR 合併。** 例如 alice 擁有一個模式為 `004` 的檔案，即使 other 有讀取位元，alice 的一般存取仍看 owner 的 `---`。這是判定模型示意，不是建議設定。[Linux man-pages：path_resolution(7) 的 Permissions](https://man7.org/linux/man-pages/man7/path_resolution.7.html)

## 同樣的 rwx，在檔案與目錄上意思不同

| 位元 | 一般檔案 | 目錄 |
| --- | --- | --- |
| `r` | 讀取檔案內容 | 列舉目錄內的名稱 |
| `w` | 修改檔案內容 | 改動目錄項目，例如新增或移除名稱；通常還需要該目錄的 `x` |
| `x` | 嘗試把檔案作為程式執行 | 搜尋／穿越目錄，例如 `cd` 或透過已知名稱尋找其中物件 |

目錄的 `r` 不等於可以讀裡面所有檔案。沒有 `x`，即使能列出名稱，也可能無法取得它們的詳細資訊；有 `x` 而沒有 `r`，可能不能列目錄，卻仍可沿已知名稱存取檔案，前提是該檔案和路徑其他層的權限也允許。沿路徑尋找物件時，各層目錄都要能搜尋；只檢查最後一個檔案的模式不夠。[GNU Coreutils：Mode Structure](https://www.gnu.org/s/coreutils/manual/html_node/Mode-Structure.html)、[Linux man-pages：路徑搜尋](https://man7.org/linux/man-pages/man7/path_resolution.7.html)

一般檔案的 `x` 也不保證一定執行成功：格式、直譯器、掛載選項等仍可能阻止執行。對 Shell 腳本而言，`./script.sh` 需要執行權；`bash script.sh` 則由 Bash 讀取腳本，不以腳本本身的 `x` 作為同一個執行門檻，但仍需要可讀及可搜尋的路徑。[Linux man-pages：execve(2)](https://man7.org/linux/man-pages/man2/execve.2.html)、[Bash：Shell Scripts](https://www.gnu.org/software/bash/manual/html_node/Shell-Scripts.html)

### 刪除檔案，主要看包含它的目錄

修改內容與移除名稱是兩種操作。刪除一般檔案的名稱，通常需要**父目錄的 `w` 與 `x`**，以及前面各層路徑的搜尋權；不要求該檔案本身可寫。所以 `chmod 444 report.txt` 並不是防刪保證。工具可能另外詢問是否移除唯讀檔案，但那是工具的互動策略，不能當作核心授權規則。[Linux man-pages：unlink(2)](https://man7.org/linux/man-pages/man2/unlink.2.html)

共享暫存目錄常用 **sticky bit** 限制刪除與改名。目錄設了此位元後，即使一般目錄權限允許寫入，沒有相應特權的程序通常還必須是「要移除項目的擁有者」或「該目錄的擁有者」。`ls -ld` 常以尾端的 `t` 顯示它，例如常見的 `drwxrwxrwt`；若 other 的 `x` 未設，該位置會顯示 `T`。sticky bit 不會阻止依檔案寫入權修改別人的內容，也不取代目錄 `w/x` 的基本要求。[Linux man-pages：unlink(2)](https://man7.org/linux/man-pages/man2/unlink.2.html)、[GNU Coreutils：chmod](https://www.gnu.org/software/coreutils/manual/html_node/chmod-invocation.html)

## chmod：調整自己擁有的練習檔案

`chmod` 改的是模式位元，不是擁有者。一般只有擁有者或具有相應特權的程序能改；能寫某個檔案的群組成員，不代表能替它重新設定權限。[GNU Coreutils：chmod](https://www.gnu.org/software/coreutils/manual/html_node/chmod-invocation.html)

符號模式使用 `u`（owner）、`g`（group）、`o`（other）、`a`（全部），搭配 `+` 增加、`-` 移除、`=` 指定。`o` 是 other，不是 owner；例如 `u=rw,go=` 表示擁有者可讀寫，群組與其他身分全部清除。明確寫出對象也能避開省略對象時與 umask 的互動。[GNU Coreutils：Symbolic Modes](https://www.gnu.org/s/coreutils/manual/html_node/Symbolic-Modes.html)

數字模式每組把 `r=4`、`w=2`、`x=1` 相加，再按 owner、group、other 排列：

| 模式 | 一般用途示意 |
| --- | --- |
| `600` | 私人檔案：owner 可讀寫，其餘無權限 |
| `640` | owner 可讀寫，group 可讀，other 無權限 |
| `644` | owner 可讀寫，其餘可讀；不適合機密資料 |
| `700` | 私人目錄：owner 可列舉、修改、搜尋 |
| `750` | 目錄 owner 完整權限、group 可列舉與搜尋 |

這些是選擇範例，不是所有檔案的預設答案。數字表示八進位；三位數描述一般權限，特殊位元另有規則，尤其 GNU `chmod` 對目錄 set-user-ID/set-group-ID 的保留行為不能簡化成「三位數永遠清除全部特殊位元」。本文不操作這些特殊身分位元。[GNU Coreutils：Numeric Modes](https://www.gnu.org/s/coreutils/manual/html_node/Numeric-Modes.html)

下面只修改新建暫存目錄中的自有檔案。請完整執行整段；括號建立子 Shell，`cd` 不影響原本位置。任何建立或修改失敗便停止，不操作系統帳號、不使用 `sudo`，也不遞迴修改既有資料。

```bash
(
  workspace=$(mktemp -d) || exit 1
  cd -- "$workspace" || exit 1
  printf 'private note\n' > note.txt || exit 1
  chmod u=rw,go= note.txt || exit 1
  ls -l note.txt
  chmod g+r note.txt || exit 1
  ls -l note.txt
  chmod 600 note.txt || exit 1
  mkdir private || exit 1
  chmod 700 private || exit 1
  ls -ld private
  printf '練習位置：%s\n' "$workspace"
)
```

預期一般權限依序是 `rw-------`、`rw-r-----`，最後 note.txt 回到 `600`；private 目錄是 `rwx------`。顯示的名稱、時間、額外標記可能不同。此段保留練習目錄，方便回看；沒有用跨帳號存取來驗證隔離，不能僅憑畫面推論 ACL 或其他規則不存在。

## umask：影響新建時，並不回改舊檔

umask 是程序建立新檔案時遮掉哪些權限的遮罩。沒有父目錄預設 ACL 時，概念是 `建立時要求的 mode & ~umask`，是位元遮除，**不是十進位或八進位減法**。一般程式建立普通檔案常要求 `666`、目錄常要求 `777`；搭配 `022` 常得到 `644` 與 `755`，搭配 `077` 常得到 `600` 與 `700`。程式可以先要求更少權限，umask 不會替它補回；既有檔案不會因 umask 改變而自動修改。[Linux man-pages：umask(2)](https://man7.org/linux/man-pages/man2/umask.2.html)

```bash
(
  workspace=$(mktemp -d) || exit 1
  cd -- "$workspace" || exit 1
  umask 077
  printf 'new note\n' > new.txt || exit 1
  mkdir new-dir || exit 1
  umask
  ls -ld new.txt new-dir
  printf '練習位置：%s\n' "$workspace"
)
```

子 Shell 中的 `umask 077` 不改外層 Shell；在沒有預設 ACL 等額外因素的情況下，預期 new.txt 為 `600`、new-dir 為 `700`。`mktemp -d` 有自己的安全建立方式，不能用它的模式直接推算一般 `mkdir` 的結果。若父目錄有預設 ACL，Linux 建立時會依繼承 ACL 與要求的 mode 決定權限，不能仍機械套用同一個 umask 公式。[Linux man-pages：umask(2)](https://man7.org/linux/man-pages/man2/umask.2.html)、[GNU Coreutils：mktemp](https://www.gnu.org/software/coreutils/manual/coreutils.html#mktemp-invocation)

## chown、sudo 與 root 的責任邊界

`chmod` 決定授予什麼權限；`chown` 改變物件歸誰、屬於哪個群組。Linux 上，更換檔案 owner 需要相應特權；一般擁有者可以把自有檔案的 group 改成自己所屬的群組，不能任意挑選任何群組。[GNU Coreutils：chown](https://www.gnu.org/s/coreutils/manual/html_node/chown-invocation.html)、[Linux man-pages：chown(2)](https://man7.org/linux/man-pages/man2/chown.2.html)

管理情境的純文字示意（**不執行**）：`chown alice:editors /srv/project/report.txt` 表示調整該物件的 owner 與 group，前提是相關帳號存在且執行者有權限。這是管理者決定資料歸屬的操作，不應為了消除一個錯誤就對整個系統或服務目錄遞迴套用。

`sudo` 是依安全政策，以另一個使用者身分執行命令的工具，預設目標通常是 root；可執行哪些命令、是否需要驗證、執行環境及記錄方式由政策決定。知道密碼不等於取得任意命令的授權，`sudo` 也不會把檔案永久「解鎖」。例如管理員授權某人重啟一個服務，不代表授權他讀取全部私人資料。[sudo 官方手冊原始檔：DESCRIPTION、Security policy](https://github.com/sudo-project/sudo/blob/main/docs/sudo.man.in)

root 傳統上是 UID 0 的超級使用者。Linux 又把許多特權拆成 capabilities，因此不能只用帳號名稱或九個 `rwx` 位元解釋一切。最小權限的實務方向是：日常工作用一般帳號，服務使用自己需要的身分與資料範圍，只有特定管理動作才依政策提升權限。這是避免一個錯誤命令影響整台主機的設計選擇。[Linux man-pages：capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)

## 權限看起來正確，為什麼還是被拒絕？

先按具體操作排查：用 `id` 看程序身分，用 `ls -l` 看物件 owner/group/mode，用 `ls -ld` 看父目錄及路徑各層。把「讀內容」「修改內容」「執行」「新增或刪除名稱」分開，才知道應該檢查檔案還是目錄。

傳統模式之外還可能有以下機制；本文只建立邊界，不提供修改流程：

- **ACL（存取控制清單）**可對特定使用者或群組補充規則，還有 mask 限制部分項目的有效權限。有擴充 ACL 時，`ls -l` 的 group 三位可能對應 ACL mask，不能只用本篇三類模型完整推算；可由管理者用 `getfacl` 進一步查看。[Linux man-pages：acl(5)](https://man7.org/linux/man-pages/man5/acl.5.html)
- **SELinux、AppArmor 等安全政策**可能另有限制；傳統檔案權限允許，不表示政策也允許。[Linux 核心：LSM 文件](https://docs.kernel.org/admin-guide/LSM/index.html)
- **唯讀掛載、immutable 屬性及檔案系統規則**也可能阻止修改或刪除。root 或 `chmod 777` 不保證能排除這些限制。[Linux man-pages：unlink(2) 的錯誤條件](https://man7.org/linux/man-pages/man2/unlink.2.html)

因此，不要把 `chmod 777` 當成通用修復：它會給所有身分讀、寫、執行／搜尋權，卻可能完全沒有處理真正阻擋操作的原因。先確定誰應該做什麼，再改最小必要的邊界。

## 相關閱讀與來源

- [Linux 知識索引](README.md)
- [檔案與目錄](files-and-directories.md)：目錄項目、路徑與刪除名稱。
- [程序](processes-and-jobs.md)：程序帶著身分運作，以及前景、背景與訊號。
- [服務與日誌](services-and-logs.md)：把權限問題放回服務執行身分與錯誤記錄理解。
- [Linux man-pages](https://man7.org/linux/man-pages/index.html)：本文的憑證、路徑、刪除、umask、ACL 與 capabilities 規則。
- [GNU Coreutils 9.11 手冊](https://www.gnu.org/software/coreutils/manual/coreutils.html)：`id`、`ls`、`chmod`、`chown` 與模式表示法；部分分頁直接擷取逾時，查證使用 GNU 官方搜尋擷取及完整手冊。
- [sudo 官方專案手冊](https://github.com/sudo-project/sudo/blob/main/docs/sudo.man.in)：官方網站本次無法擷取，改讀同一專案的手冊原始檔。

本篇範例沒有操作系統帳號、改變群組成員、執行 `sudo` 或 `chown`，也沒有測試跨使用者存取。這些管理操作需要另行確認發行版工具、政策及實際權限需求。
