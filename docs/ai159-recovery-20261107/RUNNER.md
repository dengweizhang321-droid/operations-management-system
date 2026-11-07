# AI159 Runner 原操作恢复

发布 `e030caba1271d47fced663649f288855234a02e2` 的 Runner 操作是 `88b7e64f18dd4afdb67869895c5d7f1e`。原注册计划为 `58f8ce87c52d0040fe448131679baa72c5963e3e5b5bb9dcd1c1c4ee32c75d5a`。原升级进程于 2026-11-07 13:55:22.429 开始，13:55:59.709 直接退出 1，原日志无外层超时。Linux 已切换新 unit 并持久化 `unknown`，随后服务停止，原 Status 返回 `linux_successor_not_active`。

候选账本唯一 nonce 的时间是 13:55:59，与原失败同秒。原签名探针先提交 nonce，Runner 连接采用 WAL。通过探针后，`runtime_upgrade.apply` 会马上用拒绝非空 WAL 的 `state_manifest` 计算候选摘要。隔离 SQLite 用原 `Ledger.nonce` 将 WAL 从 0 变为 8272 字节，随后原 `state_manifest` 抛 `ledger_wal_not_checkpointed`。这条路径与同秒的 nonce 和退出吻合。原外层只保留通用失败，未捕获具体 Linux 异常。服务在原进程退出约 14 秒后正常停止，维护阶段已停正式 WSL 保活进程，符合 WSL 失去保活后回收的推断。证据不足以确定当时的 WSL 停止触发者。

## 恢复边界

- 只由本次外层恢复入口在原 publication queue、rotation 和 lease 内调用。原 Django mutex 内重核维护 ID、已安装应用、原失败字节、原 PID 退役、AI/Pi 端口和工作进程。恢复用 Windows keeper 使用独立日志及 PID、创建时间、可执行文件和完整 argv 回执。
- 原 Status 的固定字节和静态门禁照常核验。候选配置及 unit、加载的 `ExecStart`、目录和前驱账本须绑定。等既有 rootless Docker 就绪，核镜像、socket 和容器静止。当前候选 state 摘要单独保留。原 intent 中的是启动前复制摘要，正常启动和签名探针已修改候选 SQLite。
- 候选会话均须为 `stopped` 或 `disposed`，活动控制及未完成 helper 必须为空。15 条历史 `gateway.unknown` 逐条要求唯一归属原停止或已释放的会话。回执只保留数量和包含原 operation、request、digest、session identity 摘要和状态的组合摘要，历史请求原样保留。
- 在原 attempt 新建 `PiRunnerRecovery-started.json`，记录本次独立 invocation、keeper、固定原计划、前驱和候选摘要。Linux 同次调用重新核对停态观察，再发一次 `systemctl --user start teruisi-pi-runner.service`。原始输出与直接退出单独保存；随后只读验证同 WSL user manager 下的新 unit invocation、精确 PID 与其监听 socket。任何失败均保留 keeper 与已写证据。
- 使用原 `reconcileMainPiUpgrade` 的单次协调 guard、原 `ReconcilePiUpgrade`、原 `VerifyPiUpgradeResult`。原 Reconcile 用停态前驱摘要和新 Runner 的签名证明，读取原 intent 的候选复制摘要。原尾部启动正式 Pandas keeper、通过 ready 且 catalog 协调成功后，才按进程出生和 argv 证据终止本次临时 keeper。原 attempt 的已存记录与冻结包字节保持原样。

## 隔离检查

在恢复 worktree 执行 `py -B tests/ai159_pi_source_recovery_test.py -v`。使用临时 SQLite 账本与注入的 Linux 调用，覆盖真实 nonce/WAL 缺陷、历史请求归属、Docker 拒绝、启动前状态变化、一次启动和输出丢失后的精确活动证明。`node --check tools/ai159-pi-source-recovery.mjs` 和 PowerShell AST 解析用于入口语法检查。测试使用隔离夹具，生产 WSL 与发布状态未执行恢复变更。
