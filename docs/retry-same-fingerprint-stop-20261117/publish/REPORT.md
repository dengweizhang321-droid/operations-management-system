# 同指纹止损 n8n 生产发布记录（2026-11-17）

用户在本会话授权「快进并发布 n8n」后执行。只更新并发布 `TeruisiHourlyRetry2026`，其他工作流、Worker/Django 制品和发布器都没有改动。helper 端点已在此前随 main `40dad64e` 上线（21:12，`deployed_and_ready`，由另一会话在用户授权下发布）。

## 前置条件

| 项 | 结果 |
| --- | --- |
| 主检出 `D:\运营管理系统` | `--ff-only` 从 `e3ecd40b` 快进到 `40dad64e`。区间内没有仓库根文件变化；用户未提交的 `.claude/hooks/guard_codex_wrapper.py`、`.claude/scripts/codex_teammate.py` 保留，未跟踪文件与新路径无冲突 |
| 主检出 ps1 认识新告警码 | 预览模式（不带 `-Execute`，未发送）对 `manual_action_repeated_failure` 输出正确文案，`status=local_preview`，exit=0 |
| n8n 数据库备份 | `D:/codex-artifacts/backups/n8n-before-retry-streak-publish-20261117.sqlite`（node:sqlite backup API，只读源，8105 页，`integrity_check=ok`） |
| 发布前定义 | [workflow-before.json](workflow-before.json)：版本 `c77f472b`，草稿与已发布版本一致 |
| 精确导入定义 | [workflow-exact-import.json](workflow-exact-import.json)：以已发布版本为底，只替换「读取原执行计划时间」「准备人工提醒参数」两个节点的 `jsCode`；生成时断言其余节点、连线与仓库 `40dad64e` 完全一致，替换后全部节点等于仓库定义 |

## 发布

1. `n8n import:workflow --input=<exact-import.json>`：21:28:37 起，21:29:06 完成。
2. `n8n publish:workflow --id=TeruisiHourlyRetry2026`：21:29:19 完成。不需要重启 n8n（错误工作流每次失败时从库里读已发布版本，见 [11-17 终局正则发布记录](../../retry-repeat-stop-20261117/publish/REPORT.md#发布方式与差异说明)）。

导入时的 `Unrecognized node type: n8n-nodes-base.executeCommand` 与此前两次相同，是 CLI 环境未加载该节点所致，不影响导入。

| 字段 | 更新前 | 更新后 |
| --- | --- | --- |
| versionId | c77f472b-3ba7-4adb-a87c-1fef1d70eba5 | c04cf65f-2f7a-4bce-9c8c-f93d5a59aa8e |
| activeVersionId | c77f472b-3ba7-4adb-a87c-1fef1d70eba5 | c04cf65f-2f7a-4bce-9c8c-f93d5a59aa8e |
| active | 1 | 1 |

替换后的 `jsCode`（SHA-256 前 16 位）：「读取原执行计划时间」`42c0e6370fe6c06b`，「准备人工提醒参数」`2dcdfad039dc2f55`。

## 发布后只读核验

- 已发布版本的 nodes、connections、settings 与精确导入定义完全相同。
- 其余 23 条工作流的 id、name、active、versionId、activeVersionId、settings、nodes、connections 与备份逐项相同。
- 导入到发布之间（约 42 秒）没有任何目标工作流失败，因此没有错误工作流调用被丢弃。
- 生产 helper 端点实测：丽力 11729 → `consecutive=4, stop=true`；拓丰 11731 → `consecutive=1, stop=false`（前一次 11707 是「千牛登录状态加载超时」，指纹不同，计数中断）。

这两条现有失败都已被终局正则判为人工处理，不会再进入重试分支，所以这次发布不会立即触发新的提醒。止损只对以后正则没覆盖、且连续 4 次同指纹的失败生效。已在等待中的旧错误执行恢复后按其保存时的旧定义派发一次。

## 回退

`n8n publish:workflow --id=TeruisiHourlyRetry2026 --versionId=c77f472b-3ba7-4adb-a87c-1fef1d70eba5`（版本仍在 workflow_history 中），或从上面的数据库备份恢复。helper 端点不用回退，没有调用方时它不起作用。本次未执行回退。
