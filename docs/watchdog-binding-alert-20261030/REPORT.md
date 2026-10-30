# operations-watchdog 失明与告警静默修复（2026-10-30）

## 问题

`operations-watchdog` 自 2026-10-18 01:55 起连续失败，12 天无一次 `healthy`，
且告警从未送达。两个独立缺陷互锁，造成彻底静默。

### 缺陷一：诊断绑定失配无法与探测失败区分

`Resolve-WatchStatusControl` 在启动子进程前核验四个受钉源文件的 SHA-256。
10-17 23:56 安装时钉子正确（对应提交 `47e1e89f`）；此后 control、worker 随正常
开发推进，backend 随 Django 发布替换，三项失配：

| 资产 | 钉住值 | 2026-10-30 实际值 |
| --- | --- | --- |
| control | `b7acd2bc…` | `624cf40d…` |
| worker | `112b091b…` | `1b8c5d4d…` |
| backend | `09844449…` | `98028cb4…` |
| transport | `5ae9617f…` | `5ae9617f…`（相符） |

失配抛 `diagnostic_predecessor_changed`，但快照只记成通用
`probe_stage_failed`。于是"监控自己瞎了"与"服务探测失败"在证据里无法区分，
`latest.json` 看起来像服务异常，`system`/`backend`/`worker` 全是 `unprobed`。

失配本身**不是**源码漂移事故：它是合法更新的正常结果。
[ASTRA_WATCHDOG_BINDING_FAILURE_REVIEW](../release-no-data-production-20261011/ASTRA_WATCHDOG_BINDING_FAILURE_REVIEW.md)
已确认该机制，并要求"绝不自动更新期望哈希"。本次修复遵守该契约：
不改钉子、不放宽校验，只让失配可被明确告警。

### 缺陷二：投递判定与 CLI 实际信封不符

判定要求顶层布尔 `success` 与 `failedCount`。实测 dws 1.0.57 的
bot 单聊批量信封为：

```json
{"identity":"bot","ok":true,
 "result":{"errorCode":0,"errorMessage":"ok","success":true,
   "result":{"processQueryKey":"…","invalidStaffIdList":[],"flowControlledStaffIdList":[]}},
 "tool":"batch_send_robot_msg_to_users"}
```

顶层无 `success`，无 `failedCount`；`success` 嵌套在 `result` 下。
因此每次**实际投递成功**都被判为 `delivery_unconfirmed`。
`alerts\` 下 301 条历史记录中无一条 `sent`（185 条 `identity_failed`、
116 条 `unknown`）；10-10 之前是身份失败，10-10 起全部是本缺陷。

### 互锁机制

`Send-WatchAlert` 开头只允许 `identity_failed` 重试，`unknown` 为终态；
而 `notification` 仅在 `healthy`/`recovered` 一轮清空。control 阶段坏了
永远到不了 healthy，于是首次 `unknown` 之后每分钟静默 return。
两缺陷各自不致命，叠加造成 12 天无声。

## 改动

`tools/operations-system-watchdog.ps1`：

1. 新增 `Get-WatchBindingDiagnostic`，按固定白名单输出
   `{valid;code;assets;requiresRequalification}`。只记资产名
   （`control`/`worker`/`backend`/`transport`），不输出路径或哈希。
2. `Resolve-WatchStatusControl` 失配时携带漂移资产名抛出；**仍然失败关闭**，
   不更新期望哈希、不回退 legacy 控制器。
3. `Get-WatchSnapshot` 保留四个绑定类错误码本身，并记录 `diagnosticBinding`，
   使"监控需重新资格化"与普通探测失败在证据中可分。
4. `Get-WatchFailureText` 新增一条告警文案，明说
   「监控自身需要重新资格化……这不代表服务异常」，并列出漂移资产。
5. 投递判定按实测信封核验：`ok` 为真、`result.success` 为真、`errorCode` 为 0、
   `processQueryKey` 非空，且 `invalidStaffIdList`/`flowControlledStaffIdList`
   均为空。任一缺失或为否仍判 `delivery_unconfirmed`，绝不猜测为已送达。
6. 解除互锁：同一事件在 `unknown` 后，最多 3 次、每次间隔 ≥24 小时，
   可发出**各自独立记录**的升级告警（`-escalationN`），
   原 `unknown` 回执不被覆写。不重放同一条告警；
   恢复通知与已确认送达仍为终态，不升级。

## 验证

```
tests/operations-system-watchdog.test.ps1        passed 36
tests/watchdog-diagnostics.test.ps1              passed 42
tests/watchdog-bounded-log-tail.test.ps1         passed  8
tests/watchdog-recovery-outbox.test.ps1          passed 22
tests/watchdog-install.test.ps1                  passed 18
tests/watchdog-no-console.test.ps1               passed  5
tests/watchdog-binding-alert-delivery.test.ps1   passed 41（本次新增）
                                                 合计 172
```

全部报告 `actualMessagesSent:false`、`productionTouched:false`。

新增 `tests/watchdog-binding-alert-delivery.test.ps1` 覆盖：绑定诊断的类型与
脱敏（含路径注入被拒）、告警文案区分监控失明与服务异常、八种不完整/否定信封
全部保持 `unknown`（含旧顶层信封、字符串 `success`、`ok=false`、非零
`errorCode`、缺确认键、收件人无效、被限流、`result` 缺失）、
升级的触发/时间闸门/次数上界、恢复通知与已送达不升级。

两个既有 fixture 的成功信封按实测形状更新
（`tests/watchdog-diagnostics.test.ps1`、`tests/watchdog-recovery-outbox.test.ps1`），
其中字符串 `success` 必须被拒的负向断言保持不变。

`tests/startup-status-receipt-safety.test.mjs` 的 2 项失败为**既有基线**，
与本次改动无关：改动前后同为 9 pass / 2 fail，失败测试名完全一致。

## 未处理（需单独授权）

1. **钉子重新资格化**：仓库有生成器 `tools/prepare-watchdog-status-driver.mjs`，
   可由当前源文件重算驱动与 `driver-binding.json`。但该操作会重建驱动字节，
   且 worker 相对钉住版本有 203 行、13 处变化，backend 为运行时文件；
   按 10-11 复核要求须人工逐函数复核所有权判定后才可采用。
   本次**未重算钉子**，故生产 watchdog 在重新资格化前仍无法观测服务状态，
   但修复后它会明确告警说明这一点。
2. **部署**：`D:\teruisi-runtime\operations-watchdog\` 下任何改动需单独授权
   （AGENTS.md 第 6 条）。运行中 bundle 为 `8b1d0722…`，布局 `immutable-v1`。
3. 顶层遗留的 `operations-system-watchdog.ps1`（`aefa5e6d…`）不被执行，
   与 `installation.json` 声明不符，建议后续清理。

## 取样说明

实际信封样本由用户明确授权后，向机器人「志高助手」
（`dingq1h3jwz6pfyxsydw`）发送一条测试消息取得，内容为测试文本、无业务数据。
