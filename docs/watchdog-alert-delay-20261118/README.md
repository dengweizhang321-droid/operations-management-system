# 看门狗运行提醒延迟 30 分钟

## 改了什么

`tools/operations-system-watchdog.ps1` 新增常量 `$WatchAlertDelayMinutes=30` 和函数 `Test-WatchAlertDue`。`Invoke-WatchCycle` 发「运营管理系统运行提醒」的条件在原有「连续失败至少 2 轮」之外，增加「故障从首次发现（`firstFailure`）起持续满 30 分钟」。`firstFailure` 缺失或无法解析时视为已到期（失败开放，宁可多发，不吞告警）。

## 为什么

2026-11-12 以来 28 次故障中有 25 次在 15 分钟内自愈，原来第 2 轮就发提醒，钉钉被刷屏。

## 保持不变

- 自动恢复（`recover` 决策、每事件 3 次上限、15 分钟 3 次预算、5 分钟冷却）仍在第 2 轮失败即执行。
- 证据文件（first-failure、last-failure、latest、before、recovery-attempt）照旧写。
- 恢复提醒逻辑未改：只有 `notification` 为 sent/sending/unknown 才入恢复发件箱。因此 30 分钟内自愈的事件没有恢复提醒；超过 30 分钟、发过运行提醒的事件恢复后仍会补发。
- `Send-WatchAlert` 内部（身份重试、每 24 小时 `-reminder<N>`、不重放）、消息文案、`TestNotification` DryRun 路径、`$WatchdogVersion` 均未改。

## 测试

`tests/operations-system-watchdog.test.ps1` 新增用例：30 分钟内多轮失败不发提醒但恢复照常、刚满 30 分钟发提醒、`firstFailure` 缺失或无法解析照发、30 分钟内自愈不产生恢复发件箱文件、超过 30 分钟提醒后恢复产生发件箱文件。依赖「第 2 轮就发提醒」的旧用例通过把 `firstFailure` 提前 31 分钟保留原意图。

## 上线

需要重新安装看门狗（`PlanInstall`，再 `Install`）才会生效；这需要用户另行授权，本任务未执行。
