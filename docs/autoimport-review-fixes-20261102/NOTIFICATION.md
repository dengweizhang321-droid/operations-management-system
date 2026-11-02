# 人工协助本人单聊候选（2026-11-02）

本轮仅开发候选。没有修改线上 n8n、`D:/teruisi-ops/` 现用脚本、看门狗源码/安装资格，未查询实际身份、机器人或发送消息。规则见[通知规范](../自动化/通用/workflow-dingtalk-notifications.md)。使用当前 [dws 技能](C:/Users/86137/.agents/skills/dws/SKILL.md)核对了叶子 Schema/Help；该命令确认语义为 `user_required`，本轮没有执行发送，也不把代码中的 `-Execute` 当作采用授权。

## 文件与最小实现

- [n8n-manual-action-alert.ps1](../../tools/n8n-manual-action-alert.ps1)：独立 PowerShell 7 入口；默认只验证本地参数并输出固定脱敏预览，只有显式 `-Execute` 才动态核验身份并尝试发送。未指定 `-Execute` 不执行 dws，包括身份查询。
- [n8n-hourly-retry-policy.mjs](../../tools/n8n-hourly-retry-policy.mjs)与[生成工作流](../../automation/n8n/data-import-hourly-safe-retry.workflow.json)：三路人工提醒接线共用一个参数准备节点和一个 Execute Command 发送节点；自动恢复主体保持原入口。

入口在独立函数作用域 dot-source **同目录** `operations-system-watchdog.ps1 -FunctionsOnly -Action Status`，直接复用 `Get-WatchRecipient`、`Invoke-WatchDws` 和其参数数组/直接进程传输；`FunctionsOnly` 在 Status 和检查/安装动作之前返回。依赖同版本 `process-deadline.ps1`、`watchdog-install.ps1`，不复制身份解析器，不修改 watchdog 安装包及白名单，不读取/写入其 state。把此入口塞入已安装 watchdog 包不在本方案范围。

实际采用须将上述新入口和三个既有依赖作为同一受控源码版本保持在同一 tools 目录。候选命令固定指向 `D:/运营管理系统/tools/n8n-manual-action-alert.ps1`，此路径当前候选尚未落地；先合并/采用源码与确认依赖，再按另行授权采用工作流，不能先启用 JSON。执行 n8n 的同一 Windows 账号须能通过 PATH 找到 `pwsh.exe` 7+ 和原 dws vendor 路径；本机已知常规 `C:/Program Files/PowerShell/7/pwsh.exe` 不存在，故没有钉死这条假路径。若该账号没有 PS7，先安装/配置受控 host，不回落 Windows PowerShell 5。

选择 PS 是为了复用现有已采用的动态身份解析及直接进程传输，不表示原 HTTP 路径必然未配置或必然不可用。

## 路由、参数与身份

运行时每次真正发送前，依次使用 `profile list`、`contact user get-self`、`contact user search`、`chat bot search`，精确核验当前唯一组织“佛山市登荣科技有限公司”、本人“邓伟章”和唯一“志高助手”；本人搜索结果须与当前 profile/get-self 身份一致。身份或机器人歧义即停止；不猜 ID、不回退群或其他个人。

发送保持既有 `chat +messages-send --as bot --profile … --robot-code … --users … --text … --yes`。参数作为字符串数组交直接进程传输，不拼接 shell；不传任何群参数。本人身份和机器人值只在本次函数内存使用，不输出，不写防重记录。

唯一外部参数 `PayloadBase64` 是 UTF-8 JSON 的标准 base64，最多 8192 字符；另有明确执行开关和可选独立状态目录。JSON 只接受 `version=1`、已登记 `workflowId`、数字 `logicalExecutionId` / `failedExecutionId`、白名单 `code`；未知字段、未登记流程或未知码均拒绝。固定工作流标签和固定人工说明由脚本选择；不接收原始异常正文、调用方标签、路径、命令或任意通知文本。base64 仅作为无 shell 元字符的编码载体，不作为安全边界；编码前和入口解码后均校验字段。

通知使用固定脱敏文字，包含注册流程标签、上海时间、执行标识、尚未完成及保留已完成证据的说明、人工下一步；不虚构成功步骤、批次数或业务日期。具体已完成部分及业务范围由原计划/批次证据核查。错误输出只含固定状态和白名单摘要，不转储 CLI 返回、stderr、异常文本或 ProcessEvidence。

## 三条路径及终止语义

| 原路径 | 候选行为 |
| --- | --- |
| “收集被丢弃的终局失败”告警出口 | 只提取流程、失败 execution 和固定分类码；经“准备人工提醒参数”编码后交共用 sender。原先该出口也连到停止节点，候选保留失败终态。未登记流程无法解析成受控标签，参数准备失败关闭，不转发原始名称或错误。 |
| “告警-派发未知”出口 | 从已核验原计划节点取 `originalExecutionId`，编码 `retry_dispatch_result_unknown`，发送后仍以原固定派发未知说明停止；禁止再次 POST Webhook。 |
| 原计划 Code 内 `notifyManualAction` | 移除内部 HTTP 发送。只对原有四个已知人工码产出结构化字段，新增 IF 路由经同一 sender，再用原错误码 StopAndError。其他异常仍原样 throw。 |

四个码为 `retry_context_wait_expired_manual_action`、`retry_context_unverified_manual_action`、`retry_reservation_result_unknown_manual_action`、`retry_already_reserved_or_unverified_manual_action`。名额预留错误已取得的核验上下文优先使用 `originalExecutionId`；尚未取得时显式回落原失败 `failedExecutionId`。其余人工分类另有 `terminal_manual_action`、`execution_mode_not_automatic`、`retry_dispatch_result_unknown`。

sender 的 `retryOnFail=false`、`onError=continueErrorOutput`；成功和错误两个输出都进入 StopAndError。终止码从发送前参数节点的关联 item 获取，不依赖 Execute Command 的 stdout 或错误正文。通知成功、被抑制、身份失败、发送未知均不把业务恢复标为成功。没有新增失败节点重跑或业务 helper 直调；原等待、核验、预留、退避与派发规则保留。生成工作流仍 `active=false`。

## 独立防重及采用边界

默认状态根为执行账号 `%LOCALAPPDATA%/TERUISI/n8n-manual-action-alert`，与 watchdog 状态分开；同一调用链必须持续使用同一个目录，换账号/换目录或丢弃账本会失去此前防重依据，不能以清空状态重发。目录级互斥覆盖检查、身份解析、落盘和发送。键为固定版本、流程、原逻辑 execution、人工动作码的 SHA-256；恢复已有原逻辑标识时复用它，不使用通知工作流自己的 execution。

只取得 `failedExecutionId` 的终局告警按该失败事件防重；不同失败 execution 是否属于同一长期故障，需要原业务链提供逻辑关联，候选不凭错误文案猜测合并。此限制尤其适用于尚未取得原计划的告警，不宣称已经消除了任意跨 execution 的重复提醒。

发送前持久写 `sending`，仅在原 dws bot 回执完整确认成功、零错误、有受理键且无拒收/限流目标时写 `sent`。发送调用已开始后的异常/非确认回执写 `unknown`；崩溃遗留 `sending` 同样按 unknown 抑制。三种记录都不重放；身份核验失败在未调用发送时记 `identity_failed`，本节点不自动重试。损坏或未知状态失败关闭。

返回码：0 为已确认 sent/同键 sent 抑制或本地预览；2 为身份/参数/状态不可确认或互斥忙；3 为发送未知/同键 unknown 抑制。机器回执不包含身份值。unknown 只能由后续明确授权的人工核对原私聊回执处理，入口不提供 force/resend/删账本命令。

采用仍需对应操作授权：同版本源码入口、n8n 执行账号/PS7/路径可用后，才采用此错误工作流；受影响目标工作流的 errorWorkflow/webhook 是另一项现有采用工作，不因本轮 JSON 存在而已上线。未改完成通知、普通状态通知或其他业务的原渠道。

## 本轮检查

仅执行 PowerShell AST 语法解析、Node 语法检查、嵌入 Code/表达式编译、生成器与 JSON 字节一致性及连接/字段静态核对、差异空白检查；结果见主报告。未运行 sender、功能/业务测试、全量测试、dws 动态身份查询、发送/发送预览、线上 n8n 修改或生产操作。静态可连接不等于线上已采用或已实发成功。
