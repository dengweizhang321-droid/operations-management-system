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
