# S05d 固定普通权限交接入口

本页是隔离实现交付，尚不代表真实 Task 已注册、控制材料已采用、来源已封闭或 Windows 已重启。现场只有 root 串行操作；本叶任务不注册/启动 Task，不采用材料、不重启、不碰生产队列、服务或数据库。

## 固定契约

入口为 `tools/preparation-retirement-handoff.mjs`，仅接受 `--action prepare|register|run|status|cleanup`；内部 `execute` 还必须来自冻结宿主、精确 Task 唯一实例与真实普通权限父进程。phase 仅有：

| phase | 实际唯一调用 | 额外输入 |
| --- | --- | --- |
| `control-prepare` | 原 `install-main-prebuild.mjs` 的 `prepareControlUpgrade` | 不存在的绝对 `--materials` 输出目录；来源自动取当前入口所在干净 Git 检出 |
| `control-adopt` | 原 `install-main-prebuild.mjs` 的 `adoptControlUpgrade` | 绝对 `--materials` 与完整材料树 `--material-sha` |
| `plan` | 已采用 bundle 的 `executeRetirement` | 原 `--dispatch` |
| `close-sources` | 同一 bundle 的固定关闭阶段 | 原 dispatch 与 `--intent-sha` |
| `seal-after-retirement` | 同一 bundle 的固定封存阶段 | 原 dispatch、intent；可显式 `--after-logon` |

没有外部程序/脚本参数、任意 argv、命令字符串、根目录透传、任意 proof、resume 布尔或 shutdown 能力。来源、闭包与 Node 均在 RUN 绑定 SHA；控制准备和采用不触碰原 preparation Task 的参数。原 installer 的三锁、旧代际 CAS 和原生回执仍执行。

宿主两文件 create-only 冻结到 `<state>/retirement-handoff/hosts/<SHA>/`。每次 run 另建 `<state>/retirement-handoff/runs/<UUID>/`，保存 RUN、TASK、原 config 字节、必要 installer 导入闭包。退休阶段始终执行已采用 bundle，不能拿临时复制的核心绕过原 expectedBundle gate。root 约定最终控制源码为精确最终提交的干净 detached `D:/codex-artifacts/s05d-retirement-implementation-20261023/control-source`，不依赖将被移走的旧 source。材料输出为同任务 artifacts 下全新 `control-upgrade`（冲突即拒绝，必要时根目录中使用精确 run 子目录并记录）。

## 现场确切入口

以下变量由 root 以现场实际值填写；`$node` 必须为本次已核 SHA 的绝对 Node，`$handoff` 指向最终干净控制源码中的入口，不能使用正在编辑的检出。命令均是具体固定阶段，没有可追加业务参数。

```powershell
$node = '<absolute-node.exe>'
$handoff = 'D:/codex-artifacts/s05d-retirement-implementation-20261023/control-source/tools/preparation-retirement-handoff.mjs'
$config = '<absolute-main-publisher-config.json>'
$materials = 'D:/codex-artifacts/s05d-retirement-implementation-20261023/control-upgrade'
& $node $handoff --action prepare --config $config --phase control-prepare --materials $materials
```

上一步只生成交接材料，返回 `runFile/runSha256/taskName`。root 先审这份精确 RUN/TASK，再以返回的两个值执行：

```powershell
& $node $handoff --action register --run '<returned-RUN.json>' --run-sha '<returned-SHA>'
& $node $handoff --action run --run '<returned-RUN.json>' --run-sha '<returned-SHA>'
& $node $handoff --action status --run '<returned-RUN.json>' --run-sha '<returned-SHA>'
```

`run` 只表示提交唤醒。`status.nativeCompleted=true` 同时要求原 native 回执、STARTED/PARENT/RESULT 互绑、外部 PS 对 Node 的真实 direct exit、日志原字节 SHA/长度全部闭合。Task last result 只作为 advisory 返回；outputComplete 单独报告，不能把 EOF 等待当 direct exit。控制准备成功后，`RESULT.json.native.materialSha256` 是采用阶段所需完整材料树 SHA：

```powershell
& $node $handoff --action prepare --config $config --phase control-adopt --materials $materials --material-sha '<exact-RESULT-native-materialSha256>'
# root 核新 RUN/TASK，然后按上面的 register → run → status 调用。
& $node $handoff --action prepare --config $config --phase plan --dispatch '<original-dispatch>'
# root 核新 RUN/TASK，并 register → run → status；intent SHA取原 INTENT.json原字节。
& $node $handoff --action prepare --config $config --phase close-sources --dispatch '<original-dispatch>' --intent-sha '<exact-native-intent-SHA>'
```

关闭成功后，root 先按 [现场清单](LIVE-RUNBOOK.md) 保存 SOURCES-CLOSED、准确 intent SHA 与续接位置，完成就绪清单后安排已授权 Windows 完整重启。默认在重登后恢复 root 会话，确保能及时完成两轮独立 observer，再准备并启动 demand seal：

```powershell
& $node $handoff --action prepare --config $config --phase seal-after-retirement --dispatch '<original-dispatch>' --intent-sha '<same-intent-SHA>'
& $node $handoff --action register --run '<returned-RUN.json>' --run-sha '<returned-SHA>'
& $node $handoff --action run --run '<returned-RUN.json>' --run-sha '<returned-SHA>'
& $node $handoff --action status --run '<returned-RUN.json>' --run-sha '<returned-SHA>'
```

`--after-logon` 仅为可选续接：必须在关闭成功后、重启前确认观察人员及两轮 observer 响应已经就绪，避免 root 会话尚未恢复时耗尽核心观察期限。确需该方式时：

```powershell
& $node $handoff --action prepare --config $config --phase seal-after-retirement --dispatch '<original-dispatch>' --intent-sha '<same-intent-SHA>' --after-logon
& $node $handoff --action register --run '<returned-RUN.json>' --run-sha '<returned-SHA>'
# 不调用 run；logon 任务禁止 demand start。root 确认观察响应事先就绪后另行安排已授权 Windows 完整重启。
```

prepare 先通过原 reader 读取/核对 SOURCES-CLOSED 及内容引用；核心执行时原生采集 boot 并证明 source-close 之后的新 full boot，可选 logon 方式还会在进入核心前重复验证。不接受手填“已重启”。原 SID 固定；默认 demand 在重登后准备并冻结本次 session。可选 logon 允许重启后的 session ID 变化，只允许本次原用户的正交互 session，PS/Node/Explorer 均须一致，实际 session 写入 PARENT/STARTED，独立 observer 再核原生 token。

封存等候观察请求时，`stdout.log` 持续落盘核心 `onStage` JSON；root 从中取核心生成的固定只读 observerCommand，按该协议执行独立观察。这里没有新增高权限执行阶段。普通 Node 同进程调用核心；PS 只负责固定宿主、输出和 direct exit。新退休协议只资格化这一个 manifest 绑定的 PS 父进程，不改旧 census/installer selector，也不允许任意父链。

## 一次性与失败边界

Task 为 `InteractiveToken/RunLevel=0`，同原 SID；demand 用 `RunEx(USE_SESSION_ID|USER_SID)` 固定准备时 session。没有 restart、catch-up、battery/idle/network 延迟、唤醒或硬终止；重复实例 ignore。注册使用 create-only，已存在的同名任务必须完整 owner tag/定义匹配且 state=ready、instances=0，未知任务不覆盖。原生 COM 内存定义投影已私有核对，没有以注册真实任务作实验。

PS 在 token/Explorer检查之前 create-only 写 ATTEMPT，因此首次 logon 先消费本次 run；仅 seal-logon 在 Node 前用Stopwatch单调时钟最多30秒等待同原SID当前session的Explorer（250ms间隔，owner不可读立即拒绝），demand不等待。身份拒绝或到期仍无Explorer同样保留已尝试证据。REQUESTED、ATTEMPT、PARENT、STARTED、RESULT、EXIT 任一中断均保留；无可信完成时报告 unknown，不自动换 runID、复用 Task 或重放同阶段。后续登录只拒绝已尝试 run。RUN/TASK/host/config/source/material/Task定义有漂移同样拒绝，不能用 Task 返回 0 或旧同版本日志补成功。

只有 `nativeCompleted=true` 且 Task ready/无实例，root 才可调用 `cleanup` 删除这个精确拥有的 Task。全部冻结宿主、RUN、原始回执和输出保留；unknown/活动任务不自动删除。本工具不清理控制来源、旧 source、archive、服务、原 queue 或原 unknown，也不恢复旧入口。

## 必要检查

`node --test --test-timeout=60000 tests/preparation-retirement-handoff.test.mjs` 已通过 12/12：固定 phase/结构/透传拒绝、普通 token/SID/session 断言与原用户新 logon session、环境注入拒绝、原生 COM 内存两种 Task 定义、原 installer selector 的固定命令形状、真实 EncodedCommand/native commandline 传输、完成回执交叉及中断反例、真实 CLI 拒绝、PS5/PS7 parser、真实 runner 的 SID/session 拒绝与首效前无业务子进程。没有注册/启动任何 Task，没有完整构建或生产操作；真实普通 Task 路由仍由 root 在最终代码独审后按清单核验。

新增logon时序检查单独运行1/1通过：直接抽取实际runner的admission函数，在PS5与上述真实PS7上覆盖demand不等待、同SID/session的Explorer迟到一次、owner不可读立即拒绝、单调期限到期拒绝。仅在私有测试替换CIM/owner传输与期限时钟，无Task注册/启动或业务调用；原12项有效证据与新增项分开保存，避免把增量结果冒称完整重跑。最新摘要见handoff-checks-admission.json。

固定OS宿主兼容增量：本机System32 PowerShell原生叶nlink=2。仅无外部路径参数的readHandoffSystemHostBytes角色允许该固定OS文件的原生硬链接；仍逐次核realpath、祖先非reparse、句柄dev/ino、读取前后全部metadata（含nlink）及运行绑定SHA。RUN/冻结代码/材料等默认bytes角色继续要求单链接。实际OS叶只读资格、外部路径拒绝和私有source双链拒绝定向1/1通过，证据handoff-checks-system-host.json；未注册或运行Task。
