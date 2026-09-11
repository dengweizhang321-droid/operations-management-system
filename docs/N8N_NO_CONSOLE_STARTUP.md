# n8n 无控制台启动

`TERUISI-n8n-Service` 继续使用当前用户的交互登录身份，保留登录触发、失败每分钟重试、最多 999 次、忽略重复实例和不限运行时长。交互身份供原有浏览器自动化及当前用户 DPAPI 使用，不切换 SYSTEM，也不改变全局 Windows Terminal 设置。

后台服务和失败重试是正常行为，弹出空白终端不是必需行为。直接把 `powershell.exe -WindowStyle Hidden` 作为计划任务动作，仍会先创建控制台并可能激活 Windows Terminal。

## 启动与退出

`tools/n8n-launcher/NoConsoleLauncher.cs` 编译为 Windows GUI 子系统程序，本身没有控制台。它通过 `CREATE_NO_WINDOW | CREATE_SUSPENDED` 创建固定系统路径的 Windows PowerShell，在恢复执行前将进程加入 `KILL_ON_JOB_CLOSE` Job Object。PowerShell 和原生子进程不创建控制台；包装程序等待 PowerShell 退出并原样返回退出码，供现有计划任务判断失败重试。停止包装程序或计划任务会结束所属进程树，避免孤儿 n8n 和重复监听。

仅接受一个已存在的绝对 `.ps1` 路径；无效参数返回 64，创建进程或所有权失败返回 70，不弹消息框。n8n 的环境、回环监听、端口检查和 stdout/stderr 日志仍由原 `tools/start-n8n-service.ps1` 管理。启动前错误可通过计划任务 LastTaskResult 排查。

## 安装和验证

在隔离 worktree 先执行：

```powershell
& .\tests\n8n-no-console-launcher.test.ps1
& .\tools\install-n8n-no-console.ps1 -BuildOnly -InstallRoot '<独立临时目录>'
```

测试使用合成脚本和临时计划任务，验证 GUI 子系统、PowerShell/原生子进程的控制台句柄为零、中文空格路径、成功/失败退出码、无控制台输出、参数拒绝、任务持续运行及停止时无孤儿。临时计划任务在 finally 中清理，不调用 n8n。

用户授权本机采用后，在已验收源码执行：

```powershell
& .\tools\install-n8n-no-console.ps1 -ProjectRoot 'D:\运营管理系统'
```

安装程序编译到固定运行目录 `D:\teruisi-runtime\n8n-launcher\<源码 SHA256>`，先导出 `task-before.xml`，仅更换精确匹配旧命令的任务 Action，再回读验证 Principal、Trigger 和 Settings 均未变化。它不会自动启停 n8n，不修改工作流、数据库或其他服务。已存在发布目录和不匹配的任务动作均拒绝覆盖。标准输入输出绑定有效 NUL 句柄，避免 PowerShell 在调用网络查询或原生程序时自行分配控制台；Job 句柄禁止继承。

更换动作不改变已经运行的进程。受控切换前确认没有 new/running execution、helper 空闲；waiting execution 必须另行评估恢复时间。备份 n8n SQLite 时使用 SQLite backup API，不直接复制正在写入的数据库。对经过 PID/创建时间/命令行确认的旧控制台发送 Ctrl+C，让 n8n 正常收尾；确认旧进程退出且 5678 释放后，从同一计划任务启动新入口。回读 healthz、回环监听、唯一进程树、无新 Terminal/OpenConsole/conhost、工作流版本/active 和 Webhook 摘要。禁止通过演练触发业务下载或导入。

若验收失败，先确认本任务持有的新进程已停止，再从 `task-before.xml` 取原 Action 通过 `Set-ScheduledTask -Action` 恢复，保留当前其他任务设置。备份和发布目录保留作为回滚证据；不要覆盖或删除 n8n 业务数据。
