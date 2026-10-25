# 当前登录账号的普通权限控制

用户明确要求：系统启动、停止、重启和发布均可由当前登录账号以普通权限调用。Windows 提权与应用 viewer／analyst／operator／admin 角色分别处理；此任务不扩大其他 Windows 账号、应用账号或数据库角色的权限。

本次没有删除进程身份、authority、发布谱系、迁移、权限或文件完整性门禁。既有运行目录已对当前账号、SYSTEM、Administrators 提供精确 FullControl；普通账号读取应用完整性与整个运行目录 ACL 的原检查实际通过。

实际调整为当前用户的运行环境与进程级别：

- 将已经可用的 PowerShell 7.6.5.500 便携运行环境复制到 `%LOCALAPPDATA%/TERUISI/ControlHost/PowerShell-7.6.5.500-362a356ce7f0`，658 个文件逐项 SHA-256 核对，`pwsh.exe` 为 `362a356ce7f0940ec74f73a8fc2c990a2cc24a38a11c90bbd8eca947110ad139`。没有下载另一版本。
- 仅追加当前用户的 PATH 并通知环境变更，不改系统 PATH，不赋予额外账户权限。原用户 PATH 与变更回执仅保存于本机任务证据，可按原字节恢复。
- 原管理员启动的旧进程先经既有维护／停止入口受控退出，包括 PostgreSQL；随后用原 Worker Start 完整启动，由普通权限进程持有各服务。没有直接接管未知进程。
- 2026-10-14 23:26:41 普通权限完整 Start 返回 started，原 release `20261014T142300Z-5417c162f772702e`；包括原 PostgreSQL、Django 各域、Worker、helper、配置渠道。当前普通权限能读取这些进程的完整 CIM 身份，原 Status 返回 exact_release。普通权限 installed Verify 复核有效数据库备份通过。

原启动、停止、重启的命令继续使用 README 的既有入口，新的终端会读取当前用户 PATH；已经打开的终端需重新打开。默认热重启有既有 30 秒总预算，实测受前置 readiness 与 Worker 重建时延影响会返回 unknown，Worker 随后恢复 exact_release；原失败保留，不将后续服务正常改记为原控制器成功。本次不因这个已有速度限制降低门禁或增加一套进程控制器；完整重启和真实普通权限发布验证以最终回执追加。

一轮转换前尝试未进入维护，保留失败；只读检查确认维护与排空不存在、应用和 ACL 检查通过后，使用同一 ID 的原维护入口续接成功。没有解除未知 gate 或伪造正常状态。普通权限重启的并发拒绝、热重启时限失败均保留原结果，受控服务恢复另有独立状态回读。

证据目录：`D:/codex-artifacts/ordinary-user-controls-20261014/`。源码无应用变更，后续发布验证为同一应用字节在普通权限环境中的真实制品准备与受控切换；不能用已准备候选代替上线成功。

## 最终实际验证

2026-10-15 00:35:27（Asia/Shanghai）普通权限发布闭合；00:36:31 首页 HTTP 200、单品／组合装空历史日期契约、目标版本、商品经营两个 Python 文件以及维护解除通过。原启动、完整停止、完整重启和实际版本发布均有 `administrator=false` 的真实操作回执，不是仅做静态检查。

- 原完整维护入口实际停止 Worker、helper、全部 Django 和 PostgreSQL，返回 `backendStopped=true`、`postgresPreserved=false`；补充原 Stop 确认返回 `already_stopped`。应用切换、原 ExitMaintenance、原 RestartFull 全部由普通权限执行。
- RestartFull 返回 `restarted`、`backendRestarted=true`，所有服务随后正常；VerifyStartup 返回 `startupVerified=true`。没有放宽进程树、凭证、ACL、谱系、authority 或发布 CAS。
- 当前 Worker 为 `20261014T160504Z-80bb62ecc29f92c5`，manifest `ca64334b02b7b54d84ce0e47ea89b81375d2914dcb91249685a7b5dba536d80e`，plan `5e5f911e9c4582824df634caf0993e8b3dad654983d4e589e67b4a164343903a`。
- Django 保持 `ab8da2178572fb974489bc37f5abeb2d2725f5232a909d958eae0d0c24556d9f`。本轮源码与前驱 source snapshot 零差异；没有部署另一套 Django 包、新增 migration、生成新备份、恢复数据库、补跑业务或修改业务权限。首次普通权限环境的 Worker preparation 绑定不同环境指纹，沿原规则准备新不可变制品，未把旧环境的候选冒作可复用。
- 中间遇到另一项市场候选占用发布唯一锁，保持拒绝后等待其准备结束；未抢占锁、发送其他聊天指令或部署其未批准代码。后续 supplemental Stop 的 `IncludeBackend` 在原参数传输层被拒绝，发生在进程调用前。保留原失败，确认同 ID 原全栈停止已闭合后，只补充原 Stop 并继续原版本切换；没有重放已完成的维护动作。

建议日常需要重启时使用 `运营系统.bat restart-full` 或 `npm run system:restart:full`。普通权限支持不代表已有 30 秒快速重启预算在任何负载下都能达成；本机热重启超时的原限制继续保留，未为本任务修订它。

完整原件：`D:/codex-artifacts/ordinary-user-controls-20261014/publication/`；普通进程完整元数据回读：`ORDINARY_PROCESS_VERIFICATION.json`。运行账号仍是当前 Windows 登录账号，其他 Windows 账号及应用角色没有扩权。
