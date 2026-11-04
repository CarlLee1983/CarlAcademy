# 分散式系統：寫作證據與來源

查核日期：2026-11-04。本文是文章作者用的一手來源筆記，非實驗報告。以下論文模型、歷史系統設計、產品文件不得互相替代；教學中的訂單、付款案例應明示為推演。

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

## 後續章節來源地圖與規劃缺口

以下為規劃對照，非獨立審查結論。01–04 已有 failure／idempotency／overload／clock 來源；07–11 已有 Dynamo、CAP、FLP、DLS、Raft、Chubby；13–16 已有 Gray/Lamport、Saga/outbox、Kafka、CRDT。18 是自創整合案例，需逐項引用上述邊界，不能包裝為實際部署。

| 篇章 | 已核對的支撐與仍需深入的範圍 |
| --- | --- |
| 05 一致性 | [Herlihy、Wing（1990）](https://www.cs.cmu.edu/~wing/publications/HerlihyWing90.pdf) 已讀摘要，定義操作在呼叫與回應間瞬間生效；[Terry 等 session guarantees 原文 HTML](https://www.cs.cornell.edu/courses/cs734/2000FA/cached%20papers/SessionGuaranteesPDIS_1.html) 已讀摘要與 guarantee／availability 限制，四保證不等於全域交易隔離。[Lamport（1979）循序一致性作者頁](https://www.microsoft.com/en-us/research/publication/make-multiprocessor-computer-correctly-executes-multiprocess-programs/?lang=ja) 僅確認索引與說明，正文定義仍需讀 PDF。[Ahamad 等 Causal Memory 作者出版索引](https://sites.cc.gatech.edu/people/home/mustaq/pubs.html) 僅索引，未核對原論文形式定義。最終一致性的明確收斂前提可先用 CRDT／Dynamo，但勿說所有 eventual store 都是 CRDT。 |
| 06 複寫 | [PostgreSQL 18：Warm Standby](https://www.postgresql.org/docs/18/warm-standby.html) 已讀 Streaming／Synchronous Replication：預設非同步可能在 failover 遺失已提交但尚未傳到 standby 的交易；`remote_apply` 額外等待重播。提升誰、等待 remote write／flush／apply 都要按配置區分，不能只用同步一詞概括。 |
| 12 搬遷 | [FoundationDB 論文](https://www.foundationdb.org/files/fdb-paper.pdf) 已讀 DataDistributor／Storage System 對應段，支撐 storage team 與重新分配資料；[Spanner 作者出版頁](https://research.google/pubs/spanner-googles-globally-distributed-database/) 僅確認索引，尚未讀 directory movement 原文。規劃中的「路由版本＋寫入所有權切換」仍須深入原協定或標為自創設計條件，不能歸於 MongoDB 總覽。 |
| 17 觀測與 checker | [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/) 已讀 traceparent 與跨服務 Trace ID／Parent ID 傳遞段；它提供關聯資訊，不直接證明業務操作只做一次。[Jepsen checker 官方 API](https://jepsen-io.github.io/jepsen/jepsen.checker.html) 已讀：依 model 檢查 history，linearizable 使用 Knossos，結果可為 valid／invalid／unknown；需保留 checker 限制、記錄完整度與測試故障範圍，不能把一次通過外推成所有執行皆正確。 |

未查驗任何實際服務的配置、SLA、效能或故障測試結果；未重建各論文完整證明。Saga 原始論文的 Princeton 下載頁本次回傳 403，因此上方使用官方工程模式文件，不冒稱已讀原始論文。上述僅索引來源可作後續閱讀入口，不可當成本次已完成該篇深度查核。
