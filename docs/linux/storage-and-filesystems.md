# 儲存、掛載與檔案系統

「磁碟還有空間，為什麼不能建立檔案？」與「新磁碟接上了，為什麼目錄沒有變大？」都需要先辨認問題落在哪一層：裝置提供儲存空間，檔案系統組織資料，掛載決定從哪個路徑存取，容量工具則各自回答不同問題。

本文適合已理解路徑、檔案與基本權限的讀者，可先讀[檔案與目錄](files-and-directories.md)與[使用者與權限](users-and-permissions.md)。這裡深入儲存層次與觀察方式，不重列基本目錄用途。

> 適用範圍與查證：2026-11-02，依 Linux man-pages、util-linux 與 e2fsprogs 上游手冊、Linux 核心文件、Btrfs 專案文件、GNU Coreutils 9.11 手冊與 RHEL 9 文件查證。線上手冊可能來自開發版本，不代表每個發行版已支援全部欄位或選項；實機應先查本機手冊與版本。範例假設 GNU/Linux、Bash、GNU Coreutils 與 util-linux；精簡映像、BusyBox、容器及 macOS 工具可能不同。本次環境是 Darwin（macOS）、Bash 5.3.9，沒有運行中的 Linux daemon，未安裝或啟動 Linux；所有 Bash 區塊僅做語法檢查，沒有 Linux 執行結果。文中輸出都是示意。

## 從裝置走到路徑：每層各有自己的工作

先看一種簡單配置，箭頭表示「上層使用下層提供的空間」，不是必須照做的建置流程：

```text
儲存裝置                 分割區              檔案系統           掛載後的入口
/dev/nvme0n1   ──→   /dev/nvme0n1p2   ──→   ext4   ──→   /srv/data
                     磁碟的一段範圍         組織檔案          目錄樹上的接點
```

**區塊裝置（block device）**是核心提供的區塊 I/O 介面，對應的不一定是單一實體硬碟，也可能是虛擬機的磁碟或其他儲存層產生的虛擬裝置。**分割區（partition）**將一個磁碟裝置劃成不同範圍；分割區本身不是檔案系統。**檔案系統（filesystem）**在可用空間上管理檔案、中繼資料及配置；**掛載點（mount point）**則是目錄樹上接入它的位置。裝置存在，不代表已建立檔案系統；已有檔案系統，也不代表已掛載。[util-linux：lsblk(8)](https://man7.org/linux/man-pages/man8/lsblk.8.html)、[mount(8)](https://man7.org/linux/man-pages/man8/mount.8.html)

LVM（Logical Volume Manager）可以放在中間，把一個或多個 **PV（physical volume）**組成 **VG（volume group）**，再從 VG 提供 **LV（logical volume）**。LV 是虛擬區塊裝置，可在上面建立檔案系統；它不是目錄，也不等於檔案系統。如此一來，檔案系統使用的容量可以來自多個底層裝置。[LVM 上游：lvm(8)](https://man7.org/linux/man-pages/man8/lvm.8.html)

```text
磁碟／分割區 → PV ─┐
                   ├→ VG → LV → 檔案系統 → 掛載點
磁碟／分割區 → PV ─┘
```

這張圖仍是簡化，不能當成一對一規則：

- 檔案系統可以直接建在整個區塊裝置上，不一定先有分割區；一個檔案系統也可能使用多個裝置，例如 Btrfs 的多裝置配置。[Btrfs：Introduction](https://btrfs.readthedocs.io/en/latest/Introduction.html)
- 同一個檔案系統可以有多個掛載入口；bind mount 可把已有的目錄樹接到另一個位置，不是在複製檔案。[util-linux：mount(8)](https://man7.org/linux/man-pages/man8/mount.8.html)
- Btrfs subvolume 是檔案系統內具有獨立目錄階層的子卷，可以另行掛載；它與 LVM 的區塊層 LV 不同。[Btrfs：Subvolumes](https://btrfs.readthedocs.io/en/latest/Subvolumes.html)
- NFS 等網路檔案系統，以及 tmpfs、proc、sysfs 等虛擬檔案系統，不要求一個對應的本機磁碟分割區。[util-linux：fstab(5)](https://man7.org/linux/man-pages/man5/fstab.5.html)

因此，「加大虛擬磁碟」「擴充分割區或 LV」「擴充檔案系統」是不同層的動作。某層容量增加，不代表所有上層已同步增加；實際擴充程序必須依該層工具及檔案系統的支援條件處理，不能靠重新掛載猜測結果。

## ext4、XFS、Btrfs：先認得角色

這些名稱表示磁碟上的格式與對應的檔案系統實作，不是不同的目錄名稱。以下只定位特性，不以一個功能推論誰一定較快或較安全。

| 類型 | 理解入口 | 官方來源 |
| --- | --- | --- |
| ext4 | 延續 ext 系列，使用 extent 等配置方式，常見配置包含 journal；管理工具來自 e2fsprogs | [核心：ext4](https://docs.kernel.org/admin-guide/ext4.html) |
| XFS | 使用 extent、B-tree 與 journaling，支援大型檔案及檔案系統 | [核心：XFS](https://docs.kernel.org/admin-guide/xfs.html) |
| Btrfs | 採 copy-on-write，提供子卷、快照、校驗和及多裝置等功能 | [Btrfs：Introduction](https://btrfs.readthedocs.io/en/latest/Introduction.html) |

journal 主要協助崩潰後恢復檔案系統的一致性。例如 ext4 預設 journaling 模式不等於把每份使用者資料都記錄成可還原的歷史版本，更不能救回誤刪的昨日檔案。[核心：ext4 Journal](https://docs.kernel.org/filesystems/ext4/journal.html)

選擇格式還涉及發行版支援、工作負載、工具版本、備份與修復能力。這些條件尚未確定時，不應只看這張表就格式化現有資料。

## 先觀察：裝置、掛載、容量分開看

以下是只讀查詢，不會建立檔案系統或變更掛載。查詢裝置資訊可能因 udev 資料不完整而缺欄位，部分環境需額外權限；`lsblk` 樹狀輸出是關係圖，不保證每個裝置只出現一次。[util-linux：lsblk(8)](https://man7.org/linux/man-pages/man8/lsblk.8.html)

```bash
lsblk -f
lsblk -o NAME,TYPE,SIZE,FSTYPE,UUID,MOUNTPOINTS
findmnt
findmnt --target . --output TARGET,SOURCE,FSTYPE,OPTIONS
df -h .
df -i .
```

| 觀察 | 回答的問題 | 判讀限制 |
| --- | --- | --- |
| `lsblk -f` | 哪些區塊裝置帶有檔案系統類型、UUID 與掛載資訊？ | 不會列出所有網路或虛擬檔案系統 |
| `lsblk -o ...` | 哪些是磁碟、分割區或 LVM 等裝置？各自多大？ | `SIZE` 是裝置容量，不是檔案系統可用空間 |
| `findmnt` | 目前有哪些掛載？來源、目標及選項是什麼？ | 通常反映目前程序所在的 mount namespace |
| `findmnt --target .` | 目前路徑實際落在哪個檔案系統？ | 該路徑不必剛好就是掛載點 |
| `df -h .` | 包含目前路徑的檔案系統，區塊容量用了多少？ | 不是目前目錄內檔案大小的總和；`-h` 使用 1024 次方單位 |
| `df -i .` | 該檔案系統回報多少 inode 已用、可用？ | inode 配置與回報語意依檔案系統而異 |

欄位與 `--target` 行為見 [findmnt(8)](https://man7.org/linux/man-pages/man8/findmnt.8.html)，容量與 inode 選項見 [GNU df(1)](https://man7.org/linux/man-pages/man1/df.1.html)。`lsblk`、`findmnt` 的預設欄位可能改變；給腳本解析時應明確選欄位，不能把本篇示意的空白排版當作介面契約。

示意結果如下，UUID 以文字省略，不能拿來設定主機：

```text
NAME        TYPE SIZE FSTYPE UUID       MOUNTPOINTS
nvme0n1     disk 100G
├─nvme0n1p1 part   1G vfat   （省略）   /boot/efi
└─nvme0n1p2 part  99G ext4   （省略）   /
```

這只顯示根檔案系統位於第二個分割區。若 `/home` 沒有另行掛載，家目錄與其他根目錄下資料可能共用同一份容量，不能把「不同目錄」當作「不同磁碟」。

容器裡的 `/` 可能是 overlay 掛載，看到的裝置與掛載視圖也可能不同於宿主機。Linux mount namespace 隔離程序看到的掛載列表，因此不能把容器內一次 `findmnt` 的結果直接當作整台主機的儲存配置。[Linux man-pages：mount_namespaces(7)](https://man7.org/linux/man-pages/man7/mount_namespaces.7.html)

## 容量不只有 bytes：inode 與兩種大小

inode 記錄檔案的類型、擁有者、大小及其他中繼資料，檔名則由目錄組織。大量小檔案可能只占少量內容空間，卻耗用許多 inode；硬連結則讓多個名稱指向同一 inode。[Linux man-pages：inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)

所以遇到 `No space left on device`，先同時看 `df -h` 與 `df -i`。對 ext4 而言，inode 數量受到建立檔案系統時的配置影響；不能把「還有幾十 GB」直接換算成「還能建立無限多個檔案」。Btrfs 等格式的 inode 配置機制不同，也不能把某種格式的固定 inode 模型套用到全部檔案系統。[e2fsprogs：mke2fs(8)](https://man7.org/linux/man-pages/man8/mke2fs.8.html)、[Btrfs：Introduction](https://btrfs.readthedocs.io/en/latest/Introduction.html)

另有兩種容易混淆的大小：

- **邏輯大小／表面大小（apparent size）**：程式看見的檔案長度，例如一般 `ls -l` 顯示的 bytes。
- **已配置空間（allocated space）**：檔案系統為檔案配置的空間；一般 `du` 估算這個量。小檔案可能因配置單位占得比邏輯大小多；稀疏檔案（sparse file）的洞讀起來是零，卻不必為每個邏輯位置配置儲存區塊，所以反而可能少得多。[GNU Coreutils：du](https://www.gnu.org/s/coreutils/manual/html_node/du-invocation.html)

對自己有權讀取、大小適中的目錄，可以比較以下查詢。`-s` 只顯示總計，`-x` 限制遍歷於同一檔案系統；它仍可能讀取很多目錄中繼資料，不宜未評估就掃描整台忙碌主機。

```bash
du -shx -- .
du -shx --apparent-size -- .
```

這不是要求兩個數字一致的測試。例如一份邏輯長度 1 GiB 的稀疏檔案可能只配置少量區塊；之後往洞裡寫入資料，仍需要實際可用空間。反過來，許多只有幾個 bytes 的小檔案可能占用更多配置空間。`du` 對硬連結預設避免重複計數，而 copy-on-write 共享區塊、壓縮等機制會讓它難以代表底層裝置的獨占用量。[GNU du(1)](https://man7.org/linux/man-pages/man1/du.1.html)、[GNU Coreutils 完整手冊：du 的估算限制](https://www.gnu.org/software/coreutils/manual/coreutils.html#du-invocation)

### 為什麼 df 與 du 不相等？

`df` 問檔案系統的使用統計；`du` 沿可存取的名稱遍歷、累加檔案的空間。它們的觀察範圍原本就不同。[GNU Coreutils：Disk usage](https://www.gnu.org/software/coreutils/manual/html_node/Disk-usage.html)

常見差異要逐項排除：

| 現象或條件 | 為什麼影響比較 |
| --- | --- |
| `du` 只掃某個子目錄 | `df` 仍回報整個檔案系統，包含其他目錄 |
| `du` 遇到權限錯誤 | 部分路徑沒有計入；不要隱藏錯誤後把結果視為完整 |
| 掛載遮住原目錄內容 | 舊內容未刪除，仍占底下檔案系統的空間，但從被覆蓋的路徑看不到 |
| 檔案已刪除名稱，但程序仍開著 | 路徑遍歷找不到它，區塊卻要等最後的開啟參照關閉才能回收 |
| 中繼資料、journal 與保留空間 | 不是每一個區塊都能由一般檔案內容總和解釋；可用空間也可能因保留區塊而少於總量減已用 |
| 查詢期間資料仍在變動 | 先後查詢並不是同一個時間點的一致性快照 |

刪除後仍占空間的生命週期見 [unlink(2)](https://man7.org/linux/man-pages/man2/unlink.2.html)；掛載遮蔽見 [mount(8)](https://man7.org/linux/man-pages/man8/mount.8.html)；ext 系列保留區塊與 journal 配置見 [mke2fs(8)](https://man7.org/linux/man-pages/man8/mke2fs.8.html)。例如服務一直寫入已被刪名的日誌，反覆刪同一路徑不會關閉它原本開著的檔案；應辨認持有者，再依該服務的日誌重開或輪替程序處理，不能直接殺掉未知程序來騰空間。

## 掛載與卸載改變的是存取入口

掛載把來源接到目標目錄；目標原有內容會暫時被遮住，卸載後才重新可見。因此掛載前要確認來源、目標以及目標是否已有資料或掛載。掛載通常需要管理權限，但桌面掛載服務或管理員政策可能允許一般使用者執行特定操作。[RHEL 9：Mounting file systems](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_file_systems/mounting-file-systems_managing-file-systems)

本文不提供可直接複製執行的掛載命令。實際管理流程應是：先從只讀查詢核對裝置及檔案系統身分，確認備份與使用中的服務，依發行版文件選定目標及選項，再掛載並以 `findmnt` 確認結果。掛載不是格式化；對已有資料的裝置重新建立檔案系統，可能破壞原資料。

常見選項有 `ro`／`rw`（唯讀／可寫）、`noexec`（限制從此掛載執行程式）、`nosuid` 與 `nodev`（限制特殊權限位元及裝置檔的相應作用）。它們是不同的限制，並不取代檔案權限；例如 `noexec` 不應當作能阻擋一切直譯器讀取腳本的完整安全邊界。對需保全資料的工作，也不能假定 `ro` 掛載絕不寫裝置：ext4 等格式可能仍需重播 journal，須另外依格式的復原選項與保全程序判斷。[util-linux：mount(8)，Filesystem-independent options 與 ro](https://man7.org/linux/man-pages/man8/mount.8.html)

卸載工具名稱是 `umount`，不是 `unmount`。正常卸載可能回報 **busy**：程序仍開著檔案、Shell 的目前目錄在該檔案系統內，或有使用中的 swapfile 等。先移開工作目錄、辨認持有者並協調服務停止使用，再重試正常卸載。強制或 lazy 卸載有各自用途與限制；lazy 先從目錄樹分離、延後清理參照，不代表資料已安全寫完或媒體可以立即拔除。[util-linux：umount(8)](https://man7.org/linux/man-pages/man8/umount.8.html)

## UUID 與 fstab：把預期配置留下來

一次臨時掛載不等於系統已記住開機時如何掛載。`/etc/fstab` 描述預期的來源、目標、格式與選項，開機管理工具會依它建立相應配置；它不是目前掛載狀態的即時清單。裝置名稱可能因偵測順序改變，所以常以檔案系統 UUID 識別來源。[RHEL 9：Persistently mounting file systems](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_file_systems/assembly_persistently-mounting-file-systems_managing-file-systems)

以下純文字是欄位示意，**不是有效設定，也不要寫入系統檔案**：

```text
來源識別                 掛載點        類型     選項       dump欄位   檢查欄位
UUID=<檔案系統的UUID>     <目標目錄>    <格式>   <選項>     <數值>     <數值>
```

六欄依序描述來源、目標、檔案系統類型、以逗號分隔的選項、`dump` 工具使用的欄位，以及開機檢查使用的欄位。第五欄不是備份是否完成的證明，第六欄也不是「數字越大，檢查越仔細」。一般 util-linux 語意中，0 表示不安排該項檢查，根檔案系統慣用 1，其他需檢查者慣用 2；實際還要看格式與開機管理工具。含空白的欄位需依 fstab 規則跳脫，不能套用 Shell 引號規則。[util-linux：fstab(5)](https://man7.org/linux/man-pages/man5/fstab.5.html)

UUID 與 PARTUUID 分別識別檔案系統及分割區，不能混用；複製整個裝置映像後也可能複製出相同 UUID，所以 UUID 不是永遠不重複的實機保證。先核對實際來源，不能從別台主機抄一行設定。[util-linux：mount(8)，Indicating the device and filesystem](https://man7.org/linux/man-pages/man8/mount.8.html)

可以只讀比較設定與目前狀態：

```bash
findmnt --fstab --output SOURCE,TARGET,FSTYPE,OPTIONS
findmnt --target . --output SOURCE,TARGET,FSTYPE,OPTIONS
findmnt --verify --verbose
```

`--verify` 檢查掛載表的可解析性及可用性，不實際執行掛載，也不是下次開機必定成功的保證。[util-linux：findmnt(8)](https://man7.org/linux/man-pages/man8/findmnt.8.html)

持久掛載會影響開機與服務依賴：必要資料裝置缺席時，系統該等待、失敗還是繼續，需按主機用途決定；`nofail` 等選項不能在未理解服務會否寫入空的底層目錄時直接加入。systemd 系統更改 fstab 後還有重載管理器配置的步驟。本文不修改 fstab；要實施時，應依發行版文件準備可還原設定、維護時段與復原入口，再確認實際掛載及依賴資料的服務，而非以重開機作第一次驗證。[RHEL 9：持久掛載程序](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_file_systems/assembly_persistently-mounting-file-systems_managing-file-systems)、[開機流程與系統管理](boot-and-system-administration.md)

## swap、快照與備份各解決不同問題

**swap** 是核心進行記憶體換頁時可使用的區域，可以在專用區塊裝置或符合條件的檔案上；它不是可存放一般文件的掛載目錄。只讀觀察可用下列指令；沒有輸出也可能代表目前沒有啟用的 swap。[Linux man-pages：swapon(2)](https://man7.org/linux/man-pages/man2/swapon.2.html)、[util-linux：swapon(8)](https://man7.org/linux/man-pages/man8/swapon.8.html)

```bash
swapon --show
```

不要拿前面提到的稀疏檔案直接當 swapfile：有洞、copy-on-write 及檔案系統配置都可能影響能否使用。啟用／停用 swap 也會影響記憶體資源，本篇不建立或變更它。[util-linux：swapon(8)，Files with holes](https://man7.org/linux/man-pages/man8/swapon.8.html)

**快照（snapshot）**保留某個時間點的狀態供回看或作為備份來源；實作可能在 LVM 的區塊層，也可能在 Btrfs 的檔案系統層，不能假設所有格式都有同一種快照。Btrfs 快照初始與原子卷共享資料區塊，不是立刻多出一份完整獨立副本。[LVM：lvm(8)](https://man7.org/linux/man-pages/man8/lvm.8.html)、[Btrfs：Subvolumes](https://btrfs.readthedocs.io/en/latest/Subvolumes.html)

**備份（backup）**的目的則是能從原資料的事故中復原。若快照與原資料共用同一儲存故障範圍，磁碟損壞或底層區塊被破壞時，兩者可能一起受損。因此同一磁碟的快照可協助回復某些邏輯變更，但不等於獨立備份；備份還需安排獨立保存位置、保留版本並驗證還原。快照也不自動保證資料庫等應用程式的交易一致性，應依應用程式的備份契約協調。[Btrfs：Subvolumes 的快照限制](https://btrfs.readthedocs.io/en/latest/Subvolumes.html)、[Oracle Linux：Managing Subvolumes and Snapshots](https://docs.oracle.com/en/operating-systems/oracle-linux/8/btrfs/btrfs-ManagingSubvolumesandSnapshots.html)

同樣地，檔案系統修復工具不取代備份。以 e2fsck 為例，一般不應在已掛載的 ext 系列檔案系統上進行修復；即使某些唯讀檢查組合可執行，掛載中取得的結果仍可能無效。遇到 I/O 錯誤或疑似損壞時，先保存證據、確認資料保護與離線條件，依格式和發行版復原程序處理，不把自動確認修復當作清理空間的捷徑。[e2fsprogs：e2fsck(8)](https://man7.org/linux/man-pages/man8/e2fsck.8.html)

## 遇到問題時，先定位哪一層

「找不到檔案」先用 `findmnt --target` 確認路徑落在預期的掛載上；「空間不足」先比較區塊與 inode，再限定範圍用 `du`；「磁碟變大但容量沒變」則分開看裝置、LV 與檔案系統。若出現唯讀、busy 或 I/O 錯誤，應保留原始訊息及相關日誌，辨認持有者與故障層，而不是反覆格式化、強制卸載或修復。

本文所有操作範例都是查詢；沒有執行分割、格式化、掛載、卸載、修復、swap 變更或 fstab 寫入。Bash 語法可解析只證明 Shell 區塊結構正確，不證明目標 Linux 工具存在、權限允許或裝置狀態符合條件。

## 相關閱讀與來源

- [Linux 知識索引](README.md)
- [檔案與目錄](files-and-directories.md)：路徑、名稱與 inode、硬連結及符號連結。
- [使用者與權限](users-and-permissions.md)：檔案權限與掛載限制是不同層的判斷。
- [開機流程與系統管理](boot-and-system-administration.md)：持久掛載、開機依賴及復原入口。
- [CPU、記憶體、I/O 與效能觀察](performance-observation.md)：容量、swap 與 I/O 壓力需要分開觀察。
- [Linux man-pages](https://man7.org/linux/man-pages/index.html)：inode、unlink 與 namespace 等核心介面。
- [util-linux 上游](https://github.com/util-linux/util-linux)：本文以 man7 收錄的上游 mount、umount、lsblk、findmnt、fstab 與 swapon 手冊查證；頁面可能標示開發版本。
- [e2fsprogs 上游](https://git.kernel.org/pub/scm/fs/ext2/e2fsprogs.git/)與[Linux 核心檔案系統文件](https://docs.kernel.org/filesystems/index.html)：格式建立、檢查工具與檔案系統原理。
- [Btrfs 專案文件](https://btrfs.readthedocs.io/en/latest/)：copy-on-write、子卷與快照邊界。
- [GNU Coreutils 手冊](https://www.gnu.org/software/coreutils/manual/coreutils.html)：容量及檔案空間工具。部分分頁直接擷取逾時，本次另查官方搜尋擷取與 GNU 工具手冊頁；未將網頁查證寫成 Linux 實測。
