# 吉客云自动恢复与重试：正式上线记录

2026-10-14（Asia/Shanghai）。**生产组件已经采用，维护已退出，服务已恢复。** 用户最新要求“无需验收收尾，直接发布上线”；后续验收进程已停止，不追加验收、不重复部署。此记录不宣称原批次全部验收通过或真实五表业务恢复成功。

## 已上线范围

| 组件 | 实际采用 |
| --- | --- |
| Worker / helper / 前端 | `20261013T145450Z-fe391dce49a258cf`，manifest `51aefd56a68ae84df34e606db2c508092511b1ae24d118fd50cca33333016c6d` |
| Django | prepare `dceea1ea35c541a586c3163afac08047`，manifest `4fb134f17cd22018045b87a2852ea874d5d9f3e3c36900a3e8750dc0e572e321`；保留 OpenCode 新发布的四个 AI 文件 |
| 数据库 | 仅 `erp_reference.0003_jackyun_upload_audit_binding`、`sales.0011_jackyun_upload_audit_binding`；迁移目录 140 → 142，原数据行摘要保持一致，原有限审计安装及 finalize 均通过 |
| 吉客云正式 n8n | 原 ID `J8kY2mQ5vR7sT4pN`，已发布版本 `80ea7e87-679f-42b6-a9ab-c990c92ecf5d`，定义摘要 `a9f37ecb2a312bcadd56756f509ab58e42cd8cc01639d4a7954b9c90fe24c307` |
| 共享自动重试 n8n | 原 ID `TeruisiHourlyRetry2026`，已发布版本 `6c6482e0-2937-4117-9fbc-e31a716354e7`，定义摘要 `9151a99fdb1ecf0e8150ae5f0ef2d61e441aff4c9c58aba9914b47f0acb0df76` |

不可变来源为 `D:\codex-isolated\jackyun-audit-adoption-20261013\source-user-directed-final`，快照表示提交 `178df20ec32298fe84ec503654b1380d0c36f1f4`；采用工具源码已于 `4807ac54` 合入并推送 main。后来 main 的其他提交不自动等于本次实际生产内容。原 Worker 前驱为 `20261013T091815Z-878966319497c4bd`；Django 前驱 manifest 为 `08695d0d67c45970a52032421650e859f3926d739aa2993ce896fdd7dc803b92`。

n8n 使用安装版本的官方 `import:workflow` / `publish:workflow`，在原普通用户服务任务内停止及恢复；没有直接写 SQLite。原两条流程 ID、名称、旧历史、调度和时区保持，其他 20 条流程定义保持。浏览器文件选择失败，未发生浏览器导入或保存，不宣称完成页面验收。

## 已有结果及按用户指令停止的范围

原批次 `jackyun-direct-d3c0172c6400`，SHA `639f410937aae7aa05d6a2418bf4050f6ee21a7a91ca03df806860916efa6d7f`。原维护 ID `cde028eac067f6d17536710c21e5940f`，审计迁移 operation `59c901fae2b94400b197578e7bac7638`。实际切换、后端部署、ACL、迁移安装/finalize、退出维护、完整 Start 均有原 passed 回执。完整 Start 于 00:40 完成，原 VerifyStartup 于 01:18:06 通过。停止验收后的只读监听快照仍显示 3000、5791、5678 正常监听。

此前已经完成权限、迁移、业务接口契约及正式 n8n 发布图核对。业务接口核对只证明当前接口状态，不等于五表导入成功。资源检查原失败完整保留：生成的清单把 `.assetsignore`、`_headers` 两个部署控制文件当作公开下载文件。独立核对全部 76 个真实公开资源的 HTTP 与精确摘要、私有控制文件行为及静态缓存规则后，使用原 reconcile API 记录实际资源目标通过；没有把原失败脚本改写为成功。

用户停止指令后，01:18:39 仅终止本任务只读调用器 PID 2556；exec session 4040 已退出。未执行剩余 `aggregatestatus`、`check-natural-watchdog`，没有新的服务启停、切换、验收或业务补跑。停止时已开始的原操作全部有终态，没有未知生产动作。

**原 WAL 尚未写入 `closeout/completed`；发布批次 `active.json` 保留，不删除、不伪造验收通过。** 它是发布协调元数据，不是服务维护或吉客云业务运行 active。今后另一批发布前须明确处理本次用户取消的剩余收尾范围；不得直接运行旧 execute 调用器、重放已完成的安装动作或删除协调标识。本次仅记录已发布事实，不为了释放标识新增一套绕过原流程的代码。

## 真实业务状态

00:10 自然调度的旧版本执行 `8841` 在等待后进入 A，于 00:42:42 失败：`旧任务登录验证或身份异常，需要人工处理后手动完整运行；不自动重试。` 没有进入 B/C/D/E，不能认定完成五表恢复。此前 `8548` 的身份异常失败和日期归属保持。

需处理原登录或身份障碍，再通过新完整重试入口核验并接续；无需额外人工闭合旧任务。此发布没有手工触发真实补跑，也不承诺重试必然成功。库存和库龄不得把新的实际采集日冒充历史快照。

## 证据和授权边界

证据目录：`D:\codex-artifacts\jackyun-migration-adoption-20261013\direct-publication-final`；原 WAL：`D:\teruisi-runtime\teruisi-worker-sales\state\release-batches\jackyun-direct-d3c0172c6400`。重点文件为 `approved-batch.json`、`authorization-source.json`、`n8n-cli-publication-result.json`、`resources-reconciliation-proof.json`、`scheduled-error-detail-8841.json`、`user-stopped-acceptance.json`。

本次按明确指令没有新增备份、恢复演练或发布演练，没有人工真实业务补跑或手工外发。已采用的身份、互斥、审计、摘要、有限迁移和未知效果保护保持。原日志、历史失败、旧候选及开发目录中未提交的测试材料保留。
