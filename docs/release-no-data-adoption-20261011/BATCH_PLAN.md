# 首次采用精确批次范围

最终代码及不可变候选已准备、验证并封存V4：65fc5338321efc2d79168764f7b2227002333199d038409dc6dd7277acaed8d2，外置E:/codex-artifacts/release-no-data-adoption-20261011/ADOPTION_BATCH_V4.json。它是待批准的20操作可执行范围，不消费已有AB/C批准，尚未生产执行。精确双包/源码/收据见[CANDIDATES.md](CANDIDATES.md)。旧V2/V3只准备未批准，原文件、观察和失败保留；不换绑WAL或续期其时间戳。

## 固定顺序

| 阶段 | 必要动作 | 说明 |
| --- | --- | --- |
| 准备/准入 | 原 typed plan、双制品、测试与回退保护现场复验 | 最新 effective head、所有权、源码/制品/软件/ACL/身份；hash 不匹配拒绝 |
| 前保护 | 原 Backup、该精确点原 RestoreRehearsal | 首次机制采用 strict/full，真实执行仍须另批 |
| 排空/维护 | 原 EnterMaintenance，明确 KeepPostgres、原 StopForRelease | 原完整应用维护；保留 owner 与 drain，不擅自跳过必要后端停止 |
| 切换 | 原 Worker apply | 新 W/旧 D 的短暂受控状态；阶段准入据 WAL passed 判断 |
| 切换 | 原 DeployApp（精确 prepared id/receipt）、HardenAcl | 新 W/新 D；期间不安排 Backup/retention 或应用启动 |
| 恢复 | 原 ExitMaintenance、精确 StartWorker、必要 startup 验证 | 原启停、失败保持和已有配置恢复；普通 full Start 的原 Django 启动/迁移检查/权限及接收器启动行为须列入最终批准 |
| 验收 | 实际资源/任务功能、权限、全部已启用组件、启动绑定、自然守护 | 写/迁移验收按真实影响及闭包制定，不以全库自然变化导致全库等值比较失败 |
| 后保护 | 原 Backup、该精确点原 RestoreRehearsal | 新工具消费新 head，原保留与保护契约不变 |
| 收尾 | 最终必要验收、WAL/completion、owner 释放、证据与 Git/记忆交付 | 不把必要检查或文档隐去后台；必要验收与完整交付分别记录 |

通用 verifyBatch 的维护排序不能代替本表的跨组件次序检查。最终操作表必须实际复核 Worker apply < Django Deploy < 后 Backup，且中间无 retention。原 daily PAUSED 只作为当前事实重新核查，不修改调度；其他在途操作或 owner 仍正常阻断。

## 旧制品保护

实际 `app.previous` 元数据原 SHA `121d805fc7d01f234b14304ee1db901c82485b84920328082574622211b90888`，完整 3468 文件已按树摘要 `fa434f8ec1a49dbb478f8457eda601e8089a4bb7ffbfbf8b5562797b2fd3000b` 保全在 `D:/codex-isolated/release-no-data-adoption-20261011/app-previous-preserved`，原目录未移动或删除。当前有界进程/运行 metadata 引用查询未见实际路径使用；历史已归档批次的短引用只在回退说明，源码字符串不作为正在读取目录的证明。

真正执行原 DeployApp 会替换 `app.previous`。须在该动作前复验原包/保全摘要、所有当前 collector/候选/进程引用及所有权；有未明引用就拒绝该动作，不能以已复制为由删除仍被物理路径绑定的原目录。此规则属于最终前置检查及明确范围。

最终外置guard SHA04655a323af97453b7ae38670a6470e495226e85c337fb9b0a72684726a54edd。盘符限定完整路径/token实际realpath，不限同驱/短名；完整Execute/ExecutablePath/WorkingDirectory/metadata保留空格，只有CommandLine/Arguments分词。长缺失子路径核最近真实祖先，短别名和权限未知阻断。16个函数VM及主任务实际1160 state/run/prepare/deploy JSON、818进程、215任务快照通过，未来动作前仍必须重核。不是任意脚本、相对/变量/编码/UNC或全系统handle的通用证明，不凭模型“完备性”删除，不自动清理未知进程。

新历史中的 sourceBinding 不能删除或回写。故障后保持原门/WAL/owner，优先精确协调原 unknown；必要回退为兼容历史的新候选/新 successor，保留能读取新协议的控制工具及其匹配 Django 工具。旧 AB 包/旧 Django resolver 不能作为直接重启回退方案。临时恢复严格/full 组织策略不等于数据库恢复；真实恢复另批具体点与目标。

## 验证口径

迁移/备份要求不能用标签伪造已执行的演练。正在补齐的限定“迁移闭包”类别须绑定完整真实源差异、两份 Django manifest/全库存与实际 prepared receipt，机器复算无业务/迁移/依赖变化，旧协议保留原语义。它仅调整恰当的验证类别，不能免除本次四数据库阶段。没有完成的实际生产验收、实际 PG 恢复、真实不可用采样、配对收益均明确未测/未执行。
