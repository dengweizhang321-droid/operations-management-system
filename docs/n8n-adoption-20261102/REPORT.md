# n8n 告警与重试接线采用记录（2026-11-02）

用户明确授权“采用 n8n 改动”。23:18（上海）完成回读：共享错误工作流、京东客服四条、京东物流共六条已激活，五个新增重试 Webhook 已注册。未触发业务补跑或测试消息。

## 实际采用范围

| 工作流 | 发布版本 | 保留的线上时点 |
| --- | --- | --- |
| TeruisiHourlyRetry2026 | 1f6dc4ea-9587-44b6-9759-faf0dbeb4b95 | Error Trigger，无定时 |
| JdCustomerService2026 | b52fae37-3858-499a-a4ab-168d4b52cd2f | 09:05 |
| JdCustomerServiceCutMeat2026 | ec716221-d0fd-4d98-a023-ef7ed137bd1d | 10:05 |
| JdCustomerServiceChudian2026 | 49a8e375-182b-42aa-980e-a86cc05d3521 | 09:25 |
| JdCustomerServiceDishwasher2026 | 3d879d29-f327-4ac5-9342-ed31afa86cc9 | 09:45 |
| JdLogisticsDaily2026 | 60e607da-5401-4bde-9ae0-bed5d53de81c | 08:50 |

五条目标从各自原已发布图调用既有 `attachHourlyRetryTarget`，只增加专用 POST Webhook、到原领取 helper 的连线及 errorWorkflow/策略元数据；原业务节点、调度、staticData、pinData、所有者保持。共享错误流程采用已审单聊发送入口与18个登记目标，另修正下述采用阻断。

四条客服原草稿的中午时点和人工修改继续保留，只追加相同重试接线；发布时明确指向保留上午时点的候选历史版本。因此这四条的 `versionId != activeVersionId` 是有意保留草稿，不是采用失败。18条非目标工作流定义保持，24条所有者关系与原28份版本历史保持；未启用其他停用店铺或兼容副本。

## 采用前发现并修正的实际阻断

旧已发布分类器使用 Code 双输出形态；当前仓库候选已改为单层输出，但仍把分类器单个输出同时连接 Wait 与人工告警。已安装 n8n 2.32.7 的 Code 节点只有单个输出，Wait 挂起整次 execution；当前候选的终局 sentinel 会进入 Wait，恢复后又可能访问缺失的 retryPolicy，导致人工提醒被延迟或丢失。

本分支只作必要修正：终局信息成为独立 sentinel，新增一个原生 IF，按 `!!retryPolicy && noRetryTarget !== true` 分流；可重试记录进入原一小时 Wait，终局记录进入原告警收集节点。共享图从15节点变为16节点，原15节点除分类器末尾构造外不变。该即时路由结论限定原 Error Trigger 单失败场景，不承诺混合批量故障的独立即时发送。

修正源码为 `tools/n8n-hourly-retry-policy.mjs` 及对应生成JSON，位于独立分支 `codex/n8n-adoption-routing-20261102`，基于 `dd4bf1a2`；本轮已将修正后的具体 n8n 定义采用，源码分支尚待另行合入 main，避免以后从旧main生成器覆盖回错误接线。本轮没有更新或发布应用包。

## 工具、保全与受控重载

浏览器控制工具返回 native pipe/browser host 不可用。本次使用本机已安装官方 CLI，不模拟浏览器登录或提取 Cookie。已读取安装版本的实际 import/publish 实现；[官方CLI说明](https://docs.n8n.io/deploy/host-n8n/configure-n8n/use-the-command-line.md)作为补充，实际采用以本机2.32.7行为为准。

1. 用 SQLite backup API 只读保全原库与定义；材料置于 `D:/teruisi-runtime/n8n-adoption-20261102/`，目录仅当前用户、SYSTEM、Administrators可访问。完整数据库和原始图不进入Git。
2. 停止前再次确认零 new/running/waiting execution、helper空闲、目标版本与快照未变，核验原计划任务/监听进程身份。仅停止 `TERUISI-n8n-Service`，5678释放后再导入。
3. 官方 `import:workflow` 导入六份发布候选，逐条回读并记录新versionId；再导入四份保留草稿。随后对六个原ID逐个 `publish:workflow --versionId=<候选版本>`，不新建工作流，不重置共享关系。
4. 从原 Limited 用户计划任务恢复 n8n。启动日志确认六目标激活，5678只监听127.0.0.1，readiness返回200。没有改变任务Action、账号、环境策略或其他服务。

本机CLI的catch可能记录错误后仍退出0，因此每步以真实实体/history图和指针回读判断，未只看exit code。该版本CLI不会写UI式发布事件，不能用没有新增 `workflow_publish_history` 事件否定已生效的指针、历史图及启动激活；没有手工修改SQLite。

采用前PS5命令发现已确认同用户可解析Microsoft Store PowerShell7入口，dws vendor文件和同版本通知依赖存在。未执行身份查询或发送预览；真正通知仍由既有动态本人/机器人核验决定是否允许发送，未知发送账本不重放。

## 独立审查与核验结果

分别请求 GPT-6.1-Sol High 和 Astra High 的独立上下文审查；两者均直接核对本机CLI实现及候选差异，最终无剩余采用阻断。工具接受所请求型号/强度，未另行独立证明底层实际型号。

- Sol发现Wait分流问题并复核修正；Astra独立确认新IF及具体采用方案。
- 源码MJS及嵌入Code语法、生成JSON一致性、候选图与原业务图的剥离对照通过。
- 发布指针、六份实际历史图、四份草稿、五个新Webhook、所有者、原history及18条非目标定义回读通过；脱敏回执见 [VERIFIED.json](VERIFIED.json)。
- 没有执行功能测试、业务下载/导入/恢复、手动execution、测试通知或改密码/凭据。

本次只确认定义与入口已采用，不表示旧客服失败已恢复，也不冒称新通知已由真实自然故障完成投递验证。原计划、业务状态与通知账本保持。
