# n8n 分类器发布反审与执行记录

状态：反审未发现阻断，线上只读备份与差异核对已完成；UI 连接不可用，尚未写入或发布。

## 范围与授权

- 用户明确要求反审并执行 `codex-提示词-n8n发布分类器修复-20261105.md`。
- 冻结源提交：`e3f2b1b8373830bfca26c5b5b25db7fee7f00f9a`，开始时本地 main 与 origin/main 均一致。
- 目标：`TeruisiHourlyRetry2026`，只采用仓库 artifact 中两个 Code 节点的 `parameters.jsCode`，之后在 n8n UI 发布。
- 不涉及 Worker/Django 制品、发布器、n8n 重启、业务执行、真实失败注入或 helper 写接口。

## 反审结果

线上快照与提示词前提一致：16 个节点、节点名集合、连线、settings、节点 id/position 均与 artifact 一致；只有指定的两个 jsCode 不同。活动历史中的 nodes/connections 也与当前定义一致。

源码差异仅为终局分类规则收口及人工提醒参数逐条筛选，与提示词描述相符。提醒参数节点仍按批接收输入，在代码中逐条校验；并非将 n8n 节点执行模式改成逐条。全部条目无效时仍抛原错误码，混合批次保留合法条目并记录拒绝索引。无须改写仓库代码。这里只做静态核对和编译，不作业务功能验收。

## 版本与摘要

| 字段 | 更新前 | 收尾只读回查 |
| --- | --- | --- |
| versionId | `62d4ae60-3780-4278-92f6-052b9e0cbdca` | 相同，未更新 |
| activeVersionId | `62d4ae60-3780-4278-92f6-052b9e0cbdca` | 相同，未发布 |
| active | `1` | `1` |

| 节点 | 线上字符数 | artifact 字符数 | artifact jsCode SHA-256 |
| --- | ---: | ---: | --- |
| 仅保留可安全自动重试的失败 | 7008 | 7097 | `6d5bfead65cd7bdbeb4686079b49dc40cceab19febca3a5d6e9a9f1622ce0d99` |
| 准备人工提醒参数 | 1676 | 2126 | `7606868efdf2bca54ea673b94758b9f73530903e4d69d8ced4d73d88c61a7d42` |

以上是目标 artifact 的实测摘要，不是写入后摘要。两个 jsCode 均通过 JavaScript AsyncFunction 仅编译检查，未执行代码。

## 备份与证据

- 原始定义备份：[workflow-before.private.json](workflow-before.private.json)，包含 nodes/connections/settings/active/versionId/activeVersionId。该文件含工作流内部端点，按本目录 `.gitignore` 留在本地，不提交或推送。
- 备份 SHA-256：`b469fd9c1bebcfb5d563a83e869682b27cc23e4069817d835a4298f3b92d5855`。
- [初始核对](preflight.json)、[语法检查](syntax-check.json)、[其他工作流状态及定义摘要](other-workflows-before.json)、[收尾回查](closeout.json)。
- SQLite 仅以 `mode=ro`、`query_only=ON`、短只读事务读取 workflow_entity/workflow_history 指定元数据字段；未读取执行数据或凭据表。
- 收尾确认目标定义、版本与 active 未变；其他 23 条工作流的定义摘要、版本与 active 均与备份时相同。

## 阻断与续接

浏览器访问主机不可用；Windows Computer Use 返回 `native pipe is unavailable` / `os error 2`。轻量调用重试、重置运行时并重新初始化后仍失败。无法完成提示词要求的“n8n UI 点发布”，因此未先行导入草稿，也未改用 CLI 发布、数据库写入或重启绕过。

需要恢复当前会话的浏览器或 Windows UI 连接。连接恢复后，先重新核验 main artifact 与线上当前定义；原前提仍成立时，以线上定义为底只替换这两个 jsCode，精确校验摘要，再从 UI 发布并回读当前/活动版本和全部不变项。生效验证留待下一次自然失败，禁止主动触发业务。
