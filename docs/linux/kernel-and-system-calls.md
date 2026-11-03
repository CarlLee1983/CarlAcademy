# Linux 核心與系統呼叫

程式要讀檔案，不是直接命令硬碟搬資料；它通常先呼叫函式庫，再由系統呼叫要求核心提供服務。**系統呼叫（system call）是應用程式與 Linux 核心之間的基本介面**，但程式碼裡的一次函式呼叫，不一定對應一次系統呼叫。[來源：syscalls(2)](https://man7.org/linux/man-pages/man2/syscalls.2.html)

本文從[認識 Linux](what-is-linux.md)的核心與使用者空間出發，銜接[程序](processes-and-jobs.md)與[檔案與目錄](files-and-directories.md)。不要求會寫 C；函式名稱用於說明介面，不提供待補完的 C 程式。

查證日期：**2026-11-02**。範圍為 Linux 使用者空間介面、GNU C Library（glibc）與 Linux `strace`；其他 C 函式庫、CPU 架構與發行版可能有差異。本文僅查閱一手文件，並在 Darwin 主機以 Bash 5.3.9 做 Bash 區塊語法檢查；**未安裝、編譯或執行 Linux，也未實測 strace**。下方追蹤是自訂的假想示意，不能當作任何系統的實測紀錄。

## 使用者模式與核心模式：執行權限的邊界

使用者空間包含 Shell、編輯器、函式庫及許多背景服務；核心負責提供受管理的系統能力。一般程式在使用者模式（user mode）執行；需要系統呼叫時，包裝函式準備參數，透過架構規定的入口切換至核心模式（kernel mode），由核心處理後返回。這不是把整個應用程式搬進核心。[來源：intro(2)](https://man7.org/linux/man-pages/man2/intro.2.html)

```text
使用者模式：應用程式 → 函式庫包裝 → 準備呼叫編號與參數
                                      │ 系統呼叫入口
                                      ▼
核心模式：                     核心處理要求
                                      │ 回傳結果
                                      ▼
使用者模式：應用程式 ← 函式庫處理回傳值與錯誤
```

這是概念流程。不同架構使用的指令、暫存器與錯誤回報方式不同；進入核心不代表一定換另一個程序執行，也不能從一次呼叫推論發生了程序排程切換。[來源：syscall(2) 的架構呼叫慣例](https://man7.org/linux/man-pages/man2/syscall.2.html)

核心模式也不是「root 模式」。root 是程序的身分與權限問題，系統呼叫入口則是執行邊界；例如 `open()` 仍可能因存取權限不足而失敗，不能因為要求已送到核心就預期必定成功。[來源：open(2) 的 EACCES](https://man7.org/linux/man-pages/man2/open.2.html)

系統呼叫是重要入口，卻不是所有核心與使用者空間互動的完整清單。核心的 user-space API 指南還涵蓋 `ioctl`、Netlink、共享緩衝區等介面；這些介面可經由系統呼叫建立或操作，但不能只靠背呼叫名稱理解所有通訊協定。[來源：Linux kernel user-space API guide](https://docs.kernel.org/userspace-api/index.html)

## 函式庫 API 不等於核心系統呼叫

應用程式通常使用 C 函式庫的包裝函式（wrapper），而不是直接寫架構專用指令。包裝函式可能處理引數、選擇核心入口，並把核心錯誤轉成呼叫端使用的形式。手冊第 2 節雖稱 System Calls，主要說明通常以 C 函式庫介面為中心，差異再列於 NOTES。[來源：intro(2)](https://man7.org/linux/man-pages/man2/intro.2.html)

幾種情況要分開看：

| 程式所做的事 | 可能的核心互動 | 閱讀時要注意什麼 |
| --- | --- | --- |
| 純使用者空間運算 | 不需要因這個運算而進入系統呼叫 | 不能把每個函式呼叫都視為核心工作 |
| 呼叫 `open()` | 包裝函式可能使用 `openat` | API 名稱與追蹤名稱不一定一致 |
| 呼叫 `printf()` 等串流函式 | 先處理格式與緩衝，之後才傳給低階 I/O | 多次輸出函式可能合成較少次寫入 |
| 呼叫可使用 vDSO 的取時函式 | 可能在使用者空間完成 | 沒看到系統呼叫不表示函式沒有執行 |

`open()` 的例子是具體的版本差異：glibc 自 2.26 起使用 `openat` 系統呼叫實現 `open()`，某些架構更早已如此。[來源：open(2)，C library/kernel differences](https://man7.org/linux/man-pages/man2/open.2.html)

glibc 的 **stream** 以 `FILE *` 表示，建立在較低階的 fd 介面之上；fd 則以整數表示。`printf()` 的格式化與串流緩衝屬於這一層，不能把 `FILE *`、fd 與檔案路徑混用。[來源：glibc Streams and File Descriptors](https://sourceware.org/glibc/manual/latest/html_node/Streams-and-File-Descriptors.html)

緩衝方式包含無緩衝、行緩衝與全緩衝。互動裝置上的串流通常採行緩衝，其他新開串流通常是全緩衝；因此輸出接到終端或被重新導向時，出現的時機可能不同。換行不保證讓所有類型串流都立即寫出。[來源：glibc Buffering Concepts](https://sourceware.org/glibc/manual/latest/html_node/Buffering-Concepts.html)

**vDSO（virtual dynamic shared object）**是核心映射到使用者程序位址空間的小型共享函式庫。某些架構與取時操作可由 C 函式庫使用 vDSO 讀取核心提供的資訊，避免每次走完整系統呼叫；能使用哪些功能取決於架構與可用介面。這種在使用者空間完成的呼叫不會出現在一般 strace 系統呼叫追蹤中。[來源：vdso(7)](https://man7.org/linux/man-pages/man7/vdso.7.html)

## ABI 決定二進位如何提出要求

API 說明程式可以怎麼使用能力；**ABI（Application Binary Interface，應用程式二進位介面）**進一步規定編譯後的程式如何交接資料。Linux 系統呼叫 ABI 涉及入口指令、呼叫編號、引數暫存器與回傳方式；32 位元與 64 位元的資料傳遞也可能不同。相同呼叫名稱不能保證在不同架構具有相同編號。[來源：syscall(2)](https://man7.org/linux/man-pages/man2/syscall.2.html)

`syscall()` 本身也是函式庫函式，可用編號要求特定系統呼叫，常見於沒有對應包裝函式的情況。應使用標頭提供的 `SYS_*` 名稱；即使用符號名稱，呼叫端仍可能需要處理架構特有的參數配置，不能假設直接呼叫比現成 wrapper 更可攜。[來源：syscall(2)](https://man7.org/linux/man-pages/man2/syscall.2.html)

核心文件預期系統呼叫這類穩定介面長期維持相容，卻不把核心內部符號當作同等穩定承諾。這解釋了為何應用程式應依公開介面寫程式，不能依賴某版核心內部函式的實作位置。[來源：Linux ABI description](https://docs.kernel.org/admin-guide/abi.html)

相容也有方向與環境條件：新系統呼叫不保證存在於舊核心，手冊列有加入版本及架構差異；要求未實現的編號可能得到 `ENOSYS`。穩定 ABI 並不表示任意 CPU 架構的二進位都能直接執行，也不表示新的應用程式永遠能在舊環境使用所有功能。[來源：syscalls(2)](https://man7.org/linux/man-pages/man2/syscalls.2.html)、[syscall(2)](https://man7.org/linux/man-pages/man2/syscall.2.html)

## 從路徑取得 fd，再讀寫資料

**檔案描述符（file descriptor，fd）**是程序自己的檔案描述符表中的非負整數索引。路徑用於找到對象，`open()` 成功後的 fd 用於後續操作；fd 不是路徑的縮寫，也不是系統全域的檔案編號。不同程序的 `3` 可能指向完全不同的對象。[來源：open(2)](https://man7.org/linux/man-pages/man2/open.2.html)

以讀取既有普通檔案、把內容送到已開啟的輸出端為例，概念流程如下，**不是可執行程式**：

```text
open(來源路徑, 唯讀) → 取得來源 fd；失敗則停止並報錯
反覆 read(來源 fd, 緩衝區, 容量)
  有資料：依實際讀到的數量 write 到輸出 fd，處理尚未寫完的部分
  到達結尾：結束讀取
  發生錯誤：依錯誤與已完成進度處理
close(來源 fd) → 檢查結果並收尾
```

fd 會參照核心的 **open file description**，其中有目前檔案位置與狀態旗標；路徑之後被移除或改指別的檔案，不會讓既有參照自動改指新對象。對可定位的檔案，讀寫會依實際搬移位元組數推進位置。[來源：open(2)](https://man7.org/linux/man-pages/man2/open.2.html)、[read(2)](https://man7.org/linux/man-pages/man2/read.2.html)、[write(2)](https://man7.org/linux/man-pages/man2/write.2.html)

fd 不只表示普通檔案，也能代表終端、pipe 或 socket。一般約定 `0`、`1`、`2` 分別為標準輸入、標準輸出、標準錯誤；它們可被重新導向，因此不能從 fd `1` 就推論目標必定是螢幕。[來源：glibc Streams and File Descriptors](https://sourceware.org/glibc/manual/latest/html_node/Streams-and-File-Descriptors.html)、[stdin(3) 的標準描述符說明](https://man7.org/linux/man-pages/man3/stdin.3.html)

`close()` 解除這個 fd 的參照，使數字可被重用；不是刪除路徑，也不是同步儲存的替代品。`write()` 成功不保證資料已持久保存；有此需求時須依對象與保證使用 `fsync()` 等介面，新增目錄項目的持久性還可能需要同步父目錄。[來源：close(2)](https://man7.org/linux/man-pages/man2/close.2.html)、[fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html)

## 回傳值、errno 與部分完成

以本文的 `open()`、`read()`、`write()`、`close()` C 介面而言，失敗通常回傳 `-1`，並以 `errno` 表達原因。核心原始回報的表示法與 C wrapper 不應混為一談；某些架構用負錯誤碼，某些另有暫存器或旗標。[來源：intro(2)](https://man7.org/linux/man-pages/man2/intro.2.html)、[syscalls(2)](https://man7.org/linux/man-pages/man2/syscalls.2.html)

先看回傳值是否表示失敗，再看 `errno`。成功不會保證把舊錯誤清成零，其他呼叫也可能改變它；若稍後需要記錄，應在失敗時立即保存。`errno` 是執行緒局部的狀態，不是所有執行緒共用的「最後錯誤」。錯誤要用 `ENOENT` 等符號理解，不要背固定數字。這個慣例也不是所有函式的通則，個別介面可能有不同的錯誤契約。[來源：errno(3)](https://man7.org/linux/man-pages/man3/errno.3.html)

### read 的容量是上限

對非零長度的一般位元組讀取，`read(fd, buf, count)` 最多讀 `count` bytes；回傳正數是實際讀取量，可以少於要求。普通檔案到結尾回傳 `0`；pipe 等對象也有自己的結尾條件。**短讀不是自動等於結尾或錯誤**；回傳 `0` 的解讀還要排除要求長度本身為零等情況。[來源：read(2)](https://man7.org/linux/man-pages/man2/read.2.html)

### write 成功也可能只寫一部分

假設準備寫出 100 bytes，`write()` 回傳 40，表示本次完成 40，不能丟掉剩下 60，也不能從頭再送全部 100。若應用需要完整傳送，下一次應從尚未完成的位置開始；後續仍可能失敗。這是處理位元組流的概念，不能拿來宣稱多次寫入對其他程序具有整體原子性。[來源：write(2)](https://man7.org/linux/man-pages/man2/write.2.html)

### EINTR 不等於所有操作原樣再做一次

`read()` 的 `EINTR` 指讀到資料之前被訊號中斷；Linux `write()` 若在任何資料寫入前中斷可回 `EINTR`，若已有資料則回傳已寫量。應先處理正數進度；只有回傳值表示失敗時，才依 `errno` 判斷。[來源：read(2)](https://man7.org/linux/man-pages/man2/read.2.html)、[write(2)](https://man7.org/linux/man-pages/man2/write.2.html)

訊號處理設定及介面種類會影響呼叫是否自動重啟，`SA_RESTART` 也不適用所有呼叫。對可重試的讀寫，仍需尊重取消、截止時間及應用協定，不能無限忽略訊號。非阻塞 I/O 的 `EAGAIN`／`EWOULDBLOCK` 通常表示現在會等待；應配合就緒通知等設計，原地高速重試只會浪費資源。[來源：signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html)、[read(2)](https://man7.org/linux/man-pages/man2/read.2.html)

**不要把這套重試套到 Linux `close()`。**Linux 在回報較晚發生的錯誤之前，已先釋放有效的 fd；錯誤後重試同一個數字，可能關掉另一執行緒剛取得的新 fd。應保留錯誤供診斷，依資料需求補救，而非盲目再關一次；跨作業系統的 `EINTR` 行為也不可直接由此推廣。[來源：close(2)，CAVEATS](https://man7.org/linux/man-pages/man2/close.2.html)

## 用 strace 看邊界上的要求

`strace` 是 Linux 的系統呼叫追蹤工具，可記錄呼叫、引數、回傳值及訊號；通常利用 `ptrace` 機制運作。它適合回答「程式在開哪個路徑？核心回了什麼？」這類邊界問題。[來源：strace 官方介紹](https://strace.io/)

### 先練習讀一份假想追蹤

下列是為了說明而自訂的 **假想節錄，並非實測，也不是下節命令的預測輸出**。假設有個簡單程式開啟內含 `hello` 加換行的 `note.txt`，以 4096 bytes 緩衝區讀取並寫至標準輸出；省略載入器與其他呼叫：

```text
openat(AT_FDCWD, "note.txt", O_RDONLY) = 3
read(3, "hello\n", 4096)              = 6
write(1, "hello\n", 6)                = 6
read(3, "", 4096)                     = 0
close(3)                              = 0
```

依序讀：先取得 fd `3`；第一次要求最多 4096 bytes，只讀到 6；將這 6 bytes 送到 fd `1`；再次讀取才得到結尾的 `0`；最後關閉來源。`AT_FDCWD` 表示相對路徑以目前工作目錄為基準。`3` 是假設結果，不保證每次相同。[介面定義：open(2)](https://man7.org/linux/man-pages/man2/open.2.html)、[read(2)](https://man7.org/linux/man-pages/man2/read.2.html)、[write(2)](https://man7.org/linux/man-pages/man2/write.2.html)

若出現以下**另一種假想結果**，開檔並沒有成功，不能繼續假設拿到 fd：

```text
openat(AT_FDCWD, "missing-note.txt", O_RDONLY) = -1 ENOENT (No such file or directory)
```

`ENOENT` 可能是最後檔案不存在，也可能是某個目錄元件不存在或遇到懸空符號連結；不是看到文字就只檢查最末檔名。strace 會將錯誤解碼成符號與說明。[來源：open(2)](https://man7.org/linux/man-pages/man2/open.2.html)、[strace(1)](https://man7.org/linux/man-pages/man1/strace.1.html)

### 可在已有工具的 Linux 上啟動自己的短程命令

以下適用於已具備 `strace` 與 `cat`、且政策允許追蹤的 Linux。只讓 strace 啟動自己的 `cat /dev/null`；不附加既有程序，不需 `sudo`。本文未執行這些命令，若工具不存在或政策拒絕，先停止此示範，不以提高權限或變更系統設定繞過。

```bash
strace -e trace=openat,read,write,close cat /dev/null
```

`/dev/null` 不提供一般檔案內容，所以這個命令用於看開啟與結尾讀取，不承諾會出現資料寫入。動態載入器也可能先開啟函式庫與設定，不能把所有 `openat` 都當成 cat 的目標檔案；篩選也不會顯示其他種類呼叫。[來源：strace 官方 cat /dev/null 範例](https://strace.io/)

要對照每次呼叫的經過時間，可另跑：

```bash
strace -T -e trace=openat,read,write,close cat /dev/null
```

或用摘要觀察同一類短程命令：

```bash
strace -c cat /dev/null
```

`-T` 是呼叫開始到結束的經過時間，會包括等待；`-c` 預設統計核心 CPU 時間、次數與錯誤，並不是整個程式的牆鐘時間。不能把兩種數字混加或直接當成磁碟延遲。[來源：strace(1)，Timing 與 Statistics](https://man7.org/linux/man-pages/man1/strace.1.html)

### 看見的內容與看不見的成本

追蹤權限受程序身分、dumpable 狀態、capabilities 及 Linux Security Modules 等檢查限制；Yama 也可限制 ptrace 關係。是同一位使用者或知道 PID，都不代表一定能追蹤。[來源：ptrace(2)，Ptrace access mode checking 與 Yama](https://man7.org/linux/man-pages/man2/ptrace.2.html)

追蹤會改變被觀察程式的執行時序並增加成本；strace 的計時摘要也含量測開銷估計，不能當作完全沒有干擾的效能基準。純使用者空間計算與 vDSO 快速路徑又可能不出現在系統呼叫清單；要分析整體 CPU、記憶體與 I/O，須結合[效能觀察](performance-observation.md)。[來源：ptrace(2)](https://man7.org/linux/man-pages/man2/ptrace.2.html)、[strace(1)](https://man7.org/linux/man-pages/man1/strace.1.html)、[vdso(7)](https://man7.org/linux/man-pages/man7/vdso.7.html)

追蹤也可能顯示檔案路徑、引數及讀寫內容；輸出的字串截斷不等於匿名化。實務紀錄應限制對象與時間，分享前檢查敏感資料。本例直接顯示在終端，沒有寫追蹤檔；若改用 `-o` 保存，就多了一份需要妥善處理的資料。[來源：strace(1)，輸出格式與 -o／-s](https://man7.org/linux/man-pages/man1/strace.1.html)

## 把系統呼叫當作介面契約閱讀

`read()` 的「最多讀取」、`write()` 的「可能部分完成」、`close()` 的「錯誤後不可盲目重試」都說明：知道名稱與參數仍不夠，還要理解成功、失敗、狀態變化與重試條件。這與[介面、契約與責任](../api/interface-contract-responsibility.md)討論的是同一種閱讀方式，只是邊界換成了應用程式與核心。

寫程式時，依特定介面的契約處理結果；排查時，依追蹤縮小正在失敗的邊界。一次觀察到的呼叫順序能幫忙找問題，卻不自動成為所有函式庫、版本與架構的共同保證。

## 相關文件與查證範圍

- [Linux 知識索引](README.md)：回到完整主題入口。
- [認識 Linux](what-is-linux.md)：核心、使用者空間與發行版的分工。
- [程序](processes-and-jobs.md)：執行狀態、執行緒與訊號。
- [檔案與目錄](files-and-directories.md)：路徑、連結及檔案操作。
- [效能觀察](performance-observation.md)：把核心呼叫放回整體工作負載分析。
- [介面、契約與責任](../api/interface-contract-responsibility.md)：跨語言的 API 共通知識。

本文逐項查閱 Linux man-pages、Linux 核心 user-space API／ABI 文件、glibc 手冊與 strace 專案資料。man-pages 中 `strace(1)` 的來源為 strace 專案；glibc 手冊使用其 Sourceware 官方站版本。這些網站會更新，並不保證讀者安裝的版本具備相同功能。已驗證 Bash 區塊語法與站內連結存在性；尚未驗證 Linux 上的實際輸出、追蹤權限、呼叫選擇與執行時間。
