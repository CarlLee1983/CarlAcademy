# CPU、記憶體、I/O 與效能觀察

「機器很慢」是症狀，還不是原因。CPU 使用率高可能是正常完成大量工作；CPU 使用率低，也可能是工作全部卡在等待。效能觀察的目的，是把**哪種工作、何時變慢、等待哪個資源**連起來，再決定下一步要查什麼。

先備知識是[程序](processes-and-jobs.md)與[服務與日誌](services-and-logs.md)。本文以 Linux 核心介面、procps-ng 的 `top`／`free`／`vmstat`、sysstat 的 `iostat` 為範圍；`findmnt` 來自 util-linux，`df` 以 GNU Coreutils 為準。發行版未必預裝所有工具，選項、欄位、核心功能與可讀權限也依版本及環境而異；遇到缺少工具，先保留現有資料，不必為了閱讀本文安裝工具。

查證日期：**2026-11-02**。已讀下列一手文件；procps-ng 與 sysstat 使用官方儲存庫當日主分支手冊，核心文件使用官方線上版本，這些網址會持續更新，不代表本機已安裝同版。**本章只在 macOS／Darwin、Bash 5.3.9 檢查 Bash 語法與文件連結，未在 Linux 實測。**所有數字均為明確標示的示意資料，命令是觀察示例；沒有壓測、安裝工具、調整核心參數、清除快取或終止程序。

## 先定義問題，才選指標

開始前，先寫下這五件事：

| 問題 | 例子與用途 |
| --- | --- |
| 工作負載是什麼？ | API 請求、影片轉檔、資料庫查詢，或夜間備份；不同工作對延遲與吞吐的需求不同 |
| 變慢表現在哪裡？ | 平常每秒完成 200 件工作，現在 80 件；或請求 p95 延遲由 100 ms 增到 900 ms |
| 時間範圍？ | 09:10–09:20，附時區；持續、週期性，還是只有一次尖峰 |
| 正常基線？ | 同一服務、相近請求量與資料量下的正常時段；別拿空閒主機與忙碌主機直接相比 |
| 觀察的範圍？ | 整台主機、虛擬機、容器、某個服務或程序；資源配額與可見資訊可能不同 |

表中的數字只是如何描述問題的例子，並非實測。**延遲（latency）**是一件工作花多久，**吞吐（throughput）**是單位時間完成多少工作，錯誤率則回答完成得是否正確。主機指標必須與這些工作結果一起看，否則只能知道資源忙不忙，無法知道使用者是否受影響。

也要分開以下概念：

- **利用率（utilization）**：某段時間有多少資源被使用；必須先問分母是什麼，例如一顆邏輯 CPU、所有 CPU 的平均，或裝置有 I/O 活動的時間。
- **飽和（saturation）**：需求超過當下可提供的處理能力，開始排隊或被限制；高利用率是線索，還需要等待、佇列或服務結果佐證。
- **等待（waiting）**：工作暫時不能前進；可能等 CPU、記憶體回收、儲存、網路、鎖或遠端服務，不能全部歸到磁碟。

這是一種判讀框架，不是一組適用所有系統的固定警戒值。下面的工具各自量測不同範圍；核心特別提供 PSI，量化資源不足造成工作停滯的時間，可補足單看使用量的不足。[來源：Linux 核心 PSI 說明](https://docs.kernel.org/accounting/psi.html)

## 先取得短時間概況

以下是在 Linux 上分別執行的唯讀查詢，不是已在本機執行的採樣腳本：

```bash
date -Is
uname -r
uptime
top -V
free -V
vmstat -V

free -h
vmstat -t 1 6
top
```

`date -Is` 留下含時區的時間，`uname -r` 留下核心版本。`uptime` 提供開機時間與 load average；`free -h` 是記憶體快照；`vmstat -t 1 6` 以一秒間隔列出六份報告並附時間；`top` 持續更新。在 `top` 按 `q` 離開，只結束觀察畫面。請不要在這裡使用其送訊號或調整優先權功能。[來源：GNU Coreutils date](https://www.gnu.org/software/coreutils/manual/html_node/Options-for-date.html)、[procps-ng uptime](https://gitlab.com/procps-ng/procps/-/raw/master/man/uptime.1)、[vmstat](https://gitlab.com/procps-ng/procps/-/raw/master/man/vmstat.8)、[top](https://gitlab.com/procps-ng/procps/-/raw/master/man/top.1)

六秒左右的觀察只能看當下，不能還原十分鐘前的事故；一秒平均也可能掩蓋更短的尖峰。若系統已經有監控與歷史資料，先回查問題時段、相同採樣粒度及基線；現在沒有採樣，不能靠現在的低負載斷言之前也沒問題。

## CPU：忙的是哪些 CPU、哪些工作？

### 整體 CPU 百分比與程序百分比不同

`top` 的 CPU 摘要通常會列出使用者態 `us`、核心態 `sy`、空閒 `id`、I/O wait `wa`、虛擬化環境的 steal `st` 等時間比例。摘要可顯示所有 CPU 的整體情況，也可在互動模式按 `1` 展開各邏輯 CPU。這裡的 CPU 是排程可見的邏輯 CPU，不應直接等同實體插槽或實體核心。[來源：procps-ng top 的 CPU States 與 CPU summary commands](https://gitlab.com/procps-ng/procps/-/raw/master/man/top.1)

程序列的 `%CPU` 則有顯示模式差異：在 Irix 模式，一個多執行緒程序可以超過 100%；切到 Solaris 模式後，數值會除以 CPU 數。`I` 可切換這兩種模式，`H` 可切換執行緒顯示。閱讀截圖或抄錄數字前，先確認模式與是否包含折疊的子程序。[來源：procps-ng top 的 %CPU、Irix/Solaris 與 Threads mode](https://gitlab.com/procps-ng/procps/-/raw/master/man/top.1)

**示意推理，非實測：**一台有 8 個邏輯 CPU 的主機，一個執行緒持續占滿其中一個 CPU，其餘空閒，整體忙碌比例約為 12.5%。若該服務只能在這個執行緒依序處理請求，服務仍可能排隊。下一步是展開各 CPU、看該程序的執行緒與服務延遲；不能因整體不到 20% 就排除 CPU 路徑，也不能由這組數字直接認定應用一定單執行緒。

`wa` 也不是「CPU 正在替硬碟做運算的比例」。核心文件指出，I/O wait 在多 CPU、工作遷移等情況下不容易可靠歸屬，底層計數甚至可能下降。它可作為回查 I/O 的提示，不能單憑 `wa` 高判定某顆磁碟壞掉，也不能因 `wa` 低就排除 I/O 延遲。`st` 上升則提示虛擬 CPU 有非自願等待，需連同虛擬化平台觀察。[來源：Linux 核心 /proc/stat 的 CPU 時間欄位與限制](https://docs.kernel.org/filesystems/proc.html)、[sysstat iostat 的 CPU Utilization Report](https://raw.githubusercontent.com/sysstat/sysstat/master/man/iostat.in)

### Load average 不是 CPU 使用率

Linux 的 load average 是約 1、5、15 分鐘的負載平均，涵蓋可執行的 `R` 工作以及不可中斷等待的 `D` 工作；後者常見於 I/O 等待。它不是百分比，也不只計算正在使用 CPU 的工作。[來源：Linux man-pages proc_loadavg(5)](https://man7.org/linux/man-pages/man5/proc_loadavg.5.html)

可以唯讀查看原始介面：

```bash
cat /proc/loadavg
```

**示意資料，非實測：**

```text
6.20 4.10 2.00 3/420 24680
```

前三個數字是三種時間尺度；`3/420` 分別是目前 runnable 與現存的核心排程實體數量，包含程序／執行緒；最後是最近建立程序的 PID。這不是「6.20% CPU」，也不能把第四欄的瞬間值當作前面平均的明細。[來源：proc_loadavg(5)](https://man7.org/linux/man-pages/man5/proc_loadavg.5.html)

把 load 與 CPU 數比較，只在釐清 **CPU 執行需求**時提供粗略線索：如果主要都是 runnable 工作、可用 CPU 範圍一致，持續高於可用邏輯 CPU 數會支持排隊假設。若有許多 `D`、CPU affinity、cgroup 配額或不同效能的 CPU，這個比較就不夠。1 分鐘平均高於 15 分鐘平均，可以提示近期負載變重，但不直接告訴原因，也不是精準的事故起始時間。[定義依據：proc_loadavg(5)](https://man7.org/linux/man-pages/man5/proc_loadavg.5.html)；資源限制見下方 cgroup 節。

### vmstat 把 CPU、等待與記憶體放在同一段時間

`vmstat 1 6` 的**第一份速率／CPU 報告是自開機以來的平均，後續才是各一秒間隔**；但程序與記憶體欄位即使第一份也是瞬間值。不要把第一列當作剛剛那一秒。支援 `-y` 的版本可省略第一份自開機報告。[來源：procps-ng vmstat 的 Description 與 -y](https://gitlab.com/procps-ng/procps/-/raw/master/man/vmstat.8)

| 欄位 | 觀察重點 |
| --- | --- |
| `r` | 正在執行或等待 CPU 的 runnable 工作數；與可用 CPU、每核心負載一起看 |
| `b` | 等待 I/O 完成而阻塞的工作數；需再定位原因 |
| `si`／`so` | 每秒換入／換出的記憶體量；不同於已使用的 swap 總量 |
| `bi`／`bo` | 區塊裝置的輸入／輸出速率；不是應用請求數 |
| `us`／`sy`／`id`／`wa`／`st` | 使用者態、核心態、空閒、I/O wait 與 steal 的 CPU 時間比例 |
| `cs` | 每秒 context switch 次數；需看工作量與基線，不能只因數字大就認定異常 |

欄位依據 [procps-ng vmstat](https://gitlab.com/procps-ng/procps/-/raw/master/man/vmstat.8)。本文查閱的手冊把 `bi`／`bo` 定義為 KiB/s，舊版或其他實作的標示可能不同；`-S` 會影響記憶體與 swap 的單位，不會同步改變 `bi`／`bo`。保留本機欄位標題、版本與單位，不要只貼一列沒有表頭的數字。

**示意判讀，非實測：**若可用 4 個邏輯 CPU，後續多個採樣的 `r` 都在 10–12、`id` 接近 0、`b` 很低，且 CPU PSI 與服務延遲同時增加，便支持「有工作等 CPU」的假設。下一步定位哪些程序／執行緒在消耗 CPU，再核對配額與工作量；這仍未證明程式哪一段演算法需要優化。

## 記憶體：可用空間、回收與 swap 要一起看

### free 少，不等於記憶體吃光

Linux 會把記憶體用作檔案頁面快取與核心資料結構。`free -h` 的 `free` 是未使用的記憶體，`available` 則估計不用 swap 就能供新應用使用的空間，考慮了可回收的部分；`buff/cache` 不是整包都能立即無成本釋放。`shared` 主要對應 tmpfs 等共享使用，不能把各欄全部相加當作互斥分割。[來源：procps-ng free](https://gitlab.com/procps-ng/procps/-/raw/master/man/free.1)

本文查閱的 procps-ng 手冊把 `used` 定義為 `total - available`；較舊工具可能採不同計算方式。因此看到 `used` 很高，先核對版本與 `available`，不能直接解讀成「所有 RAM 都被應用鎖住」。`available` 也是估計，不保證下一次任意大小的配置都會成功。[來源：procps-ng free](https://gitlab.com/procps-ng/procps/-/raw/master/man/free.1)、[Linux 核心 /proc/meminfo](https://docs.kernel.org/filesystems/proc.html)

**示意摘要，非實測，也不是 free 的逐欄輸出：**

```text
MemTotal       16 GiB
MemFree         1 GiB
MemAvailable    7 GiB
Swap used     512 MiB
```

這組數字不足以支持「RAM 用完」：尚有估計可用空間，且 swap 有占用不表示當下正大量換頁。下一步看 `available` 趨勢、後續 `vmstat` 的 `si`／`so`、memory PSI，以及延遲是否同步變差。反過來，若 `available` 長時間低、持續換入換出且 memory PSI 增加，才更支持記憶體壓力影響工作進度的假設。[欄位定義：free](https://gitlab.com/procps-ng/procps/-/raw/master/man/free.1)、[vmstat](https://gitlab.com/procps-ng/procps/-/raw/master/man/vmstat.8)、[PSI](https://docs.kernel.org/accounting/psi.html)

### 程序大小與 OOM 不是同一個問題

`top` 的 `VIRT` 是虛擬位址空間，不能當作實體 RAM 用量；`RES` 是目前常駐的部分，其中也可能有共享頁。把所有程序的 RES 直接相加可能重複計入共享內容，也不能當作主機記憶體的完整帳本。[來源：procps-ng top 的 Linux Memory Types、VIRT、RES](https://gitlab.com/procps-ng/procps/-/raw/master/man/top.1)

**OOM（out of memory）**要區分系統與受限制群組的邊界。cgroup v2 的 `memory.max` 限制該群組記憶體；到達限制且無法回收時，可在群組內觸發 OOM。`memory.high` 則是讓工作受到節流與回收壓力的界線，超過它本身不會觸發 OOM kill。主機仍有記憶體，不代表容器還能配置更多；同樣地，程序收到配置失敗，也不保證一定已發生 OOM kill。[來源：Linux 核心 cgroup v2 Memory Interface Files](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)

遇到程序消失，應保留相同時間的核心日誌、服務退出狀態與容器平台事件；**單憑退出碼 137 或一張低記憶體截圖，不能證明是 OOM**。訊號及退出狀態的背景見[程序](processes-and-jobs.md)，日誌查詢見下方排查流程。

## 容器與 cgroup：先確認數字的範圍

cgroup 是把工作組織成階層並控制資源的核心機制。以 cgroup v2 為例，觀察對象除了程序，還有群組與祖先的限制；不能用主機總資源取代服務可用的配額。[來源：Linux 核心 cgroup v2 Introduction](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)

以下只查詢**目前 Bash 所屬群組**，不是自動找到任意應用：

```bash
cat "/proc/$$/cgroup"
findmnt -t cgroup2 -o TARGET,FSTYPE
```

`$$` 是這個 Bash 的 PID。v2 記錄常呈現 `0::/群組路徑`；需把看到的群組路徑、實際 cgroup2 掛載點與命名空間對齊。容器內路徑可能以自己的根呈現，別把容器中的相對範圍直接拼成宿主機路徑。若要查服務，先由服務管理器或容器平台確認其實際群組，不要用自己的 Shell 群組代替。[來源：Linux 核心 cgroup v2 的 /proc 與 namespace 說明](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)、[util-linux findmnt](https://man7.org/linux/man-pages/man8/findmnt.8.html)

在**已確認的 cgroup v2 目錄**，下列介面可唯讀檢視；不是每種核心、每個群組或每種 controller 都有全部檔案：

| 介面 | 問題 |
| --- | --- |
| `cpu.max` | CPU 時間配額及週期是多少？`max` 表示此層沒有該配額限制 |
| `cpu.stat` | CPU 使用累計量與節流計數是否在問題時段增加？需比對兩個時間點 |
| `memory.current`／`memory.max` | 這個群組與後代目前用量、此層硬限制各是多少？記憶體量以 bytes 表示 |
| `memory.events` | `high`、`max`、`oom`、`oom_kill` 等累計計數有沒有新增？預設包含後代事件，局部事件另見 `memory.events.local` |
| `cpu.pressure`／`memory.pressure`／`io.pressure` | 這個群組範圍內的工作是否發生資源停滯？ |

表中介面與階層限制依 [Linux 核心 cgroup v2 文件](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)。例如 `cpu.max` 為 `100000 100000`，表示每 100000 微秒週期可消耗 100000 微秒 CPU 時間，約為一個 CPU 的時間預算，並不是固定綁定某一顆 CPU；配額、CPU 綁定、祖先限制需分開理解。`cpu.stat` 的節流欄位也有排程類別及階層計帳差異，不能只看單層計數就排除祖先限制。

## I/O：容量、次數、資料量與延遲是不同維度

磁碟有剩餘空間，不代表能及時完成 I/O；磁碟空間滿了，也不需要先出現高 IOPS 才會讓寫入失敗。先把問題分開：

| 維度 | 回答的問題 | 常見觀察入口 |
| --- | --- | --- |
| 容量／inode | 還能配置多少檔案內容或檔案節點？ | `df -h`／`df -i` |
| IOPS | 每秒完成多少 I/O 請求？ | `iostat` 的 `r/s`、`w/s` 等 |
| 吞吐 | 每秒搬運多少資料？ | `rkB/s`、`wkB/s` 等，保留單位 |
| 延遲 | 一筆裝置 I/O 平均花多久？ | `r_await`、`w_await` 等 |
| 排隊／活動時間 | 有多少請求在裝置路徑上、持續活動多久？ | `aqu-sz`、`%util` 等 |

容量與 inode 定義見 [GNU Coreutils df](https://www.gnu.org/software/coreutils/manual/html_node/df-invocation.html)；裝置指標見 [sysstat iostat 手冊](https://raw.githubusercontent.com/sysstat/sysstat/master/man/iostat.in)。許多小型隨機 I/O 與少數大型循序 I/O，即使吞吐相同，請求數也可能差很多；比較時要記下讀寫比例、請求大小及並行程度。

### 先找資料所在的掛載，再找相關裝置

以下以已存在的 `/var/log` 為觀察路徑；實務應改成問題資料實際所在的路徑：

```bash
findmnt --target /var/log -o TARGET,SOURCE,FSTYPE
df -h /var/log
df -i /var/log
```

`findmnt` 找該路徑所在檔案系統，`df` 查空間或 inode。這比盲目查看 `/dev/sda` 更接近問題；資料可能在 LVM、RAID、網路檔案系統、容器 overlay 或 tmpfs，不一定對應一顆本機磁碟。掛載與裝置的關係見[儲存、掛載與檔案系統](storage-and-filesystems.md)。[來源：util-linux findmnt](https://man7.org/linux/man-pages/man8/findmnt.8.html)、[GNU Coreutils df](https://www.gnu.org/software/coreutils/manual/html_node/df-invocation.html)

### 用 iostat 觀察間隔資料

若機器已提供 sysstat：

```bash
iostat -V
iostat -x -y -t 1 5
```

`-x` 顯示延伸指標，`-y` 省略自開機以來的第一份報告，`-t` 附時間，`1 5` 指一秒間隔與有限次數。未加 `-y` 時，第一份是開機以來的統計，後面才是自前次報告起的區間，不能混用。欄位名稱隨版本與選項不同，舊版的 `avgqu-sz` 可對應後來的 `aqu-sz`。[來源：sysstat iostat 的 Description、Options 與 Device Utilization Report](https://raw.githubusercontent.com/sysstat/sysstat/master/man/iostat.in)

判讀時特別注意：

- **`await`／`r_await`／`w_await`** 是該裝置請求的平均耗時，包含排隊與處理，單位為毫秒；不是純硬體服務時間，也不是應用整個請求的延遲，更不是 p95 或 p99。
- **`%util`** 描述裝置有 I/O 活動的時間比例。對依序服務請求的裝置，接近 100% 可支持飽和判斷；對能並行處理的 SSD 或 RAID，它不能代表效能上限。因此「100% 就一定塞滿」「50% 就還能加一倍」都不成立。
- **`r/s`／`w/s`** 是合併之後完成的裝置請求速率，不是應用呼叫 `read`／`write` 的次數。多層裝置可能重複呈現同一批 I/O，不宜把分割區、device mapper 與底層磁碟全部相加。

前兩點依 [sysstat iostat 指標定義與限制](https://raw.githubusercontent.com/sysstat/sysstat/master/man/iostat.in)，最後一點的合併與裝置計帳範圍見 [Linux 核心 I/O statistics fields](https://docs.kernel.org/admin-guide/iostats.html)。快取命中與不同 I/O 路徑也讓系統呼叫和區塊請求不會一對一；要理解邊界可接續[核心與系統呼叫](kernel-and-system-calls.md)。

**示意資料，非實測；僅摘出比較欄位，不是完整 iostat 輸出：**

| 同一裝置與相近工作型態 | `r/s` | `r_await` | `aqu-sz` | `%util` |
| --- | --- | --- | --- | --- |
| 平常時段 | 200 | 2 ms | 0.4 | 25% |
| 變慢時段 | 200 | 40 ms | 8.0 | 95% |

若應用延遲與 I/O PSI 也在同時上升，這支持「這條 I/O 路徑有更多等待」，下一步檢查相關裝置、共享工作、核心錯誤與平台限制。它尚未證明硬碟故障，也不能僅由平均延遲推導所有請求都慢 40 ms。對網路檔案系統或遠端資料庫，還要看遠端與網路路徑；本機區塊裝置資料不足以代表完整等待。

## PSI：工作有多少時間因資源不足停住？

在核心支援並啟用 PSI、且對應介面可讀時，可查詢：

```bash
for academy_resource in cpu memory io; do
    academy_pressure="/proc/pressure/$academy_resource"
    if [ -r "$academy_pressure" ]; then
        printf '\n%s\n' "$academy_pressure"
        cat "$academy_pressure"
    else
        printf 'unavailable: %s\n' "$academy_pressure" >&2
    fi
done
unset academy_resource academy_pressure
```

檔案不存在或無權讀取，表示這個環境無法透過該介面取得資料，不能當作壓力為零。這段只讀取資料，不建立 PSI trigger。[來源：Linux 核心 PSI Pressure interface](https://docs.kernel.org/accounting/psi.html)

**memory PSI 的示意輸出，非實測：**

```text
some avg10=12.00 avg60=4.00 avg300=1.00 total=5000000
full avg10=3.00 avg60=1.00 avg300=0.20 total=1000000
```

`some` 是至少部分工作因該資源停滯的時間比例；`full` 是所有非 idle 工作同時停滯的時間比例。`avg10`、`avg60`、`avg300` 是約 10、60、300 秒的近期趨勢百分比，`total` 是累計停滯微秒數；它不是目前有多少百分比 RAM 被占用，也不是慢請求的比例。若需看特定區間，可比較相同範圍兩個時間點的 `total` 差值與經過時間。[來源：Linux 核心 PSI](https://docs.kernel.org/accounting/psi.html)

範例表示近期確有記憶體停滯，且短期比長期明顯，但不指認某個程序、也不證明已 OOM。**system-wide CPU 的 `full` 沒有定義，不能用其零值宣稱 CPU 完全沒有壓力**；核心為相容性可顯示零。`/proc/pressure/*` 是系統範圍，cgroup v2 的 `*.pressure` 則對應群組內工作；兩者不能當成同一服務的同一份數據。[來源：Linux 核心 PSI 的 CPU full 與 Cgroup2 interface](https://docs.kernel.org/accounting/psi.html)

## 把線索組成排查流程

1. **先確認服務結果與時段。**留下延遲、吞吐、錯誤率、流量、部署或排程變動的時間；確認時區。沒有使用者影響的高利用率，也許只是工作順利加速完成。
2. **取得同一範圍的概況。**看 `top`、`free`、後續 `vmstat` 及可用的 PSI，分出 CPU 排隊、記憶體回收、I/O 或其他等待的假設。主機、容器與服務群組分開記錄。
3. **挑能區分假設的下一個觀察。**CPU 假設看各 CPU 與執行緒、配額；記憶體假設看 available、換頁、群組事件；儲存假設先定位掛載，再看對應裝置與 I/O 延遲。不要一開始就收集所有東西。
4. **把指標與日誌對時。**看相同開機、相同時間的核心與服務事件；檢查是否有 OOM、I/O error、裝置 timeout／reset 或服務自己的錯誤。訊息要按上下文解讀，不能只找關鍵字就結案。
5. **回到工作本身。**如果資源沒有對應壓力，繼續查鎖、連線池、網路、遠端服務與應用內部時間；若後續另行授權變更，以同樣流量、時間窗口與功能結果確認改善，不只比較一個百分比。

systemd 系統可用以下唯讀查詢對齊最近時段；`academy.service` 是假想服務名，實務須替換成實際 unit：

```bash
journalctl -k -b --since '-10 min' --no-pager
journalctl -u academy.service -b --since '-10 min' --no-pager
```

`-k` 篩核心訊息，`-b` 限定開機，`-u` 限定服務；本文使用 `-10 min` 示範，實際事故應換成已確認的起訖時間。日誌存留、讀取權限與服務是否寫入 journal 都可能限制結果。不是 systemd 的系統應使用本機的日誌入口；空結果不能證明事件沒發生。[來源：systemd journalctl](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html)、[服務與日誌](services-and-logs.md)

例如「load 升高、CPU 仍有空閒、`b` 與 io PSI 增加、對應裝置延遲高於基線」可把調查縮到 I/O 等待，但如果資料掛載在 NFS，仍要追查網路與伺服器；「主機 available 很多、服務 memory.events 新增 oom_kill」則應查服務群組與限制，而不是急著增加整台主機 RAM。這些都是依前述定義組合的診斷假設，不是對任何主機的實測結論。

不要把「清快取後 free 變大」「重啟後 CPU 下降」當成找到了原因；它們改變了觀察條件，也可能抹掉線索。本文的觀察流程到定位與保留證據為止，調參、擴容、重啟與其他修復要另依實際原因決定。

## 相關文件與來源

- [Linux 知識索引](README.md)：其他基礎與深入主題。
- [程序](processes-and-jobs.md)：執行緒、R／D 等狀態、訊號與退出資訊。
- [服務與日誌](services-and-logs.md)：服務狀態、journal、權限與保存限制。
- [儲存、掛載與檔案系統](storage-and-filesystems.md)：容量、inode、裝置與掛載邊界。
- [網路基礎](networking-basics.md)：本機與遠端依賴之間的連線路徑。
- [Linux 核心與系統呼叫](kernel-and-system-calls.md)：應用如何請求核心服務，理解不同量測層次。

主要一手來源已在各項定義旁引用：Linux 核心的 `/proc`、PSI、cgroup v2 與 I/O 統計文件；procps-ng 官方工具手冊；sysstat 維護者的 `iostat` 手冊；以及 GNU、util-linux、systemd 的命令文件。**來源查證、Bash 語法通過與連結可用，均不等於已在 Linux 執行驗證。**實機驗證時應保留核心／工具版本、權限、主機或群組範圍、表頭、單位、時間與正常基線，再依本文流程判讀。
