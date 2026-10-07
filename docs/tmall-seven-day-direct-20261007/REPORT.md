# 天猫六店近七日查缺、P/M 直连与每日货品候选

2026-10-07，用户要求六店先检查近七天系统记录，判断抓取日期；全部页面 P/M 改为直连，并将三日货品节奏改为每日。本文记录开发与候选准备，**尚未正式采用，不代表六店真实导入验收通过**。

## 最终业务口径

- 上海时间最近七个完整日期，截止昨天，包含昨天。10月7日正常执行检查9月30日至10月6日；新店不足七天时不早于注册起始日。分别回查商品日和推广日的权威覆盖，选并集中最早缺失日，每轮最多一个日期，只下载缺失的数据集。覆盖读取失败不能当成空数据；无缺口仍复核覆盖和未决任务，再进入M收尾。
- 六店保留原 workflow ID、11:00至11:50各自调度、店铺/execution身份、浏览器资源隔离与小时安全重试。P统一使用既有同日、四场景、商品+计划直连接口；M统一每20商品分批MTOP导出，逐批核验商品集合、文件和记录，合并后单次导入与回查。
- 三店持久节奏用原受控迁移入口由3→1；保留最后成功日、快照及全部失败记录，nextDueDate按最后成功日+1重算，不把迁移记为新业务成功。失败不推进；同日已经成功的自动流程正常not_due，手动强制标记仍按原入口。
- 旧活动清单不因七日窗口、策略或版本变化而删除。原提交未知、任务歧义、验证码或完整性失败继续停止；页面P/M的业务动作清单不能由直连协议接管。原丽力M协议保持仅本店M兼容，新丽力P/M使用独立新协议。
- 不采用历史待发布的多日循环，也不增加七日前的新报表抓取。明确的原有显式日期恢复入口继续保留原范围验证。

## 六店目标与候选

| 店铺 | 工作流ID | P/M协议 | 货品间隔 |
|---|---|---|---|
| 亿玖 | M4xY8kQ2vR6sT9pC | yijiu-direct-pm-v1 | 1日 |
| 亿用 | TmallYiyongDaily2026 | yiyong-direct-pm-v1 | 1日 |
| 丽力 | TmallLiliDaily2026 | lili-direct-pm-v1 | 1日 |
| 拓丰 | TmallTuofengDaily2026 | tuofeng-direct-pm-v1 | 1日 |
| 炊之王 | TmallCuizhiwangDaily2026 | cuizhiwang-direct-pm-v1 | 1日 |
| 马思图 | TmallMasituDaily2026 | masitu-direct-pm-v1 | 1日 |

六份`automation/n8n/tmall-*-seven-day-direct.workflow.json`来自本次真实已发布图的只读快照，经受控纯适配生成，全部active=false。适配器验证原workflow ID、唯一P/M POST节点及所有HTTP节点的同店/同execution头，只改P/M路由、协议、名称和相应连线及说明；A/B/C、定时、重试、超时与其他设置保持，不加入N循环。可从新的已发布快照重复生成，不能以仓库候选替代现场发布版本核验。

原`config/tmall-store-accounts.json`字节保持，原helper继续按原方式解释配置。新helper/CLI在验证该配置后，只对六个已批准且启用的店铺应用`applyTmallDirectDailyPolicy`：使用direct_mtop与1日间隔，保留浏览器、登录项、店铺键、初始日期及未启用店铺状态。未知原模式或非1/3日原节奏拒绝；不新增第二份活动注册表或放宽helper构建器、配置白名单与生命周期校验。因此合并源码或准备新版本不会提前改变原helper行为。链路展示目录和Django完整manual成功验证目录同步新候选节点名称；正式采用时须一起更新这份Django目录，避免把新完整人工执行误报为未完成，不需要业务数据库迁移。

离线生成：`node --import tsx tools/tmall-uniform-direct-workflows.ts --source-dir <原发布快照目录> --output-dir <独立候选目录>`。原`npm run tmall:n8n:generate`保留历史循环/页面生成器，只用于审计，不得用于此次发布。package及原受保护生命周期入口全部保持原字节。

## 验证与材料

- 最终天猫与链路展示定向测试251/251通过；独立SQLite元数据镜像的Python手动完成契约15/15通过，包含历史节点别名、歧义/局部/固定数据/错误阶段拒绝，不连接生产业务库。
- 全量Node实际3381项，3357通过、2失败、1取消、21跳过。Windows原进程轮转失败和商品详情浏览器30秒取消在不改代码、不放宽超时的低争用定向复测均通过，旧样本保留。销售/库存静态断言在未修改6a715362对照仍为2!=1；本轮不修改无关页面。首次全量的缺Python隔离依赖、准备期间展示目录不一致及临时注册表路径试验导致helper契约拒绝均保留，已恢复原配置来源并补齐隔离测试依赖；当前聚焦与原helper正式构建契约通过。不能宣称全仓全绿。
- 生产构建通过；lint零错误、28个已有警告；差异检查通过。全仓TypeScript仍有185项诊断；本轮新增策略、规划、适配器、注册表及协议文件没有直接诊断，不把局部检查称为全仓类型检查通过。
- 真编译helper的独立镜像验证六店领取、同店重入、跨店owner、停用店和越序拒绝通过，业务动作0。最终独立helper SHA为`2e558e2b8d586a3338084dfe32f896e7519f058150cfd3306b9689dfbebf0281`。
- 本次读取到的正式Worker前驱为`20261007T070159Z-8d7fff69f9b30b9f`、manifest`de6a96d5b009c4a33fa78268f359dd808fdf4bc509221f12cbcbdd21bb007e58`。额外以该前驱source-snapshot组合六份必要helper源码（含新增policy），保留其原小时重试分类源码，独立重新编译的helper SHA与上述一致；不把其他main候选顺带采用。
- Django Prepared `12f32dd25bc64b0caa1a451ee7b2e169`，receipt SHA `0d5626eb3a94f7c77ca36b4221cb3fde2cd5be6eeedc8f1d69a5a23ba5d1fda0`，fingerprint`05fa4ba96118eda1d2d8b0fa3398a04de0fe94bc68b22c7ee9a61fb6e9970185`，绑定正式前驱manifest`660a2bb03f2d5c2c292b7ea77fd2c4e4b5e9f90dda33804db9653837c6dff9e2`。原Get-PreparedApplication独立回读通过；前驱与Prepared的2932份有效文件比对，只有`backend/workflow/import_chain_catalog.json`和`backend/workflow/import_chain_status.py`不同，依赖原字节保持，无新增迁移。
- 用户暂停后恢复，本轮重新核验六店active/current/published版本均与来源快照相同，Worker前驱及Django Prepared绑定保持。真实切换前仍须再核验。

独立候选与证据保全至`E:/codex-artifacts/tmall-seven-day-direct-20261007`；当前组合helper在`combined-helper/tmall-workflow-helper.mjs`，初期包只作过程证据。尚未创建正式Worker轮转计划，准备发布时需基于届时固定源与精确前驱构建、绑定，不能直接用独立helper包启动。开发树仍被候选准备与本次收尾使用，未提前归档。没有正式维护、部署、节奏迁移、n8n发布、真实下载导入或外部通知。

## 正式采用步骤

按[开发与交付](../规范/开发与交付.md)的本次明确上线确认要求执行：

1. 重查当前固定发布源与正式前驱，协调排空业务任务；保全六店发布定义、版本、设置、持久节奏与活动清单。只读核验各店无未决页面业务任务，不归档或清理其他任务。在协调切换窗口暂停原六店调度，避免新helper与旧图混用；原其他调度保持。
2. 在原流程完成Worker/helper及最小Django目录候选的构建与前驱绑定，前备份/Verify/独立恢复与完整比较元数据保全。候选源码和独立helper包不是已消费的正式Worker轮转计划，不能直接用于启动。
3. 使用原保留PostgreSQL维护、唯一生命周期控制器，准确采用候选；更新三店节奏时携带实时旧间隔、最后成功日期及原确认值，拒绝漂移。保留其余角色、迁移、业务事实和调度。
4. 在六个原ID按实际live最小差异发布P/M，保留所有者、运行元数据、原Webhook、时区和调度，不能直接整份导入旧循环模板。六店每店只有一条active调度。
5. 复验正式版本、12组件与启动绑定、浏览器/helper隔离及前后备份恢复。真实验证只能经原n8n完整入口，分别核验两类日覆盖与M文件/批次/行数/告警/快照/节奏及收尾；候选测试不能替代真实六店业务验收。
