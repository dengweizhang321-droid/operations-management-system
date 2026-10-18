# Pi 一期取消与隔离验收窄范围方案

日期：2026-10-18。源码基线：`aaca18485021b6f98107fe168b69c8f57d55ee46`，与读取时 `origin/main` 一致；本地 `main` 为旧祖先，不采用其旧规范。本文为规划交接，不代表实施、独立审查或验收通过。规划者只修改本文件，未操作生产、付费供应商或转派。

## 目标与已核源码

修复停止受理后仍准入新中央取数和导出未来页，保留普通已知停止后原会话续问、回执观察及未知不重放。新增整链证据走现有 AI 对话的 Agent 入口，不改页面布局，也不扩展一期外能力。

直接核对 `backend/ai_assistant/pi_service.py`、`pi_gateway.py`、`pi_exports.py`、`pi_worker.py`、`pi_models.py`、`policy.py`、`transport.py` 及 Runner README。既有独立反例位于 `D:/codex-artifacts/pi-phase1-audit-20261018/backend-review.md` 和其 `backend-test/`：真实 abort 后工具仍调用一次，第一页期间停止后仍查询第二、三页。

`principal_for` 同时服务控制与新业务调用，允许 running/canceling，且其异常路径会冻结会话；不能简单把 canceling 从该函数删除。`mutation()` 已持有 AI revision 行锁，适合作为取消与派发的共同串行边界。网关先登记 sent，再执行目录及实际业务调用；worker 先 bridge 后看取消；导出逐页及终稿仅查 principal。这些是本次修复接缝。

## 并发与已在途边界

1. **停止受理点**是 `abort` 在既有 `mutation()` 内提交 `cancel_requested=True` 的事务提交。HTTP 返回只报告已持久受理，不能等同 Runner 已终止。
2. **单次新调用准入点**是在同一权威锁内重读当前 operation、校验代际/权限及未取消，然后唯一登记本次 sent。取消先提交时，该次调用必须零准入；准入先提交时，只有该精确调用属于已在途。网关 requestId 的已有 sent、unknown 均不能重新准入。
3. 一个导出任务不授权所有未来页，一个 pending 列表不授权整批桥接。每页、每个网关请求各自通过准入点；不提前登记未来页。导出页可复用 `PiDispatch(kind="export:page", request_id="<exportId>.<ordinal>")`，无需新增表或字段。
4. 外部 HTTP 不放进 `mutation()`。否则停止会被网络阻塞，且工具回调 AI writer 可能与全域锁相互等待。普通进程锁不能替代跨进程事务边界。
5. sent 登记后目录等准备可能阻塞，因此在实际 `execute_tool`、文件内容读取、单页 query 前再次检查最新取消。该检查用于缩短并尽量消除尚未发出的工作，不宣称它能与网络物理发送原子化。**承诺是停止后无新准入；停止前已准入的单次在途调用可能完成。** 不承诺停止返回后所有物理 HTTP 都绝对不可能起跑。记录准入顺序及真实底层调用次数，不能以改名将任意待办包装成在途。
6. 使用新工作专用门禁（例如 `require_running`），对取消返回固定 `pi_operation_canceled`。该异常在 `principal_for` 的权限冻结捕获之外产生；真实 owner/scope/代际失效仍走原保护。

## 网关和回执分类

对 model/tool/file 的新派发应用上述门禁；校验 capability、正文 digest、nonce、principal 和作用域仍保持。精确 completed 回执是被动观察，可在取消中按原身份读取；不能让新工作门禁挡住这条观察路径。unknown/sent 的重复请求继续拒绝，换 requestId 不能绕过模型在途围栏。

只在本层执行前门禁明确证明尚未调用实际执行器时，才可将已登记 sent 结束为 `completed`，保存固定、无敏感正文的取消回执和错误码。应由明确执行阶段保证，不能仅凭任意下游异常恰好带取消错误码就断言未发送。未进入准入的拒绝不必伪造 sent。

实际工具已成功返回后才发生取消，可以记录其已知 completed 回执；后置校验保持权限/代际核验，不把 cancel_requested 本身升级为 unknown 或 permission_changed。已发送供应商请求的丢回执、取消中断及不可证明结果继续 unknown/freeze，原请求不重放。已有未知事实不能因用户再次点击停止变成已知取消。

## queued/running 导出收尾

当前 PiExport 数据库约束仅允许 queued/running/succeeded/failed。最小方案使用 `failed + errorCode=pi_operation_canceled` 表达取消，无需为显示新增 canceled 枚举及迁移。

- abort 同一事务将本 operation 的 queued/running 导出终结为上述失败状态，避免 worker.complete 永久等待导出队列。已 succeeded/failed 的记录保持。
- claim、每页准入、页结果保存和最终文件发布均复验当前 operation 与 export 状态。持锁区间只做准入、状态与本地持久化，不包住来源 query。
- 在途页允许返回，但停止后其结果不能继续下一页，也不能发布新的 complete=true 导出文件。既有页保留为已取片段证据，不能改称完整数据。
- 终稿的取消检查、文件保存及 export succeeded 在一个 mutation 中提交。终稿先提交可保留；取消先提交则不创建文件。迟到 worker 用条件更新或锁内新对象，不能把 abort 写入的 failed 覆盖回 running/succeeded，不能改写其取消原因。
- 原操作完成并开启下一轮后，旧 export 的迟到结果不得冻结新 operation 或触碰新代际；不能借重领或新 export ID 自动重查原失败任务。

## Worker 与正常续会话

每轮先重读取消并发一次原 abort，再处理可用的终态观察；取消中不桥接新 gateway 请求。bridge 内每条请求也可能遇到并发取消：本层已知未发取消应退出桥接并进入停止观察，不能让其落入通用 freeze。

`abort/state/ingest`、真实 `agent_settled`、文件收集终态回执及应用 ack 保留原协议。取消受理、abort 回执、agent_end、agent_settled、filesCollected 和 ack 不是同一事实。不能仅见 cancel_requested 就清除运行中的 active 围栏。已知停止在精确终态证明后将 operation 置 canceled、session 置 idle，保持 epoch/generation/native session 与原卷；之后新 seq 可沿用原会话。

取消时可不新增发布 Runner 本轮产物，但保留旧 PiFile 与原卷；被动收集完成仍须验证。未知模型/Runner 效果、权限变更、清理未知仍保留原 unknown/frozen 及不重放策略。停止发生在 prompt 准入前时走既有明确未发 prompt 的有限收尾，不能误生成新 prompt。

## 最小验证与整链证据

执行者只补本次直接影响验证，独立审查由未参与方案/实现的新上下文完成。

1. 真实 service.abort 返回后，分别尝试新 tool/file/model，底层调用数为 0；精确已完成回执仍可观察，session 不因普通取消 frozen。
2. 网关已登记 sent、目录读取被屏障挂起时取消，再释放目录：实际 execute_tool 为 0，回执分类为确定未发取消。另覆盖工具成功返回后取消，保持已知 completed。
3. 第一页在途时取消：未来页准入及查询数为 0，queued/running exports 进入 failed/cancel code，无新完整文件；终稿提交与取消两种锁顺序分别成立。必要并发测试使用私有 PostgreSQL，SQLite 不宣称证明行锁语义。
4. 真实 Pi 的普通停止达到真实 settled/收集回执，随后原会话同 generation 续问成功；abort/state/ack 可达。已发送模型或 Runner 效果丢回执继续未知，重复原请求及换 ID 均不增加实际派发。
5. 同一次隔离整链从真实 UI → Worker → Django → 真实 Pi/容器 Python 生成 XLSX → UI 下载 → 刷新恢复同会话 → 下一轮读取旧工作文件。保留 operation/seq/generation、底层请求计数、文件 SHA 与实际 XLSX 内容/工作表核验，不能只用下载按钮存在代替下载成功。
6. 在相同环境精确注入回执丢失，区分“浏览器响应丢失但服务端已完成”和“供应商/Runner 结果未知”。前者刷新只能观察或复用原幂等结果；后者不能自动重发。记录原 request/dispatch 数，不能由 UI mock 返回一个终态来证明不重复。

整链可使用合成业务来源及合成供应商协议，同时真实执行 UI/Worker/Django/Pi/Python/下载；报告须逐项写清真实层与替身层，不冒称付费模型或正式店铺验收。本方案不授权生产与真实付费请求，也不要求重复既有已绑定源码的无关测试。

## 交接

核心契约已发给本任务实施者并获得采用确认。最终代码、测试结果及独立审查由主任务报告记录；本文件不作为验证通过证明。共享记忆由主任务完成时统一持久化，避免把尚未验收的方案写成已采用事实。
