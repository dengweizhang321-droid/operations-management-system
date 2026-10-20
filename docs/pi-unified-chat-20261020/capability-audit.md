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
