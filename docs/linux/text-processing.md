# 文字處理

文字工具最有用的地方，是能把同一份資料依序「讀取 → 篩選 → 擷取 → 彙整」，不必每一步都開編輯器。例如從日誌找出錯誤，再計算各個服務出現幾次。要理解這些命令，先看資料從哪裡進來、往哪裡出去。

本文以 **GNU/Linux 上的 Bash、GNU Coreutils 與 GNU grep** 為主要範圍；`less` 是另一個獨立工具，不屬於 Coreutils。先備知識可見[終端與 Shell](terminal-and-shell.md)及[檔案與目錄](files-and-directories.md)。查證日期：**2026-11-02**。官方搜尋擷取顯示的 Coreutils／grep 手冊版本為 9.11／3.12；實機若版本不同，仍需查自己的手冊。

**驗證範圍：**所有完整 Bash 範例已通過 `bash -n`；非互動範例在 macOS（Darwin）、Bash 5.3.9 與本機工具執行，未在 Linux 或 GNU Coreutils／GNU grep 實測。互動式 `less` 僅核對手冊與語法，沒有進行互動操作測試。以下輸出均標為「預期」，不把 macOS 觀察當作 Linux 保證。

## 三條標準資料流

程序通常從三個標準檔案描述符開始與外界互動；數字是描述符編號，不是檔名。[Bash：Redirections][redirect]

| 名稱 | 編號 | 用途 | 互動終端裡常見的去向 |
| --- | --- | --- | --- |
| 標準輸入（stdin） | 0 | 程序讀取資料 | 鍵盤輸入 |
| 標準輸出（stdout） | 1 | 程序送出主要結果 | 終端畫面 |
| 標準錯誤（stderr） | 2 | 程序送出診斷訊息 | 同一個終端畫面 |

stdout 與 stderr 雖然常顯示在同一處，仍是不同通道。如此一來，搜尋結果可以交給下一個工具，而「檔案不存在」等訊息留給人看。畫面上有字，也不能據此判斷結束狀態是否成功；狀態與輸出是不同資訊。[Bash：Redirections][redirect]、[Exit Status][exit]

有些工具能從檔案引數讀取，也能在未指定檔案時讀取 stdin。例如 `cat` 沒有檔案引數時會讀 stdin；在終端直接執行後看似停住，可能只是等待輸入，不是當掉。本文的範例都明確指定輸入來源，不需要在終端手動輸入資料。[GNU cat][cat]

## 先看內容：cat、less、head、tail

| 工具 | 適合的問題 | 基本行為與來源 |
| --- | --- | --- |
| `cat` | 這份短文字寫了什麼？把幾份內容接在一起？ | 按引數順序將內容複製到 stdout；不會自動加分隔線。[手冊][cat] |
| `less` | 長文字要前後翻閱與搜尋？ | 互動式分頁檢視器；可往回移動、搜尋。[官方 FAQ][less] |
| `head -n 2` | 前兩行是什麼？ | 顯示開頭指定行數；未指定時預設十行。[手冊][head] |
| `tail -n 2` | 最後兩行是什麼？ | 顯示結尾指定行數；未指定時預設十行。[手冊][tail] |

以下每個 Bash 區塊都能獨立執行：`(...)` 在子 Shell 中運作，`mktemp -d` 建立新目錄，`cd` 失敗就停止。寫入只發生在這個新目錄；範例保留練習檔案，不自動刪除。隨機暫存路徑每次不同。[GNU mktemp][mktemp]

```bash
(
  text_lab=$(mktemp -d) || exit 1
  cd -- "$text_lab" || exit 1
  printf '%s\n' 'INFO api ready' 'ERROR api timeout' 'INFO worker ready' \
    'ERROR worker disk.full' 'ERROR api timeout' > events.log
  cat events.log
  printf '%s\n' '--- first two ---'
  head -n 2 events.log
  printf '%s\n' '--- last two ---'
  tail -n 2 events.log
)
```

預期輸出：

```text
INFO api ready
ERROR api timeout
INFO worker ready
ERROR worker disk.full
ERROR api timeout
--- first two ---
INFO api ready
ERROR api timeout
--- last two ---
ERROR worker disk.full
ERROR api timeout
```

如果資料很長，可完整執行下面這段進入 `less`。空白鍵往後一頁、`b` 往前一頁、輸入 `/ERROR` 後按 Enter 向前搜尋，再用 `n` 找下一處、`q` 離開。這些是 `less` 裡的按鍵，不是 Shell 命令；`less` 的搜尋模式也可能解讀正規表示式。[less 官方說明][less]；按鍵細節另以本機隨附 `less(1)` 手冊核對。

```bash
(
  text_lab=$(mktemp -d) || exit 1
  cd -- "$text_lab" || exit 1
  printf '%s\n' 'INFO api ready' 'ERROR api timeout' > events.log
  less events.log
)
```

GNU `tail -f` 可持續等待檔案新增內容，適合觀察仍在寫入的日誌；它不會像一般 `tail` 自動讀完就結束。日誌輪替時，GNU 預設 `-f` 跟隨已開啟的檔案描述符，與按名稱追蹤不同；需追蹤同一路徑被換成新檔案的情境，可查 `--follow=name`、`--retry`（組合簡寫 `-F`）。本文不啟動常駐追蹤，避免練習一直等待。[GNU tail][tail]

## grep：搜尋的是符合條件的行

`grep` 預設輸出包含符合內容的整行；它不是只印出找到的那幾個字。未指定輸入檔案時，通常從 stdin 讀取。搜尋前先決定要比對「原樣文字」還是「模式」，可以少掉很多意外。[GNU grep：Programs][grep-programs]

- **原樣文字（fixed string）：**用 `grep -F`。例如 `disk.full` 的點就是一個點。
- **正規表示式（regular expression，regex）：**預設是基本正規表示式（BRE）；`grep -E` 使用擴充正規表示式（ERE）。本文明確用 `-E` 表示模式搜尋。[GNU grep：Programs][grep-programs]

正規表示式中的 `.` 代表一個字元，`^` 限定行首、`$` 限定行尾；ERE 的 `|` 表示兩個選擇。它們與 Shell 用來展開檔名的模式是不同規則。單引號讓 Shell 把模式完整傳給 grep；**單引號本身不會關閉 grep 的 regex 解讀**，要搜尋原樣文字仍應使用 `-F`。[GNU grep：Fundamental Structure][regex]、[Anchoring][anchor]

```bash
(
  text_lab=$(mktemp -d) || exit 1
  cd -- "$text_lab" || exit 1
  printf '%s\n' 'ERROR api disk.full' 'INFO api diskXfull' \
    'WARN worker retry' > events.log
  printf '%s\n' '--- literal ---'
  grep -F -n -- 'disk.full' events.log
  printf '%s\n' '--- regex ---'
  grep -E -- 'disk.full' events.log
  printf '%s\n' '--- line start ---'
  grep -E -- '^(ERROR|WARN) ' events.log
)
```

預期輸出：

```text
--- literal ---
1:ERROR api disk.full
--- regex ---
ERROR api disk.full
INFO api diskXfull
--- line start ---
ERROR api disk.full
WARN worker retry
```

`-n` 加上行號；`-i` 忽略大小寫；`-v` 反向選出不符合的行。`--` 結束選項解析，讓以 `-` 開頭的模式不被誤當選項。當搜尋條件是使用者提供的字詞、網址或檔名，先用 `-F` 往往比較符合「找這串文字」的意思。[GNU grep：Matching Control][matching]、[Output Line Prefix Control][prefix]、[Other Options][grep-other]

## 重新導向：讓結果進檔案

重新導向由 Shell 安排，不是 `grep` 或 `cat` 自己解析 `>`。[Bash：Redirections][redirect]

| 寫法 | 意義 |
| --- | --- |
| `< input.txt` | 從檔案供應 stdin |
| `> output.txt` | 把 stdout 寫入檔案；通常先清空既有內容 |
| `>> output.txt` | 把 stdout 附加在檔案結尾，檔案不存在則建立 |
| `2> errors.txt` | 把 stderr 寫入另一檔案；通常先清空既有內容 |
| `> all.txt 2>&1` | 先將 stdout 指向檔案，再讓 stderr 使用同一去向 |

`>` 的清空發生在執行命令前；不要嘗試用 `grep pattern file > file` 篩選後寫回同一份檔案，原內容可能先被清空。`noclobber` 等 Shell 設定會影響覆寫行為，但不應把它當成可以放心寫回輸入檔的理由。需要保存轉換結果時，先寫入不同檔名並核對。[Bash：Redirecting Output][output]

```bash
(
  text_lab=$(mktemp -d) || exit 1
  cd -- "$text_lab" || exit 1
  printf '%s\n' 'INFO api ready' 'ERROR api timeout' > events.log
  grep -F -- 'ERROR' events.log > errors.txt
  printf '%s\n' 'ERROR worker offline' >> errors.txt
  cat events.log missing.log > copied.txt 2> diagnostics.txt
  cat_status=$?
  printf 'cat status: %s\n' "$cat_status"
  printf '%s\n' '--- saved errors ---'
  cat errors.txt
  printf '%s\n' '--- copied content ---'
  cat copied.txt
  printf '%s\n' '--- diagnostic ---'
  cat diagnostics.txt
)
```

預期 `cat status` 為非零；`errors.txt` 有兩行 ERROR，而 `copied.txt` 只有原本兩行日誌。診斷檔另有一則 `missing.log` 不存在的訊息；文字與非零狀態值依工具及語系而異，不在這裡假設固定字樣。這也說明命令可能先產生部分結果，之後才失敗。[GNU cat][cat]

重新導向依左至右處理，`> all.txt 2>&1` 與 `2>&1 > all.txt` 不同：後者先讓 stderr 指向當時的 stdout，再只改 stdout 的去向，stderr 不會隨後自動搬進檔案。`2>&1` 的意思是複製描述符的去向，並非寫入一個叫 `1` 的檔案。[Bash：Redirections][redirect]

## 管線：把結果交給下一個工具

`A | B` 將 A 的 stdout 接到 B 的 stdin；預設不包含 A 的 stderr，也不是把畫面截圖交給 B。各階段可以同時運作，不必先存完一份中間檔案。[Bash：Pipelines][pipeline]

```text
events.log → grep 篩選 ERROR → cut 擷取服務名稱 → sort 排序 → uniq 計次
```

下面的自訂日誌格式固定是「等級、服務、訊息」，中間各一個空白。先利用這個資料契約，再決定 `cut` 是否適合。

```bash
(
  text_lab=$(mktemp -d) || exit 1
  cd -- "$text_lab" || exit 1
  export LC_ALL=C
  printf '%s\n' 'INFO api ready' 'ERROR api timeout' 'INFO worker ready' \
    'ERROR worker disk.full' 'ERROR api timeout' > events.log
  grep -E -- '^ERROR ' events.log | cut -d ' ' -f 2 | sort | uniq -c
  printf '%s\n' '--- error line count ---'
  grep -E -- '^ERROR ' events.log | wc -l
  printf '%s\n' '--- numeric sort ---'
  printf '%s\n' 2 10 1 | sort -n
)
```

預期計數是 `api` 兩次、`worker` 一次，錯誤行數是 3，數值排序為 1、2、10；`uniq -c`、`wc` 的前置空白可能依實作而異。

各步驟都有不同限制：

- `cut -d ' ' -f 2` 依單一空白分隔，取第二欄；預設分隔符是 Tab。它不會自動把連續多個空白合成一個，也不會處理 CSV 的引號規則。若來源格式改變，就應改用理解該格式的解析工具，不能只換副檔名。[GNU cut][cut]
- `sort` 預設做文字排序，受 locale 的排序規則影響；`sort -n` 才按數值比較。範例在子 Shell 設定 `LC_ALL=C`，讓 ASCII 例子的排序較可預測，並不代表中文也應照此排序。[GNU sort][sort]
- `uniq` 只合併**相鄰**的重複行，所以先排序，再用 `uniq -c` 計算每組次數。這會改變原順序；若需要保留事件時間順序，就不能把這份彙整結果當原始日誌。[GNU uniq][uniq]
- `wc -l` 計算換行字元數，不是螢幕上折行後的列數。最後一段文字沒有換行時，不算進 `-l`；`-c` 是位元組數、`-m` 是依 locale 計算的字元數，UTF-8 中文不應假設一個字就是一個位元組。[GNU wc][wc]

篩選時直接指定檔案即可，無需每次都先加 `cat`；例如前例的 `grep` 自己會讀 `events.log`。管線主要用在上一個工具產生下一步真正需要的資料時。

## 管線看起來成功，前面卻可能失敗

對一般前景管線，Bash 預設以**最後一個命令**的狀態代表整條管線。若 grep 沒找到任何行，後面的 `wc -l` 仍可正常輸出 0 並成功；整條管線狀態便可能是 0。[Bash：Pipelines][pipeline]

GNU grep 正常有選出行時回傳 0、沒選出行回傳 1、發生錯誤通常回傳 2。因此非零不全都代表程式壞掉，必須知道工具對狀態的定義。其他 grep 實作的錯誤碼可能大於 2；`-q` 也有特殊規則，本文不使用它。[GNU grep：Exit Status][grep-exit]

```bash
(
  text_lab=$(mktemp -d) || exit 1
  cd -- "$text_lab" || exit 1
  printf '%s\n' 'INFO api ready' > events.log
  set +e
  set +o pipefail
  grep -F -- 'ERROR' events.log | wc -l
  printf 'default pipeline: %s\n' "$?"

  set -o pipefail
  grep -F -- 'ERROR' events.log | wc -l
  printf 'pipefail pipeline: %s; stages: %s\n' "$?" "${PIPESTATUS[*]}"
)
```

預期兩次計數都是 0；第一次管線狀態為 0，第二次為 1，`stages` 為 `1 0`（grep、wc）。範例用 `set +e` 明確允許展示非零狀態後繼續執行；所有選項只改到子 Shell。

啟用 `pipefail` 後，若有非零狀態，Bash 取管線中**位置最右側的非零狀態**，不是依完成先後決定；全部為零才回傳 0。`${PIPESTATUS[*]}` 則列出各階段狀態。兩者都應緊接著讀取：連一個 `printf` 也會更新 `$?` 與 `PIPESTATUS`，所以範例在同一個命令的引數展開時一起取得。[Bash：Pipelines][pipeline]、[PIPESTATUS][variables]

`pipefail` 能揭露前段的非零狀態，但不能替你判定業務上的成功。例如「找不到 ERROR」可能正是健康結果；下游 `head` 提早讀夠就關閉管線，也可能使仍寫入的上游遇到 broken pipe。自動化必須分清預期無結果、真正讀取失敗與刻意提前結束；條件判斷與錯誤處理可接著讀[Shell 腳本與工作自動化](shell-scripting-and-automation.md)。[Bash：Pipelines][pipeline]、[GNU grep：Usage 的管線注意事項][grep-usage]

## 選工具前，先確認資料形狀

這些例子刻意使用每筆一行、固定分隔符的短文字。對壓縮檔、二進位檔、JSON、帶引號與換行欄位的 CSV，不應直接假設「一行等於一筆紀錄」。同樣地，用 `grep` 搜尋原始文字，不能取代解析後的欄位條件。先確認格式，再問要保留哪些行、哪些欄、是否允許排序，工具組合才有明確意義。

## 相關閱讀與來源

- [Linux 知識索引](README.md)
- [終端與 Shell](terminal-and-shell.md)：引數、引號、命令查找與單一命令的結束狀態。
- [檔案與目錄](files-and-directories.md)：路徑與安全操作暫存檔。
- [Shell 腳本與工作自動化](shell-scripting-and-automation.md)：把資料流程整理成可重複執行的腳本。

以上官方來源查證於 **2026-11-02**。GNU 部分頁面全文讀取逾時，Coreutils 與 grep 的引用依官方頁面搜尋擷取查閱，不宣稱已通讀整份手冊。Bash 查閱維護者 Chet Ramey 提供的 5.3 手冊，另以本機隨附 Bash Info 核對重新導向、管線與 `PIPESTATUS`。`less` 查閱官方 FAQ，按鍵補以本機隨附 `less(1)` 手冊核對；其選項或預設可能受版本、環境設定影響。

[cat]: https://www.gnu.org/software/coreutils/manual/html_node/cat-invocation.html
[head]: https://www.gnu.org/software/coreutils/manual/html_node/head-invocation.html
[tail]: https://www.gnu.org/s/coreutils/manual/html_node/tail-invocation.html
[mktemp]: https://www.gnu.org/software/coreutils/manual/html_node/mktemp-invocation.html
[cut]: https://www.gnu.org/s/coreutils/manual/html_node/cut-invocation.html
[sort]: https://www.gnu.org/software/coreutils/manual/html_node/sort-invocation.html
[uniq]: https://www.gnu.org/s/coreutils/manual/html_node/uniq-invocation.html
[wc]: https://www.gnu.org/s/coreutils/manual/html_node/wc-invocation.html
[less]: https://www.greenwoodsoftware.com/less/faq.html
[grep-programs]: https://www.gnu.org/software/grep/manual/html_node/grep-Programs.html
[matching]: https://www.gnu.org/software/grep/manual/html_node/Matching-Control.html
[prefix]: https://www.gnu.org/software/grep/manual/html_node/Output-Line-Prefix-Control.html
[grep-other]: https://www.gnu.org/software/grep/manual/html_node/Other-Options.html
[regex]: https://www.gnu.org/software/grep/manual/html_node/Fundamental-Structure.html
[anchor]: https://www.gnu.org/software/grep/manual/html_node/Anchoring.html
[grep-exit]: https://www.gnu.org/software/grep/manual/html_node/Exit-Status.html
[grep-usage]: https://www.gnu.org/software/grep/manual/html_node/Usage.html
[redirect]: https://tiswww.case.edu/php/chet/bash/bashref.html#Redirections
[output]: https://tiswww.case.edu/php/chet/bash/bashref.html#Redirecting-Output
[pipeline]: https://tiswww.case.edu/php/chet/bash/bashref.html#Pipelines
[exit]: https://tiswww.case.edu/php/chet/bash/bashref.html#Exit-Status
[variables]: https://tiswww.case.edu/php/chet/bash/bashref.html#Bash-Variables
