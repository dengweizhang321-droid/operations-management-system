# 每小时安全重试分类器生产发布记录（2026-11-17）

按用户 2026-11-17 授权（合并、更新主检出、发布 n8n 三步）执行，仅更新并发布 `TeruisiHourlyRetry2026`。仓库来源为 main `2321b923`（合并 `codex/retry-repeat-stop-20261117`）；同时首次把 `cf05e971` 的按原因分条提醒带上 n8n。未修改 Worker/Django 制品、发布器或其他工作流。

## 前置条件

| 项 | 结果 |
| --- | --- |
| 主检出 `D:\运营管理系统` | 由 `f29384af` 快进到 `2321b923`（`--ff-only`），用户未提交的两处 `.claude/` 改动保留；Worker guard 钉住的 12 个仓库根文件在区间内无变化，计划任务不从主检出运行变化的脚本 |
| 主检出 ps1 含新原因码 | 是；`n8n-manual-action-alert.ps1` 预览模式（不带 `-Execute`，未发送）以 `manual_action_content_invalid` 生成文案，`status=local_preview`，exit=0 |
| n8n 数据库备份 | `D:/codex-artifacts/backups/n8n-before-retry-publish-20261117.sqlite`（sqlite backup API，只读源） |
| 发布前定义 | [workflow-before.json](workflow-before.json)：已发布版本与草稿的 nodes/connections、settings、版本号 |
| 已发布版本与仓库定义比对 | 除 3 个目标节点的 `jsCode` 外，16 个节点、全部连线、settings 与仓库 JSON 完全相同 |

## 发布结果

| 字段 | 更新前 | 更新后 |
| --- | --- | --- |
| versionId | dbe5c5ea-b80e-422e-b008-cd7c4c7dfa01 | c77f472b-3ba7-4adb-a87c-1fef1d70eba5 |
| activeVersionId | dbe5c5ea-b80e-422e-b008-cd7c4c7dfa01 | c77f472b-3ba7-4adb-a87c-1fef1d70eba5 |
| active | 1 | 1 |

替换的 3 个节点 `jsCode`（SHA-256 前 16 位，均与仓库 `2321b923` 字节一致）：

| 节点 | 更新前 | 更新后 |
| --- | --- | --- |
| 仅保留可安全自动重试的失败 | 6d5bfead65cd… | 6d1555d2042798fc |
| 收集被丢弃的终局失败 | 302690739f69… | 72353baffed9d336 |
| 准备人工提醒参数 | 7606868efdf2… | c42f28aaebd0be68 |

发布后只读核验：已发布版本 nodes/connections 与 [精确导入定义](workflow-exact-import.json) 完全相同；其余 23 条工作流的 id、name、active、versionId、activeVersionId、settings、nodes、connections 与备份逐项相同。

## 发布方式与差异说明

与 11-06 不同，本次没有走 n8n UI 的 Publish 按钮，改用原生 CLI：

1. `n8n import:workflow --input=workflow-exact-import.json`（10:50:35 起）：导入新版本并按设计暂时取消发布。
2. `n8n publish:workflow --id=TeruisiHourlyRetry2026`（10:51:13 完成）：把 activeVersionId 指向新版本。

CLI 提示「n8n 运行中需重启才生效」针对的是需要在内存中注册触发器的工作流。错误工作流不受影响：n8n 2.32.7 在每次失败时从数据库重新读取错误工作流的已发布版本（`dist/workflows/workflow-execution.service.js:259-284`，`N8N_USE_WORKFLOW_PUBLICATION_SERVICE` 默认 false 时走 `activeVersion` 分支），因此无需重启 n8n。

已知差异：

- CLI `publishVersion` 只更新 `active/activeVersionId`，不像 UI 发布那样写 `workflow_publish_history` 的 activated 事件；导入步骤写了一条 deactivated。按发布历史判活的分析需以 `active=1 且 activeVersionId 非空` 为准。
- 导入与发布之间约 38 秒内，若有目标工作流失败，其错误工作流调用会因没有已发布版本而被 n8n 丢弃。窗口内只有 `JdPromotionCutMeat2026` 11725 在运行。
- 导入时出现 `Unrecognized node type: n8n-nodes-base.executeCommand`，与 11-06 相同，是 CLI 环境未加载该节点所致，不影响导入。
- 已处于 Wait 的旧错误执行恢复后仍按其保存时的旧定义派发一次，之后的失败由新版本分类。

## 首次自然运行

发布后第一次自然失败即走通新链路（只读 n8n 记录核验）：

- 丽力 webhook 重试 execution `11726`（由旧版本错误执行派发，10:50 起等待 helper，10:55 恢复）在 P 节点以「天猫商品报表计划维度包含非商品主体，拒绝汇总」失败，10:55:54 结束。
- 新版本错误执行 `11727`（10:55:54–10:56:01）判为终局，没有进入 60 分钟等待；提醒码 `manual_action_content_invalid`，钉钉发送结果 `{"executed":true,"status":"sent"}`，末端 stopAndError 文案为 `manual_action_content_invalid`（不再是 `dispatch result unknown…`）。
- 用户本人收到的钉钉单聊原文：「原因：已下载文件或汇总内容未通过确定性校验，重试只会得到相同结果」，原逻辑与失败 execution 均为 11726。

丽力的重试链至此终止；数据缺口需修复 `prepareTmallPromotionRows` 对「店铺直达」非商品主体行的处理后，由下一次定时从 downloading 阶段用缓存文件续接。

## 回退依据

回退到 `dbe5c5ea`：`n8n publish:workflow --id=TeruisiHourlyRetry2026 --versionId=dbe5c5ea-b80e-422e-b008-cd7c4c7dfa01`（版本仍在 workflow_history 中），或从数据库备份恢复。本次未执行回退。
