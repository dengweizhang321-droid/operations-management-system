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

- 保留最近一轮原始目标、原用户消息/插话/跟进/问卷/计划批准记录、确切计划 ID 和版本、授权意图 ID、确认/预览摘要、文件 ID/SHA256/大小，以及原取消、终态、unknown 和待办证据。
- 原文只作逐字证据，不自动分类“已确认修正”，不猜测未记录的目标或步骤完成情况。问卷回复、摘要和文件内容均不是新业务授权；不会写个人永久记忆。
- 每类最多 8 条，文本默认最多 1200 UTF-8 字节，计划片段最多 2000 字节，清单上限 96 KiB。所有省略显式返回 `truncated`/`hasMore` 与来源 ID；不会读取附件字节、dispatch response/providerFrame 或隐藏推理。
- 正常 `GET /api/ai/pi/sessions/{sessionId}/workspace` 附带清单。UI 沿用 Pi 工作区，增加可展开的“上下文恢复清单”，不更改 `ai-pi-agent-view.tsx`。
- 较早用户控制记录用 `recoveryBeforeControlSeq` 分页；精确原记录用 `recoveryControlSeq`、`recoveryTextOffset` 逐 1200 字符读取，附完整原文摘要与下一游标。原用户消息继续从已有 events 游标读取，计划/文件/业务动作继续引用原证据。
- UI 读取原记录使用 GET，取消旧读取并核 epoch/generation，不重发 operation、dispatch 或控制请求。环境隔离后不返回清单。

手动 compact 在原 authority 事务内冻结同一份清单，写入原 compact operation 的 payload，同时将保留要求和清单交给原 `customInstructions`。客户端请求摘要、control ID、controlSeq 及重放规则不变；同 ID 重复只观察原回执。

压缩前补查未决 operation/control/dispatch、业务动作、下载活动以及已观察的 PTY/交互状态。压缩排队或执行期间禁止新增工作区写控制。Runner 在原 compact 分支再次核验实时 PTY、本地工具、bash、交互及活动，避免把 Django 旧观察当作实时空闲证明。正常读取不实施恢复、续跑、自动压缩、供应商切换、参数降级、文件外传或生产启用。

预算展示复用现行公式，只展示配置中的上下文窗、输出和工具余量；完整原生上下文实时用量未观察到，返回 null，既有超预算提示或用户手动 compact 才是触发来源。本次没有添加自动触发策略。

## 隔离核验

- Python 3.12 / Django 5.2.17；明确 test/development，清空数据库 URL、`:memory:` SQLite。10 项定向检查通过：正常只读、同 compact ID 不重发、unknown 原 dispatch 保留/阻断、用户证据截断及原记录分页、环境冻结、compact 期间写者阻断、Runner 实时写者/工具/后台子进程安全点、原 compact operation 路径与单店快照隔离。
- 改动前端及直接组件依赖的严格定向 TypeScript 检查通过。全仓 `tsc` 被未修改路径的类型错误阻断（包括历史 demo、市场候选与发布测试）；没有将该命令报告为通过，也未扩入无关修复。
- [preview.html](preview.html) 从真实恢复组件静态渲染，只含合成材料；使用 headless Chrome 通过 `file:///D:/...` 打开，验证 details 展开和合成原记录交互，外部网络请求为 0。没有启动在线预览或展示浏览器。
- `git diff --check` 通过。源文件摘要和检查命令见 [validation.json](validation.json)。

这些检查不声称已经执行付费模型、真实 Pi 原生摘要语义恢复、生产业务调用或 Runner 服务切换；原 native compact 的完整运行/文件收集协议保持不变。

## 交付与采用边界

Worker 前端、Django 和独立 Runner broker 源码均有变化，无 migration。
`backend/pi_runner/workspace.py` 是容器外 broker 源码：`containers/pi-agent/Dockerfile` 不复制它，镜像构建输入仅为 `containers/pi-agent/*` 及 `bundled_skills`。因此本小项改变 Runner `source_digest()`，没有改变容器镜像输入，无需为这 10 行安全点检查重建同一镜像。

采用必须经既有 `runtime_upgrade` 及发布入口绑定新 Runner source、原精确 image 和既有权限/互斥/未知状态门禁。本次没有构建或采用镜像、安装/重启服务、迁移、合并 main、准备发布制品或上线。主负责人在独立审查后决定后续交付；合并、准备及上线仍分别遵守当前授权边界。
