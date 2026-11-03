# n8n 完成率与恢复成本设计评估

2026-11-03；审阅基线 `eab998f8`。本文件为独立规划，不代表实现、生产采用、恢复或业务成功。规划角色请求模型为 `gpt-6-astra / high`，工具未提供可独立确认的实际底层模型回执。未实施生产修改、任务触发、重启或外部发送。

## 结论与范围

当前主要问题在业务失败后的恢复和信息传递，不在定时器漏触发。现场快照的上海 11 月 3 日已有 16 条业务定时执行，9 成功、7 失败，首次完成率 56.25%；共享错误流和后续 webhook 不计入这个分母。n8n 成功代表已达到该工作流配置的终态，本次没有以业务数据库回查重新确认每个成功执行的所有数据。

建议先修明确代码缺陷：终局失败被误报为派发未知、HTTP 413 持续自动重试、京准通导入容量不匹配，并对切肉机的 200 条消息容量拒绝作针对性调整。通知已定位为 DWS access token 失效，需按原 profile 重新授权，不能用代码修复代替。三个客服和一个物流旧任务应复用已上线的受控恢复能力处理；重新开发相同闭合功能不能解开当前旧状态。天猫两店 403 尚未证明是请求构造、会话权限还是平台拒绝，不能以重试或删清单替代定位。

短期没有证据支持换掉 n8n、扩大并发或另建一套调度系统。中期最有价值的改造是把既有恢复器变成按“失败阶段”调用的稳定入口，减少每次故障都写一个带 execution ID 的脚本。

## 已确认事实与推断

证据为 `D:/codex-artifacts/n8n-audit-20261103/execution-summary.json`、`retry-live-definition.json`，以及本工作树源码。旧 active 摘要、CSV 规范化实测和通知账本/认证状态由主代理同轮只读检查提供；本规划没有重新读取客户明细。快照之后的新 execution 不包括在上述统计中。

| 优先级 | 事实与位置 | 影响与判断 |
| --- | --- | --- |
| P1 | 客服 11088、11090、11093 在 A 报 `PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION`。厨电旧 11039 为单列表文件已下载、`CHAT_PAGE_MISMATCH`；切肉机旧 11042 为双文件、`PAIR_PARSE_REJECTED`；洗碗机旧 11018 为 executed、30 个 proofs。 | 今日失败是旧状态未处理，不能概括成今日浏览器全部失效。三个旧状态的恢复动作不同；洗碗机优先复验原批次，不能重新下载覆盖已经执行的结果。 |
| P1 | 物流 11085 最终报通用停止文案，实际 A 被旧 11037 的 `JD_LOGISTICS_LOGIN_REQUIRED` 阻挡。旧首 operation 为 exporting、无 export，其余 planned。 | 新执行尚未做业务。`exporting` 本身不足以证明点击已发生，也不足以证明没有发生，应复用现有 11037 原代码路径判据。 |
| P1 | 设备推广 11096、11106、11109、11111 均为导入 HTTP 413，三个后续 webhook 重复同错，11112 仍在 Wait。`classifyHourlyRetryFailure` 末尾对未匹配错误默认 retry，终局正则遗漏 413。 | 这是确定性的容量拒绝，等待一小时不会减小同一文件。错误流程成功只表示重试 POST 被受理，不能计作业务恢复成功。 |
| P1 | 六次终局错误流均走收集不可重试失败分支，但 `terminalCode` 固定为 `dispatch result unknown`；准备提醒节点再次把非白名单文本归为同一句。 | 未执行重试 POST 却要求核对可能已受理任务，制造错误恢复方向。不是六次 webhook 超时。 |
| P1 | 主代理核到六条通知账本均 `identity_failed / notification_unconfirmed`，没有进入发送。只读复现 `Get-WatchRecipient` 得到 CLI exit 5、`resolve access token error`，要求同 profile 的 `dws auth login`。 | 已定位认证失效，不是通知已经发送后响应丢失，也没有证据要求改 CLI 接口。需用户交互重新授权；不得试发或保存凭据。 |
| P1 | 设备 CSV 为 12,960,502 字节、16,006 行，经原 `prepareNormalizedNetshopImport` 得到 JSON 75,915,746 字节（72.40 MiB），超过 Worker 客户端默认 64 MiB。Django settings 通用默认虽为 64 MiB，正式 `tools/django-netshop-service.ps1` 已向 Waitress/环境注入 128 MiB。切肉机成功 CSV 为 8,929,255 字节。 | 当前确定卡点是 Worker 客户端的 64 MiB 限额，不能说生产 Django 也只有 64 MiB。只扩大外层 25 MiB 上传限制没有针对性，JSON 每行字段名及原始/规范化值带来的膨胀需在内部限额处理。 |
| P1 | 天猫炊之王 11102、马思图 11104 在 P 创建阿里妈妈报告时 HTTP 403，四个其他天猫定时成功。 | 不支持“所有天猫接口失效”的结论。会话、CSRF、登录点、店铺权限或平台拒绝都需要进一步区分，403 不能直接归因密码过期。 |

## 最小修复路线

### 1. 先纠正错误表达和无效重试

在 `tools/n8n-hourly-retry-policy.mjs` 复用既有分类器和 IF 接线：终局分支保留 `terminal_manual_action` 或 `execution_mode_not_automatic`；只有实际派发节点错误出口使用 `retry_dispatch_result_unknown`。准备提醒节点保留已经允许的代码，不再把所有正常转人工结果兜成派发未知。通知成功与失败都保留原业务终局原因，通知自身结果由其独立输出/账本解释。

把本次有证据的 HTTP 413 归为需修复容量的终局错误；如新增结构化 `payload_too_large` 代码，也应与公开 HTTP 状态一致。保留原网络错误和吉客云已验证下载恢复分支。暂不全面翻转成“所有未知错误永不重试”，否则可能误伤已验证的临时失败恢复。

已在 Wait 的 execution 保存旧定义快照，重新发布错误工作流不等于它会使用新分类器。采用时必须明确列出旧等待执行及其原失败，并决定是否对仍未派发的精确等待执行作受控取消；本设计不授权取消、不建议全局清空 waiting，也不能把未来新失败停止重试说成现有重试链已经停止。

`tools/n8n-manual-action-alert.ps1` 沿用本人单聊身份核验与单次发送防重。DWS 需要按原 profile 重新授权，在不输出身份及原始 CLI 内容的前提下提示明确的认证失败原因；没有必要改发送协议。已知发送前失败可以在问题修复后重新检查；`sending/unknown` 仍不能自动再发。

### 2. 修复导入容量，保留原来源与批次语义

已完成的同源离线实测证实当前完整 JSON 为 72.40 MiB。正式 Django 启动脚本第 43、396、410 行已配置 128 MiB；Worker 客户端默认仍为 64 MiB。采用前核对 Worker 是否存在显式配置覆盖，避免只改默认而该覆盖保持旧值。`importJdPromotionFile` 保留有界的公开错误 code，避免只剩 HTTP 数字；不输出上游自由文本、HTML、响应头或完整响应体。

本轮建议把网店客户端默认调至已有的 128 MiB 硬上限，覆盖当前实测 72.40 MiB；同步 Django `netshop_writer` 的 settings 默认至 128 MiB，是消除普通启动与正式启动的差异，不是提高生产 Django 原有限额。只调整网店领域，不连带提高 market/inventory 等领域；保留源文件 25 MiB、现有行数约束和 128 MiB 内部硬顶。这会放大客户端单次请求可接受的内存用量，仍不保证任意 25 MiB 源文件都能导入，但相较引入新传输协议改动小、能直接解除当前拒绝。

若接近或超过可接受预算，优先设计单文件分块接收、最终一次发布的导入会话，复用现有内容指纹与精确批次规则。不能把一个推广日 CSV 切成多份分别走现有整日替换入口，后一片可能覆盖前一片；也不能为减小 JSON 随意删除 raw，后端校验、指纹和追溯可能依赖它。此项属于后续较大改造，不能拿完整会话系统拖延已定位的小修。

另有明确提效点：`jd-promotion-export.ts/runUnlocked` 对 downloaded 状态仍启动浏览器并走任务列表。后续可在复验原 manifest 的店铺、日期、来源路径、SHA、行数后直接沿既有导入入口继续；completed 优先用精确 batch 读取复验。不能让 submitting 或缺来源证据的状态走该捷径。

### 3. 用已有能力处理旧计划，不重新发明闭合

客服已有 `jd-customer-service-operator-reconcile.ts` 和页面入口，支持 `pre_export_zero_effect`、`downloaded_list_only`、`downloaded_pair`、`executed_verify`。本次按旧 11039/11042/11018 的真实状态分别 inspect，再由既有授权及结果接口完成 close 或 verify；正常下一次 A 消费已有持久结果。`failed_closed` 只是允许新的日期窗口采集，不能将旧失败写成 imported/success。

物流已有 `close-jd-logistics-login-11037.ts`，其 prepare 绑定旧历史事实并采集当前身份，inspect/apply 复用既有 `closeJdLogisticsLogin`。不要复制一份脚本再换本日 execution ID，也不要直接删除 active。源码中 exporting 状态覆盖登录阶段，当前精确历史判据正用于消除这一粗阶段的不确定性。

这四项处置与代码部署分开报告。已有能力已经上线不代表旧状态已经完成处置；本轮修复尚未获得合并或上线授权时，不将规划写成“恢复完成”。

#### 切肉机：闭合之外必须处理重复触发的容量原因

追加源码评估确认：200 条是当前明确存在的在线导入契约，但没有找到“一通会话业务上最多 200 条”的口径依据。`lib/customer-service/import-service.ts` 与 `backend/customer_service/import_service.py` 在导入时限制消息数量，同时已经独立限制单消息 4,000 字符、单会话 128 KiB；整日规范化载荷另限 16 MiB。数据库使用 JSONField，没有 200 条结构限制；历史迁移专门允许 2,000 条/128 KiB 并有完整保留 201 条的既有例证。

因此建议本轮将在线导入上限在 TS/Python 两端同步从 200 调至已有迁移使用的 2,000，保留上述字节、内容、日期、匹配及整日等价校验。沿用已有边界比简单删除全部数量约束更小，也不需要新分页、导入会话或数据库 migration。它改变的是导入资源契约，应在交付中明确说明，不能冒称原规则本来允许。

精确改动范围：`lib/customer-service/import-service.ts` 的 `CUSTOMER_SERVICE_IMPORT_MESSAGE_LIMIT`；`backend/customer_service/import_service.py` 的 `MAX_MESSAGES`；`app/jd-customer-service-close-controls.tsx` 中“导入200条上限仍保留”的旧提示；本任务契约说明及直接引用旧界限的既有检查材料。`lib/customer-service/database.ts` 的读返回上限 200、AI 上限 24 保持；`backend/customer_service/query.py` 已独立截取详情至 200 条/64 KiB，并返回 total/returned/truncated，适应保存更多消息，不需要为此次导入恢复扩大响应或 AI 输入。

如果原 200+ 消息会话仍处在下一次滚动 30 天窗口，只闭合旧 11042 再采集必然再次碰到同一数量限制。闭合有解开旧 owner 的作用，但不能单独宣称治好了切肉机。应先用原文件的脱敏最大消息数/最大单会话字节确认 2,000/128 KiB 可以容纳该已知故障，再由既有恢复动作解锁。不能截掉第 201 条之后的消息以求导入成功，也不能拆一通会话伪造多个会话改变匹配与统计。

### 4. 天猫 403 做最小、只读、按店定位

`tmall-direct-promotion-export.ts` 在 POST 前先记录 `report_submitting`，只有返回任务 ID 后才记 `report_submitted`。403 失败因而可能保留提交未决；重新登录后直接重跑仍可能停在旧清单，不能删除清单或重复 POST。

优先检查两店原 audit 的店铺、日期、reportName 与失败阶段，再通过原店铺下载列表核对同名任务。唯一任务可以按既有协议绑定接续；无唯一结果保留未决。只有获得明确拒绝且可证明没有创建任务的证据，才讨论受控闭合并允许新完整 execution。当前源码已在进入列表前监听并捕获 csrfId/loginPointId；没有现场证据时不再增加多次刷新、反复登录或随机请求头。

## 后续架构取舍

### 建议：按状态复用恢复能力

现有安全目标合理，主要成本在执行标识被编进恢复程序、正常入口只给通用错误、操作者需跨多个文件找动作。`close-jd-logistics-preexport.ts` 固定 9542/9556，另有 9851、11037 和 known-flow/four-imports 等专门工具；客服已有通用 operator reconcile，说明无需新建整套恢复平台。

建议沿现有 helper/运营事务入口增加一个薄的只读恢复摘要，输出原 workflow/execution、店铺、阶段、是否已落库、允许动作、阻断原因及现有动作入口。动作仍委派给现有领域适配器，不维护第二份 active/owner/批次数据库。新任务从产生阶段就记录精确的 `before_submit / submit_unknown / source_ready / import_unknown / verify_pending / completed` 事实；历史不完整记录仍走原特定恢复器，不能靠新分类猜测旧事实。

未来新增物流故障应按稳定协议和阶段处理，精确 run/hash 作为请求参数及回执绑定，不再以执行号建立新的 TS 文件。当前已存在的 11037 工具直接复用，不为了本次解阻先把所有历史脚本泛化。

### 建议：结构化错误逐步替代文案正则

本次误判源于恢复语义通过中文或英文错误字符串传播。可在原 helper 响应增加少量统一字段：`code`、`stage`、`retryable`、`effectState`、`logicalExecutionId`，先覆盖本次客服、物流、导入容量和天猫创建请求。n8n 保留这些字段，旧工作流继续兼容既有正则。不要一次重写所有工作流，也不增加独立审核服务。

只有结构化字段和领域证据支持时才自动续接。允许重试的临时错误按同一逻辑运行累计尝试与时间预算，而不是每次新 error execution 将预算重置；预算数值需依据实际失败恢复时长确定。72 次 context 等待只是核验上下文的上限，不是整条业务重试链的总次数上限。

### 暂不建议

- 为提高完成率直接删旧 active、放开提交未知、跳过来源校验，或把部分成功标成整条成功。
- 换调度器、加更多 watchdog、扩大 Chromium 并发。今日所有业务 cron 都有执行，且多数失败在旧状态/容量/平台权限；加并发没有针对这些卡点，反而可能增加平台限制。
- 把 shared error workflow 的 error 总数直接视为兜底系统故障数。当前 StopAndError 本来就会将“正确处理后转人工”记成 error，应结合最终代码和发送结果区分；仅调整统计口径不能掩盖实际通知失败。
- 为每次已确认的故障重新全仓验证、重复准备或重新申请已有的开发授权。采用只覆盖本次变更及直接依赖，真实恢复与生产操作按现行授权边界执行。

## 交付与效果判断

先交付小修和准确的阻塞清单，再安排精确旧任务处置与平台会话问题处理。代码审查重点为终局与派发未知的分流、导入容量的两层契约、通知不产生重复发送、恢复不重复业务提交；不以全量业务验收扩大本轮检查。

后续自然运行分别观察：应触发数/实际触发数、首次业务完成数、同一逻辑运行恢复后完成数、需人工且未处理数、通知实际失败数。不要混入 shared error workflow 成功、重复 webhook 或只下载未导入。当前不能承诺小修后完成率达到某个百分比：七条失败中四条还需要旧状态处置，两条需要明确 403 原因，剩余一条需要修复容量。
