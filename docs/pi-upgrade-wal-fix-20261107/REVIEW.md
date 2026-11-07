# Runner WAL 升级修复独立反审

日期：2026-11-07。按用户本次明确要求，以独立 Astra 审查上下文核对；审查者未参与方案制定或实现，未修改被审代码。请求角色为 Astra，工具未另行提供底层型号证明。基线为 `e030caba1271d47fced663649f288855234a02e2`；审查覆盖核心 `d250e735`、夹具 `ec64d898` / `fc9733ec`、诊断 `36585c9b` / `d788535a` 及 state-manifest 空目标夹具增量。

## 各小项结论

| 小项 | 结论 | 核验依据 |
| --- | --- | --- |
| 通用 WAL 修复 | PASS | 签名健康请求真实写 nonce；只保留 switching 时候选停机摘要，不再对运行中候选取停机 manifest |
| Windows / WSL 失败诊断 | PASS | 独立运行 15 项诊断测试及真实 Windows→WSL 固定 namespace 拒绝；安全原因、阶段与 direct exit 均保留 |
| 完整真实 Linux Runner 源码升级 | PASS | 相同测试夹具 baseline 精确 WAL 失败，fixed 成功；直接复核隔离 WSL 原 intent、proof 和源码摘要 |
| state-manifest 符号链接夹具 | PASS | 空目标让测试到达 link guard；Linux 日志 3/3、无 skip；生产算法未改 |

没有发现本次范围内尚未解决的实现阻断。结论仅针对开发候选，不构成合并、制品准备、生产采用或上线授权。

## 核心语义与失败保护

`Handler.do_POST()` 验签后调用 `Ledger.nonce()`，其事务写入 WAL；因此健康响应成功并不意味着运行中账本适合停机摘要。原代码在成功探测后再次调用 `state_manifest(new/'state')`，会以 `ledger_wal_not_checkpointed` 抛错，随后将已经运行的候选记为 unknown。修复只把 intent 状态更新为 `runner_verified`，复用启动前已持久保存的 `candidateStateSha256`。

逐一检索该字段的 runtime、Windows status、回执与测试消费者：实际消费者核对 intent/result 的同源绑定，没有消费者要求其为在线实时摘要。`freshStateSha256` 仍绑定前驱停机快照；候选摘要允许包含备份后既有 image 字段补齐的差异，并非强制等于前驱摘要。

前驱 unit/config/key 校验、停止状态和 MainPID、旧进程扫描、容器停止、checkpoint、备份、复制期间前驱摘要复验及 unit CAS 均未放宽。启动确定失败仍恢复原 unit 并保持前驱停止；候选可能已存活时保留两份状态及 unknown，不自动拉起旧 Runner。原 intent 存在仍禁止再次 apply。reconcile 保留原 intent、核对旧快照、当前来源/unit/config/key 和签名健康，只协调结果，不重启或重新复制。本次未把在线 WAL 忽略、清空或强制 checkpoint。

审查者在私有 WSL 夹具独立运行 `SourceUpgradeSignedProbeTests` 3/3：真实 HTTP Handler / SQLite nonce WAL，服务控制和 Docker 为 mock；覆盖成功、启动失败、响应丢失后协调。这组测试不能称为完整真实生命周期。

## 完整真实升级证据

审查读取 `D:/codex-artifacts/pi-upgrade-wal-fix-20261107/real-results.json`、`baseline-stderr.log`、`fixed-stderr.log`、`run_isolated.py`、`run_windows.py`，并用独立只读 WSL 脚本直接读取以下隔离目录的源码摘要、原 intent 与 proof：

- `/home/teruisi-pandas/pi-test-wal-baseline-394bc1ca14`：exit 1；日志准确落在成功签名探测后的 candidate manifest，报 `ledger_wal_not_checkpointed`；intent 为 unknown。
- `/home/teruisi-pandas/pi-test-wal-fixed-394bc1ca14`：exit 0；intent 为 `runner_verified`；proof 为通过。

两边实际测试文件 SHA-256 相同：`1142e4e49227ddad73aa2420d929b24af3abb737ec6e2a0441c317b8b6599a18`。baseline runtime SHA-256 为 `6d564f5362f2fe32360a816c050144c7d215b839ee88325b9638fdbcdef3d47d`；fixed 为 `05faac49a96ce0546d890c5a449ff4a7f626e2d3b8f7f1e0893296f15366ac01`。

实际测试使用 Linux user systemd unit、rootless Docker、签名 HTTP 和 SQLite，运行在线 prepare、prepare 后继续会话、旧 Runner 丢失与隔离容器停止、新源码复制/切换/启动、reconcile 和原会话续接。固定测试断言在线 WAL 非空、前驱快照保持、apply 拒绝重放、reconcile 前后 PID 相同、unknown 保留、prepare 后会话历史及下载字节保留、channel key 相同。两次结果均记录本次 namespace 容器和卷为空、unit 已移除。

证据边界：前驱为 e030 源码加无行为的 `wal-test-predecessor.txt` 标记，以形成不同 source digest；baseline 与 fixed 使用相同现行夹具，baseline 仅替换原 runtime_upgrade.py。旧新 workspace image 相同，模型回复由合成 `gateway_response` 提供。该证据证明完整真实 **Linux Runner 源码升级**，不证明镜像升级、真实供应商模型调用、完整 Windows 原生发布器或生产升级。此前 gateway 路径、旧源码 cwd 和 admission 的夹具失败不算 WAL 复现，最终结论只取上述有效批次。

## 诊断与其他核验

审查者独立运行 `tests/pi-upgrade-runtime-diagnostics.test.py` 15/15、`tests/pi-upgrade-status.test.py` 15/15，以及从 backend 工作目录运行 `WindowsSourceUpgradeReceiptTests` 1/1。后者使用真实 CurrentUser DPAPI 与临时文件；初次从仓库根目录运行因 `pandas_runner` 导入路径失败，纠正调用目录后通过，不将其当作实现缺陷或隐藏失败。

诊断只接受有界、单条、字段与动作匹配的静态白名单记录；未知异常映射固定类别，不转发异常文本、路径、argv、原始 stderr 或 traceback。非零退出不接受成功 stdout，timeout/启动失败的 directExitCode 为 null，诊断不重试或发布配置。混编码修复仅剥离观察到的 UTF-16LE 警告换行留下的一字节 NUL，不改 JSON 内部或任意前缀。独立真实调用 `invoke({'action':'check','namespace':'pi-test-diagnostic-rejection'})` 得到 `linux_check / fixed_upgrade_owner_required / directExitCode=1`，固定 namespace 校验在读取配置及导入 dispatch 前拒绝，未访问生产。

既有 symlink 测试原目标为非空，先被 WAL 非空门禁拒绝，导致 Linux 错误码断言不匹配；baseline 与修复版安全行为一致。目标改为空仅让测试专门验证 link guard，原非空 WAL 用例仍在。审查读取 `manifest-wsl.log`，3/3 通过；此前 Windows 该测试因权限不可创建链接而 skip，不能替代 Linux 结果。

审查未操作生产运行目录、生产服务、生产状态或端口 8123；独立 WSL 访问限定于本次隔离文件与提前拒绝的诊断调用。

## 最终报告一致性

已核对 [主报告](REPORT.md)、[诊断报告](DIAGNOSTICS.md) 及仓库内最终原版/修复版日志与结果副本。实际完整生命周期为一个场景的原版/修复版对照，不是 15 个完整生命周期测试；原版失败未被写成成功，候选与生产边界清楚。源码实测摘要与当前 worktree 文件一致。主报告原先易误解为实现、测试、审查三方彼此独立的表述，已按反审意见修正为“审查独立于实现与测试设计，并独立复跑定向检查”，报告一致性检查通过。
