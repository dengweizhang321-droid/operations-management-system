# S05d 实施调查与只读诊断

任务目录沿用 20261022；最终隔离检查于 2026-10-23 上海时间完成。**本轮只交付只读审计入口；第三有限恢复能力未实现，S05d 恢复目标仍阻塞，S05b 不能据此采用或协调。** 独立方案见 [PLAN.md](PLAN.md)，检查原始输出见 [checks.json](checks.json)。本文件由实施者整理，不是独立审查。

执行角色请求为 `complex / gpt-6.1-sol / xhigh`，局部原因是缺原失败回执、迟到作用及并发交错；工具没有返回可独立确认的实际模型回执。未转派。

## 实际交付

- `tools/preparation-missing-failure-audit.mjs`：独立只读 CLI，不注册新 decision，不接入控制 bundle，不生成队列、proof、request、observation、ACK、resolution 或输出目录。正常诊断只写 stdout；参数/原件不合法时以 `MISSING_FAILURE_AUDIT_REJECTED` 写 stderr 并非零退出。
- `tests/preparation-missing-failure-audit.test.mjs`：10 条隔离合成检查定义，全部使用临时目录。初轮 9 条通过，随后真实 request schema 修正新增一条并作关联增量检查。覆盖原件绑定、缺回执拒绝、伪造 JSON 声明无效、残片不代表零效果、硬链接/过大文件、全局目录上限、unknown 继续阻塞后续工作及 CLI 参数边界。
- 原 `preparation-resolution.mjs`、两个 cleaned writer/observer、queue、history、producer qualification、`install-main-prebuild.mjs` 均未修改。原两个 decision 的接受条件和历史 catalog 保持。

候选入口与实际参数如下；实施者未对生产 a3 执行此命令，主负责人是否按授权只读调用及其结果以 REPORT 为准：

```powershell
node D:\codex-worktrees\s05d-missing-failure-20261022\tools\preparation-missing-failure-audit.mjs `
  --config <绝对路径的main-publisher-config.json> `
  --dispatch <原dispatch UUID>
```

`--help` 不读取现场。没有 `--proof`、`--out`、`--resolve`、恢复或写入参数。不调用 fetch/Git、子进程、计划任务、进程普查、锁、服务或准备入口。正常输出只可能 `blocked` 或 `not-applicable`，分别带 `MISSING_FAILURE_BLOCKED` / `MISSING_FAILURE_NOT_APPLICABLE`；`recoveryEligible=false`、`resolutionWritten=false`、`retryOriginal=false`。`candidateArtifactsAbsent`、`originalActorRetired`、`lateEffectsFenced` 始终为 `null`，不会从文件缺失或当前无进程推断事实。

## 审计实际核对与未覆盖范围

入口稳定读取绝对 config，并绑定原 config SHA、原 dispatch 的 bundle SHA、winning ticket、dispatch、terminal 的 canonical 原字节；逐项核 requestId/dispatchId/target、ticket SHA、config/bundle、原 winning result、packet 路径。可用的 request/PREPARING/source-binding 分别绑定原字节，核目标/源码 commit、原前驱 Worker/Django/chainState 与 sourceRoot。PREPARING 中 Git tree 仅校验 40 位格式；原 request 若确实提供 sourceTree 才严格交叉比对。真实原 request 没有此字段，输出明确该 tree 仅来自 PREPARING 原件，未做 request 交叉核对或源码内容验证。source-binding 的内容树 SHA-256 与 Git tree 是不同身份，不相互替代。绑定矛盾直接拒绝，不返回可恢复结论。

原 packet 除 source 外的文件进行两次相同范围清单/摘要读取；总文件和目录分别最多 256、单文件最多 2 MiB、总文件字节最多 16 MiB、深度最多 12，每目录及 source 直系名字最多 256。稳定读取拒绝链接/重解析、硬链接、读取变化及超界对象。source 只列直系名字，既不递归其 node_modules/dist 等构建树，也不声称 source 完整性已校验。重复快照和最终原件摘要仅说明本诊断读取的一致性，**不构成最终恢复动态复验**。

输出列 observed 的 FAILED 文件与 PREPARED/worker-plan/STARTED/SUCCESS 名字；这些名字不证明原生成功或消费。当前 CONTROL-INSTALLATION 只保全摘要及可见 bundle/installId，不验证 adopted/intent/transition 历史链。原两支证据分别列在 `oldDecisionEvidence`，明确 `validatorExecuted=false`：缺 FAILED 无法满足原 process_timeout/treeCleanup 条件；PREPARED 存在也不证明后继消费链。

没有扫描外部 Worker/Django/Pi runtime、原执行身份、boot/任务事件、当前进程或恢复锁。未覆盖域及正面退休 provider 的候选路线由输出 `notEstablished` 与 PLAN 列明。诊断不能作为后续写入凭证复用；即使所有列出的 packet 文件都消失，仍不会输出 eligible。

## 复用调查与真实阻断

既有 `writePreparationResolution` 可复用 queue→rotation 锁序、已采用冻结 bundle 的控制身份、对象归档/CAS、初始/最终静态扫描、两次独立 elevated 只读观察与 ordinary ACK。queue 的合法 resolution 读取及原 target replay fence 也已存在。原 `operatorNames` 是旧 resolution 严格清单，未来不能全局加文件导致旧记录失效。

现有 cleaned validator 只允许固定四件原始文件及唯一 FAILED，其受控 process_timeout/treeCleanup 条件不覆盖 a3。superseded 则要求原 PREPARED 与精确后继消费链。旧三文件 producer qualification 不能直接当作新第三支的完整副作用闭包。

`publish-latest-main.mjs/runPublisher` 只把直接子进程 exit 转成错误字符串；PREPARING 没有原 PID/创建时间/命令。现有 `process-deadline.ps1` 和 `worker-local-release.mjs/runProcess` 的内存 Evidence/常规 FAILED 落盘不能在原 FAILED 缺失后补造原 actor 强身份与全后裔退休。可替代路线是可信原生退出/整树闭合记录，或可信原 task 实例、无重启/续跑与完整 boot 屏障；本实现没有任何已资格化 provider，也不接受人为新 JSON 声明替代。

root/planner 负责的 boot 与任务事件现场观察不在本实施重复查询；本轮实现及检查全部为隔离合成材料。a3 是否存在其他权威证据仍须依 PLAN 逐项核查，不能由本诊断或合成正例填补。

## 必要检查

schema 修正前新增合成边界检查 9/9，原两个 decision 的现有合成正例各一条，共 2/2；schema 修正后只运行直接相关的原件/缺 tree、可选 tree 严格核对与 CLI 用例 3/3，并重新检查两文件语法。最终字节摘要以 schema-fix-checks.json 为准，原 checks.json 保留前一版执行证据。未运行原历史现场读取用例、全仓测试、完整构建、真实生产写工具或完整原生冷启动。原程序没有生命周期语义变更。

首轮为 8/9，原因是新合成 fixture 漏了旧 `validateDispatch` 必需的 `live.mainCommit`；仅补 fixture 后通过，未放宽任何程序门禁。失败及最终检查均在 checks.json 说明。新审查意见的目录全局上限与读取后字节上限已加入，不把诊断有界范围扩大为完整副作用证明。

主负责人随后首次只读调用实际 a3 时遇参数兼容拒绝：原 request 不含 sourceTree，而最初实现和 fixture 错误假定它必有该字段，导致 PREPARING 的真实 Git tree 与 undefined 比较。按原 packet 三件的真实结构修复后，保留 PREPARING commit/原 target、tree 格式和可选 request tree 的严格相等；source-binding 若原有 identity.commit 也交叉原 target。输出明确 Git tree 未独立验证、缺 request tree 交叉核/source 内容未核；新增对应合成反例。首轮现场拒绝保存在 [a3-readonly-audit-first-rejection.json](a3-readonly-audit-first-rejection.json)，增量检查另见 [schema-fix-checks.json](schema-fix-checks.json)。这次修正未增加任何恢复资格；主负责人实际重跑结果以 REPORT 为准。

## 控制闭包与后续顺序

本只读候选没有修改 `controlFiles`，不需要或声称已采用控制包。未来只有第三支充分证据与 provider 真正实现、必要边界检查和独立关键审查通过后，才把 reader/writer/observer、provider/parser/qualification 及直接 import 作为同一冻结 bundle 交付；新分支用独立 operator 清单保旧协议兼容。

之后须由 S05b 在对应授权下按原 v1-queue→v2-queue→native-rotation 协议采用精确控制材料，再刷新原控制历史/actor/退休/全部可能产物与消费记录，并在同锁 epoch 完成双独立观察、ordinary ACK 及最终动态复验。任何缺项继续阻塞。解阻不代表 PREPARED，也不允许重放原 target 或上线。

本实施未 fetch、推进 main、提交或推送；未 adopt、队列协调、dispatch/准备、任务变更、服务启停、生产恢复、迁移、数据库写入或上线。Git 交付和最终报告由主负责人完成。
