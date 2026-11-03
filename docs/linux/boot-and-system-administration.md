# 開機流程與系統管理

電腦通電後，誰把核心放進記憶體？核心還沒讀到磁碟裡的程式時，又怎麼找到根檔案系統？
**開機是一段交接：韌體找到可啟動的內容，載入器交出核心，早期環境準備根檔案系統，最後由 init 系統建立可使用的服務環境。**
知道目前走到哪一層，比把所有「開不了機」都歸給同一個設定更有幫助。
整體分工可參考 [systemd：bootup](https://www.freedesktop.org/software/systemd/man/latest/bootup.html)。

本文先備知識是[認識 Linux](what-is-linux.md)、[軟體與套件](software-and-packages.md)與[服務與日誌](services-and-logs.md)。
開機部分以一般電腦與伺服器的概念說明；管理命令限定已有 **systemd 系統管理器**的 Linux，不是安裝、修復開機載入器或升級發行版的操作教學。

查證日期：2026-11-02。systemd 依當日官方 `latest` 手冊（頁首 **systemd 262**）；GNU GRUB 手冊為 **2.16**，GNU Coreutils 手冊為 **9.12**。
核心文件採當日 `latest`，實際流程仍受硬體架構、核心組態、發行版與映像設計影響；查本機工具時應以本機版本和手冊為準。
**驗證範圍：**僅查閱官方文件並在 macOS／Darwin、Bash 5.3.9 檢查 Bash 區塊語法與連結格式；沒有 Linux 執行環境，以下命令皆未實測，也沒有實測輸出。
本文只展示只讀查詢；變更設定、更新、切換模式與重開機僅作文字說明。

## 從通電到可登入，交接了哪些工作

下圖是常見路徑的概念整理，**不是每台 Linux 都必經的固定順序**：

```text
BIOS／UEFI 等韌體：初始化必要硬體，選擇啟動項目
          │
          ▼
開機載入器，例如 GRUB：載入核心、參數及可選的 initramfs
          │
          ▼
Linux 核心：初始化核心子系統與裝置支援
          │
          ├─ 有早期使用者空間：解開 initramfs，執行 /init
          │                    └─ 找到、準備並掛載主要根檔案系統
          │
          └─ 可直接使用根裝置：核心掛載根檔案系統
                               │
                               ▼
根檔案系統中的 init／系統管理器，維持 PID 1 的角色
                               │
                               ▼
掛載、系統服務、登入介面與應用程式等使用者空間
```

流程依據 [bootup：開機元件](https://www.freedesktop.org/software/systemd/man/latest/bootup.html#Description)、
[核心：initramfs 與 init](https://www.kernel.org/doc/html/latest/filesystems/ramfs-rootfs-initramfs.html#what-is-initramfs)及
[核心：EFI boot stub](https://www.kernel.org/doc/html/latest/admin-guide/efi-stub.html)。
UEFI 也可能略過獨立載入器，直接載入具 EFI stub 的核心。
圖中的箭頭代表責任交接，不表示後面的服務全部串行啟動。

### 韌體與開機載入器

**韌體（firmware）**先做必要硬體初始化，再依啟動設定把控制權交給後續程式。
在 PC 世界，傳統 BIOS 與 UEFI 是不同的啟動介面；不要把「韌體」等同於 Linux 核心。
BIOS 平台上的 GRUB 有涉及 MBR 或 BIOS Boot Partition 的配置；UEFI 則可載入 EFI 執行檔，相關內容位於 EFI System Partition（ESP）。
因此，「開機一定是 BIOS 讀 MBR」不能套到所有電腦；BIOS 與 MBR/GPT 分割表也不是同一種分類。
參考 [GNU GRUB：BIOS installation](https://www.gnu.org/software/grub/manual/grub/html_node/BIOS-installation.html)與
[Linux 核心：EFI boot stub 與 ESP](https://www.kernel.org/doc/html/latest/admin-guide/efi-stub.html)。

**開機載入器（boot loader）**負責載入核心並交出控制權。GRUB 能依設定提供選單，選擇核心或其他作業系統；
它讀取核心的位置與格式，不代表它之後也負責管理網站服務。
參考 [GNU GRUB：Overview](https://www.gnu.org/software/grub/manual/grub/html_node/Overview.html)。
GRUB 也不是必備元件：具適當 EFI stub 支援的 Linux 核心可由 EFI 韌體直接載入，見 [核心 EFI boot stub 文件](https://www.kernel.org/doc/html/latest/admin-guide/efi-stub.html)。

### 核心與 initramfs：先準備能找到根目錄的環境

核心取得控制權後，建立自己的執行環境；但存放主要系統程式的裝置可能還需要驅動模組或其他準備。
**initramfs（initial RAM filesystem）**提供早期使用者空間：核心將 CPIO 封存內容解開到記憶體中的根環境，若有 `/init`，便以 PID 1 執行它。
這個程式再負責找到、準備並掛載主要根檔案系統，接續後面的系統初始化。
參考 [核心：What is initramfs?](https://www.kernel.org/doc/html/latest/filesystems/ramfs-rootfs-initramfs.html#what-is-initramfs)。

例如根檔案系統位於需要額外準備的儲存配置時，早期環境可以先準備裝置再交接；
systemd 的 initrd 流程也有裝置、加密與根掛載等相依階段，見 [bootup：Bootup in the initrd](https://www.freedesktop.org/software/systemd/man/latest/bootup.html#Bootup%20in%20the%20initrd)。
不是「核心還沒啟動，initramfs 先啟動核心」；實際上是核心解開並執行其中的早期程式。

initramfs **不必永遠是獨立的外部檔案，也不表示每個系統都必須經過一套有內容的早期使用者空間**。
內容可內建於核心，也可外部提供；若沒有早期 `/init`，且核心具備存取根裝置所需支援，就可走直接掛載根檔案系統並執行 init 的路徑。
見 [核心：Populating initramfs 與 External initramfs images](https://www.kernel.org/doc/html/latest/filesystems/ramfs-rootfs-initramfs.html)。

**initrd** 原本是以 RAM block device 承載檔案系統映像的機制，與 initramfs 的 CPIO 解開機制不同；
但工具、檔名與日常用語仍可能沿用 initrd 一詞指稱早期映像，不能只靠名稱判斷格式。
參考 [核心：Using the initial RAM disk](https://www.kernel.org/doc/html/latest/admin-guide/initrd.html)與
[bootup：initrd 名稱的沿用](https://www.freedesktop.org/software/systemd/man/latest/bootup.html#Description)。

### 根檔案系統與 PID 1

**根檔案系統（root filesystem）**提供 `/` 這個目錄樹起點，後續可在樹中掛載其他檔案系統；
它與存放 EFI 程式的 ESP、存放核心映像的 `/boot` 並不是同一個概念，實際配置可分開。
根掛載的概念見 [systemd.special：根掛載 `-.mount`](https://www.freedesktop.org/software/systemd/man/latest/systemd.special.html)，
目錄與掛載的關係另見[儲存、掛載與檔案系統](storage-and-filesystems.md)。

PID 是程序識別碼；在一般主機開機的敘述中，**PID 1** 是第一個使用者空間程序的角色。
若先執行 initramfs 的 `/init`，它可在切換根環境後以 `exec` 接續另一個 init 程式；這不必是「早期 PID 1 結束，再建立另一個 PID 1」。
相關交接見 [核心：initramfs 的 init 行為](https://www.kernel.org/doc/html/latest/filesystems/ramfs-rootfs-initramfs.html#what-is-initramfs)。

當 systemd 作為 PID 1 執行時，它是啟動與維持使用者空間服務的系統管理器；systemd 本身仍是使用者空間程式，並不是核心。
參考 [systemd：Description](https://www.freedesktop.org/software/systemd/man/latest/systemd.html#Description)。
**並非所有 Linux 都用 systemd**，例如 Alpine 官方文件介紹的服務管理是 OpenRC，不能直接套用下一節的命令，見 [Alpine User Handbook 0.1a：OpenRC](https://docs.alpinelinux.org/user-handbook/0.1a/Working/openrc.html)。

## systemd 用相依關係組織開機

systemd 管理的 **unit** 不只有服務，還包含 mount、socket、timer、target 等。
**target** 用來群組 units、建立同步點，並非一個負責逐行執行所有服務的 Shell 腳本。
參考 [systemd.target](https://www.freedesktop.org/software/systemd/man/latest/systemd.target.html)。

一般開機會啟動 `default.target` 拉入的相依單位；它通常是 `multi-user.target` 或 `graphical.target` 的別名。
前者代表非圖形的多使用者系統環境，後者再納入圖形登入需要的服務。
多個不受先後條件約束的工作可並行，因此不要把 target 名稱想成所有 Linux 共用的固定「第 1 關、第 2 關」。
參考 [bootup：System Manager Bootup](https://www.freedesktop.org/software/systemd/man/latest/bootup.html#System%20Manager%20Bootup)及
[systemd.special：特殊 targets](https://www.freedesktop.org/software/systemd/man/latest/systemd.special.html)。

相依關係要分成兩個問題：

| 問題 | 設定例子 | 意義 |
| --- | --- | --- |
| 啟動此 unit 時，還要拉入誰？ | `Wants=` | 較弱的需求關係；被拉入者失敗，通常不阻止本 unit 啟動 |
| 啟動此 unit 時，必須考慮哪些較強需求？ | `Requires=` | 較強需求；配合對同一 unit 的 `After=`，前者啟動失敗會阻止本 unit 啟動 |
| 兩者都有啟動工作時，誰先？ | `After=`、`Before=` | 排序關係，本身不會把對方拉入啟動 |

因此 `After=database.service` 不等於「自動啟動資料庫」；只有 `Requires=database.service` 也不會自動建立先後順序。
`Requires=` 仍有條件檢查與自行結束等細節，不能把它當作「對方任何時候消失，本服務都必然停止」的健康保證。
以上語意見 [systemd.unit：Wants、Requires、Before 與 After](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#%5BUnit%5D%20Section%20Options)。
服務內部是否真的準備好接受工作，還取決於服務類型與應用行為，另見[服務與日誌](services-and-logs.md)。

## 先用只讀入口確認正在管理哪個系統

下列範例是**可分別閱讀的查詢**，不是要在 macOS 上執行的指令組。
第一組假設 Linux 環境提供 GNU `uname`、procps-ng `uptime` 與 `os-release`；精簡映像可能缺少工具：

```bash
uname -r
cat /etc/os-release
uptime
```

- `uname -r` 顯示**正在執行的核心 release**；不是發行版名稱，也不能單靠它確認套件是否已更新。參考 [GNU Coreutils：uname](https://www.gnu.org/software/coreutils/manual/html_node/uname-invocation.html)。
- `os-release` 是供應者提供的作業系統識別資料。若 `/etc/os-release` 不存在，再查 `/usr/lib/os-release`；不要混合兩份資料。參考 [os-release](https://www.freedesktop.org/software/systemd/man/latest/os-release.html)。
- `uptime` 顯示系統已運作多久等資訊；正常顯示時間不代表所有服務都正常。此處採 procps-ng 的語意，見 [procps-ng uptime(1) 上游手冊](https://man7.org/linux/man-pages/man1/uptime.1.html)。

在 systemd **系統管理器**環境，再看預設目標與目前狀態；未使用 `--user`：

```bash
systemctl --version
systemctl get-default
systemctl list-units --type=target --all --no-pager
systemctl list-units --type=service --no-pager
systemctl --failed --no-pager
```

`get-default` 回答預設開機目標，並不列出「現在唯一模式」；多個 target 可以同時 active。
`list-units` 查管理器目前記憶體中的 units，預設顯示 active、有工作或 failed 的項目；`--all` 納入已載入但 inactive 的項目，仍不是所有已安裝 unit 檔案的清單。
`--failed` 列出失敗 units，適合當問題入口；沒有 failed 也不是應用功能全部正常的證明。
選項語意見 [systemctl](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)。

若工具已安裝，且主機採 EFI 啟動，可額外展示以下查詢；**不要求安裝 systemd-boot**：

```bash
bootctl status --no-pager
```

`status` 自 systemd 239 提供，可查 EFI 韌體、目前載入器與相關啟動資訊，適用範圍不限於 systemd-boot；
但可取得內容仍受韌體、權限與啟動方式影響，不能在傳統 BIOS 或容器裡期待相同結果。
`bootctl` 也有安裝、更新與移除載入器的能力，本文只用查詢子命令，見 [bootctl：Generic EFI Firmware/Boot Loader Commands](https://www.freedesktop.org/software/systemd/man/latest/bootctl.html#Generic%20EFI%20Firmware/Boot%20Loader%20Commands)。

## 用「哪次開機、哪一層失敗」縮小問題

在已能執行 journalctl 的 systemd 環境，可以先看現有開機紀錄，再指定範圍：

```bash
journalctl --list-boots --no-pager
journalctl -b --no-pager
journalctl -b -k --no-pager
journalctl -b -1 --no-pager
```

`-b` 未帶引數時選本次開機；`-k` 篩選核心訊息；`-b -1` 指前一次開機。
這些選項查的是可讀 journal，不是重播韌體或載入器的完整畫面。
參考 [journalctl：Filtering Options](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html#Filtering%20Options)。

**上次開機不一定有日誌可查。**能否跨開機查詢，取決於 journald 是否持久保存日誌，以及輪替、容量、保留期限和讀取權限。
因此空結果不能證明上次沒有錯誤，`--list-boots` 也不是完整開機歷史。保存模式的詳細差異見[服務與日誌](services-and-logs.md)。
參考 [journald.conf：Storage 與限制](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html#Storage=)及
[journalctl：存取權限](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html#Description)。

下面是依責任邊界整理的診斷方式，不是由症狀直接斷定故障原因：

| 已觀察到的現象 | 先確認的邊界 | 可留下的證據 |
| --- | --- | --- |
| 韌體找不到啟動項目，尚無核心訊息 | 韌體、裝置、啟動項目與載入器 | 主控台原始錯誤、最近的磁碟或韌體變更 |
| 載入器有出現，核心卻未開始或很早停止 | 核心映像、啟動參數、相容性 | 選到的核心、完整錯誤位置與文字 |
| 出現找不到根裝置或早期 shell | 核心驅動、initramfs、根裝置及儲存配置 | 裝置識別、早期錯誤、最近核心或儲存變更 |
| 已到 systemd，但掛載或服務失敗 | unit 相依、掛載、應用設定與權限 | failed 清單、相關 unit 的狀態與同次開機日誌 |
| 可以登入，某項服務不可用 | 服務與應用功能 | 服務時間線及實際功能的失敗證據 |

這張表是本文依各階段責任做的診斷整理；Debian 的復原文件也分別討論 initramfs 無法掛載根目錄與 systemd 階段失敗，見
[Debian 13 發行說明：Prepare for recovery](https://www.debian.org/releases/trixie/release-notes/upgrading.en.html#prepare-for-recovery)。
核心還沒啟動時，通常不能期待進系統後的查詢幫你直接取得那一段錯誤；需要先有主控台或其他可用的觀察入口。
針對單一 failed unit 的 `status`、`show` 與 `journalctl -u` 用法，接續[服務與日誌](services-and-logs.md)。

## 正常、rescue 與 emergency 是不同目的的環境

這些名稱描述 systemd 的啟動目標，不是所有 Linux 的通用模式名稱：

| 情境 | 概念 |
| --- | --- |
| 正常開機 | 進入機器設定的日常目標，例如多使用者或圖形環境；沒有一個通用的 `normal.target` 必須使用 |
| `rescue.target` | 帶起基本系統與系統掛載，提供救援 shell，服務範圍比日常環境小 |
| `emergency.target` | 更小的緊急 shell 環境，本身不拉入其他服務或掛載 |

emergency 並不保證根目錄一定唯讀：取決於如何到達此狀態，可能已經是讀寫掛載。
也不能假設這些環境有網路、遠端登入或平常所有工具。
語意見 [systemd.special：rescue.target 與 emergency.target](https://www.freedesktop.org/software/systemd/man/latest/systemd.special.html)。

切換 target 可能停止目前使用的服務或登入路徑，修改載入器與核心參數又會影響下次啟動；本文不提供切換或修改命令。
若已無法啟動到本機 init，可能需要發行版提供的外部救援環境；那與已安裝系統內的 `rescue.target` 不同。
例如 Debian 安裝媒體的 rescue mode 可提供修復環境，見 [Debian 安裝手冊：Recovering a Broken System](https://www.debian.org/releases/trixie/amd64/ch08s06.en.html)。

## 系統管理是維持狀態與復原能力

能開機只是一個起點。以下是系統管理責任的整理，不是要求現在執行的變更清單：

- **掌握設定與服務的關係。**知道設定由誰提供、哪些是本機修改，以及變更後需要應用重新載入、服務重啟或其他動作。對 systemd unit 的本機覆寫，應理解 drop-in 與供應者檔案的優先序；見 [systemd.unit：Unit File Load Path 與 drop-in](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)。
- **更新時審閱影響。**套件更新可能停止並重新啟動服務；核心映像已安裝也不表示正在執行的核心已替換。一般重新開機會走過新的核心選擇，但何時需要服務重啟或整機重啟，應依發行版公告與更新內容判斷。套件機制見[軟體與套件](software-and-packages.md)；Debian 跨版升級的服務中斷與核心重啟要求見 [Debian 13：Preparing for the upgrade](https://www.debian.org/releases/trixie/release-notes/upgrading.en.html#preparing-for-the-upgrade)，不能把跨版流程直接當作每次小更新的規則。
- **保留可復原的資料。**備份要涵蓋不可失去的資料與設定；應用資料的一致性和還原方式需依該應用處理，不能只確認「有個備份檔」。Debian 升級前備份原則見 [Back up any data or configuration information](https://www.debian.org/releases/trixie/release-notes/upgrading.en.html#back-up-any-data-or-configuration-information)；儲存層責任見[儲存、掛載與檔案系統](storage-and-filesystems.md)。
- **把重開機視為有服務影響的變更。**先掌握使用者、工作、維護時間、主控台與失敗後的恢復入口。正常關機由管理器停止服務並卸載檔案系統等，再關閉或重新啟動；不是單純把電源切掉。關機分工見 [bootup：Description](https://www.freedesktop.org/software/systemd/man/latest/bootup.html#Description)，遠端升級復原準備見 [Debian：Prepare for recovery](https://www.debian.org/releases/trixie/release-notes/upgrading.en.html#prepare-for-recovery)。

完成維護後，仍要重新確認核心或套件版本、failed units、當次開機日誌及應用功能。
這是由前述管理邊界推得的驗收方式：套件成功、管理器狀態與使用者實際可用性各回答不同問題，不能互相代替。

## 相關文件

- [Linux 知識索引](README.md)：依主題查找。
- [認識 Linux](what-is-linux.md)：核心、發行版與使用者空間。
- [程序](processes-and-jobs.md)：PID、程序與訊號。
- [軟體與套件](software-and-packages.md)：安裝與更新的管理邊界。
- [服務與日誌](services-and-logs.md)：單一服務狀態與時間線。
- [儲存、掛載與檔案系統](storage-and-filesystems.md)：根目錄、裝置與資料保護。
