# 组合批次首次执行：切换前安全取消

本记录不是上线成功声明。用户当前对话确认“组合上线”后执行本批，当前人类turn的startedAt=1791481024，即UTC2026-10-08 17:37:04，秒级分辨率。范围为发布提速＋客服四店手动导入修复；原批准批次为9a7bb676efb1c76d4d3daad3c1533e3690d000fa8b47a58946beb65afed58bd9。

官方批次入口持有原发布互斥并复验33个外部工具／证据绑定。初始准入216.001秒，首次操作边界38.178秒，原候选复用175.632秒通过，未重新构建。前备份边界42.842秒通过，17:46:04.629进入op-backup-pre；12.427秒后无可确认结果，原WAL保留unknown，立即停止后续步骤，没有维护或切换。

独立只读检查确认：原installed脚本及系统PS5字节仍匹配，BOM均存在，Backup/Execute参数没有被库加载覆盖；原备份audit、恢复点、retention没有当轮新增，原Status没有unresolved Backup，未发现pg_dump/restore或备份活进程。通过相同Node原runner仅执行Status，复现PS5继承PS7模块路径导致Microsoft.PowerShell.Security Get-Acl加载失败；该ACL admission先于StartMaintenanceRun和Backup body。由此完成精确零dump／归档／服务／生产数据效果证明。

按原reconcileOperation将该步独立闭合为failed，未重放；随后按独立无drain／switch／business效果证明调用cancelUnswitchedBatch。active由原工具释放，全部原始journal、失败、核查和取消证据保留。生产仍为Worker20261008T103219Z-f5d9b00e432df6c0及Django121d前驱，数据库恢复点仍原三点两保护，日备份调度仍PAUSED。

证据根：E:/codex-artifacts/release-customer-combined-20261009/production。原批准时间及取消前所有校验、等待和故障核查计入原真实区间；将来修复候选上线时仍保留这次记录，不把首次明确上线时间重置为仅成功重试的开始。

修复在独立开发树完成，见[PS5子环境与中文传输修复](../release-customer-ps5-fix-20261009/REPORT.md)。原9a7批次已取消，不能作为新源码候选继续执行。正式前后备份／恢复、切换及上线后验收尚未执行。
