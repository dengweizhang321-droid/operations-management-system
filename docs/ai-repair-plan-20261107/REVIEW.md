# AI 修复施工方案独立反审

日期为 2026-11-07（上海）。源码与测试基线为 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`。请求审查模型为 `gpt-6.1-sol`、强度为 `high`，工具未提供可独立核实的底层型号。审查者未参与方案编制。

最终增量复核覆盖 W1、W3、W5、W6。已审施工正文 SHA-256 为 `69507b775ac488895eaeab9f22bd829beb422c3ebec303681bddeda9dba033aa`。[施工正文](PLAN.md)

**方案可供分批授权，无剩余阻断。** 第一批为 W1/W2/W3/W4/W7 开发及 W6 阶段诊断。生产 Pi 名额恢复取决于实际可安全回收的对象和相应维护授权。第二批根据诊断处理分析、报告和投递，第三批再决定配置及新能力准入。各批交付和验证可独立判断。

## 返修后复核

- **W1 容量与恢复。** `Broker.create` 目前计入命名空间中的物理容器。方案要求 Django 与 Runner 两侧事实一致，排除活动、未知及受保护前驱，按原身份恢复原卷，卷缺失时失败关闭。回收作为独立精确维护动作优先，回收意图和删除效果按原回执保留；本次 nonce、签名、HTTP 状态及正文均匹配时，才按 `create/session_limit` 确定拒绝贯穿 worker/init 收尾。旧会话重建仍受 `maxSessions` 约束。发布回执所列 Runner 来源 `67bf8e2a70fe7f76c19fbf9cdca631934b1455c9845e7e6aed787f3d10a6759a` 与 WAL 修复的真实隔离回归来源一致，绑定仍有效时可复用。[Runner](../../backend/pi_runner/server.py) · [签名传输](../../backend/ai_assistant/pi_transport.py) · [派发](../../backend/ai_assistant/pi_worker.py) · [升级报告](../pi-upgrade-wal-fix-20261107/REPORT.md)
- **W2 唤醒。** 当前唤醒启动新进程，初始化完成的 operation capability 已失效。修订后的方案把本地 metadata/admission、模型参数与技能状态的恢复和模型/工具网关授权分开。无活跃 operation 时仍可按有效 admission 恢复本地工作，旧 capability 不复活，plan 和撤权路径保持拒绝。镜像与 Runner 的协议兼容性在实际交付范围内检查。[Workspace](../../backend/ai_assistant/pi_workspace.py) · [Runner](../../backend/pi_runner/workspace.py) · [容器网关](../../containers/pi-agent/gateway-extension.mjs)
- **W3 停止。** 显式停止通过受保护的同源入口，断流仅代表页面停等。早到取消即使尚无会话也可由原状态入口查询，登记、取消与派发预留沿同一 AI 写事务协调。`provider_started_at` 在网络调用前写入，预留至 POST 之间的竞态、已确认未派发、发送后未知和已完成分开处理。已完成回执和真正 unknown 继续保留。[对话账本](../../backend/ai_assistant/chat.py) · [Worker 路由](../../lib/ai/django-route.ts) · [AI 写事务](../../backend/ai_assistant/policy.py)
- **W5 报告模型。** 三类报告沿现有 `workflows.create` 的模型 ID/版本绑定，版本漂移有明确拒绝。选择 B 纳入请求绑定和活动报告去重，避免误复用 A；未显式选择时保留原默认，配置不另行复制。[报告](../../backend/ai_assistant/reports.py) · [工作流](../../backend/ai_assistant/workflows.py)
- **W6 pandas。** 诊断明确覆盖 `netshop_product_daily`、`sales_category`，原审计所列额度拒绝晚于两次执行失败。第一批补阶段证据；商品日截断导出与后续按各来源实际失败阶段的修复分别处理。[证据索引](EVIDENCE.md)

## 事实、范围与交付

- 重新读取两份结果原件和两份独立反审，证据索引 E01–E10 摘要全部相符。DeepSeek 429、站内 503 和隔离 Agnes DNS 超时均按各自请求归属判断。本人钉钉的取 token 与发送阶段尚未区分，保留原 unknown 及停用状态。[证据索引](EVIDENCE.md)
- 方案保留普通分析与推广专用权限边界，沿现有口径纠正成交客户数/访客数。图片和结构化输出以供应商实际能力准入，文字方法与 Pi 受管运行包分别验收，日报沿既有调度所有者推进。五项 Skill 整链、真实模型自主派工及运行中整树取消仍属待补证据。旧七个 PG 夹具场景已用八个隔离场景补验，原测试源码未改，真实子容器的通过覆盖合成 provider 条件。[施工正文](PLAN.md) · [证据索引](EVIDENCE.md)
- 当前交付范围是文档。开发授权、合并并准备制品、上线分开，真实维护、配置及外发按已有明确授权的实际范围执行。纯文档合并无应用制品。专项功能验证与发布必需检查分开，避免重复验证和默认全库备份。发布异常先按实际服务影响处置，回滚前核对结构与新增写入的兼容性。[开发约定](../../AGENTS.md) · [验证与发布](../规范/验证与发布.md)

本轮审查使用已有原件、源码和只读发布回执。未重跑模型或功能测试，未执行清理、配置变更、外发、Git 提交或生产操作。
