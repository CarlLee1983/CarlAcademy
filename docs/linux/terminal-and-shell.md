# 終端與 Shell

打開終端視窗、輸入命令、看到結果，是使用 Linux 的一種方式。視窗、解讀命令的程式，以及最後執行的工具各有角色；先分清楚它們，才容易理解命令為什麼能執行、空白為什麼會改變結果。

本文以 **Linux 上的 Bash** 說明命令語法，不假設所有 Linux 系統都預設使用 Bash。閱讀前不需要寫過程式；作業系統與發行版的背景可先看[認識 Linux](what-is-linux.md)。查證日期：**2026-11-02**。下列安全範例中的引號、變數、`export`、命令類型與結束狀態，已在 **macOS（Darwin）的 Bash 5.3.9** 驗證；未在 Linux 實測。Linux 終端裝置與工具供應情況依官方文件說明，不能把本機結果當作 Linux 環境保證。

## 終端、TTY 與 Shell 各做什麼

| 名詞 | 角色 | 例子 |
|---|---|---|
| 終端（terminal） | 讓使用者與程式以文字互動的輸入輸出介面；早期可以是實體設備 | 鍵盤輸入文字、螢幕呈現回應 |
| 終端模擬器（terminal emulator） | 用軟體提供終端功能，包含文字顯示與終端控制序列的處理 | 圖形桌面裡的 xterm 視窗 |
| TTY | Linux 核心處理終端裝置的介面；也包含軟體提供的偽終端（PTY） | 圖形終端模擬器通常透過 PTY 連接程式 |
| Shell | 解讀並執行命令的程式，也提供變數、引號與流程控制等語言功能 | Bash |

xterm 自身是終端模擬器；Linux 核心則有 TTY 與 PTY 的裝置機制。Shell 是在這些介面上讀取命令的程式，與視窗本身不同。Linux 也有文字模式的虛擬主控台與序列主控台，因此終端不一定是圖形視窗。[來源：xterm][xterm]、[Linux TTY][tty]、[Linux 主控台][console]、[Bash 的 Shell 定義][shell]

一般互動可以想成：

```text
鍵盤 → 終端模擬器 → 終端裝置介面 → Shell → 執行命令
              ← 在終端顯示程式的文字結果 ←
```

Shell 也可以從字串或腳本讀取命令，不需要有人一直在終端輸入；自動化會用到這種非互動模式。[來源：Bash 手冊][shell]

看到 `carl@host:~$` 這類文字時，它是 **命令提示符（prompt）**。提示符可以自訂，並非命令的一部分。本文可輸入的程式碼區塊都省略提示符，請不要自行加上 `$` 或 `#`；另列為「預期輸出」的區塊也不用輸入。[來源：Bash 提示符][prompt]

## 一行命令如何構成

最簡單的命令可以先讀成「命令名稱，加上傳給它的引數（arguments）」。Shell 依空白與語法規則辨認各個部分，再執行命令。[來源：Bash simple commands][simple]

```bash
printf '%s\n' 'hello Linux'
```

這裡有三個部分：`printf` 是命令名稱，`'%s\n'` 是格式引數，`'hello Linux'` 是要顯示的文字引數。格式中的 `%s` 表示字串，`\n` 表示換行；引號由 Shell 處理，不會成為這兩個引數的內容。[來源：Bash printf][builtins]

預期輸出：

```text
hello Linux
```

工具也可能接受選項，例如 `bash --version` 的 `--version`。**選項如何命名、是否需要值，由各命令定義**；不要假設每個工具都有相同選項。Shell 先解析命令列，工具再解讀收到的引數。[來源：Bash 命令執行][execution]、[Bash 啟動選項][invoking]

### 內建命令與外部程式

有些命令由 Shell 自己實作，稱為內建命令（builtin）；另一些是系統中的外部可執行程式。`cd` 必須改變目前 Shell 的工作目錄，所以是 Bash 內建命令；`bash` 命令則可以啟動另一個 Bash 程式。Bash 的 `printf` 也是內建命令，但系統上也可能有同名外部程式。[來源：Shell 定義][shell]、[Bash builtins][builtins]

在 Bash 中可以詢問一個名字會如何被解讀：

```bash
type cd
type -t bash
```

在本次乾淨 Bash 環境的輸出是：

```text
cd is a shell builtin
file
```

`file` 在這裡表示外部程式，並非叫你開啟某個檔案。互動環境還可能定義別名（alias）或函式，所以同名命令的實際來源要以目前環境的 `type` 結果為準。[來源：Bash type][builtins]

## 空白與引號會改變引數

空白通常用來分隔命令中的不同部分；若文字本身含有空白，可以用引號讓它保持為一個引數。變數用 `名稱=值` 指定，等號兩旁不加空白；`$名稱` 則取出它的值。[來源：Bash simple commands][simple]、[Shell parameters][parameters]

```bash
academy_topic='Linux shell'
printf '<%s>\n' "$academy_topic"
printf '<%s>\n' $academy_topic
```

預期輸出（使用 Bash 預設的空白分割設定）：

```text
<Linux shell>
<Linux>
<shell>
```

第一個 `printf` 收到一個文字引數；第二個的未加引號變數展開經過 word splitting，變成兩個。未加引號的展開還可能觸發檔名比對，因此一般要把字串當成一個引數傳遞時，使用 `"$變數"`。[來源：Bash word splitting][splitting]、[filename expansion][filename-expansion]

單引號與雙引號的差別也很常用：

```bash
printf '%s\n' '$academy_topic'
printf '%s\n' "$academy_topic"
```

預期輸出：

```text
$academy_topic
Linux shell
```

單引號保留其中字元的原樣；雙引號仍允許 `$academy_topic` 這類變數展開，同時保護這個字串中的空白。引號不是顯示樣式，而是 Shell 語法的一部分。[來源：Bash 單引號][single-quotes]、[雙引號][double-quotes]

## 不熟悉命令時，先看哪份說明

Bash 內建命令先用 `help`；例如：

```bash
help printf
help export
```

`help` 說明目前 Bash 的內建命令，適合搭配 `type` 使用，避免查到同名外部程式的不同規則。[來源：Bash help 與 type][builtins]

Linux 系統若安裝了 `man` 與對應手冊，可以用 `man bash` 閱讀 Bash 手冊。若沒有本機文件，本文的 [GNU Bash Reference Manual][manual] 也可直接閱讀。需要查特定工具的選項時，使用該工具自己的手冊；`--help` 是不少工具採用的形式，仍須確認該工具是否支援。Bash 自己提供 `bash --help` 與 `bash --version`。[來源：Bash 維護者提供的文件入口][bash-home]、[Bash 啟動選項][invoking]

## Shell 變數、環境變數與 PATH

Shell 變數存在於目前 Shell；**標記為匯出的變數**，會放入之後啟動的子程序環境。環境（environment）是一組名稱和值，不是所有程序共用的一張即時變數表。[來源：Bash environment][environment]

以下用一個新的 Bash 子程序觀察差異，假設環境沒有設定 `BASH_ENV`。`--noprofile` 與 `--norc` 分別停用登入設定檔與互動式 `.bashrc`，`-c` 後面的字串就是要執行的命令。非互動 Bash 仍可能讀取 `BASH_ENV` 指定的檔案，這兩個選項不會停用它。[來源：Bash 啟動選項][invoking]、[BASH_ENV 定義][bash-variables]

```bash
unset ACADEMY_TOPIC
ACADEMY_TOPIC='terminal'
bash --noprofile --norc -c 'printf "before export: <%s>\n" "$ACADEMY_TOPIC"'
export ACADEMY_TOPIC
bash --noprofile --norc -c 'printf "after export: <%s>\n" "$ACADEMY_TOPIC"; ACADEMY_TOPIC=child'
printf 'parent: <%s>\n' "$ACADEMY_TOPIC"
unset ACADEMY_TOPIC
```

預期輸出：

```text
before export: <>
after export: <terminal>
parent: <terminal>
```

`export` 後才啟動的子程序取得 `terminal`；子程序把自己的值改成 `child`，不會回頭改變父 Shell。`export` 也不會修改已經執行的其他程序，或自動永久保存到下次登入。[來源：Bash environment][environment]、[command execution environment][execution-environment]

### 為什麼只輸入名字就能執行程式

`PATH` 是以冒號 `:` 分隔的目錄清單，用於尋找外部命令。例如 `/usr/local/bin:/usr/bin:/bin` 表示這些搜尋位置，實際內容依系統而異。可以只讀取自己的設定：

```bash
printf '%s\n' "$PATH"
```

在一般 Bash 查找流程中，沒有 `/` 的命令名稱會先考慮函式、內建命令，再依 `PATH` 尋找外部程式；Bash 也會快取已找到的外部路徑。明確寫出含 `/` 的路徑則不走這個 `PATH` 搜尋。因此「找不到命令」可能是沒有安裝，也可能是所在目錄不在 `PATH`，需要先確認原因。[來源：Bash command search][execution]、[PATH 定義][variables]

`SHELL` 是另一個常見環境變數，但 **`printf '%s\n' "$SHELL"` 不保證告訴你目前正在執行的 Shell**。Bash 可能繼承原有值；未設定時才依登入 Shell 補上。啟動另一種 Shell 不代表這個值一定同步更新。本文要求 Bash 語法的範例，應在已確認使用 Bash 的環境執行。[來源：Bash SHELL 定義][bash-variables]

## 結果不只在畫面上：結束狀態

命令完成後，會交回結束狀態（exit status）。Bash 使用 `0` 表示成功，非 `0` 表示未成功；具體非零值的意思需要看該命令的規定。`$?` 可取得上一個命令的狀態，因此要緊接著讀取，避免被下一個命令覆蓋。[來源：Bash exit status][exit-status]

```bash
true
printf 'true: %s\n' "$?"
false
printf 'false: %s\n' "$?"
```

預期輸出：

```text
true: 0
false: 1
```

`true` 與 `false` 本身不顯示文字，卻交回不同狀態。畫面沒有訊息不等於失敗，看到文字也不等於成功；日後寫條件判斷或自動化時，會依這個狀態決定下一步。[來源：Bash true／false][bourne-builtins]、[exit status][exit-status]

## 相關文件

- [Linux 知識索引](README.md)：本主題的閱讀入口。
- [認識 Linux](what-is-linux.md)：核心、作業系統與發行版的關係。
- [檔案與目錄](files-and-directories.md)：接續理解路徑、工作目錄與檔案操作。
- [文字處理](text-processing.md)：接續理解標準輸入輸出、重新導向與管線。
- [Shell 腳本與工作自動化](shell-scripting-and-automation.md)：把命令組合成可重複執行的腳本。

## 參考來源

以下均於 2026-11-02 查閱。GNU 網站部分頁面連線不穩，Bash 全文亦透過維護者 Chet Ramey 的網站查閱同一份 GNU Bash 5.3 手冊；本機安裝隨附的手冊與 `help` 用於交叉核對，未以 macOS 外部工具行為推定 Linux 行為。

- [GNU Bash Reference Manual][manual]：本篇引用的語法與行為定義。
- [Bash 維護者文件入口][bash-home]：手冊與 man page 的入口。
- [xterm 官方介紹][xterm]：終端模擬器的角色。
- [Linux 核心 TTY Driver and TTY Operations][tty]：TTY／PTY 介面。
- [Linux 核心 Serial Console][console]：虛擬與序列主控台。

[manual]: https://tiswww.case.edu/php/chet/bash/bashref.html
[bash-home]: https://tiswww.case.edu/php/chet/bash/bashtop.html
[shell]: https://www.gnu.org/software/bash/manual/html_node/What-is-a-shell_003f.html
[simple]: https://www.gnu.org/software/bash/manual/html_node/Simple-Commands.html
[single-quotes]: https://www.gnu.org/software/bash/manual/html_node/Single-Quotes.html
[double-quotes]: https://www.gnu.org/software/bash/manual/html_node/Double-Quotes.html
[parameters]: https://tiswww.case.edu/php/chet/bash/bashref.html#Shell-Parameters
[splitting]: https://tiswww.case.edu/php/chet/bash/bashref.html#Word-Splitting
[filename-expansion]: https://tiswww.case.edu/php/chet/bash/bashref.html#Filename-Expansion
[builtins]: https://tiswww.case.edu/php/chet/bash/bashref.html#Bash-Builtins
[bourne-builtins]: https://tiswww.case.edu/php/chet/bash/bashref.html#Bourne-Shell-Builtins
[invoking]: https://tiswww.case.edu/php/chet/bash/bashref.html#Invoking-Bash
[prompt]: https://tiswww.case.edu/php/chet/bash/bashref.html#Controlling-the-Prompt
[execution]: https://tiswww.case.edu/php/chet/bash/bashref.html#Command-Search-and-Execution
[execution-environment]: https://tiswww.case.edu/php/chet/bash/bashref.html#Command-Execution-Environment
[environment]: https://tiswww.case.edu/php/chet/bash/bashref.html#Environment
[variables]: https://tiswww.case.edu/php/chet/bash/bashref.html#Bourne-Shell-Variables
[bash-variables]: https://tiswww.case.edu/php/chet/bash/bashref.html#Bash-Variables
[exit-status]: https://tiswww.case.edu/php/chet/bash/bashref.html#Exit-Status
[xterm]: https://invisible-island.net/xterm/xterm.html
[tty]: https://www.kernel.org/doc/html/latest/driver-api/tty/tty_driver.html
[console]: https://www.kernel.org/doc/html/latest/admin-guide/serial-console.html
