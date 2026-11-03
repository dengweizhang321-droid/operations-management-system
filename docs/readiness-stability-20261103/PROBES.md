# 聚合 ready 与直接消费者修复

2026-11-03，基线 `e7aaf6c16939770d0941994873747fe301ef0b93`；独立开发树 `D:/codex-isolated/readiness-probes-20261103`。本报告仅覆盖聚合探针与四个直接消费者，固定发布器、父 deadline 传递与尾部等待由主任务另行交付。

## 预算与兼容契约

- 23 个既有服务、最多 6 个并发、全部 ready 才通过保持不变。
- 每个服务实际发出请求才开始自身 4,000ms 预算，覆盖响应头和完整响应体；排队不消耗其自身预算。整轮独立单调上限 18,000ms；四波接近 4s 的合法响应可在约 16s 完成，另留 2s 调度/解析余量，不是固定波次屏障。
- `timeoutMs` 仅可缩短整轮上限；父 `AbortSignal` 可以提前取消整轮。完成后仍检查单调时间，晚到响应不被认成成功。
- 继续使用原 `fetchBoundedJson`，保持 16KiB、禁止 redirect、头体统一计时及原取消/清理机制，未修改通用实现。既有端点、AI role/authority 和各领域 marker 严格断言继续保留。
- 保留 `unavailableServices` 和原 HTTP/status/code 契约。它包含所有非 ready 服务以兼容原失败关闭行为，但判断究竟故障还是未完成要读取新 `serviceChecks`。

`serviceChecks` 只含固定白名单服务名、`state`、固定 `reason`、`queueMs`、`requestMs`、可选 `httpStatus`。`state` 为 `ready` / `not_ready` / `incomplete`。未发出请求为 `incomplete/not_checked`；已发出但整轮耗尽或父取消为 `incomplete/round_budget` 或 `incomplete/cancelled`。不得据此前者认定后端故障。

固定 reason 全集：`none`、`not_checked`、`round_budget`、`cancelled`、`missing_configuration`、`invalid_endpoint`、`request_timeout`、`transport_error`、`redirect`、`response_too_large`、`http_status`、`invalid_response`、`identity_mismatch`、`not_ready_unknown`。HTTP 503 一律 `not_ready_unknown`，不根据任意 Django body 猜测永久权限/配置错误；HTTP 401/403/404 等保留数值，供发布消费者识别。URL、响应原文、SQL、原始异常不进入诊断。

## 消费入口与采用边界

| 组件 | 本次源码入口与期限 | 父预算与实际采用要求 |
| --- | --- | --- |
| Worker 聚合 | `worker/index.ts` 调 `lib/django/backend-readiness.ts`，18s / 单请求4s | Worker 请求 signal 可提前取消。须从最终提交构建并按原发布流程采用 Worker bundle；改源码不改变现役 bundle |
| Worker 自身观察 | `tools/worker-local-runtime-supervisor.mjs` 导入 `tools/start-local-worker.mjs` 的 ready monitor，ready20s，live仍5s | 只受调用 signal 进一步收窄；现有 readiness degraded 只记录，不触发重启。`worker-local-release.mjs` 将 starter 复制到 immutable Worker release，须采用对应 release |
| 总控 | `tools/operations-system-control.ps1` → `Get-SystemHealthState`，live3s、helper3s、ready20s | 三者共享 `Get-ProcessDeadline`，默认600s且取 inherited deadline更小值；不足20s时提前中断符合父约束。真实入口由包装脚本/桌面配置的 ControllerPath 决定，不能将 worktree 修改视为采用 |
| 看门狗 | `tools/operations-system-watchdog.ps1` → `Get-WatchHttpProbes` / `Test-WatchHttp`，每项独立期限，仅ready20s，其他仍5s；snapshot仅control driver显式90s，其他child默认60s | snapshot总driver120s不变，HTTP及control/其他child均受剩余父预算限制。`Invoke-WatchScript`可选Seconds默认60，仅snapshot的control调用指定90，经原`Invoke-WatchProcess`→`Get-ProcessDeadline`裁剪。正式任务运行 immutable `versions/<bundleId>` 安装；须走既有受控安装及 driver-binding 资格维护。独立 `watchdog-status-control.ps1` / backend driver还核对控制器、Worker、backend、transport、supervisor字节，不能仅替换仓库脚本 |
| 桌面 | `tools/desktop-launcher/Launcher.cs` → `ProbeReady`，ready专用client20s、主页独立client仍8s | 既有 `WaitForReady` 15分钟循环在 probe边界检查预算/关闭信号，未改变循环策略；单次成功路径仍可花 ready20s+主页8s。须通过既有 installer重编译/采用 `%LOCALAPPDATA%/TERUISI/Launcher/运营管理系统.exe`，配置仍决定总控路径。本轮只在TEMP编译测试，无正式安装 |
| current control | 固定发布前置/状态入口在主任务的 `publish-latest-main.mjs` / `publish-main-status.mjs`；冻结发布来源消费 prepared/tail | 属于另一控制包采用面；主任务负责纳入复制清单、20s单次与120s尾部及父期限。仅发布Worker不表示这些入口生效 |

全仓 ready 直接调用检索还找到 `netshop-readiness/business-check.ts`，默认单次20s已兼容；`global-d1-mirror-worker.mjs` 为隔离 mirror 探测，没有独立短 ready 期限。本次未更改旧精确恢复入口 `publish-main-completed.mjs`、`manual-startup-reconcile.mjs`、`pi150-forward-recovery.mjs`；其15s仍在，不属于本次常态采用路径，不热改历史封存资格。发布器文件由主任务处理。

本报告未读取/断言现役四种载体已采用本次字节；现场绑定与采用回执由主任务整体列示。

## 必需隔离检查

- 新增 `tests/readiness-probe-budgets.test.ts` 8项：受控单调时钟和定时器验证23×3.9s四波15.6s成功、末批queueMs11.7s但requestMs3.9s、单请求4s取消、整轮缩短耗尽、父取消/预取消、响应体截止边界、503未知与字段脱敏、四caller范围。没有真实HTTP请求。
- 与既有 `django-aggregate-boundary.test.ts` 的 readiness/configuration范围共13项通过；保持6并发、端点拒绝、16KiB/redirect拒绝与原兼容断言。未运行其中业务消费者测试。
- 既有 `local-worker-start.test.ts` 与 `operations-system-control.test.ts` 共38项通过（模拟探针/子进程）；原重启/调度边界保持。
- `watchdog-diagnostics.test.ps1` 初轮43项通过；独审指出原`Invoke-WatchScript`默认child60s仍可能截断46–54s旧driver叠加更长ready后的合法调用。续修仅control90s后，扩为48项通过：真实snapshot调用control90/其他60，真实script/process wrapper转发90、默认60、参数/Direct边界、剩余父45s精确裁剪；仅最底层进程传输替换，不启动真实子进程。回执 `productionServicesTouched:false`、`messagesSent:false`。这验证父snapshot/诊断保全，没有把静态20s接线检查冒称真实HTTP时长测量。
- 目标 TypeScript program（聚合文件、新测试及其依赖）诊断0；`node --check tools/start-local-worker.mjs` 通过。两个修改过的PS生产脚本解析及UTF-8 BOM检查通过。
- .NET Framework C#编译成功，输出 `C:/Users/86137/AppData/Local/Temp/readiness-launcher-2ee78d8ff54141bc91a9bbb8b14d1cd8.exe`。既有 launcher隔离边界测试通过，补反射核验编译后 ready20s、homepage8s；测试只使用TEMP假控制器，未连接服务、创建快捷方式或正式安装。
- `git diff --check` 通过。新测试不在 `verify-release-candidate.mjs` 的既有 profile引用中；未改变profile或任何封存资格。

首次新测试的静态正则多写一个括号导致1项失败，修正测试表达式后通过。首次C#命令给旧编译器传相对正斜杠路径失败，改为解析后的绝对Windows路径即成功；均为隔离检查命令问题，不改生产行为。

未执行：合并main、push、制品准备、正式编译安装/控制包采用、部署、服务启停、生产HTTP或业务验收。未写共享记忆，由主任务统一维护。
