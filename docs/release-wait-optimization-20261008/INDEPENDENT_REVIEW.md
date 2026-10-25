# 发布等待优化独立复审

日期：2026-10-08（Asia/Shanghai）。复审者：本任务独立子代理 `independent_review`；未参与实现修改，仅写本报告。来源为当前独立开发 worktree，未调用新生产执行入口、启停生产服务、改变备份调度、写生产数据或发送外部消息。

## 结论

**本轮已发现的问题均已修复，当前复审范围内没有剩余阻断。** 结论允许继续开发交付，不授予生产采用权限，也不替代精确上线批次的现场确认、任务验收及恢复计划。首次采用本轮生命周期与备份实现仍应走严格发布，不能用尚未采用的快路径降低自身保障。

## 发现与修复闭合

| 发现 | 修复及独立复验 |
| --- | --- |
| 展示影响证明与实际完整源码没有关联，部分文件清单可冒充完整范围 | 绑定原 tree fingerprint 与完整 inventory fingerprint；impact proof 保存完整摘要清单及实际变更字节；CLI 重新计算分级和要求。绑定变化、影响证明变更及重新 hash 门禁负例通过。 |
| 必需备份/恢复阶段可用 worker-plan 标签冒占；手写 batch 重算摘要可删必需阶段/验收 | 强制原 operator、Action、结果类型和内容/恢复断言；重新验证完整批次结构、验收覆盖、测试、回滚及阶段。复原必须引用同批已确认 Backup 的点与内容。 |
| batch ID 在 execute/status 入口没有复验，日志可逃逸根目录 | 复验 ID、操作 ID、摘要格式及日志父目录。独立 TEMP 路径逃逸 probe 已被拒绝，未发生越界写入。 |
| `.dev.vars`、外部 npm user/global 配置没有绑定；大型 Node executable 被文本读取上限拒绝 | 配置路径/字节与运行环境进入准备身份；可执行文件改为稳定流式摘要；保留文本证据限制和重解析点/硬链接拒绝。 |
| SQL/model 等高风险内容可降为普通业务分类 | 扩充受保护表面与敏感行为判断；SQL/模型独立负例现均 strict。展示证明仍仅允许有限字面 JSX 差异并要求独立依赖/行为见证。 |
| 日常备份丢失响应后，下一轮生成新 UUID 再次启动备份 | 同一原发布互斥内保留 active 与 started/result；历史缺失或 unknown 拒绝新运行。独立连续 lost-response probe 从底层调用 2 次修正为 1 次，第二次在调用底层前拒绝。 |
| 恢复兼容只查 public catalogue，漏额外 schema 与 large objects；序列耗尽仍被认为健康 | 复用原封闭 profile 范围检查；检查全部 owned 序列集合、正向非循环、下一值大于表最大 ID 且不超过序列上限。对应专项负例通过。 |
| 实际 collector 没有关联当前源码与候选，缺少 Django 前驱，以及允许未确认 successor | 明确 candidate.source tree 等于当前准备身份；绑定 Django pre/candidate 与 PrepareApp receipt；按本批 journal 已确认 DeployApp/唯一 Worker apply 的状态选择精确前驱或后继。 |
| 展示 Worker Stop 本身不会自动排空，可中断 helper 任务 | 新增唯一 Worker 的 BeginWorkerDrain/StopForRelease/EndWorkerDrain。Begin 使用 installed Django 原 Wait-AutomationDrain、原 background/request leases、备份任务及 PG fence；Stop 只接受精确 owner/requests/KeepPG，拒绝 IncludeBackend；原 Start 门禁保持，新 helper 精确 ACK/空闲并运行后才解除 gate。批次强制 drain 与 freeze→stop→唯一 apply→start→unfreeze 顺序。 |
| AggregateStatus JSON 默认深度截断，互斥 busy 拒绝没有持久尝试证据 | 输出使用 Depth 12；新增 `_queue` requested/acquired/blocked。原互斥保持非阻塞，不宣称实现自动排队或自动生产重试。 |

## 独立实际执行的验证

- `node --test tests/release-wait-optimization.test.mjs`：当前最终轮 49/49 通过；覆盖分级、混入风险、证据失效、改 hash 绕门禁、并发/所有权、unknown 不重放、阶段续接与总时长口径。多数操作通过隔离 run seam 驱动，不能冒称生产切换验收。
- `node --import tsx --test tests/release-worker-drain.test.ts`：Windows PowerShell 5.1 / PowerShell 7 共 2/2 通过。使用原 Wait-AutomationDrain、实际 gate 文件与租约路径、原 StopForRelease AST 分支；只替换隔离环境中的进程停止 primitive 和健康响应。验证精确 gate、错误 owner 拒绝、禁止停 backend、原 CancelDrain 清理；不启动正式服务。
- `tests/release-recovery-catalog.test.py`：新增专项 5/5 通过，包括额外 schema/LO 拒绝、序列倒退/ownership/cycle/耗尽，以及实际只读 CLI 目标验证。
- 原 `tests/test_postgres_no_key_backup.py`：7/7 通过；原 `tests/postgres-consistent-backup.test.py`：31/31 通过。使用现有 Python 运行时运行隔离单测，没有连接生产数据库。
- 额外 TEMP probes：手写空批次/路径逃逸/SQL和模型误降级/daily lost-response 连续调用。发现时保留原失败结果，修复后重新验证。
- `git diff --check`：通过。

## 保留能力和边界

源码差异审查确认：原已发布包完整树/helper/合约/guard/硬链接验证、精确进程停止、切换前最终 CAS、D1 退役谱系、activation fence、安装入口、startup binding 与 consumption 仍使用原流程。原 no-key Backup 的 SHARE 锁继续保持；目录提取重用没有删除原全内容、角色/权限、恢复内容及序列下界比较。新增 sequence health 对坏序列失败关闭，不写 sequence、不修生产数据。

标准 collector 使用原 installed Verify/Status 和新增只读 ReleaseEvidence；恢复点须实际现存、摘要与归档可核验、软件/目录/角色/保留/调度兼容。旧恢复 JSON 不能让已淘汰的 dump 获得资格。日常备份暂停或未知不产生成功复用证据，也不自动恢复调度。

排空的动态验证是隔离原函数/分支验证，并非真实生产 helper、n8n 业务、全部 reader/writer 及新旧发布包完整切换。正式采用仍须批准精确批次并完成现场排空、启动与原任务全部验收。collector 与具体业务验收脚本闭包必须在精确批准范围内，不以 covers 标签代替实际业务断言。

隔离性能实验源码已审阅：使用真实 immutable 构建、native pg_dump/pg_restore、小合成库及私有 HTTP fixture。必须以成功结果文件、恢复内容/序列验证及私库清理证据作为闭合依据；当前报告不认证尚在运行的实验结果。该机制实验的一次样本不能推出稳定生产耗时、真实 Worker/Django 停服窗口或 SLA。

本报告完成后，新增业务/实现差异须按实际影响追加验证；文档与报告元数据纳入最终源码/候选摘要绑定。生产动作结果未知仍须对同一操作独立核实，禁止删除 active 或换批次来重放。

## pair-3 实际性能证据与参数修复复核

后续实际实验已闭合，本节补充并替代上节“尚在运行、未认证结果”的阶段状态。

- `pair-2` 的完整 warm verifier 因调用者遗漏 `expectedSourceD1PathSha256` / `expectedPersistRootPathSha256` 被原门禁拒绝，不能计作成功。实现没有放宽原 verifier；修复了 rotation 复用、标准 collector 的内部和 own-verifier CLI，以及实验 warm 调用的绑定参数。前两轮失败日志保留。
- 独立只读核对：生产路径参数均来自已解析、已验证的 `chain.bootstrap.authority`；实验参数来自其独立 `sourceD1` / `persist` 的 `windowsPathSha256`。原 CLI required flag 和内部严格相等检查保持。
- `release-lifecycle-step.ps1` 已核对 UTF-8 BOM（头字节 `EF BB BF`），修复后独立再次执行 PS5/PS7 排空测试 2/2 通过。
- 已读取并交叉核对 `E:/codex-artifacts/release-wait-optimization-20261008/release-wait-pair-3/timing.json` 与 `isolated-pair-3.log`。timing 原始 SHA-256：`f47181af8c73adfe5915b5095b3f469b8a6b10c1fdc8fad920e708a9c0aa1387`。

| 合成批准后区间 | 基线（ms） | 优化（ms） |
| --- | ---: | ---: |
| 总耗时 | 266803.9367 | 47605.2379 |
| 准备／完整复验 | 238553.1570 | 47572.4653 |
| 前备份 | 953.1794 | 本次不生成 |
| 前隔离恢复 | 7084.9664 | 本次不生成 |
| 后备份 | 695.6160 | 本次不生成 |
| 后隔离恢复 | 6217.4672 | 本次不生成 |
| 已有恢复点 dump 字节复验 | 不单列 | 1.2836 |
| 私有 HTTP fixture 切换执行 | 4.0394 | 2.5120 |
| 私有 HTTP fixture 关闭至重新监听 | 3.3812 | 1.9893 |
| fixture 内容验收 | 17.8074 | 13.4646 |
| fixture 收尾内容验收 | 3.0894 | 12.8760 |
| 总时间减已记录阶段之和 | 13274.6145 | 2.6364 |

基线总时间与阶段和的残差约 **13.275 秒**，包含完整准备后的 `afterIdentity` 复验及阶段记录写盘等未独立打点工作；保留原总时长，不伪分配或从总时间删去。优化批准前复用了本次基线实际生成的同一精确制品，所以约 238.553 秒的冷准备属于前移工作；warm 的约 47.572 秒完整身份／制品检查仍在批准后发生。原备份／恢复的本次重复生成在机制实验中省去，而当前生产快路径资格仍须独立满足真实调度、目录、角色、软件和现存恢复点条件。

候选绑定独立检查：

- release：`20261008T143823Z-07cd0a27d3d47d53`。
- manifest 原始字节 SHA：`e984740cba967ebc88bcde22e44acb0733791a8184c793fef86f243d31c706fb`。
- source fingerprint：`a4e35a2de020451cd571e639bb3b0e7a21555ab32bd19a76fa8f8164aafb02d1`；与 timing.sourceIdentity 和候选 manifest 一致。
- build fingerprint：`8f5a3b65840351339e5a69649ab3b542b6ba2884423b2585774f7a6c4b98d944`。
- 本任务 12 个工具／实现文件、4 个实验／排空测试文件及补充的 4 个任务测试文件，与 `source-snapshot-3` 逐文件 SHA 相同。后补任务报告与规范记录变化属于交付文档；实验来源仍是该精确冻结树，不能把其源码 tree hash 改称最终 main 的完整 tree hash。
- 独立再次运行完整 `verifyPreparedWorkerCandidate`，使用精确 manifest SHA、独立 D1/persist 路径批准摘要及隔离 predecessor seam，得到 `preparation_only`；耗时 45009.0994 ms。原始复验结果保存在同目录 `independent-candidate-verify.json`。该复验没有重新构建、恢复私库或生成启动许可；不是生产进程准入。

清理核验：`cluster-source`、`cluster-restore-1`、`cluster-restore-2` 的 `data` 均不存在；三份 PostgreSQL 日志均记录 `database system is shut down`；`fixture-private.json` 不存在。`timing-partial.json` 是逐阶段保全的中间记录，仍标记 `completed:false`，不能单独作为最终结果；正式 timing、通过输出、私库关闭日志与实际目录清理共同证明本轮闭合。

本次是一对、5000 行合成小库、同一实际制品的机制实验。原 pg_dump/pg_restore 和完整制品验证是真实执行，私有 HTTP fixture 关闭／监听差值不等于正式 Worker/Django 停服窗口；没有测得生产 P95，也不推导稳定性能承诺。生产采用仍须重新核验精确生产前驱、准备实际 Worker/Django 发布批次并取得本次授权。

## pair-3 后的批次 tuple 收紧复审

后续仅收紧 `tools/release-batch.mjs` 的批次关系并增加相关负例；这发生在 pair-3 计时之后，**pair-3 的 source fingerprint 不能描述最终源码**。

独立查读确认：worker-plan / 唯一 worker-apply 必须引用 binding 中同一 Worker plan；Django DeployApp 的精确 ID / 收据必须等于批次绑定；所有 drain / maintenance 步骤使用同一批次 owner；RestoreRehearsal 只能引用本批此前已确认的 Backup 目录与 manifest token。原生命周期、构建、候选完整校验及 PG 备份恢复代码未修改。

独立实际重新运行 `node --test tests/release-wait-optimization.test.mjs`：**51/51 通过**。新增负例拒绝另一候选 plan、另一个 drain owner、未来/别点恢复引用、删除 drain 与展示混入 Django；真实独立子进程在 write-ahead started 后 `exit(17)` 留存未决状态，父进程再次 execute 在调用任何 operator 前拒绝重放。`git diff --check` 通过。

在该次 tuple 收紧复核时逐文件核验：pair-3 所用 Worker 构建 / rotation / 生命周期、Django 生命周期 / 维护、PG 完整备份恢复、标准 collector、daily wrapper、lifecycle adapter 以及实验脚本 12 个核心文件仍与 `source-snapshot-3` 相同。此次 tuple 门禁 / 测试改变与后补报告明确列为计时后的源码差异，不将旧候选 manifest 重新标注为最终 main 的新完整制品。

最终批次和测试须以最新源码摘要重新绑定，后续正式候选还须使用实际生产前驱与完整批准范围。本收紧没有放宽门禁，无需为重现同一机制计时再安装依赖或恢复数据库；也不把 pair-3 的合成总时长视为这两处新批次校验的精确延迟测量。当前独立复审范围内无新增阻断。


## 最终序列缓存门禁与基线测试收口

`pair-3` 后还发生了一项 PG 准入代码收紧：`postgres_no_key_backup.sequence_health` 新增 `require_uncached`，目录只读 live probe 显式传 `True`，只允许 `cache_size=1`。查询增加该元数据列，拒绝有会话缓存的 live 序列；已有 ownership、正向非循环、next > 当前最大 ID 和耗尽检查保留。新隔离恢复会话使用默认 `False`，没有把 live 会话缓存限制误套到 fresh restore，也没有修改序列、清空会话或改变生产状态。

独立实际执行 `tests/release-recovery-catalog.test.py`：**5/5 通过**，包含 cache=10 在默认 fresh 模式允许、在 require_uncached live 模式拒绝的负例。与 `source-snapshot-3` 的实际文本差异已逐段核对，确实只有上述参数、查询列、live 限制及调用变化；因此，**当前 PG 准入文件已不同于 pair-3 快照，不再宣称全部 PG 核心源码与其一致**。pair-3 仍是原冻结树的历史机制计时；它没有测得最终新增 cache 元数据读取/门禁的精确延迟。最终源码和候选必须使用新摘要。

独立查读 `tests/module-performance.test.ts` 的修正，并运行该文件：**8/8 通过**。原全文件 `/api/inventory/overview` 字符串计数把手动导出请求也算成自动 tab 加载；当前测试只在 `loadOverview` 到 `loadAgeAnalysis` 的精确 loader 区间计数，仍保留可见 tab、projection、刷新、年龄分析和避免双源并行等原断言。独立从 `origin/main` 读取库存视图，确认 endpoint 字符串也有 2 处；当前库存业务源码未修改，所以不是为通过测试回退业务实现或把“2”改成许可。

完整 unit 首轮失败及测试运行环境补齐由主执行记录保留；本独立专项通过不反推首轮全量成功，也不替代仍在进行的完整重跑结果。该两项收口无新增阻断，本轮未修改实现、执行生产动作或改变备份调度。

## 2026-10-09 Windows 系统 PowerShell 硬链接兼容复审

实际构造执行批次时，系统 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` 的 Windows Resource Protection / WinSxS 合法硬链接被原 `nlink=1` 通用要求拒绝。独立查读本次两文件差异：只允许规范化后的该精确 OS 路径例外；所有祖先/叶子重解析点拒绝、完整流式字节摘要和读取前后 dev/ino/size/mtime/ctime 验证保留，并新增 nlink 稳定比较。普通脚本、临时普通硬链接和其他 executable 路径没有获得例外。

独立实际运行 `node --test tests/release-wait-optimization.test.mjs`：**52/52 通过**。新增测试核对真正 OS executable 的流式摘要等于实际字节 SHA，并在 TEMP 创建普通 hardlink 验证拒绝；本机系统 executable 的 nlink 确实大于 1。`git diff --check` 通过。没有调用 OS host 执行业务动作、修改生产脚本或更改调度。

本修复无新增阻断。此前基于旧源码准备的正式候选不得冒用新门禁/新测试证据；应重新准备并绑定最新源码、依赖、工具链、配置、前驱和收据。pair-3 依然是冻结历史源码的机制计时，不代表本次新文件完整 SHA 或最终正式批准批次。最终验收脚本、批次参数闭包与新的正式候选仍须独立核查。
