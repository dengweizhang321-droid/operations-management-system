# S05d/S05b 四步执行记录

日期：2026-10-23。**隔离候选交付，S05d / S05b 仍阻塞，不具备现场执行条件。** 最新用户授权和简化检查要求见 [AUTHORIZATION.md](AUTHORIZATION.md)。本记录不是控制操作回执。

## 本轮结论

按用户最后要求收敛到关键工具审查和一轮现场只读核验，复用已有隔离结果，停止追加测试、兼容家族或性能改造。新增代码、受控入口、采用次序与拒绝条件已保存在独立工作树；**未采用控制包、关闭来源、封存、写 resolution 或重启 Windows**，也未准备制品或上线。S05c 和 B1 的有效结果直接复用。

- 已证明：当前关键增量的只读调用无生产写；32 件控制包成员的现有 4 项隔离检查通过。冻结代码、此前各项实际检查与局限见 [实现记录](IMPLEMENTATION.md)、[代码摘要](current-handoff-pins.json)、[包检查](bundle-checks.json)及[独立审查](REVIEW.md)。私有完整集成已跑通，但其 boot/token/CIM 等替身不代表现场退休。
- 真实核验：最后一轮在 **54.497 秒**拒绝，33 件固定工具和实际入口 SHA 均保持，尚未形成完整 observation，最终 closure CAS 未执行。拒绝为 `Frozen source identity reader changed`，见[全部轮次原件索引](native-collector-trials.json)。
- 精确兼容缺口：旧 `publish-main` 的 `228e1512…2063` 家族在至少 22 个规范路径使用 guard `b4bb57df…1f9c6`，当前新规则只资格化 `c0b4f216…b882`。首例为 `D:/codex-isolated/auto-wake-control-c36ea996/source/tools/frozen-main-source.mjs`。见[窄叶定位](source-guard-rejection.json)：只读 3.11 MB、2.680 秒；输入含斜杠表示重复，原 25 行对应 22 个规范路径。**尚未审定该版本的行为，不能仅补 SHA 白名单放行。**
- 代码与现场剩余缺口：sealed reader 在全量档案读取后仍缺 closure 与全部档案的统一末次 CAS；完整来源/工件清单及范围尚未闭合；真实快照/统一 CAS 吞吐、普通写者原生准入、来源关闭后的完整 boot 和两轮独立观察均未取得。不能把只读入口和包可加载称作恢复 writer 就绪。
- 原件保护：212 件 queue 原件逐长度/SHA 不变，四域文件数仍为 212、没有新增，见[结束核对](queue-originals-after.json)。原 unknown、失败与历史证据保留；原两个 decision 未放宽。

下一步只需先解决上述明确缺口，不能按本轮草稿直接采用或重启。实际采用顺序仍是“已审控制包 → 原生 plan / source-close → 关闭后的完整 boot → 退休后对账/封存 → 原生 reader”，具体参数见 [HANDOFF.md](HANDOFF.md) 和 [LIVE-RUNBOOK.md](LIVE-RUNBOOK.md)；这些命令尚未执行。当前不进入 S05b。

## 本轮各阶段实际止点

1. 旧入口/旧工件寻址隔离：已完成私有旧 Django PS5/PS7 及部分 Worker 原生边界检查；完整来源/工件 collector 和恢复编排仍在实施与独审。
2. 退休、对账、封存工具：入场拒绝、原生 Git relocation、完整 boot 观察等模块已有隔离证据；尚未形成可供生产执行的完整冻结控制包。
3. 现场清单：用户已确认当前没有不可中断工作，可在工具就绪后安排必要完整重启。具体已采用版本/intent/关闭来源清单尚未生成，不能提前重启。
4. S05b：未开始。没有控制采用、来源移动、任务变更、重启、真实封存或 queue resolution 写入。

## 本轮已经取得的新事实

- 原生元数据有界枚举 2,390 件、5,726,323 字节。首次触及 2,048 对象上限后停止；先只查规模，再把对象上限改为 3,072，字节上限仍为 24 MiB。见 [预算与采集](metadata-read-budget.json)。未读生产载荷或秘密配置正文。
- 新闭包所需的 60 个 packet 在固定元数据层另有 930 件 JSON、1,901,151 字节；合计对象数超过原 3,072 上限。见 [packet 预算依据](packet-metadata-budget.json)。此次只查文件属性，未读 source、构建载荷或日志正文；新 collector 因此分域设定有限预算，原 queue 的 1 MiB reader 不变。
- `releases/20261022T071208Z-f5db87473edebc45/deployment-manifest.json` 的原 source-binding 指向 a3 packet/source，内容树亦相符。**缺 packet worker-plan 不代表共享候选不存在。** 见 [结构化引用观察](candidate-reference-observation.json)。该观察不替代完整 native 消费/载荷资格。
- Git 注册的精确 `36668589` 来源共两处：原 packet/source 和 `D:/codex-worktrees/merge-20261022`；两者 tracked clean，原 packet/source 有 Git lock。固定默认集成源则是不同 HEAD/不同已知源码字节。见 [注册来源](registered-sources.json)、[默认来源](default-source.json)。是否可移动仍需正式 collector 与现场准入。
- 实际原生 boot collector 首轮因 helper 名 `H` 与 PS5 内置 `h=Get-History` 别名碰撞而拒绝，未产生退休观察或现场写入。改为唯一长函数名、独立增量核验后，真实只读 collector 兼容检查通过。见 [首轮拒绝](native-boot-first-rejection.json)、[实际 parser 检查](native-boot-parser-check.json)。当前 boot 仍为 2026-10-17，不能退休 a3。
- 完整 closure collector 的前三次真实只读兼容检查均保留拒绝原件，见 [检查记录](native-collector-trials.json)：首次发现旧 native 没有导出假设的 inventory API；第二次遇到历史 packet 的正常诊断目录形状；第三次在提前的目录检查中发现缺 request 的历史 packet。均没有取得完整闭包、建 intent 或现场写入。修复仅限新工具适配，不改旧 native 或放宽原两条 decision。
- 原 `prepareLatestMainOnce` 先建立 source/worktree、处理 schema，最后才写 request；现场 12 个无 request packet 有 11 个仅 source、1 个 source 加空 schema。见 [直系形状](pre-request-packet-shapes.json)。它们仍须核注册/实际字节及引用，不能以缺请求推定零作用。
- 固定普通权限 handoff 在真实 OS 叶读取时发现 System32 PowerShell 原生 nlink=2；仅固定系统宿主角色适配并独立增量检查，其他代码/材料/回执保留单链接约束，见 [宿主证据](handoff-checks-system-host.json)。没有注册或运行真实 Task。
- 现场 queue 的 tickets/dispatches/results/resolutions 共 212 件原件已按相对路径、长度、SHA 保存[写前摘要](queue-originals-before.json)，用于后续保护核对。源码交付和实际协调的结果分别记录，不把新增恢复记录冒充原 unknown 被改成功。
- 第四次真实只读检查在 3.155 秒因 publication lease 文件存在拒绝。现场唯一该类残留指向原 a3 的 target/out，状态停在“构建前端”，租约已过期；见 [原租约观察](original-release-lease-observation.json)。旧 workflow reader 将过期租约视为无有效准入提示，不能据此证明原进程已退休或没有迟到作用。须依真实生产者语义保全和纳入对账，当前未删除、解锁或改写它。

该租约 [418 字节原件副本](original-release-lease.json)已按 SHA 核验保存在任务证据中，生产原文件仍原位。新 collector 对此角色记录原 raw/SHA 和绑定，不将租约过期作为退休证明；对应增量仍须独审与真实只读兼容检查。

第五次真实只读核验使用已审 collector/source 增量，诊断上限 120 秒、Node heap 512 MiB、每 5 秒记录 RSS；没有修改封存协议的动态时限。它在 46.934 秒因某受保护历史 release 未取得实际来源区别见证而拒绝，尚未输出完整闭包。具体 release、是否真正原来源及历史目录角色仍待定位；不能将这个保守拒绝直接写成“原 a3 已消费”，也不能略过它继续采用。

随后仅用已核三件旧 native 读取消费链投影并查询 source-snapshot 目录形状，3.211 秒完成。head 与 chainStateSha256 均严格等于原 dispatch 的前驱锚点；262 个历史 release 中 221 个已无 source-snapshot，bootstrap 正是排序最早的 `20260829T194525Z-9a33f178481e6c8e`。见 [消费链形状](protected-history-shapes.json)与[bootstrap 目录/manifest 观察](historical-release-shape-observation.json)。该 manifest 仍声明源码副本，不能仅凭目录缺失或不同 manifest 宣称零作用；其实际保留 helper、支持的来源/消费地址和最后动态复验仍需资格化。

另对 141 个注册 Git 根和 41 个保留的历史 snapshot 仅读取两类发布入口代码，合计 4,978,004 字节、0.476 秒；得到 publish-latest-main 15 个、publish-main 8 个实际字节版本，见 [入口投影](source-entry-cli-projection.json)。独审发现部分旧 latest 入口没有控制代际门禁；保留原分支只能阻挡同一前驱下的重复创建，不能单独证明永久闭锁。实施者以真实旧入口和私有原生 Git 复现了 advanced predecessor 下可重新检出的反例，并测试严格 native manual-main 命名空间的 prepared 阶段拒绝（普通 codex 开发分支不受影响）。此规则尚待完整 installer/bridge、实际有效 hook 路径与后续动态校验集成及独审；生产 hook 未修改。

沿同一来源列表另仅读取 installer 共 2,463,922 字节、15 个字节版本，见 [installer 投影](installer-entry-projection.json)。历史版本在写前拒绝非空 hooksPath，正在据此验证“显式绑定到同一现用 common/hooks 目录”的有限保护及在途旧安装器/旧材料的拒绝顺序；不是关闭或绕过 hook。现场[写前路径证据](git-hook-path-before.json)确认当前有效文件与安装记录一致、未设置 core.hooksPath、worktreeConfig 已开启；合法的 worktreeConfig 开启不被当成规避。

已消费历史目录的有限适配叶及其隔离检查已独审收口，详见 [HISTORY.md](HISTORY.md)；完整 collector、hook/installer 过渡、封存 writer/reader 集成尚未完成，因此没有新的现场就绪结论。

第六次只读采集在 120 秒诊断上限结束，33 件工具前后 SHA 不变、RSS 峰值约 262 MiB，但无完整闭包；不能据稳定内存宣称完成。第七次从逐 SHA 核验的私有固定代码副本运行，仍为 120 秒/512 MiB，并仅将阶段回调落到私有 artifact。276 件诊断事件定位到逐 release 检查的线性开销：约 100.4 秒时为第 93/328 件，117.685 秒时为第 120/328 件，相邻历史项约 0.61 秒。该轮同样未完成，固定副本及实际 publisher/installer 原字节未漂移。

下一步仅分析同一次采集内可复用的目录/策略检查或有界并发读取，保留每叶实际 SHA、签名和最终成员复验。诊断预算与 writer 的 20 分钟 epoch、最终 60 秒门禁分别处理；真实 archive 与最后轻 CAS 吞吐尚未验证，不能以延长诊断代替现场 writer 就绪。

随后三处已知缺 snapshot 根的有界只读测量找到了实际重复工作：`maxFiles=64` 只计存在叶，缺根仍各发出 9,653 次 lstat，耗时 799–836 毫秒；一次缺根检查仅需一次 lstat。见 [2.60 秒诊断](history-missing-root-profile.json)。测量只取原 Git 文件名，不读载荷或历史工具正文，不构成历史资格；修正仅跳过无意义的逐叶寻找，仍须完整历史资格、实际工具 SHA 和最后成员复验。

完整隔离 writer/reader 组合已由实施者跑通，正在独立审查：真实私有文件、Git 移址和 immutable evidence，覆盖观察者失败后同 intent 新 epoch、封存读取、resolution 指针中断续接与来源重现拒绝。OS boot/token/chain/CIM 为明确测试替身，不能据此认定现场已经退休。实现细节见 [实施记录](IMPLEMENTATION.md)。

## 工作区及边界

工作树 `D:/codex-worktrees/s05d-retirement-implementation-20261023`，分支 `codex/s05d-retirement-implementation-20261023`。从已核远端 main `36668589` 建立，再快进复用 `6d8efc50`。没有 fetch/推进 origin/main，hook 保持启用；主检出既有改动保留。

本机 `core.autocrlf=input` 会在暂存时归一 CRLF；为保留已经核验的原字节摘要，本次仅给新增 retirement 工具/runner/测试、精确测试 helper/原始夹具和本任务证据目录设置 `-text`。没有更改全局 Git 设置。提交前核暂存对象与实际证据/工具原字节一致。

本轮按原 target/source/工件引用闭包实施，不禁绝所有历史工具，不重放旧 target，不伪造 FAILED/SUCCESS，不放宽旧两个 decision 或历史 reader。当前不同来源的有效运行版本保留。原生操作由主负责人串行；子代理只做隔离实现/规划/审查。

详细设计见 [PLAN.md](PLAN.md)，独审结论见 [REVIEW.md](REVIEW.md)。本轮交付停在隔离候选与明确阻塞；现场材料和原生回执未生成，不预填成功。代码与证据仅提交/推送独立开发分支，不推进 main；精确提交与推送结果记录在外部任务 artifact 的 `delivery.json` 和交付答复中。
