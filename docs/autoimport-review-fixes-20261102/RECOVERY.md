# 京东客服原 C 收尾恢复候选（2026-11-02）

本次交付代码和调用说明，未领取 helper、执行 verify、查询业务批次、重启服务、修改生产计划或 n8n 状态。代码未采用前不改变现场阻塞；历史报告中的洗碗机 `11018` 仅为恢复目标线索，实际操作前须重新核实同店 active 仍指向该原执行。

## executed 的含义与恢复范围

`executed` 表示 B 执行段完成，C 的独立复验和收尾尚未完成，仍阻塞下一轮。它不符合导出前零效果闭合条件。本次新增 `restoreAndVerifyCustomerServicePlan()` 从磁盘读取同店原计划，在原 `planning.lock` 内校验 active、execution、版本和店铺身份，再完整复用现有 `verifyCustomerServicePlan()`：核验原来源哈希、重新解析整段来源、比较逐日等价性及派生文件哈希、逐批次查询并校验原导入证据。只有全部通过且 active/plan 原字节仍一致才将该计划写为 `completed`。

恢复只读业务数据并写原计划完成状态，不运行 A/B、不开浏览器、不导出、不重新导入、不推进到另一个 execution，也不改原 n8n 失败记录。失败保留原 `executed` 计划和 active；再次操作仍须满足原所有权及 helper 准入条件。

## 原受控入口的调用顺序

上线采用和生产恢复均须另有本次明确授权。以下是后续获授权后的调用说明，本次没有执行这些请求。

1. 使用已采用本修复的 helper。原 helper 生命周期若已经退役该 execution，`IsolatedHelperSlots.retired` 会拒绝 `execution_already_finished`；不洁退出的 legacy slot 也仍拒绝。不得删 retired、清 quarantine 或改 owner 绕过。正常受控采用新 helper 后才会有新的空内存生命周期；本说明不授权为恢复自行重启服务。
2. 核实原店铺 active 和原计划 `executionId/version/storeKey/shopId/shopName/stage`。继续使用原 execution、店铺和时间锚点，不以当前日期建立新计划。原计划必须仍为 `executed`，所有来源、派生文件和 proofs 均保留。
3. 向现有 `POST http://127.0.0.1:5791/coordination/claim` 发送空请求体，使用下表请求头。只有返回 `coordinationStatus=granted` 才继续；waiting/rejected 按原协调约束处理，不另建 owner。
4. 向同一 helper 的 `POST http://127.0.0.1:5791/jd/customer-service/verify` 发送空请求体，使用同一 execution/store/时间头。不要调用 `/plan` 或 `/run`。仅在 helper 为 `ready`、没有内存客服计划、不 busy、已由第 3 步领取同店及原 execution 时走磁盘恢复；正常 A/B/C 的内存计划分支保持兼容。
5. 按该请求原生返回判断结果。成功返回 `stage=completed` 后，原 helper 按既有 close 流程退出；n8n 旧 execution 仍保留失败事实。新的完整轮次仍走原 n8n 入口，不能把手工写成功或重试 B 当作收尾。

| 请求头 | claim | verify |
| --- | --- | --- |
| `X-TERUISI-N8N-EXECUTION-ID` | 原 execution ID | 与 claim 完全一致 |
| `X-TERUISI-WORKFLOW-KEY` | `jd` | 可省略，路由确定为 `jd` |
| `X-TERUISI-COORDINATION-ATTEMPT` | 初次 `0`，后续按原协调协议 | 不需要 |
| `X-TERUISI-JD-CUSTOMER-SERVICE-STORE-KEY` | 原店铺注册 key，必须显式提供 | 与 claim 完全一致 |
| `X-TERUISI-SCHEDULED-AT` | 原执行固定时间的规范 ISO UTC 值（如原协议使用） | 与 claim 完全一致 |

历史报告对应的洗碗机店铺 key 为 `jd-cuizhiwang-dengweizhang`，execution 为 `11018`；这不是当前现场确认或本次执行授权。不得从 `createdAt` 或当前时间猜造旧锚点。外层 slot 身份、准入、原时间锚点、防重放、排空以及隔离限制继续生效。普通旧 JD claim 不带客服店铺头仍兼容，但不能因此进入新增磁盘恢复分支；该分支要求 claim 时显式绑定客服店铺。

## 失败诊断与来源复用审批

- `read-close-target` 对 `executed` 明确显示 C 未完成且阻塞，不再显示“无需闭合”。
- 仅 list 已下载、messages 未完整取得表示已有导出下载效果。当前不支持此形态闭合，不能当作零效果，也不新增 `downloaded_list_only` kind。
- 配对来源重解析失败只显示固定脱敏码，例如 `MESSAGE_LIMIT_EXCEEDED`、`MESSAGE_CONTENT_LIMIT_EXCEEDED`、`MESSAGE_TIME_INVALID`、`CONVERSATION_BYTES_LIMIT_EXCEEDED`；消息数超限明确显示“单会话超过 200 条上限，当前不能批准来源复用”。本函数的检查点结构、文件大小/哈希、来源数量及时长异常证据核验失败各用固定说明和代码；其余未知原因统一为 `PAIR_FORMAT_INVALID`。内层保持 `PAIR_PARSE_REJECTED` 和 cause，不把原异常消息、会话内容或文件内容传入 reason。
- `downloaded_pair` 是同原 period 的来源复用审批，后续 B 跳过浏览器并复用原文件，不是废弃旧任务后重新采集。审批本身不把 active 闭合；跨日的新计划仍会因 period 不一致被原检查拒绝。
- 消息 200 条上限、内容长度、时间及总字节限制不变；导出前失败自动闭合的九码白名单不扩展。

## 必需代码检查

已对 helper 入口及 139 个本地依赖输入执行 esbuild Node 24 内存编译（`write:false`、未执行生成代码），通过；覆盖本次恢复和诊断改动的语法与依赖接线。未生成生产制品，未写或运行功能测试，未执行 helper 业务请求。生产采用和原任务收尾结果须以另次授权操作的实际回执为准。
