# n8n 分类器修复生产发布记录

2026-11-06（Asia/Shanghai），按用户指定提示词执行，仅更新并发布 `TeruisiHourlyRetry2026`。仓库来源为 `e3f2b1b8373830bfca26c5b5b25db7fee7f00f9a`，未修改应用源码、Worker/Django 制品或发布器。

## 发布结果

| 字段 | 更新前 | 更新后 |
| --- | --- | --- |
| versionId | 62d4ae60-3780-4278-92f6-052b9e0cbdca | dbe5c5ea-b80e-422e-b008-cd7c4c7dfa01 |
| activeVersionId | 62d4ae60-3780-4278-92f6-052b9e0cbdca | dbe5c5ea-b80e-422e-b008-cd7c4c7dfa01 |
| active | 1 | 1 |

已在 n8n UI 点击 Publish，并观察到 Workflow published 提示。发布后的数据库只读核验于北京时间 00:50:13 完成；当前定义与该已发布历史版本的 nodes/connections 相同。

## 精确差异核验

- 节点数 16，节点名集合、节点 ID、position、其余 14 个节点的完整定义、全部连线、完整 settings（含 callerPolicy、executionOrder）均与发布前一致。
- 仅 `仅保留可安全自动重试的失败` 和 `准备人工提醒参数` 的 jsCode 采用仓库原值。
- 分类器实测 SHA-256：`6d5bfead65cd7bdbeb4686079b49dc40cceab19febca3a5d6e9a9f1622ce0d99`。
- 提醒参数实测 SHA-256：`7606868efdf2bca54ea673b94758b9f73530903e4d69d8ced4d73d88c61a7d42`。
- 其余 23 条工作流逐条比较 nodes/connections/settings/active/versionId/activeVersionId/name/id 均相同，包括正式目标、两个未激活的京东兼容模板及 errorWorkflow 绑定。

## 执行中的处理

浏览器自动翻译会改写代码展示文本，首次复制未通过长度核对，未保存该翻译内容。改用只读 textarea 的 value 传递仓库原文后，两份代码哈希均匹配。编辑器保存草稿仍会自动补参数默认值、生成 Wait webhookId 并对齐 position，因此未发布该草稿。

随后从原始备份构造仅替换两处 jsCode 的精确导入文件，经原生 `import:workflow` 导入并再次核对完整定义，再从 n8n UI 发布。原生导入会暂时取消目标的发布/激活状态，最终 UI 发布已恢复 active=1；未操作其他工作流。

CLI 导入曾提示本 CLI 环境未识别 executeCommand；导入成功，生产 UI 发布成功。期间服务曾返回 Database is not ready，日志随后记录 Database connection recovered，readiness 回到 200；没有重启或修改 n8n 服务配置。未把这一瞬态现象归因为已确认的具体代码缺陷。

没有人工触发失败、执行节点/工作流、下载、导入业务数据、调用 helper 写接口、发送真实通知、重启服务或修改 Worker/Django。业务生效检测留给下一次自然失败及用户自行验收。

## 证据与回退依据

- [原始定义备份](workflow-before.json)：更新前 nodes/connections/settings/active/versionId/activeVersionId。
- [精确导入定义](workflow-exact-import.json)：原始定义仅替换两处 jsCode。
- [发布后定义](workflow-after.json)。
- [机器核验结果](verification.json)。
- [UI 发布成功截图](published.jpg)。

`all-workflows-before.json` 作为本机只读比较依据保留，未纳入远端提交；不应为了复核本次发布反复读取完整业务 execution。旧已发布版本仍是回退依据；本次未执行回退。

本报告及证据提交到独立 codex 分支，不把本次 n8n 发布授权扩展成 main 文档合并授权。
