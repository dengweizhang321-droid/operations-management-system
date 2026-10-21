# Pi统一界面及验证修复发布

2026-10-21用户明确授权“把任务合并到main，并发布上线”，覆盖此前禁止合并/上线的限制。发布基线为当前正式来源`2be62f90e6dd`，任务验收提交为`52d51a80`；先同步最新main，无冲突，主工作区已有改动保持原样。

## 范围与必需代码检查

- 发布Worker、Django及Pi Runner，不新增数据库migration，不采用n8n候选，不补跑业务或测试消息。
- 7个本次前端入口的TypeScript依赖闭包检查为0诊断，使用锁文件匹配的发布依赖；8个本次Python应用源文件AST解析通过。
- 必需发布适配：无migration的Runner Python源码变化也必须进入原PreparePiUpgrade → PiUpgradeCheck → UpgradePi，否则仅部署Django不会更新Linux Runner。使用当前153前驱既有Native 1.3.0镜像`sha256:87e41e7e4d646d779eba8b552a213d5356c4afa935d42dbb618d19fab7e15956`；历史结构分支优先，完整diff同时覆盖新旧路径，排除测试文件，升级必须绑定本次Django准备包。此适配不泛称已覆盖所有非Python资源或镜像变化。
- 新发布编排用例及原combined无migration用例共2项通过，仅私有假引擎，不访问生产或执行功能验收；独立增量复审无实质阻断。既有产品验收结果复用，不再执行模型/消息实投或业务功能测试。

## 原生交付与异常边界

合并推送后，由固定普通权限入口冻结最终main并在线准备制品，正式PREPARED绑定该最终提交、实际前驱和完整字节。Worker、Django和Runner沿原排空、唯一维护、身份、权限、CAS及启动门禁采用；无migration不新增迁移命令或全库备份/隔离恢复。失败或unknown保留原操作和日志，先定向查证，不重发原生产动作。

发布完成以真实完成回执及其内置版本/启动结果为准，不追加HTTP或业务综合验收。执行结果见下一节；原自动发布失败与有限恢复完成分别保留，不混写为全自动成功。

## 2026-10-21 正式发布完成

运行代码为main提交`2b6447f33d54c4aaf1b8b543ccd3707d73bf5584`。2026-10-21 11:07:20（上海）有限恢复协调器取得`deployed_and_ready`完成记录，普通权限入口实际退出0；后续本文件及能力审查收尾为纯文档提交，不变更运行制品。

| 组件 | 原生采用结果 |
| --- | --- |
| Worker | `20261021T005044Z-3e008fa5cc2bacfe`，manifest `5a321ddb1698bfbb6031b43a335435f917496f1bcd152e68f08e4fb78cc1e207` |
| Django | manifest `79d6d565bfe85b881d4c0099563b998da772f3b044316ccdeddcbe8179f9be98` |
| Pi Runner | source `1175d4b874ca4b7d52e8b64c527f6ff7c80978fc5b6a33837ad17b72c36067ce`，沿用已审Native 1.3.0镜像，原升级结果`upgraded/reconciled=true` |

PREPARED摘要`0e78724e3f5ffdb5aa8ff885d7e89fbaed54beba8554b392f231cba21d619d0a`。真实恢复SUCCESS位于`D:/codex-artifacts/pi-unified-chat-20261020/release-20261021/recovery-f638-tail/SUCCESS.json`，摘要`47277c1bfd4ddecd927c677737cc06c10fa29cb83ce2aa238648a461c9745520`；PUBLISHED-MAIN经原目录CAS写入并由原reader核对实际组件、来源及就绪结果。原Start返回`started`，原VerifyStartup返回`startupVerified=true`，同原发布尾部ready门禁通过；未追加功能验收。

发布期间原UpgradePi在新Linux单元切换后失败，维护保持；源机制与现场时间证据指向新活动账本WAL导致状态摘要拒绝，原inner exception未保全，不能声称有原错误栈。没有重放原publisher、Deploy或Upgrade apply，也没有编辑sealed source、清除原intent或checkpoint新账本。第一次有限恢复传输未能读取WSL不存在的Windows挂载路径，经marker/单元/原intent/journal证明确未进入start；原stderr缺失的边界如实保留。第二次使用内存脚本传入与双锁内原记录快照，单次start和签名就绪成功，原Reconcile完成Windows配置与result持久化，但外层日志解码失败，未取得wrapper成功退出。最终独立补完原只读ACL后置门禁，再仅消费尚未执行的WorkerApply、同维护ExitMaintenance、原Start和VerifyStartup；原STARTED/FAILED及所有恢复原件保留，未补造原SUCCESS或wrapper退出码。

四个本次单次发布/恢复任务在完成、无实例且定义摘要精确匹配后删除；未Stop任何生产进程。备份复用原已核副本，无新备份、migration、业务补跑、n8n采用或模型/消息实投。先前功能验收中的平台受理、Go限流、A7/A8能力边界继续以原报告为准，发布完成不扩大功能验收结论。
