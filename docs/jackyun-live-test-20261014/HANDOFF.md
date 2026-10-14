# 吉客云正式环境真实测试交接（进行中）

2026-10-14（Asia/Shanghai）。用户明确要求在当前正式环境真实测试，并进一步要求“先闭合，再执行一次”。不得把源码/隔离证明算作真实五表业务成功。

- 原任务：n8n 8548 B 失败；今日 00:10 自然执行 8841 在 A 失败，未到 B/C/D/E。正式两条 n8n 流程仍为已发布版本 `80ea7e87-679f-42b6-a9ab-c990c92ecf5d` 和 `6c6482e0-2937-4117-9fbc-e31a716354e7`；开始前无 in-flight。
- 已从正式页面对 8548 点击完整重试一次，页面返回 helper 503“独立执行单元异常”。刷新后按同一页面的相同请求编号再协调一次，仍 503。Django 授权回执 completed/200、授权 ID 精确一致；helper `human-dispatch`、`human-authorizations` 均不存在，n8n 无新执行。**不得换新请求编号盲目派发。**
- 原受控 `tools/jackyun-preflight-recovery.ts plan 8548` 给出 `closed_before_business`，源与当前正式 Worker source-snapshot SHA 一致。用户授权下已对 SHA `bfd62b5212a7e0f8c1aeec13afb417745f5bc5cbb2de8e647733653c994f8998` 精确 apply 一次；回执 `910f8fde351be29afb94faef91340550a655515aad9bac3578012b93bb44c65e`。原 plan/active/失败历史保持。8841 无独立采集计划，原工具 plan 8841 拒绝，未伪造闭合。
- 原因：`backend/workflow/views.py` 的授权 GET 成功响应缺 `X-Workflow-Data-Revision`，Worker `requestDjangoWorkflowJson` 要求该头，所以有效授权查询变 503，helper 隐去细节。当前分支加上 `revision=revision_value()` 与回归断言；隔离 Django 3/3 通过。源码提交 `7785fdd24771f46f5bf6606d9cb6d13f52420572` 已推 main/开发分支；**尚未部署**。
- 为保护其他尚未采用的 main 变更，从实际前驱 `178df20e` 组合来源 `D:\codex-isolated\jackyun-live-adoption-source-20261014`，提交 `d9ccdd82ff049b5d47db26f00f0da6bdb20cbad2`，仅叠加本次后端修复和测试。正式 `PrepareApp` 成功：`2eac13dfda7e4938a87a7acf71f0af72` / receipt `27ceef8d092c6fdb976eee0d4d0f08c4bd244c26b5021e26a07fc1cdf7fcebea`。完整运行包逐文件比较（排除生成 pycache/.wrangler）：实际只变 `backend/workflow/views.py`。**尚未切换、维护或停服**。
- 旧正式发布批次 `jackyun-direct-d3c0172c6400` 用原 `executeBatch`、默认完整身份复核和原 SHA 续接；AggregateStatus passed。`check-natural-watchdog` 于 01:52:30 **unknown**，原 WAL `000068.json` / `old-owner-close-failure.json` 保留；exec session 98933 已退出，不要无证明重跑。观测帧 1 是既有基线，帧 2 是真实新鲜失败帧（`healthy=false, probeError=true, processDiagnostic.stage=control`），不能追后续绿色帧抹掉此失败。
- 正式看门狗从 00:03 至 02:07 连续失败（State `lastHealthy=00:02`），网页、helper、ready/live 四探针均 200，普通交互上下文的原控制 `Status -Json` 和借用同一 NoConsole launcher 的只读调用均通过。定时任务是原普通用户、Limited、Interactive；只读进程环境采样的 TEMP/TMP、PATH、PSModulePath、deadline/library-only 常见标志无异常。任务自身每分钟的控制阶段失败原因仍未确认；**不修改旧任务调度/脚本、不手动制造自然看门狗通过、不删除 release active**。
- 备用只读诊断脚本及方案保存在 `D:\codex-artifacts\jackyun-live-test-20261014\ONE_TIME_DIAGNOSTIC_PLAN.md`。用户已明确选择**不创建临时任务**；`run-watchdog-scheduled-diagnostic.ps1` 不得执行，临时任务从未创建。
- 后续只读诊断：定时任务与当前会话为相同用户、Session 1，TEMP/TMP 均为同一路径，常见环境标志正常；定时器的控制子进程在连续采样中未观察到。手工以原 NoConsole launcher、原 watchdog 工作目录执行同一只读调用，控制 Status 可通过。持续失败的自然帧不可忽略。任务计划程序无 4100 错误事件可用。
- **第二个独立问题**：`D:\teruisi-runtime\django-sales\run\django-supervisor.pid.json` 缺失；`monitoring/django-runtime/state.json` 停在 00:02，desiredState=stopped、health=stopped，记录的 supervisor 脚本摘要与当前已安装脚本不匹配。单独对已安装 `django-runtime-supervisor.ps1 -Action Status` 只读调用返回“state 版本或脚本摘要无效”；在当前普通会话下调用 `Get-WatchSnapshot` 可过控制阶段，但于 supervisor 阶段失败。这表明即使定位定时任务控制失败，还需通过受控入口修复监督器状态与进程；不能自行改 state、伪造 healthy 或直接删除记录。
- OpenCode Go/AI 管理另一聊天 `01a1348d-c304-7e12-8139-6bb3cc854836` 也已获用户明确批准续接原两项只读收尾，且 AI 后端候选已准备，但尚未切换。它正等原发布 owner 释放。**不能并发切换本次 Django 修复和 AI 候选。** 若 AI 先发布，本次 PrepareApp `2eac...` 的前驱将过期，必须以新的真实前驱重新组合/准备，只保留本次视图修复并保留 AI 已上线代码。
- 本轮证据在 `D:\codex-artifacts\jackyun-live-test-20261014`；旧发布证据在 `D:\codex-artifacts\jackyun-migration-adoption-20261013\direct-publication-final`。主目录无关修改与旧开发树 59 份日志保留。候选工作树 3 个 `.bat` checkout CRLF 虚差异未暂存；运行包不含它们。
- 下一步：等旧批次只读收尾归还 release `active.json`；然后按最新 AGENTS 的后端单组件流程用已 prepared app 原生命周期受控切换、完整服务恢复。切换后只用**原授权请求编号**验证 GET 授权及原页面重新派发一次；无新执行时先查回执，不生造第二次请求。若执行启动，跟踪 A/B/C/D/E 和五类权威批次、日期与归属。运行中新错误按原门禁停止，绝不删除业务 active 或重复提交。

## 删除对象纠正（2026-10-14，优先本段）

- 用户要求删除的实际对象是 Codex 侧栏每 5 分钟的“等待 OpenCode 发布后接续吉客云”自动化，ID `opencode`，不是 Windows `TERUISI Operations Watchdog`。先前依据含糊选择曾误删 Windows 任务；从删除前保留的 XML SHA `6ba7f101d28a280c85a3e2d8066ef6f0f624c67b6a148d2021dbf486915660c4` **原样恢复**，任务名、动作、参数、工作目录、普通用户、Limited、Interactive 和 2 个触发器均核对一致，状态 Ready。用户已知误操作与恢复。
- Codex automation `opencode` 已用 app 工具 `automation_update` 精确删除，工具 `deleteStatus=deleted`。这次纠正**不授权删除或豁免正式 Windows 看门狗**，不能据之前误解清除旧发布 active 或把自然监控失败写为通过。
- 当前优先本次吉客云后端派发修复，AI 管理另一聊天当时 idle 且尚未切换；仍应在每次正式切换前重核实际 Django 前驱及维护 owner，防止并发发布。原 old-batch WAL 的 `check-natural-watchdog: unknown` 和发布 active 保留，需找出受控恢复路径；不可直接使用已准备候选绕过协调锁。

## 2026-10-14 续查：看门狗失败的可验证原因

- 08:47 的正式 `operations-watchdog/latest.json` 仍是 `healthy=false`、`probeError=true`、`processDiagnostic.stage=control`，control 阶段 38 ms 失败且无子进程证据；计划任务 `LastTaskResult=0` 不能解释为健康。
- 正式计划任务执行 immutable 版本 `ff4e25622f243fbf733a5cca14eaf0fd2712e03514e4d5dec5bfeffbdfa9ccf0`。其 `driver-binding.json` 对 `backend` 固定摘要 `c38963671a02a224e3e537a9e13f70005e85e0e65a8616423c8e1f5fbed019af`；这正是 `django-sales/app.previous/tools/django-local-service.ps1` 的实测 SHA。当前 `django-sales/app/tools/django-local-service.ps1` 为 `7e9a3a88421d4ba3c1c763e62677ab05f16e58ab9c686ff46f7491fa5a1a63fa`，与 desired-state 绑定一致。control、worker、transport 三个绑定摘要均与现有文件一致。已安装看门狗 `Resolve-WatchStatusControl` 因这个 backend 摘要变化抛 `diagnostic_predecessor_changed`，且该调用先于控制子进程启动；解释了每分钟控制阶段失败。不可直接改 immutable binding 或把失败标成功。
- 现有受控 `watchdog-install.ps1` 的安装入口要求 `Get-WatchSnapshot.healthy=true`，所以当前源绑定漂移使常规重新安装也被阻断。需要对精确前驱设计并验证受控恢复路径，保留原任务身份和触发器；用户此前拒绝新增一次性诊断计划任务。旧发布 `active.json` 与失败 WAL 尚保留。未运行任何跳门禁闭合脚本；因错误理解删除目标所草拟的 3 个未追踪脚本/证明文件已精确删除。

## 2026-10-14 已批准四步恢复（执行中，优先本段）

- 用户明确批准按四步修复并发布/真实测试。安装器检查**候选**快照，不是必须旧绑定先健康；无需修改安装器。此前手工通过来自 root 旧 watchdog，正式计划任务来自 ff4e immutable 版本，入口差别已核实。
- 候选已在 `D:\codex-artifacts\jackyun-live-test-20261014\watchdog-candidate-v1` 准备；所有可执行字节与 ff4e 保持一致。完整两文件差异已审查：backend 只加 17 行审计准入/打包；supervisor 只去掉允许 previous 状态摘要的兼容。候选绑定新 backend/supervisor，控制阶段实际通过 Running/Ready/exact_release，只剩 supervisor 旧状态失败。旧生成器不支持已具有 ReadOnly 的 resolver，原生成失败保留；复用已安装安全 wrapper 并核对其依赖函数完全不变。
- 已执行原 EnterMaintenance，ID `628491c7c86b4e85a7fa2344b47899d2`，全部应用停稳，PostgreSQL 保持。归档器在原 Worker/Django/supervisor 锁下核对部署/脚本/旧状态摘要、无旧 PID/回执/实际 Run 进程、drainedStopped 后，原子归档 `state.previous-15b0e4bf5fd663322239ed7f8badc86ef120ab4e0e5e4cd350d2388a0a072058.json`，原字节保留。没有伪造新状态。
- 正在运行原 ExitMaintenance → Start，exec session `75618`；日志 `recovery-exit-maintenance.log`、`recovery-start.log` 位于本次 artifact 根。完成后调用候选中原 `Restore-WatchSupervisor`，再检查候选健康、原 PlanInstall/Install 更新原定时任务 Action。原任务及触发器保留，无临时任务。
- 下一步按 `resume-original-closeout.mjs`：把旧 natural 观察完整移至同观察目录下的 `natural-before-monitor-repair` 并记录原路径/摘要，原 WAL unknown 明确协调为 failed/noEffect，原检查用原代码/参数在原位置生成新一轮证据；只允许 check-natural-watchdog 重执行。然后用已准备 Django 单组件候选正常发布，最后同请求真实测试。

### 09:24 进展

- 第一轮维护已正常退出；原 Start PID 77400 写出 started，完整启动计时 completed。外层 pwsh 72936 因服务后代继承输出句柄等待，核验 native operator 已退出后仅结束该精确外壳，未终止服务树；证据 `recovery-start-wrapper-cleanup.json`。不能把旧 exec session 75618 的管道挂起当作仍有生命周期操作。
- 当前 supervisor 已由原 Restore-WatchSupervisor 恢复，健康状态 `all_components_ready`、绑定当前严格脚本，候选快照全健康。原 PlanInstall/Install 已成功安装 `ceee38dabd66ea9cc77622679d35bf601367f0582ac00fcfe5074dc10940c940`，plan `bc24c6220488966f762d836bc1ed056f260e4da27a335f09ea0a9c8b2ad2c61f`。任务已启用，Limited/Interactive、2 触发器、PT1M 核对；已有自然 healthy 记录。
- `resume-original-closeout.mjs` 已运行，exec session **60925**，原 WAL 000069 将旧 unknown 协调为 failed/noEffect，旧观测字节已归档并记录映射；原批次完整初始身份复核 000071 通过（310 秒），正在做操作前第二轮复核，随后原 observer 自然观察两轮。不得再次运行该脚本或抢占发布锁。
- 后端计划 `backend-publication-plan.json` 已生成；`publish-backend.mjs execute` **尚未执行**。只在原批次完成、active 消失后执行；使用原全局 rotation lock、原 PS5 传输、原生命周期入口和 direct-exit-files 协议。目标 manifest `8b4fed2c3cb8e0206ae8cc492e15f9646ef2dbbd7bbccde2b386fe9770ce02ac`，无新增迁移/备份。
- 权威数据库只读核到唯一原授权（不在聊天/仓库存 UUID），保存 `existing-human-authority.json`，completed/200且未过期；真实 GET 基线仍503。后端上线后依次运行 `retry-existing-authority.mjs check`、`dispatch`，复用原 ID/请求体，create-only派发记录防止操作脚本重复执行。脚本通过应用原公开 POST，同一权限/回执/helper/锁链路，不直接拼 n8n 执行。

### 09:32 原观察器时序边界与当前在途

- session 60925 已结束，exit1。原 WAL 000074 unknown：原观察于09:27:03开始，第二个新写入样本本身 healthy=true/probeError=false，但09:26:27开始、09:27:08完成，因此原 validator 拒绝“基线之后出现新的窗口前样本”。生产监控保持健康，此失败不等于监控再次故障。
- 新复核将原失败明确协调为 failed/noEffect，保全第二轮全部观测到 `observations/natural-attempt-after-repair-before-alignment`。目前 **exec session 28412** 正在执行 `resume-original-closeout.mjs aligned-retry`，日志 `original-closeout-aligned.log`。WAL 000075/000076 已追加，初始准入复核进行中。不要重复运行。
- 唯一调整是原 executeBatch 的 beforeOperation 只读等待：task Ready、最新健康样本已完成且属于上一轮实际任务、下次触发还至少6秒，再调用完全不变的原封存观察器。等待≤180秒，运行意图摘要变化即停；不手动触发任务、不改变调度、不放宽原健康/新鲜度断言。完整静态/动态准入仍走原 collector。
- 后端正式发布仍未执行；完整计划已就绪。等待 aligned result 成功及 release active 实际消失后，运行 `node docs/jackyun-live-test-20261014/publish-backend.mjs execute`；无需再生成计划或候选。

### 09:43 原批次已闭合，后端正式发布中

- aligned observer 成功，session28412 exit0。原 WAL 000080 `check-natural-watchdog: passed`，000081 `completed`（上海09:43:09）；原 release `active.json` 已由原引擎删除。两轮旧失败、对应 failed 协调、旧观察归档仍保留。
- 正在运行 **exec session47987**：`publish-backend.mjs execute`，日志 `backend-publication.log`。原全局 rotation lock 覆盖全部步骤。新维护 ID **`f6237698e91042bb9214186425d879e2`**；当前是 EnterMaintenance/KeepPostgres 阶段。这个脚本 create-only 阶段审计且未知不重放，不能另开一次同脚本。
- 发布源/准备收据仍是 d9ccdd82 / 2eac13dfda7e4938a87a7acf71f0af72 / 27ceef8d...；只改 Django 授权 GET 头。目标 manifest8b4fed2c...。后续脚本自动依序 DeployApp、HardenAcl、ExitMaintenance、Start、VerifyStartup；没有新迁移、备份、Worker apply 或 n8n 定义变更。
- 脚本完成后确认当前 supervisor 已由原恢复链运行；必要时调用新安装看门狗中原 `Restore-WatchSupervisor`。随后 `retry-existing-authority.mjs check` 验证原授权GET由503变200且响应完全一致，再 `dispatch` 一次，跟踪新 n8n 执行及五类权威批次。不要重建授权 ID。

### 10:10：Django已上线；真实执行暴露旧闭合回执兼容缺陷，修复验证中

- **session47987 exit0，正式上线完成**。`backend-publication-result.json` 时间09:55:45，Django manifest **8b4fed2c3cb8e0206ae8cc492e15f9646ef2dbbd7bbccde2b386fe9770ce02ac**，Worker仍51aefd56...。维护/排空均退出，supervisor经原Restore恢复healthy，正式看门狗已再次自然healthy。原授权GET从503变200且原响应完全一致。
- 用唯一原请求ID真实派发一次，HTTP200 accepted_pending_execution；主n8n **8956**（09:56:42–09:56:48）在A失败，未到B/C/D/E；错误触发器8957 success只表示过滤完成，不能算业务成功。
- 原因已复现：8548已有有效version1 operator闭合回执，新统一采集分支仍调用publishHumanPreflightClosure以create-only写同路径，Windows拒绝覆盖。不是管理员/浏览器/导出故障。旧回执原字节、临时v5文件、active仍8548、新计划8956、collection-reservations/8548/8956.json及recovery-control/8548/0001.json全部保留；**不能删除/覆盖/手工推进active或重新POST旧已消费授权**。
- 隔离源码修复在当前开发树：`lib/jackyun/preflight-recovery.ts`新增仅针对version1的完整旧证明复验/原样复用，人工及自动publisher在新执行/授权和新鲜零效果证明核验后调用；原子writer/fence不改，其他绑定版不放宽。测试 `tests/jackyun-automatic-preflight-recovery.test.ts`新增完整统一A复现（人工/自动）及损坏旧证明拒绝。before-fix日志精确复现同一错误；after-fix 2/2通过。
- **exec session77414** 正在运行三份直接相关回归（automatic-preflight、preflight、unified-pipeline），日志 `legacy-closure-focused-regression.log`；尚未取得最终退出码，不能提交这两个源码文件或宣称全部通过。当前在合成五表不同模块响应丢失恢复测试，已见products/inventory通过。无生产导入测试副作用。
- 下一步回归通过后提交/合并/推送这两个文件，再准备Worker/helper-only制品；Django8b4保持，不重新部署。已创建独立组合树 `D:\codex-isolated\jackyun-legacy-closure-adoption-20261014`，分支 `codex/jackyun-legacy-closure-adoption-20261014`，基础为真实Worker来源178df20e；还未拣入修复。checkout有3个.bat CRLF虚差异，须按真实冻结来源逐字节校正，不纳入改造。此树node_modules只有空目录（误判需要复制npm后发现全局bundled npm才是工具链来源，无生产变更）。
- 开发树node_modules Junction已在精确路径/原Target/相同package-lock验证后，只删除并重建本链接，现指向旧统一开发树的完整依赖；未删除任何目标依赖。当前测试使用该有效依赖，源包锁无变化。
- Worker准备应复用原prepare-worker.mjs模式：新来源绑定实际当前Worker head、完整源码清单和工具链，再原plan prepare-online；旧绑定与旧plan不可换绑。当前已有独立原batch active已解除。新真实重试须先复核8956的A零效果及reservation可由原机制接续，再由正常入口对当前失败尝试申请新授权；旧授权已绑定8956，不能把同一UUID换绑新execution。
- 其他AI任务基于旧Django4fb的PrepareApp现在已过期，后续必须以实际8b4重新组合，保留授权头修复。没有向其他聊天发送消息。
