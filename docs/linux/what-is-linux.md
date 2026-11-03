# 認識 Linux

提到 Linux，有人想到伺服器，有人想到 Ubuntu，也有人想到輸入指令的黑色視窗。
這些印象各自碰到系統的一部分：**Linux 嚴格來說是核心的名稱，日常也常用來稱呼以這個核心組成的作業系統。**
分清楚核心、其他系統軟體與發行版，才能理解為什麼兩台都叫 Linux 的電腦，畫面和操作方式仍可能不同。
這個用語區分可參考 [Debian FAQ §1.3](https://www.debian.org/doc/manuals/debian-faq/basic-defs.en.html#s-linux)。

本文不要求先會程式設計或終端操作，聚焦系統的組成與使用情境，不涉及安裝或管理步驟。

查證日期：2026-11-02。依據 Linux 核心文件、Debian、Ubuntu、Android 與 Apple 的官方資料；
網站內容會持續更新，本文不綁定某個發行版版本。
本文僅做文件查證，未在 Linux 環境執行命令；以下流程是概念示例，沒有實測輸出。

## 作業系統讓程式有可用的執行環境

**作業系統（operating system，OS）**是一組讓電腦運作、讓其他程式得以執行的基礎軟體。
我們使用文字編輯器寫筆記時，不必讓編輯器自己從頭處理整台電腦；作業系統提供共同的基礎。
核心是其中最基礎的部分，但整個系統還需要工具與其他軟體。
參考 [Debian：About Debian](https://www.debian.org/intro/about#what)。

例如，同時開著編輯器與瀏覽器時，程式需要分享 CPU、使用記憶體，並存取儲存裝置與網路。
Linux **核心（kernel）**負責程序排程、記憶體管理、透過驅動程式與裝置互動，以及接收程式要求的系統服務。
「程序」在這裡先理解為正在執行的程式即可；這些管理工作並不是由使用者每次手動分配。
參考 [Red Hat：Linux 核心的職責](https://www.redhat.com/en/topics/linux/what-is-the-linux-kernel#what-the-kernel-does)。

Linux 是類 Unix（Unix-like）的核心；核心專案的文件也說明它的 Unix 與 POSIX 相容性目標。
「類 Unix」描述系統設計與介面上的關係，不能據此把所有類 Unix 系統都叫作 Linux。
參考 [Linux 核心 README：What is Linux?](https://www.kernel.org/doc/html/latest/admin-guide/README.html#what-is-linux)。

## 核心與使用者空間如何合作

核心之外，執行應用程式與許多系統服務的範圍稱為**使用者空間（user space，亦寫作 userspace）**。
這個名稱不是指螢幕上的某個區域，也不只包含有人正在點選的程式；背景執行的服務也可以在使用者空間。
程式需要核心服務時，透過**系統呼叫（system call）**等介面提出要求。
核心與使用者程序的分工見 [Red Hat：核心在 OS 中的位置](https://www.redhat.com/en/topics/linux/what-is-the-linux-kernel#where-the-kernel-fits-within-the-os)，
介面分類見 [Linux 核心的 user-space API 指南](https://www.kernel.org/doc/html/latest/userspace-api/index.html)。

可以先用這張簡化結構圖理解，不必把它當作每個程式必經的固定路線：

```text
使用者空間
  應用程式：文字編輯器、瀏覽器、網站服務
  系統工具與服務、Shell、函式庫
                  │ 要求核心提供服務
                  ▼
Linux 核心：程序、記憶體、檔案與裝置、網路等管理
                  │ 透過驅動程式等機制
                  ▼
硬體：CPU、記憶體、儲存裝置、網路裝置
```

假想你在編輯器中按下「儲存」：編輯器處理文件內容與檔名，並透過系統介面要求寫入檔案；
核心處理相關存取與 I/O，最終透過儲存裝置完成工作。
這是分工示意，不表示一次按鈕只對應一次系統呼叫，也不表示畫面顯示儲存完成就能推定所有資料已落到實體儲存媒體。
要理解這個最後的差別，可參考 [Linux `fsync(2)` 手冊](https://man7.org/linux/man-pages/man2/fsync.2.html)。

**Shell 是其中一種程式，不是 Linux 核心。**例如 Bash 讀取並解譯命令，讓人透過文字要求執行工作；
它的角色與負責管理硬體資源的核心不同。
參考 [Debian 的 Bash 套件說明](https://packages.debian.org/stable/bash)。
終端機與 Shell 的差別，以及輸入命令後發生什麼事，另見[終端與 Shell](terminal-and-shell.md)。

## 發行版把零件整合成可使用的系統

只有核心，還不等於你平常安裝、登入與更新的完整環境。
**Linux 發行版（distribution，常簡稱 distro）**將核心、工具、函式庫與應用軟體等組合起來，
並提供安裝、套件管理、維護與文件。Debian GNU/Linux 與 Ubuntu 都是這類系統的例子。
發行版的差異不只在桌布，還在於如何打包、安裝、追蹤與維護軟體。
參考 [Debian FAQ §1.2](https://www.debian.org/doc/manuals/debian-faq/basic-defs.en.html#s-whatisdebian)與
[Ubuntu Server 官方介紹](https://ubuntu.com/server)。

| 名詞 | 指的是什麼 | 本文中的例子 |
| --- | --- | --- |
| 核心 | 提供底層資源管理與系統服務的部分 | Linux |
| 使用者空間 | 核心以外，應用與服務執行的範圍 | 編輯器、Bash、網站服務 |
| 發行版 | 將核心與其他軟體整合、提供維護的系統 | Debian GNU/Linux、Ubuntu |
| 桌面環境 | 提供視窗、選單等圖形操作體驗的軟體組合 | 可由發行版提供不同預設選擇 |

以 Ubuntu 為例，官方也提供不同桌面環境、應用與預設設定的 flavors。
因此，「換了桌面介面」與「換了核心」是兩件不同的事。
參考 [Ubuntu Desktop：Official flavors](https://ubuntu.com/desktop)。

你也會看到 **GNU/Linux** 這個名稱。Debian 使用它來表達 Linux 核心與 GNU 工具共同組成系統的關係；
名稱提醒我們：完整系統的貢獻不只來自核心。
不過，不能反過來假設凡是使用 Linux 核心的系統，都具有相同的使用者空間與工具。
參考 [Debian：核心與 GNU 工具](https://www.debian.org/intro/about#what)。

## 同一個核心，可以支撐不同使用情境

| 情境 | 使用者實際在做什麼 | 從這個例子理解什麼 |
| --- | --- | --- |
| 個人桌面與開發 | 在筆電上開瀏覽器、編輯程式與文件 | Linux 系統可以有圖形介面，不必每件事都輸入命令 |
| 伺服器與雲端 | 執行網站、資料庫或一批運算工作 | 系統的重點可以是持續提供服務，而非桌面操作 |
| Android 裝置 | 使用手機上的應用程式 | 使用 Linux 核心，不代表操作體驗或工具與桌面發行版相同 |

桌面與伺服器例子的產品範圍分別見 [Ubuntu Desktop](https://ubuntu.com/desktop)與
[Ubuntu Server](https://ubuntu.com/server)；Android 官方文件則說明其核心以 Linux LTS 核心為基礎，
加入 Android 特有的修改，見 [Android：Kernel overview](https://source.android.com/docs/core/architecture/kernel)。
這些是幫助理解組成差異的例子，不是發行版選型建議。

閱讀一份 Linux 教學時，可以先問：它說的是共同的核心概念，還是某個發行版的工具與預設？
前者較容易跨系統理解；後者應核對文件指定的發行版、版本與環境，不能只因為名稱都有 Linux 就照搬。

## 幾個容易混在一起的觀念

- **Linux 不等於 Ubuntu。**Ubuntu 是一種 Linux 系統，Debian GNU/Linux 是另一個例子；
  教學裡看到的工具、畫面與預設，不必然適用所有發行版。
- **Linux 不等於 Bash，也不等於終端機視窗。**Bash 是命令解譯程式；
  圖形桌面與文字操作都是使用系統的方式，不能靠畫面外觀判斷核心。
- **macOS 不是 Linux。**Apple 的 XNU 是 Darwin 的核心，供 macOS 與 iOS 使用，組合了 Mach、FreeBSD 元件與 IOKit；
  它不是 Linux 核心。即使部分命令相似，也不能推定工具選項與系統行為完全一致。
  參考 [Apple XNU 原始碼庫：What is XNU?](https://github.com/apple-oss-distributions/xnu#what-is-xnu)。

開始學習時，不必先記住每個發行版的差別。
先能指出自己操作的是哪個系統、哪一層軟體，再沿著終端、檔案與目錄等具體概念深入，就比較容易判讀後續教學的適用範圍。

## 相關文件

- [Linux 知識索引](README.md)：查看目前內容與後續整理方向。
- [終端與 Shell](terminal-and-shell.md)：理解文字操作介面、命令形式與說明文件。
- [檔案與目錄](files-and-directories.md)：從路徑與目錄結構理解系統中的資料位置。
