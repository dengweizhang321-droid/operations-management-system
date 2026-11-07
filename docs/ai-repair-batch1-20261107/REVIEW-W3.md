# W3 持久停止独立反审

## 当前结论：返修增量通过

2026-11-08 原审查上下文复核：**W3-R1、W3-R2 两项 P1 均已关闭，W3 已审范围无剩余阻断。** 当前完整补丁 SHA-256 为 `817f10225d51ab7e21d9054131c3c13218db72e3ac98523cc43c3a49be28e1f5`；相对初审的 7 文件增量为 `4adf95e64a55e276a55fd55c3f787685e18c34dbecf376d3d13bb465b807f246`。最新 `W3-source.json` 的 17 个文件摘要全部与工作树相符。下方初审发现保留为历史证据，不再表示当前阻断。

- **W3-R1 已关闭。** 网页请求落盘 unknown 后，后端统一返回 `ai_chat_result_unknown`，原供应商错误仍进入原审计，并保留原 HTTP 状态及异常 cause。钉钉非取消错误不进入网页映射。前端对所有缺少确定安全终态的异常保留原请求号、锁定发送和模型切换，覆盖 SSE 原始错误码与 fetch 丢响应；同步 ref 防止 React 状态提交前的旧 handler 绕过。
- **W3-R2 已关闭。** 未知状态下历史查看继续可用，但清空原草稿，保持 pending、sessionStorage 原 ID 和恢复锁定；刷新仍查原 ID。只有显式新建独立会话清空旧草稿后才允许新请求。确切已完成答复读回后也清空旧草稿；`failed` 仅在明确 `dispatchState=not_sent` 时解除恢复限制。
- **独立验证。** 逐行读取实际 7 文件增量及新增 `tests/ai-chat-recovery-interaction.test.ts`；独立运行该原组件 handler/原 SSE decoder 测试，6 个子场景及外层测试共 7/7 通过，日志 `chat/W3-review-increment-node.log`。覆盖普通超时/不可用、丢响应、明确 unknown、Stop stopping、编辑、模型切换、历史查看、原 ID 刷新、清空后独立新问题、已证实未派发及原答复恢复。它使用合成 hooks/fetch，不宣称 DOM 或真实供应商验收。
- **原件复核与复用。** 复核 `W3-repair-node.log` 41/41、`W3-repair-django.log` 37/37（含实际签名 SSE producer、模拟 transport、持久 unknown/公共错误码/原 timeout 审计一致）。登记、墓碑、取消/派发事务、传输 fence、ACL 与迁移没有本轮增量，复用初审已核的 9 项私有 PostgreSQL 证据，不重复启动 PG。初审完整补丁和源码清单保留为 `W3-v1-reviewed.patch`、`W3-v1-reviewed-source.json`；本报告初审原件及机器回执另保留为 `W3-REVIEW-initial.md/json`。
- **范围边界。** 未修改被审源码，没有真实模型/外发、生产或 Git 交付动作。整包最终 TypeScript、发布边界及提交由负责人完成；此处通过是独立源码/定向证据审查结论，不代表已合并、制品就绪或上线。

## 初审记录（保留，已由上方增量结论解除）

日期：2026-11-08。结论：**阻断，2 项 P1，均位于页面未知请求恢复链。** 后端取消持久化、发送许可与停止的事务顺序、同源/主体/板块边界未发现新增阻断；这不抵消以下可复现的重放入口。

审查按用户本任务逐小任务 Astra 反审特例执行，请求模型 `gpt-6-astra / high`；工具未独立返回底层实际型号。本人未参与 W3 实现，未修改被审源码、提交、迁移或生产。审查基线 `e268b28761ae4ada958455344c0dfbb37d2ae4f8`，开始时 HEAD `7caf36f05c2b239add960f559ec9642f0fb3a6f3`。`W3-source.json` 的 16 个文件逐项 SHA-256 均与当前工作树相符；`W3.patch` SHA-256 为 `f1bf5980e9c24693fcb8321304b150e90eccddc116307bf292f8543fd3cf8194`。

## 阻断发现

### W3-R1 · P1：普通供应商失败已落盘 unknown，页面仍可换号再次发送

- **触发条件：** 模型发送许可已落盘，随后等待响应超时/连接失败；没有主动点击 Stop。`chat.answer` 将回执保存为 unknown，但未取消分支最后仍抛出原错误。`ProviderTransportError` 在该场景的 code 是 `provider_timeout` / `provider_unavailable`，`ChatStream.run` 把原 code 直接放入 failure 事件，前端解码器也保留它。
- **位置：** [catch 分支](../../app/ai-assistant-view.tsx#L982)（尤其 987–993）；[服务端收尾](../../backend/ai_assistant/chat.py#L1471)（1481–1495）；[网络错误分类](../../backend/ai_assistant/transport.py#L37)；[SSE failure](../../backend/ai_assistant/chat_stream.py#L46)。
- **实际影响：** 页面只为 `ai_chat_result_unknown` 或本地 aborted 设置 `recoveryBlocked`，收到上述真实错误码时仅显示 error。原草稿保留；改一个字符再发送会由 `resolvePendingAiChatRequest` 生成新 ID，绕过服务端同 ID 防重。切换模型也可清除 pending 后发送原文。故“数据库已有 unknown”与“浏览器保持未知围栏”没有接通。
- **复现证据：** 外置 `chat/W3-review-ui-repro.mjs` 使用冻结原组件 handler、原 SSE decoder 和合成 hooks/fetch；首个 `provider_timeout` failure 后断言 `recoveryBlocked=false`、`busy=false`，编辑草稿后实际捕获第二个不同 clientRequestId 的 POST。日志 `chat/W3-review-ui-repro.log`。这是组件逻辑复现，不宣称真实浏览器或供应商验收。服务端落盘分支另由完整源码及现有 unknown 测试证明。
- **建议：** 传输/供应商原错误可保留用于诊断，但 UI 在任何未有确定未派发/已完成证据的发送失败后都保留原请求并进入恢复查询。也可从服务端明确返回持久回执状态，仍需覆盖浏览器 fetch/中间层丢响应导致拿不到该状态的路径。只有权威回执证明安全终态才解锁；新独立对话显式清空原草稿，不自动迁移原内容。

### W3-R2 · P1：切换历史对话会擦掉已建立的未知围栏，并保留原草稿

- **触发条件：** Stop 保存后返回 stopping/unknown，或页面已收到明确 `ai_chat_result_unknown`，本地等待已结束。用户点击另一条既有历史对话。
- **位置：** [历史会话切换](../../app/ai-assistant-view.tsx#L1017)，尤其 1034–1038；[历史入口](../../app/ai-chat-workbench.tsx#L136)；[请求 ID 轮换](../../app/ai-assistant-view.tsx#L154)。
- **实际影响：** `openConversation` 允许 `recoveryBlocked` 状态进入，成功后把 pending、sessionStorage 请求号和恢复围栏清空，却不清空 `messageDraft`。旧 unknown 因而失去页面恢复入口，原正文自动留在所选会话的输入框；下一次点击发送即以新 ID 重放原文。它不同于方案允许的显式“新建独立对话并清空旧内容”。
- **复现证据：** 同一外置脚本先发出 `ai_chat_result_unknown` failure 并确认锁定，再调用原 `onOpen`/`onSend`：断言锁定被清、草稿原样保留、最后 POST 正文与旧请求完全相同但 ID 不同，conversationId 变为另一既有会话。
- **建议：** 将历史查看与放弃待核请求分开，历史查看不清未知身份/恢复入口；若允许转入独立提问，显式清空旧草稿并保留旧请求可核对位置。覆盖“已停止等待 → 点历史 → 点发送”的原组件状态测试，不能仅测试 GET helper 或同 ID 服务端拒绝。

## 已核对范围与有效证据

- 完整读取 W3 的 16 文件差异和新增文件，直接核查 `policy.mutation`、`views.write/finish`、既有回执清理、模型/角色契约、conversation workspace、模型 provider、bounded transport、SSE decoder、工作台按钮与恢复/导航 handlers。
- 同源 POST 复用真实 principal 和 HMAC writer；早到记录键绑定账号/模块/请求号，内部 `#` 命名空间不可由签名 request ID 冒充；未登记旧格式 ID 拒绝，已登记旧 ID 继续查。时间只用于首次准入期限，墓碑保留期大于准入窗口；有界清理和配额在原 mutation 内，无额外锁或迁移。跨模块记录不会被另一模块的查询/停止覆盖。
- `provider_started_at` 的预留与 append-only 发送许可分开。停止先于首次许可时后续 live/fence 拒绝 POST；许可到 HTTP 之间的不确定性保留 unknown；已完成回执不被 Stop 改写。普通流断开不再发持久 Stop；钉钉默认未安装新 fence，保留原派发语义。未发现模型生成参数被本补丁改变。
- 请求状态精确 GET 从公开 Worker 指向 writer，只读分支重查 principal；正文 GET 仍 reader。现有 provision 的 writer 可以清理 `AiWriteReceipt`，正常聊天回执仍无 DELETE；未要求扩大 reader 权限。
- 核对原日志：私有 PostgreSQL 9/9、SQLite/mock Django 36/36、Node 34/34 通过。PG 用真实迁移/触发器、双连接与回环假供应商，并含现行角色验证。原失败日志仍存在，未把其计作成功。没有重跑全仓测试、真实模型调用或生产业务。
- 本次新增的独立验证仅为外置原组件逻辑反例，运行两次均 exit 0（断言当前缺陷）；所有被审源码摘要仍相符。整包最终 TypeScript/发布边界由负责人统一收口，此报告不声称该部分已完成，也不授予合并/制品/上线。

原执行者修复后回此审查上下文，只复核这两项及直接影响。机器回执：`D:/codex-artifacts/ai-repair-batch1-20261107/chat/W3-REVIEW.json`。
