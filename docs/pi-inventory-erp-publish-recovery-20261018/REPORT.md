# 本次三任务包同维护 ID 的有限恢复候选

应用目标仍为 main `6dc028139cc6e561dcad68d76c9d673596d9ec82`。本目录是外置恢复工具开发来源，不修改冻结应用、不重新打包，不自动合入/部署此目录。

原发布 19:48:43 启动，维护 ID `5fe642a2602243ca83819253d8848e57`；19:53:49 独立 Check 因普通权限无法读取全机无关高权限进程元数据而拒绝。BI/Worker 已停、Pi 原 token 已 ACK 并退出，其余应用仍在；不是零作用失败。原 STARTED/FAILED/actor 等原件不动。

恢复复用已实际采用的 19db 外置有限 driver/core/observer，精确改绑本次原件、前驱、制品、维护 ID。新恢复 owner 与原 owner 明确区分；原 owner/actor/子进程必须已退出，新 owner 必须普通权限并拥有新取得的原 rotation lease 与精确 pipe 身份。

| 原守卫 | 本次保留/必要差异 |
| --- | --- |
| 原 actor/owner 精确绑定 | 原 PID/子进程/复用均拒绝；原 owner 已退出，新 owner 独立 create-only 见证、进程创建时间/完整命令摘要/可执行摘要及 pipe PID |
| Pi token/ACK/原 PID/receipt | partial、Enter、stopped 在末次新鲜 census 后再次核原 admission token 摘要、原 receipt SHA（仍存在时）、原 PID 或子进程均不存在；状态/类型/重复键严格核验 |
| PowerShell 控制器 | 原任意 django/worker/operations/manual 脚本、两运行根与全部 EncodedCommand 简写拒绝；不因双锁或旧于 actor 而豁免 |
| 普通不可读相关命名进程 | 每个 fresh snapshot 请求独立高权限仅只读完整 CIM 见证，绑定原失败、intent、observer/owner 的精确进程身份和桥 SHA；120 秒内、所有新 PID/birth/parent/name 漂移拒绝，再对完整 exe/command 应用原分类 |
| native/Pandas 长期服务 | 只允许原 Resolve-OwnedProcess/Get-VerifiedProcessDescendants 确证的精确长期服务；其他 Pi 私有 WSL 测试等未知链仍拒绝，不终止其他任务 |
| 双生命周期锁 | 原 gate 模块 Check 内持 Worker→Django 双锁观察，释放 Django 后仍持 Worker，create-only Boundary 后同线程调用唯一原同 ID Enter；原完整 Stop/排空/停止身份/完成提交保持 |
| 已完成维护 marker | 本次不接受意外既有 drainedStopped marker 的跳过 Enter 分支；只能本次原 native 返回完整 maintenance/backendStopped 后继续 |
| 后续采用 | 只复用原已验证制品，原 Stop、DeployApp、HardenAcl、Worker apply、ExitMaintenance、Start、VerifyStartup、ready、catalog CAS；无 migration/业务重跑/通知 |

必要验证：Node 原编排 34 项通过；实际 PS5/PS7 每 shell 3 正例+28负例通过，包含原 Pi token/receipt/PID、运行根/source/编码控制器、见证过期/错 owner/observer/new PID/birth/parent/name 等；真实 footer+原 gate 模块私有 mutex 下验证双锁、释放 Django 后保 Worker、Boundary 写前与一次 native 替身调用，原 prepared receipt/完整树门禁在第一部署写前拒绝。均不持生产锁、不执行生产生命周期。原夹具失败（Test-Path 替身影响 Hash-File、PS7 JSON 日期自动转换）保留；PS7 已按原规范保留 ISO 字符串。

复审通过并由发布主负责人确认后，冻结外置根 `D:/codex-artifacts/pi-inventory-erp-publish-20261018/recovery-6dc-v3`，生产控制只以普通桌面 Node 运行 `driver.mjs execute <RECOVERY-INTENT SHA>`。每个 WITNESS-REQUEST 出现后仅由高权限只读 `witness.ps1 -RequestPath <原请求> -RequestSha256 <精确 SHA>` 生成完整临时文件、fsync 后原子发布不可覆盖见证。其他任何异常均保新 STARTED/FAILED，不自动重放。发布成功以新外置 RECOVERY-SUCCESS、真实两组件版本/必要服务及 catalog CAS 共同为准。

V1 新恢复于20:17:56以普通token启动，20:17:57在静态准入因共享origin/main推进848228b1而拒绝；execution目录空，无RECOVERY-STARTED/OWNER、未取rotation或运行native，保留原launcher/失败且不重调v1。V2仅去除可变远端ref等于目标的额外条件；实际调用assertFrozenSource保持冻结来源精确HEAD/tree/clean，原request/包/前驱/原失败及全部守卫不变。4项针对测试验证远端推进仍精确采用6dc、HEAD/tree/dirty任一漂移均拒绝；既有包/前驱等负例直接复用。未采用848，目标仍原6dc。

V2于20:23:02的Observe-1见证填补阶段，真实Win32_Process CIM只读ExecutablePath setter拒绝；未有Enter Boundary/native动作，原恢复STARTED/FAILED/OWNER/Observe失败保全，独立只读取证确认owner/observer退出、pipe不存在、原生产状态SHA未变。V3只将6字段复制到独立PSCustomObject投影后填见证，原CIM不变，保全部guard；追加pin原V2只读失败与独审V2-CIM-REFUSAL、新原参与者排除，不凭换root跳过unknown。PS5/7真实Get-CimInstance自身PID只取4身份字段，复现原setter拒绝；实际helper保持4身份、投影可写且CIM不变。每shell4正例/28负例通过，其他不变验证复用。V1/V2不重调。
