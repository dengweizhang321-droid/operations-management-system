# Pi 前后端能力对账与独立审查

审查日期：2026-10-20。初始源码：`963d0277`；工作树：`D:/codex-isolated/piagent-phase3-verification-20261020`。请求角色：`critical-review / gpt-6.1-sol / high`；工具没有单独返回底层实际模型证明。本文为源码与契约只读审查，未调用真实模型、业务写入、机器人、生产启停或发布，未使用共享浏览器。真实模型/消息验收由另一执行者负责。

审查范围是一、二、三期以及 153 原生能力已实现、应对用户开放的路径。判断依据为当前 Django、薄 Worker、Runner、固定 Pi 1.3.0 RPC 适配、前端组件；不以历史报告或某个按钮存在代替端到端证明。下述“接通”表示源码接线，不能解释为真实供应商/生产功能验收通过。

## 优先发现

| ID | 级别与触发 | 证据 | 实际影响与建议 |
| --- | --- | --- | --- |
| A1 | P1，勾选 1.3.0 `native-planning` 后发送 | `pi_service.py:17,190,229`；1.3.0 `manifest.json` | `skills()` 公示 8 项且返回 available，`SKILL_IDS` 只有 7 项，`prompt()` 拒绝新技能；UI 可勾选但不能用。按实际审核部署目录统一目录与请求校验；不以隐藏已实现技能解决。已交后端执行者。 |
| A2 | P1，向目标子代理插话，POST 回执丢失 | `pi_workspace.py:515–522,386`；`ai-pi-workspace.tsx:14,109,148–159` | 路由后控制建在子会话；浏览器 intent 存在根 workspace key，GET 却仅返回根 PiControl。已发生的子控制不能对账，根 pending 永久阻止新增控制。需持久目标身份并只读查询目标回执，或由根返回经授权聚合回执；不能重发原命令。 |
| A3 | P1，根正在运行、所选子代理已空闲时发送 | `ai-pi-agent-view.tsx:274–284`；`pi_workspace.py:515,574` | 用根 active 判定子目标的发送方式，空闲子代理收到 steer/follow_up，服务端按“目标任务未运行”拒绝。以目标 activeOperationId/状态分流；空闲子代理走 agent_follow_up。 |
| A4 | P2，选中第 4 项技能 | `pi_service.py:230`；`ai-pi-agent-view.tsx` 技能 checkbox | 后端最多 3 项，前端数量不限，只得到泛化错误。保留服务端资源边界，UI 明示上限并禁止新增第 4 项。 |
| A5 | P2，用户要为新子代理指定模型/强度/技能或委派原业务动作 | `pi_native.py:231–312`；`tool-registry.ts:163–169`；`ai-pi-native-controls.tsx` 创建表单 | 后端支持 title/modelId/thinkingLevel/skills/businessActionIds；表单仅 task/context/fileIds/dependencies。模型可经 system_tool 触达这些字段，故不是后端完全不可达；缺少用户直接控制入口。可补继承默认值、显式覆盖及原意图选择；业务委派须保原 actionId 和单执行 owner。 |
| A6 | P2，选中子代理查看结果、问卷或交接文件 | `pi_native.py:544–595`；`ai-pi-native-controls.tsx` target 操作区 | 选中只改变消息目标，不加载子会话事件/问卷/产物；根 snapshot 的 handoffs 只查 target_session=root，因此父→子交接不在根面板显示。子会话自身已有完整详情/文件/问卷，且存在环境列表，可增加明确“打开子代理会话”入口复用，无需新建执行面。 |
| A7 | P2，原生新建/切换/分叉历史后 | `pi_runner/workspace.py:913–931`；`pi_native.py:381`；`ai-pi-agent-view.tsx:308` | Runner 改了 Pi 实际历史；Django 环境 event 仍混合所有分支，聊天主区按事件类型显示全部，未区分当前分支。至少应显示当前分支和历史边界，完整方案使用授权公开的分支消息投影；不能让旧分支全部正文看起来属于模型当前上下文。 |
| A8 | P2，公开研究完成后刷新/丢 POST 回执 | `pi_workspace.py:41–49,638–645`；`ai-pi-workspace.tsx` research state | 结果仅存组件 research；GET control history 超过 4 KiB 只回摘要。刷新可恢复控制已完成及来源摘要，却不能恢复全文和“引用资料到对话”。可提供原控制完整只读回执读取，或明确显示已留存来源/全文不可恢复；不能自动重新出站获取。 |

A1 使用 AST 读取请求白名单与 1.3.0 manifest 的无副作用核对，差集精确为 `['native-planning']`。A2/A3 为源码支持的控制与状态反例，未向真实会话注入故障。A5 的可配置性不等于允许扩业务权限。A6 的完整子会话列表入口存在，缺的是协作面板与目标的直接连接。

## 公开 HTTP 路由矩阵

所有 Pi 公开路由由 `app/api/ai/pi/**/route.ts` 薄转发到 `pi_views.dispatch`。真实 principal、同源写请求、authority、角色/scope 和 owner/generation 在既有 Worker/Django 层校验。前端只把 `viewer` 设为只读，业务选择额外限制 operator/admin；服务端仍是最终权限裁决。

| 路由/能力 | 前端入口与触发 | 回执、等待与刷新 | 判断 |
| --- | --- | --- | --- |
| GET skills | Agent 初始化加载模型与审核技能 | 状态/版本/原因；恢复上轮模型与技能参数 | A1/A4；模型配置来自已启用 text/vision，无新增模型配置管理 |
| GET/POST sessions | 环境历史、新建环境 | request ID 先保存；丢响应按 createClientRequestId 在列表对账，不重发 | 已接线；后端可传 title，UI 使用默认标题，非必须独立控制 |
| GET sessions/:id | 切换环境、定时刷新 | session/operations/files/controlRequests；代际变更清理旧正文与附件引用 | 已接线；未知/权限变化禁止继续 |
| POST messages | 任务框、模型、技能、范围、精确店铺、附件、本轮业务意图 | prompt request ID、排队/执行/正文/终态/错误；刷新读取原操作 | 一期主链已接线；A1/A4/A7 |
| POST abort | 停止按钮，先清队列再 abort | 原取消请求和终态；取消不宣称回滚 | 已接线；根树停止由后端传播 |
| GET events | 对话/过程区 | after 游标分页、hasMore、eventSeq 去重；迟到请求按组件 generation 拒绝 | 已接线；子详情须明确导航（A6） |
| POST session files | 上传 ≤512 KiB、选择本轮附件 | 文件 request ID、SHA/manifest、scope 变化清选择 | 已接线 |
| GET files/:id / content | 附件/产物下载、来源 manifest、SHA | 下载绑定服务端保存字节，活动内容只下载 | content 有入口；单文件 JSON 元数据已由详情提供，不另加按钮 |
| GET/POST workspace | 对话/文件/终端面板及能力菜单 | 独立 control ID/seq、回执、pending localStorage、只读重连 | 36 个声明控制全部核对，见下一表；A2/A3/A8 |
| GET/POST business-actions | 本轮业务选择、专用业务卡 | 待确认/排队/执行/成功/失败/取消/unknown，版本+previewDigest确认，原回执协调 | 已接线；intents/recipients 后端可读，UI 主要通过模型选项触达 |
| POST pi/business-admission | 无浏览器路由 | n8n 调用前核当前动作与 dispatchToken | 内部业务准入，不应成为用户按钮 |

## Workspace 36 个声明控制

机械核对 `pi_workspace.COMMANDS` 对前端调用字面量：唯一没有 UI 字面量的是 `session_navigate`；进一步读取 Runner 证明其真实不支持，已排除。不能仅据字符串差集要求补入口。

| 控制（全部列明） | 实际后端/RPC/执行面 | 前端操作、呈现、恢复 | 判断 |
| --- | --- | --- | --- |
| steer, follow_up | 真实 steer/follow_up，原 active run；消费回执与受理不同 | 运行中方式选择；队列回执；本轮消费后清草稿 | 根接通；A2/A3影响目标子代理 |
| clear_queue | Pi 原 clear_queue + Django 原生代理消息队列清理 | 队列回执“清除目标待执行队列”、停止前清队列 | 有入口；目标回执 A2 |
| bash, abort_bash | 真实 Pi bash / abort_bash | `!`进入上下文、`!!`排除；输出/exitCode/truncated/cancelled；独立停止 bash | 接通；计划模式服务端拒绝执行 |
| tree | get_tree + get_fork_messages + 已登记 session IDs | “读取会话树”、嵌套节点、有效 fork 起点、truncated | 接通；A7主消息区历史一致性 |
| session_new, session_switch, session_fork, session_clone | new_session/switch_session/fork/clone，登记 ID，不接受宿主路径 | 新建/已登记分支切换/树中“从此分叉”/克隆 | 接通；不会回滚文件或业务；A7 |
| session_navigate | 明确 `unsupported_pi_version`；Pi1.3.0 无 navigation RPC | 无入口 | 正确不开放，不构成缺口 |
| compact | 真实 compact，持久新 operation/capability | “压缩历史（调用模型）”；控制回执 | 接通；customInstructions 可选，UI默认即可，不强求每字段独立按钮 |
| stats | get_session_stats；另展示 Django 模型派发用量 | “统计”、账本 token 与费用未知/未配置 | 接通，未把未配置费用当免费 |
| export_html | 原生 exporter 后生成过滤私有 provider/thinking 的公开 HTML | “导出会话”、收集后下载；原控制回执恢复 | 接通；原生私有导出不是第二个UI选项 |
| model_set | 系统 resolve_model + Runner 配置绑定与实际回读 | 模型选择、“应用模型”、请求/实际与回执 | 接通；实际模型元数据须后端确认 |
| thinking_set | 实际 set_thinking_level，配置/供应商/Pi交集，运行中排队安全点 | 动态档位、请求/实际/待生效分别显示 | 接通；不公开私有推理 |
| ui_response | 普通 extension UI typed response；问卷绑定 request/op/generation | select/confirm/input/editor、整份问卷选项/自由填写/取消 | 接通；根当前会话问卷可刷新恢复；子问卷A6 |
| terminal_create, terminal_input, terminal_resize, terminal_close | 同容器真实 Linux PTY、独立 inputId/inputSeq 与 ack；resize/Ctrl+C | 多终端、xterm输入/尺寸、Ctrl+C、关闭、引用选区 | 接通；输入未知不重送，输出 gap 明示；刷新选择原终端 |
| file_list, file_read, file_download | 固定 no-follow helper、版本 SHA、不可变下载快照 | 浏览目录、打开文本、二进制/大文件说明、收集并下载 | 接通；路径只根工作区，下载不读后改字节 |
| file_write, file_mkdir, file_rename, file_delete | expected SHA/create-if-absent；冻结同 owner 写者后原子提交 | 新建文本/目录、编辑保存、重命名、删除确认 | 接通；计划模式服务端限制；删除目录非已实现用户能力 |
| pause, wake, reset | 原容器 pause/wake；reset 新代际、保旧审计/卷 | 环境菜单，暂停/重置明确确认，唤醒显式 | 接通；unknown不通过reset消除 |
| upgrade | 受控已登记升级 plan，镜像/来源/协议/保留工作区回读 | 服务端计划下拉、“升级环境”、确认 | 接通；登记/构建/安装系统本身属于运维，不另做UI |
| dependency_install | 容器外受控包获取 + 离线resource_install，pip/npm/uv，精确依赖图 | 包名/版本或完整JSON依赖清单、安装回执、resources | 接通；系统依赖仍走镜像，用户扩展不变成可信 Skills |
| research_search, research_read | 隔离公开读取，显式query/url，DNS/redirect/公网校验 | 公开研究表单、来源/时间/证据、引用到对话不自动发送 | 接通；A8刷新全文恢复缺口 |
| skills_reload | 固定可信内置 roots、原生发现/读取/显式命令、安全点重载 | 技能勾选、`/skill:name`、状态目录/诊断/阶段audit、重载 | 已接线；A1/A4，不开放用户导入 |

## 153 原生 9 个控制与辅助工具

| 控制/能力 | 服务端执行与权限/等待 | 前端入口/呈现/恢复 | 判断 |
| --- | --- | --- | --- |
| mode_set | 根modeRevision/admissionEpoch/treeVersion；模型只可转plan；转execute核确切计划/scope/tree | 转计划/按当前计划转执行/确认；请求切换与稳定状态分开 | 接通，未知排空保 switching |
| plan_save | goal/constraints/steps/deliverables/openQuestions 不可变版本，expectedRevision CAS | 计划表单、旧版本冲突提示、读取最新、复制历史为草稿 | 接通；UI goal maxLength高于后端4000，错误会被后端拒绝，可对齐边界 |
| agent_spawn | 独立 session/container/capability，依赖/文件显式，默认继承模型/强度/技能；业务引用原action | 创建表单、树、状态 | 基本接通，显式覆盖与委派A5；子详情A6 |
| agent_list | 原根树、成员、模式、消息、waits、handoffs | “刷新代理树”、父子结构/目标选择 | 接通；根/子详情与交接A6；根本轮完成不宣称整树成功 |
| agent_send | 持久消息、不唤醒空闲代理 | “发送消息（不唤起）”、消息清单 | 接通 |
| agent_follow_up | 空闲新run，忙时持久排队；不授新业务意图 | “续聊/排队”、目标任务框、消息回执 | 菜单接通；任务框A3 |
| agent_wait | 先登记 waitId/cursor/集合，事件/消息/终态/取消/超时唤醒，释放并发槽 | 等待集合、状态/结果、“读取等待结果” | 接通；固定300000ms为UI默认，非需增加所有timeout配置 |
| agent_cancel | 目标与后代停止新增工作、撤委派、保unknown | “取消子树”、实际取消状态 | 接通；不把canceling说成回滚 |
| agent_close | 仅无活跃操作/UI/wait/业务unknown时关资源，保历史和文件 | “关闭已终结资源”、closed | 接通；问卷/等待/业务仍活跃后端拒绝 |
| questionnaire（固定扩展本地工具） | 结构化1–10问题、描述选项、自由回答；普通信息不授业务执行 | 专用问卷、整份提交、取消、pending恢复 | 接通；子问卷入口A6 |
| analysis_helper（固定扩展本地工具） | statistics/replenishment固定分析，输入有界，无任意代码/写盘 | 通过用户任务和工具过程回执触发 | 正确沿任务调用，不需第二套计算面板 |
| `/runner-catalog`与`/skill:name` | 固定扩展命令、可信审核资源、原生发现/explicit语义 | 任务框可显式输入；技能目录与audit | 可达；A1阻断新planning技能选择 |

## 三期业务与一期只读数据能力

| 已实现能力 | 用户入口和真实结果 | 权限/确认/恢复判断 |
| --- | --- | --- |
| create_work_plan / prepare_pi_work_plan | 本轮勾选 + 正文目标参数；正式 workflow 对象链接、领域回执 | 参数完整直接排队；已有963修复自动入队；真实效果验收归执行者 |
| save_replenishment_draft / prepare_pi_replenishment_draft | 本轮勾选 + 正文参数；可编辑inventory草稿链接、来源/建议/数量 | 新鲜数据直接排队，过期快照专用卡人工确认；模型acknowledgeStale不替代用户 |
| execute_registered_gap / prepare_pi_gap_execution | 本轮勾选，模型读取本轮选项并准备；卡片预览店铺/日期/workflow/版本/覆盖，专用确认 | 六店tmall-seven-day-gap-v1真实活动版本匹配才派发，无缺口不建任务；未采用候选明确拒绝，非缺按钮 |
| deliver_report / prepare_pi_report_delivery | 本轮勾选，模型读取已收集PDF/XLSX及目录；专用预览正文/附件/机器人/接收对象，人工确认 | 当前环境获准文件≤2MiB，正文/附件分别提供商回执；unknown/部分成功不重发，不把受理说成已读 |
| get_pi_business_options / get_pi_business_action | 模型工具提供原意图/actionId、接收目录、文件与原动作状态；业务卡可读 | 选项本身不授权；UI无接收目录浏览器，但可由模型+具体预览完整使用，无需把consumer接口做管理UI |
| confirm / cancel / reconcile | 业务卡确认范围/请求取消/查询并协调原回执 | 原version/previewDigest/clientRequestId，刷新只读；不得换动作ID规避unknown |
| 权限内中央只读工具/数据集导出/get_pi_dataset_export | 任务正文、执行过程、产物与manifest/SHA | pi_agent中央目录逐项risk/surface/role/scope过滤；单店映射失败关闭；无需每个工具一个按钮 |
| Python/Node/工作文件分析与报告 | 用户任务及选定内置Skills；本地工具过程/文件下载 | 容器无网络/宿主凭据；任意代码不在宿主执行；无业务写权限传染 |

## 不应补成用户入口的内部能力

- Runner HMAC create/poll/heartbeat/abort/dispose/receipt/download、capability续租、本地admission/local_complete、模型/中央工具网关与签名consumer：执行与安全控制面，沿现有任务触发并呈现必要状态即可。
- 凭据/authority/DPAPI、PreparePi/UpgradePi/原生镜像登记、安装器、Linux user unit、n8n候选采用/激活：受控运维与生产授权面，不因本轮“前后端一致”开放网页任意调用。
- Pi `resource_remove/resource_reload` 明确reviewed_resources_required，`session_navigate`明确unsupported_pi_version，TUI custom组件不在RPC支持范围：不可将声明或拒绝分支冒充已实现用户功能。
- 私有thinking/provider frame/原生完整session JSON不得为“后端有字段”而展示；公开档位与脱敏导出已足够。

## 本轮检查与后续复审入口

- 完整读取任务相关现行规范、Pi运行说明与必要记忆；共享vault仅有一篇实际daily-review笔记，旧运行状态不覆盖当前源码与授权。
- 对照公开路由、36个workspace声明、9个native控制、2个固定辅助工具、7项审核旧技能+新增planning技能、4项业务动作及内部安全控制面。
- 无副作用AST目录对账确认：workspace唯一缺UI字面量是实际不支持的session_navigate；9项native均有前端调用字面量；advertised/rejected技能差集为native-planning。
- 复审范围限定主代理与后端执行者修复增量及其直接调用链；A2必须覆盖已受理但POST响应丢失后只读恢复，A3覆盖根/子运行状态不同的组合。真实模型、机器人、生产业务验收由其原负责人串行执行，本文不抢会话。
- 当前未合main、未部署；本文不授予后续合并、上线、正式迁移、真实补缺或外发。

## 增量复审记录

### A1 技能目录修复

已直接读取 `pi_service.py` 修复差异与新增 `test_pi_live_acceptance_skills.py`，静态复审无阻断。修复删除第二套 `SKILL_IDS`；请求仍先检查列表、字符串、去重与最多3项，进入原authority事务后从当前部署审核 `skills()` 精确选择并校验数量相等，防止遗漏/未审核名称。原幂等请求继续复用已持久快照，未把旧包误升级。

执行者报告 `tests/run-pi-business-verification.py ai_assistant.test_pi_live_acceptance_skills` 隔离3项 exit 0。测试源码覆盖：1.3.0 native-planning 接受、1.2.0拒绝、未知技能和非字符串拒绝且不创建操作。审查者复用该证据，未重复运行或调用真实会话。A1在当前工作区修复；不表示已合main或部署。

### A2–A8 与统一壳增量

直接核对当前6份TSX、Pi CSS、新增能力浏览器测试及修改的原浏览器测试。已读取 `D:/codex-artifacts/piagent-phase3-verification-20261020/` 下 `unified-mode.log`、`capabilities-ui.log`、`legacy-pi-browser.log`；各1项通过，未重复运行相同证据。`ui-types.log` 无诊断输出，主代理另报告修改闭包类型诊断0；此处不把空文件独立解释为成功退出证明。

| 发现 | 当前处理与审查结果 |
| --- | --- |
| A2 | `Intent.targetSessionId` 在原POST之前写入原环境key；响应丢失后仅GET原child workspace，按原clientRequestId对账并以control.id去重展示，无第二次POST。回调同时核AbortSignal与完整owner/session/epoch/generation key；根代际变化清snapshot/receipt缓存。浏览器反例确实在子控制持久后丢POST响应，刷新后子GET解pending且总POST数不变。已闭合。 |
| A3 | `piTargetMessageCommand` 读取目标的实际status+activeOperationId，空闲目标走agent_follow_up，运行目标走所选steer/follow_up。根running/子idle及子running反例已覆盖。已闭合。 |
| A4 | 明示每轮最多3项，第3项后禁用未选checkbox，仍允许取消；服务端原边界保持。已闭合。 |
| A5 | title/modelId/thinkingLevel/skills/businessActionIds 已有显式表单，缺省继承、技能仅列父快照、业务只引用原actionId，未复制授权。测试核精确payload。目标模型思考档仍有下述限定，暂不称该部分完整闭合。 |
| A6 | 目标区“打开子代理会话与产物”调用原selectSession，复用现有详情/问卷/文件与scope围栏；浏览器核查子PDF真实下载链接可见。已闭合直接入口缺口；根面板不额外聚合所有子消息正文。 |
| A7 | 原生分支变更后明确显示“消息区保留本环境全部执行历史…不等同于模型当前上下文”，具体Pi branch/leaf/tree仍可核对。该限定展示已闭合误导问题；本轮未实现按原生当前分支重建全部聊天正文，不应在交付中声称完成此能力。 |
| A8 | GET恢复最新已完成原研究control.result；>4KiB时展示原sources/摘要和全文未恢复说明，不自动重新出站。浏览器核查来源可见且research POST数为0。已闭合结果无入口问题；历史大回执全文仍非完整恢复。 |

统一 `AiConversationShell` 集中标题、历史、搜索、刷新与composer展示。Chat/Agent仍各自controller和账本；模式切换使用hidden保持挂载，未把Chat请求转作Pi请求，未改central surface、principal、权限、业务确认契约。descriptor用ref读取最新回调，签名变更仅更新展示，不派发任务。模式测试核Chat草稿保留、Agent只提交1次、跨模式恢复完成结果与本轮文件，未发现本增量的重复派发路径。

复审另发现环境操作确认可跨环境复用：A环境打开暂停/重置/升级确认后切B，旧确认状态可绑定B的submit。主代理已改为`confirmation={key,command}`且仅完整key匹配才渲染；key变更同时清confirmation与upgradePlanId，读取另一个文件也清旧确认。静态增量通过，能力浏览器另覆盖generation1→2时旧确认消失且pause POST数为0。此项闭合；153计划确认原有key重挂和revision变更失效仍保留。

当前A5剩余限定：子代理显式选其他模型后，思考档仍枚举父代理`native.thinking.supported`；父只支持off而目标模型支持high/max时，目标高档无法在该表单选择。服务端会拒绝不支持的组合，因此没有扩权或静默降档，但不能宣称模型特定档位完整可用。已回传主代理，建议使用服务端安全返回的目标模型supportedThinkingLevels作候选，不暴露凭据或管理员配置。

### A5 目标模型档位最终闭合

以上A5限定随后已修复并完成定向增量复审：`pi_views.py` 的公开审核目录对每个模型返回 `supportedThinkingLevels=thinking_levels_for_model(model)`，复用现有有效参数校验；查询仅在原公开列外追加 `reasoning_mode/generation_options_json/max_tokens`，未读取或返回凭据、base URL、完整生成参数等管理员字段。前端 `spawnThinking` 在显式模型时读取对应模型目录，继承时才读父级快照；切模型清除旧思考选择，最终提交仍由原服务端复核。

独立读取 `test_pi_model_catalog.py`：实际GET与SQL捕获证明禁用思考的父模型仅off、可调目标模型包含high/max，且SQL不读api_key_encrypted/api_key_suffix。`model-catalog-tests.log` 显示该项与技能目录3项共4项通过；更新后的能力浏览器将父快照改为仅off、目标m2目录high/max，显式选择high后精确spawn payload通过。未重复执行既有测试或调用模型。

最终结论：本轮A1–A6与新增确认跨环境缺陷均已在当前候选工作区闭合，A7/A8按上述清晰产品边界闭合；对本次统一壳、公开目录与直接能力接线增量未发现剩余实质阻断。该结论不把源码/合成浏览器证据扩大成生产全部功能验收，真实模型/消息证据由 `live-REPORT.md` 独立说明；不支持的RPC、内部管理与运维面仍按矩阵排除。最后差异格式检查仅发现 `ai-pi-workspace.tsx` 空行尾空格，已交主代理清理，不影响上述契约结论。未合main、未上线的授权边界保持。

## 2026-10-21 恢复验收的未知请求与清理边界复核

用户明确恢复任务后，本次独立审查仍只读；没有重新启动隔离PG/Runner、调用模型/机器人、改生产状态或转派。当前候选HEAD为 `8ac3000e`，恢复验收使用已运行正式公开API。以下只说明原证据所能支持的结论，不替代新的实际投递验收。

### 原失败可确认的事实

证据位于 `live-evidence/resume-20261021/` 的 `public-results.json`、`public-failure-events.json`、`original-operation-ledger.json`、`cleanup-observation.json`、`formal-deployment-observed.json`。已核必要源码与正式来源 `2be62f90` 在 `pi_gateway.py/transport.py/pi_workspace.py/pi_runner/workspace.py` 无差异。

- 新合成会话原操作 `pi-op-b59d4836-4b87-4990-84e8-c82fa6ff3c02` 在唯一模型派发后转为unknown。诊断精确为 `provider_unavailable / stage=response_headers / reason=unavailable / requestStarted=true`，未返回httpStatus；原模型派发身份及unknown保持。
- `transport.py` 在 `connection.request()` 后进入response_headers，`getresponse()` 的OSError/ValueError/HTTPException归并为该固定错误。现证据不能区分具体网络/HTTP异常，不能断言供应商全站故障、额度不足、模型不支持或产品payload缺陷；请求可能已到达上游，不能判未计费或自动重放。
- 强制只读账本显示该操作无local admission/tool/file派发、业务动作0、正文/附件发送派发0；原任务是复制两份合成输入，尚未进入业务投递意图。因此“没有外发”有原账本依据，不能把任务unknown说成已经发送但未回执。
- 原 `control:freeze` 已completed，native保存回执为disposed。`pi_worker.dispose_environment` 只在原operation身份签名dispose返回disposed后写completed；Runner原dispose撤销会话、关闭终端、移除精确容器并核不再存在，保留所属卷和审计。原执行capability也被撤销。原环境已受控处置，无须再pause/dispose、停共享服务或删卷；未知模型调用仍不解冻、不重放。
- 清理脚本另一次pause失败时没有保留原HTTP错误正文，不能宣称精确状态码或成功。源码对ACTIVE（含unknown）的pause在创建control前拒绝，与公开workspace controls为空相符；它不推翻已完成的原freeze/dispose，也不能把该catch的“cleanup unknown”解释为仍有运行容器。

### 后续独立投递验收边界

在主代理确认的既有“真实模型及本人单聊合成投递验收”授权内，可以继续一个明确不同的投递验收，不为此补修未经证实的产品问题。采用新会话、动态启用模型和新业务意图的理由必须是投递任务本身，而非规避原unknown、换模型重跑原复制提示词或把原b59d改称恢复成功。

继续前最小证据为：当前启用模型ID/版本；已生成合成PDF/XLSX不可变SHA及新环境获准收集身份；真实principal对应的唯一direct对象与机器人动态匹配；仅`deliver_report`的新意图及具体附件/正文/接收对象preview、version和digest。准备、确认、正文与附件提供商回执分别保留；unknown或部分成功不换ID重发/改投。原未知请求和zero-business证据继续关联保存。没有据此授权群发、业务数据查询、发布或旧会话维护。

对模型公开origin的无密钥/无对话/无业务正文GET和DNS诊断只提供连通性线索，不能证明认证模型POST、额度或本次任务已经恢复。独立审查者不执行这些网络或副作用动作；上述结论已直接回传主代理与真实验收负责人。

### 独立新投递任务、空POST诊断及本机容量旁证

后续执行者在独立新会话使用当前已启用Agnes v3模型开展投递验收。独立核对 `tests/pi-live-acceptance-public.py` 的workspace-staging路线和原Django/Runner代码：

- 先通过公开 `model_set` 创建/使用原authority的 `workspace:init` operation；`_new_operation/_create_environment/_finish_init` 沿原身份/代际/租约/截止日与Runner签名路径，不派发模型请求。
- 合成原字节先核旧MANIFEST SHA，经公开 `file_write` 的 `expectedSha256:null` create-if-absent准备，再经 `file_download` 的原SHA收集。原 `_capture_download` 核不可变downloadId、长度及双方SHA，随后在authority mutation调用原 `save_file(direction=output)`。这不是手改PiFile.direction，也没有绕过文件来源或模型权限；两份产物实际保存的是带路径hash前缀的文件名，后续按确切fileId/SHA辨认。
- 新任务只授deliver_report意图，明确禁止模型创建/复制文件，保留与原b59d未知请求的关联。前置五个原workspace控制均completed，两文件SHA与合成原件相同。

新增原证据 `agnes-direct-delivery/original-operation-ledger.json` 纠正了最初仅据operation unknown所作的口头推断：Agnes第一条model派发completed，随后两条tool派发completed，第二条model才unknown/provider_unavailable。公开事件仅标system_tool，现已读证据未列确切工具名或领域结果，不能据completed说已经准备或发送报告。业务action数量及正文/附件发送派发仍为0。第二个原control:freeze也completed，native disposed；不需要再次pause/dispose，第二unknown与原意图保持。真实投递验收尚未完成。

独立读取已执行取证源的安全副本 `single-empty-post-command.py.txt`：仅一次原transport `_bounded_json`，精确OpenCode chat路径、headers={}、body={}，不含model/messages/认证，timeout15秒、响应65536字节上限；不调用provider.turn，不读取密钥/旧模型私有响应。本进程仅配置内存SQLite，没有启动PG或Runner；底层沿原公网DNS校验、单地址连接固定、原域名TLS及无代理/重定向/自动重试。实际 `single-empty-unauthenticated-post.json` 结果为HTTP400、约1.734秒，不是401。此证据只能说明空未认证小请求可收到HTTP拒绝，不能证明认证/工具正文请求、额度或原任务恢复。

新的 `postgres-capacity-window.json` 记录04:47–04:58窗口仅两条容量FATAL：04:48:10.832和04:56:26.922，均为普通连接槽耗尽、剩余槽保留给SUPERUSER；分别在两个model unknown落库前约8/9毫秒。事后只读连接观察为128/128。由此可以确认两次失败即时存在本机PG连接容量拒绝，不能继续把它简单归为外部供应商故障。

必要源码还显示共同路径：`pi_gateway._model.cancellation` 的外来监视线程每次查询PiOperation、finally关闭其连接；`transport.watch_socket_cancellation` 每0.25秒调用该check，捕获任何异常便shutdown/detach在途HTTP socket，且未保留原check异常。主线程已有连接的再次check仍可能成功，最终只留下response_headers/provider_unavailable。**源码与两次精确时间旁证高度支持“本机连接耗尽导致取消监视器中断请求”这一因果解释；仍无原watch线程trace/PID归属，不冒称直接捕获原异常或已复现具体线程。**

监视器在权限/状态无法确认时断开请求属于保守失败关闭，不能为减少报错而忽略PG/check异常或让模型继续执行。若进入后续修复，应保留失败关闭、unknown和不重发，按证据处理连接归属/容量以及将固定取消检查失败来源传回主线程；不先增加超时、不无限换模型，不借新ID重做两个未知请求。独立审查者没有执行任何额外网络、模型、外发、生产清理或隔离栈动作。

### 取消监视器候选修复独立增量复审

已直接读取 `transport.py`、`pi_gateway.py`、新增 `pi_cancellation.py` 与直接调用方 `provider.py/chat_stream.py/pandas_sandbox.py/pi_worker.py`，以及新增 `test_pi_live_acceptance_cancellation.py`、原DNS阶段夹具的小幅签名调整、前端固定错误提示。未修改源码，未由审查者启动测试环境、数据库、Runner或外部请求。

当前增量复审无实质阻断：

- Pi的监视连接在所属线程创建独立DatabaseWrapper，仅在该线程替换Django alias，入口建立连接/核autocommit、定时检查复用、退出关闭并恢复原alias；不把owner的DB wrapper跨线程。owner仅在transport前有一次允许的连接老化边界，活动期间不再close_old_connections。连接与statement_timeout从当前配置/原会话更短限制及本轮预算取界，不放宽原权限。
- watcher首检完成才准入该HTTP连接；首次容量/权限/取消检查失败或首检超时不会调用provider connect/request。原transport的DNS恢复GET也各自走相同首检路径，未带模型正文或凭据。
- 首个watch失败在锁内保存；即使owner后续查询成功或下层只报socket/JSON错误，HTTP异常分支、成功出口及finally均重新检查该原失败。新固定 `ai_cancellation_check_unavailable` 只提供有限stage/reason/requestStarted/SQLSTATE等元数据，错误正文、SQL、连接串或供应商正文不进入公开诊断；真实取消/权限AiError代码仍原样保留。
- stop与socket切断使用同锁，先标stopped后清理；迟到检查不得detach已经交还给调用方的socket。清理线程尚未确认退出时返回固定cleanup_unconfirmed/cleanupComplete状态，不能把未清理状态当成功；线程迟到完成仍关闭其自有连接。
- `principal_for_work`前检及原`principal_for`最终身份、权限、session epoch/generation校验保留，真实用户取消仍在检查中断请求；原gateway dispatch/op unknown、同身份不重放、无新自动重试规则保持。Chat默认无scope取消、pandas现有callable stop使用方式兼容；没有给普通Chat或模型增加业务权限。

已读外置证据 `D:/codex-artifacts/pi-unified-chat-20261020/live/resume-20261021/`：`cancellation-memory-tests.log` 共19项OK，涵盖容量首检零HTTP、首检阻塞/超时、迟到不detach、socket/JSON故障不遮盖首错、成功出口取消、默认无scope、清理未确认、provider→_model→gateway原dispatch/event与不重放，以及原DNS阶段边界。另 `cancellation-ui.log` 的8项前端固定提示/路由检查通过。

`cancellation-private-pg-tests.log` 最终1项OK，真实私有PG核三次watcher查询同一backend PID且不同于owner、owner在活动期间close_at过期仍不重连、实际取消可观测、线程结束后watcher backend已消失；日志尾含PRIVATE_PG_STOPPED、私有cluster已停/端口关闭。首次测试在factory允许的一次老化边界之前取owner PID导致FAIL，原件完整保留为 `cancellation-private-pg-first-baseline-failure.log`；随后把活动期比较基线移到该边界之后，未为过测移除必要前置清理。审查者独立核对了修正与最终日志，没有重复启库。

结论仅适用于当前候选增量：消除0.25秒反复建连并改正检查错误的来源传播，不增加正式PG连接容量，不证明128槽正式负载已恢复，也不把两次历史unknown改写为确定的原线程异常或成功。是否合main/上线仍按用户当次明确授权；本次没有执行这些动作。

### 新私有实投夹具的动态policy读取最小复核

按主代理已确认的当前真实投递授权，仅复核 `tests/pi-live-acceptance-secrets.py` 和case的`effective_config/direct wrapper`增量。启动时一次只读模型完整runtime字段与一次key解密仅经内存/stdin；后续`current_policy`每guard仅短连接读取policy identity/enabled/groups/version，强制readonly、statement_timeout/connect_timeout各5秒，退出关闭，不重新读取模型或解密key。每次还读取当前真实`auth/me`与已核路径的机器人配置，原配置schema/enabled gate、唯一owner/role/scope直接绑定和原`_targets/_prepared`版本/附件字节/transport guard保持。

`dingtalk_transport.send/send_media`的wrapper保存并调用原实际函数，只额外限制direct及原获准绑定；没有伪造正文/附件提供商回执。私有catalog只载候选真实报告工具，background principal shim每次动态核实际账号role与scope，不开放业务数据或其他写动作。当前最小增量无安全阻断；另要求confirm前明确核preview附件fileId/SHA等于本轮预期合成文件，防模型选错两份合成附件导致验收误报。

已通知执行者补这两项确定性断言后，可按主代理既有授权启动一次精确PG55541/Runner18123、namespace `pi-test-live-resume-20261021-7f4d2a16` 的独立候选投递；不新增产品复审或外部探测。此处只记录审查边界，不代表实际执行/发送成功，结果以该次原账本与清理回执为准。审查者未运行这些动作。

### 候选实投的技能切换路径审查（进行中）

该次候选 `candidate-isolated-delivery` 原证据显示：workspace:init create完成且5个staging controls完成，随后新prompt操作 `pi-op-13a6ce15-1bae-4653-b28f-756e60ee2938` 的runner:create为unknown，原native固定错误command_outcome_unknown。没有任何model/tool/business action或正文/附件发送。原native随后dispose完成、sessiondisposed；cleanup.json记录双端口closed、Runner退出0、精确namespace容器卷已删除。Django结果中的control:freeze prepared是较早快照，不覆盖后续native已完成处置。原unknown不重放。

已核 `Broker.create(existing)` 会对比当前技能并调用 `update_skills`：本次workspace:init技能为空，而旧实投run夹具选择excel-report，因此实际走空闲检查、旧Pi退出、新Pi启动和重新绑定路径。现有前端允许合法换技能，不能仅把投递夹具改为空技能就宣称产品切换能力没有问题。另一方面，投递既有附件本身不需要excel-report，夹具简化与产品能力判定应分别说明。

原native没有保存失败的底层阶段/trace，约5秒后的command_outcome_unknown不能证明究竟是退出、启动、目录发现还是绑定失败。旧真实 `test_04_idle_atomic_skill_update` 覆盖1.0→1.1显式skills变更及后续create同技能，未覆盖本次1.3空→excel-report的existing-create重启。

另发现可用无网络假流验证的直接生命周期风险：`Session.read`仅在EOF时检查 `self.proc is proc`，处理正常帧前没有该身份门禁；技能重启等待旧进程退出但不等待旧reader处理完缓冲。旧reader若在新进程启动后继续交付旧setStatus/catalog/agent帧，可能改动当前skills_catalog或phase。已建议执行者用阻塞假stdout流先固定旧proc、替换当前proc和新状态、再释放旧帧，检查不会污染新状态；此源码支持的竞态风险尚未证明就是本次原失败根因。审查者不运行反例或新环境，等待执行者定位/修复后仅做增量复核。

后续事实更新：执行者无付费真实rootless反例 `skill-change-real-before.log` 得到精确栈 `update_skills→start→bind→_bind→thinking_level_requires_explicit_change`。同模型技能重启未恢复先前实际off档，新Pi默认档与旧provider支持集合不符；这已是可复现产品缺陷，不再仅是假设。修复应只恢复重启前已核实际档到原模型，保持用户切换新模型时不支持组合仍要求显式选择；不得泛化强置off或跳过_bind。

旧reader目录污染也已由执行者无网络反例复现。其第一版仅在readline返回后增加proc身份if，独立审查又按根代理提出的第二交错做了纯Python有界检查：mock `server.decode`阻塞，旧reader越过第一个if后切换proc/new catalog，再释放decode，最终catalog仍变old。检查没有写源码或启动任何DB、端口、容器、网络，线程已退出。由此确认单次无锁identity if不足以围住该竞态；已要求proc替换与record应用使用同锁或明确旧reader退出确认，不以第一种延迟readline反例通过替代完整闭合。它仍不被冒称为原13a6失败根因。

第二版把decode放锁外、proc复验与record应用放同session锁，并将proc替换也放同锁，已覆盖上述第二交错；但独立静态复审又发现新锁序反转：`Session.write`依次取write_lock→session.lock，而原`workspace.cancel_queues`在session.lock内调用write，造成相反session.lock→write_lock。并发取消与普通RPC可互等，已作为本增量阻断回传执行者，要求UI取消写出移锁外/按捕获proc发送或统一无反转锁序，并补无网络并发反例。无付费技能切换after日志已成功不替代此锁序问题闭合。

最终增量复审通过：`Session.write`先在session锁内捕获目标proc，释放后再取write_lock做pipe IO；`cancel_queues`在session锁内原子摘录UI及清队列状态，锁外按捕获expected_proc写取消，消除反向锁序且不把旧取消写向新进程。readline/decode及RPC等待在状态锁外，proc身份复验与record应用同session锁；所有相关proc替换也同锁，旧异常/stderr与延迟gateway帧均不再污染新实例。旧模型重启只恢复原已核实际思考档与原支持集合，新model不支持组合仍显式拒绝，未跳过_bind、权限、busy、审核manifest或未知围栏。

已独立读取 `skill-reader-memory-final.log` 的5项OK，覆盖延迟readline、延迟decode及旧坏帧、旧gateway不写新进程、取消/普通写锁序与pipe不持状态锁、用户新model不支持档显式拒绝。另 `skill-change-real-final.log` 的真实无付费1项OK：同环境1.3.0空技能→existing-create excel-report回到idle（1.431秒），实际off档保留，gatewayRequestCount=0、原dispose为disposed、cleanupComplete=true。原before失败及中间无锁guard/锁序缺口均保留证据，不能倒写成已通过。当前相关候选无剩余实质阻断；本审查未重跑实景、未调用模型/机器人、未合main或发布。原实投13a6的command_outcome_unknown仍保持，不因新反例成功改写为已恢复。

### fdd65231 后的Go限流与另一模型独立验收边界

已读取 `candidate-isolated-delivery-after-skill-fix/results.json`、`run-metadata.json`、`cleanup.json`：来源fdd65231；5个staging control、runner:create/skills_loaded/prompt均completed。原操作 `pi-op-3e39123b-d28a-49b9-ae3a-db8f018648e5` 内第一条model和一条tool已completed，第二条model才unknown/provider_rate_limited；不能把整个operation unknown说成首个模型HTTP就失败。真实正文/附件投递未执行，deliveries为空；脚本在模型轮未succeeded时退出，不进入专用业务confirm/perform。原业务action精确计数由执行者另行保全，不能从空deliveries单独推导action数。

当前固定transport源码仅把HTTP429映射为provider_rate_limited；这支持限流判断，但直接原responseDiagnostics.httpStatus证据仍以执行者原件为准，不能事后编造。限流原dispatch/operation保持unknown，不自动重发Go、不调大超时、不换ID恢复该轮。cleanup已明确私有PG55541/Runner18123双端口closed、Runner退出0、精确namespace容器及卷删除。

在主代理已确认的持续多模型/真实消息验收授权内，可以明确开展Agnes工具能力的另一独立验收，当前未见其必然违反原unknown不重放的实质阻断：动态选当前已启用模型及版本、新会话/新意图、使用该模型专属的新caption，旧Go未知和零外发事实明确关联，不把新结果称为原Go任务恢复或Go工具能力通过。新预览仍须核本人唯一direct、不可变合成fileId/SHA、正文、version和digest后单次confirm；已有/新action unknown或部分成功均不通过换actionID、换模型、改投来补发。本审查不新增模型/网络/外发动作，实际是否完成以该次原回执为准。

### Agnes 两份真实投递最终事实复核

独立读取 `candidate-agnes-tool-capability/results.json`、`business-per-action-readonly.json`、原带时间的progress/readonly观察、`run-metadata.json` 与最终 `cleanup.json`，在PDF结果和清理出齐后完成复核。另对这些已保存JSON做纯数据交叉断言，没有重跑环境、模型或外发。

- 来源fdd65231的候选源码、Agnes `agnes-2.5-flash` v3及原4096输出/260秒任务预算保持；两轮operation均succeeded，每轮3条model、2条tool派发全部completed。该结果证明本次候选Agnes报告工具链，不能扩大为Go能力验收或正式已部署。
- XLSX动作 `8b6d7886…` 与PDF动作 `72979c3b…` 均succeeded。每个原action只出现1次client:confirm、1次dispatch_intent、正文dispatch/receipt各1、附件dispatch/receipt各1。最终真实ORM effects为actions2/bodyDispatches2/attachmentDispatches2；早期模型轮结束时的0发送快照不作最终结论，原时序证据保留。
- 两项原preview均为direct，正文分别带 `AGNES TOOL CAPABILITY` 和对应XLSX/PDF标记；fileId、previewDigest与结果引用一致。原合成XLSX的SHA为 `5808407b…3b5b1d`、3566字节，PDF为 `80d2ce18…66a206`、1200字节，均与此前原件一致；确认前完整fileId/SHA断言及原targetVersion重新核验保留。两动作最终version均5，各自receipt带独立targetVersion。
- 两项真实结果的body/attachment均为platform=dingtalk、state=accepted并带各自64位receiptSha256；aggregate均accepted_by_platform、mayReplay=false，objectId/actionId一致。只证明平台受理，不宣称已送达、已读或群投递通过；没有把两项成功回执当同一action的自动重发。
- 最终namespace `pi-test-live-resume-20261021-6e9a2d74` 精确清理回执：PG55541与Runner18123均closed、Runner退出0、私有容器/卷删除、cleanupComplete=true、productionServiceLifecycleChanged=false。原正式未知请求、Go限流unknown和先前失败原件均保持，没有重放或以本次成功改写。
- 对该目录JSON检查常见Bearer/access_token/加密密钥字段/DPAPI密钥正文/policyReaderPassword标记，未发现这些敏感输出；提供商回执只保留摘要，未保存真实凭据或原私有模型响应。

最终事实结论：本次候选的两份合成附件、两段正文经原业务确认与真实企业机器人接口分别取得平台受理回执，审计与清理完整，未发现剩余事实矛盾。它仍是隔离候选采用验收，不表示已合main/上线，也不授权继续发送更多测试消息。

## 后续已获合main/上线授权后的必需发布适配审查

用户随后明确要求将任务合main并发布上线，已撤销此前禁止；前文“未获发布授权”仅为当时历史状态。独立审查仍只读、无生产动作，不再追加业务验收。已重新读取当前AGENTS/模型映射及相关发布边界，审查最新main合入任务分支后的必要升级适配。

确定原发布缺口：`publish-prepared-main.mjs`此前仅在PiWorkspace/PiBusiness/PiNative结构新增时准备与采用独立Linux Runner；本轮只改Runner源码无migration，单纯DeployApp不会更新Linux user unit指向的独立来源，因而可能造成网页/Django新源码已采用而Runner修复未采用。

对当前最小修复增量复审无实质阻断：完整冻结releasePlan.changes同时检查path/before，非测试`backend/pi_runner/*.py`来源变更触发现有独立升级；仍优先沿旧PiWorkspace/PiBusiness/PiNative schema分支，无schema时明确使用当前153前驱对应Native1.3.0及87e41…固定镜像，并通过piUpgradeKind避免schema=null解引用。强制包含本次Django组件与prepared package，未新增结构迁移、ProvisionRoles或生产全局配置修改。此检测仅宣称覆盖本轮Python源范围；`source_digest`还哈希其他非测试资源，资源/镜像变更仍需对应明确交付，不能把本适配宣传为自动处理任意镜像资源变化。

PreparePiUpgrade传入精确prepared app ID/SHA。原Get-PiUpgradePreparedExecutionRoot核prepared包属于同sourceRoot并验证backend字节，随后在该真实来源计算Runner source_digest；并非从旧installed模板误读新来源。原PiUpgradeCheck复验同registered plan/source/image，准备与制品复用期间保持原app绑定；维护完整停止、DeployApp/Harden之后、Start之前才UpgradePi。原native升级入口仍检查AI端口空闲/PiWorker停止、旧配置和密钥身份、来源/镜像/协议、CAS及unknown不可重放；未改这些门禁。

已直接读取新增私有假引擎测试源码：no-schema Runner来源变更先prepare-only、不启维护/Upgrade；再复用已准备Worker/Django/Runner计划deploy，PrepareApp/PreparePiUpgrade/UpgradePi各一次，Deploy先于Upgrade、Upgrade先于Start，migration=null。主代理报告该用例与既有combined无迁移用例共2项通过，以及受改Python AST/Node语法检查通过；审查者复用既有检查，不额外运行发布、构建或业务测试。最终合并、制品及生产采用事实由主发布负责人原生回执单独记录，本审查通过不替代这些事实。

### 首次ready准入失败后的同目标再准入边界

目标main为 `2b6447f33d54c4aaf1b8b543ccd3707d73bf5584`，原包 `D:/codex-isolated/main-release-packages/2b6447f33d54-150a41fa-23ba6b9a` 已有PREPARED，实际SHA为 `0e78724e3f5ffdb5aa8ff885d7e89fbaed54beba8554b392f231cba21d619d0a`，包含原Pi升级registeredPlan07316e42…/source1175d4b8…。首次固定CLI日志 `release-2026-10-21T01-17-35.536Z-e227beaa-1b19-459d-b6b8-3ba0b26da998.log` 于01:17:50在“准备本次最新main”的readLivePublication就绪断言503!=200失败。

独立核源码顺序：observeLatestMain先fetch/freeze远端目标并调用readLivePublication，先核effective前驱/成功回执/来源，最后读原ready端点；只有其返回才进入prepareLatestMainOnce及deployReadyMain，后者再调用publishPreparedMain、写STARTED和执行维护/停止/部署。首次失败因此尚未进入本包生产动作段。独立采样本包STARTED/SUCCESS/FAILED及maintenance请求均不存在，正式system-maintenance/automation-drain/release-publication-lease均不存在；当前Django deployment SHA仍23ba6b9a…，精确匹配请求前驱，PUBLISHED-MAIN仍记录2be62f90及原Worker版本。审查者未另执行effective chain解析，当前Worker链以原CLI再次新鲜核验为准。

已读取主发布负责人保存的 `D:/codex-artifacts/pi-unified-chat-20261020/release-20261021/READINESS-AFTER-PREFLIGHT-FAILURE.json`：01:20:33.895Z，对同一原ready端点仅一次有界诊断自然返回HTTP200、ok=true/status=ready，没有服务操作。首次503原body未存，不能猜测具体故障或称已修复某模块。

结论：在原失败日志/准备包保留、冻结目标仍2b6447f3且前驱仍匹配时，可再次调用原固定入口消费同目标已准备包；这是重新通过尚未执行生产动作的准入，不是重放STARTED后的未知部署。原入口仍须重新核ready/身份/前驱/锁，不能跳门禁、重启服务、重建同包或删锁；fixedCLI会重新fetch，须核它再次选择的仍是该冻结目标。仅能称“本次未产生生产维护/停止/部署作用”，不能把fetch、日志、队列锁及finally准备consumer等非生产文件作用泛称全部零作用。本审查没有执行再次发布。

### 普通权限oneoff入口定向审查

第二次原ready已通过，但包内 `publish-main.mjs` 在调用publishPreparedMain之前的verifyPowerShellHost拒绝管理员token（True!=False），日志为packet下 `release-2026-10-21T01-22-49.440Z-1bdb1fbf-d3d4-49ac-bc3e-a62da3b23065.log`。独立重新采样：本包STARTED/FAILED/SUCCESS/maintenance-admission仍不存在，正式maintenance/drain/publicationlease不存在，PREPARED SHA仍0e78724e…。因此这次仍未进入生产维护/停止/部署，不存在需要绕过的已执行生产动作未知结果。

只读审查外置 `Run-Publication-Ordinary.ps1`、`Register-Ordinary-Publication.ps1`、`ORDINARY-TASK-PLAN.json`，无实质阻断：注册前核同安装SID、launcher SHA与已绑定SysPS SHA、task不存在；仅注册一个无trigger/密码、Hidden、InteractiveToken/RunLevel0的按需任务，以RunEx12指定同用户交互session。launcher实际调用已采用currentPreparationIdentity/assertOrdinaryIdentity，核elevated=false、integrity8192及同用户Explorer/session，另核Node SHA、远端目标仍2b和PREPARED精确SHA，再create-only写启动marker并调用原fixedCLI config --no-pause。没有改已有preparation任务、控制包、全局配置或原生管理员token拒绝门禁。

launcher只WaitForExit直接publisher，不等待其长驻服务后代；stdout/exit仅作启动观察，结果明确要求原native完成回执，不能冒作上线成功。按主代理计划，结束后核该oneoff任务非running、精确定义仍匹配再删除，不中断正在运行任务。已通知主代理可在现有上线授权内单次运行该普通权限入口；审查者没有register/run、生产动作或功能验证。原两次失败日志保持，不重建原包；fixedCLI仍自行重新核目标/ready/source/CAS和维护门禁。

### oneoff已退出前启动拒绝后的传输更新

主代理随后观察第一次oneoff为State3、instances0、LastTaskResult1，原launcher marker/result/stdout及native STARTED均不存在。原脚本的create-only marker在Start-Process固定CLI之前，因此marker缺失结合已退出任务支持原CLI尚未被调用；不能仅凭RemoteSigned设置猜测具体拒绝原因。独立文件采样仍见launcher marker/result/native STARTED均false、PREPARED SHA不变。

只读复核外置 `Update-Ordinary-Publication-Transport.ps1` 无实质阻断：仅在原launcher SHA仍匹配、两种STARTED均不存在、原oneoff精确State/instance/退出码及同SID/RunLevel0/InteractiveToken/无trigger/完整Path+原Args+WorkingDir符合时更新。原task XML保全，唯一动作改成EncodedCommand；载荷是同一已审固定脚本正文加有限host-entered与失败trap观察，原普通身份、同交互session、远端目标、PREPARED及create-only marker均保留，未改现有preparation或生产任务、控制包或权限门禁。RunEx仍指定原session/SID，无密码，无新自动触发。

已通知主代理可在既有上线授权内单次执行这次传输更新；它是修正已确认尚未调CLI的启动方式，不是重放生产维护/部署。启动观察与exit仍不充当native成功，正式完成以原native回执为准。审查者未运行更新或发布，也未追加功能测试。

更新脚本首次在任何Update/RunEx之前因COM返回Principal账号名而被严格字符串守卫拒绝。后续仅加与已采用main-prebuild-task Projection相同的NTAccount.Translate→SID规范化，再与当前SID作严格比较；翻译失败仍拒绝。独立读取该两行增量，确认未放宽身份/RunLevel/LogonType/trigger/Path/Args/WorkingDir或改变副作用顺序，允许继续已审传输更新，无需重新整轮评审。

主代理随后定位最初oneoff退出原因：identityProbe错误import固定first-adoption shim，其legacyBridge非null，对node -e的import会按原legacy栅栏exit75；未执行固定CLI。仅新建Reviewed helper，保原8d1…文件与旧task不动，把只读probe改为精确已采用851…bundle的main-control-dispatch库，并显式expectedBundle。独立核该库legacyBridge=null且main只在直接CLI执行时调用；readAdoptedControl仍核generation/manifest/固定dispatcher。新helper实际SHA e77e28ae…43bcc0，Update同时核原/新SHA并读取Reviewed正文；真正Start-Process仍调用原fixedCLI。仅该两处只读库绑定变更通过复审，未绕过实际CLI、token、目标、PREPARED、create-only marker及task前驱门禁，可继续已审单次更新。

### 已进入生产后的Pi升级partial失败事实复核

随后原普通权限入口通过，目标2b6447f3真正写入STARTED（2026-10-21T01:51:51.846Z），maintenanceId `f63867aa0eaa40a29c1c495806788dcd`。此后失败已经不是准入零生产作用，禁止重跑原publisher、维护或DeployApp。

独立读取本包原step result/process/native-complete、当前installed manifest及维护文件，确认：

- 进入维护actor42696 exit0，native-complete同maintenanceId、backendStopped=true/postgresPreserved=true；原actor/rotation owner身份有固定receipt。此处证明原动作完成，不代表审查者已另做当前进程退出核查。
- 停止旧Worker进程60392 exit0，结果already_stopped且仍指原20261020T183747Z-0b90a81150c2b203；DeployApp35056 exit0、HardenAcl28040 exit0。当前Django deployment实际SHA `79d6d565bfe85b881d4c0099563b998da772f3b044316ccdeddcbe8179f9be98`，精确匹配本次PREPARED新包，sourceRoot为本次2b冻结来源，因此新Django已经installed。
- WorkerApply-started/result及SUCCESS均不存在；源码顺序在UpgradePi后才切Worker、ExitMaintenance和Start，原执行没有到这些阶段。维护与automation drain仍同f638…，system-maintenance保drainedStopped=true；publication lease已清除，但这不清除原STARTED/FAILED未知边界。
- 升级Pi Runner原step绑定registeredPlan07316e42…，01:57:54.530Z启动；原FAILED在01:58:27.295Z记录process14748 exit1/nonzero_exit、elapsed32759ms、timeoutType=null、automaticRetry=false。不是超时或launchFailed，不能据exit1推断Linux零作用。
- Windows升级prepared原operation49207221306343018acd1c36216d6f52、plan c28d…存在，Windows intent为dispatching、result.json不存在；pi-agent.json实际SHA61193a9e…仍精确匹配原oldWindowsConfig，Runner source仍67abe…、image87e41…/skills1.3.0，尚未CAS到1175d4b8…。因此不能宣称升级成功或Windows配置已协调。

执行者正独立读取Linux原journal/intent；其已回传新source intent unknown、当前unit inactive/dead/MainPID0。结合原runtime_upgrade源码，unknown位于状态复制与unit CAS后的start/probe异常分支，当时未能证明候选停止；当前后来inactive不等于旧unit已恢复。原reconcile必须核newUnit/newConfig/key/old fresh state、active及签名identity，当前inactive不能直接协调成功。应等待原journal的确切阶段/原因，不能apply重发、手改config或将当前partial当成未启动。审查者没有任何写入、服务启动、PG/HTTP业务检查或生产恢复动作。

### 同原intent有限恢复闭包独立审查

只读审查外置recovery-f638的Linux start-only、Windows Start-And-Reconcile-Pi、recovery-operator、ordinary launcher与一次性task installer；未执行恢复、真实probe或生产操作。最终封版MATERIAL SHA `b99cc5fc64ecba24fff741c0ba6c94801d507447de8533c1e1dabc39d0327bf1`，35项文件摘要独立逐项匹配；原b1c4…材料保留为pre-review归档。Linux helper为0dd15855…faf8c22、PS helper为c272dc62…cfbbfa。

闭包保持原maintenance f638…、原operation492072…、registered plan07316…、Linux plan c28d…、new source1175…。Linux先用stdlib按原source_digest协议核真实来源字节并拒链接，再导入原校验器；核Windows原dispatching/无result/old config与key、原维护、Linuxunknown intent/old fresh state/new unit/config/key/loaded exact inactive ExecStart、无dropin/nojob/无原controller。独立create-only marker后仅一次systemctl start；只原签名health及verify_probe/stop_readiness，不copy、checkpoint、修改新WAL、stop或重放apply；就绪后仅stdin有界hold，release后直接子进程退出。

Windows helper在原Worker/Django mutex双锁内重新核材料与现场，Django mutex使用原GetFullPath.TrimEnd(runtime)的UTF8 SHA协议，与实际版本一致。原Gate在Operation前释放Django锁，避免其原Reconcile子进程再次取Django锁死锁；helper只调用原ReconcilePiUpgrade一次，不改Windows config/intent。Gate返回释放Worker锁后才发pi-reconciled，root继续持队列/rotation锁并核原失败、source、manifest与前驱。

root operator按原格式publication lease覆盖Reconcile及ExitMaintenance→Start间窗口，复核原persisted升级result与PS native flags，随后只执行原尚未执行的WorkerApply→同维护ID ExitMaintenance→原Start→释放临时WSL hold并确认退出→原VerifyStartup/ready。原STARTED/FAILED保留；新SUCCESS明确manualRecovery=true/automatedPublisherSuccess=false与原失败摘要，最后catalog CAS及原readLivePublication复读，不把helper exit或stdout冒充上线成功。

审查中发现并在执行前闭合两项必然失败：catalog.sourceTree误用git tree字符串，已改用原api.hashRelativeFiles清单摘要对象；prepared.requestSha误与原文件字节SHA比较，已改原JSON.stringify(request)摘要，原文件另由MATERIAL raw SHA绑定。原“确认启动版本”实际尾部marker亦纳入未执行检查。当前最终闭包无剩余实质阻断，已通知主代理在现有上线授权内单次执行；没有增加功能验收。Linux12项无副作用mock自检已读OK，PS5解析及Node语法检查由对应实现者报告复用。成功与否仍待实际原回执，不因本次审查通过而提前声称恢复完成。

### 第一次有限恢复的传输入口失败

上述恢复实际执行后，原 `ENTRY-FAILED.json` 于02:33:33.433Z记录Pi reconciliation controller ended before receipt；pi-helper输出phase=failed/stage=linux-start-once，stderr只证明原Worker/Django双锁已取得及direct_child_reply_invalid。未得到runner-ready/pi-reconciled，未执行WorkerApply。上一轮静态闭包未证实的 `/mnt/d` 可读入口假设已被事实否定：执行者只读观察该脚本路径不存在/不可读，Linux start-only marker连父目录均不存在、unit仍inactive/MainPID0、原unknown intent摘要不变、journal无新Started。应据此判为Linux脚本未进入、未发生该次start，而非重放一个已有start marker的未知动作。

首PS helper仅在成功尾部保存WSL stderr，失败finally直接关闭/Dispose，因而原direct子stderr及exit细节没有保存，不能事后编造Python错误消息或断言其细码。原恢复失败/MATERIAL/日志保持；不能原样重跑旧ENTRY。主代理已限定新transport2只改为原生同款base64脚本传输，并由Windows双锁内传经核验的原records字节快照（不传DPAPI密文），保同f638/OP的Linux marker与原Reconcile，失败必须保存真实WSL stderr/exit。审查者仅等待该传输增量新封版，不执行start/probe/reconcile。

transport2最终差异复审通过：新独立目录 `recovery-f638-transport2` 的MATERIAL SHA `74947a8c5ac6583c26384567c264c85c4fcadc3de5a902e7b9683fa61bf13992`，40项实文件摘要逐项匹配，包含原失败/真实普通launcher exit1/helper日志及原无start证据。旧ENTRY/MATERIAL/失败日志不改；Linux仍使用原f638/OP create-only marker，不以换目录换操作身份绕过原未知。

Linux helper25d91d…使用严格stdin snapshot替代不可达DrvFs：5份原prepared/intent/config/maintenance/drain的base64字节各有固定SHA，key仅sealed文件SHA，不传DPAPI密文。Windows helper82f053…在原双锁Check中新鲜读取这些真实文件、核固定SHA/读取前后SHA/无result与fragment后传入；snapshot本身不被冒称Linux新鲜读取。Linux继续核原Linux intent完整SHA、source bytes、oldfresh、unit/config/key、loaded inactive/noactor及原HMAC门禁，一次start/hold/release规则不变。新初始stdin上限32768，已核实际含LF请求5099字节；同封版脚本base64 bootstrap完整命令20951字符，小于30000界限。

PS仅改原生同款base64 `python -c`传输，消除/mnt/d路径假设；stderr启动即复制落盘，stdout逐行原文、finally保存直接子进程exit，强制证据写入失败不能返回成功。root Node仅增加实际PiController-exit记录，其余原Reconcile→未执行tail/lease/hold释放/catalog规则保留。Linux12项无生命周期/凭据I/O的mock自检已读OK，PS解析/纯数据长度构造检查复用对应执行者结果，审查者未做新生产probe或环境复验。已通知主代理可按既有授权执行该新单次ordinary恢复；最终上线仍待真实native回执。

### transport2实际完成Windows协调后的输出解码失败

transport2已实际取得runner-ready，active/unresolved/unsafeUnknown/unknownStoppedVerified四计数均0，并调用原Reconcile。随后PS等待native stderr的StrictUTF8任务在byteCE解码失败，根ENTRY于02:42:58.756Z以PiStartOnlyAndReconcile失败退出。原stderr正文仍未保存，不能事后补造；保存的helper stderr只证明native-reconcile-once后处理发生编码错误，不能由wrapper失败认定native协调未完成。

独立直接读取原registered目录：result.json实际 `upgraded=true/reconciled=true`，原op492072…/plan c28d…/source1175…/image87e41…绑定一致；当前pi-agent.json内容精确等于prepared.newWindowsConfig，实际SHA9455aa51…fc374等于result.windowsConfigSha256；sealed key实际/原prepared/result均defa7175…。原finish_windows先CAS配置再原子保存result，因此Windows原协调已完成，不能再start-only或Reconcile重放。原Windows intent保留dispatching符合原协议记录，不覆盖该完成result。

独立核原publish和两个recovery目录仍没有WorkerApply/剩余tail/SUCCESS，maintenance/drain仍同f638。已回传主代理可以另封有限“只剩余发布尾部”协调：消费已完成原result/config，排除原owner、核原new unit/source/前驱，执行WorkerApply→同ID ExitMaintenance→原Start→VerifyStartup/ready→真实recoverySUCCESS/catalogCAS。此时原Start已能依据新配置管理正确Runner，不再手工start-only、Reconcile或Linuxhold。新脚本仍需定向审其必要差异；审查者没有生产动作。

有限Tail闭包最终复审通过：`recovery-f638-tail/MATERIAL.json` SHA `bb21fc63e71aa6fb4b5be5d5b6af92dcdea5a1fcbf8f8caf9658df53dd7c661a`，48项实文件摘要独立核均匹配。绑定真实persisted result SHA ddc10d5c…、current successor config9455aa51…及原key；Node不再spawn Linux helper、start-only或Reconcile，不能重放已完成的协调。

新增ACL补证只执行原publicReconcile的只读后置门禁：helper cf00ed3c…在原Gate双锁内核原f638/newconfig/result/plan/key/无fragment与原actor退出，按原library-only方式导入exact installedbase d012…，唯一AST提取exact installedAI 3b0a…的原Assert-PiUpgradeLeafAcl并原样调用，无native dispatcher。ASCII JSON回执保originalWrapperExitCode=null，Node核checked/resultSHA/sourceSHA，不把丢失原stdout/exit冒称成功。原Windows协调成功仅由持久result/config实际一致事实与此原后置门禁支持。

其余仅执行原未到达的WorkerApply、同维护ID ExitMaintenance、原Start、VerifyStartup/ready，原格式lease与rotation/queue锁、SUCCESS恢复标识、MATERIAL/原失败摘要、catalog真实sourceTree对象及CAS保持。已通知主代理可在既有授权内单次运行新Tail ordinary任务，不追加业务验收；是否上线完成仍以该次真实原回执为准，审查者未执行生产。

### 最终实际发布完成（主发布负责人原回执）

2026-10-21，主发布负责人回传 `recovery-f638-tail/SUCCESS.json`：03:06:55.694Z、status=deployed_and_ready，SHA `47277c1bfd4ddecd927c677737cc06c10fa29cb83ce2aa238648a461c9745520`；ENTRY-COMPLETED于03:07:20.524Z完成，ordinary直接进程退出0。目标main2b6447f3的Worker `20261021T005044Z-3e008fa5cc2bacfe`/manifest5a321ddb…、Django manifest79d6d565…、Pi source1175d4b8…/reconciled=true已经实际采用。原Start返回started、VerifyStartup=true，原ready及catalog/readLive均通过。

本轮完成属于有限人工协调后的真实上线，不能称原publisher整轮自动成功：原STARTED/FAILED及两次恢复失败原件保持；Pi协调完成依据原persisted result/config一致及独立调用原只读ACL后置函数，不冒称缺失的原wrapper stdout/exit成功。Tail未重做DeployApp、Upgrade apply、Linux start-only或Reconcile，仅完成原剩余发布段。未执行migration、业务回填、n8n候选激活或追加功能验收。审查者仅按该原完成回执增记，未重新调用接口或复验生产；临时任务清理、最终文档/记忆与main收尾由主发布负责人负责。
