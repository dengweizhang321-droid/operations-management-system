# 全模块导航、交互与资源生命周期静态审查

2026-10-08；受审源码 `a37b5ffdbe9e6705cf4daa9545231e93b4378c5d`。本分工只读源码，未启动浏览器、未跑基准、未调用生产业务接口、未修改业务代码。以下“静态确认”只证明代码路径；真实浏览器复现由总报告补入，不能把此表的 S 升格为实际体验验收。未取得各阶段耗时/CPU/内存/SQL 探针，因此本笔记没有“已测性能瓶颈”或“生产 P95”结论。

已按启动协议读取 Home、工作偏好/目标/流程、公共筛选与网店底座相关记忆、项目规范。记忆中较早的“应用筛选”方案已被本轮用户要求与 10 月 7 日后续采用记录取代。以当前 Enter/下拉自动/日期独立确认规则审查。

## 1. 实际可达入口与 55 个子页

权威目录为 `app/shell/navigation-catalog.ts:20`，12 个主模块、55 个一级子页。`app/page.tsx:71–89` 为主模块按需加载与四模块意图预加载，`:161–174` 为真实 viewMap，`:673–684` 挂载实际业务组件与 AI host。网店当前四个新栏目在 `app/netshop/shared/module-slots.ts:28–33` 实际注册；旧网店代码不能代表这些新栏目。表中 S=静态入口映射及代表性安全动作设计，本分工无 B=浏览器证据。只列规范一级子页，未把商品详情、设置内部三级页和禁用的“企业购分析/客服分析”按钮计入 55。

| 模块 | 规范子页 | 真实入口/组件 | 代表性安全只读操作 | 本分工 |
| --- | --- | --- | --- | --- |
| BI 看板 | overview | dashboard-module-view.tsx / DashboardView | 日期→汇总→来源状态→目标/库存钻取 | S |
| 销售分析 | overview | sales-module-view.tsx / SalesView | 文本 Enter、连续平台/店铺多选、core/full 新范围完成 | S |
| 销售分析 | channel | sales-module-view.tsx / SalesView | 店铺筛选→渠道/店铺明细→回退 | S |
| 销售分析 | category | sales-category-view.tsx / SalesCategoryView | 品类筛选→展开细节→翻页 | S |
| 销售分析 | finance | sales-finance-views.tsx / FinanceAnalysisView | 店铺→月份弹层→汇总与月度表 | S |
| 销售分析 | targets | sales-finance-views.tsx / FinanceTargetSettingsView | 目标进度→期间切换；不保存 | S |
| 网店分析 | analysis | netshop/panorama/StorePanoramaView.tsx；可切 ClassicShopView | 单店→商品→返回原范围；旧 ERP 切换另验 | S |
| 网店分析 | outlets | netshop-overview/balanced-overview.tsx 或 ClassicShopView | 新/旧视图→多店→排序；分别记录 | S |
| 网店分析 | platforms | netshop/comparison/ComparisonColumn.tsx | 平台/店铺对比→指标→图形/行 | S |
| 网店分析 | products | netshop/products/ProductsColumn.tsx | 商品表现→搜索→排序/页→ProductDetail→返回 | S |
| 网店分析 | promotion | netshop/promotion/PromotionInsightsView.tsx | 场景/平台→分页→单品钻取→返回 | S |
| 市场分析 | ranking | market-view.tsx / RankingTable | 类目/scope/SKU→排序/页→趋势 | S |
| 市场分析 | overview | market-view.tsx / 行业汇报区 | 单类目小/大日期→full 报告与缺口 | S |
| 市场分析 | compare | market-view.tsx / CompareWorkspace | 加入对比→移除→返回榜单 | S |
| 市场分析 | settings | market-view.tsx / MarketSettingsWorkspace | 状态与配置页只读查看；不启动 AI | S |
| 客服分析 | conversations | customer-service-view.tsx | 店铺→SKU/SPU→翻页→查看会话→关闭 | S；重点候选 U1/U2 |
| 商品经营 | overview | product-module-view.tsx / ProductView | initial-page/overview→排序/页→规格详情→返回 | S |
| 商品经营 | calculator | product-module-view.tsx / 毛利测算区 | 选商品→修改本地测算值→切换后恢复；不保存 | S |
| 库存管理 | overview | inventory-module-view.tsx / InventoryView | 仓库/文本 Enter→summary/detail→翻页 | S |
| 库存管理 | age | inventory-module-view.tsx / 库龄分区 | 库龄段→货品→明细 | S |
| 库存管理 | plan | inventory-module-view.tsx / 备货计划 | 状态→计划列表→详情；不确认/同步/发送 | S |
| 库存管理 | stale | inventory-module-view.tsx / 滞销分区 | 库龄/状态→列表→清空 | S |
| 库存管理 | inbound | inventory-module-view.tsx / 入仓监控分区 | 供应商/货品→汇总/明细 | S |
| 库存管理 | guangdong | inventory-guangdong-view.tsx / GuangdongInventoryView | 型号→展开行→关闭；不创建备货 | S |
| 运营事务 | plan | operations-view.tsx / OperationsView | 状态/跟进人→继续加载→协作详情→关闭 | S；重点候选 U5 |
| 运营事务 | inspection | operations-view.tsx / OperationsRecordWorkspace | 搜索→翻页→查看历史；不新增/编辑 | S |
| 运营事务 | reviews | operations-view.tsx / OperationsRecordWorkspace | 状态→搜索→查看历史 | S |
| 运营事务 | launch | new-product-launch-view.tsx | 阶段→项目→收起；不保存 | S |
| 运营事务 | launch-followup | new-product-sales-followup-view.tsx | 产品线→周报预览→返回；不学习/外发 | S |
| 运营事务 | variables | operations-view.tsx / 模板设置区 | 查看模板→打开/取消编辑；不保存 | S |
| 自动化中心 | jackyun | n8n-workflow-view.tsx / workflowConfigs.jackyun | 状态卡/步骤说明→展开现有编辑器；不运行 | S |
| 自动化中心 | tmall | n8n-workflow-view.tsx / workflowConfigs.tmall | 状态卡→步骤说明→切走；不运行 | S |
| 自动化中心 | jd | n8n-workflow-view.tsx / workflowConfigs.jd | 状态卡→步骤说明；不运行 | S |
| 自动化中心 | jd_market | n8n-workflow-view.tsx / workflowConfigs.jd_market | 状态卡→步骤说明；不运行 | S |
| 自动化中心 | jd_promotion | n8n-workflow-view.tsx / workflowConfigs.jd_promotion | 状态卡→步骤说明；不运行 | S |
| 自动化中心 | jd_promotion_cut_meat | n8n-workflow-view.tsx / workflowConfigs.jd_promotion_cut_meat | 状态卡→步骤说明；不运行 | S |
| 数据导入 | files | import-module-view.tsx / ImportView | 切 16 种来源→日期控件→取消；不选真实文件上传 | S |
| 数据导入 | history | import-run-records-view.tsx | 类型/状态→分页→展开批次→收起 | S |
| 数据导入 | chains | import-chain-rules-view.tsx | 平台→查看规则对话框→Escape→刷新状态 | S |
| AI 助理 | assistant | ai-workspace-host.tsx → ai-assistant-view.tsx → ai-chat-workbench.tsx | 读现有会话→历史分页→隐藏/恢复；不发送 | S |
| AI 助理 | agents | ai-agent-workflow-view.tsx | 读现有任务→详情→返回；不运行/取消任务 | S |
| AI 助理 | memory | ai-memory-view.tsx | 搜索记忆→打开/取消；不修改 | S |
| AI 助理 | space | ai-space-view.tsx | 图片资产/收藏筛选→既有任务详情；不生成 | S |
| AI 助理 | management | ai-assistant-view.tsx(workspace=management) + ai-space-management-view.tsx | 管理员只读配置；不测试连接/保存 | S |
| AI 助理 | scheduled | ai-dingtalk-schedules-view.tsx | 只读任务配置；不运行/发送 | S |
| AI 助理 | configuration | ai-prompt-settings-view.tsx | 读取配置与页内切换；不保存 | S |
| AI 助理 | reports | ai-report-workbench-view.tsx(kind=templates) | 模板列表→详情→取消 | S |
| AI 助理 | skills | ai-report-workbench-view.tsx(kind=skills) | Skill 列表→详情→取消 | S |
| AI 助理 | pipelines | ai-report-workbench-view.tsx(kind=pipelines) | 流水线列表→详情；不运行 | S |
| 系统设置 | parameters | settings-view.tsx / renderParameters | 查看参数与权限状态；不保存 | S |
| 系统设置 | master | settings-view.tsx → market 主数据/导入/标注懒加载子组件 | 三内部页只读状态；不修改/启动 | S |
| 系统设置 | warehouses | warehouse-mapping-settings.tsx | 筛选仓库→查看映射；不保存 | S |
| 系统设置 | dingtalk | dingtalk-robot-settings.tsx | 读取机器人与周报配置；不测试/发送 | S |
| 系统设置 | backups | database-backups.tsx | 只读列表与任务状态；不生成/上传/恢复 | S；重点候选 U3 |
| 系统设置 | permissions | access-control-management.tsx | 角色/用户/最近审计只读；不保存 | S |

入口文件表中的名称均在 `app/` 下。页面内部别名可能与组件导出名不同，实际路由以 viewMap 和条件分支为准。浏览器证据必须写明是否真实数据、合成响应、首次/重复入口，不能仅以组件存在判定“通过”。

## 2. 问题与最小修复方向

### U1 客服货品文本仍自动查询，未覆盖已确认的 Enter 规则

- 类型：静态确认的不一致，浏览器待复现；不是性能测量结论。建议 P2，频繁使用客服货品查询时影响高。
- 页面/操作：客服 SKU ID、SPU ID 粘贴多码、逐字输入、中间插字或中文组合输入。
- 代码证据：`app/customer-service-view.tsx:40–46` 每次值变化 260ms 后自动确认；`:91–93` 将 query/SKU/SPU 直接接入该 hook；`:150–152` 用防抖值构建请求，`:177–182` 自动 load；`:380–382` 三输入只有 onChange，没有 Enter/组合输入提交门禁。
- 复现：已有列表→SKU 框输入一段但不 Enter→等 300ms 以上→观察请求参数；继续补全→观察第二请求；在编辑中切店铺；在隔离环境发 compositionStart/change/compositionEnd/Enter，并和原生中文输入法另行区分。
- 预期/实际：货品文本在 Enter 前只作为草稿；当前静态路径会在每次停顿后发送。多编码分段粘贴/编辑会看到多次等待，结果页码归 1，当前列表/统计不断变化。
- 根因可信度：高（直达已挂载实际输入和请求），生产影响待实际运行版本核验。
- 最小方向：复用已采用的公共筛选草稿/确认工具，为 SKU/SPU 分离 draft 与 applied；Enter 防 IME；下拉只携带已确认文本；不要增加“应用筛选”。是否将泛客服搜索一起改为 Enter 须按现有规则界定，不能自动改变用户习惯。
- 回归：多码分隔、空值、Enter/Shift+Enter/229、下拉与草稿组合、迟到/取消、page=1、AI 上下文只用已确认文本。

### U2 客服保留旧行时没有范围标识或操作保护

- 类型：静态高可信风险；慢/失败/日期切换的真实 Home 复现待补。建议 P2；若实证旧行被当新范围执行批量 AI/写标注可提高优先级。
- 代码证据：load `:137` 只设置 loading/error；成功 `:162–167` 才换 data，失败 `:170–175` 不清 data；`:384–388` 新范围期间仍直接 map 旧 data；`:394–399` 标注/AI/详情仅按权限或 busy 禁用，不按 loading；页顶批量 AI `:366` 也不按 loading 禁用。AI 范围 `:94–99` 已是当前条件。未使用 StableReadContent 的 inert/旧内容提示。
- 复现：加载 A 店成功→切 B 店，隔离把 B 请求延迟/失败→检查 A 行是否仍可交互、是否标明“上次成功范围”；只检查控件可用性，不在生产触发 AI/写入。再测新日期失败。
- 影响：新条件已经选中，而旧行仍能被打开/标注或批量分析；用户难判断结果归属，AI 页上下文和可见旧列表可能不同范围。这里没有证明服务器把 A 写成 B，也没有证明越权。
- 最小方向：仅给只读结果区接入既有稳定展示封装，保存已成功 scope 并明确标注；保留旧树时禁止旧行写/AI/导出动作；新日期/身份/错误按规范撤销。编辑表单不能简单纳入整树快照。
- 回归：A→B 成功/失败/权限变化；多选菜单稳定；旧行操作/批量 AI；详情已打开时返回；新范围空结果。

### U3 数据库备份轮询可能持续取消慢响应，错误也不会被成功读取清除

- 类型：静态风险，需隔离延迟实验；建议 P2（低频页面但影响管理可用性）。
- 代码证据：`app/database-backups.tsx:46–55` refresh 一开始 abort 上次 controller；`:58–62` 固定 5s interval；成功只 setSnapshot，没有 setError("")；轮询不检查页面 visibility。组件离开后会 clearInterval/abort，不能称泄漏。
- 复现候选：在真实 Home 的隔离备份 GET 让每次响应 6s，观察连续取消、snapshot 不就绪；再先失败一次后成功一次，观察旧错误是否残留；切隐藏页签观察请求节奏。
- 影响：若正常响应耗时超过间隔，会永远被取消；瞬时失败恢复后仍显示旧错误；隐藏页签继续无条件 12 次/分钟读取。没有测量数据库 snapshot 的生产耗时，不能把它列成已发生卡顿根因。
- 最小方向：请求完成后 setTimeout 下一轮，或有进行中请求时跳过；成功清除本次读取错误；根据任务状态适当退避/可见性刷新。备份任务服务端运行语义保持，不在隐藏时取消任务。
- 回归：6s/12s 响应、失败→成功、手动动作回执与轮询、切页卸载、隐藏→显示、ambiguous 写任务仍同 ID 恢复。

### U4 全局搜索结果只到子页，需要二次查找具体记录

- 类型：操作体验建议，非承诺功能回归。建议 P2/P3，频率视搜索使用量。
- 代码证据：`app/page.tsx:570–593` 校验 target 后只保存 module/view，`:591` selectModule 未传 entity；`app/global-search-dialog.tsx:38–47` 协议允许 entity，`:154–190` 验证实体种类。导航目录注释明确实体详情不属于一级 URL 契约，故不能宣称违反现有 URL 协议。
- 操作负担：搜到某条会话/订单/商品→点击→进入模块默认范围→再输入编码/调整日期/翻页定位。若目标记录不在当前日期，用户可能误以为点击无效。
- 可复核步骤：隔离结果返回两个同 module/view、不同 entity.id 的条目，逐个点击比较目标；正常生产只读点击现有搜索结果即可。
- 最小方向：为已支持精确 ID 的页面提供一次性受类型/权限约束的定位意图；页面确认取回具体实体后展示，找不到给明确提示与返回搜索。不要接受任意 URL 或绕过权限定向读取。
- 回归：9 种 entity、过期/无权限、跨日期、浏览器后退、搜索框恢复、恶意 target 与非法 ID。

### U5 工作计划翻页重复读取未变统计，且三个读取全部完成后才提交列表

- 类型：静态性能候选，未测瓶颈。建议先量化，不能以 fetch 数量定严重级别。
- 代码证据：`app/operations-view.tsx:777–833` 每次 loadTasks（包括继续加载 `:1079`）都发列表+逾期数量+今日到期数量，选到期/逾期卡还发 common summary；`:828–833` Promise.all 后才 `:853–879` 提交列表与卡片。即一请求失败也令成功列表不能提交（保留旧列表/错误）。
- 复现：固定筛选→继续加载下一页，记录 3/4 请求与各响应；隔离只延迟今日数量，测列表首批何时可用；只失败该区域检查可恢复性。
- 最小方向：先量化每端 SQL/序列化成本；可在同 scope/版本下复用不变 KPI/facet，或领域接口提供轻量 page 与整体汇总分区。保留共同范围版本，不能把全量统计改成当前页计数。
- 回归：过滤交集为空、到期日期交集为空、并发编辑版本、翻页取消、区域失败→重试、导出完整清单。

### U6 首屏组合读取中的慢源等待与局部失败范围

- 类型：待验证性能/恢复性风险。
- 导入历史：`app/import-module-view.tsx:111–159` 七域 Promise.allSettled，所有结算后一次提交；能显示部分域失败，也有取消/generation 防迟到。慢域会延后已成功域显示，首次尤其明显。`app/import-run-records-view.tsx:29` 明说“只筛选已读取记录”，因此最近 50 条的本地分页不是假装全量，不能误报成缺数 bug。
- AI 空间：`app/ai-space-view.tsx:191–240` meta/jobs/assets 三请求与解析 Promise.all，全成功才整体提交；图片资产读取失败时，成功任务状态也不提交。已有 quiet 失败提示“仍显示上一次成功”，与客服不同，不能笼统称没有旧内容提示。
- 最小方向：在现有身份/完整权限边界内给独立区域显式 loading/error/重试；分区前验证 metadata 的权限依赖。先做慢单域、失败单域的隔离证据，再决定是否值得拆分。
- 回归：每一域失败、全部失败、恢复、权限变更、卸载、快速筛选、当前已读取数量/截断提示。

### U7 子页状态恢复范围不一致，需在已支持规则内明确

- 类型：操作体验建议/边界说明，不是所有字段都必须持久化的缺陷。
- 已有一级 URL 恢复：`app/shell/use-module-view-state.ts:31–75`、`app/page.tsx:318–326`。客服筛选与 page 只在本组件 useState (`customer-service-view.tsx:60–70`)，工作计划筛选同样本地 (`operations-view.tsx:737–749`)。退出模块重挂载会丢失它们，但同页开关 Dialog 本身保持。
- 操作负担：查到特定店铺/第 N 页→切模块核对→回来需要重选与翻页。需浏览器确认当前版具体保留范围，不能用 README“支持的筛选条件”推成所有模块都承诺恢复。
- 最小方向：先列清每模块哪些是已应用可恢复状态、哪些是未保存草稿；针对高频只读条件复用现有 URL 合约或受身份隔离的会话状态，详情返回保留列表锚点。未经确认的表单/货品草稿不自动提交。
- 回归：刷新、push/pop、当前子页、已应用文本与未确认草稿、失效实体、账号变更。

### U8 公共单选的选项搜索 Enter 缺少组合输入门禁

- 类型：静态待复现风险。`app/ui/searchable-select.tsx:90` 在唯一选项时遇 Enter 就 choose，没有 isComposing/229 门禁。多选搜索框没有这个 Enter 自动选择逻辑，不能概括为全部筛选都存在。
- 复现候选：打开单选、中文搜索到唯一选项、组合选词 Enter；检查是否在候选词确认时就选中/关菜单/触发下游查询。需 CDP composition 与原生 Windows 输入法分开记录。
- 最小方向：复用已确认文本提交的 IME 判断，保留普通 Enter 快捷选择；回归唯一/多个/禁用选项、Escape、鼠标选择、光标与菜单滚动。

## 3. 已存在的保护措施与生命周期现状

- 自动化中心 `n8n-workflow-view.tsx:318–389` 用递归 timeout，响应完成后再安排 5s/15s；visibility hidden 清 timer、abort 并增加 generation；卸载清理。未看到它无限重叠轮询的静态证据。2s helper 检查失败直接文案“离线”可能混淆超时与真正离线，需真实延迟/失败实验，不应据此指导用户重启。
- 导入链路规则 `import-chain-rules-view.tsx:28–53` 单次 12s deadline、effect cleanup/disposed，30s 只在 visible 更新；状态校验来源日期，失败清 status 并标无法核实。native dialog 使用 showModal 与 onCancel/onClose。
- AI host `ai-workspace-host.tsx:22–58` 明确保留各已访问模块的 Chat controller，hidden 不卸载，服务端已接受请求持续执行是既定语义，不能把 retained component 当泄漏。`ai-assistant-view.tsx:790–798` 真卸载才中止其前端控制器；stream 增量按 80ms 批量（`:820–841`），不能只凭消息频繁就认定卡顿。仍需串行长期会话观察内存/DOM/连接趋势。
- AI Space/Agent 只有已有在途任务才做 4s 完成后轮询，关闭页面有 timer/controller 清理；浏览器隐藏时仍可轮询，是否需降低状态同步频率需测量，不能停止已接受的后台工作。
- 公共 Dialog `ui/dialog.tsx:60–84,136–205` 有 portal、层栈、背景 inert、滚动锁、Tab/Escape、返回焦点和清理。`visibleFocusableElements :88–94` 只筛 hidden/inert/aria-hidden，没有显式计算 CSS display/visibility；仅为键盘候选风险，需含 CSS 隐藏首/尾控件的真实弹窗复现，不能宣称所有弹窗 trap 失败。
- 日期控件 `statistical-period-picker.tsx:43–55,96–106` 保留 draft、独立确定/取消和监听清理；未应用草稿不应被此次建议改成自动请求。
- AI 抽屉 `ai-workspace-host.tsx:9–18` 失败恢复仍要求整页刷新，可能丢失其他模块未确认草稿；这是具体操作负担。应考虑复用已有局部 reloadable-lazy（需覆盖 React.lazy 失败缓存），不能只重置 boundary 而继续返回缓存的 reject。

## 4. 主报告接入与遗漏

建议总报告优先用串行真实 Home 隔离浏览器补 U1、U2、U3，其次 U4 搜索导航、U5 到期 KPI 慢源实验。每项都要保留原耗时/条件/请求及新内容身份，不能以旧行还在称查询完成。生产仅正常只读，不触发客服 AI、导入、机器人测试、备份或工作流运行。

本分工尚未验证：任何子页的实际浏览器布局；原生 Windows 输入法；窄窗/缩放；真实权限变化；长时间内存/连接趋势；n8n iframe 内交互；业务写操作；服务端 SQL/负载竞争。55 行的 S 并不构成这些项目已通过。内部子层（设置 master 三页、AI 配置和商品表现内部列族等）仍须在主报告另列覆盖深度。

已交总控串行执行的验证器：`../tools/customer-backup-probe.mjs`。本分工只写文件与执行 `node --check`，未运行浏览器。验证器固定现有隔离 3781，真实 Home/样式配合全部合成 API；七组逐组独立 page、6s locator 超时、失败保留继续，输出请求时序/字节、操作可用性与截图。夹具用于 UI 请求/状态验证，不代表客服后端筛选或备份服务时延已经验证。
