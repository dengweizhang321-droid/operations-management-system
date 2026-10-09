# 发布优化 B 交付报告

2026-10-10。实现固定快照/同截点历史指纹比较、精确被阻止favicon分类、共同期限只读状态重试与离线证据/交付报告生成。方案及边界见 [PLAN](PLAN.md)，接口与共享文件接缝见 [给 D/C 的说明](INTEGRATION_D.md)，[非作者复审](INDEPENDENT_REVIEW.md)结论通过。仅开发交付，尚未生产采用。

## 已交付行为

- 数量、主键/会话身份、业务内容各自给出结果；合法新增/单次重导必须有原独立来源回执字节与范围绑定。合法内容变化不伪称逐字保全；无旧行基线返回unprovable。原3299→3302旧聚合基线没有改写或补造。
- 精确HTTPS回环favicon继续abort，仅单独分类；正常HTTP图标另核候选SHA，其他资源必须实际正常加载并与批准inventory一致。真实原两入口四店操作保留，所有危险请求保持失败。
- 精确最终Status与收尾准入Status共用最多四次/2秒等待/240秒总期限。真实12组件逐域验证，身份/权限/制品/断言/未分类错误不重试；Start/apply/备份/恢复/业务不重放。每次尝试保留脱敏阶段、耗时和错误。
- 报告检查原SHA及journal链，投影精确版本、步骤、原失败、协调、备份恢复、未决和计时。未完成不生成成功，自动 `acceptancePassed:null`；独立复审与事实检查仍保留。

## 验证及原失败

| 验证 | 结果 / 原日志 |
| --- | --- |
| 最终发布入口（新增作者、独立及原发布专项） | 109通过、0失败、0跳过；[final-release-entrypoint.log](final-release-entrypoint.log) |
| 历史领域合成验证 | 作者12、独立5通过；实际SQL只用隔离cursor验证权限/回滚，无生产读取；[作者](history-author-final.log)、[独立](independent-final.log) |
| 实际UI来源隔离浏览器 | 真实Card/SearchableSelect/四店配置与CSS构建；原8次选择、初始/无文件禁导入、非管理员禁用、资源SHA、零业务请求写入；包含在最终109项，不冒充生产整页验收 |
| 原系统PS5传输及生命周期回归 | 原58专项纳入109项；变异操作不新增重试 |
| 全仓unit原运行 | 3513项，3480通过、11失败、1取消、21跳过，921910.1364ms；[unit-all.log](unit-all.log)。不宣称全绿 |
| 全仓原失败定向收口 | 缺隔离Python环境的契约补齐后46通过；原PS/浏览器/导入6通过；完整客服文件12通过、0失败、0取消且正常退出，[customer-file-final.log](customer-file-final.log)。具体原文及条件保留，[Python契约](python-contract-rerun.log)、[剩余6项](full-failures-rerun.log) |
| 构建、模块边界 | 生产构建通过，[build.log](build.log)；650模块边界通过，[boundary.log](boundary.log)。构建前确认本task检出没有Worker监听；原3000服务保持 |
| Lint / diff | 修改文件0错误/0警告；全仓0错误、35既有警告，[lint-final-changed.log](lint-final-changed.log)、[lint-final-all.log](lint-final-all.log)；git diff --check通过 |

全仓首次缺 `.runtime/test-venv` 产生7个Python相关失败；后创建本任务独立venv，相关当前契约/导入测试通过。其余4个浏览器/PS失败定向复验通过，原负载/时限根因没有测量定论。一个客服测试文件已输出全部结果但残留Node/自身headless Chrome，导致全仓未退出；仅在核对PID、父链、创建时间及临时Playwright Profile后清理自己创建的两个测试主体，[cleanup](full-unit-fixture-cleanup.json)，未停服务或其他浏览器。完整低并发文件退出结果另存。不能用当前通过反推原全仓也通过。

首次依赖安装ECONNRESET，原失败与第二次成功记录均保留。UI夹具原root路径遗漏、CSS依赖/typed-array哈希误用，以及独立审查发现的期限、类型、metadata及计时漏洞，均保存首次日志和修复复验。首次全仓lint遇独立测试文件正在编辑的解析错误；最终独立文件及全仓lint均复验，无源码解析错误。没有为取得通过修改业务断言或删历史失败。

## 封存证据离线收尾样本

[最终历史草稿](historical-draft-final/REPORT.md)、[JSON](historical-draft-final/report.json)与[原证据SHA清单](historical-draft-final/evidence-manifest.json)从E盘原71条journal、8回执及5执行log只读生成。独立事实复算见 [fact-check](independent-historical-fact-check.json)。原19步骤passed、3个unknown历史及4次独立协调保留；精确e1f源码、候选/前驱、运行观察和原journal head一致。

批准到批次完成8554676ms，批准到原文档交付10021661ms，批次后文档区间1466985ms；原阶段duration总和6246219.0826ms，execution区间并集6246206.4092ms，墙钟残差2308469.5908ms。首条批准事件携带的12.6728ms队列duration发生在墙钟起点之前，区间并集正确裁剪，所以两者有小差异；残差包括等待、协调与未打点工作，不能一概称空闲。协调跨度不再次累加。

本机一次最终离线生成633.6905ms，见 [timing](report-generation-timing.json)。它证明报告机制，不测得人工节省。误报减少10～18分钟、文档收尾减少5～10分钟仍是待验证估算。本次没有生产注入故障、执行新发布或证明每批固定节省。

## Git 与范围

本任务代码/测试/文档从最新远端main99eaa0b9独立开发，所有提交只暂存本任务文件；精确commit、合并、推送与保全状态在最终DELIVERY中列明。主检出仍有用户原未提交文件，且本地main停在2f55c396、与远端更新同名文件重叠；不stash/reset或覆盖它们。若无法在主检出安全更新main，将在本任务干净检出以最新远端main形成正常合并、普通fast-forward推送远端main，并明确报告本地主检出待同步。

本次未生产启停、部署、数据库迁移/业务写入、调度修改或外部发送；未读取/保存原客户内容，未改变E盘原脚本、基线、批次、WAL、回执或日志。新候选须由D重新绑定完整闭包/前驱/制品/测试并取得对应发布授权，不能复用旧已批准批次。
