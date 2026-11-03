# 命名空間、cgroups 與容器隔離基礎

「容器」常被視為小型虛擬機，但 Linux 核心裡並沒有名為「容器」的單一系統物件。容器執行期（runtime）實際上是組合多項核心機制：**用命名空間（namespaces）隔離程序看見的系統資源視角，用控制群組（cgroups）限制與計量硬體資源使用，再搭配 capabilities 與檔案系統邊界縮小權限。** 容器內的程序依然直接由同一個宿主機核心排程與執行系統呼叫。[來源：namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)、[cgroups(7)](https://man7.org/linux/man-pages/man7/cgroups.7.html)

本文從[認識 Linux](what-is-linux.md)的核心與使用者空間邊界出發，銜接[程序](processes-and-jobs.md)、[使用者與權限](users-and-permissions.md)與[Linux 核心與系統呼叫](kernel-and-system-calls.md)。若使用雲端容器服務，可對照 AWS 的[ECS 與 Fargate](../aws/ecs-and-fargate.md)及[容器編排與運算容量](../aws/container-orchestration-and-compute-capacity.md)。

查證日期：**2026-11-03**。依據 Linux man-pages（`namespaces(7)`、`pid_namespaces(7)`、`user_namespaces(7)`、`cgroups(7)`、`capabilities(7)`）與 Linux Kernel Control Group v2 官方文件。本文僅做文件查證，並在 Darwin 主機以 Bash 5.3.9 做 Bash 區塊 `bash -n` 語法檢查；**未在 Linux 環境建立命名空間、修改 cgroup 或執行容器**。命令與檔案內容均為概念說明與假想示意，不能當作實測紀錄。

## 容器不是虛擬機：共用核心的執行邊界

虛擬機（VM）由 Hypervisor 提供虛擬硬體，每個客體環境執行自己獨立的作業系統核心；而同一台 Linux 主機上的多個容器，預設共用同一個 Linux 核心，只是各自處於不同的 namespaces 與 cgroups 組合中。[來源：namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)

```text
傳統虛擬機：
  應用程式 A        應用程式 B
  客體核心 A        客體核心 B
  ───────── Hypervisor ─────────
           宿主機硬體

Linux 容器隔離：
  容器 A 程序       容器 B 程序
  (獨立 namespaces  (獨立 namespaces
   與 cgroup 限制)   與 cgroup 限制)
  ──────── 共用宿主機核心 ────────
           宿主機硬體
```

這項差異直接決定了兩件事：

1. **啟動與資源開銷不同**：建立容器程序不需要重新開機載入另一份核心，本質上是建立帶有特定隔離設定的 Linux 程序。
2. **故障與安全邊界不同**：因為系統呼叫最終進入同一個核心，核心本身的漏洞、核心模組或未隔離的系統介面（例如部分 `/proc` 與 `/sys` 路徑），仍可能跨越容器邊界影響整台主機。[來源：syscalls(2)](https://man7.org/linux/man-pages/man2/syscalls.2.html)、[namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)

## Namespaces：決定程序「看得見什麼」

命名空間包裝（wrap）特定的全域系統資源，讓同一個 namespace 內的程序看似擁有獨立的資源實例，而不同 namespace 的變更彼此不可見（或受階層限制）。Linux 提供多種獨立的 namespace 類型，一個程序可以同時在某幾種資源上與宿主機共用，在另幾種資源上進入新的 namespace。[來源：namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)

| Namespace 類型 | 隔離的資源視角 | 對程序的實際意義 |
| --- | --- | --- |
| Mount（`CLONE_NEWNS`） | 掛載點清單 | 容器擁有自己的根目錄樹與掛載視圖，不直接改動宿主機掛載表 |
| PID（`CLONE_NEWPID`） | 程序 ID 編號空間 | 容器內第一個程序可看到自己是 PID `1`，且看不見外層 namespace 的程序 |
| Network（`CLONE_NEWNET`） | 網路裝置、IP、路由表、連接埠與防火牆規則 | 容器有獨立的 `lo`、虛擬網卡與 port 空間，不會直接與宿主機爭用同一個監聽埠 |
| User（`CLONE_NEWUSER`） | UID 與 GID 映射 | 容器內的 UID `0`（root）可映射到宿主機的非特權一般 UID |
| UTS（`CLONE_NEWUTS`） | 主機名稱（hostname）與 NIS 網域名稱 | 容器可設定自己的主機名稱，不影響宿主機 |
| IPC（`CLONE_NEWIPC`） | System V IPC 與 POSIX message queues | 隔離程序間共享記憶體與訊息佇列名稱空間 |
| Cgroup（`CLONE_NEWCGROUP`） | `/proc/self/cgroup` 顯示的階層根路徑 | 讓程序只看到自己所屬的 cgroup 相對路徑 |
| Time（`CLONE_NEWTIME`） | `CLOCK_MONOTONIC` 與 `CLOCK_BOOTTIME` 位移 | 允許不同命名空間看到不同的單調時鐘與開機時間位移 |

### PID namespace 是階層式的，不是雙向盲視

當宿主機建立一個新的子 PID namespace 時，該空間內的第一個程序在自己的命名空間中是 PID `1`（扮演該空間的 init 角色，負責收養並回收空間內失去父程序的子程序；若此 PID `1` 終止，核心會對該命名空間內其餘程序送出 `SIGKILL`）。然而，**這個程序在宿主機的根 PID namespace 中仍然有另一個宿主機可見的 PID**。[來源：pid_namespaces(7)](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html)

- **由內往外**：子 PID namespace 的程序（搭配對應掛載的 `/proc`）看不見父層或同層其他 namespace 的程序。
- **由外往內**：祖先（宿主機）PID namespace 的管理員看得到子空間內的所有程序，也能從宿主機對它們發送訊號。

注意：`ps` 與 `top` 讀取的是 `/proc`。如果只建立新的 PID namespace，卻沒有在新的 mount namespace 中重新掛載屬於該 PID namespace 的 `procfs`，程序讀到的仍是舊 `/proc`，會看到外層的程序清單。[來源：pid_namespaces(7) 的 /proc 說明](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html)

### User namespace：容器內的 root 不必等於宿主機的 root

在未啟用 user namespace 映射的容器中，容器內的 UID `0` 就是宿主機的 UID `0`；只要突破檔案系統或系統呼叫限制，就擁有宿主機 root 身分。透過 `user_namespaces(7)`，可以將容器內的 UID `0` 映射為宿主機上的一般非特權 UID（例如 `100000`）：程序在該命名空間內部對受其管理的資源具備特權，但在宿主機檔案系統或其他命名空間看來，只是普通使用者。[來源：user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)

## cgroups v2：決定程序「能用多少資源」

Namespaces 只隔離「看得見什麼」，不限制程序吃光整台主機的 CPU 或記憶體。**Control groups（cgroups）** 將程序組織成樹狀階層，由各資源控制器（controllers，如 `cpu`、`memory`、`io`、`pids`）在節點上統計用量並施加配額。現行主流發行版與核心以 **cgroup v2（統一階層，unified hierarchy）** 為標準。[來源：cgroups(7)](https://man7.org/linux/man-pages/man7/cgroups.7.html)、[Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)

| 控制器與常見介面檔（cgroup v2） | 控制或觀察的重點 | 超過限制時的典型行為 |
| --- | --- | --- |
| `cpu.max`／`cpu.weight` | 週期內的 CPU 時間上限（配額／週期）與競爭時的相對權重 | 達到 `cpu.max` 上限時被節流（throttled），等待下一週期，不會直接終止程序 |
| `memory.high`／`memory.max` | 記憶體回收節流門檻與硬性上限 | 超過 `memory.high` 會被優先回收並放慢配置；觸及 `memory.max` 且無法回收時，觸發該 cgroup 內的 OOM killer |
| `io.max`／`io.weight` | 特定區塊裝置的讀寫 BPS／IOPS 上限與相對權重 | I/O 請求排隊等待配額 |
| `pids.max` | 該階層下可同時存在的 task（process／thread）總數上限 | 超過時 `fork()`／`clone()` 失敗並回傳 `EAGAIN`，防止 fork bomb 耗盡全系統 |

### CPU 節流與記憶體 OOM 的現象截然不同

這也是為什麼排查容器問題時，要區分「CPU 受限」與「記憶體受限」：

- **CPU 設得太低**：服務不會因為達到 `cpu.max` 而崩潰退出，而是尾端延遲（latency）變長，`cpu.stat` 中的 `nr_throttled` 與 `throttled_usec` 增加。
- **記憶體觸及 `memory.max`**：若頁面無法被回收或換出，核心會在該 cgroup 範圍內啟動 OOM killer 終止程序，在容器編排平台（如 Kubernetes 或 ECS）常表現為非零退出碼（例如因 `SIGKILL` 產生的狀態碼 `137`）與 `memory.events` 中的 `oom_kill` 計數增加。[來源：Control Group v2 Memory Interface Files](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files)

## Capabilities 與系統呼叫過濾：縮小特權

傳統 UNIX 將程序分為 root（UID 0，擁有所有特權）與非 root。Linux 將 root 特權拆細為獨立的 **capabilities**，例如：

- `CAP_NET_BIND_SERVICE`：綁定小於 1024 的特權連接埠，不必因此給予完整 root 權限。
- `CAP_NET_ADMIN`：修改網路介面、路由與防火牆規則（作用於所屬的 network namespace）。
- `CAP_SYS_ADMIN`：涵蓋 `mount()`、多數 namespace 操作與大量系統管理能力，權限很寬，相當於把大量核心攻擊面打開。[來源：capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)

容器執行期通常預設丟棄大多數 capabilities，並搭配 **seccomp（secure computing mode）** 過濾系統呼叫（例如阻擋容器內呼叫 `kexec_load`、`init_module` 或未授權的 `mount`），以及 AppArmor 或 SELinux 等 Linux Security Modules（LSM）。若啟動容器時開啟 `--privileged`（特權模式），等同授予所有 capabilities、解除裝置與過濾限制，容器隔離邊界將大幅失效。[來源：seccomp(2)](https://man7.org/linux/man-pages/man2/seccomp.2.html)、[capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)

## 在 Linux 上用只讀命令觀察隔離狀態

以下為**只讀查詢**，可在一般 Linux 環境檢視目前程序所在的 namespaces 與 cgroup v2 狀態，不需 `sudo`，也不建立或修改任何容器：

```bash
# 查看目前 shell 程序所屬的各類 namespaces 符號連結
ls -l /proc/self/ns

# 列出目前使用者可見的 namespaces 摘要
lsns

# 查看目前程序在 cgroup 階層中的相對位置
cat /proc/self/cgroup

# 查看目前程序的能力遮罩（十六進位位元組，可搭配 capsh --decode 解讀）
grep '^Cap' /proc/self/status
```

假設在某個受限的服務或容器內讀取對應 cgroup v2 目錄，以下是**自訂的假想節錄**，並非實測輸出：

```text
$ cat /sys/fs/cgroup/cpu.max
50000 100000

$ cat /sys/fs/cgroup/memory.max
536870912

$ cat /sys/fs/cgroup/memory.events
low 0
high 0
max 3
oom 1
oom_kill 1
```

判讀方式：`cpu.max` 的 `50000 100000` 表示每 `100,000` 微秒（100ms）週期最多使用 `50,000` 微秒（50ms）的 CPU 時間，約合 0.5 顆邏輯 CPU 配額；`memory.max` 為 `536870912` bytes（512 MiB）；`memory.events` 顯示該群組曾有 3 次達到 `max` 上限，並觸發過 1 次 `oom_kill`。

注意：在容器內執行 `free` 或讀取 `/proc/meminfo` 時，由於 `/proc/meminfo` 傳統上反映的是整個宿主機的記憶體資訊（除非透過額外 FUSE 等機制覆蓋），程序若直接根據 `/proc/meminfo` 決定快取或堆積大小，常會誤以為可用記憶體等於整台宿主機，進而直接觸及 `memory.max` 被 OOM killer 終止。這也呼應[效能觀察](performance-observation.md)中同時核對工作負載與配額邊界的原則。[來源：Control Group v2 Memory](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory)

## 常見誤解與限制

- **「放進容器就等於有完整的安全沙盒」**：不對。共用核心意味著系統呼叫介面是共用的；若容器以宿主機 root 身分執行、掛載了宿主機敏感路徑（如 `/var/run/docker.sock` 或宿主機 `/`），或授予過寬的 capabilities，容器內程序仍能影響整台宿主機。
- **「CPU limit 設為 1 代表綁定在單一實體核心」**：`cpu.max` 是時間配額（bandwidth control），可分散在多個核心上消耗；若要限制只能跑在特定 CPU 核心與記憶體節點，屬於 `cpuset` 控制器的職責。[來源：Control Group v2 CPU / Cpuset](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- **「看到容器內 UID 是 0，就一定是或一定不是宿主機 root」**：取決於是否啟用並設定了 user namespace 映射；可檢查 `/proc/self/uid_map` 確認容器內 UID `0` 對應到外層的哪個 UID。[來源：user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)

## 相關文件與參考來源

- [Linux 知識索引](README.md)：回到 Linux 主題總覽。
- [認識 Linux](what-is-linux.md)：核心、使用者空間與發行版的分工。
- [程序](processes-and-jobs.md)：PID、程序樹、訊號與狀態。
- [使用者與權限](users-and-permissions.md)：UID、GID 與權限檢查基礎。
- [CPU、記憶體、I/O 與效能觀察](performance-observation.md)：結合主機指標與 cgroup 節流／OOM 事件判讀瓶頸。
- [Linux 核心與系統呼叫](kernel-and-system-calls.md)：使用者空間進入核心的介面邊界。
- [ECS 與 Fargate](../aws/ecs-and-fargate.md)／[容器編排與運算容量](../aws/container-orchestration-and-compute-capacity.md)：從單機核心隔離機制延伸到雲端容器編排與運算容量模型。

**一手來源：**

- [namespaces(7) — Linux manual page](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [pid_namespaces(7) — Linux manual page](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html)
- [user_namespaces(7) — Linux manual page](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)
- [cgroups(7) — Linux manual page](https://man7.org/linux/man-pages/man7/cgroups.7.html)
- [Control Group v2 — The Linux Kernel documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [capabilities(7) — Linux manual page](https://man7.org/linux/man-pages/man7/capabilities.7.html)
- [seccomp(2) — Linux manual page](https://man7.org/linux/man-pages/man2/seccomp.2.html)
