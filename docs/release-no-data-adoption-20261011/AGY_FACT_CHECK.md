# Antigravity 第八轮设计意见核对

2026-10-11。真实调用 `C:/Users/86137/AppData/Local/agy/bin/agy.exe`，同一 conversation `77746d92-0c01-4277-93d3-b17e494b3ae2`；本轮 82.771 秒、exit 0、SUCCESS。原 stream、stderr、prompt、逐轮计时和完整 response 保存在 `E:/codex-artifacts/release-no-data-adoption-20261011/`。模型只审查提供的自包含设计文本，没有自行读取源码或执行测试。累计会话时间/usage 不作为本轮成本。

## 接受的设计约束

精确来源凭据只绑定源、原始准备 identity 和已存在的实际前驱，不能反向包含待生成 manifest/plan/receipt 的摘要；否则形成循环哈希。CLI 文件与摘要必须成对、只供在线准备；禁止裸 source-root 或测试路径开关用于生产。manifest、plan、receipt、batch 和 collector 必须保持同一来源，缺项/摘要失配/现场漂移拒绝，不能回退固定根。路径比对保留大小写不敏感、分隔符边界、祖先及子目录排除、实际路径及链接检查。

来源凭据是完整性绑定，不能证明无数据影响、批准生产或允许执行任意来源代码。首次采用规则/准备机制本身仍按已有严格/full 方案准备，不用尚未采用的自身结论减免。

## 分歧与纠正

1. 模型标题将链高度 219 与 WAL `5289afac…` 混写。实际 release chain 为 219 / `aaf62994c75c3ca46362328fed6acc76f812808a2e852566782e5e0ba897e0d9`；AB WAL 为 109 / `5289afacafc13d0fe36e10c0b3df7ae7811e59616827f24565761b0079abd11f`。这是两个独立对象。
2. 模型示意将 `predecessorChainStateSha256` 写作 approvedPlanSha256。实现应使用原 resolver 的 chainStateSha256，不替换含义。
3. 模型建议剔除临时路径等环境指纹噪声。当前任务不按推测删减 identity，保留原全部非源码输入；不相等就拒绝资格或报告缺口。
4. 模型称必须四个数据库阶段是对本次首次采用沿用严格流程的建议，不是模型可设定的生产授权。是否执行仍由最终精确范围批准；本次不执行生产备份或恢复。
5. 模型禁止未另批时生成候选/批次，与用户明确授权的候选准备冲突。继续已授权的不可变候选和可审查批次准备；生产维护、切换、调度、备份恢复及业务写入仍待另批。
6. 专有 namespace 不能自动解决旧消费者 exactKeys 兼容性。须核对实际消费者及原验证器调用链，用隔离兼容验证证明，而非按模型假设宣称通过。

负例矩阵纳入验证计划，最终结果以实际源码/实物与原日志为准。原输出保留，不回写模型错误。

## 第九轮最终源码审查

真实 AGY 调用 exit 0 / SUCCESS，144.158 秒；自包含精确最终补丁 `47d73bc4…` 和实测事实输入。仍未由 AGY 自行读取源码或执行测试。原文及 stream 在外置 `AGY_ROUND9.*`；主代理已在最终限定源上实跑 23 项来源契约，并核验补丁修改块及相邻上下文，结果不以模型赞同替代。

接受其实际旧 Django 消费者阻断：仅切换 Worker 会使旧 verifier/resolver 无法验证新 head，必须有已审查的工具包更新及阶段绑定。继续使用原 PrepareApp/DeployApp，业务后端/配置/Drizzle/依赖逐字节保持，只变两份必要工具；新 Django manifest 必须明确列入首次范围。

以下建议或结论不采纳：

- 将侧文件校验改成 `.trim()`。原 producer 明确发布 `SHA + LF` 原字节；外部脚本改成 CRLF 是证据漂移，拒绝符合用户要求。不能为了格式宽容削弱原契约。
- 在纯 metadata parser 一律拒绝 `~`。真实源读取/prepare 用原 realpath、全祖先 reparse 及物理双向包含检查；纯 parser 不授予准备、执行或无数据资格。合法文件名含 `~` 不等于短别名；8.3 独立实测仍标未测。
- “备份与守护大面积崩溃”。实际 Backup 捕获 release-retention failure 并单独记录，不能从此推断整个备份或服务已失败。未运行新生产备份。
- DAG 写成 Envelope→Plan→Receipt→Manifest。实际是 source/identity→Envelope→Manifest→Plan→Receipt→Batch；均为单向，没有循环。
- “两个制品随四 DB 阶段原子生效”。现有引擎逐步执行且每份 guard 文件原子安装，整体由栅栏、维护、所有权、阶段绑定和失败记录保护；不是跨组件/数据库事务。不会为满足模型措辞重写生命周期。
- “所有准入均直接调用 verifyBoundWorkerSource”。session 路径由原 readSourceTree/safeRead 逐字节检查源码，safeRead 仍拒绝硬链接和真实路径漂移；不能把测试 seam 或纯校验描述为生产执行。

首次切换顺序及回退还须独立核对：提前部署新 Django verifier 会因自身可信字节与旧 head 不同而拒绝；新 Worker 后旧 Django consumer 又不兼容。应在原完整维护窗口内按确定阶段完成两者，中间没有 Backup/retention 步骤，现场仍核对暂停调度与其他所有权，不自行改调度。新协议进入历史后不能直接回装不识别它的旧 resolver 或宣称原 AB 包可直接启动；保留历史、使用兼容回退及严格/full 降级方案。

## 第十轮新增资格、时效与存证边界

真实 CLI exit 0 / SUCCESS，147.050 秒；完整四模块开发 diff 文本复审，没有本机文件读取和测试。前轮两份 sourceBinding 工具字节未变，不重复背书。原输入、stream、stderr、result、call 和主任务机器事实核对文件保留在同一外置根。

接受其有限结论：限定迁移闭包资格没有改变 strict/full 四阶段，完整库存、现场 CF 全字段及自身执行字节检查保留；末动态时间、三项 provenance 重核和同级观察存证修复方向正确。模型未发现本提示范围内阻断，不等于所有反例已穷尽。

纠正：其“100% 拒绝”“数学完备”等绝对措辞没有证明依据；2933 是本次真实 Django 包的数量，不是通用资格硬编码；“Cleared”不授予权限，准备已有用户授权，生产仍另批。187 项包含 21 个未进入运行包的离线用例，不能称最终候选 187 项通过。PG 实际恢复、生产配对收益及真实不可用窗口未测；原 72 秒私有循环的观察存证替身覆盖缺口不能由该模型结论消除。

主任务独立源差异检查首轮因不同前驱 catch 块的编辑分段失败，原 verifier 与失败保留。修正只对 collector 采用最终开发内容与限定源全文相等、并精确核旧 import/catch 两处差异；其余五文件仍逐块/上下文核对。所有准入都使用原始字节 SHA，未改候选来适配断言。

## 最终具体范围及引用边界（真实CLI11～13轮）

第11轮78.175秒指出8.3未测；第12轮73.589秒接受同驱short resolver，但“其他驱动在数学上不能到D”错误。主任务提出跨盘junction及长junction反例，Astra用原V3实际函数复现四个漏检并修V4；原72a字节不动，V4独立04655a，16VM通过。主任务实际V4 physical resolver+1160个安全JSON读取+818进程/215任务预检通过；不是任意脚本/相对/变量/编码/UNC或所有handle的通用证明。

第13轮77.557秒认可上述纠正，未发现提示范围内新阻断，但继续出现事实错误，原文保留。实际guard是async realpath/readFile及readonly PS spawnSync，不是它编造的sync/exists算法或“没有任何进程调用”。真实标准collector约276秒是在当前实际runtime/source/head/candidate做只读复验，不是VM；VM六反例是另一组。新scope是20操作/strict-full，旧AB109只是前驱历史，不能泛指新scope所有WAL。

它擅自补全了错误的Worker receipt、Django manifest及PreparedApp长digest；实际PreparedApp是32hex，不是64。所有授权及执行输入只使用原生产者/主任务实读元组，见[CANDIDATES.md](CANDIDATES.md)及机器AGY_FINAL_FACT_CHECK。固定95331脚本是原deployer执行器，部署目标是runtime app/app.deploy，不是该检出。model的“允许Git”“Cleared”“完备”都没有操作权限效力。

最终源码/包不因这些模型错误再改字节或借模型签名。真实验收绑定最终166包内用例、标准现场只读验证、私有实际CSS循环及完整perform/wrapper成功/失败WAL续读；明确测试依赖映射和fixtureplan不是生产typed plan。生产切换、PG恢复、完整C生产验收和配对收益仍未执行/未测。
