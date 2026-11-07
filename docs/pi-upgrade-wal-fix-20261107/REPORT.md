# Runner 升级 WAL 通用修复

2026-11-07 开发候选，基线 `e030caba1271d47fced663649f288855234a02e2`，分支 `codex/pi-upgrade-wal-fix-20261107`。用户本次授权修复、隔离验证与逐项 Astra 反审；本次没有合并 main、准备生产制品、采用控制器、发布、迁移或操作生产服务。

## 结果与改动

1. **正常升级 WAL 冲突。** `apply` 在候选启动前已经封存复制完成的 `candidateStateSha256`。健康请求经过真实 HMAC 校验后写入 nonce，产生正常 WAL；旧实现却再次用停机态 `state_manifest` 检查在线候选，抛出 `ledger_wal_not_checkpointed`。修复后只把原 intent 改为 `runner_verified`，返回原封存摘要。旧版本停机要求、WAL checkpoint、复制前后摘要、单位与密钥绑定、unknown 不重放和故障保留均保持。
2. **失败诊断。** Windows/WSL 保留固定阶段、经过白名单的原因及直接退出码，不打印原始异常、凭据、客户数据或 traceback。实际本机 WSL 的 UTF-16LE 警告与 UTF-8 JSON 混合边界另补了精确处理。详见 [诊断与测试](DIAGNOSTICS.md)。
3. **真实升级回归。** 除真实 HTTP/SQLite 的定向故障测试外，运行原有 `SourceUpgradeRealTests`，实际经过独立 systemd 服务、rootless Docker、签名请求、在线 prepare、停机、复制、切换、对账与同会话继续使用。补齐旧测试夹具的前驱 cwd、现行 admission 和启动超时错误，并添加活 WAL、封存摘要和禁重放断言。原 symlink 测试改用空目标，避免先命中非空 WAL 门禁，从而确实验证符号链接拒绝。

以上是可复现的正常升级缺陷及修复，不将缺失原始异常的历史生产事故断言为已经唯一归因。

## 验证证据

| 检查 | 实际结果与边界 |
| --- | --- |
| 完整真实 Linux Runner 升级，原 runtime | 按预期失败，明确 `ledger_wal_not_checkpointed`，intent 为 `unknown`；见 [原版日志](baseline-stderr.log) |
| 相同场景与测试文件，修复 runtime | 通过，intent 为 `runner_verified`；同会话历史、准备后的新增状态、unknown 和同一通道密钥保留，原 PID 对账不重启，重复 apply 被拒；见 [修复版日志](fixed-stderr.log) 与 [原生结果](real-results.json) |
| 定向真实 HMAC HTTP + SQLite | 3 项通过：活 WAL 成功、启动失败恢复旧 unit 且不启动旧服务、丢响应保留 unknown 后按原 intent 对账。此组 mock systemctl/Docker，不能单独替代上一行真实生命周期 |
| Windows 诊断 | 15 项通过，包含真实私有 Python 子进程、混编码与畸形诊断；实际 Windows→WSL 无效测试 namespace 的入口拒绝返回 `fixed_upgrade_owner_required` / exit 1，未进入业务 dispatch |
| Windows DPAPI 原回执 | 1 项通过，覆盖原用户密钥、丢响应及文件碎片 |
| 原升级状态契约 | 15 项通过 |
| 停机态 manifest | Linux 3 项通过，包含真实符号链接拒绝，未跳过 |

完整真实演练使用两个全新 `pi-test-wal-*-394bc1ca14` namespace、独立动态端口、合成凭据和业务输入；没有连接真实付费模型。旧新镜像均为已有的同一只读 image ID；本次验证源码升级，不声称验证镜像变更。模型响应由测试通过真实 `gateway_response` 协议提供。

前驱使用基线 Git archive，加一个不改变执行逻辑的 `wal-test-predecessor.txt`，使它与原版候选具有不同的源码身份；原版候选仅将修复后的 `runtime_upgrade.py` 换回基线，两个候选使用完全相同的现行测试文件。原版与修复版 runtime SHA-256 分别是 `6d564f5362f2fe32360a816c050144c7d215b839ee88325b9638fdbcdef3d47d`、`05faac49a96ce0546d890c5a449ff4a7f626e2d3b8f7f1e0893296f15366ac01`。修复版 Runner source SHA-256 为 `67bf8e2a70fe7f76c19fbf9cdca631934b1455c9845e7e6aed787f3d10a6759a`。

两个最终演练的测试服务 unit 已移除，测试容器和卷均为空；保留隔离状态文件作审查证据。辅助脚本、额外检查日志和原始证据在 `D:/codex-artifacts/pi-upgrade-wal-fix-20261107/`；Linux 隔离源与状态位置写在原生结果中。前两次夹具调整期间的测试也已清理对应服务、容器及卷，未作为成功证据。

## 复用与后续边界

定向命令：在 `backend` 目录运行 `python -B -m unittest -v pi_runner.test_runtime_upgrade.SourceUpgradeSignedProbeTests`（Linux）及 `pi_runner.test_runtime_upgrade.WindowsSourceUpgradeReceiptTests`（Windows）；仓库根目录运行 `py -3.12 tests/pi-upgrade-runtime-diagnostics.test.py`、`py -3.12 tests/pi-upgrade-status.test.py`。完整真实演练使用 `PI_RUNNER_TEST_CONFIG`、`PI_RUNNER_LEGACY_SOURCE_DIR`、`PI_RUNNER_UPGRADE_FROM_IMAGE` 三项独立夹具环境变量运行 `pi_runner.test_runtime_upgrade.SourceUpgradeRealTests`，配置必须属于全新私有 `pi-test-*` namespace；不得使用生产配置作为测试输入。

独立 [Astra 反审](REVIEW.md) 按上述三个子项给出结论。审查独立于实现与测试设计，并独立复跑定向检查。此修复尚未进入 main 或已安装运行包，因此当前线上仍不能被称为已采用通用修复。后续获得本次合并授权后，从最终合并提交按现行发布契约准备制品；修改 Windows 控制器源后须沿用原生来源绑定及采用门禁，不改旧包摘要，不把测试成功当作发布回执。上线仍须单独明确授权。
