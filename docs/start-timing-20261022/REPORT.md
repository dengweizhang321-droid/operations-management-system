# Start 分项预算与接收器解耦候选

本轮只完成候选、隔离定向验证和本地提交。基线为本机已有 `origin/main`：`f641685b60ca11a674da713e3b7b454f338c622c`；分支 `codex/start-timing-20261022`，工作树 `D:\codex-worktrees\b1`。用户给出的 `D:\codex-isolated\main-checkout\运营管理系统` 不存在，因此从现有仓库同一引用创建指定 b1、b3；b3 未实施改动。本轮未 fetch、pull、push、merge、发布、迁移或启停生产服务。合并与发布须等 A1 完成及用户新指令。

## 实现与边界

`tools/worker-local-service.ps1` 的原 `Invoke-WorkerSystemStart` 顺序继续为维护门/身份检查 → Django ensure → 完整 release 校验 → 原 supervisor 启动。新增 `Invoke-WorkerStartPhase`，以动态作用域将每项 deadline 下传到原 native transport、HTTP 和就绪等待；每项完成或失败后恢复原环境，下一项重新取得自身预算。超时仍中止依赖它的启动流程，不把未完成的关键组件报成功。

`tools/operations-system-control.ps1` 的 Start 包装与唯一引擎不再生成隐式整轮 600 秒限制；Start 使用 1800 秒外层防失控上限，与当前发布器原有 1800 秒步骤上限一致。其他动作的原默认不变。任意调用者显式传入更短的 `TERUISI_PROCESS_DEADLINE_UNIX_MS` 仍通过 `min` 保留，不清除、不延长。三个必要阶段各有预算，但仍受有效父级上限约束；把所有配置调到最大并不保证突破父级上限。

| 子项 | 默认秒数 | 环境变量 | 默认依据 |
| --- | ---: | --- | --- |
| Django ensure（含初始 readiness） | 400 | `TERUISI_START_DJANGOENSURE_SECONDS` | 实测 330.886 秒，加约 69 秒余量（S02 收紧，原 480） |
| 完整 release 校验 | 220 | `TERUISI_START_RELEASEVERIFICATION_SECONDS` | 实测 151.113 秒，加约 69 秒余量；所有完整性检查保留（S02 收紧，原 300） |
| supervisor 启动与原就绪门 | 90 | `TERUISI_START_SUPERVISORSTART_SECONDS` | 实测 20.677 秒，加约 69 秒余量；把原按轮数的等待改为实际 deadline，包含原身份/进程回执/helper 就绪开销（S02 收紧，原 120） |
| DingTalk 独立启动及观测 | 180 | `TERUISI_START_DINGTALKRECEIVER_SECONDS` | 原 91.520 秒是被截断的失败等待，不是成功耗时；180 秒为独立有限观察默认值，不作性能保证（S02 未改） |

每项配置为 1–900 的整数秒；无配置使用默认，非法值失败关闭。三个核心默认预算合计 710 秒（400+220+90），分别计时；接收器另开独立控制进程，不消费核心 Start 的剩余预算。

Start 在原必要组件成功后写入 `startCompletedAt`，返回原 `started` / `already_running` 结果及 `startupPhases`。接收器只返回 `dingTalk.requiredForStart=false` 与独立观察信息；派发失败也不改写核心成功。`BackendStartPolicy=RequireReady` 继续记录 `preserved`，不新增接收器或调度器；并发加入路径继续仅观察原启动结果。

新增自调用动作 `ObserveDingTalkStartup`。它仍解析原有效 release/manifest，在原 Worker 生命周期锁内复核维护、自动化排空及 exact Worker 身份，之后调用原 AI `AutoStartDingTalk`（原配置/authority/凭据/AI mutex/精确进程检查全部保留）。若后续操作已进入排空，记录 `deferred_drain`；不自动重试。AutoStart 的直接退出 0 只标记 `native_completed`，不直接等同连接就绪。释放 Worker 锁后，在该子项同一预算内调用原 `django-ai Status` 只读观察：`DingTalkStartup=enabled`、`DingTalkReceiver=running`、`DingTalkScheduler=running`、`DingTalkConnection=connected` 同时成立才记录 `ready`。禁用、失败、超时分别记录；配置或身份错误失败关闭。纯状态等待不额外占用生命周期锁。

独立结果保存在 Worker runtime 的 `logs/dingtalk-startup-<observationId>.json`，日志同前缀加 `.stdout.log` / `.stderr.log`。记录 create-only，绑定 observationId、release/manifest 和有限状态；早期 head/manifest 拒绝也通过主失败路径尝试写入独立失败记录。若独立进程中断或记录无法写入，保留原 stdout/stderr 和 `observing` 事实，不把缺文件解释为未执行或 ready。

## 失败和对账

核心超时字段为 `startupPhases.<阶段>.outcome=timed_out`，错误码分别为 `DjangoEnsure_timeout`、`ReleaseVerification_timeout`、`SupervisorStart_timeout`；接收器独立记录 `DingTalkReceiver_timeout`。每行包含预算、实际 deadline、起点、耗时及原 ProcessEvidence。非超时失败使用对应 `_failed`；原 native exitCode、timeoutType、PID 等不改写。非 JSON 错误额外输出阶段及错误码。

核心失败继续返回原 `status=unknown`、直接 exit 1，并附加 `failedStartPhase`；原来无法确定的直接退出保持 `null`，不捏造 exit 0。失败后不继续启动依赖项、不新增回放，也不将时间诊断或独立观察当成恢复授权。生产 attempt 的 STARTED/FAILED、status/resume、回执 schema 及人工对账入口均未修改。

本轮未改维护门开关、业务关闭语义或发布尾部顺序，没有实施“先全部 Start 再清维护门”。原身份、一次性完整校验、supervisor 回执、锁、排空及维护门检查保留。以下文件无差异：`main-prebuild-queue.mjs`、`django-local-service.ps1`、`publish-main-*.mjs`、`release-scope-plan.mjs`。没有 Worker/Django 业务代码、数据库或 migration 改动。

## 代入 2026-10-21 计时数据

来源为用户指定 reconciliation 与同目录 `ORIGINAL-START-TIMING.json`，原件摘要和派生结果见[证据索引](EVIDENCE.md)。这是离线预算代入，不是新一次真实冷启动。

| 子项 | 观察耗时 | 新默认预算 | 判定 |
| --- | ---: | ---: | --- |
| Django ensure | 330886 ms | 400000 ms | 不超时 |
| 完整 release 校验 | 151113 ms | 220000 ms | 不超时 |
| supervisor 启动 | 20677 ms | 90000 ms | 不超时 |
| AutoStartDingTalk 原截断子进程等待 | 91520 ms | 180000 ms | 该观察点尚未耗尽新预算；真实所需就绪时间未知 |

**在同样核心原生结果、没有更短显式父 deadline 和新门禁失败的条件下，模型中 Start 成功**：原证据已经证明三个必要阶段完成，核心分项合计 502676 ms（8 分 22.676 秒，不含未归因的阶段间开销），分别均在默认预算内。接收器会独立等待到就绪或自己的 180 秒期限，不再把核心 Start 推翻为失败。不能断言接收器一定在 180 秒内就绪：原 91520 ms 是 AutoStart 子进程被整轮 deadline 截断的等待，只提供下界；外层接收器阶段为 91657 ms。若仍不就绪，独立子项会 `timed_out`，Start 仍成功。

这不改写原事故事实：`originalStartExitedSuccessfully=false`、`originalStartDirectExitCode=1` 仍成立；后来的人工对账是独立事实，不能追认原进程退出成功。也不假定用户显式设置的更短父 deadline 已被取消。

## 定向验证与限制

命令、源码 SHA-256、原始输出及退出结果统一保存在 [verification.json](evidence/verification.json)，可在 b1 根目录运行 `node docs/start-timing-20261022/evidence/verify.mjs` 重现。

最终结果：新增定向 3 项及钉钉/总控回归 20 项全部通过；后端边界、PS5/PS7 语法、构建和差异检查均 exit 0。构建有原大 chunk、插件计时及路由静态分类提示，无阻断。PS5 语法检查 stderr 为模块首次加载的 progress CLIXML，非错误；其原字节与退出 0 均保留。

- 新增定向测试：PS5 与 PS7 各执行四项真实私有子进程超时；新阶段预算、显式父期限、原非零 exit 37/unknown、环境恢复、延迟接收器不阻塞 Start、原维护/后台失败、排空重查、连接迟到就绪、disabled/native 输出分类、独立失败和原 STARTED/FAILED 字节保留。
- 回归：钉钉原授权/单例、唯一总控与真实私有并发启动协调。
- 必需检查：PS5/PS7 语法、Django 生产边界、应用构建和 Git 差异边界。构建只在 b1 私有依赖与输出目录执行，未启动应用。首次复用现有依赖因缺少 `@xterm` 失败，随后改为 b1 内按锁文件 `npm ci --ignore-scripts`，构建成功；未修改共享依赖。
- 独立审查见 [REVIEW.md](REVIEW.md)，审查者未参与实现。一次新增回执保全断言受 PS5 测试替身的 Test-Path 干扰，改用 .NET 原字节比较后通过；前次失败输出保留在证据目录。

原总控回归中一条静态断言仍要求 `Get-ProcessDeadline` 的无参调用，已同步为 Start 1800 秒/其他动作 600 秒的约束并重跑。同轮私有并发协调三个用例已通过；失败仅来自旧静态断言，其原组合命令退出 1 和日志仍保留，不改写为成功，也不重复已通过的并发用例。

本轮没有生产完整冷启动、真实接收器连接或业务验收；没有承诺常态 P95、固定省时或正式运行已经采用。常用总控 `-Json` 仍沿原逻辑不透传 Worker 新增阶段字段；本候选的详细阶段和 observationPath 从直接 Worker `-Json` / 原发布步骤 stdout 获取，独立观察另读上述文件。该包装层展示建议未扩入本轮实现。

## S02 · 预算收紧、孤儿验证与基线同步

本节对应 S02：把三项核心默认预算从 480/300/120 收紧到 400/220/90，补孤儿进程与观测记录边界验证，并将分支 rebase 到最新 `origin/main`。只改默认数字与定向测试，未改任何逻辑分支、超时处理或错误码；环境变量名、1–900 取值范围、非法值失败关闭、`min` 保留更短父期限全部不变。

### 修正前后预算对照

| 分项 | 环境变量 | 原默认 | 新默认 | 依据实测 | 新余量 |
| --- | --- | ---: | ---: | ---: | ---: |
| Django ensure | `TERUISI_START_DJANGOENSURE_SECONDS` | 480 秒 | **400 秒** | 330.886 秒 | 69.114 秒 |
| 完整 release 校验 | `TERUISI_START_RELEASEVERIFICATION_SECONDS` | 300 秒 | **220 秒** | 151.113 秒 | 68.887 秒 |
| supervisor 启动 | `TERUISI_START_SUPERVISORSTART_SECONDS` | 120 秒 | **90 秒** | 20.677 秒 | 69.323 秒 |
| 核心合计 | — | 900 秒 | **710 秒** | 502.676 秒 | 207.324 秒 |
| DingTalk 独立观测 | `TERUISI_START_DINGTALKRECEIVER_SECONDS` | 180 秒 | 180 秒（不改） | 91.520 秒（被截断，仅下界） | — |

不变项逐条确认：环境变量名不变；取值范围 1–900 不变；非法值 `invalid_start_budget:<Phase>` 失败关闭不变；`Invoke-WorkerStartPhase` 仍以 `[Math]::Min($savedDeadline, now + budget)` 保留调用者更短的父期限，不清除、不延长。

### 为什么 710 秒仍然足够，余量还有多少

- 三项是**各自独立**的阶段 deadline（`Invoke-WorkerStartPhase` 每项重新取自身预算），不是共享一个 710 秒墙钟，因此单阶段抖动只消耗该项自己的余量。
- 收紧后每项仍保留约 **69 秒**绝对安全垫：Django 69.114 秒、release 68.887 秒、supervisor 69.323 秒；合计对实测核心 502.676 秒有 **207.324 秒（约 3 分 27 秒）** 的总体余量。
- 观测耗时来自单次真实冷启动，稳定在秒级波动范围内；69 秒垫子（对 release 约为实测的 46%、对 supervisor 为实测的 3 倍以上）数倍于该抖动，故 710 秒足以覆盖正常波动。
- 外层防失控上限 1800 秒（`Start`/`RestartFull`/`ObserveDingTalkStartup` 用 `Get-ProcessDeadline -TimeoutMilliseconds 1800000`）仍在，作为兜底；三项调满 900 秒也不会突破该父级上限。

### 最坏情况下「启动期间业务关闭」的时长上限

业务在 supervisor 就绪前对用户关闭，关闭窗口覆盖 Django ensure → 完整 release 校验 → supervisor 启动三个核心阶段。默认配置下的最坏关闭时长 = 三者各自耗尽自身预算：

三者合计 400 + 220 + 90 = **710 秒（约 11 分 50 秒）**，这是默认配置下的上限（不含阶段间微小开销）。

- 任一核心阶段超时会失败关闭并中止后续，所以只有三段都“接近但未超”预算时才逼近 710 秒；实际通常远短于此。
- 接收器观测在核心成功后才独立启动（`requiredForStart=false`），不延长业务关闭窗口。
- 整体外层硬上限 1800 秒，是防失控的绝对上界；即便把三项环境变量都调到 900 秒上限，也不会突破它。

### 孤儿进程与观测记录验证（修正二）

新增 `tests/start-timing-observation.test.ps1`（PS5/PS7 双跑，由 `tests/start-timing.test.mjs` 增用例驱动）：在隔离 RuntimeRoot 中真实拉起独立的 `ObserveDingTalkStartup` 子进程并按设计失败关闭，独立观察确认①子进程自行退出、无残留进程、生命周期有限（<30 秒）；②观测记录文件同一 attempt 只写一份，重复调用不新增、原字节保持；③不同 attempt 各一份。未改实现来迁就测试。

### 基线同步

分支 `codex/start-timing-20261022` rebase 到最新 `origin/main`（`61f891a8`）。预期并实际出现的冲突只有 `docs/任务记录/README.md` 与 `docs/文档目录.md`，按「两边新增条目全部保留」处理，未 `--skip`、未用策略参数丢弃任一侧、未 `reset`、未强推。rebase 后按 `evidence/verify.mjs` 重跑全部定向检查，原始输出与退出码见 [verification.json](evidence/verification.json)。
