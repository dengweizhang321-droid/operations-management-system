# 电扇运营管理系统

面向电商运营的销售、网店、市场、库存、客服与协同管理系统。前端使用 React/Next.js 与 Vinext/Vite，薄 Worker 连接 Django/PostgreSQL 业务服务；图片和附件按领域规则使用 R2。

本文件介绍使用入口与已确认限制。所有 AI 开始执行本项目任务前必须先完整阅读 [AGENTS.md](AGENTS.md)，再按其索引读取相关规范并执行。详细规则见 [规范目录](docs/规范/README.md)，既往发布与验收见 [历史记录索引](docs/规范/历史记录/README.md)。

发布交付按“验证修改功能 → 合并并生成对应制品 → 发布”执行，具体步骤见[验证与发布](docs/规范/验证与发布.md#常规发布的三个交付步骤)，执行与续接见[发布批次协议](docs/运维/部署与启动/release-batch-workflow.md)。

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

主界面按协同执行、经营分析、商品与供应链、系统与智能组织模块。统计周期、模块和支持的筛选条件随 URL 保存，刷新及浏览器前进/后退可恢复。公共筛选文本按 Enter 确认，下拉选择自动加载；统计周期支持近 30 天与去年同期。各页面的指标定义统一见 [业务口径](docs/规范/业务口径.md)。

广东入仓型号明细可直接创建备货计划，默认广东仓；下单时间与备货数量在同一弹窗维护。详情见 [库存管理说明](docs/使用手册/商品库存/inventory-management.md)。

京东入仓监控采用“库存管理 → 京东入仓监控 → 库存监控 / 商品对照 / 库存流水 / 调拨核对”三级结构；京东物流文件导入与运行记录在数据导入模块。离线真实文件页仅展示已下载报表及其数据日期，不代表正式导入、ERP核对或通知已执行。

库存监控支持短标题和展开分仓表，按近30日销量、可用库存与两类在途计算建议补货。补货周期默认30天，管理员可在监控页独立设置；计算口径见[业务口径](docs/规范/业务口径.md)。

库存健康状态可通过TAB筛选，包含缺货与补货清单；页内“库存周转设置”可手动输入1–3650的整数目标覆盖天数，默认30天。离线HTML也支持同范围本地试算，健康分档与消息提醒分别显示，清单计数按完整范围计算。

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

### 隔离演示预览

页面方案和前端调整默认交付可直接打开的 HTML 文件，不主动展示在线预览；仅在明确要求浏览器预览时使用下述入口。详细约定见[前端与性能](docs/规范/前端与性能.md)。

在独立 worktree 中双击 `预览系统.bat` 或运行 `npm run preview:isolated`，使用独立的 `127.0.0.1:3100` 和合成数据。数据准备、快照、恢复和停止命令见 [一键预览说明](docs/运维/部署与启动/isolated-preview.md)。预览以查询和展示为主，其余领域可能为空态；完整写流程及 PostgreSQL 契约需另行验证。

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
