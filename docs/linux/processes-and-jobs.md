# 程序

同一份程式可以開好幾次，每次有自己的執行狀態；把命令放到背景，也不代表它成為系統服務。理解程序、Shell 工作與訊號，才能知道命令正在等待什麼、如何把它帶回終端，以及何時適合請它結束。

本文以 **Linux、Bash 與 procps-ng 的 `ps`／`top`** 為範圍。先備知識是[終端與 Shell](terminal-and-shell.md)中的命令、變數與結束狀態。查證日期：**2026-11-02**。本文已查閱下列一手文件並做 Bash 語法檢查；**未在 Linux 實測，也未實際執行本文的程序控制範例**。所有輸出均為示意或預期行為。macOS 的 `ps`／`top` 與 Linux 版本不同，不應直接套用其選項與狀態定義。

## 程式、程序與執行緒

| 名詞 | 可以怎麼理解 | 例子 |
|---|---|---|
| 程式（program） | 描述要做什麼的程式碼或可執行內容 | 磁碟上的 `sleep` 可執行檔 |
| 程序（process） | 核心管理的一次執行實體，有識別碼、記憶體與開啟的檔案等狀態 | 兩次啟動 `sleep`，會有兩個程序 |
| 執行緒（thread） | 程序內的執行路徑 | 同一程序可用數個執行緒處理不同工作 |

同一程序中的 POSIX 執行緒共用全域記憶體、開啟的檔案描述符等資源，但各有自己的堆疊與執行緒識別。它們不是各自完全獨立的程序；共享資料也表示程式需要協調同時存取。[來源：pthreads(7)](https://man7.org/linux/man-pages/man7/pthreads.7.html)

**PID（process ID）** 是程序識別碼；**PPID（parent process ID）** 是父程序識別碼。父程序建立子程序時，子程序取得自己的 PID。PID 只適合辨認當下的程序；程序結束後，識別碼之後可能再分配給別的程序，因此不要把舊 PID 當成永久身分。[來源：fork(2)](https://man7.org/linux/man-pages/man2/fork.2.html)、[pidfd_open(2) 的 PID 重用說明](https://man7.org/linux/man-pages/man2/pidfd_open.2.html)

### 建立、換成另一個程式、收尾

常見的外部命令執行流程，可以用三個概念理解：

```text
父程序（例如 Shell）
  └─ fork：建立子程序，子程序有自己的 PID
       └─ exec：子程序以另一個程式取代目前執行內容
            └─ 程式結束，父程序以 wait 取得結束資訊並回收
```

- **fork**：建立子程序；父子程序有各自的記憶體空間，初始內容源自父程序。[來源：fork(2)](https://man7.org/linux/man-pages/man2/fork.2.html)
- **exec**：不是再多開一個程序，而是替換目前程序的程式映像；PID 保持不變。[來源：execve(2)](https://man7.org/linux/man-pages/man2/execve.2.html)
- **wait**：父程序取得子程序的狀態變化；對已結束的子程序執行等待，可讓系統釋放它留下的結束紀錄。[來源：wait(2)](https://man7.org/linux/man-pages/man2/wait.2.html)

這是理解生命週期的概念圖，不是所有命令逐步追蹤的實測結果。Bash 內建命令可直接由 Shell 執行，不必每次建立外部程序；Bash 本身也提供 `wait` 內建命令，讓命令列或腳本等待自己啟動的子程序。[來源：Bash 命令執行](https://tiswww.case.edu/php/chet/bash/bashref.html#Command-Search-and-Execution)、[Job Control Builtins](https://tiswww.case.edu/php/chet/bash/bashref.html#Job-Control-Builtins)

## 前景、背景與 Shell 的工作表

互動式 Bash 的 **工作控制（job control）**，會把一條管線當成一個工作（job）管理。工作可能包含一個或多個程序。`jobs` 列的是**目前 Shell 的工作表**，不是整台機器的程序；另一個終端視窗有自己的 Shell 與工作表。[來源：Bash Job Control Basics](https://tiswww.case.edu/php/chet/bash/bashref.html#Job-Control-Basics)

前景工作使用終端的前景程序群組，通常能接收鍵盤輸入；Shell 會等它完成或停止，才重新提供提示符。命令後加 `&` 會非同步執行，讓 Shell 不必等它完成。背景工作仍可能把文字寫到終端；若嘗試從控制終端讀取，通常會收到 `SIGTTIN` 而停止。背景不是「沒有輸出」，也不是「登出後一定繼續執行」。[來源：Bash Job Control Basics](https://tiswww.case.edu/php/chet/bash/bashref.html#Job-Control-Basics)、[Signals](https://tiswww.case.edu/php/chet/bash/bashref.html#Signals)

以下在**支援工作控制的互動式 Bash** 同一個視窗逐行輸入；每組範例分開執行，做完再開始下一組。不要把 `fg`／`bg` 的互動步驟當成一般非互動腳本流程。Bash 預設在非互動模式不啟用工作控制。[來源：Bash Signals](https://tiswww.case.edu/php/chet/bash/bashref.html#Signals)

### 用自己的短時間工作認識 `$!` 與 `wait`

```bash
sleep 10 &
academy_pid=$!
printf 'child PID: %s\n' "$academy_pid"
jobs -l
wait "$academy_pid"
printf 'wait status: %s\n' "$?"
unset academy_pid
```

`$!` 是最近放到背景的工作的 PID；此處只有一個 `sleep`，所以它就是該 `sleep` 的 PID。緊接啟動後保存，避免稍後啟動別的背景工作而覆蓋。`wait` 等它結束，正常完成時預期狀態為 `0`。[來源：Bash Special Parameters](https://tiswww.case.edu/php/chet/bash/bashref.html#Special-Parameters)、[Job Control Builtins](https://tiswww.case.edu/php/chet/bash/bashref.html#Job-Control-Builtins)

啟動時可能看到這種**示意訊息**：

```text
[1] 24680
```

`1` 是工作編號，可寫成 jobspec `%1`；`24680` 是 PID。兩者不能互換，實際數字也不固定。`jobs -l` 額外列出 PID；工作已完成時，狀態與顯示時機可能不同。[來源：Bash Job Control](https://tiswww.case.edu/php/chet/bash/bashref.html#Job-Control)

### 停止、背景繼續與帶回前景

先建立自己的背景工作，記錄 PID，並確認工作表後帶到前景：

```bash
sleep 30 &
academy_pid=$!
printf 'child PID: %s\n' "$academy_pid"
jobs -l
fg %+
```

`%+` 是目前工作，此處應與剛記錄的 PID 對應；確認 `jobs -l` 後才繼續。它進入前景後，**按一次 Ctrl-Z**，通常會送出 `SIGTSTP`，讓工作暫停並回到提示符。這不是結束程序。[來源：Bash Job Control Basics](https://tiswww.case.edu/php/chet/bash/bashref.html#Job-Control-Basics)

接著輸入：

```bash
jobs -l
bg %+
fg %+
unset academy_pid
```

`%+` 指目前工作；此處是剛停止的那個工作。`bg` 讓它在背景繼續，`fg` 再帶回前景。最後等 `sleep` 剩餘時間結束，或在它仍位於前景時按 Ctrl-C；一般終端設定下，Ctrl-C 向前景程序群組送出 `SIGINT`。若操作較慢而 `sleep` 已結束，`bg`／`fg` 可能回報工作不存在，這不是異常。實際使用其他工作時，先用 `jobs -l` 確認對象，別假設 `%+` 永遠指同一個工作。[來源：Bash Job Control Basics 與 Builtins](https://tiswww.case.edu/php/chet/bash/bashref.html#Job-Control)

## 用 ps 與 top 看程序

`ps` 是某個時間點的快照，`top` 則反覆更新觀察畫面。以下是 **Linux procps-ng 選項**，先建立自己的 `sleep` 並直接用保存的 PID 篩選，不用名字猜測目標。[來源：procps-ng ps 手冊](https://gitlab.com/procps-ng/procps/-/raw/master/man/ps.1)、[top 手冊](https://gitlab.com/procps-ng/procps/-/raw/master/man/top.1)

```bash
sleep 30 &
academy_pid=$!
ps -p "$academy_pid" -o pid,ppid,stat,etime,comm
top -p "$academy_pid"
wait "$academy_pid"
unset academy_pid
```

在 `top` 中按 `q` 離開觀察畫面；這只結束 `top`，不會結束被觀察的 `sleep`。若它已自然結束，畫面可能已沒有該列。不要在這個練習使用 `top` 的送訊號功能。[來源：procps-ng top 的互動命令與 PID 篩選](https://gitlab.com/procps-ng/procps/-/raw/master/man/top.1)

`ps` 的**示意輸出，並非實測**：

```text
    PID    PPID STAT     ELAPSED COMMAND
  24680   24000 S          00:00 sleep
```

| 欄位 | 意思 |
|---|---|
| `PID` | 這個程序的識別碼 |
| `PPID` | 父程序識別碼；此例通常是啟動它的 Shell |
| `STAT` | 主要狀態加上可能的補充旗標 |
| `ELAPSED` | 自啟動至今經過的時間，不是 CPU 使用時間 |
| `COMMAND` | 此例選用 `comm`，顯示命令名稱，不是完整引數 |

以上欄位由 `-o` 選出；`STAT` 後面可能還有 `+` 等旗標，例如 `+` 表示屬於前景程序群組。不要把欄位標題、完整命令列與可執行檔名稱混為一談。[來源：procps-ng ps 的輸出格式與狀態碼](https://gitlab.com/procps-ng/procps/-/raw/master/man/ps.1)

## 訊號是通知，kill 是送訊號

訊號（signal）是系統通知程序事件的一種機制。`kill` 的工作是送訊號，不是所有訊號都讓程序結束。本文使用 Bash 內建 `kill`；未指定訊號時，它預設送 `SIGTERM`。可用 `help kill` 查目前 Bash 的用法。[來源：Bash Job Control Builtins](https://tiswww.case.edu/php/chet/bash/bashref.html#Job-Control-Builtins)

| 訊號 | 預設效果與常見用途 |
|---|---|
| `SIGTERM`／`TERM` | 請求終止；程式可安裝處理方式，先做收尾，也可能忽略它 |
| `SIGKILL`／`KILL` | 強制終止；不能被捕捉、阻擋或忽略，沒有執行使用者程式收尾的機會 |
| `SIGINT`／`INT` | 中斷；通常由 Ctrl-C 產生，預設終止 |
| `SIGTSTP`／`TSTP` | 終端停止；通常由 Ctrl-Z 產生，預設暫停，可處理或忽略 |
| `SIGCONT`／`CONT` | 讓已停止的程序繼續；不會自動把它移到前景 |

這些是預設行為，程式可能為可處理的訊號另訂動作。`SIGSTOP` 也是停止訊號，但與 `SIGTSTP` 不同，它不能被捕捉、阻擋或忽略。使用名稱能比背數字更清楚表達目的。[來源：signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html)

### 只向自己剛啟動的 sleep 送 TERM

以下整組連續執行，不保存 PID 留待日後使用；若中途離開，讓這個短時間 `sleep` 自然結束即可。

```bash
sleep 30 &
academy_pid=$!
kill -s TERM "$academy_pid"
if wait "$academy_pid"; then
    printf '%s\n' 'sleep completed normally'
else
    academy_status=$?
    printf 'sleep ended; wait status: %s\n' "$academy_status"
fi
unset academy_pid academy_status
```

預期 `sleep` 因 `TERM` 結束，`wait` 得到非零狀態。Bash 對因致命訊號終止的命令採 `128 + 訊號編號`，但本文不把固定數字當成跨系統保證。`if` 明確處理非零結果，也避免把正常的終止示範誤讀成腳本必須成功的命令。[來源：Bash Exit Status](https://tiswww.case.edu/php/chet/bash/bashref.html#Exit-Status)

送訊號需要權限，知道 PID 並不代表可以控制它。Linux 一般依送出者與目標的使用者 ID 判定；具備目標使用者命名空間中的 `CAP_KILL` 也可能獲准，`SIGCONT` 另有同 session 的例外。需要更完整的權限背景可讀[使用者與權限](users-and-permissions.md)。不要為了練習加上 `sudo` 去控制其他程序。[來源：kill(2)](https://man7.org/linux/man-pages/man2/kill.2.html)

實務上先確認對象，再給程式正常結束的機會。`KILL` 適用於已確認目標、正常終止無法奏效的情況，不是例行起手式。即使送訊號成功，也只代表送出成功，不能據此認定所有收尾、檔案寫入或相關子程序都已完成；本例用 `wait` 確認自己子程序的結果。[來源：kill(2)](https://man7.org/linux/man-pages/man2/kill.2.html)、[wait(2)](https://man7.org/linux/man-pages/man2/wait.2.html)

## R、S、D、T、Z 代表什麼

以下是 Linux 常見的主要狀態；工具也可能顯示其他狀態或補充字元，不能把此表視為完整清單。[來源：proc_pid_stat(5)](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html)、[procps-ng ps 狀態碼](https://gitlab.com/procps-ng/procps/-/raw/master/man/ps.1)

| 狀態 | 意思 | 如何理解 |
|---|---|---|
| `R` | Running 或 runnable | 正在執行，或已可執行、等候 CPU；不是每個 `R` 都同時占著 CPU |
| `S` | Interruptible sleep | 可中斷的等待；例如 `sleep` 等待時間到，通常是正常狀態 |
| `D` | Uninterruptible sleep | 不可中斷的等待，通常涉及 I/O；單憑字母無法確定是哪個裝置或原因 |
| `T` | Stopped | 被停止訊號暫停；現代 Linux 的追蹤停止可另以小寫 `t` 表示 |
| `Z` | Zombie | 已結束，但父程序尚未回收其結束資訊 |

多執行緒程序有進一步的邊界：procps-ng 也可能把主執行緒已退出、其他執行緒仍執行的程序顯示為 `Z`，這時要一起看執行緒資訊，不能僅由一列判定整個程序已無執行活動。下段先說明一般已結束子程序的殭屍情況。[來源：procps-ng ps 狀態碼](https://gitlab.com/procps-ng/procps/-/raw/master/man/ps.1)

### 殭屍不是仍在執行的程式

`Z` 程序已經結束，保留的是讓父程序取得退出狀態等資訊的紀錄，不是在背景繼續計算。繼續送 `KILL` 無法讓一個已結束的程序「再結束一次」。正常處理在父程序的等待與回收邏輯；父程序若結束，子程序會由適當的收養者接管並回收，不一定直接由 PID 1 接管，因為 Linux 也有 child subreaper。短暫出現的殭屍與長期大量累積應分開判斷，不要為清除畫面任意終止父程序。[來源：wait(2) NOTES](https://man7.org/linux/man-pages/man2/wait.2.html)

### 為什麼 KILL 不一定立即消除 D 狀態

「不能忽略 `SIGKILL`」不表示核心必須在任何等待點立刻完成終止。核心的純 `TASK_UNINTERRUPTIBLE` 等待不因一般送訊號而醒來；需要等待條件解除，才能繼續走到處理終止的時機。核心也有 `TASK_KILLABLE` 等可被致命訊號喚醒的等待方式，因此不能從畫面上一個 `D` 推論它永遠無法終止。[來源：Linux 核心 Driver Basics 的 wait_event、wait_event_interruptible 與 wait_event_killable](https://docs.kernel.org/driver-api/basics.html)、[signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html)

遇到長時間 `D`，應回查儲存、掛載或其他 I/O 等待的原因，以及對應日誌；重複送 `KILL` 不會修復底層等待。這是依核心等待機制得出的排查方向，不是「看到 D 就判定硬碟故障」。進一步觀察方式見[效能觀察](performance-observation.md)與[服務與日誌](services-and-logs.md)。

## 常見混淆

- **`jobs` 沒列出，不代表程序不存在。** 它只顯示目前 Shell 管理的工作；系統程序觀察要用適當的程序工具。
- **`&` 不會把程序安裝成服務。** Shell 工作與服務管理器的生命週期是不同層次，登出行為也要另行考慮。
- **暫停不等於結束。** `T` 程序仍存在；`CONT` 讓它繼續，`fg` 則另外處理終端前景歸屬。
- **PID 不能長期保存後盲目使用。** 先核對對象，這篇只操作自己剛啟動的單一 `sleep`，不靠程序名稱搜尋後批次終止。

前兩項來自 [Bash 工作控制與 Signals](https://tiswww.case.edu/php/chet/bash/bashref.html#Job-Control)；後兩項分別見 [signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html)與 [kill(2)](https://man7.org/linux/man-pages/man2/kill.2.html)。

## 相關文件與來源

- [Linux 知識索引](README.md)：從日常操作延伸至系統管理。
- [終端與 Shell](terminal-and-shell.md)：Shell、命令與結束狀態。
- [使用者與權限](users-and-permissions.md)：操作程序時的身分與權限。
- [服務與日誌](services-and-logs.md)：由服務管理器控制的生命週期與排查入口。
- [效能觀察](performance-observation.md)：CPU、記憶體與 I/O 的進一步觀察。
- [核心與系統呼叫](kernel-and-system-calls.md)：使用者空間如何請求核心服務。
- [命名空間、cgroups 與容器隔離基礎](namespaces-cgroups-and-containers.md)：PID 命名空間如何隔離程序視角，以及 cgroup 如何限制資源與程序數。

一手來源均於 **2026-11-02** 查閱：Linux man-pages 提供程序、執行緒與訊號的介面定義；GNU Bash 5.3 手冊由維護者 Chet Ramey 網站提供；procps-ng 官方儲存庫手冊說明 Linux `ps`／`top`，其主分支內容不代表每個發行版已安裝相同版本；Linux 核心文件用於核對不同等待機制。本文沒有啟動 Linux、安裝工具或以 macOS 外部工具結果替代 Linux 驗證。
