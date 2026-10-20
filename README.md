# 电扇运营管理系统

面向电商运营的销售、网店、市场、库存、客服与协同管理系统。前端使用 React/Next.js 与 Vinext/Vite，薄 Worker 连接 Django/PostgreSQL 业务服务；图片和附件按领域规则使用 R2。

本文件介绍使用入口与已确认限制。所有 AI 开始执行本项目任务前必须先完整阅读 [AGENTS.md](AGENTS.md)，再按其索引读取相关规范并执行。详细规则见 [规范目录](docs/规范/README.md)，既往发布与验收见 [历史记录索引](docs/规范/历史记录/README.md)。

发布交付按“检查必需程序代码 → 合并并生成对应制品 → 直接发布”执行；功能及其代码的业务行为由用户在上线后自行检测判断，AI 不追加功能验证。具体分工见[发布检查与功能验收分工](docs/规范/验证与发布.md#发布检查与功能验收分工)，执行与续接见[发布批次协议](docs/运维/部署与启动/release-batch-workflow.md)。

必需程序代码在合并前检查，最终制品在发布前准备完成。发布负责人按本次授权直接调用原生入口，默认只消费已就绪的精确版本，不在发布时现场补建制品，也不要求用户点击 BAT。已有 BAT 保留为可选兼容入口。使用和边界见[自动提前打包与发布执行](docs/规范/验证与发布.md#自动提前打包与发布执行)。

可选的 `查看打包状态.bat` 只观察准备记录，关闭窗口不影响后台打包。原生 `preparation/PREPARED.json` 才证明制品准备完成；来源已冻结、正在准备和已上线分别报告。

全部项目 Markdown 按用途归类，入口见 [文档首页](docs/README.md)、[完整文档目录](docs/文档目录.md)和 [任务记录目录](docs/任务记录/README.md)。

## 主要能力与使用文档

| 工作范围 | 能力与说明 |
| --- | --- |
| BI 看板 | 综合经营驾驶舱、类目、库存、流量及目标展示；[驾驶舱说明](docs/历史记录/性能与发布/bi-cockpit-production-20261006.md) |
| 销售与网店 | 销售、退款、毛利、财报与目标；店铺、商品、推广及平台对比；[网店分析说明](docs/netshop-refactor/README.md) |
| 市场分析 | TOP 榜单、价格、行业汇报与 SKU 图片标注；[分页与查询](docs/使用手册/市场分析/market-query-pagination.md)、[标注与复核](docs/使用手册/市场分析/market-annotation-reliability.md) |
| 库存与商品 | 库存健康、库龄、广东入仓监控、备货计划及商品经营；[库存管理说明](docs/使用手册/商品库存/inventory-management.md) |
| 运营事务 | 工作计划、巡店、评价、新品上架、上新跟进和变量配置；[上新跟进与周报](docs/使用手册/运营协同/new-product-weekly-followup.md) |
| 客服与数据导入 | 客服资料解析与分析、文件导入、运行记录及链路规则；[导入监控](docs/使用手册/数据导入/import-monitor.md)、[客服工作流](docs/自动化/京东/jd-customer-service-workflow.md) |
| AI 助理 | 对话、Agent 工作流、全局记忆、分析沙箱、AI 空间与管理；[配置说明](docs/使用手册/AI助手/ai-assistant-setup.md)、[能力与限制](docs/技术专题/AI助手/ai-platform-architecture.md) |
| 系统管理 | 用户权限、机器人配置和数据库备份；[备份与恢复](docs/运维/备份与存储/backup-retention.md) |

## 页面导航

网店分析的店铺分析、商品表现和推广分析增加新版布局，并保留“旧版”切换入口；新版沿用现有真实数据、指标和钻取，来源说明按区域收起。店铺原ERP分析继续保留在旧版路径中。源码交付说明见 [三板块整合改造](docs/netshop-integrated-20261020/REPORT.md)，正式运行版本以实际发布为准。

Pi原生交互与协作增量增加结构化提问、运行时计划模式、独立子代理协作、可视会话分叉、实际思考档和内置Skills语义；须完整采用153结构、新Runner与对应镜像后生效。源码、制品和实际上线分别记录，见[运行说明](docs/技术专题/AI助手/pi-agent-runtime.md#原生交互与协作增量)与[用户自测场景](docs/pi-native-capabilities-20261020/SELF_TEST_PROMPTS.md)。

Pi三期在Agent输入区增加“本轮业务动作”：创建正式工作计划、保存可编辑补货草稿、预览已注册n8n补缺及报告定向投递。普通计划/草稿参数完整后持久保存；补缺与外发先预览再确认，刷新只恢复原动作。源码合并、制品就绪与实际上线分别判断；结构、Runner/1.2.0镜像及n8n候选均需对应采用。范围、使用及限制见 [Pi运行说明](docs/技术专题/AI助手/pi-agent-runtime.md#三期业务执行)，用户自测提示词见 [三期交付](docs/piagent-phase3-20261019/SELF_TEST_PROMPTS.md)。

在“AI 对话”输入区切换 Chat / Agent；Agent 使用 Pi 独立容器执行预置运营技能、权限内取数、异步导出和 Python/Node 分析，生成文件并跨轮继续。两种模式分别保留会话和草稿，切换不停止后台任务；原 Agent 工作流保留。二期源码增加对话/文件/真实终端工作区、插话排队、Pi会话树、公开研究、用户依赖及环境升级；须完成对应结构、Runner和镜像的受控采用后启用。首次使用需要单独准备 Runner；默认不启用。使用、安装、恢复和资源边界见 [Pi Agent 运行说明](docs/技术专题/AI助手/pi-agent-runtime.md)。

主界面按协同执行、经营分析、商品与供应链、系统与智能组织模块。统计周期、模块和支持的筛选条件随 URL 保存，刷新及浏览器前进/后退可恢复。公共筛选文本按 Enter 确认，下拉选择自动加载；统计周期支持近 30 天与去年同期。各页面的指标定义统一见 [业务口径](docs/规范/业务口径.md)。

广东入仓型号明细可直接创建备货计划，默认广东仓；下单时间与备货数量在同一弹窗维护。详情见 [库存管理说明](docs/使用手册/商品库存/inventory-management.md)。

京东入仓监控采用“库存管理 → 京东入仓监控 → 库存监控 / 商品对照 / 库存流水 / 调拨核对”三级结构；京东物流文件导入与运行记录在数据导入模块。离线真实文件页仅展示已下载报表及其数据日期，不代表正式导入、ERP核对或通知已执行。

库存监控支持短标题和展开分仓表，按近30日销量、可用库存与两类在途计算建议补货。补货周期默认30天，管理员可在监控页独立设置；计算口径见[业务口径](docs/规范/业务口径.md)。

库存健康状态可通过TAB筛选，包含缺货与补货清单；页内“库存周转设置”可手动输入1–3650的整数目标覆盖天数，默认30天。离线HTML也支持同范围本地试算，健康分档与消息提醒分别显示，清单计数按完整范围计算。

天猫入仓监控位于“库存管理 → 天猫入仓监控”，支持货主、仓库、货品筛选与单品展开分仓；文件导入和运行记录在“数据导入 → 天猫入仓”。独立 n8n 工作流从天猫供应链的实仓良品实时库存页导出、下载、校验导入并回查批次。实时原表没有30天销量时，周转和建议补货显示暂无依据；首次运行须完成专用会话配置和登录，工作流默认停用。使用边界见[天猫入仓说明](docs/使用手册/商品库存/inventory-management.md#天猫入仓监控)。

## 启动方式

当前 Windows 本机环境可双击桌面或开始菜单的“运营管理系统”，也可按 `Ctrl+Alt+O`。就绪后使用 Google Chrome 打开 [本机页面](http://localhost:3000)；关闭启动窗口不会停止服务器。

```powershell
& "D:\运营管理系统\tools\operations-system-control.ps1" -Action Start -Open
& "D:\运营管理系统\tools\operations-system-control.ps1" -Action Status -Json
```

在项目根目录也可使用以下入口：

```powershell
.\运营系统.bat                  # 菜单
.\运营系统.bat start-bg         # 后台启动，立即返回
.\运营系统.bat restart          # 网页 Worker 热重启，保留后端
.\运营系统.bat restart-full     # 完整重启
npm run system:status
npm run system:stop             # 完整停止
npm run system:logs
```

启动入口统一委托既有受控引擎；重复启动会等待或返回当前状态。启动器安装与服务、进程身份检查细节见 [运行与启动](docs/规范/运行与启动.md)。钉钉接收器需要登录原 Windows 用户，配置与限制见 [接收器启动说明](docs/使用手册/AI助手/ai-dingtalk-schedules.md#接收器随系统自动启动)。

### 前端热更新与隔离演示预览

页面方案和前端调整默认交付可直接打开的 HTML 文件，不主动展示在线预览；仅在明确要求浏览器预览时使用下述入口。详细约定见[前端与性能](docs/规范/前端与性能.md)。

**独立 `codex/*` Git worktree 是硬前置，主检出不能启动此入口。** 在该 worktree 中运行 `npm run dev:hmr`，默认不打开浏览器；需要主动打开时双击 `预览系统.bat` 或运行 `npm run preview:isolated`（保留 `--open`）。原有 `dev`、`start`、`build` 语义不变。

正式使用 `http://localhost:3000`，开发使用 `http://127.0.0.1:3100`；并行建议 3100、3110 等间隔，并核查前端、两个 Django 和控制端口的完整端口组。开发横幅显示“开发环境 · 合成数据 · 禁止业务提交”及实际端口、当前分支，正式构建不显示。

当前合成集包含销售、库存、ERP、市场、网店、财务、工作流、年度目标、新品、AI 对话与报告；有数据不代表所有页面及交互均已覆盖。需要保留当前业务演示数据时，按 `stop → snapshot → prepare → start` 操作；快照只覆盖业务 SQLite。端口表、命令、HMR、认证和自动化边界见 [前端热更新与隔离预览说明](docs/运维/部署与启动/isolated-preview.md)。

一期启动器与上述入口须配套采用：按安装输入指纹同步依赖，新启动及已就绪会话复用均检查开发标识和隔离后端；显式打开浏览器使用本 worktree 专用 Chrome profile。精确 A 提交及配套状态见上述说明，源码交付不表示已合 main 或正式采用。

### macOS / Linux 开发环境

没有正式 runtime 的开发机可使用 SQLite 开发后端：

```bash
npm run backend:dev
npx vinext dev
npm run backend:dev:status
npm run backend:dev:stop
```

开发工具自动准备 `.runtime/django-dev/` 并同步 `.dev.vars` 受管块；首次同步后需要重启 dev server。该模式不启用生产 authority 门禁，部分正式 writer 写路径不可用，不用于 Windows 正式主机。后端机制见 [后端说明](backend/README.md)。

## 自动化与导入

“数据导入”包含文件导入、运行记录和链路规则。运行记录查看导入批次；链路规则显示 n8n 整条工作流的定时、重试及完整手动执行结果。状态来源不可用时显示无法核实，工作流成功与批次、日期覆盖验收分别判断，详见 [导入监控](docs/使用手册/数据导入/import-monitor.md)。

| 来源 | 使用与维护入口 |
| --- | --- |
| 吉客云五表 | [会话接口下载](docs/自动化/吉客云/jackyun-session-api-export.md)、[专用登录配置](docs/自动化/吉客云/吉客云DPAPI登录配置.md)、[45 天销售窗口](docs/自动化/吉客云/jackyun-sales-rolling-window.md) |
| 京东商品与商智 | [多店铺执行手册](docs/自动化/京东/京东多店铺账号切换与串行执行手册.md)、[下载与导入核验](docs/自动化/京东/京东多店铺统一下载与导入-审查修复与稳定性手册.md) |
| 京准通推广 | [设备店工作流](docs/自动化/京准通/京准通AI推广数据n8n工作流.md)、[切肉机店工作流](docs/自动化/京准通/京准通志高切肉机AI推广数据n8n工作流.md) |
| 京东市场榜单 | [SKU 日数据工作流](docs/自动化/京东/京东市场商品榜单SKU日数据n8n工作流.md) |
| 天猫 | [监控与安全恢复](docs/自动化/天猫/天猫n8n每日导入监控与安全恢复手册.md)、[缺失日规划与采用边界](docs/自动化/天猫/天猫商品与推广缺失日规划.md)、[近七天全部缺口逐日补齐·当前采用](docs/tmall-seven-day-gap-loop-20261008/PRODUCTION.md)、[开发验证](docs/tmall-seven-day-gap-loop-20261008/REPORT.md) |
| 京东客服 | [下载、配对、导入及待采用自动化](docs/自动化/京东/jd-customer-service-workflow.md) |

吉客云现行五表工作流使用专用浏览器登录和会话接口下载，销售覆盖截至昨天的最近 45 天，库存及库龄标为实际采集日。手动导入应按页面要求提供店铺、快照日或预期日期范围；SKU 快递费率使用 `SKU累计` 工作表，具体校验规则见 [导入规范](docs/规范/导入与自动化.md)。

凭据配置使用本机交互入口 `npm run jackyun:credential:setup`、`npm run jd:credential:setup -- -StoreKey <店铺键>` 或 `npm run tmall:credential:setup -- -StoreKey <店铺键>`。配置与恢复按对应操作手册执行。整链通知、人工协助和防重复提醒规则见 [工作流通知说明](docs/自动化/通用/workflow-dingtalk-notifications.md)。

### 钉钉自定义机器人消息工具

独立文本消息工具从环境变量读取 Webhook 和加签密钥。`--dry-run` 只验证参数与加签，输出隐藏 Token；去掉该参数会真实发送，应先确认本次发送对象与内容。

```powershell
$env:DINGTALK_ROBOT_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=<token>"
$env:DINGTALK_ROBOT_SECRET = "<secret>"
npm run dingtalk:robot:send -- --text "hello" --dry-run
npm run dingtalk:robot:send -- --text "hello"
```

## 已确认限制

- 市场分析反映当前 TOP 榜单覆盖，不代表完整行业大盘；来源缺日、字段缺失和映射歧义保留并披露。
- 库存、销售、网店使用各自的数据截止日期；可查询不等于已同步至昨天。查询前按 [运营数据查询规范](docs/OPERATIONS_DATA_QUERY.md)核对新鲜度。
- 客服配对歧义仍需人工复核；客服每日自动下载不能仅凭解析修复已采用而视为已启用，实际范围见对应工作流报告。
- AI 图片和经营报告须人工复核；候选开发、合成验证与实际采用分别记录。[经营分析剩余验收](docs/技术专题/AI经营分析/集成与交接/ai-business-remaining-acceptance.md)列出未完成项。
- AI 对话模型及渠道的同级 CAS 审计、供应商币种单价换算和人民币费用仪表盘尚未实现，不能把当前 AI 管理解读为完整成本管理平台。
- 备份上传及隔离恢复验证不等于已恢复生产数据库；恢复操作见 [备份与恢复](docs/运维/备份与存储/backup-retention.md)。
