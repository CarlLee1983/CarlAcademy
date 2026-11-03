# 服務與日誌

網站程式能從終端啟動，為什麼還需要「服務管理」？因為系統不只要執行程式，還要知道如何啟動、停止、判斷失敗，以及把事件留下來供人查閱。**服務狀態回答現在發生什麼，日誌協助追查事情如何走到這一步。**

本文先備知識是[程序](processes-and-jobs.md)與基本 Shell 操作。以 systemd 的系統服務為主，不涵蓋所有 Linux 服務管理工具；例如 Alpine Linux 採用 OpenRC，使用 `rc-service` 等工具，不能直接套用本文命令。參考 [Alpine User Handbook 0.1a：OpenRC](https://docs.alpinelinux.org/user-handbook/0.1a/Working/openrc.html)。

查證日期：2026-11-02。systemd 部分依當日官方 `latest` 手冊，頁首標示 **systemd 262**；rsyslog 依 **8 daily stable** 文件。這些網址會更新，實際機器請以 `systemctl --version`、本機手冊及發行版設定為準。本文的 `academy.service` 是**假想的教材服務**，沒有要求讀者建立它；不存在時，查詢可能顯示找不到 unit，日誌可能沒有紀錄。

**驗證範圍：**本文完成官方文件查證，並在 macOS／Darwin、Bash 5.3.9 做 Bash 區塊的 `bash -n` 語法檢查與連結格式檢查；未在 Linux 或 systemd 環境實測。以下是命令與判讀示例，沒有實測輸出；沒有啟停、安裝或設定主機服務。

## 服務與程序是不同層次

程序（process）是程式的一次執行；服務（service）則是系統管理某項工作的單位。網站服務可能有一個主程序與多個工作程序；重新啟動後 PID 會改變，服務名稱仍可相同。systemd 以 `.service` unit 描述並監督程序，設定可以包含啟動命令、服務類型與停止方式。參考 [systemd.service：Description](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#Description)。

服務也不一定永遠有程序常駐。`Type=oneshot` 可以執行一次工作後結束；搭配 `RemainAfterExit=yes` 時，工作成功結束後仍能被視為 active。因此不能只看「active」便斷言一定有背景程序。參考 [systemd.service：Type 與 RemainAfterExit](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#Type=)。

systemd 管理的 **unit** 不只有服務：`.socket` 描述 socket，`.timer` 描述計時啟動，`.mount` 描述掛載，`.target` 用來組織相關單位。`.service` 是其中一種 unit，不是 systemd 所有能力的總稱。unit 檔案使用分節設定，例如共通的 `[Unit]`、服務專用的 `[Service]` 與啟用關係使用的 `[Install]`。參考 [systemd.unit：Description](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#Description)。

本文命令預設查詢**系統管理器**。`systemctl --user` 操作的是目前使用者的管理器，不是「不用 sudo 操作同一個系統服務」；名稱相同也可能是不同的 unit。相關選項見 [systemctl：--user](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html#--user)。

## 先讀狀態，再決定是否改變狀態

以下皆為**只讀查詢**，適用於已有 systemd 系統管理器的 Linux。可先確認版本，再用假想服務理解查詢形式：

```bash
systemctl --version
systemctl status academy.service --no-pager --full
systemctl show academy.service \
  --property=LoadState,ActiveState,SubState,MainPID,Result,ExecMainStatus
systemctl is-active academy.service
systemctl is-enabled academy.service
```

`status` 適合人閱讀；`show` 以屬性呈現細節，較適合程式處理。閱讀 `status` 時，先找以下兩行：

| 欄位 | 問題 | 判讀重點 |
| --- | --- | --- |
| `Loaded` | unit 定義有沒有載入？ | `not-found` 先查名稱與安裝情況；`bad-setting` 先查 unit 設定 |
| `Active` | 現在處於什麼狀態？ | 分清 `active`、`inactive`、`failed` 與轉換中的狀態，再看括號中的細節 |

`is-active` 查詢目前活動狀態；單一 unit 為 active 時回傳成功，否則回傳非零。非零是查詢結果的一部分，不必然是命令壞掉。`status` 只附有限的近期日誌，完整時間線要再查 journal。以上命令與欄位見 [systemctl：Unit Commands](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html#Unit%20Commands%20%28Introspection%20and%20Modification%29)。

### active 與 enabled 回答不同問題

- **active**：unit 現在的執行期狀態。
- **enabled**：已建立 unit 的啟用連結，讓它納入指定 target 等啟動關係，常見用途是隨開機啟動。

所以服務可以是「enabled 但 failed」，也可以是「disabled 但 active」。啟用不會單憑這個設定立即啟動；停用也不會單憑這個設定立即停止。`static` 表示 unit 沒有可供一般 enable 使用的安裝設定，不代表不能透過相依關係啟動。`disabled` 也不禁止手動或其他方式啟動。參考 [systemctl：Unit File Commands](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html#Unit%20File%20Commands)與 [systemd.unit：Install Section](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#%5BInstall%5D%20Section%20Options)。

### 改狀態命令：此處僅說明，不執行

下面不是依序照做的操作清單，而是**會改變系統狀態的命令對照**。操作真正服務前，要先知道其使用者、相依服務、維護時段與回復方式；系統服務的變更也需要相應管理權限。

| 假想命令 | 意義 |
| --- | --- |
| `systemctl start academy.service` | 要求啟動 |
| `systemctl stop academy.service` | 要求停止，會中斷該服務的工作 |
| `systemctl restart academy.service` | 停止再啟動；原本未執行也會嘗試啟動 |
| `systemctl reload academy.service` | 要求服務重新載入自己的設定，必須有支援的重新載入機制 |
| `systemctl enable academy.service` | 建立啟用關係，本身不等於立即啟動 |
| `systemctl disable academy.service` | 移除啟用關係，本身不等於立即停止 |

`reload` 不保證零中斷，其效果仍由服務實作決定。`daemon-reload` 則是讓 **systemd 重新讀取 unit 定義**，不等同應用程式重新載入設定，也不會替你重新啟動應用。不要為了讓設定「一定生效」就混用這些命令。參考 [systemctl：reload、restart 與 daemon-reload](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html#reload%20PATTERN%E2%80%A6)及 [systemd.service：ExecReload](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#ExecReload=)。

## 用 journalctl 把時間線縮到問題範圍

`systemd-journald` 收集並儲存結構化日誌，可接收核心、syslog 與服務的標準輸出、標準錯誤等來源；`journalctl` 是讀取 journal 的工具。應用也可能把日誌寫到自己的檔案或其他目的地，不能假設所有訊息一定都在 journal。參考 [systemd-journald：Description 與 Stream logging](https://www.freedesktop.org/software/systemd/man/latest/systemd-journald.service.html)。

以下是**只讀查詢**，每行可以分別理解：

```bash
# 該服務的日誌；加上本次開機範圍
journalctl -u academy.service -b --no-pager

# 指定起始時間；沒有指定時區時依本機時間解讀
journalctl -u academy.service --since '2026-11-02 09:00:00' --no-pager

# 限定本次開機，最近 30 分鐘的紀錄
journalctl -u academy.service -b --since '-30 min' --no-pager

# 持續顯示新增紀錄；按 Ctrl-C 結束觀察
journalctl -u academy.service -f

# 先列出仍有日誌可查的開機紀錄，再查上一次
journalctl --list-boots --no-pager
journalctl -u academy.service -b -1 --no-pager
```

`-u` 依 unit 篩選，包含相關管理器訊息；`-b` 未帶參數時選目前開機，`-b -1` 選前一次。`--since` 限定起始時間，`-f` 持續追蹤。組合條件會縮小範圍；沒有結果時，先確認服務名、開機與時間條件。參考 [journalctl：Filtering Options](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html#Filtering%20Options)、[--follow](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html#-f)及 [systemd.time：時間與時區語法](https://www.freedesktop.org/software/systemd/man/latest/systemd.time.html)。

### 看不到紀錄，不等於沒有事件

`journalctl` 只能顯示呼叫者有權讀取的日誌。系統 journal 通常由 root 及特定群組成員讀取；`systemd-journal`、`adm`、`wheel` 的實際配置和其他權限依發行版而異。讀不到時應確認授權，不能把空結果當作「服務沒有錯」。參考 [journalctl：Description](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html#Description)。

能不能跨開機查閱，又是另一件事。journald 的 `Storage=` 決定儲存方式：

| 模式 | 行為 |
| --- | --- |
| `volatile` | 存在 `/run/log/journal`，不能期待重開機後保留 |
| `persistent` | 優先存到 `/var/log/journal`，早期開機或無法寫磁碟時可能先用 `/run` |
| `auto` | 依 `/var/log/journal` 是否存在決定採持久或暫存方式 |
| `none` | 不儲存 journal，但仍可能轉送訊息 |

不要假定所有發行版的預設相同。即使是持久日誌，仍受容量、保留時間及輪替清理設定影響；「持久」不表示永久保存。`--list-boots` 顯示的是現有可讀紀錄，不是這台機器完整的開機歷史。參考 [journald.conf：Storage 與容量限制](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html#Storage=)。本文不變更日誌保存設定。

### journal 與文字日誌可以並存

rsyslog 是另一套日誌處理工具。它的 `imjournal` 模組能讀取 systemd journal，`omfile` 能依設定將訊息寫成檔案，所以同一筆事件可能出現在不同日誌目的地。是否安裝 rsyslog、採用哪個輸入、寫到哪個路徑，都要看本機設定；不能保證每台 Linux 都有同樣的 `/var/log/syslog` 或 `/var/log/messages`。參考 [rsyslog：imjournal](https://docs.rsyslog.com/doc/configuration/modules/imjournal.html)與 [omfile](https://docs.rsyslog.com/doc/configuration/modules/omfile.html)。

## 排障先找失敗邊界

假設教材服務啟動失敗，建議依這個順序保留證據、縮小問題：

1. **確認查的是哪個服務與管理器。**先看 `LoadState`；找不到 unit 時，查套件、名稱或 `--user` 的邊界，而不是反覆 start。
2. **確認失敗時間與結果。**看 `status`、`Result`、`ExecMainStatus`，再用同一時間範圍查 journal。將「找不到執行檔」「設定解析失敗」「權限不足」等訊息當作下一步線索，不把所有非零結果都視為同一原因。
3. **讀實際 unit 與相依關係。**查執行檔、服務身分、工作目錄及設定來源，對照應用文件；確認是不是某個前置條件失敗。
4. **針對原因處理後再決定 reload 或 restart。**若應用提供設定檢查命令，先依該應用的官方文件驗證；沒有跨所有服務通用的設定檢查命令。處理後重新查狀態與新日誌，並以應用本身的功能確認恢復。

第三步的**只讀查詢**形式如下；輸出可能包含內部路徑或設定值，分享前應檢查是否含敏感資訊：

```bash
systemctl cat academy.service --no-pager
systemctl list-dependencies academy.service --all --no-pager
systemctl show academy.service \
  --property=Requires,Wants,After,FragmentPath,DropInPaths
```

`cat` 可查看 unit 檔及 drop-in；`list-dependencies` 查看管理器目前載入的相依資訊，不是所有應用外部依賴的完整清單。`After=` 只描述先後順序，不會單獨把另一個 unit 拉起來；`Wants=`、`Requires=` 才是另一類需求關係。參考 [systemctl：cat 與 list-dependencies](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html#cat%20PATTERN%E2%80%A6)與 [systemd.unit：相依與順序](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#%5BUnit%5D%20Section%20Options)。

若看到啟動頻率限制，先追查最早失敗的原因。`reset-failed` 可清掉失敗狀態與相關計數，但不會修好錯誤設定；反覆清除再 restart 只可能讓同一問題重演。參考 [systemd.unit：StartLimitIntervalSec 與 StartLimitBurst](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#StartLimitIntervalSec=)。

另外，active 只表示管理器認定的狀態，不保證網站能成功處理請求、資料庫連得上或資料正確。服務類型決定 systemd 何時視為啟動完成；應用功能仍需在自己的邊界確認。參考 [systemd.service：Type](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#Type=)。

## 相關文件

- [Linux 知識索引](README.md)：依主題查找文件。
- [程序](processes-and-jobs.md)：程序、訊號與背景工作。
- [軟體與套件](software-and-packages.md)：理解服務檔案與執行檔的安裝來源。
- [開機流程與系統管理](boot-and-system-administration.md)：把服務的啟動關係放回開機流程。
- [效能觀察](performance-observation.md)：服務仍 active、回應卻變慢時的觀察方向。
