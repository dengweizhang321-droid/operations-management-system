# AI 对话历史执行详情修复：正式采用

2026-10-15 18:16（Asia/Shanghai）已完成本机正式 Worker 切换、门禁解除及必要服务确认。随后在原浏览器页面刷新，原先触发错误的历史会话已正常加载，输入区和对话详情均可打开；缺失配置/技能显示“未记录”，未再出现该 TypeError。未发送新的模型请求。

## 采用范围

- 应用主线修复：`acf5a4177776be52036bdf80c34efddf3ba38c2f`；[修复与定向验证](REPORT.md)。
- 实际组合来源：`2a8aaef992e60aa95bb317800b94f1abaf62ec4f`。只在实际已采用源码上合入本次组件、测试和说明，排除 main 中尚未采用的其他变化。
- 前驱：`20261015T074548Z-58e44a5126de6bba`。
- 已采用 Worker：`20261015T092526Z-d90afd0d40109cc3`。
- Manifest SHA-256：`ab6fb58f599eb905baefeae1c4e7df716f0cb1e3b4f8c66f444d075f7e4fa180`。
- 原 plan SHA-256：`7c28f1dc987889d7abef7134901e8c095cd3fdee7d3d200840813d6a97998910`。
- 原 apply 返回 `activated`，successor SHA-256 为 `47c88f78a9a9d8eb936826d49d4c6cf8a221eb36bb8542d504b8c4d64d99b770`，consumption SHA-256 为 `2e528ba2e3f8b2d033b4bf6be9f618f3cd7d5b071b73f2e2594d06b58e7010b8`。

本轮只处理前端 Worker，按普通权限执行；Django 部署清单保持 `d59fbd6a08536aac62045cc0214b600c1b961c229c0f4a834f35ea8cdf57d175`。没有 Django 部署、迁移、业务数据处理、数据库备份/恢复、模型调用或人工外发。原有有效测试和制品直接复用，没有重复构建或增加全组件验收。

## 操作与异常事实

用户本轮明确授权“发布上线”。消息未提供可独立获取的精确时间戳，17:55:04 是封装保存授权记录的时间，不能倒填成用户原授权时刻。

| 上海时间 | 原操作与结果 |
| --- | --- |
| 17:55:23–17:55:58 | 首次 BeginWorkerDrain 返回 unknown / worker_gate_failed；未进入 Stop/apply。独立核对原进程退出、无门禁、完整前驱/12 个保护入口和运行回执不变、无候选消费或后续动作后，确认该阶段零排空/零切换作用。并发周报生命周期锁争用仅为推断，未将其写成已证根因。 |
| 18:00:33–18:01:27 | 使用同计划、同操作编号重试原 BeginWorkerDrain，取得真实 worker_drained 回执。 |
| 18:01:27–18:01:39 | 原 StopForRelease 成功，仅停止 Worker。 |
| 18:01:39–18:07:13 | 原 apply 成功激活精确候选，并生成 successor/consumption/startup 绑定。 |
| 18:07:13 起 | 原 Start RequireReady 被调用；新 supervisor 在 18:08:12 创建，随后新 helper/Worker 出现。外层默认 EOF 输出等待没有返回 Start 回执，不能把该原调用的退出码或传输结果写成成功。 |
| 18:11–18:14 | 原 Status 与独立检查确认目标 exact_release、精确 CIM/receipt/有效 head/consumption、同 ID 请求门禁与空闲 helper。原 Start 控制进程已退出；经独立审查，只结束精确身份的本任务外层等待器，不终止服务树、不重放 Start/apply。保留原 started 及协调证据。默认 EOF 与长期子进程输出继承的关系仍是疑似原因。 |
| 18:15:48–18:16:03 | 在新原发布锁内重新核对同一候选和门禁，原 EndWorkerDrain 返回 worker_drain_ended。 |
| 18:16:16 | 原 Status 确认 exact_release、双门禁为空、主页 HTTP 200，Django 清单未变。必要上线确认完成。 |

从封装保存授权的 17:55:04 至必要上线确认约 21 分 12 秒，已超过常规 15 分钟目标；用户实际总等待还包含更早的入口核对和一次依赖加载失败。该加载失败发生在发布模块导入阶段，未执行维护或切换。首次失败、原 Start 未返回与后续已达成效果分别记录，未用最终上线成功覆盖原 unknown，也没有将上述整个区间误写为停服时间。

后续原入口调用使用既有 `direct-exit-files` 输出协议。未修改生产发布工具、降低进程/权限/完整性门禁或引入新的恢复机制。

## 证据与保留

原证据保存在 `D:/codex-artifacts/ai-chat-empty-details-20261015/`：

- `PUBLISHED.json`、`publish-resume1/apply-worker-result.json`、`publish-finish/*-result.json`：原激活、门禁解除、最终身份和 HTTP 证据。
- `DRAIN_FAILURE_REVIEW.md`、`independent-drain-failure-observation.json`：首次失败后的独立观察。
- `START_TRANSPORT_REVIEW.md`、`independent-start-state-chain.json`、`START_EFFECT_COORDINATION.json`、`OWNED_WRAPPER_EXITED.json`：Start 目标效果协调，原返回未收到的事实保留。
- `RELEASE_PREPARATION_REVIEW.md`、`independent-preparation-tuple.json`：原已完成的制品绑定审查。
- 本目录 `publication-summary.json` 仅保存非敏感交付摘要和页面确认，不保存聊天正文或模型凭据。

正式不可变包、原已采用运行目录和绑定的发布输入保持；本次没有清理其他任务的工作树或历史备份。发布证据文档按文档流程合并与推送，独立记录于应用提交之后，不要求重建字节未变的 Worker。
