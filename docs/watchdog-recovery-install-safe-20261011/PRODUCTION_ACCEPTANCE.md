# 独立运行监控安装与生产验收

2026-10-11，Asia/Shanghai。用户对已冻结的[完整采用方案](ADOPTION.md)明确回复“安装”，本次仅采用该独立监控包。源码 `b20ca302` 已随 `4c799a4e2ff21343347db818dab990e61c03455d` 合入并推送 main。本记录补充[准备报告](REPORT.md)，不改写准备时尚未采用的历史事实。

## 安装结果

- 安装清单时间：19:26:52.788（UTC+08:00），布局 `immutable-v1`，安装事务 `completed`。
- 批准及现场复验的 planId：`973f813cf5ab237816f9243c10a931642c209b73f082028dc1236da77a538808`。
- 实际运行 bundleId：`add91c4aa03f8b81ef4f26e89bf082bd9a8de9c2b7f0b08bcfa32c75d54f2a68`。
- 九个运行文件逐字节 SHA-256 与批准计划一致；入口为 `D:/teruisi-runtime/operations-watchdog/versions/<bundleId>/operations-system-watchdog.ps1`，经同目录无控制台 launcher 启动。
- 原 `TERUISI Operations Watchdog` 任务已启用；入口、工作目录和参数回读通过，原每分钟／登录触发器、设置及执行身份与安装前任务定义一致。
- 旧根目录脚本仍为 `aefa5e6d85d9a28a3e84405b77b0dc89caa2b3c341fa8a088744ee6388a0111b`，未覆盖。旧清单原字节和任务定义保存在受保护的 `install-transactions/87e097b674204177a54078b4f3a24631/`，旧清单备份摘要与批准前驱一致。
- 控制器、已安装 Django service、Worker service、配对 helper 四个原生产来源的前后 SHA-256 相同。

安装器先等待旧任务自然结束，在共用互斥内验证批准计划、完整当前健康和二次前驱。完成后由原自然触发开始检查，没有人工运行 Check、故障注入或 TestNotification。

## 两轮已完成的自然检查

下列完成时间来自新版 `completedAt`，均晚于安装，且主状态的 `lastHealthy` 已在对应完成后写入；没有仅用任务返回码或快照起始时间判断完成。

| 轮次 | 开始时间 | 完成时间 | 总耗时 | 后端／Worker／内部 HTTP 状态阶段 |
| --- | --- | --- | --- | --- |
| 1 | 19:27:26.207 | 19:28:04.699 | 38,497 ms | 21,432／8,173／2,261 ms |
| 2 | 19:28:26.137 | 19:29:07.680 | 41,549 ms | 22,721／10,146／2,268 ms |

两轮均为 `Running/Ready`、`healthy=true`、`readonly_driver`；实际 12 个领域组件全部通过，首页／live／ready／helper 四个 HTTP 探针全部通过。核心诊断中的 PostgreSQL、Django reader/writer、双就绪状态、runtime ACL 与 ACL 验证方式均已收到；reader/writer 原两秒检查均 HTTP200，原因 `none`。两轮主状态均 `decision=healthy`、`failures=0`、`incident=null`。

安装前与验收末的告警文件清单比较：新增 0、变更 0。正常期间没有新增故障告警；本轮没有触发真实故障恢复或恢复通知投递，其能力沿用准备阶段的隔离回归证明，不能据此宣称真实钉钉投递验收完成。

## 范围与后续观察

本次未主动重启健康业务服务，未发布 Django／Worker 应用，未迁移、写入业务数据、修改 n8n 或手工真实发送。原自然监控的受控恢复权限及自动本人单聊通知规则继续保留，恢复事实通知的新逻辑已随包采用。

两轮健康只证明本次安装验收。此前间歇核心失败的底层原因仍未证实，未宣称生产 P95 或完整业务日观察完成。每分钟监控已生效；后续应据首次／最近失败、恢复确认、检查分类和阶段耗时评估稳定性。原生产来源更新后需刷新诊断绑定，不能把旧包装健康作为新版本就绪证据。

脱敏验收数据见 [PRODUCTION_ACCEPTANCE.json](PRODUCTION_ACCEPTANCE.json)。原安装输出、现场计划、文件回读、两轮完整快照／状态及告警比较保留于 `E:/codex-artifacts/watchdog-recovery-install-safe-20261011/production/`；含执行身份的原任务 XML 只在受保护恢复事务内保留，不提交仓库。
