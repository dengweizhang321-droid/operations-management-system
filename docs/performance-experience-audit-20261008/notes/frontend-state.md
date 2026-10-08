# 前端状态、公共交互与分区读取审查

审查源码：`a37b5ffdbe9e6705cf4daa9545231e93b4378c5d`，`codex/performance-experience-audit-20261008`。本分工只读业务源码，没有启动浏览器、运行性能基准、访问业务 API、触发写操作或修改业务代码。实际浏览器与耗时证据由总控串行执行；下列项目在未关联本轮运行证据前均不能写为“已复现生产 bug”。

后续本轮证据追加：总控已串行运行实际Home探针，并将生产只读操作链交回静态定位。F1、F3已在实际Home隔离环境复现；BI重复flow是本轮生产只读实测。详见文末追加，原静态分析保持以供核对。

已读共享 Home、偏好/目标/工作流、公共筛选项目记忆及相关项目状态、现有最近日复盘、AGENTS/README 与开发交付/系统架构/前端性能/业务口径/验证发布规范；已交叉阅读五项性能正式采用、integration 原阶段报告、公共筛选确认/布局/正式采用记录。早期“未采用”不是当前结论，历史截图/测试通过不是本轮验证。

## 源码与指定运行包比对

按总控提供的 `20261008T103219Z-f5d9b00e432df6c0/source-snapshot` 比较 14 个关键 app 文件：Home、单选/多选、filter-draft、全局搜索、共用 period helper、StableReadContent、销售/库存/商品/客服/AI module、reloadable-lazy/error-boundary 和 navigation-catalog。**14/14 SHA-256 相等**。完整哈希见 [frontend-source-release-hashes.json](frontend-source-release-hashes.json)。该比对本身只证明此指定 source-snapshot 与受审文件一致；effective release/实际资源取证由总控完成，不能单凭目录存在宣称运行版本。

## 目前确认存在的防护

| 实际路径 | 已读出的现状 | 不应误报 |
| --- | --- | --- |
| `app/page.tsx:70`、`app/shell/reloadable-lazy.tsx:24`、`navigation-preload.ts:2` | 主模块按需 import；销售/库存/商品/市场有显式导航意图预载，最多同时 2 个，失败 5 秒退避；预载仅下代码 | 不能将所有 import 当首屏立即执行；当前已有局部 retry 基座 |
| `app/sales-module-view.tsx:215`、`:259`、`:294`、`:324` | core/full 分区；完整范围 key、当前用户、响应周期/revision 验证；abort+generation；共同 30 秒 UI 超时、有界 transient 重试和 1 次版本重读 | 没看到无界版本重读；不能把 core response 等同新范围实际绘制 |
| `app/product-module-view.tsx:133`、`:151`、`:177`、`:228` | initial-page→overview 依赖已验证 snapshot；排序/翻页用 page；范围和 snapshot 同时检查；inline full退化；abort+generation | 历史“只有snapshot无scope”“分页取消后overview永久缺失”已有补齐路径，不重复当未修问题 |
| `app/product-module-view.tsx:233`、`:264`、`:317` | page失败仍可用同范围有效快照补overview；详情携带数据日期及销售revision验证；详情错误/等待与列表分开 | 不能凭存有 detailItem 就断言旧详情可覆盖新查询 |
| `lib/inventory/read-regions.ts:29`、`:36`、`:50` | summary/detail并行；范围+版本成对；单区重试时未完成兄弟区加入新读，最多两轮版本恢复 | 已修掉“单区重试取消兄弟后永久loading”基础路径；组合负例仍需本轮实际验 |
| `app/ui/stable-read-content.tsx:16`、`:32`、`:37` | owner+精确 identity 对象绑定；仅完整成功树可成为快照；错误同步不使用旧树；旧树 inert/aria-hidden，并有明确上次成功提示 | 组件没有将快照回写业务结果；不能把 retained=true 当本轮已就绪 |
| `app/ui/filter-draft.tsx:8`、`:26`、`:57` | 已应用与草稿分离；下拉500ms合并；货品Enter确认；IME/229/repeat/Shift+Enter保护；位置变化/卸载取消定时提交 | 不建议重加“应用筛选”，不改既定文本/下拉/日期规则 |
| `app/ui/searchable-select.tsx:169`、`:173` | 多选菜单保持展开，按钮mousedown防焦点离开搜索；监听器正常清理 | 文件长、选项多本身不是卡顿证据 |
| `app/ui/table-column-filters.tsx:378`、`:414`、`:433`、`:540` | table级Observer+rAF合并；表卸载断开Observer；总监听清理；分页表转向服务端筛选入口 | 有DOM扫描不等于有可量化长任务，未建议无证据虚拟化 |
| `app/n8n-workflow-view.tsx:318` | helper轮询5/15秒退避，隐藏暂停，generation+abort，卸载清定时器/监听 | 未看到轮询泄漏；iframe流程仍需另验 |
| `app/ai-workspace-host.tsx:23` | 每个已访问模块的聊天controller保留，隐藏不取消已接收请求；最多受模块数约束 | 这是明确后台语义，不能建议“隐藏全部停止”；实际长期内存走势未知 |
| `app/import-module-view.tsx:101`、`:168` | history只在对应子页读，Promise.allSettled聚合7来源并保留域错误，切页取消 | 7个GET不是N+1证据；最慢来源阻塞显示的实际成本还需测量 |

## 高优先级可复核候选与最小方案

### F1：进入自定义日期即更改已应用周期，取消未还原

- 页面/操作：任一具有统计周期的模块，从本月/近7天等切到“自定义”，不确认再取消。
- 源码事实：`app/page.tsx:594-615` 的 `selectRange` 在自定义分支之前 `setRange(nextRange)`；该分支只规范化旧 customStartDate/endDate，不写URL。`globalPeriod` 在 `:224-227` 依 range 计算并传入实际模块。`:655` 的 onCancel 仅关闭面板。`module-view-shared.tsx:1033-1046` 对自定义直接使用这两个旧日期。
- 复现：直接打开默认本月，记页面日期/URL/请求；打开自定义，不点确定；记录日期/业务GET；取消后再刷新比较。初始旧自定义通常是近30天，也可能是上一轮自定义，与本月不一致。
- 预期：弹窗编辑不更改已应用范围，取消等于无业务范围变化。候选实际：新范围提前请求，取消保留自定义状态但URL仍是本月，刷新再变化。
- 实际负担/风险：多模块多次无意义读取、取消后结果周期令人误解、链接不能复现当前状态。涉及数据选择而非已证明后端错误。
- 根因可信度：高（直接控制流）；浏览器复现与精确耗时待总控探针。
- 最小修复：将“面板打开/日期草稿”与已应用range分开。打开只复制当前已应用日期到草稿；确定时同批提交range/dates/intent/URL；取消、Escape、点击外部都只撤销草稿。不更改预设周期即时加载规则。
- 回归：所有12模块中的周期控件、从预设/去年同期/月度/自定义进入、取消/外点/Escape、确定、刷新/前进后退、下游请求次数、当前数据与URL范围一致。优先级建议P1候选，待浏览器证据定级；低中成本，共享高收益。

### F2：全局搜索 A→AB→A 可能取消唯一请求后永久忙碌

- 页面/操作：Ctrl+K，输入至少2字符A；A尚未返回，在220ms内追加后删回A。
- 源码事实：`app/page.tsx:218` 防抖220ms；`:340-349` 取消/提升generation；`:351-385` 读取effect仅依赖防抖值及open；`:562-569` 每次原始编辑都取消并设loading=true。最终防抖值仍A时，effect不会重新执行，已取消请求也不会清loading。
- 预期：最终A有有效请求或恢复已验证A结果且结束忙碌。候选实际：只有一次已取消A请求，busy=true一直保留；需要另改词或关闭重开。
- 影响：搜索被中断、重复等待；有旧结果时按钮因loading保持disabled。
- 根因可信度：高，实际Hook调度交错需真实Home验证。
- 最小修复：给提交后的查询请求保留显式generation/request identity，取消后相同最终文本也能启动一次替代读取，或在原词已有成功快照时明确恢复并结束loading；不放弃防迟到栅栏、不引入每键请求。
- 回归：A待回/已成功两种起点，A→AB→A、清空→A、A加/删空格、粘贴替换、关闭重开、失败重试、旧响应迟到。P2候选，中等成本，公共搜索全模块受益。

### F3：公共单选的选项搜索把输入法选词 Enter 当选择

- 页面/操作：库存→备货计划→计划状态，搜索“待确认”只剩1项，在中文composition中按Enter；商品排序、统计周期等也复用单选。
- 源码事实：`app/ui/searchable-select.tsx:81-85` 的choose会提交并清搜索/关菜单；`:94` 的搜索框onKeyDown只判断Enter/一个结果/非disabled，没有isComposing、229或repeat门禁。货品文本的公共helper在 `app/ui/filter-draft.tsx:57-63` 已有这些门禁。
- 预期：选词只结束输入法编辑，不改业务选项。候选实际：立即选中并关闭菜单，composition结束后500ms的自动提交可变更查询。
- 实际负担：选词中断、错误筛选、需要重开下拉纠正。客服行内标注也复用此单选（`customer-service-view.tsx:394-396`），因此修复范围需包含写控件；本轮只在隔离只读筛选中取证，不触发真实标注。
- 根因可信度：高；浏览器合成composition可验证JS逻辑，Windows原生候选窗仍需分别验收。
- 最小修复：复用已存在 `confirmFilterText` 或同一中央判断，普通Enter的一项便捷选择保留，IME/229/repeat不提交。不要让父级composition捕获代替单选自己的Enter门禁。
- 回归：单项/多项/0项、中文选词Enter/229、选词结束后的Enter、连续按键、空格输入、普通点击、多选保持展开、弹窗内单选。P2候选，低成本，跨模块收益高。

### F4：客服切范围时旧列表仍能执行行操作

- 页面/操作：客服已有列表，改日期/店铺等，在新读取未回时查看旧行或点击旧行标注/AI入口。
- 源码事实：`app/customer-service-view.tsx:132-178` 开始读取仅setLoading/error，不绑定data的成功scope；`:383-400` 无条件 `data?.items.map`，只在无data时显示loading行。行内单选/AI/详情禁用条件检查busy/detailLoading/权限，没有列表loading；全页AI按钮 `:365` 同样直接使用旧data.items。局部aria-busy不是旧范围标注或交互隔离。
- 预期：保留旧展示应明确“上次成功范围”且旧范围操作不可误用当前筛选。候选实际：当前日期/筛选已变，旧行和汇总仍在；仅刷新按钮/aria-busy提示更新，旧行操作可用。
- 根因可信度：高静态；新范围正常慢读场景应由总控验证。没有证据证明后台越权或旧结果最终覆盖新结果；这里强调的是等待期间错用旧行。
- 最小修复：为成功data绑定完整scope/身份，复用StableReadContent隔离列表及其外部批量入口，或在更新期间显示明确旧范围且禁用相应旧行/批量动作；筛选器自身保持可编辑。身份/日期/错误遵循已有隔离规则。
- 回归：详情打开/关闭、未完成列表、快速换店/日期、局部失败与重试、批量AI旧选择、标注成功后的刷新、原导入和授权门禁。建议P2，实际误操作证据出现再升级。

### F5：销售/库存已有快照时分区首批被整段旧展示遮住

- 页面/操作：同日期、已完整显示后改平台/商品（销售）或品牌/仓库（库存），让core/summary快、full/detail慢。
- 源码事实：销售 `:327` 已提交core，但 `:374-376` 的整个StableReadContent仍pending=`loading || !summaryComplete`，complete只在full。库存 `:1577-1584` complete同时等summary+detail。公共快照 `stable-read-content.tsx:17,38` 会继续绘制整段旧树。
- 影响：初次无快照可以渐进显示；重复查询已有快照时，新范围首批可见可能直到全部区域完成。不能将core请求返回或旧内容可见记作新范围首批就绪。
- 分类：设计性体验/性能候选，必须有本轮浏览器分别计时才列入“有测量证据的瓶颈”，目前没有耗时数字。
- 最小修复：按已验证分区分别保留展示/占位高度；已就绪新core/summary允许显示，未就绪区域保留带旧范围标记且不可操作的快照。避免去掉布局保护重新引入跳动；仍禁止不同scope/snapshot混成同一次完整结果。
- 回归：冷进入/重复同日期改条件、错误/版本变化、core/full和summary/detail双向乱序、原geometry/focus、多次快速更改、AI上下文归属。中成本中风险，应在F1-F4后执行。

### F6：AI子页chunk失败的模块重试可能不能重建子lazy

- 页面/操作：首次访问AI memory/agents/space/configuration等，隔离环境让子chunk首次下载失败，再点“重试当前模块”。
- 源码事实：`app/ai-module-view.tsx:9-16` 是模块作用域的普通React.lazy；主壳 `app/page.tsx:668-672` 仅reset当前scope；`app/shell/reloadable-lazy.tsx:73-78` 仅重建登记的controller。AI父import重新读取已缓存module时，子lazy对象仍为原拒绝状态。
- 影响：恢复网络后按钮可能反复失败，必须整页刷新。`ai-workspace-host.tsx:10-19`聊天另明确提供刷新页面重试，不能混同两条路径。
- 根因可信度：中高；React模块缓存语义支持，但运行包chunk传输还未验证，保留“待验证风险”。
- 最小修复：AI子页复用同一reloadable-lazy scope，保持后台聊天controller语义；只重建失败UI子页，避免重置已接受后台执行。
- 回归：八个子lazy入口、首次失败后恢复、父/子导入失败、访问其他模块后返回、后台流式请求持续执行、权限不足提示。P2候选、低中成本。

## 操作体验建议（不是已证明的回归）

| 建议 | 源码与操作负担 | 最小范围与限制 |
| --- | --- | --- |
| 客服SKU/SPU文本规则和公共货品Enter对齐 | `customer-service-view.tsx:90-91,378-380` 仍260ms逐输入查询，没有文本草稿/IME保护。编辑多个编码会多次等待，跨模块习惯不一致 | 旧正式确认报告只声明销售/库存/商品三域，故不能宣称客服是本轮新回归；本轮用户要求扩大审查后可提复用草稿/Enter，顾客自由搜索是否保持自动另明确 |
| 全局搜索保留结果说明来源词 | `global-search-dialog.tsx:193-206` 允许B编辑时仍显示A。**`:317` 已disabled={loading}，不能称旧项仍可点击**；列表仅busy，无清晰旧词说明 | 增加上次搜索词标记/更新状态，或待新结果区域保持高度的占位。不改变有效结果范围与权限 |
| 搜索结果实体不落到实体本身 | `page.tsx:570-592` 验证了target.entity后只使用module/view；用户点击具体商品/会话仍须到列表再搜一次 | navigation-catalog明确额外身份详情不在一级URL契约，属于增强，不作为既有契约失败；只对有安全实体打开协议的模块逐项扩展 |
| 明确刷新/返回的筛选恢复支持范围 | 销售/库存URL持久化，商品筛选和客服筛选主要组件state（product:100-116/customer:65-69），离开模块或刷新后恢复成本不同 | 用户要求“按既有规则”而非所有状态无限持久化；先形成支持清单，再授权逐步扩展，避免静默保存敏感搜索文本 |
| 首次读取期间保持局部错误与筛选可达 | 当前销售/库存/商品/市场主读有局部反馈；BI新范围是短加载分支 `bi-cockpit-view.tsx:78`，存在布局变短候选 | BI几何未量化，需实际滚动坐标/文档高度证据，不能用locator自动滚动判bug |

## 静态覆盖范围

| 模块与子页 | 本分工真实入口/代表路径静态覆盖 | 尚未由本分工执行 |
| --- | --- | --- |
| BI overview | Home→Dashboard→BiCockpit，主请求/deferFlow/flow依赖、身份key/错误/选项 | 带数据切店、慢源、所有卡片详情、几何、实际渲染耗时 |
| sales overview/channel/category/finance/targets | 主core/full、公共筛选、channel切维度；category分页/详情请求；finance月份/校验/重试/展示保护；targets入口懒加载 | 目标写流程；真实财务全部月份组合；原生IME |
| inventory overview/age/plan/stale/inbound/guangdong | 全6入口分区驱动/请求key/generation/retry/共用筛选/快照；广东query范围/风险/分页 | 真实6页数据逐项交互；备货/群发/清理写操作；权限变化 |
| product overview/calculator | 初页/分页/排序/overview与详情请求、snapshot+scope、草稿、测算状态及只读快照边界 | 计算器全部字段、真实商品详情等价；refresh/back几何 |
| customer_service conversations | 主列表/选项复用/分页/详情、标注与AI入口禁用边界、SKU/SPU搜索 | 不调用分析模型/标注写接口，浏览器等待期间旧行行为待总控 |
| market ranking/overview/compare/settings | 身份packet重建；settings system_kpis、图片任务进度停止与卸载；主入口reloadable懒加载 | 排行/完整报告/compare实际大范围性能由总控与后端分工；写操作均未触发 |
| shop analysis/outlets/platforms/products/promotion | Home的shop context及history绑定，balanced局部boundary/重试接缝 | 各业务子页重组件未逐行审查，后端与浏览器分工补充，不列静态全通过 |
| workflow plan/inspection/reviews/launch/launch-followup/variables | 主导航；plan列表+卡片3/4请求同批；templates生命周期；inspection/review读取cleanup线索 | 各表单和写路径未全读；真实分页/各细节操作待总控 |
| n8n_workflows六页 | canonical目录及selectedWorkflow驱动，健康请求轮询/隐藏/卸载共同实现 | iframe内完整流程各节点、授权启动/恢复未操作 |
| import files/history/chains | 主入口；history7来源请求、域错误、取消/返回，files权限与来源state | 文件选择后的写流程/真实导入；chains内部完整状态未在此分工细读 |
| settings六页 | module入口；settings主读/保存controller、market状态独立读、子页lazy入口 | warehouse/permissions/backups/dingtalk表单内部未逐项审查，不执行任何写 |
| ai十页 | 子lazy/权限主入口；chat host持续挂载；assistant请求controller/80ms delta合批及清理、agent轮询、memory取消 | 不触发模型/Agent/流水线/定时任务；长期内存与隐藏后台并发未知 |
| 公共 | shell URL/period/popstate、搜索、SearchableSelect/MultiSelect、filter-draft、StableReadContent、Dialog、table-column-filters实际实现 | 缩放/窄窗/固定列/原生输入法及长期手动使用未验，不能称通过 |

## 本轮验证脚本与证据边界

- [public-interaction-probe.mjs](../tools/public-interaction-probe.mjs)：真实Home隔离浏览器，默认仅127.0.0.1:3781，拒绝所有外域和非GET；日期取消、单选composition Enter、搜索A→AB→A、旧结果提示。每组独立context，失败保留继续；可选AI子chunk一次失败。搜索响应是明确合成值，其余读取沿现有隔离预览。
- [frontend-function-probe.mjs](../tools/frontend-function-probe.mjs)：无浏览器、无服务/网络；执行实际导出函数、实际单选handler及由TS AST提取的实际Home日期回调。仅hook存储/setter替身；不能代替React调度、DOM或原生输入法验收。
- 本分工对两脚本只做`node --check`语法检查通过，执行和结果由总控串行完成。上述“候选”随总控原始result.json分级，不以函数脚本通过冒充浏览器覆盖。
- 无CPU/SQL/Worker/Django探针、没有真实P95、长任务、布局偏移分数或长期内存数据。本分工不能判断后端争用、缓存锁、图片解码及大数组渲染是否构成当前实测瓶颈。

## 推荐处理顺序

1. 日期应用/取消边界（公共，影响所有读范围），全局搜索取消后不再启动（公共，操作中断），单选IME选词误选择（公共，覆盖筛选及行内写控件）。先用实际Home证据确定最终严重度；修复范围均可复用既有组件。
2. 客服旧范围展示/行操作隔离；其后再决定客服货品文本Enter规则扩展。禁止仅靠隐藏错误或扩大超时解决。
3. 有测量证据时按分区调整销售/库存保留树，保留布局与snapshot隔离回归；避免用“更早显示旧结果”冒新范围更快。
4. 复验AI子chunk局部重试，再补齐需要实体身份的搜索跳转、支持范围明确的URL恢复。长期资源/未覆盖UI形态继续独立验证，不与上述确定候选混成一次大重构。

## 总控串行验证后追加（本分工回读原始证据）

### F1/F3 已有本轮真实Home隔离证据

原始：`.runtime/public-interaction-audit-1791469551858/result.json`，截图同目录。

- F1：初始本月`2026-10-01—2026-10-08`，打开自定义未确认就变成`2026-09-09—2026-10-08`；新增该范围core/full两个GET。取消后仍是自定义/近30天，URL一直`?module=sales`；刷新恢复本月。三个差异自动判断均true。可以列“已复现bug（实际Home隔离，关键源码与指定生产source-snapshot相等）”，不冒本轮生产日期故障注入。
- F3：计划状态初始“当前有效计划”，搜索“待确认”后派发composition Enter/229，立即选中且菜单关闭；composition结束后URL出现`inventoryPlanStatus=draft`，发出summary/detail两个GET。可以列“已复现JS交互bug”；仍不声称Windows原生候选窗已验。
- 此次探针后续搜索部分因预先创建的waitForRequest在输入等待失败时发生未及时catch的reject，脚本退出。该失败已保留，**不能把它当搜索业务复现**。验证器修为明确locator+已记录请求的有界await轮询，增加AUDIT_CASES，仅由总控决定续跑。

### F7：BI同范围刷新触发两次相同flow请求（生产只读实测，P2）

- 操作：BI已有本月结果后点“刷新”。环境与完整请求时序见总控`.runtime/audit-private/production-chains-1791469743694/results.json`中的`bi-refresh`。
- 实际：主`/api/bi/cockpit?range=month&mine=0&deferFlow=1`为9224ms/27535B；`/api/bi/flow?range=month&deferFlow=1`出现两次，分别1715ms与1631ms，均200/3824B。样本n=1，不是P95，两段耗时不简单相加为总等待或CPU时间。
- 根因：`app/bi-cockpit-view.tsx:60-75`保留同key的旧data，flow effect同时依赖`refresh`与`data`。点刷新先用旧data触发flow；主读取完成setResult造成新data对象，再触发flow。`:76`刷新按钮正是setRefresh入口。
- 影响：一次刷新产生额外同范围后端请求/序列化/传输和潜在重复领域工作；完整SQL聚合是否重新执行、缓存命中及CPU额外成本无探针，不能宣称已量到两次完整计算。
- 最小修复：用本轮主成功提交generation/snapshot调度一次flow刷新，局部flowPlatform/flowShop变更继续独立读取；主刷新失败需要明确保留旧flow及局部重试入口。不要简单删除所有refresh依赖导致flow再也不刷新。
- 回归：冷进入、同范围刷新、主失败/flow失败、快速平台/店铺变化、主先回/flow先回、重复点击、来源缺失、已知日期不匹配。现有scope key、日期检查和abort仍在，没有本次证据证明跨范围/权限串数据；来源时点一致性是另待验证项目。

### F8：商品详情返回按钮被遮挡候选（生产定位点击失败，待坐标/键盘对照）

- 总控生产操作：商品第2页打开详情后普通Playwright点击“返回”6秒失败；call log显示`.product-detail-heading-main`及sticky`.shell-masthead`交替截获事件。原截图`product-detail.png`与`product-return`失败记录保留。
- 可达CSS：`app/product-module-view.tsx:62-65`中返回button在主标题div之前。`app/globals.css:852`的back为absolute/top13/z-index1，后置heading-main同为z-index1的flex item并带padding-top13，标题透明padding盒可在重叠处盖住按钮；`app/shell/top-navigation.css:3-12`masthead为sticky顶栏。当前只是命中区域候选，不能忽略Playwright自动滚动的影响。
- 验证器 [detail-layout-probe.mjs](../tools/detail-layout-probe.mjs)在真实隔离Home：原路径→记录bbox/computed/9点elementFromPoint→普通click保留失败→scrollTop可视坐标click→键盘Enter。无force click、不改CSS。如坐标点击正常而命中指向按钮，须将首次定位失败降为自动化/滚动歧义；如9点命中均被主标题挡住，可确立点击区域bug。
- 最小修复方向：为返回操作留独立布局行/真实点击空间，或在确认重叠仅为装饰层后调整局部层级；不要全局抬高z-index破坏sticky导航和弹窗。回归两页列表返回、滚动中进入、长商品名称、各种窗口、缩放、键盘返回与保留筛选/分页。

### F9：网店商品“本期”日期控件边界溢出候选

- `app/netshop/products/ProductsColumn.tsx:70`把“本期”文字和按钮置入`label.np-date-label.date-selector`。`app/globals.css:160`全局date-selector固定height38；`app/netshop/products/products.css:20-22`又让该label display:grid/gap4，`:7-12`按钮min-height34，加上文字一行后可能高于38，但未覆盖height。
- 实际负担候选：边框与文字/按钮边界不一致，换行后和“资料质量”相邻控件重叠。生产截图线索不能替代几何证据。
- 上述layout probe记录1440/1100/900的label/button/quality实际bbox、button是否超出父bottom、是否真实相交与命中元素；不把有意展开日历算初始控件溢出。最小修复为该域日期label显式auto height及一致内部布局；保持日期确认/取消规则和弹层定位。

### F10：市场/自动化根文档横向溢出待定位

- 总控只读surveys量到market/ranking在1440和1024均root scrollWidth1612；market/overview超58；自动化jackyun/tmall在1440超190/418，1024 jackyun超606。以上是几何现象，不直接等于业务表格bug。
- layout probe已补market-ranking、n8n-jackyun/tmall的1024真实Home几何：最右30个越界元素、7级祖先min-width/grid/flex-shrink/overflow与根scrollWidth，区分应由局部容器承接的表格横滚。n8n外域helper/iframe被隔离策略拒绝，仅外层pipeline/shell测量，不冒iframe内验收。
- 只有定位出真正撑宽根文档的祖先，并与可达操作遮挡/整页水平移动对应，才建议局部`min-width:0`或受控overflow容器；不靠body overflow-x:hidden遮掉必要列。

## 后续几何与搜索复验结论

总控串行原始证据：`.runtime/detail-layout-audit-1791470060549/result.json`；已提取非业务内容的[简明几何摘要](../evidence/detail-layout-summary.json)，带原始文件SHA。新增5个相关源码/CSS与指定正式source-snapshot也全部SHA相等，见[布局源码哈希](frontend-layout-source-hashes.json)。下述结论取代F8-F10的仅候选状态，但保留其原始分析过程。

### F2 已复现；F6 仍未完成

`.runtime/public-interaction-audit-1791469832716/result.json`中，A→AB→A耗时56ms，观察1900ms后仍busy=true，仅有1次A请求、没有替代请求；1200ms合成响应场景下不会自动恢复，实际Home搜索中断已复现。搜索入口原生Control+k未及时打开，验证器经真实window快捷键handler重放后进入；该入口限制与后续搜索状态缺陷分开，不能把重放说成人工键盘验收。

同一轮A→B旧结果实证显示旧A按钮disabled=true，B返回后只显示B且按钮恢复；仅保留“旧查询词提示不足”的体验建议。

AI重试组因`vinext-dev-error-backdrop`截获点击6秒失败，没有完成真正的重试动作，因此F6继续列“待验证风险”，不能将开发错误overlay阻挡当生产业务重试失效的证据。

### F8 已复现返回按钮中心点击失效（P2）

1440×1000隔离真实Home可用数据只有一页，因此此次用第1页详情；生产原操作链是第2页，范围分别披露。返回按钮实际矩形58.39×12.80px，字体8px；顶部y324，主标题透明盒从y330开始，与返回按钮下半部重叠。9个内部采样点仅顶部3个能命中按钮，中部及底部6个全部命中`.product-detail-heading-main`；正中心命中主标题。

普通定位点击6秒失败；主动恢复scrollY=0后，可视按钮中心坐标点击仍不返回；同一按钮focus+Enter立即返回列表。这次有实际坐标对照，故不是仅由自动化滚动引起。**不能写成“按钮所有区域完全不可用”**：上缘仍有狭窄可点击部分，键盘也可恢复。操作负担是点可见按钮中心无反馈、反复瞄准或改用键盘/子页导航。

直接根因置信度高：`app/globals.css:852`两兄弟同z-index1，后置flex主标题盖住前置absolute返回按钮；`product-module-view.tsx:62-65`给出真实DOM顺序。建议优先给返回操作独立行/留足不重叠点击区域并采用既有按钮可读尺寸，再验证局部层级。sticky头栏是定位器重试期间的次生遮挡，不将其误定为唯一根因。

### F9 三窗口均越过日期边界，1440窗口真实交叠（P2/窄范围修复）

日期label固定38px，按钮真实高度34.80px并排在文字之后，三个宽度均超出label底部22.20px。1440宽度下资料质量换到下一行：日期按钮bottom424.58、质量label top414.38，真实相交高度10.20px；1100与900时质量label在横向别处，**没有与质量label相交**，不能宣称三种窗口都遮挡同一控件。

根因证据吻合`globals.css:160`固定38px与`netshop/products/products.css:20-22`grid两行冲突，实际控件在`ProductsColumn.tsx:70`。最小修复只覆盖此域`.np-date-label`的height/layout；回归3窗口、日期展开/取消/确定、旁边资料质量、平台店铺控件，不更改全局日期语义。

### F10 已定位为根文档溢出，不是正常局部表格横滚（P2）

1024窗口中三个模块外框都只有964px，而其Grid计算列宽分别为市场1582px、吉客云1600px、天猫1828px；对应根scrollWidth1612/1630/1858，越界588/606/834px。第一越界子元素及其祖先没有宽度被视口约束的滚动容器。

市场`.data-table-wrap`虽然overflow-x:auto，实际clientWidth=scrollWidth=1580，和1580px榜单一样宽，无法在局部承接横滚；整个筛选区和子导航也都被同一1582pxGrid列撑大。依据`globals.css:1044`的`.market-module{display:grid}`、`:1059`的`.market-ranking-table-v2{min-width:1580px}`和真实computed chain，问题是外层隐式Grid列的最小内容宽度传递，**不是要删除业务表格的必要列或min-width**。

自动化`.n8n-workflow-module`同样是未限定列宽的Grid（`globals.css:1572-1575`），直接tabpanel div（`n8n-workflow-view.tsx:439`）保留min-width:auto。外层子导航与tabpanel被撑宽；内层`.n8n-pipeline-flow`（`globals.css:1818-1825`）虽overflow-x:auto，min-width1120，实际clientWidth=scrollWidth=1598/1826，外层未先收敛。该实测已阻断helper/iframe仍可复现，说明外层展示布局即可触发，不依赖真实n8n画布；不把它外推为画布内缺陷。

最小方向：把每模块外层Grid轨道约束为`minmax(0,1fr)`、真实Grid子项min-width:0；保持表格/流程内层必要尺寸，由外层有界scroll容器承接。n8n需同时处理pipeline自身1120px最小宽度的位置，不靠整页overflow:hidden裁掉流程。回归1440/1024/窄窗、全部市场子页、六自动化选项、局部横滚与固定头、tab键可达。没有现场改CSS，因此具体补丁仍须隔离验证后实施。
