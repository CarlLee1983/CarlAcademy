# 分散式系統：寫作證據與來源

查核日期：2026-11-04；第三至第五階段補充查核：2026-11-05。本文是文章作者用的一手來源筆記，非實驗報告。以下論文模型、歷史系統設計、產品文件不得互相替代；教學案例應明示為推演。

## 失敗、逾時與重試

- **可用主張：**遠端呼叫會局部失敗；逾時只表示呼叫端停止等待，副作用可能已發生。重試可能加重過載；backoff 增加間隔，jitter 分散同時重試。連線與請求逾時還需確認是否涵蓋 DNS、TLS 等工作。來源：[Amazon Builders’ Library：Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)，Timeouts、Retries and backoff、Jitter 各節。
- **寫作界線：**AWS 以可接受的誤判逾時比例對照下游延遲分位數，是其工程方法；p99.9 並非任何服務通用的逾時值。教學可追問「付款成功、回應遺失後，重試會怎樣」，不能將逾時等同付款失敗。[同上](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- **冪等契約：**呼叫者提供請求識別碼，服務記錄原始參數及結果；記錄 token 與業務修改需具備原子性。同 token 不同參數應有明確錯誤，記錄保存期間也影響晚到重試。來源：[Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)，Reducing client complexity、Late arriving requests、Same client request ID, different intent。這不是「加 UUID 就完成」；兩次相同參數仍可能是兩個不同意圖。

## 時間、因果與一致性

- **論文模型：**Lamport 以程序內順序、訊息送出先於接收及遞移性定義 happened-before。邏輯時鐘保證 `a → b ⇒ C(a) < C(b)`；反向不能推導因果。加入節點識別碼可將相同時間戳打破平手，得到符合因果的全序，並不代表真實世界的時間順序。來源：[Lamport，Time, Clocks, and the Ordering of Events in a Distributed System（1978）](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/Time-Clocks-and-the-Ordering-of-Events-in-a-Distributed-System.pdf)，The Partial Ordering、Logical Clocks、Ordering the Events Totally。
- **CAP 定義：**此處 C 是 atomic consistency／linearizability：操作如同在呼叫與回應間某點生效，並遵守已完成操作的先後。A 是每個送到非故障節點的請求最終得到回應，不是月可用率或固定毫秒 SLA。在可分割網路中，不能同時保證原子讀寫暫存器的 C 與 A。來源：[Gilbert、Lynch，Perspectives on the CAP Theorem（2012）](https://groups.csail.mit.edu/tds/papers/Gilbert/Brewer2.pdf)，§2。這是原證明作者的回顧，非 2002 原文。
- **寫作界線：**不要用「三選二」替整個產品貼永久標籤；應畫出分割期間某次讀寫：等待／拒絕、或回傳可能過時資料。CAP 的 consistency 不等於 ACID 的 C；其可用性定義也不衡量尾端延遲。[同上](https://groups.csail.mit.edu/tds/papers/Gilbert/Brewer2.pdf)

## 複寫、quorum 與共識

- **歷史設計：**Dynamo 以 N 表示副本數，R、W 表示成功讀寫等待的節點數；`R + W > N` 是 quorum-like 配置。它允許 sloppy quorum 使用原指定副本以外的健康節點，並以版本、衝突調解和 hinted handoff 處理分歧。來源：[Dynamo: Amazon’s Highly Available Key-value Store（2007）](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)，§4.5–4.6。
- **推導界線：**固定 N 個副本中，讀寫集合滿足 `R + W > N` 才能由集合大小推導交集；這個算式本身沒有定義並行寫入排序、讀到交集後選哪個版本、或失敗寫入處理，因此不能單獨證明線性一致。Dynamo 的 sloppy membership 更不能直接套固定集合的推導。此處是依上述協定條件作的推論；2007 Dynamo 也不能當作現今 DynamoDB 的契約。[Dynamo 原文](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)
- **Raft 模型：**Raft 讓複寫狀態機依相同順序套用命令；領導者、任期與日誌規則一起維護安全性，不能只寫「多數決」。在論文的非 Byzantine、持久狀態假設下，2f+1 節點的多數派可容忍 f 節點不可用；進展仍需要可通訊的多數派及足夠穩定的領導者。來源：[Ongaro、Ousterhout，Raft extended version（2014）](https://raft.github.io/raft.pdf)，§2、§5、§5.6。安全性不依賴快慢；可用性依賴時序。請勿將文中的選舉 timeout 範例當產品預設值。
- **FLP 界線：**完全非同步、確定性、訊息可靠且程序至多一個停止故障的模型中，不能保證所有容許執行皆終止。這不是「共識永遠做不到」，也不是「Raft 違反定理」：真實協定的進展條件增加了時序等假設。來源：[Fischer、Lynch、Paterson，Impossibility of Distributed Consensus with One Faulty Process（1985）](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf)，Introduction、§2、Theorem 1。

## 分片與跨服務交易

- **產品例子：**MongoDB 以 shard key 將不同資料分配到不同 shard；帶 shard key 的查詢可定位，否則可能 scatter/gather；分片與每個 shard 的 replica set 可並存。範圍分片保留範圍查詢局部性，但差的 key 會造成分布不均；hash 亦有查詢代價。來源：[MongoDB：Sharding Introduction and Architecture](https://www.mongodb.com/docs/manual/sharding/)，Shard Keys、Advantages、Considerations、Sharding Strategy。這支撐「分片分資料、複寫存副本」的教學例子，非所有資料庫的行為保證。
- **2PC：**prepare 後參與者承諾等待決策；經典 2PC 的協調者失效可能阻塞。論文假設 stable storage、停止式故障、訊息可遺失或重複但不會無法偵測地損毀。來源：[Gray、Lamport，Consensus on Transaction Commit](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-2003-96.pdf)，§1–3。不要把 2PC 寫成兩次普通 HTTP 呼叫，或宣稱所有協調者故障一律阻塞。
- **Saga：**由一串本地交易及補償步驟組成；參與者需能處理重試，且缺少整體交易隔離，並行流程可能互相干擾。來源：[AWS：Saga orchestration pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html)，Issues and considerations、High-level architecture。教學應明示補償是業務動作，例如退款；不能承諾已寄出的信件或被外界觀察到的中間狀態都能回復。這個退款例子是設計推演。
- **Outbox：**業務資料與 outbox 記錄在同一本地交易提交，再由 relay 發送；解決資料庫與訊息系統雙寫的原子性缺口，但 relay 可能重送，consumer 仍需冪等。來源：[AWS：Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)，Issues and considerations、Using an outbox table。不能把它宣稱為跨所有服務的原子交易。

## 訊息語意與測試

- **範圍化保證：**Kafka 4.1 文件區分至多一次、至少一次、恰好一次；Kafka 內讀取、處理、再寫入 topic 的 exactly-once 需要交易性 producer、offset 與輸出原子提交，以及適當 consumer 設定。對外部目的系統一般需要對方配合。來源：[Apache Kafka 4.1：Design](https://kafka.apache.org/41/design/design/)，Message Delivery Semantics、Using Transactions。「不重複送達」「不重複處理」「外部付款只生效一次」是不同邊界，文章應逐一命名。
- **一手測試案例：**FoundationDB 在確定性模擬中注入程序、網路、磁碟故障，並以 assertions／workload invariants 作為 oracle，可重播失敗；論文明列模擬難以可靠發現效能問題、未涵蓋第三方依賴等限制。來源：[FoundationDB: A Distributed Unbundled Transactional Key Value Store（2021）](https://www.foundationdb.org/files/fdb-paper.pdf)，§4、§6.2。可據此設計「回應遺失、重送、分割、主節點切換」練習，但本次沒有實際執行，不能寫測試通過或證明系統無錯。

## 補充：時鐘、活性與過載的前提

- **時鐘 API 已核對：**Linux `CLOCK_REALTIME` 可被校時而跳動；`CLOCK_MONOTONIC` 不倒退、不受這類跳動影響，但受 NTP 漸進調整，且不計 suspend；`CLOCK_BOOTTIME` 包含 suspend。以同一時鐘計算本機剩餘時間，可避免 wall-clock 跳動改變期間；monotonic 數值不可當作跨主機共同時間。來源：[Linux man-pages：clock_gettime](https://man7.org/linux/man-pages/man3/clock_gettime.3.html)，DESCRIPTION。最後兩句是依時鐘語意作的設計推論，實際 deadline API 還需核對 runtime。
- **部分同步原文已核對摘要：**Dwork、Lynch、Stockmeyer 分兩種情況：固定時序界限存在但事先未知；或界限已知，但只在未知時間 T 後保證成立。不能簡化為「通常很快」或聲稱可以偵測 GST。來源：[Consensus in the Presence of Partial Synchrony（1988）](https://groups.csail.mit.edu/tds/papers/Lynch/jacm88.pdf)，Abstract、§1。完整協定證明未重建。
- **failure detector 已核對摘要：**Chandra、Toueg 以 completeness 與 accuracy 分類不可靠故障偵測器；在附加特定偵測器假設後，可在非同步 crash 模型解共識，部分類別需要多數正確程序。心跳逾時是懷疑，不是無條件正確的死亡證明。來源：[Cornell 原作者技術報告（1995，期刊版 1996）](https://ecommons.cornell.edu/entities/publication/7948ff49-7263-49f8-a29b-d062e7cbb240)。本次已讀摘要，PDF 下載回傳 429，未核對各類別演算法證明；不把此摘要當成任意 timeout 偵測器皆足夠的依據。
- **過載工程文件已讀相關節：**應同時限制佇列大小與等待年齡，過期工作可能已無價值；傳遞剩餘時間讓下游少做無用功。來源：[Using load shedding to avoid overload](https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/)，Prioritizing requests、Watching out for queues。Backpressure 將消費端積壓轉成上游接收限制；不能只靠佇列吸收長期超過消費能力的流量。不同業務可選擇接受積壓而非拒絕，並非一律丟棄。來源：[Avoiding insurmountable queue backlogs](https://aws.amazon.com/builders-library/avoiding-insurmountable-queue-backlogs/)，Sending backpressure upstream。

## 補充：向量時鐘、CRDT 與 fencing

- **向量時鐘已讀原文 §7：**Mattern 的每個程序維護向量，事件遞增自己的分量，收訊合併逐分量最大值；完整事件記錄及訊息通道模型下，向量嚴格偏序對應 happened-before，不可比較的向量表示並行。向量可辨認因果，不替應用決定衝突該如何合併。來源：[Virtual Time and Global States of Distributed Systems（1989，1988 workshop）](https://www.vs.inf.ethz.ch/publ/papers/VirtTimeGlobStates.pdf)。Fidge（1988）的原文搜尋可辨識，但 Lund、UCI 副本本次皆 404，正文應優先引可讀的 Mattern 原文，不宣稱本次已讀 Fidge 全文。
- **CRDT 已讀原報告 §2.3：**state-based CvRDT 的狀態形成 join-semilattice、更新沿偏序向上、merge 取 least upper bound；merge 因此具交換、結合、冪等性，但仍需新狀態最終傳到各副本。operation-based CmRDT 需要可靠傳遞及型別要求的 delivery order，未受該次序約束的操作需可交換；不能把 state merge 可重複套用的性質直接套到任意 increment 訊息。來源：[Shapiro 等，INRIA RR-7506（2011）原報告之大學副本](https://perso.lisn.upsaclay.fr/mbl/ENS/CSCW/2021/papers/CRDT-study11.pdf)。INRIA HAL 入口被防機器存取阻擋；上述副本以正常 TLS 下載，確認為同編號、作者、日期原文。收斂本身不證明「配額不得為負」等業務不變式。
- **fencing 已讀 Chubby §2.4、§2.8：**Chubby 鎖是 advisory；舊持有者的延遲請求仍可能到達外部資源。sequencer 含鎖名稱、模式、lock generation，需隨受保護操作傳給接收端，由接收端驗證並拒絕無效／過時請求。來源：[Burrows，The Chubby lock service（2006）](https://static.googleusercontent.com/media/research.google.com/en//archive/chubby-osdi06.pdf)。本次 web 取檔失敗，但以正常 TLS 下載原 PDF（117687 bytes）並讀相關節。鎖服務本身不能強迫未實作檢查的外部儲存體 fencing；論文的 lock-delay 只是較容易採用但不完美的替代。
- **API 對照已讀：**[etcd concurrency](https://pkg.go.dev/go.etcd.io/etcd/client/v3/concurrency) 的 Session 是持續刷新 lease；Done／Ctx 通知 lease 不再刷新，Election.Rev 回傳 leader key 的 creation revision。這些是可用原語，不是「所有外部檔案寫入自動被 fence」的產品保證。外部資源仍須把世代檢查與受保護寫入放在同一不可分割的判斷邊界；單在 worker 寫前檢查會留下檢查後暫停的窗口（設計推論）。

## 篇章來源地圖與查證限制

以下為規劃對照，非獨立審查結論。01–04 已有 failure／idempotency／overload／clock 來源；07–11 已有 Dynamo、CAP、FLP、DLS、Raft、Chubby；13–16 已有 Gray/Lamport、Saga/outbox、Kafka、CRDT。18 是自創整合案例，需逐項引用上述邊界，不能包裝為實際部署。

| 篇章 | 已核對的支撐與仍需深入的範圍 |
| --- | --- |
| 05 一致性 | [Herlihy、Wing（1990）](https://www.cs.cmu.edu/~wing/publications/HerlihyWing90.pdf) 已讀摘要，定義操作在呼叫與回應間瞬間生效；[Terry 等 session guarantees 原文 HTML](https://www.cs.cornell.edu/courses/cs734/2000FA/cached%20papers/SessionGuaranteesPDIS_1.html) 已讀摘要與 guarantee／availability 限制，四保證不等於全域交易隔離。[Lamport（1979）循序一致性作者頁](https://www.microsoft.com/en-us/research/publication/make-multiprocessor-computer-correctly-executes-multiprocess-programs/?lang=ja) 僅確認索引與說明，正文定義仍需讀 PDF。[Ahamad 等 Causal Memory 作者出版索引](https://sites.cc.gatech.edu/people/home/mustaq/pubs.html) 僅索引，未核對原論文形式定義。最終一致性的明確收斂前提可先用 CRDT／Dynamo，但勿說所有 eventual store 都是 CRDT。 |
| 06 複寫 | [PostgreSQL 18：Warm Standby](https://www.postgresql.org/docs/18/warm-standby.html) 已讀 Streaming／Synchronous Replication：預設非同步可能在 failover 遺失已提交但尚未傳到 standby 的交易；`remote_apply` 額外等待重播。提升誰、等待 remote write／flush／apply 都要按配置區分，不能只用同步一詞概括。 |
| 12 搬遷 | [FoundationDB 論文](https://www.foundationdb.org/files/fdb-paper.pdf) 已讀 DataDistributor／Storage System 對應段，支撐 storage team 與重新分配資料；[Spanner 作者出版頁](https://research.google/pubs/spanner-googles-globally-distributed-database/) 僅確認索引，尚未讀 directory movement 原文。2026-11-05 新增 MongoDB 官方搬遷流程對照；正文的路由版本、持久入口封閉與所有權切換明示為自創設計，詳見下節。 |
| 17 觀測與 checker | [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/) 提供關聯資訊，不直接證明業務操作只做一次；[Jepsen checker 官方 API](https://jepsen-io.github.io/jepsen/jepsen.checker.html) 依 model 檢查 history。2026-11-05 補充核對並完成正文，明確分開操作結果未決與 checker 的 unknown；詳見最後一節。 |

未查驗任何實際服務的配置、SLA、效能或故障測試結果；未重建各論文完整證明。Saga 原始論文的 Princeton 下載頁本次回傳 403，因此上方使用官方工程模式文件，不冒稱已讀原始論文。上述僅索引來源可作後續閱讀入口，不可當成本次已完成該篇深度查核。

## 第三階段 09–12：研究交付與主編查核

2026-11-05，以 Orca 終端執行 agy，委託搜尋一手來源、整理主張與前提，並起草 09–12。主編另行讀取來源、檢查故障歷程並整稿；以下是採用的查核結果，不將研究代理自述的「已查驗」直接當成證據。正文沿用文章匯出服務，沒有執行實體部署、Raft 實作或故障注入。

| 篇章 | 本次核對的來源與範圍 | 採用的論述與限制 |
| --- | --- | --- |
| 09 共識與 FLP | [FLP（1985）](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf) §1–3、Theorem 1；[DLS（1988）](https://groups.csail.mit.edu/tds/papers/Lynch/jacm88.pdf) 摘要、§1；[Raft](https://raft.github.io/raft.pdf) §2、§5.2、§5.6 | 區分常見共識規格與 FLP 較弱的非平凡性條件；FLP 針對完全非同步、確定性、可靠訊息與至多一個停止故障，排除所有容許執行都終止的保證。DLS 的兩種時序前提分開交代；Raft 隨機選舉不等同完全非同步下無條件終止。未重建完整證明。 |
| 10 Raft | [延伸版原文](https://raft.github.io/raft.pdf) Figure 2、Figure 8、§5.1–5.4、§8；[Ongaro 博士論文原作者儲存庫](https://raw.githubusercontent.com/ongardie/dissertation/master/stanford.pdf) §6.3–6.4.1 | 已下載原 PDF 並讀相關文字，核對任期與持久狀態、日誌新舊比較、current-term 多數提交與舊任期間接提交、讀取的新一輪多數確認及 apply 水位。持久化不指定唯一系統呼叫；去重與 lease read 的額外前提分開說明。 |
| 11 鎖與 fencing | [Chubby 原文，Google Research 目前下載連結](https://storage.googleapis.com/gweb-research2023-media/pubtools/4444.pdf) §2.4 Locks and sequencers、§2.6 API、§2.8 Sessions and KeepAlives | 已讀 sequencer 的鎖名、模式、generation 與接收端驗證責任，並核對 lock-delay 的不完美性。最高已見世代、原子比較、世代登記與不可覆寫輸出加指標是自創設計推論；不將其宣稱為任意物件儲存的原生保證。 |
| 12 分片與搬遷 | MongoDB 官方 [Sharding](https://www.mongodb.com/docs/manual/sharding/)、[Shard Keys](https://www.mongodb.com/docs/manual/core/sharding-shard-key/)、[Ranged Sharding](https://www.mongodb.com/docs/manual/core/ranged-sharding/)、[Hashed Sharding](https://www.mongodb.com/docs/manual/core/hashed-sharding/)、[Balancer](https://www.mongodb.com/docs/manual/core/sharding-balancer-administration/) 的 Range Migration Procedure | 已核對鍵分布與範圍查詢取捨，以及來源受理操作、初始複製、同步變更、位置更新與來源清理的責任。官方浮動 manual 查閱時顯示 9.0 Current，不標成已固定驗證 8.0。正文不依賴產品錯誤碼或內部 epoch 格式；e、p、p* 與停止舊寫入的恢復協定全部明示為自創。 |

### 校稿時排除或改寫的內容

- agy 初稿把 FLP §2 直接寫成較強的「決定必為提案值」定義，並用未指定演算法的「接到相反訊息便重回雙價態」表格充當證明直覺。正文改為分清定義版本，使用延遲觀測例子，明說它不是形式證明。
- 研究稿將 Chubby §2.8 誤標為 Master failures，並列出不存在的 §4.3 Fencing；按原文改正。研究稿也有把 failure-detector 論述錯連到 FLP PDF 的情況，未採用該引文。
- 排除「隨機選舉逾時本身保證完全非同步下有限時間終止」、「永久絕不遺失」等超出模型的說法；Raft 正文補上儲存、故障與讀取前提。
- 排除「S3 自訂 metadata 的數字可直接原子比較大小以拒絕舊 token」的例子；沒有對應能力證據，改用明訂資源端原子能力的抽象模型。
- 排除未固定版本的 MongoDB 錯誤碼、將 hash 說成負載必然均勻，以及把一般搬遷推演寫成產品內部協定的說法。採用的產品對照只到官方文件實際描述的責任。

以上校稿是內容與來源檢查，不能代替實際叢集測試，也不聲稱各論文完整證明已經獨立驗證。

## 第四、五階段 13–18：分篇研究與主編查核

2026-11-05，續補六篇。agy 改以每篇獨立新任務、最多三篇並行，每篇先保存來源筆記再起草正文，CLI 每篇時限六分鐘；另有本地程序群組的終止上限。六個任務均以 exit 0 正常結束，來源筆記與草稿皆交付，未因逾時重跑已完成研究。主編逐篇核對來源、檢查反例與模型，再改寫為公開正文；代理聲稱的 HTTP 狀態或章節名稱不直接當成查核結論。

| 篇章 | 主編實際核對的一手依據 | 採用範圍與限制 |
| --- | --- | --- |
| 13 原子提交 | [Gray、Lamport 技術報告](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-2003-96.pdf) §2–3；[PostgreSQL 18 PREPARE TRANSACTION](https://www.postgresql.org/docs/18/sql-prepare-transaction.html) Description、Notes | 已下載並閱讀論文相關段落；區分預備、持久決策、恢復與可能阻塞。提交後的故障不能回溯強制 abort，日誌缺失也不能冒充權威的未提交證據。產品對照固定 18，不沿用代理將浮動 current 標成 17 的記錄。 |
| 14 Saga | [AWS Saga orchestration](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html) Issues and considerations；[Microsoft Saga](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga) 的兩種實作方式；[補償模式](https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction) Solution、Problems and considerations | 核對局部交易、缺乏全域隔離、冪等及補償失敗與人工介入。沒有宣稱本次讀完 1987 Saga 原論文；未採用代理未能由可讀原文支持的節次與 ACD 簡寫。單據與重複釋放反例為自創設計。 |
| 15 Outbox／Inbox | [AWS Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) Motivation、Duplicate messages、Using an outbox table；[Kafka 4.1](https://kafka.apache.org/41/design/design/) Message Delivery Semantics、Using Transactions | 核對發布窗口、重送、offset 與輸出共同提交，以及外部目的地需要配合。Inbox 交易與識別範圍是明訂的應用設計，詳細資料庫案例連回既有事件主題；不保證任意外部效果一次，不指定通用 TTL。 |
| 16 CRDT | [Shapiro 等 RR-7506 原報告副本](https://perso.lisn.upsaclay.fr/mbl/ENS/CSCW/2021/papers/CRDT-study11.pdf) §2.3、§3.1.2、§3.1.4、§3.3.5 | web 抓取失敗後，以正常 TLS 下載原 PDF 並擷取文字核對。區分 CvRDT／CmRDT 的交付條件、G-Counter 合併與業務去重、操作型 OR-Set 語意與非負計數器限制。不採用沒有額外前提的「有界資源在所有 CRDT 中不可能」推論。 |
| 17 觀測與驗證 | [OpenTelemetry Context propagation](https://opentelemetry.io/docs/concepts/context-propagation/)；[Jepsen checker API](https://jepsen-io.github.io/jepsen/jepsen.checker.html) Checker、check-safe、linearizable；[FoundationDB 原論文](https://www.foundationdb.org/files/fdb-paper.pdf) §4 | 核對關聯資訊、模型查核、未知結果與確定性模擬的範圍。FoundationDB PDF 已下載並讀取相關文字。線性一致性反例以操作區間逐步檢查，不偽造執行過的 checker 輸出；未執行 Jepsen 或模擬。 |
| 18 匯出整合 | [AWS 冪等 API](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) 的識別、原子紀錄及晚到請求；AWS Outbox；前十七篇已界定的保證 | 整體設計為自創推演，從單資料庫與背景掃描開始，說明何時增加 broker、複寫或分片。不可覆寫候選檔與原子發布指標是所需能力與設計前提，不把 S3 首頁當成此模式的原生保證。 |

### 本批排除的錯誤推論

- **2PC 等同線性一致或全域可序列化**：提交與隔離分開，沒有採用草稿的混合比較表。移除不含完整協調與業務條件的 SQL 執行範例。
- **Saga 的合理首次釋放被說成侵害另一份配額**：逐步重算後原例並未證明錯誤；改為「首次補償成功、回應遺失、新工作保留後又重複補償」的真正反例。不要求以帳戶全域世代拒絕所有舊保留的正常清理。
- **Outbox 自帶保序，或所有唯一鍵錯誤都表示已處理**：改為檢查發布與消費順序、版本、已提交去重證據及真正的約束來源。刪除盲目按事件時間丟棄舊資料的通用建議。
- **純量 max 不是合法收斂合併**：max 可以形成收斂型別，錯在不符合獨立增量累加的語意。配額反例只否定特定的本地扣減設計，保留預分配權利等方法的可能性。
- **A 的寫入逾時、B 寫入成功、後讀到 A，就必然違反線性一致性**：未決 A 可以在 B 之後生效，此歷程未必違約。正文加入已完成 A、再開始 B 的不同歷程作對照；同時分清操作未知與查核結果未知，沒有規定每個 timeout 都使 checker 回傳 unknown。
- **同一 seed 可在任意系統百分之百重播，或可窮盡所有狀態**：補上版本、配置、模擬範圍與有限探索限制。
- **整合案例以固定天數刪檔、固定次數轉死信，或把 job ID 填入 traceparent**：移除沒有需求依據的門檻；清理核對引用與活動狀態，業務識別用應用關聯欄位保存，保留 TraceContext 的格式與責任。

全十八篇的正文已完成，但只做來源查證、算例與歷程校稿。沒有因此宣稱各協定已實作、實際部署通過驗收，或全部形式證明已獨立重建。
