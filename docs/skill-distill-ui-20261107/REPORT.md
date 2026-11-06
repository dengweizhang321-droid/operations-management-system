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

读取复用提炼 `_operation()` 的真实所属账号、scope 与原角色检查，不返回模型调用正文、凭据、供应商响应或成本明细，不执行写入、不推进 revision。查询参数必须准确；默认 GET 契约与正常派发/幂等/审核路径保留，反审增量增加下述显式撤回终态栅栏。没有模型或迁移变化。发布范围为 Worker＋Django。

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

初始候选未修改事务、数据库结构与派发逻辑；以下反审增量加入撤回派发授权的锁内终态栅栏，因此追加隔离 PostgreSQL 定向验证。未执行全仓测试、真实模型调用或业务数据验收。独立反审由 lead 按用户最新指令另派 Astra，本执行上下文未自审或代替独审。

## Astra 首轮阻断与增量修复

首轮 Astra 反审指出两项阻断：报告变化或其他候选竞争发生在派发前时，HTTP 拒绝没有 dispatch 回执，客户端仍保留旧报告 pending；旧候选正文可能已被原保存函数接受为 `parameters:null` 等错形结构，直接 `.length/.map` 会使组件崩溃。原来的静态检查没有覆盖这两种实际交互。

1. 新增显式「撤回未派发授权，重新确认」。沿原 POST `/distill` 传原 `clientRequestId`、原 `reportVersionDigest` 与严格布尔 `withdrawAuthorization:true`。服务端在现有 `mutation` 领域锁内检查准确请求；没有登记的请求写为 `completed`，错误码 `distillation_authorization_withdrawn`，保存原绑定及 409 回执并记审计。迟到原 POST 会在模型派发前命中终态，不因报告版本之后复原而重新获得授权。已有 sent/prepared/unknown 拒绝撤回并保持 pending，已有完成请求只返回实际终态，原候选仍由读取恢复。撤回响应丢失时只读准确回执完成恢复；返回格式异常不清理 pending。UI 不以“GET 暂无回执”作为可安全丢弃请求的证据。报告变化时不再显示重复提交旧摘要按钮；成功撤回后取消勾选，必须重新核对当前报告并明确授权，才可使用新标识。
2. 候选正文按 `unknown` 读取，渲染前逐字段检查对象、数组、列表项和展示值结构。发现错形时明确显示“候选正文格式异常”、原始 JSON，禁止批准与标记审核中，事件 handler 同样拒绝此类调用。保留对原 `version/contentDigest` 的“退回候选”，没有把错形内容静默变成空列表后放行。

最终 HTML 已重新生成，增加“报告派发前变化→重授权”和“旧候选格式异常→退回”两个合成场景。未启动浏览器。

### 增量核验

- 新增 `tests/ai-pi-skill-distillation-interaction.test.ts`，用与 React 相同版本的真实 `react-test-renderer@19.2.6` 挂载实际生产组件，执行 effects、状态更新、按钮与勾选 handler；不是源码字符串断言，也未用模拟 hooks 替代 React。4 项实际组件交互通过：旧报告无回执拒绝后撤回/重新授权；断线重载且撤回与 sent 竞争；另一个候选竞争后退回恢复；10 类错形正文不崩溃、禁批且准确 CAS 退回。渲染器在 `.runtime/skill-ui-harness` 隔离安装，不改生产 package/lock；其他检出未安装时这 4 项会说明原因并跳过，不能称为已验证。本次实跑 0 skip。渲染器会输出其上游弃用提示，不影响结果。
- 最终 Node 三文件组合共 11 项通过、0 skip；定向 TypeScript、ESLint、HTML 重新 bundle 与 `git diff --check` 通过。
- SQLite 23 项通过（原 schema 读契约与提炼模块）；随后增加“撤回发生在第一次查询后、锁内准入前”的交错用例，在最终 PostgreSQL 组合中一并运行。
- 最终隔离 PostgreSQL：`py -3.12 tools/ai-postgres-rehearsal.py --tests-only --preprovision-ai-runtime-roles --test-label ai_assistant.test_skill_distillation --port 55903`，13 项通过，系统检查 0 issue，测试耗时 1.956s；完整原生日志：[review-fix-postgres-tests.log](review-fix-postgres-tests.log)。覆盖报告版本复原仍不能重放撤回的旧标识、明确重授权的新标识、其他候选竞争、未知派发拒绝撤回、撤回幂等、锁内准入交错，以及真实旧保存函数接受 `parameters:null` 后的读取与退回。工具回执 `productionWrites:false`，临时集群已由原工具关闭，未接触生产业务库。

归档日志保留完整正文，仅将 Windows 子进程的重复 CR 换行归一为 LF，避免文档差异检查误判行末空白；原字节仍保存在本工作树 `.runtime/ai-pg-73d66deb6637/tests.log`。这是证据排版调整，不改测试结果。

以上为执行者修复和定向验证结果，待 lead 安排原 Astra 上下文增量复审；不代表已获独审通过、合并或上线授权。
