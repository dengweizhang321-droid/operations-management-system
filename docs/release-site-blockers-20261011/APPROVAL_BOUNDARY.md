# 下一步所需确认

**已更新**：9e包现已由用户执行成功，不能重放它。当前待执行的是[五对象补充只读范围](ADMIN_FOLLOWUP.md)（packet bb861c8f…，现有管理员窗口手工执行），不是上线范围。下方旧取消/尚未采集描述保留其历史截点。

当前只读管理员包：`E:/codex-artifacts/release-site-blockers-20261011/ADMIN_READONLY_PACKET_V2.json`，SHA `9e906d1e53ee9acf67b909be0198520e137d9cc08d1b8fbc3aa5adf7f709df38`。

它读取进程／任务动作元数据、仅PID47936的有界工作目录元数据，并在同一E证据根写脱敏审计。原始命令／cwd不落盘。不启Debug权限、不注入／杀进程、不改调度、不调用生产batch、维护、启停、切换、Backup、RestoreRehearsal或业务写入。Astra的受控解码15例、PS5管道与清环境、cwd消费者7例已留原失败及修正；两次真正AGY文本调用超时没有最终复审结论，不当作通过。

Windows管理员确认已请求一次，但操作返回被取消，尚未运行管理员采集。不要自动重复或绕开确认。仍需本人允许该**只读权限核查**，或从有权限的终端按同一经校验脚本运行。调用前核packet及launcher SHA，并持launcher只读文件句柄；launcher只产生标准Windows RunAs确认，不自动接受系统权限提示。

运行成功也只是新的诊断截点，不是生产授权。残余unknown、实际引用或不支持布局仍保留。要将native补充纳入执行合同，须明确独立复审和重新封存新批次；旧f0bb不能被改写。若选择在管理员身份运行原合同，仍须原完整身份／源码／制品／ACL／ready／互斥／排空门禁全部实际成立，不把跨时点诊断凭证当放行。

本轮现在不能提交可执行的最终上线确认。核查闭合后，提交的生产对象仍要明确：源码dc1／binding1168、Worker21c／6cff／plan0afd、D85cf／receipt10db、非复用入口6989、实际适用的新批次及19操作、一次前备份＋一次新已安装同点隔离演练、必要验收与兼容回退。生产维护／切换／备份／演练／调度／业务写入必须等待本人另行明确批准。

现有代码、候选、旧目录保全和所有仍被collector／回退引用的worktree保留；不因本轮诊断或Git收尾删除。完整核查见[报告](REPORT.md)。

## 本人明确允许后的系统确认

用户已再次明确允许这份封存的管理员只读包；此授权保留，不重复请求生产授权。重新核packet与四项源码／Node字节后再次请求RunAs，已观察到当前登录会话的consent.exe；Windows随后仍返回“操作已被用户取消”，管理员采集未启动，三个预定结果文件均不存在。不能据聊天允许宣称操作成功，也不推断用户有意永久拒绝。

如果没有看到系统确认窗口，请在Windows开始菜单找到PowerShell，使用“以管理员身份运行”，然后执行以下同一封存包。它再次检查相同Windows SID、全部源码及Node字节；不会发布、重启、备份、恢复或更改计划任务。

```powershell
$readonlyLauncher = 'D:\.codex\worktrees\release-site-blockers\运营管理系统\docs\release-site-blockers-20261011\Start-ReadOnlyAdminAudit.ps1'
$readonlyHold = [IO.File]::Open($readonlyLauncher, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    $readonlyHasher = [Security.Cryptography.SHA256]::Create()
    try { $readonlyHash = ([BitConverter]::ToString($readonlyHasher.ComputeHash($readonlyHold))).Replace('-', '').ToLowerInvariant() } finally { $readonlyHasher.Dispose() }
    if ($readonlyHash -cne '59276d18da0eb6cee4cf3e1909e1759b4d7ffbfaa1df1be0893225c8ef2e6c05') { throw '只读启动包字节不匹配' }
    & $readonlyLauncher -PacketSha256 '9e906d1e53ee9acf67b909be0198520e137d9cc08d1b8fbc3aa5adf7f709df38' -Launch
} finally { $readonlyHold.Dispose() }
```

结果在E证据根的`ADMIN_READONLY_COMPLETED_V1.json`、`ADMIN_REFERENCE_DIAGNOSTIC_V1.json`和`ADMIN_CAPTURE_SUMMARY_V1.json`。运行后由发布任务只读核验结果及当前条件；不要直接执行生产批次。若没有结果文件，应保留原错误，不覆盖／重复重放或放宽检查。
