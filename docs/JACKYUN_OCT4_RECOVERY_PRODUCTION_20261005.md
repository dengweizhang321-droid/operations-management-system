# 吉客云补齐至 10 月 4 日：正式采用与原库存任务恢复

2026-10-05，用户明确要求“补充4号数据”，并批准本次 Worker/helper 候选采用与继续恢复原 execution 6165。新完整手动 execution **6225** 成功，销售覆盖 **2026-08-21 至 2026-10-04**，独立权威 API 回查 cutoffDate=2026-10-04、throughYesterday=true、revision `45:43`。库存及库龄记录实际采集日 **2026-10-05**，不作为 10 月 4 日历史余额。

## 原故障与最小兼容修复

6165 于上海 2026-10-05 04:17:51.950–04:18:36.434 在 B 报 `fetch failed`。唯一原库存任务 `sys-115251725` 已创建并绑定，接口源行数 26,288；文件未落地，本轮没有 handoff、验证或导入效果。没有删除原 active、重置 controller 或重新提交库存 POST。

原恢复校验器仅接受旧版“触发器 → 领取 helper → 判断 → A → B”。本次源码 `c2adc4cac8a5d75ec5aa62135b1cdd1847c958eb` / [PR #59](https://github.com/dengweizhang321-droid/operations-management-system/pull/59)，已合 main `b1a62741d1fa2534bbbb401251db2e5d5ba7fcc5`，增加已发布版唯一“固定原执行计划时间”节点的精确顺序兼容。全部实际节点仍作为证据保存；缺领取、锚点重复/错位、未知节点或进入 C/D/E 仍拒绝。原日期、唯一任务/附件、空目录、无业务效果、30 分钟及单消费者门槛保持。

在原已采用源码 `a7804b9c` 上仅追加三个文件，组合源码 `7ced503b5745bf275d2039f1c35d803f520fbca2`：

- `docs/JACKYUN_SESSION_API_EXPORT.md`
- `lib/jackyun/api-execution-resume.ts`
- `tests/jackyun-api-execution-resume.test.ts`

采用前 283 项吉客云/销售测试、相关 lint、后端边界、生产构建及 helper bundle/语法检查通过；真实 6165 原任务只读 plan 通过。源码合并、候选准备与实际采用分别记录，未将准备成功冒充正式恢复。

## 实际采用与服务验证

- Worker/helper release `20261004T203845Z-d5c7953e916f69ec`，manifest `10c9153e2b0ccaf4effa32134442b0487b11e54027fac8e5e858cd6f1e5c6b5a`。
- 批准 rotation plan `acd4adfd6be5f22ab5e4b2ba7c5e4c257936dff8052f33f1d5c0f43b6f7b6f89`，successor `49d83039d2eeb912534255221d990a69ffba1db2d56c3a9f9e523ff5218c310a`，consumption `1db2dcc66f684e948e5d72c89ac04ddaf4609bf27c327924b8c9d3027770d2d5`。
- 原 Worker-only Stop / apply / 唯一 Start 均取得实际控制器 exit 0。本次 Start 先等待直接控制器 17232 退出并采集真实退出码，再有界等待标准流复制；`outputCopyCompleted=false` 表示持续业务子进程仍持有流，不能据此将控制器判为在途。未杀业务进程，未再次启动或重启服务。
- 独立总控 Running / Ready / exact_release，12 组件就绪，启动绑定 verified；首页 200，17 份实际页面资源与候选字节相同。
- Django manifest 保持 `e4f48e98178a77fac41ac269b40076f2c30bf449c8c5562e28a0a056f4ba22e1` / 139；26 个原后端、PostgreSQL、n8n 监听进程的 PID 与 UTC 创建时间保持。无 Django 重部署、迁移、派生缓存回填、扩权、预算或超时调整；n8n 未重启或改定义。
- 原看门狗自然计划 09:18、09:23 两个独立已完成样本返回 0，健康快照符合当前 release；运行中 267009 样本保留，不记为已完成成功。

## 原任务续跑与完整业务结果

实际采用后重新只读核验原任务，按原工具 create-only 发布许可，由原 n8n 工作流手动入口单次领取。6225 的 logical run 仍为 `n8n-export-first-6165`，复用唯一原库存任务及附件摘要；没有重发库存导出 POST。后续四表按原顺序导出，五表全部校验后依次导入并在 E 独立回查。

新 execution 6225，mode=manual，上海 **2026-10-05 08:59:55.318–09:04:05.199**，耗时 249.881 秒。手动入口、计划锚点、共享协调及 A/B/C/D/E 九个节点全部 success。工作流 ID `J8kY2mQ5vR7sT4pN`、active=true、current/published `0821abae-9259-4647-b686-132db08c0053`、节点/连线/设置/空 pinData 保持；定义摘要 `fcc023650bb97f3ee69ecb6990d84d9f630e720556dafd0526d9d3508b7a568e` 相同。原 6165 仍为 error，retrySuccessId=null；没有改写历史。

| 数据集 | 独立有效行 | 来源提示 | 本次行为 |
| --- | ---: | ---: | --- |
| 货品 | 8,530 | 0 | 新文件及批次 |
| 分仓库存 | 24,281 | 6 | 复用原任务下载，2026-10-05 快照 |
| 库龄 | 5,663 | 0 | 新文件及 2026-10-05 快照 |
| 销售 | 38,236 | 106 | 45 天窗口，截止 2026-10-04 |
| 组合装 | 4,454 | 2 | 内容相同，duplicate 复用批次 |

来源提示如实保留，未将恢复成功记为成本或来源数据问题已解决。独立本机公开 Django/PostgreSQL 只读 API 再验精确五批次、实际事实归属、日期、文件/内容摘要及本轮库存成本源；导入 manifest 核验前后相同，helper 空闲。operations MCP 不可用，未读取旧 D1。

精确批次、输出摘要及验证结果见 [脱敏机器证据](evidence/jackyun-oct4-recovery-production-20261005.json)。完整本机证据分存于：

- `D:\codex-artifacts\jackyun-20261004-backfill-20261005`：原失败、真实只读 plan、修复检查、独立五表回查和 6225 UI 成功截图。
- `D:\codex-artifacts\jackyun-anchor-adoption-20261005`：采用、服务/进程/资产、许可、前后备份与独立恢复。

## 备份与交接

前备份 `daily-20261005T002432Z-76e4218533e9`，manifest `5481f19ad65793abab7abbc3c63eb67bee7d8b8ca3ccab5f9cf1f69343bf64f9`。E 盘 Verify 通过，独立端口 55697 恢复 `2fe01d57e904` 完成；原始与恢复内容摘要 `0803a253bf7943cae1b24577f1c51eb2a42d7155816194bd938003fe58e8f06d` 相同，profileRestoreVerified=true，独立数据清理通过。

后备份 `daily-20261005T010737Z-273aeac11604`，manifest `39491cb730bfbb172281a39123a81c21fe612d762bfa441dd71c7989d4d90086`，内容 `a8fc3ba4977681036b8059c974ce90a06465b0c65ed12d4422445e07b4406984`。E 三文件归档及 Verify 通过；独立端口 55698 恢复 `7b236da659f4` 完成，原始与恢复内容相同，profileRestoreVerified=true，独立环境清理通过。全部备份/恢复操作已到终态，未决操作零。

原三份/两保护保留策略保持，后备份淘汰本轮未保护前备份；前备份独立恢复证据保留，但其目录已不在，不能再作为现存恢复点。当前三份为本次后备份及原 9 月 28 日、29 日两保护点。

本次仅覆盖用户批准的候选采用与原 6165 恢复、销售补齐至 10 月 4 日；不授予未来维护、新日期补跑、未知提交重放、一般 503 重试或通用自动清理授权。[5478 续导记录](JACKYUN_5478_PRODUCTION_20261005.md) 保留为此前独立阶段，不能与本次新日期恢复混淆。
