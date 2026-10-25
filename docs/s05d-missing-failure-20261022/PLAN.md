# S05d 缺失 FAILED 的有限恢复规划

规划日期：2026-10-22/23。源基线 `36668589cab03d5d2d9d98383fb58eeb19c391ee`；本任务 worktree 已 fast-forward 纳入 `a6eb508d` 的施工与 S05c 文档。角色请求为 `decision / gpt-6-astra / high`；工具未另行提供底层实际型号回执，不能将请求值写成已独立核实的运行事实。

本文件是独立规划，不是实现、独立审查、控制采用或恢复许可。读取本地源码、S05c 原证据以及有界 Windows 只读事实；没有调用生产入口、adopt、队列协调、准备、进程终止或服务操作，也未更新 main 引用。

## 结论与本轮最小交付

现有两条 decision 都不能处理 a3。缺少原失败回执本身不是新增放行条件；必须另外取得足以替代原失败/树清理证明的**正面退休事实**，再证明全作用与消费边界已经闭合。现有证据没有做到这一点。

因此，本轮可交付的最小有用代码是**独立、只读、失败关闭的缺回执适用性审计入口**：绑定原件、展示现有作用与缺口、解释原两支为何拒绝。它不应注册一个无法取得可信证据却名义上可执行的第三 decision，不接收用户自填的“已退出/零作用”证书，也不创建 resolution/evidence 目录。本次 S05d 必须保留“恢复能力未就绪”的真实阻塞；隔离检查通过或诊断代码完成不代表施工单的恢复目标已达成。

下面同时定义第三有限分支的可实现上限与准入条件。未来取得真实 provider 之后，才把它实现为 writer/reader 均支持的第三分支。不要把“当前 a3 不适用”扩大成“任何缺 FAILED 中断均不可安全恢复”。

## 已确认事实与不能推出的结论

| 证据 | 可以确认 | 不能推出 |
| --- | --- | --- |
| a3 原 dispatch/result；S05c evidence.json | 原 dispatch 为 `a3d53227-8976-4762-8be6-6f8c28107b5b`，target 为 `36668589…`，终态仍 unknown | unknown 可以改成 failed/success，或者允许同目标重放 |
| 原 publication 枚举 | 只有 `preparation/PREPARING.json`、`source-binding.json`，没有 FAILED/PREPARED/worker-plan | 没有任何产物、没创建过进程、没发生过消费 |
| 原进度 state/log | 开始前端构建；state 为诊断性运行信息 | 原 actor 强身份、整树退出、确定的关窗根因 |
| `runPublisher` 的 spawn/exit 实现 | 父进程会根据直接子进程 exit 抛含退出码的错误 | 错误字符串包含创建时间、SID/session、命令、后裔退休证据 |
| 已安装 `83e4158f…` 与源码 reader | cleaned 要求唯一 FAILED/process_timeout/treeCleanup 成功；superseded 要求完整 PREPARED/消费链 | 文档或新诊断入口已改变已安装放行规则 |
| 有界原生系统读取 | 当前 boot 从 `2026-10-17T14:43:44.500Z` 开始，早于 a3；Kernel-Boot/27 的 BootType=0，与 Kernel-General/12 StartTime、Win32_OS 一致 | a3 经历过系统重启，或可据此退休原树 |
| TaskScheduler/Operational 元数据及主负责人限定时间读取 | 当前 channel disabled、circular，现存 4002 条；限定 a3 时间窗未取得事件 | a3 没有运行、历史日志完整、任务没有其他实例 |

系统 boot 读取仅取各 provider 最近两条事件及一个 CIM 时间；不保存机器名等无关标识。原始现场证据由任务负责人在 REPORT/证据中定位；本规划不复制完整日志。

## 可直接复用的能力

- `tools/preparation-resolution.mjs`：canonical 对象摘要、稳定读取与目录拒绝 reparse、原 dispatch/result 绑定、原件留存、对象归档、双阶段静态扫描、同一 queue→rotation 锁 epoch、双独立 observer 和 ordinary ACK、最终 CAS、reader 再验证。
- `tools/cleaned-preparation-writer.mjs` / `cleaned-preparation-observer.mjs`：已采用冻结控制包、普通交互身份、独立高权限只读完整 census、task 定义/空闲实例复核。高权限仅用于观察，不用于写 resolution、杀进程或生命周期操作。
- `tools/main-control-dispatch.mjs`、`main-prebuild-task.mjs`、`install-main-prebuild.mjs`：控制代际、intent/transition/installation 绑定、固定 task action 与身份。固定任务 `triggers=0`、`restartCount=0`、`startWhenAvailable=false`，可用于未来“不会自动重启原任务”论证，但仅当前定义不足以证明历史从未变化。
- `tools/main-prebuild-queue.mjs`：unknown 原终态不改写；合法 resolution 只解除原 dispatch 的阻塞；非历史特例默认禁止原 target 重放。无需新建队列或修改终态状态机。
- 已有控制材料构建闭包与独立材料检查：用于未来受审新模块进入冻结 bundle；源码完成与实际安装分开。

兼容约束：原 `operatorNames` 是旧 resolution 严格验证的一部分，不能全局加名导致旧记录失效。未来新分支使用分支独立的 operator 清单/版本；旧历史 catalog 与原两个 validator 的接受集合不变。新 producer 资格与旧资格分开，不把新分支放宽写进旧 `closures`。

## 第三分支的充分证据模型

建议语义为“缺失败回执、原执行已正面退休、未形成可消费候选”，名称暂记 `interrupted-retired-before-plan`，**本轮不加入 knownDecisions**。`retryOriginal=false`、`publicationPerformed=false`、`prepared=false`；不能宣称原执行成功、所有副作用从未发生，或者将本次协调说成一次准备完成。

所有条件必须同时成立，缺一即拒绝：

1. **原请求不可替换**：原 winning ticket、dispatch、result 的原字节 SHA、requestId/dispatchId/target、packet 规范路径、request/source-binding/PREPARING、源码 commit/tree、原 deadline、前驱 Worker/Django/chainState 完整互相绑定。非 winning result、缺原终态、额外未知原件均拒绝。
2. **原与当前控制代际**：归档并验证原 dispatch 的 bundle/config、原采用 intent/transition/installation/task 定义，与当时生效时间及真实 actor 来源对应；同时绑定当前已采用 bundle/config 与 writer/observer。原配置不明、同一路径被替换、代际链断裂、控制采用中的并发窗口均拒绝。当前 adopted 不能代替原代际事实。
3. **原执行身份**：必须由原生执行记录绑定执行实例，而不是从现在新建 JSON。记录至少关联 host、原 boot、task/actor instance、PID 与创建时间或等强不可复用标识、父实例、SID/session、固定 executable/command 摘要、原 generation/config、dispatch/request。一个 PID、文件时间、普通日志文字、Task LastTaskResult 或原 terminal 错误字符串都不够。
4. **正面退休 provider**：只能接受下述已实现、已验证、可原生复采的窄 provider；没有 provider 就停在诊断。不得把 provider 名称和若干 `true` 字段当证据。
5. **效果闭包**：按已审 producer 版本确定所有可能写入/消费路径。身份、完整清单、解析与原件摘要构成证明；“grep 未命中 target”仅是辅助。原 producer 可调用未知脚本、未知 npm 生命周期/外部执行器或路径无法界定时拒绝。
6. **独立动态闭合**：同 queue→rotation 锁 epoch 中完成初始静态清单→独立完整 observation→ordinary ACK→最终静态清单→独立 observation→ordinary ACK；最后再次读取所涉及的静态根/目录成员、控制代际和原件 CAS，全部仍与最终证明一致才落原子 resolution。额外外部 actor/迟到文件/任务实例出现、opaque controller、权限不足或超期均拒绝。

### 正面退休 provider：范围与现实可用性

**A. 原生持柄退出并证明后裔闭合。** 必须是原执行发生时留下的可认证原记录，包含强身份、直接退出、完整受控树或 Job 的无剩余后裔事实，且 producer 证明没有逃逸到持久任务/服务/外部消费者。reader 应复核原始记录和生成者字节，而不是接受手工转抄 JSON。

现有 `process-deadline.ps1` 确实持 kernel process handle 取得直接 exit，但返回 Evidence 主要为 PID、阶段、退出码及输出摘要；现有 `worker-local-release.mjs/runProcess` 有 treeCleanup 字段，通常由 FAILED 保全。二者不能在 a3 缺原记录后补出原创建身份/整树证据。不能将它们当作已经存在且满足新条件的 provider。未来最小增强也只能为**新执行**留事实，不能修复 a3 的历史缺口；本单不扩展为宿主/日志重构。

**B. 已自然发生的完整 boot 隔离屏障。** 当原 task/actor 的可信实例记录确实处于旧 boot，而当前原生系统证据证明已经完整启动另一 boot，可正面排除旧进程树在内存中迟到继续执行。当前可原生读取的候选材料是 `Win32_OperatingSystem.LastBootUpTime`、System `Microsoft-Windows-Kernel-General` 事件 12 的 StartTime、`Microsoft-Windows-Kernel-Boot` 事件 27 的 BootType，保全原 XML 的 provider GUID、版本、recordId、时间与摘要；时间、主机归属、原实例归属必须一致。未独立确认的事件语义或 OS 版本不得自动纳入资格。

该 provider 必须拒绝休眠恢复、混合启动、睡眠恢复、时钟矛盾、事件缺失/截断、仅看 `LastBootUpTime > 日志日期` 的简化规则。完整 boot 只证明旧内存进程退休，**不能证明原来零效果**；仍需证明原任务无持久续跑/重启触发、原控制代际与 task 定义未漂移，且对所有残留及消费记录闭合。TaskScheduler Operational 的实例/执行事件可作为身份来源候选，但必须先核实实际 XML schema、实例关联和覆盖完整性，不能预设事件存在或任意指定一条 eventId 即放行。

本轮 a3 在当前 boot 内，任务事件也未取得，故 B 明确不适用。禁止为满足恢复条件主动重启机器、启用事件日志、修改任务或制造新 boot。本规划不给这些操作授权。

### 推荐内部 proof 结构（不是外部自证 API）

内部结构分 `binding`、`originalControl`、`currentControl`、`executionIdentity`、`retirementProvider`、`producerQualification`、`effects`、`observations`。每个事实应指向 archive 内原始对象的 SHA 和原生来源解析结果。provider 使用闭合集合及逐 provider 严格 parser；未知 provider/schema/额外字段失败关闭。`executionIdentity` 或 `retirementProvider` 不允许由 CLI 传布尔值覆盖，导入 JSON 只能是原生证据的封存输入且须重新验证来源，不能变成“给摘要就可信”。

## 作用与消费闭包的最小清单

新分支不能直接把旧三文件 producer 资格及旧 collector 称为完整闭包。限定为“Worker 前端构建未形成计划，未开始后端/维护”的最窄场景，并针对精确调用图审定下面各项：

| 区域 | 必须证明的边界 |
| --- | --- |
| 原 packet | 完整目录成员与 request/PREPARING/source-binding；source 不可变身份；logs、invocations、publication、临时 PREPARED 文件及其他条目全部分类。多余文件不能被静默忽略；原残片保留 |
| Worker `.staging` | 完整列举所有 deploy UUID 与文件树，拒 reparse/变动/未知归属。新或非空残片不删除、不当作已清理；本窄分支拒绝 |
| Worker `releases` | 完整目录清单，每个原生 deployment manifest 及其 source-binding/源树/请求身份可核验；残缺 manifest、未知 release 均拒绝，不能只读当前指针 |
| Worker state 五域 | `worker-prepared-builds`、`worker-release-publication-staging`、`worker-release-rotation-plans`、`worker-release-rotation-consumptions`、`worker-release-successors` 的完整目录/原件，含 sidecar/临时/未知文件；按结构身份和引用链核对 |
| 当前运行与发布消费 | Worker current-deployment、Django app/deployment、当前 effective chain、主控制 PUBLISHED-MAIN 及引用的 SUCCESS；其他原生消费入口/历史 publication 目录有无引用该候选。记录缺失不能代替未消费 |
| Django/Pi/维护 | `app.prepare-*`、`app.deploy-*`、相应 deployment/准备凭证、run 中维护/排空/准备 lease、Pi 准备/计划/消费路径。若靠“Worker plan 落盘后才可进入”排除，必须证明精确源代码顺序及原记录不可删除/替换；否则实际盘点，遇无法解释记录即拒绝 |
| 子工具与缓存 | 对 npm/Vinext/helper、schema verifier、依赖缓存与调用环境，只盘点已审调用图允许的外部作用位置。可解释缓存/诊断写入不冒称零作用；有未知持久调度、远端写入或外部消费者则分支不适用 |

先用精确 producer 顺序排除确实不可达的路径，避免无理由扩成全机审计；不能反过来用“缺 worker-plan”单独证明后端未发生。实现若无法给出充分闭包就停止，不为做出正例放松条件。

## 本轮受控只读入口

实现采用独立 CLI，参数仅为绝对 `--config` 与精确 `--dispatch`，不扩展原 writer。实际只读入口：

```text
node <reviewed-source>/tools/preparation-missing-failure-audit.mjs \
  --config <absolute main-publisher-config.json> \
  --dispatch <uuid>
```

完整调用以 [IMPLEMENTATION.md](IMPLEMENTATION.md) 为准。此源码只读诊断尚未纳入已安装 bundle，不能伪装已安装 operator。输出到 stdout，由调用方另存私有任务证据；不提供生产 `--out`，不自动建立 queue 目录，不持有恢复锁、不启动 observer、不唤醒任务、不 fetch、不写 result/resolution、也不自动进行准备。

输出必须区分：已核实的原件摘要/字段、已观测的产物、尚未覆盖的域、原两支拒绝原因、可替代 provider 的缺口与本次 `eligible=false`。不得仅凭 packet 三件给 `candidateArtifactsAbsent=true` 或 `ready=true`。错误/拒绝有稳定代码；read-only 有界审计不是最终动态复验，不能作为后续写入的凭证复用。

## 控制包闭包及将来采用顺序

1. 先在独立 worktree 完成源码/只读诊断与必要构建、部署、启动入口检查；本轮不调用真实 task 安装、adopt、队列 drain 或制品准备夹具。定向检查覆盖未知 decision 拒绝、旧两支接受/拒绝边界不变、原件未写、缺 provider/额外产物/代际漂移失败关闭。
2. 若未来确实实现充分第三分支，reader、writer、observer、provider/parser/qualification、所有直接 import 必须一起进入 `install-main-prebuild.mjs` 的冻结 `controlFiles` 与 manifest；旧 reader 接受集合保持，不能只替换工作树一个 mjs。
3. 完成独立关键逻辑审查后，先制作和核验绑定最终源码提交的控制材料；新 operator 只接受已采用且摘要完全一致的 bundle。不能在源码测试通过后直接对现场调用新 writer。
4. 由 S05b 在对应实际授权下按原 v1-queue→v2-queue→native-rotation 转换协议采用控制包，保留原安装、transition 及 unknown；采用阶段不创建新 dispatch，不重放目标，不发布应用。
5. 采用后刷新现场准入，provider、全闭包与双动态窗口全部通过才允许新 writer 原子创建**独立 resolution**。任何事实缺口继续阻塞；不修改原 result、FAILED 或历史对象。
6. 解阻不等于有 PREPARED，不意味着原目标可重放，也不意味着可上线。后续准备/发布只按原队列与新的明确授权执行；当前 a3 不具备第 5 步条件。

## a3 准入矩阵与交接

| 条件 | 当前结论 | 后续最小动作 |
| --- | --- | --- |
| dispatch/request/target/原 unknown 保全 | 有原件可绑定 | 诊断时稳定读取并报告摘要 |
| 原两条 decision | 明确不适用 | 保持原严格拒绝 |
| 原 actor 身份与可信退休 provider A | 未取得 | 不从错误码、文件时间或当前 census 补造 |
| 跨 boot provider B | 明确不适用：a3 晚于当前 boot | 不主动重启补证 |
| 原任务实例事件 | 指定范围未取得；channel 当前停用 | 保留未知，不开展无界日志调查 |
| 完整 producer/效果/消费闭包 | 旧范围不足，新闭包尚未资格化 | 若继续研发只分析直接依赖，不以当前packet清单代替 |
| 最终动态复验/实际控制采用 | 本单禁止、尚未执行 | 留给证据具备后的 S05b 对应授权 |

交付措辞应为“只读适用性审计/证据缺口已交付，第三有限恢复仍阻塞”，不能写“S05d 已通过、S05b 可直接采用恢复”。若实施发现此前未读到的真实权威记录，应回到本表核实其来源、身份和完整性，再决定是否有必要扩展代码；不存在记录时，不通过写更详细的规划或合成正例替代真实就绪。

实施交给执行角色，独立审查交给未参与本规划与实现的审查角色；本规划者不参与代码实施或审查。不扩日志流式落盘、宿主拆分、队列重构、自动重试与一般发布优化。
