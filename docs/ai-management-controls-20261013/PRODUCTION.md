# AI 管理发布执行状态

2026-10-14（Asia/Shanghai）。用户明确授权“发布上线”，范围为模型删除、默认模型选择及工具预算自由调整；此前用户暂缓的 Agnes 流式修复继续单独保留。当前状态：尚未上线，生产切换未开始。

## 当前生产基线与候选

吉客云已采用后，旧 `beff9877` 候选及其准备收据不再适用新前驱。新组合从真实已安装来源 `178df20ec32298fe84ec503654b1380d0c36f1f4` 叠加已合并的 AI 4 文件修改，得到 `f75b7b723a278a5903286ed93f5ce2123ec74904`；远端 `codex/ai-management-production-20261014` 已回读保全。首次远端 unpack 失败保留，普通重试推送成功，没有强推。

Git 完整差异仍只有 AI 管理页面、配置、路由及测试 4 文件，均与已验证候选逐字节相同，复用原相关检查。吉客云代码及已采用的两项审计迁移保留，migration 全部不变。新 v2 范围计划 `0b64f5e6372ed8211102dae45eb417485a0ef8d60d2e6435c6e2a52703573a93` 为 Worker + Django、无 migration、无未知路径。继承快照中的 3 个 BAT 因 CRLF Git clean filter 显示修改，但原始字节同时等于 HEAD blob 和原安装来源；证据完整保存，未提交/隐藏/改写脚本。

| 绑定 | 值 |
| --- | --- |
| 正式 Django 前驱 manifest | `4fb134f17cd22018045b87a2852ea874d5d9f3e3c36900a3e8750dc0e572e321` |
| 正式 Worker 前驱 | `20261013T145450Z-fe391dce49a258cf` |
| Worker 前驱 manifest | `51aefd56a68ae84df34e606db2c508092511b1ae24d118fd50cca33333016c6d` |
| 新 Django PrepareApp ID | `3eebd5f0deb64d2a995265ef55221a2d` |
| 收据 SHA-256 | `78cb7d36785d80e07546322dfae85b066c073694cf39b64094ec76fc466d9ec0` |
| 新 Django manifest | `6982c8721b068498837a8b0196307d418f50798b4bf69f81b593c55e1203c43c` |
| 新 Django 应用指纹 | `5e07fb9c5fa65d7ce46b9ea81d269e3fe9b2446b8dfb99af1eb4dea84b53ddcf` |

Django 在线准备正常退出 0。逐文件实包仅 3 个后端路径及原 R2 smoke 的 cf 传输缓存差异，原变更清单和完整指纹封存。Worker 尚未开始新原在线准备，必须等前一个封存批次按原入口释放所有权。

原安装的数据库工具已 Verify 当前保留恢复点 `E:/运营管理系统业务数据/daily-20261013T051108Z-77715d3b35da`，返回 completed、`serviceStateChanged=false`。manifest SHA 为 `b2bc4142950291ff369fa723550fef6f0aaafedb3c0b8932d609414a4d8ed893`，dump SHA 为 `698f9a55b9526265151b0fe03e762bfad301617c36f4c967e5ee732881b44753`。没有新增备份或执行恢复，不把历史备份时间说成本次生成时间。

## 原批次协调阻断

原已切换的批次 `jackyun-direct-d3c0172c6400` / `639f410937aae7aa05d6a2418bf4050f6ee21a7a91ca03df806860916efa6d7f` 留有用户此前取消的两项收尾，原 active 占用保留。用户已明确允许只完成 `aggregatestatus` 和 `check-natural-watchdog`，并明确授权联系原“完成吉客云自动恢复重试改造”聊天；此授权不包含重放已 passed 的发布/迁移/n8n/业务步骤。

本聊天调用原封存执行器时，源码树、库存、Node、runtime 配置、npm 和 toolchain 与旧绑定完全相同，只有整个继承环境 SHA 不同，原身份门禁拒绝。失败保持，不复制/猜测另一个聊天的凭据或放宽环境指纹。原聊天已接续，汇总检查通过；自然看门狗产出真实控制阶段失败帧，原操作保持 unknown，未用人工成功或后续健康回填旧失败。

只读现场同时发现 Django supervisor PID 回执缺失，状态停留在旧时刻且 `supervisorScriptSha256` 与已安装脚本不符。原 Run 读同一无效状态后拒绝，不能仅重跑 Run/Arm 或手工修改/删除状态冒充恢复。原聊天仍在核验受控恢复及定时上下文诊断方案；需要明确的临时计划任务授权时，先准备精确名称、脚本摘要、权限、时限与删除方式供用户确认，不擅自注册任务或变更原调度。

## 未执行与后续

本次没有 EnterMaintenance、Stop、Worker apply、DeployApp、HardenAcl、Start、migration 或真实模型配置写入。没有清理原 active、修改原批准批次、将失败标成通过、补跑业务或发送业务消息。已完成的代码/验证/来源/后端准备和 backup Verify 保留；证据位于 `D:/codex-artifacts/ai-management-production-20261014`。

原占用合法释放后，重新核当前前驱，执行原 Worker online plan，仅准备一次 Worker 制品，再走唯一生命周期入口按本次已授权范围切换。常态服务和监督器从普通用户入口恢复；只确认部署成功、目标版本和必要服务可用，不追加本次综合验收或等待自然监控。若生产前驱再次变化，旧准备收据失效，须按实际新基线保留已上线内容后重新准备。

## 定时上下文诊断待确认

原聊天在仅复核授权收尾后，确认普通会话控制命令可通过、自然任务却持续失败。一次性可审查诊断方案已保存为 `D:/codex-artifacts/jackyun-live-test-20261014/ONE_TIME_DIAGNOSTIC_PLAN.md`，任务尚未注册或执行：精确任务名 `TERUISI Jackyun Watchdog Diagnostic 20261014`、原普通用户 Limited/Interactive 权限、无触发器、原 NoConsole launcher、只运行一次状态探针、硬时限 2 分钟、调用器等待最多 95 秒、结束按精确身份停止及注销并确认不存在。

探针 SHA `e3c953b2eafe3fa52cc3e441c86e687810c6d6e6806dd9ff5832c75c588bc186`，执行/清理脚本 SHA `687b8b4c8b214f732c9fdf873f60aafe2c86633710c2acf10d17866708b7508d`。不修改原任务、调度、频率、权限，不发送通知或触发业务；成功结果也不能计作原自然健康帧。该操作属于计划任务注册，超出之前两项只读收尾的授权，已向当前用户明确请求对应授权并保持待确认。AI 发布授权继续有效，尚未因本次执行完成发布。

## 12:21 当前制品就绪并按用户优先级让出窗口

用户再次询问检查完成后是否可直接发布。最新只读核对：旧 active 已释放；正式 Django 已是 `8b4fed2c3cb8e0206ae8cc492e15f9646ef2dbbd7bbccde2b386fe9770ce02ac` / 来源 `d9ccdd82`，Worker 是 `20261014T024227Z-c3a176ee85a03642` / manifest `81b84f00df90f29f86fdce50cbd8b5a8c4e2374cb0a9dba4030aef20799bb680` / 来源 `22df75fd`。这两个组件实际来源不同，不能直接从 Worker 来源部署 Django，否则会覆盖已采用的授权查询版本回执头。

从实际两组件来源形成基线 `e14b5fea`，仅把当前已安装 Django 的两工作流文件原样保留，之后叠加 AI 4 文件，候选 `9dfedcb0c9d0fe0dd87340fe7e58c907ee57ec0a` 已推 `codex/ai-management-release-current`。新范围计划 `1a2c8edf413dddbf817389bcabb14f9d80c62eb2d491514784cf2455fc9ac3ca`，无 migration。运行后端包逐文件只有 AI 配置、路由、新测试及原 smoke 的 cf 缓存差异，工作流修复保留；原有效功能验证复用，不新增综合验收。

- Django 准备正常退出 0，82.244 秒；ID `b058214d6ac04ba3bd167f5786899dc0`，收据 SHA `6632f8f20935ba4a959864e3c3f848673f55c6e0e58ad25ef401ac9a59b7b87f`，manifest `53c63261c3d646b3dcfdb06d17c6385aa22f3b244ea9a23a7b2f7610ed3368f9`，指纹 `50adae4e8eefa400653ab9bf76691b4f42c974082000b9450afb83c480c8ac39`。
- 原 Worker 在线准备 12:18:06 正常完成，plan `54fc9b40ea1ae3bb145363ca971be9f1e4e7207442ff3b95af8bcc41d0a1f615`，制品 `20261014T040249Z-f92c0e4f91af265b`，manifest `a6bbb9e14233831620d37cc1f89b0193e915ebbc18470991386663ea1fe49599`。来源绑定 `521c478f3882c34b1abc21f00bc72de067103c13a74d3365e932cae109e48100`。

随后原聊天转达用户“允许，通知它让吉客云先发布”，本聊天通过 read_thread 实际 userMessage 核实该指令，按本次优先级暂停后续 AI 发布。当前准备进程 38640 已结束，原 plan 的 finally 已释放自己的 rotation 租约；不会再次领取锁，不开始维护、Worker/Django 切换或服务启停。12:21:14 现场仍为上述正式前驱，无本次 publication-started、无维护 gate；rotation pipe 已存在，不将它宣称为此时无人持有（可能是接续发布者）。保留全部新制品和原证据，状态见 `D:/codex-artifacts/ai-management-release-current/WINDOW_YIELDED.json`。

**AI 尚未上线。** 当前是按已核实的用户发布优先级让出窗口，不再是代码检查未完成。吉客云先发布后这些 plan/收据必须重新核对前驱；保留新吉客云修复再准备必要组件，不可直接重放旧计划。该指令仅调度本次窗口，原 AI 上线授权仍保留，不自动授予其他代码或业务发布。

## 吉客云优先发布完成后的前驱更新

原聊天通知新 Worker/helper 正式采用；本聊天独立回读正式进程回执及 `D:/codex-artifacts/jackyun-live-test-20261014/wrapper-helper-adoption-2/publication-result.json`：Worker 已为 `20261014T042045Z-3fa896145ddb534d` / manifest `9b55e7afe806e6f8a2ebeae3bf0610b0fddb88ca311a049d8f8c86c1eb58de6e`，来源 `8872ae460b7b4536fed6e5e505ca169143066f50`；Django 仍 `8b4fed2c…`。原结果 deployed，现场 maintenance/drain 均不存在。不把它说成 AI 已发布。

原任务报告唯一真实恢复 9011 已过 A 并持有共享 helper，要求继续让业务优先。本聊天未查询经营内容或触发业务，只保持 AI 不维护、不切换、不领取发布锁，保留全部制品。旧 `54fc9b40…` plan 绑定 c3a 前驱，现已不能直接采用；后续 source 组合必须保留已上线的 `15ac8282` 前置证明兼容修复及当前 Django 内容。9011 当前运行状态属于原任务报告，业务完成与发布完成分别记录，不自行补跑或干预其 owner。
