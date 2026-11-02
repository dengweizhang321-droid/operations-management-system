# 客服三店遗留状态实施说明

状态：2026-11-02 开发候选；本说明不代表已闭合任何生产 execution、已合并或已上线。本次未访问生产业务接口、未执行闭合、未启动浏览器、未重跑或导入数据。必要代码检查与独立审查由任务负责人统一记录。

## 行为与边界

洗碗机 `11018` 的 `executed` 计划新增受控磁盘 C 验证入口，调用原 `verifyCustomerServicePlan()`：来源哈希、分天重解析等价性、日文件哈希、proofs 与每个精确批次的原验证均保持。只有这些判据通过，才将该计划推进 `completed`。入口并非重跑 B，不重新导出或导入。

厨电 `11039`、切肉机 `11042` 使用独立 `failed_closed` 回执，原 `failed` 计划、来源文件、active 指针保持。回执不是 `CustomerServiceRecoveryApproval`，不存在两小时后失效或限定新旧 period 相等的问题。后续正常 n8n 完整执行从 A 获取原店铺 planning 锁，复核旧执行终态、来源证据、全局 Chromium 锁及端口、旧 active 与 plan，再按当次滚动窗口创建全新空来源计划并推进 active。闭合动作自身不启动后续执行。

原 source recovery 的两小时、同 period、唯一消费者及下载来源复用规则保持；新闭合回执不能作为原恢复头使用。已有独立闭合回执的原任务也不能再通过旧 source recovery 许可复用来源。所有原 execution ID 的新规划均在读取旧状态前通过既有 plan 文件的存在性检查拒绝，不能重复使用旧 ID。

## 入口与授权

沿用现有管理员客服控件与 `/api/imports/recovery/customer-service-close`：

| 请求 | 含义 |
| --- | --- |
| GET `?storeKey=…` | 只读目标；`executed_verify` 表示原 C 续接，其余 kind 表示失败闭合 |
| POST，原唯一请求头及 `{action, target}` | `action=verify` 只允许 `executed_verify`；`action=close` 只允许失败 kind |
| GET `?authorizationId=…` | 只读取 helper 的实际提交结果；Django 授权本身不再显示“已闭合” |
| GET `?authorizationId=…&authority=1` | helper 重新读取精确 Django 授权；不代表提交完成 |

目标仅包含 `storeKey/kind/originalExecutionId/originalPlanSha256/failureCode/period`。店铺名、店铺 ID 由受控店铺注册重新推导；前端展示这些字段，提交时不将展示字段混入严格 authority schema。Worker 与 Django 均保留 admin、无 scope 限制和原审计路径；Worker 写请求继续要求同源。

Django 与 helper 的新授权版本统一为 `jd-customer-service-operator-reconcile-authority-v2`。旧 v1 已签发的恢复许可不会被新 helper 解释为失败闭合或验证授权。原 source recovery 文件保留原协议。前端新本机请求记录带 `jd-customer-service-operator-request-v2` 版本；无 version 的旧记录被明确标识为旧来源恢复许可，保留原内容且阻止提交，不把 v1 审批显示为完成。仅用户显式点击“归档旧版本机记录并重新核对”，才将旧记录原文保存在独立 localStorage 归档键、移除活动本机引用并重新读取当前目标；新动作仍须另行提交授权。这不消费、撤销或升级原 v1 许可，也不执行任何业务动作。新版未确认请求及无法识别的记录不提供归档/换号入口。

新增 helper 协调路由 `GET /coordination/jd-customer-service-close-result?authorizationId=…`，POST 保持 `/coordination/jd-customer-service-close`。helper 仅接受授权 ID，不接受任意磁盘路径、业务参数或自报身份。store/execution/摘要均来自重新读取的精确授权。

## 锁、排空和提交

提交顺序为：重新读取授权 → 维护门禁 → 原 helper 池同步 reservation → 店铺原 `planning.lock` → 读取 active/plan 和精确摘要 → n8n 原执行终态/无同店其他在途 → 持久化精确 intent → 全局 Chromium 锁 → 注册表与端口 → 原判据 → 提交前再次检查 reservation、planning 锁所有权、维护门禁、n8n 终态及 active/plan 字节 → durable 提交。

复用现有 `closeCoordinator` 的退出见证规则，并按 `workflow=jd` 匹配原任务；任何仍在运行、ready 或有 in-flight 请求的 slot 都不能接管。其他店铺或链路有 slot 时亦拒绝，维护观察的 `/health.busy` 同时包含 operator reservation。reservation 生命周期内新 claim 不会进入。退出见证变化、未知进程状态、端口非明确关闭或维护开始均失败关闭。

失败闭合来源解析在提交前再核对一次，并重新检查端口和 plan/active CAS。operator intent 按原 execution+原 plan 摘要记录，另有授权 ID 请求索引；未决 intent 不能被另一请求 ID 覆盖。终态重复请求返回原回执。不同浏览器的新 v2 授权若精确指向已有 `failed_closed`，只 durable create-only 写入该新请求的同目标索引作为原终态别名，之后才返回成功；不再次闭合，不改原目标 intent 或回执。响应的 `requestedAuthorizationId` 与 `committedAuthorizationId` 明确区分新查询关联和原提交，新请求 ID 后续 GET 仍可读取原终态。

验证收尾使用原 C 的所有业务判据，只在最终写前增加原计划字节和当前 active CAS。`operatorVerification`（原授权、原 plan 摘要、完成时间）与 `stage=completed` 在同一次 durable 原子 plan 写入，不存在“计划已完成，但另一个成功回执还未落盘”的窗口。同授权、同店、同 period、同原摘要的重复请求可读取原 intent 与 completed plan 标记恢复历史完成响应；新 A 合法推进 active 后仍可查询原完成结果。真正提交前仍要求 active 指向原 execution 且原字节未变。未通过原 C 的情况不改 plan，也不标成功。

失败闭合结果写入该店 `operator-closures/<execution>-<planSha256>.json`；请求索引在 `outputs/jd-customer-service-operator-requests/`；目标级 intent 在该店 `operator-intents/`。这些只存控制证据、文件摘要、来源计数、日期和异常行号/数值，不保存聊天正文。闭合回执持久保留，下一 A 仍逐次复核来源原件与旧计划摘要。

## 共享闭合证据判据

`inspectCustomerServiceCloseEvidence()` 同时供目标只读查询、闭合提交和新 A 消费使用，避免只有目标查询放行而实际消费不识别新 kind。

所有失败 kind 均要求原计划身份一致、proofs 为空，且无 `dailyFiles/importingDate/derivedDirectory/sourceRecovery`、导入来源派生哈希或其他未知计划字段。严格允许的原计划字段及 checkpoint 字段之外出现新状态，按未知事实拒绝。

`downloaded_list_only` 要求：source 恰好一个 list、phase 为 downloaded；v1 failureBoundary 明确 browserClosed 且 step 为 export_messages；仅 `CHAT_PAGE_MISMATCH`，或有 `preSubmitView=messages` 控制流见证的 `CHAT_PAGE_NOT_READY_MANUAL_ACTION`；受控目录正规唯一文件 `list.xlsx`、路径全链无链接重定向、硬链接数为 1、正大小不超过 25MB、字节数/哈希与 checkpoint 完全一致、sourceCount 为正安全整数。目录中不能存在 messages、unbound 或任何其他文件。

消息未落盘本身不证明未提交；本实现同时绑定原控制流：消息导出先执行页门禁，再写第一个 messages checkpoint；提交导出前必先持久化 submitting checkpoint。list-only 不允许任何 messages checkpoint。历史 `CHAT_PAGE_MISMATCH` 发生于这个门禁之前；`CHAT_PAGE_NOT_READY_MANUAL_ACTION` 在当前旧源码仅可从初始页校验出现，不能仅靠该字符串推断历史消息导出前失败，因此额外要求新持久化的 preSubmitView 见证，缺失时拒绝。

`downloaded_pair` 要求严格两个 downloaded 文件及相同来源计数，文件名、目录、字节数、大小、SHA、关闭边界和失败码 `PAIR_PARSE_REJECTED` 全部匹配。两文件进行完整来源与分天重解析，核对两类实际来源计数、日期覆盖、分天业务值等价性、原始/归一化哈希，并要求真实 duration anomalies 非空。回执记录这些脱敏统计；消费时重新计算并完全比较。

## 仅闭合解析的 200 条限制分层

原 `parseChatLog()` 内部即有消息校验，外层 `parseCustomerServiceImport()` 还有一次。本次将 `closure_evidence` 策略贯穿两层及全部分天重解析，仅跳过“单通消息数量大于 200”的导入条件；正常默认策略始终为 `import`，原数值 200 不变。UTF-8 严格解码、完整文件/完整 block 解析、日期、单条内容 4000 字符、每通 128KB、原文件 25MB、分天载荷边界与分天等价性均保留。

没有捕获“超限”后当作解析成功，也不截断超限会话。对外 reason 只从固定脱敏错误码选择，不返回原 `error.message`，避免把聊天时间原文或客户内容带到回执。

切肉机仍可能在新滚动窗口再次包含超 200 条的会话，哪怕只有一通越界，正常导入也仍会阻断整轮。独立闭合只解除旧执行的遗留阻塞，不能据此宣称新一轮一定成功，不能自动闭合新的超限失败。

## 交付与剩余限制

本次只完成候选源码和说明；未提交、合并、推送、准备制品、上线、执行生产闭合或业务重跑。实际完整差异、必要语法/类型/构建检查及 Astra/Sol 独立反审结论由任务负责人汇总。

如果原 n8n execution 元数据已经清理、仍存在同店其他在途执行、旧 slot 未退出、来源文件漂移或出现未知导入字段，本入口继续拒绝，不能通过删 active、改 ID 或扩大恢复许可跳过。线上是否符合全部动态条件，需获对应生产操作授权后由原受控入口判断。
