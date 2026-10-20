# 周报发布租约（P0-3）

## 范围与交付状态

- 任务开始时 `origin/main` 为 `f5c68845`；开发期间主线前移到 `d498852c`（Pi native 能力交付）。本分支已 rebase 到 `d498852c`，候选代码提交为 `4a9c37c7`。
- 只交付候选分支 `codex/weekly-release-lease-20261020`。没有合并、没有生产维护、没有部署、没有迁移、没有重启服务、没有执行周报发送或外部通知。
- 没有改变 Start/Stop 语义，没有跳过原维护/排空门禁，没有执行功能测试、业务验收或全库备份。功能是否正确由用户在上线后检测。
- 合并、推送、制品准备和生产上线分别判断；本报告不代表已上线。

## 改动

### 1. 周报入口的等锁前租约

`tools/django-workflow-service.ps1` 新增：

- `Get-NewProductWeeklyReportReleaseLeaseDeferral`：在取得服务 mutex 之前读取 `run\release-publication-lease.json`。只有同时满足以下条件才视为有效：版本匹配、九个字段精确存在、`ownerPid` 为正且进程仍存活、`mainCommit` 为 40 位小写十六进制、`maintenanceId` 为 32 位小写十六进制、`out` 非空且有界、三个时间可解析、`expiresAt` 尚未到期且距 `updatedAt` 不超过 20 分钟、文件不是目录/重解析点且不超过 4096 字节。
- 有效租约返回单一 `status=deferred`、`sent=false`、`reason=release_in_progress` 结果，记录原 `weekly_report_deferred` INFO 事件，直接返回；不取得 mutex，不进入 runtime 校验、PostgreSQL 检查、学习同步或周报业务。
- 无租约、过期、死 PID、坏 JSON、目录、超大文件、错误版本/字段/时间等一律返回“无租约”，继续原 `Invoke-WithServiceMutex { Invoke-NewProductWeeklyReport ... }` 路径，坏租约不会永久阻塞周报。
- 有效租约存在时仍先读取原 `Read-SystemMaintenance` 和 `Read-AutomationDrain`：如果任一 gate 有效，则不使用租约延期，回到原路径按原优先级返回 `system_maintenance` 或 `automation_drain`；如果 gate 读取失败，也回到原路径抛出原异常。维护/排空 gate 的优先级和原行为不变。
- 三个 action 的 dispatch 改为先调用 `Invoke-NewProductWeeklyReportWithReleaseLease`，该包装函数内部仍是原 `Invoke-WithServiceMutex` 和原 `Invoke-NewProductWeeklyReport`。`Get-NewProductWeeklyReportDeferral`、周报业务、n8n 模板均未改动。

租约不是锁、不是维护许可、不是启动许可，也不替代 maintenance/drain gate；它只是有界、可失效的“发布进行中”提示。

### 2. 发布器写入和清理租约

`tools/publish-prepared-main.mjs` 新增：

- 租约路径为 Django runtime 的 `run\release-publication-lease.json`，即 `path.dirname(installed)/run/...`；字段固定为 `version`、`ownerPid`、`phase`、`createdAt`、`updatedAt`、`expiresAt`、`mainCommit`、`maintenanceId`、`out`。
- 默认 TTL 18 分钟（15–20 分钟区间），每次 step 前和结束后刷新；在 worker 准备/复验、schema 复验、maintenance readiness、应用切换、最终 ready 前后也刷新。`createdAt` 固定，`updatedAt`/`expiresAt` 推进。
- 从进入准备（含 schema 复验）覆盖到 Start 和最终 ready。`prepareOnly` 返回前、成功保存 `SUCCESS.json` 前、异常进入 `catch` 时都删除租约；删除前核对 `ownerPid` 和 `maintenanceId`，避免删除后继发布者的租约。
- 原子写入（同目录临时文件后 rename）。任何写入/刷新/删除失败只记录 `LEASE-WARNING.json` 并退回原维护/排空门禁，不阻断发布；失败时不会伪造有效租约。
- 租约不授予维护或启动许可；原有 EnterMaintenance、Stop、DeployApp、ExitMaintenance、Start、VerifyStartup 和 ready 门禁全部保留。

### 3. 测试与逆投影

- `tests/weekly-report-admission.fixture.ps1` 扩展为 48 个私有边界：原 28 个维护/排空/坏 JSON/目录/超大/错误 runtime/id 检查，新增活跃租约（三种 action、文本输出、持锁时不等待）、过期、死 PID、坏 JSON、目录、超大、错误版本、空 phase、错误 commit/maintenanceId、超长生命周期、未来 updatedAt，以及“有效租约 + 维护/排空仍按原原因”的优先级检查。
- `tests/publish-prepared-main.test.mjs` 新增租约生命周期、复验/Start/ready 可观察性、TTL 边界、成功/准备异常/部署异常清理、写失败告警且不阻断发布等测试。
- 新增 [逆投影检查](Check-WeeklyReleaseLeaseProjection.ps1)：删除两个新增函数并把三条 dispatch 恢复为原调用后，其余字节与基线一致；旧 [release-contention-20261020](../release-contention-20261020/Check-WeeklyAdmissionProjection.ps1) 历史证据未改写。
- `tools/verify-release-candidate.mjs` 新增 `weeklyReleaseLeaseOnly` 资格：只接受 `django-workflow-service.ps1`、`publish-prepared-main.mjs` 和 `verify-release-candidate.mjs` 的组合；在该 profile 下运行完整发布测试集、PS5/PS7 新逆投影和周报准入夹具。主线其余生命周期文件变化不会落入此有限资格。
- `tests/release-contention-boundaries.test.mjs` 改为按基线是否已含上一轮锁诊断选择“剥离后比较”或“逐字节相等”，避免 rebase 到已含诊断的主线时误报。
- `tests/release-optimization-boundaries.test.mjs` 仍比较维护准入后的 deploy/apply/start/ready 回调；只剥离本任务新增的 `refreshLease`/`endLease` 调用，不比较租约本身。

## 验证结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| PS5 周报准入夹具 | 48/48 通过 | [ps5.json](evidence-weekly-admission/ps5.json) |
| PS5 逆投影 | 通过，基线 `d498852c` | [projection-ps5.json](evidence-weekly-admission/projection-ps5.json) |
| PS7 周报准入/逆投影 | 未执行：本机没有 `pwsh.exe` | [SUMMARY.json](evidence/SUMMARY.json) |
| 发布器测试 | 52 通过 / 0 失败 | [publish-prepared-main.log](evidence/publish-prepared-main.log) |
| 争用边界 | 5 通过 / 0 失败 | [release-contention-boundaries.log](evidence/release-contention-boundaries.log) |
| 验证器单元测试 | 8 通过 / 0 失败 | [verify-release-candidate.log](evidence/verify-release-candidate.log) |
| 优化边界回归 | 3 通过 / 0 失败（基线 `d498852c`） | [release-optimization-boundaries.log](evidence/release-optimization-boundaries.log) |
| 发布范围计划 | `full`；worker+django；`migrate=false`；`databaseProtection=verified-current` | [scope-plan.json](evidence/scope-plan.json) |
| `git diff --check` | 通过 | [git-diff-check.log](evidence/git-diff-check.log) |

- 本机 PowerShell 5.1 为 `5.1.26100.9444`；`pwsh.exe` 不在 PATH 或常见安装目录，因此 PS7 分支和 `verify-release-candidate.mjs` 的端到端执行未完成。验证器在执行任何检查前先解析 `pwsh.exe`，所以本次没有伪造 PS7 或验证器通过结果。
- 完整验证器需要在具备 PS7 的主机上运行；它会在本候选上选择 `weeklyReleaseLeaseOnly` profile，并运行上表的 PS5/PS7 项目及既有发布测试集。
- 没有执行生产维护、迁移、部署、启动/停止、周报发送或计时实测；“7–17 分钟/次”的目标收益未在本机生产链路上测量。

## 保留边界与风险

- 租约写入失败、读取失败、过期、死 PID、PID 复用、坏 JSON、目录、超大文件都会退回原门禁；最坏情况是这次优化不生效，不会阻断周报或发布。
- 崩溃后租约最迟在 `expiresAt` 失效；PID 存活但属于其他进程时，最长也只能延期到 `expiresAt`。
- 租约文件位于既有 runtime `run` 目录，是可被同一信任域写入的提示文件，不是安全边界；它不授予维护、启动、迁移或发送权限。
- n8n 模板每五分钟直接执行 `RunWeeklyReport -Json`，不解析延期响应；延期只表示本轮未执行，不新增补发队列，维护跨过原发送窗口时仍按原规则处理。
- 没有改 Start/Stop 语义、Django 生命周期门禁、发布工具的原生版本/制品/身份/权限/互斥/排空/启动检查。
- 合并与上线分开：本候选未合并到 `main`，未推送生产制品，未部署或重启任何服务。
