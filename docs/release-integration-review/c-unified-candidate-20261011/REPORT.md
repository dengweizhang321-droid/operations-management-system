# C 与统一候选的集成复核

2026-10-11（Asia/Shanghai）。本次执行用户“按照下一步计划任务执行”：独立核对统一准备方已生成的候选，形成交接与最终验收方案。统一准备由“拆分发布验证与备份门禁”承担；本任务不重复其开发，不修改其工作树或已冻结候选。

**结论：Worker 候选的来源、计划、收据和完整实际前驱差异一致，配套 Django PrepareApp 也已真实生成，但该组合尚不能作为最终 C 验收候选。动态观察时效修补未纳入，存在可复现的过期状态续期问题。安装顺序、最终组合提交、联合验收及批次仍须闭合。** 这份材料是准备阶段的阻断交接，不是补充生产批准请求。

## 精确对象与实核结果

| 对象 | 精确身份 / 结果 |
| --- | --- |
| 已采用 AB 来源 | `5faac8151f59d66de72c3caead8cad916ea547da` |
| 实际 AB Worker | `20261010T014638Z-97833d2f2b7e7bc9`；manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113` |
| 本次被审 Worker 候选 | `20261011T034516Z-f308beaede528df7` |
| 候选 manifest 原字节 | `20855e01531d0a089cccfd01d5287aba774991cc2fe06747424a72a3ce1ff3ed` |
| plan 原字节 | `38b26b941ae738995401795d0570fd7ef9ee6bf526a3582434b46c84af0f66da` |
| prepared receipt 原字节 | `087648dfb22af3ad74393e6e75c7837dbd4582560338d9edb2648ef8f6d95961` |
| source binding 原字节 | `831c104ce32daac6c3257b949f62a53998f1414cef4aa1a89132271d54a4cd1f` |
| plan 前驱链 | sequence 219，`aaf62994c75c3ca46362328fed6acc76f812808a2e852566782e5e0ba897e0d9`；这是准备时绑定，不是执行时现场复验 |
| 本次读取的实际 Django manifest | `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`；不是新工具包候选身份 |
| 后续实核 Django PrepareApp | ID `1e1138feef7148fb851713c2b39a25d0`；receipt `10db2364053ebfb90d85dd301914753453d02ad313cd02ff7312ca654ebdeb9b`，candidate manifest `85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09` |

[CANDIDATE_AUDIT.json](CANDIDATE_AUDIT.json)由本任务的只读[核对脚本](audit-candidate.mjs)产生，未导入生产模块、发请求或调用生命周期。实际重读并计算两个完整 source-snapshot：前驱 5157 文件/tree `92c2656c064c6a202239f4f010f0d241e90ae19fb35638cd328727a7ac64973c`；候选 5160 文件/tree `ad21d50df4cbdc91450c25caf369af0f615f555dac0023d6365d0e412e7d0111`，inventory `fd53437a7a05bf779d40d580fdc385914c9db23f00208022b454c59068ed3bcf`。与原准备身份、manifest 和 receipt 相符。

已验证 plan/receipt 原字节和侧文件、manifest/plan/receipt/source binding 同一元组、前驱绑定、19 个 tools keyFiles 的包内原字节，以及完整实际前驱变化恰为以下十文件；app/backend/lib/worker 业务文件无差异。没有独立重算 dist/node_modules 等完整构建载荷，也没有执行现场准入；不得从源树通过推断这些已完成。

## 实际范围与 C 重叠

候选变化：`release-admission-timing.mjs`、`release-preparation-evidence.mjs`、`release-batch.mjs`、`release-batch-admission.mjs`、`release-impact.mjs`、`release-lifecycle-step.ps1`、`release-no-data-observation.mjs`、`worker-local-release-rotation.mjs`、`worker-local-release.mjs`、`worker-local-service.ps1`，均位于 tools/。

原限定 ABC 来源 `9d41ce4fa2c7ee4d47ba1bfda0f0967d7727be9c` 的 C 六文件映射在 CANDIDATE_AUDIT.json：两个新增 helper 与原 C 字节完全相同；batch、admission、impact、worker verifier 四文件已被无数据策略和来源绑定合成修改，不能继承原 C 测试签名冒充最终组合验证。完整原 C `2b10f602...` 树未被整体带入。

统一准备方的来源绑定测试日志实有 23 pass / 0 fail；原日志 SHA `13c1b71ef41b7df4d8f37897725229f06dc2395910121e3c6bfe4f15ff391cc8`。本次核对了日志和最终四模块字节证据，没有重跑或把它归入本任务测试数。该测试集不覆盖下面的时效缺口。

## 阻断与修复交接

**B01：准入观察续期及末尾动态复核缺失。** 实际候选 `tools/release-batch-admission.mjs` SHA `115fbf67bc52ed1d1ff7e85a7f2d78fed58a7a73f23383a3455c1c27d74a630e`，168 行检查 Worker/helper，181–187 行采 Status，189–191 行执行恢复资格/session 或完整 source 身份重读，192 行用 `observedAtMs:Date.now()` 返回。慢重读超过五秒时，旧观察会被重新标为新鲜；期间 Django、WAL 或有效链变化也没有该段之后的完整末核。[独立复审](INDEPENDENT_FRESHNESS_REVIEW.md)给出实际候选函数的隔离反例。

修复要求：在统一方自己的新准备源中移植已审时序增量，保留新 source binding 四方约束，不能直接复制整个未采用 main 文件；完成慢检查后末核 effective chain（含 headManifestPath）、Django 部署摘要、journal head/count、Worker/helper，再采必要完整 Status；观察时间取真实结果返回点，解析及 attempt 写入耗时不得续期，>5000ms、倒退、非有限值拒绝且保留失败证据。参考已合 main `fcfe50aa59a5ccdf4a2b44c044e02cec8eb6aaba` 中的[精确修补与非作者证据](../../release-c-preparation/HANDOFF_UNIFIED.md)。本任务不编辑另一会话成果。

同一复审还确认 native exit0 后 parse/readiness 失败会丢失已返回的 processEvidence 与受限 readinessEvidence（184–186 行，UCF-DIAG）。完整 NotReady 断言仍拒绝，不能把它称为健康放行；修补应保留已经审过的受限失败捕获，避免收尾调查再次只有空输出。禁止保存原状态正文、reason 或客户数据。

修补后必须绑定新完整字节重跑时效 11 项、相邻漂移独立负例及来源绑定 23 项；新源码须再次非作者复审。重新形成源身份、构建、manifest、plan、receipt、配套工具包和最终批次，不原地改写 f308 或旧批准。

**B02：Django 消费者兼容性与切换顺序尚未闭合。** 已安装 Backup 的 retention 路径加载同目录旧 rotation/verifier，不能消费新 plan/source 字段。后续已实际读取原 PrepareApp 的上述新候选/收据，并按原 `relative-path-file-sha256-ordinal-v2` 重算已安装与候选各 2933 文件，均与自身 manifest 一致，两个工具与 Worker 包相同；backend/config/drizzle/runtime-tools 依赖字节无变化。见[DJANGO_AUDIT.json](DJANGO_AUDIT.json)。

首次“整个工具包只有两文件变化”的断言失败且保留[原记录](DJANGO_AUDIT_FAILURE.json)：实际还有 `.wrangler/cache/cf.json`，前 SHA `a3807b705617b7968f9a023986dffd1be8f65731bb99747805af227d3f8688f2`、后 SHA `018ee581023eef90706fde6d5c555987cedc172adee81dc054a916e0ebecbc61`。这是缓存制品差异，必须计入完整实际范围，不隐藏或降级摘要。原 PrepareApp 的 local R2 smoke 使用未变 Miniflare 缓存写入实现，因而推断此缓存由准备产生；特定写入未另行打点，不声称已经独立证明生成时刻，也不保存其地理/网络字段值。更新核对范围后静态三路径复核通过，不代表原两文件断言曾通过。

尚需验证安装顺序、真实消费者调用和回退；B01 修补导致 verifier/来源身份变化时，配套包也须按新对象重新准备。不能把 Backup 捕获的 cleanup failure 当完整成功。旧 plan.lineage 中历史 Django 身份不能替代当前/候选 Django 的独立 binding。

**B03：最终组合 Git 与验收对象尚未封存。** 本次物理候选包含四模块未提交的来源绑定增量；最终组合提交 SHA 与 batch SHA 在本报告截点均未提供。必须将 C/无数据策略/来源绑定/时效修补及可选诊断修补逐项纳入最终精确范围，绑定测试和审查，不以分支存在、进程结束、报告片段认定交付。当前 control 仍为 AB `0e87b266...`，retry `c520faf9...`；不能声称已经生产采用 fc84 标准健康修补。

## 联合验收方案

先闭合上述阻断，再由统一准备方按最终对象串行完成最小充分联合回归。本任务可独立复核结果；既有作者/非作者旧测试保留，不能覆盖新字节。

| 必查事项 | 最终组合所需证据 |
| --- | --- |
| A 退出/EOF/期限与 B 重试 | 真实隔离子进程；生命周期 started/unknown 不重放，只读重试共同绝对期限，超时不杀正式服务树 |
| UI 与引擎结果 | 页面健康不覆盖引擎失败、错版本、缺完成证据；完整必要验收闭合前保留阻断 |
| B 错误保留与 C 准入 | 失败、unknown、协调、续接保留原语义；拒绝迟到成功及 B01 的慢扫描、头漂移、非有限年龄 |
| 影响分类 | 完整实际前驱到新候选差异；app/、GET、静态声明都不能单独证明纯前端或无数据影响 |
| 恢复资格 | v2 reuse 缺有效日备份、同点演练及现场资格即拒绝；机制首次采用严格/full，不能使用自身减免 |
| 证据复用 | 只复用有效不可变证据；身份、权限、维护、排空、有效链及动作前检查保持动态 |
| 并发/安全续接 | 锁、CAS、WAL 和 source binding 不一致失败关闭；原动作未知不重放，协调和合法续接预先进入同一范围 |
| 安装态兼容 | Worker guard、快捷方式及 Supervisor 导入路径；Django retention 两工具和真实 PrepareApp/DeployApp 收据、切换顺序与回退 |
| 报告与计时 | 未完成/未覆盖/异常独立列示，子阶段不重复加总，实际入口不可用采样和切换跨度分别报告 |

重型构建、完整测试和数据库恢复演练须错峰串行。比较使用同源码、同制品、同数据规模和同验收范围；本次不重复统一方正在准备的构建，更不为测速重放生产。

## 发布前置与回退

最终精确批准包应一次列明：最终源码 SHA/增量范围、Worker release/manifest/plan/receipt/source binding、Django 新候选/收据、实际前驱链、strict/full 操作列表、必要验收与完整交付终点、失败取证及允许的协调/续接、代码回退步骤。现场漂移必须拒绝旧包，不自动接受新字节。

代码回退绑定当前 AB Worker 和 Django 实际安装身份；须证明两消费者在正向与回退阶段均能验证相应 plan/manifest，不能仅还原界面包。保留旧源、依赖、档案及运行包，不清理仍被引用的目录。数据恢复另需具体恢复点、目标和批准，不能将代码回退授权延伸为生产库恢复。

默认 C 与新机制第一次采用保留完整保障；统一合批只在范围明确且联合验证闭合后交用户决定。AB 已完成，旧 AB 批准及尾部补充 scope 不批准此次 C 或无数据策略。

## 状态与耗时

| 状态 | 本报告截点 |
| --- | --- |
| 源码完成 | 原 C 与本任务时效修补已分别交付；统一 source binding 合成源尚待最终提交 |
| 隔离验证 | 原 C/时效修补既有证据、23 项 binding 日志存在；实际 f308 时效负例失败，最终联合验收未通过 |
| 生产候选 | Worker f308/plan/receipt 与 Django 1e11 准备已生成且静态绑定/范围实核；最终 C 资格不通过，安装顺序与最终 batch 未闭合 |
| 实际采用 | C、新时效修补、无数据机制均未在本任务采用；没有生产切换授权或执行 |

统一方 Worker 准备原始记录 03:45:16.573Z 至 03:57:51.032Z，12 分 34.459 秒（上海 11:45 至 11:57）；本任务完整双源树和元组只读核对 04:12:30.326Z 至 04:12:39.993Z，9.667 秒；Django 最后静态全树核对 04:17:05.477Z 至 04:17:08.120Z，2.643 秒，前两次失败核查时间不算进该成功样本，也不隐藏。不同范围不能相减或认作生产提速。

批准到必要验收、批准到完整交付、本批次排队、生产准入/备份/恢复/排空/切换/验收/收尾、故障协调及真实入口不可用：本轮未执行，未测。30～60/80～120 分钟仍为工程预算。既有三次 Worker 退出和恢复效果有证据，但另一对话导致退出的根因仍未知，[取证边界](../../release-c-preparation/stability/FORENSIC.md)保持。

既有真实 Antigravity 的[准备阶段报告与更正](../../release-c-preparation/agy/FACT_CHECK.md)保留，其调用没有读取本次最终物理候选，不能作为 f308 的独立签名。本次候选由已有非作者 preparation_review 直接读取并执行隔离负例，原代码与输出在同目录；六项检查成功复现缺陷，不是候选安全测试通过。

本任务仅新增只读复核脚本、证据与交接文档；不修改统一方代码/候选，不运行生产 Status/HTTP/SQL，不维护、启停、部署、修改调度、业务写入或外发。Git 提交/推送身份保存于外置归档 `E:/codex-artifacts/release-c-unified-candidate-review-20261011/DELIVERY.json`，不能把本报告提交当最终功能组合 SHA。
