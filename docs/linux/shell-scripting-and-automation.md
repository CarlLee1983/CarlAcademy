# Shell 腳本與工作自動化

在終端成功執行一次命令，和每天無人看守地執行，是兩種要求。腳本除了把命令存起來，還要回答：輸入缺少時怎麼辦？哪一步失敗就不能繼續？暫存資料由誰清掉？昨天做一半的工作今天重跑會不會重複？排程只是啟動工作的入口，這些行為仍須由工作本身設計。

本文以 **Linux 上的 Bash** 為範圍；不是所有 Linux 都有 Bash，也不是所有系統都使用 systemd。先讀[終端與 Shell](terminal-and-shell.md)、[文字處理](text-processing.md)與[使用者與權限](users-and-permissions.md)，本文不重複展開管線與基本引號語法。

**查證日期：2026-11-02。驗證環境是 macOS（Darwin）的 Bash 5.3.9，未在 Linux 執行。** 本文三段完整 Bash 範例已做語法檢查與本機執行；檔案操作只在自行建立的暫存空間進行，使用的是本機工具。cron 與 systemd 設定只依官方手冊解說，沒有安裝排程、啟動服務或測試 Linux 排程行為。文末交代各來源的查閱方式。

## 腳本如何開始執行

Shell script 是包含 Shell 命令的文字檔。以 `bash ./report.sh` 執行時，Bash 讀取檔案中的命令，通常建立非互動的執行環境；檔名副檔名 `.sh` 本身不決定語言。直接執行檔案則還牽涉權限與第一行的直譯器宣告。[Bash：Shell Scripts][scripts]

以下是不同啟動方式的對照，檔名是示意；後面的完整範例會實際建立練習腳本。

| 啟動方式 | 誰解讀檔案 | 主要差異 |
| --- | --- | --- |
| `bash ./report.sh` | 命令查找所選到的 Bash | 腳本要可讀；不要求腳本本身有執行位元，第一行不會替換已指定的 Bash |
| `./report.sh` | Linux 執行機制依 shebang 找直譯器 | 路徑要能穿越、檔案要能執行，直譯器也要存在；掛載政策仍可能禁止執行 |
| `sh ./report.sh` | 系統的 `sh` | 即使第一行寫 Bash，也不能因此使用 Bash 專屬語法 |
| `source ./report.sh` 或 `. ./report.sh` | 目前的 Shell | 在目前環境執行；`cd`、變數、選項甚至 `exit` 都可能影響呼叫者 |

這些差異來自 Bash 的腳本、`source` 規則及 Linux 的 `execve` 行為。**執行工作腳本通常選前兩種；只有明確要載入可信設定時，才考慮 source。** source 不是讀取純資料，而是執行程式碼。[Bash：Shell Scripts][scripts]、[Bourne Shell Builtins][builtins]、[Linux：execve(2)][execve]

常見第一行稱為 **shebang**：

```text
#!/usr/bin/env bash
```

這會透過 `/usr/bin/env` 按 `PATH` 找 Bash，方便適應不同安裝位置，但也表示不同環境可能選到不同版本。`#!/bin/bash` 則指定固定路徑，前提是該主機在這裡安裝了所需 Bash。正式排程應確認實際路徑與版本，不要只靠副檔名或 `$SHELL` 推定。要讓自有腳本可直接執行，可使用 `chmod u+x ./report.sh`，不需要放寬為 `777`。[Bash：Shell Scripts][scripts]、[使用者與權限](users-and-permissions.md)

### 互動設定不等於腳本環境

一般互動、非登入 Bash 讀取 `~/.bashrc`；登入 Bash 有另一組 profile 規則；一般非互動腳本不會照搬這些設定，而可能讀取環境變數 `BASH_ENV` 指定的檔案。非互動 `--login`、遠端啟動等還有各自規則。因此不能依賴互動別名、提示符設定或剛好在 `.bashrc` 裡補上的工具路徑。`--noprofile --norc` 也不會停用 `BASH_ENV`。[Bash：Startup Files][startup]

腳本繼承父程序匯出的環境，但通常不會把自己的 `cd` 或變數變更回寫到父 Shell。工作目錄預設也不會因腳本位在某個資料夾，就自動切到那裡；相對路徑是從**執行當時的工作目錄**解讀。需要固定工作目錄時，明確設定，並檢查 `cd` 是否成功。[Bash：Command Execution Environment][environment]

## 把輸入定成契約

位置參數是呼叫者傳入的引數：`$1` 是第一個、`$2` 是第二個；`$#` 是個數；`${10}` 才是第十個。`$0` 通常是腳本名稱，不是第一個資料引數。[Bash：Shell Parameters][parameters]

最重要的集合形式是 **`"$@"`**：保留每個原始引數各自的邊界。`"$*"` 則把它們合成一個字串；未加引號的 `$@` 會再經過分割與檔名展開，可能改變資料。下例只改子 Shell 的位置參數，沒有寫入檔案：[Bash：Special Parameters][special]

```bash
(
  set -- 'weekly report' '*.log' ''
  printf 'count=%s\n' "$#"
  for item in "$@"; do
    printf '<%s>\n' "$item"
  done
)
```

預期輸出：

```text
count=3
<weekly report>
<*.log>
<>
```

空字串也是一個引數；`*.log` 在這裡是文字，不會變成目前目錄中的檔案。函式要把收到的引數完整轉交另一個函式時，也使用 `另一個函式 "$@"`。[Bash：Special Parameters][special]

寫腳本時先決定哪些輸入有效：最低／最高引數個數、允許的模式、空字串是否合法、失敗時的訊息與狀態。先驗證再建立暫存檔或修改資料，錯誤影響才容易限制。`shift` 可移除已處理的第一個位置參數，讓餘下引數成為待處理資料；必須先確認參數存在。[Bash：Bourne Shell Builtins][builtins]

## 用 if、case、for 與函式表達工作

`if` 判斷的是**命令的結束狀態**，不是畫面上的文字；狀態 0 進入 then，非 0 走其他分支。`[[ ... ]]` 是 Bash 條件語法，例如 `[[ -z "$name" ]]` 判斷字串為空；`[[ ... ]]` 不是所有 `sh` 都有的功能。[Bash：Conditional Constructs][conditional]

`case "$mode" in ... esac` 適合少數幾種模式，`plain|numbered)` 代表符合任一模式，`*)` 當預設錯誤分支；本文用 `;;` 結束該分支。`for item in "$@"; do ...; done` 依序處理各個引數。[Bash：Conditional Constructs][conditional]、[Looping Constructs][loops]

函式把「產生報表」「清理暫存」等一個完整責任取名。函式在呼叫它的 Shell 環境中執行，不會僅因是函式便產生隔離程序；函式內用 `local` 限制變數範圍。函式收到自己的位置參數，結束後呼叫者的參數會恢復。`return 1` 返回呼叫處並帶回狀態，`exit 1` 則結束整個目前 Shell；函式不是用 `return` 傳回字串，文字應寫到 stdout。[Bash：Shell Functions][functions]

### 完整範例：在暫存空間產生清單

請在 Bash 中完整執行以下區塊。外層子 Shell 建立私人練習目錄，再以 heredoc 寫出 `report.sh`。`<<'SCRIPT'` 表示把後續各行當作命令的標準輸入，直到獨立一行的 `SCRIPT`；分隔字加了引號，所以外層 Shell 不會先展開其中的 `$變數`，它們會原樣寫進腳本，留待腳本執行時解讀。[Bash：Here Documents][heredoc]

腳本只接受顯示模式與項目文字，沒有讀取使用者檔案，也沒有讓輸入變成命令。

第一趟由 Bash 讀檔執行，第二趟才設定自有練習檔的執行權並直接執行，展示兩種入口。兩趟的報表先寫到各自新建的暫存檔，讀出後清理；外層最後也只移除自己建立的腳本與空目錄。

```bash
(
  lab=$(mktemp -d) || exit 1
  cleanup_lab() {
    local status=$?
    rm -f -- "$lab/report.sh" || status=1
    rmdir -- "$lab" || status=1
    exit "$status"
  }
  trap cleanup_lab EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  cat > "$lab/report.sh" <<'SCRIPT' || exit 1
#!/usr/bin/env bash

usage() {
  printf 'usage: report.sh plain|numbered item [item ...]\n' >&2
}

die() {
  printf 'report: %s\n' "$1" >&2
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
  exit 2
fi
mode=$1
shift
case "$mode" in
  plain|numbered) ;;
  *) usage; exit 2 ;;
esac
for item in "$@"; do
  if [[ -z "$item" || "$item" == *$'\n'* ]]; then
    printf 'report: each item must be nonempty and fit on one line\n' >&2
    exit 2
  fi
done

report=''
cleanup() {
  local status=$?
  if [[ -n "$report" ]]; then
    rm -f -- "$report" || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
report=$(mktemp "${TMPDIR:-/tmp}/academy-report.XXXXXXXX") || die 'mktemp failed'

write_report() {
  local item index=1
  for item in "$@"; do
    case "$mode" in
      plain) printf '%s\n' "$item" || return 1 ;;
      numbered) printf '%s. %s\n' "$index" "$item" || return 1 ;;
    esac
    index=$((index + 1))
  done
}

write_report "$@" > "$report" || die 'cannot write report'
cat -- "$report" || die 'cannot read report'
exit 0
SCRIPT

  bash -n "$lab/report.sh" || exit 1
  TMPDIR="$lab" bash "$lab/report.sh" plain 'weekly report' '*.log' || exit 1
  chmod u+x "$lab/report.sh" || exit 1
  TMPDIR="$lab" "$lab/report.sh" numbered 'weekly report' '*.log' || exit 1
)
```

預期 stdout：

```text
weekly report
*.log
1. weekly report
2. *.log
```

逐段看這份腳本的契約：

- `usage` 與輸入錯誤送到 stderr；狀態 `2` 是本腳本自行約定的使用錯誤，不是所有工具共通的定義。
- 檢查個數後才讀 `$1`、`shift`；`case` 拒絕未知模式；項目不允許空字串或換行，確保每個項目剛好一行。
- `write_report "$@"` 保留原始引數，`local index=1` 讓每次呼叫從 1 開始；每個寫入失敗都明確 `return 1`。
- 暫存檔的路徑來自這次 `mktemp` 的成功結果，清理不使用輸入拼出路徑，也沒有遞迴刪除。
- `cleanup` 進入時先保存 `$?`，避免 `rm` 成功把原本的失敗變成成功；清理本身失敗則回報非零。

引數中的 `*.log` 一直是文字，並未重新當作 Shell 程式碼解析。對外部輸入使用 `eval` 或拼接成 `bash -c` 字串，會跨過這個邊界；一般轉交資料應維持引數形式。`printf` 的格式固定為 `'%s\n'` 等已知字串，資料放在後續引數，也不會把使用者輸入當格式。[Bash：Shell Expansions][expansions]、[Bash Builtins][bash-builtins]

## 錯誤處理：先定義失敗，再決定停止

一個非零值可能表示輸入錯誤、真的讀不到檔案，也可能只是搜尋沒有符合結果。因此腳本要按命令契約判斷。對必須成功才能繼續的步驟，`command || exit 1`、`command || die '原因'` 或完整 `if` 都能讓控制流程清楚；需要保留原狀態時，在 else 的第一個命令就保存 `$?`。[Bash：Exit Status][exit-status]、[Lists of Commands][lists]

例如實際工具的狀態要記錄時，可以用下面的結構（純文字示意，不是本次實跑命令）：

```text
if some_command; then
  printf 'finished\n'
else
  status=$?
  printf 'some_command failed: status=%s\n' "$status" >&2
  exit "$status"
fi
```

不要寫成 `if ! some_command; then status=$?` 卻以為拿到原本失敗值：`!` 已經反轉狀態。也不要在保存前先 `printf`，那時讀到的就會是輸出命令的狀態。[Bash：Pipelines][pipelines]、[Special Parameters][special]

### set -e 與 pipefail 不是完整錯誤政策

`set -e`（errexit）會在部分非零狀態下讓 Shell 提早結束，但有明確例外：`if` 的測試、`while`／`until` 的條件、部分 `&&`／`||` 串列、`!` 反轉，以及管線前段等。尤其**函式若整體被用作 if 的條件，函式內部也會落在忽略 `-e` 的脈絡**，不能假設每個失敗都會自動停下。[Bash：The Set Builtin][set]

下面只在子 Shell 示範這個例外，不寫入檔案：

```bash
(
  set -e
  demonstrate() {
    false
    printf 'function continued\n'
  }
  if demonstrate; then
    printf 'if saw success\n'
  fi
)
```

預期輸出：

```text
function continued
if saw success
```

因為 `false` 沒有讓函式退出，最後的 `printf` 成功，函式也回傳成功。前面完整腳本刻意使用顯式檢查，沒有把 `set -e` 當作必要的正確性條件。[Bash：The Set Builtin][set]、[Shell Functions][functions]

`set -o pipefail` 則改變管線整體狀態：有失敗時取位置最右的非零狀態，而不只看最後一段。它不會自動中止所有其他階段、不提供回復，也不決定哪一個非零值對工作有害。例如下游提早讀夠並關閉輸入，可能讓上游遇到 broken pipe；需要依工具與資料流解釋。各段狀態與示例見[文字處理的管線一節](text-processing.md)。[Bash：Pipelines][pipelines]、[The Set Builtin][set]

`set -u` 可使部分未設定變數展開變成錯誤，但不會檢查值是否為空或模式是否有效。`ERR` trap 也有類似 `-e` 的條件例外；不要把 `set -euo pipefail` 或一個 `ERR` trap 視為取代輸入驗證、明確狀態檢查與清理的魔法開關。[Bash：The Set Builtin][set]、[trap][builtins]

## 暫存資料的生命週期

不要自己猜一個 `/tmp/report.txt`，也不要先測試名稱不存在、再建立：兩個操作之間別的程序可能先建立同名物件。`mktemp` 將選名與安全建立交給工具，回傳實際路徑；`mktemp -d` 建立目錄。GNU 的模板使用連續 `X` 產生名稱，這裡使用尾端八個 `X`；`mktemp -u` 只產生名字而不建立，不能提供同樣保護。[GNU Coreutils：mktemp][mktemp]

建立後盡早登記 `trap ... EXIT`，並處理預期的終止訊號。範例將 INT／TERM 轉為結束，再由 EXIT 做一次清理；130／143 是這份腳本採用的中斷狀態。trap 的 action 用單引號，讓內容留待訊號發生時解讀；以函式名稱登記則可把清理流程集中。[Bash：trap][builtins]

**trap 是盡力清理，不是永不留檔的保證。** `SIGKILL`、斷電、程序在登記前就終止等情況可能留下資料；有些等待外部命令的情況也會影響 trap 執行時機。需要可靠恢復的工作，仍要設計下一次啟動時如何辨認未完成狀態。訊號與等待的細節見[程序](processes-and-jobs.md)。[Bash：Signals][signals]

清理範圍應可從程式碼直接看出：範例只 `rm -f` 自建的具名檔案，再用 `rmdir` 移除應為空的自建目錄。若還有未知檔案，`rmdir` 失敗並留下它們，方便查明，而不是擴大刪除範圍。

## 處理檔名時，不把顯示結果當資料協定

`for file in $(ls)` 會先把 `ls` 輸出變成字串，再受分割與檔名展開影響；含空白、換行或萬用字元的檔名可能被誤解。`ls` 適合給人看，不能藉此恢復原本的檔名邊界。[Bash：Command Substitution][substitution]、[Word Splitting][splitting]

若目標是某個已知目錄下的普通 `.txt` 檔案，可讓 Shell 直接展開 `./*.txt`，逐個加引號使用；Bash 預設沒有符合時會留下原樣的模式，因此還要決定空集合如何處理，例如檢查 `[[ -f "$file" ]]` 再處理。這種模式不遞迴，也不涵蓋以點開頭的檔案。大量、遞迴或允許任意檔名的流程，要採用工具支援的 NUL 分隔或逐檔引數介面，不要假設一行永遠是一個檔名。[Bash：Filename Expansion][globbing]

引號保護 Shell 的引數邊界，卻不改變工具自己的選項規則。工具支援時，以 `--` 結束選項；`./` 開頭的相對路徑也能避免把 `-name` 放在選項位置。不要只因「已加引號」就認定外部命令必然安全；還要確認輸入有沒有控制輸出路徑、選項或會執行的程式內容。

## 可重跑與同時執行，是兩個問題

**冪等（idempotent）**指同一個工作重做，對目標狀態不會不斷增加額外效果。這是自動化的設計要求，不是 Bash 選項。例如重新依完整來源產生一份報表，通常比每次向同一檔案 append 同一批結果容易重跑；「先檢查資料夾，再建立所需結構」也要考慮已有物件是否真的符合預期。

上面的練習每次分配自己的暫存檔，不會因重跑累積到共用報表；但它只是獨立輸出的展示，沒有證明任何真實資料匯入具有冪等性。正式工作可按以下順序設計：

1. 定義工作識別，例如日期或來源批次，重試沿用同一識別。
2. 先在隔離的暫存位置完成產出與檢查，再發布為可讀結果，避免讀者看到半份資料。若用改名發布，要確認來源與目標檔案系統及覆寫語意；不能把多檔案更新當成單一交易。
3. 部分失敗後，明確區分已完成、可重試與需要人工處理的狀態。寄信、付款等外部副作用還須由接收端的去重／交易契約處理，不能靠刪除暫存檔撤銷。

**重疊執行（overlap）**則是兩個程序同時碰同一份可變狀態。就算每次單獨執行都冪等，「先檢查、再寫入」仍可能競爭。優先讓各次工作有自己的輸出，或讓寫入集中到一個擁有者；必須共享寫入時才設計鎖。

Linux 的 util-linux `flock` 可讓合作的程序持有同一把鎖，等不到鎖時可以等待、逾時或以 `-n` 立即失敗。鎖是協作機制，所有寫入入口都要使用同一個鎖物件，鎖要涵蓋「讀取目前狀態 → 判斷 → 更新」整段，不能只鎖最後一個寫入。不要在仍有人使用時刪除鎖檔，造成另一個程序鎖到新物件；網路檔案系統的鎖語意也需另查。本文只介紹邊界，不在本機模擬 Linux `flock`。[util-linux：flock 官方手冊][flock]

## 排程：讓執行環境成為可檢查的設定

先確認腳本可在**沒有互動輸入**時完成，再排程。它應有明確的執行身分、Bash 路徑、輸入、工作目錄、PATH、錯誤狀態、日誌與重疊策略；不能等排程上線後才發現它在等待密碼、工具或相對路徑。

### cron：依時間欄位啟動命令

cron 有多個實作。以下依 **Cronie** 官方手冊，其他發行版或實作須查自己的 `crontab(5)`。使用者 crontab 的格式是五個時間欄位後接命令；系統 `/etc/crontab`、`/etc/cron.d` 還有使用者欄位，兩者不可直接混用。[Cronie：crontab(5)][crontab]

下面是**閱讀用設定示意，不要貼到 Shell，也不在本文安裝**。路徑與帳號均為假設，並不指向前面的暫存範例：

```text
SHELL=/bin/sh
PATH=/usr/bin:/bin
CRON_TZ=Asia/Taipei
30 2 * * * cd /srv/academy && /usr/bin/bash /srv/academy/bin/daily-report.sh >> /srv/academy/log/daily-report.log 2>&1
```

`30 2 * * *` 表示該排程時區的每日 02:30。五欄依序為分、時、月中日、月、星期；若月中日與星期都設限制，Cronie 是兩者**任一**符合便執行。`*/15` 這種步進是在該欄位內比對，不等同從啟動時刻起每隔固定秒數。[Cronie：crontab(5)][crontab]

此設定把責任寫明：

- Cronie 預設的命令 Shell 是 `/bin/sh`，不因登入 Shell 是 Bash 就改變。示意明確用 `/usr/bin/bash` 執行腳本；需在目標主機先確認路徑。
- `PATH` 明確列出允許的工具目錄；`cd ... && ...` 保證切換工作目錄成功才執行，不依賴啟動時位置。
- `>> ... 2>&1` 將 stdout／stderr 追加到已規劃的日誌。目錄須事先存在且執行者可寫；還要管理輪替、容量與失敗通知。Cronie 的郵件通知取決於 MAILTO 與可用郵件機制，不能只因「cron 會寄信」就省略驗證。
- `CRON_TZ` 是 Cronie 支援的排程時區設定，不是所有 cron 的可攜承諾；cron 自己寫日誌的時區仍可能不同。應同時記錄應用程式內部使用的時區。

上述欄位、環境與通知行為依 [Cronie crontab(5)][crontab]；日誌檔位置及輪替則是部署時必須另定的政策。命令欄中未跳脫的 `%` 會被 cron 特別處理，即使它在某些 Shell 引號內也不能只用 Shell 規則推論；含 `date +%...` 等複雜命令時，通常應收進腳本，再讓排程只負責啟動。[Cronie：crontab(5)][crontab]

cron 的時間匹配不代表前一趟已完成。每分鐘啟動、每趟耗時三分鐘的工作，必須另外定義等待、跳過或排隊策略。主機關機時錯過的執行，也不要假設標準 cron 會在開機後完整補跑；Cronie 對夏令時間的小幅跳時另有特殊處理，不能把所有時鐘變動都概括成固定一次或兩次執行。[Cronie：cron(8)][cron]

### systemd timer：時間與執行責任拆開

在採用 systemd 的 Linux，`.timer` 描述何時啟動，對應的 `.service` 描述執行內容。同名 timer 預設觸發同名 service；service 已 active 時不會由該 timer 再開一份，所以 `RemainAfterExit=yes` 通常不適合反覆觸發的工作。這只約束該 unit，無法阻止另一個 unit 或人直接執行同一腳本。[systemd.timer][timer]

下列兩份同樣是**設定解讀示意，未建立、載入或啟動**；示範 system service 的語意，帳號與目錄都要由管理者事先規劃。

`academy-report.service`：

```ini
[Unit]
Description=Produce the academy daily report

[Service]
Type=oneshot
User=academy
WorkingDirectory=/srv/academy
Environment=PATH=/usr/bin:/bin
ExecStart=/usr/bin/bash /srv/academy/bin/daily-report.sh
StandardOutput=journal
StandardError=journal
```

`academy-report.timer`：

```ini
[Unit]
Description=Schedule the academy daily report

[Timer]
OnCalendar=*-*-* 02:30:00 Asia/Taipei
Persistent=true

[Install]
WantedBy=timers.target
```

`Type=oneshot` 適合執行完便退出的工作；`User=` 指定執行身分。`WorkingDirectory=` 與 `Environment=` 讓工作不依賴互動 Shell。`ExecStart=` 的內容一般不是 Shell 命令列，不能任意在後面加 `|`、`>`、`&&` 期待 Bash 解讀；這裡直接指定 Bash 與腳本路徑，日誌則透過 `StandardOutput/StandardError` 明確交給 journal。[systemd.service][service]、[systemd.exec][exec]

`OnCalendar=` 是日曆時間；尾端時區採 systemd 支援的 IANA 名稱。`OnBootSec=` 等則是依某個起點計時的單調時間設定，目的不同。`Persistent=true` 只對 `OnCalendar=` 有效：timer 未啟用期間若至少錯過一次，恢復啟用時可補一次觸發，**不是把所有錯過時點逐一重播**。timer 的 `AccuracySec=` 預設還允許時間窗口，並非硬即時的秒級保證。[systemd.time][time]、[systemd.timer][timer]

將來在目標 Linux 驗證時，應分別確認 timer 的下一次時間、service 的結束狀態與 journal 記錄；單看 timer 已啟用，不能證明工作產出正確。服務狀態與日誌的觀察入口見[服務與日誌](services-and-logs.md)。本文沒有在 Darwin 用同名或近似工具冒充 systemd 驗證。

## 相關閱讀與來源

- [Linux 知識索引](README.md)
- [終端與 Shell](terminal-and-shell.md)：命令查找、環境、引號及結束狀態。
- [文字處理](text-processing.md)：重新導向、管線與各段狀態。
- [使用者與權限](users-and-permissions.md)：執行位元、目錄搜尋與最小權限。
- [程序](processes-and-jobs.md)：訊號、前景／背景與等待。
- [服務與日誌](services-and-logs.md)：將工作放回服務身分與日誌觀察。

來源於 **2026-11-02** 查閱。Bash 網頁透過維護者 Chet Ramey 提供的 GNU Bash Reference Manual 查閱；部分分頁連線失敗後，另讀本機 Bash 5.3.9 隨附的官方 `bash.info`，核對 Shell Scripts、Startup Files、Special Parameters、Conditional／Looping Constructs、Shell Functions、The Set Builtin 與 trap。GNU Coreutils 的 mktemp 分頁全文擷取逾時，以 GNU 官方搜尋擷取核對，不宣稱通讀全文。Cronie 與 util-linux 使用官方專案手冊原始檔；systemd 使用線上 latest 手冊（查閱頁面標示 262），舊發行版須查已安裝版本。

本機驗證涵蓋：完整範例的 Bash 語法、兩種啟動方式、帶空白／萬用字元的引數、錯誤引數狀態、正常結束，以及以可控的 cat 替身送出 TERM 後的自建暫存檔清理，以及 `set -e` 的條件函式例外。未驗證 Linux 排程、flock、跨使用者權限、斷電恢復或實際共用資料的一致性；範例清理成功不能推論上述情境也有保證。

[scripts]: https://tiswww.case.edu/php/chet/bash/bashref.html#Shell-Scripts
[startup]: https://tiswww.case.edu/php/chet/bash/bashref.html#Bash-Startup-Files
[environment]: https://tiswww.case.edu/php/chet/bash/bashref.html#Command-Execution-Environment
[parameters]: https://tiswww.case.edu/php/chet/bash/bashref.html#Shell-Parameters
[special]: https://tiswww.case.edu/php/chet/bash/bashref.html#Special-Parameters
[conditional]: https://tiswww.case.edu/php/chet/bash/bashref.html#Conditional-Constructs
[loops]: https://tiswww.case.edu/php/chet/bash/bashref.html#Looping-Constructs
[functions]: https://tiswww.case.edu/php/chet/bash/bashref.html#Shell-Functions
[builtins]: https://tiswww.case.edu/php/chet/bash/bashref.html#Bourne-Shell-Builtins
[bash-builtins]: https://tiswww.case.edu/php/chet/bash/bashref.html#Bash-Builtins
[expansions]: https://tiswww.case.edu/php/chet/bash/bashref.html#Shell-Expansions
[exit-status]: https://tiswww.case.edu/php/chet/bash/bashref.html#Exit-Status
[lists]: https://tiswww.case.edu/php/chet/bash/bashref.html#Lists
[pipelines]: https://tiswww.case.edu/php/chet/bash/bashref.html#Pipelines
[set]: https://tiswww.case.edu/php/chet/bash/bashref.html#The-Set-Builtin
[signals]: https://tiswww.case.edu/php/chet/bash/bashref.html#Signals
[substitution]: https://tiswww.case.edu/php/chet/bash/bashref.html#Command-Substitution
[splitting]: https://tiswww.case.edu/php/chet/bash/bashref.html#Word-Splitting
[globbing]: https://tiswww.case.edu/php/chet/bash/bashref.html#Filename-Expansion
[heredoc]: https://tiswww.case.edu/php/chet/bash/bashref.html#Here-Documents
[execve]: https://man7.org/linux/man-pages/man2/execve.2.html
[mktemp]: https://www.gnu.org/software/coreutils/manual/html_node/mktemp-invocation.html
[flock]: https://raw.githubusercontent.com/util-linux/util-linux/master/sys-utils/flock.1.adoc
[crontab]: https://github.com/cronie-crond/cronie/blob/master/man/crontab.5
[cron]: https://raw.githubusercontent.com/cronie-crond/cronie/master/man/cron.8
[timer]: https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html
[service]: https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html
[exec]: https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html
[time]: https://www.freedesktop.org/software/systemd/man/latest/systemd.time.html
