# P3-C：Pi 有界上下文恢复清单

日期：2026-11-07。状态：独立开发候选，未合并、未上线、未采用 Runner 新来源。

基线：`origin/main` 的 `3c34498c`；分支 `codex/ai-context-resume-20261107`。
范围来自[统一方案 §13](../ai-assistant-unified-plan-20261029/PLAN.md#13-p3-cp3-a流式上下文知识及responses)。本小项不修改供应商流式、知识索引或 Responses。

## 原实现核查

- Runner `server.py` 在初始化时关闭 `set_auto_retry` 和 `set_auto_compaction`。Pi 1.3.0 的持久会话仍在专属 named volume；本次不更改 Pi 内核或会话文件。
- 原手动 compact 已走 Django `PiControl` → 独立 `workspace:compact` operation → Runner 原 RPC `compact`，使用原网关能力、控制序号和终态/文件收集回执。浏览器重复连接不构成模型请求。
- `provider.turn(preserve_context=True)` 已保留完整消息，并按模型上下文窗、用户输出配置及 `max(2048, ceil(window*0.05))` 工具余量拒绝超预算；不会固定删除旧消息或自动降低 maxTokens。
- 缺口是没有一份可见、可追溯的恢复清单；此外 Runner compact 分支只核 phase/seq，未单独排除仍运行的 PTY、本地工具和未决交互。

## 实现与正常入口

新增 `backend/ai_assistant/pi_context.py`，从原 Pi operation/control/dispatch、用户事件、计划、业务意图/确认及文件元数据生成 `pi-recovery-v1`：

- 保留可证明属于当前原生分支的目标/用户决定；未绑定或已切换分支的原目标/用户记录明确标为历史线索，不加入 compact 当前目标/决定。另保留确切计划 ID 和版本、授权意图 ID、确认/预览摘要、文件 ID/SHA256/大小，以及原取消、终态、unknown 和待办证据。
- 原文只作逐字证据，不自动分类“已确认修正”，不猜测未记录的目标或步骤完成情况。问卷回复、摘要和文件内容均不是新业务授权；不会写个人永久记忆。
- 每类最多 8 条，文本默认最多 1200 UTF-8 字节，计划片段最多 2000 字节，清单上限 96 KiB。所有省略显式返回 `truncated`/`hasMore` 与来源 ID；不会读取附件字节、dispatch response/providerFrame 或隐藏推理。
- 正常 `GET /api/ai/pi/sessions/{sessionId}/workspace` 附带清单。UI 沿用 Pi 工作区，增加可展开的“上下文恢复清单”，不更改 `ai-pi-agent-view.tsx`。
- 较早用户控制记录用 `recoveryBeforeControlSeq` 分页；精确原记录用 `recoveryControlSeq`、`recoveryTextOffset` 逐 1200 字符读取，附完整原文摘要与下一游标。原用户消息继续从已有 events 游标读取，计划/文件/业务动作继续引用原证据。
- UI 读取原记录使用 GET，取消旧读取并核 epoch/generation，不重发 operation、dispatch 或控制请求。环境隔离后不返回清单。

手动 compact 在原 authority 事务内冻结恢复清单，写入原 compact operation 的 payload；传给原 `customInstructions` 前剔除未证明属于当前分支的历史目标/决定。客户端请求摘要、control ID、controlSeq 及重放规则不变；同 ID 重复只观察原回执。

压缩前补查未决 operation/control/dispatch、业务动作、下载活动以及已观察的 PTY/交互状态。压缩排队或执行期间禁止新增工作区写控制。Runner 在原 compact 分支再次核验实时 PTY、本地工具、bash、交互及活动，避免把 Django 旧观察当作实时空闲证明。正常读取不实施恢复、续跑、自动压缩、供应商切换、参数降级、文件外传或生产启用。

预算展示复用现行公式，只展示配置中的上下文窗、输出和工具余量；完整原生上下文实时用量未观察到，返回 null，既有超预算提示或用户手动 compact 才是触发来源。本次没有添加自动触发策略。

## 隔离核验

- Python 3.12 / Django 5.2.17；明确 test/development，清空数据库 URL、`:memory:` SQLite。首轮增量 19 项定向 SQLite 检查通过（后续最终 24 项隔离 PG 结果见文末），包含原只读/身份/unknown/分页检查、真实签名 GET 和 compact 的同 scope reset/换 scope/店铺/角色计划隔离、过期子代理根 epoch、原生 session_new 的分支线索隔离、真实 worker 的立即/异步迟到未派发拒绝收尾、Runner 原控制证明与后到 export 并发反例，以及原 compact operation 路径与单店快照隔离。
- 改动前端及直接组件依赖的严格定向 TypeScript 检查通过。全仓 `tsc` 被未修改路径的类型错误阻断（包括历史 demo、市场候选与发布测试）；没有将该命令报告为通过，也未扩入无关修复。
- [preview.html](preview.html) 从真实恢复组件静态渲染，只含合成材料；使用 headless Chrome 通过 `file:///D:/...` 打开，验证 details 展开和合成原记录交互，外部网络请求为 0。没有启动在线预览或展示浏览器。
- `git diff --check` 通过。源文件摘要和检查命令见 [validation.json](validation.json)。

这些检查不声称已经执行付费模型、真实 Pi 原生摘要语义恢复、生产业务调用或 Runner 服务切换；原 native compact 的完整运行/文件收集协议保持不变。

## 交付与采用边界

Worker 前端、Django 和独立 Runner broker 源码均有变化，无 migration。
`backend/pi_runner/workspace.py` 是容器外 broker 源码：`containers/pi-agent/Dockerfile` 不复制它，镜像构建输入仅为 `containers/pi-agent/*` 及 `bundled_skills`。因此本小项改变 Runner `source_digest()`，没有改变容器镜像输入，无需为本次安全点检查重建同一镜像。

采用必须经既有 `runtime_upgrade` 及发布入口绑定新 Runner source、原精确 image 和既有权限/互斥/未知状态门禁。本次没有构建或采用镜像、安装/重启服务、迁移、合并 main、准备发布制品或上线。主负责人在独立审查后决定后续交付；合并、准备及上线仍分别遵守当前授权边界。

## 独立反审后的增量修正

1. 计划可见性统一由 `pi_native.visible_plans` 判断：原根会话当前 generation 的 `plan_saved` 事件、scope/owner/role及子代理保存的 root epoch/generation共同证明来源。同 scope reset 也不沿用旧计划文字；新保存事件追加精确 rootBinding，旧事件只在原当前代际且内容摘要一致时复用。snapshot、recovery、计划批准与历史分支计划续接使用同一判断。
2. 压缩期从读取准入移除实际会写文件的 `export_html`；根树原生新写也在原 authority 事务阻止，真正只读和用户取消保留。Runner用同一 session.lock登记 compact 占位与写者，后到 export/写者不能越过原安全点。
3. native compact绑定前的确定拒绝由原 control 持久保存精确 operation/seq/未开始证明。真实 worker核该证明、原派发账本及无模型派发后结束原 compact 为 failed/canceled；accepted尚未绑定时先只读原workspace/control，不对上一run调用native state；不等待不存在的 native run/file receipt，不伪造文件收集，不把缺失/不匹配证明当成成功。
4. 新 prompt记录原生分支ID和历史控制序号。历史无绑定或session_new/switch/fork后的目标/决定只作带标签的线索；当前目标未知保持未知。正常入口的原生 session_new检查还暴露独立session实例追加事件后的旧event_seq，已在原事务内回读事件序号后再追加workspace事件，避免真实入口产生唯一键冲突。

## 第二轮确证反例与真实 PostgreSQL

- `native.messages` 与 `workspace.native.messages` 统一使用 `visible_messages(session,state,root)`。新消息在原不可变 `agent_message` 事件记录 root及收发双方的 epoch/generation、owner/role/scope/shop 摘要、确切 root/parent 关系和正文摘要。当前子代理只能读取显式发给自身或自身发送的消息；过期 child 的原生快照为空，不反向读取新根消息。旧代成员也不继续作为当前树成员投影。
- 没有这份精确证明的历史消息不会被补造绑定，也不会作为当前正文返回。原数据库行与旧事件保留，`messageHistoryMayBeOmitted` 明示存在未投影历史；这是兼容性限制，并非删除记录。主负责人负责将同一 helper 接入其持有的 gateway 入模路径；本分支未争写 `pi_gateway.py`。
- `/workspace` 在 Runner 等待间隙后，最终响应在 authority 事务重新核 principal、epoch/generation/frozen，重新读取当前 workspace。成功、异常和 frozen 分支均不复用旧对象返回正文；变化时拒绝或返回已验证的冻结视图。正常签名 HTTP 反例覆盖换代、收紧 scope 和 Runner 错误后的换代。
- compact operation继承原 Skills 快照，真实 worker经过真实 `Broker.create/update_skills`，验证 excel-report 环境存在后台进程时不会先清空 Skills 导致隐式升级。只对当前 compact create 的确切签名 `skill_update_while_busy` 拒绝分类为未开始，结束原 queued control和 operation；无签名/错误签名、普通 create错误或真正传输未知仍保持 unknown。异常路径所需的 mutation/canonical/PiDispatch 均在 try前绑定，不再因局部 import 迟到触发 UnboundLocalError。
- 已将新增夹具改为真实控制创建路径、64位摘要和正常 spawn建立旧 child，停止更新不可变 PiAgent 身份。隔离 PG 入口为 `py -3.12 tools/ai-postgres-rehearsal.py --tests-only --preprovision-ai-runtime-roles --test-label ai_assistant.test_pi_context --test-label pi_runner.test_compact_safe_point --port 55876`。独立端口、随机凭据及数据目录由既有脚本创建/清理，无生产写入；最终结果与证据入口见 validation.json。

最终隔离 PostgreSQL 结果：28 项通过，9.928 秒；证据 [postgres-tests.log](postgres-tests.log)。定向严格 TypeScript 的有效结果复用，新增后端差异的 git diff --check 通过。

## 调度领取的最后一个正文入口

`scheduler_tick` 不再直接将原始 follow_up 表行拼成新 prompt。快照、Gateway 所用的三参 `visible_messages(session,state,root)` 接口保持不变；内部共用证明选择器，先以根代际证明、目标、消息类型和原 cursor过滤，再取得有界消息，并复核确切收发双方/parent/授权和正文摘要。没有证明的旧前缀不占前 100 条，也不会把旧正文转写成新 operation/user_message。

调度只承认同一证明下的 queue_cleared，并校验当前根授权和 child root epoch。新派生 run 的 messageCursor 绑定本批实际领取的最后一条 seq；有持久游标时按原 seq 续领，缺少游标的原操作仍使用其原创建时间边界。每批最多 100 条，有效消息按 seq 排序；剩余合法批次不会因为新 run 的创建时间而丢失，已消费条目不重放。

新增真实 tick及后续 GET 反例覆盖：无证明旧 follow_up不生成新操作/用户事件；105 条无证明旧前缀及无证明 clear不能阻塞后续两条合法消息；有证明清队列生效；102 条合法消息分为 100/2 按序续领且重复 tick不重放。所有检查均在私有 PostgreSQL 55876中执行，不运行模型或发送外部消息。
