# 已完成 Pi 任务提炼入口与候选审核

## 范围与接入

本候选从远端 main `77382b5f` 创建独立 worktree `D:/.codex/worktrees/skill-distill-ui-20261107`，分支 `codex/skill-distill-ui-20261107`，快进合入已核实的四项依赖 `6b7d8486`。本项差异以 `6b7d8486..HEAD` 为准。未合 main、未准备制品、未上线。

实际入口为系统侧栏「AI 对话」（亦属于 AI 助理）→ Agent → 已完成任务区「提炼为 Skill 草稿 / 查看候选」。沿用 `app/ai-pi-agent-view.tsx` 的会话、完成任务、当前账号和可用模型信息；新面板复用 `ai-workbench-text`、`ai-pi-business-card`、`ai-pi-actions`、系统颜色变量与既有按钮，未另建正式页面或导航。面板可以选择当前已加载会话中的成功任务。

新组件 `app/ai-pi-skill-distillation.tsx` 读取原依据端点，展示来源与确认修正数量、覆盖缺口、原模型配置版本、报告摘要。用户勾选费用与模型授权后才调用原 POST `/distill`；按钮不修改任务的模型选择。请求标识和报告版本摘要按账号＋任务保存在本地，保存失败即阻止新增派发；刷新、轮询与重开面板只读恢复。只在服务端明确完成同一请求后清理本地请求，未知派发阻止新尝试；未登记的断线请求可以通过显式「继续原请求 / 取回结果」沿用原标识和原报告摘要。明确终态失败后，用户重新确认当前报告可发新尝试。

面板展示候选全文、参数/默认口径、步骤/工具/缺数分支、来源/模板、未验证建议与待确认项。审核调用原端点并绑定 `expectedVersion` 和 `contentDigest`，备注按 2000 UTF-8 字节限制。审核响应丢失或冲突后先只读刷新；批准仍只是候选审批，未调用发布接口。已有审核终态禁止重复审核；退回后的新提炼仍须重新授权。

## 最小只读恢复扩展

原 `GET /api/ai/pi/operations/{id}/skill-candidates` 默认响应键集合保持不变。可选 `includeDistillations=1` 增加单个 `distillation` 对象：

- `blocked`：是否存在 prepared/sent/unknown 派发；
- `latest`：最新提炼请求的标识、状态、错误码；
- `requested`：可选 `distillationRequestId` 所指定的准确请求回执；
- `candidate`：此任务最新的单个候选，避免全账号最近 100 条列表截断导致任务候选无法恢复。

读取复用提炼 `_operation()` 的真实所属账号、scope 与原角色检查，不返回模型调用正文、凭据、供应商响应或成本明细，不执行写入、不推进 revision。查询参数必须准确；默认 GET 契约与原派发/幂等/审核机制保持原样。没有模型或迁移变化。发布范围为 Worker＋Django。

## 可直接打开的方案

[提炼草稿交互方案.html](提炼草稿交互方案.html) 内嵌实际新 React 组件、React runtime 与当前系统 tokens/工作台/Pi 样式，演示适配器仅返回合成数据。包含成功审核、成功但响应丢失、明确本地失败后新尝试、派发结果未知四种可切换场景，并可重置本场景。适配器把 API 路径解析到固定虚拟 HTTPS origin，不继承 `file:///D:/...` 的盘符；没有真实 fetch 回退，CSP 禁止网络连接，不执行发布或外部发送。

生成入口：`node tools/generate-skill-distill-demo.mjs`。按用户本轮「勿启动浏览器」要求，没有启动浏览器或在线预览。单文件通过 Windows file URL 读取、内嵌脚本语法与静态交互接线核对；未执行浏览器内 file URL 交互验收，不将静态核对称作实际浏览器验证。

## 针对检查

- 定向 TypeScript：`node node_modules/typescript/bin/tsc --project .runtime/skill-distill-ui-tsconfig.json --pretty false`，退出 0；临时配置只包含新组件与演示入口，未提交。
- ESLint：新组件与接入页面定向执行，退出 0。
- esbuild：实际新组件浏览器 bundle 与单文件方案生成均成功。
- Node：`tests/ai-pi-skill-distillation-ui.test.ts` 与原 `tests/ai-pi-skill-candidates.test.ts` 合计 7 项通过，覆盖本地准确请求绑定拒绝畸形凭据、file URL 单文件资产/脚本语法、虚拟 origin、不外发，以及原 Worker 路径/同源/角色/转发约束。
- 隔离 SQLite：`ai_assistant.test_skill_distillation` 与 `ai_assistant.test_skill_candidate_schema_route` 合计 19 项通过，系统检查 0 issue。新增用例覆盖可选收据读取、原响应集合兼容、只读 revision、准确请求恢复、异主拒绝、无效参数拒绝、503 明确本地失败与 unknown 的区分。供应商被替身拦截，无真实调用。
- 最终补充只读 revision 断言后，仅复跑对应 1 项，退出 0。
- 首轮新增测试 GET 查询未按完整 URL 签名，被既有内部签名门禁返回 401；已改为复用原 schema 路由的完整 URL 签名 helper，未放宽任何门禁。第二轮 19 项通过。
- `git diff --check` 通过。

SQLite 子进程使用 `py -3.12 -B`（Django 5.2.17），明确 `TERUISI_DJANGO_ENVIRONMENT=test`、`TERUISI_DJANGO_PROCESS_ROLE=development`、`DJANGO_DEBUG=true`、`TERUISI_DJANGO_SQLITE_PATH=:memory:`，清空数据库 URL、内部签名、AI 加密和 Runner secret 文件环境变量，不连接生产或读写生产运行目录。依赖仅复用主工作树 node_modules junction，不安装或改写依赖。

本项不修改事务、数据库结构与派发逻辑，没有追加 PostgreSQL 演练、全仓测试、真实模型调用或业务数据验收。完整端到端显示及业务效果留待用户采用后检测；独立反审由 lead 按用户最新指令另派 Astra，本执行上下文未自审或代替独审。
