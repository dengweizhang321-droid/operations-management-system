# 私有凭据入口拒绝修复反审

日期：2026-11-08。对象：`e800824962cbccf094d0616583ca013b798380f3`，沿原独立实现审查上下文增量核对。审查者未参与实现；请求模型 `gpt-6-astra/high`，实际底层型号未由工具独立回传。此前维护资格审查见 [REVIEW-QUALIFICATION.md](REVIEW-QUALIFICATION.md)。

## 结论

修复通过。原缺口关闭：有效隔离 profile 下，AI `ConfigureCredentials` 在 `Get-NativeRuntimeRoot` 动作门禁提前拒绝，不再可能沿缺失私有凭据分支读取生产 `D:/运营管理系统/.dev.vars`。本轮没有读取生产凭据或执行生命周期。

实际应用改动仅为从 `tools/native-isolation.ps1` 白名单删除一个 `ConfigureCredentials` 项。独立检查将新文件与 `b7280770fa5ff81e3939d6516f021c9f50b496a3` 的原始 Git 字节比较，确认唯一一次精确替换后全部字节相同。无 profile 的原默认行为和隔离 Start/Stop 映射未改。Node 与 PowerShell 两处维护资格同步固定新 helper SHA-256 `a5499003d2e269b8a3d6cdb6bce70fcd2f02434c541620ccdaa151f0c7f52343`，控制器方向 tuple、20 pins 要求、旧 Pandas 18 pins 和原 unknown 恢复边界保持。

## 独立验证

审查者执行：`node --test --test-reporter=tap tests/native-isolation-credential-gate.test.mjs tests/native-isolation-qualification.test.mjs`。原进程退出 0，5/5 通过，无 skip、空 stderr。

- 真实 PS5/PS7 使用有效新私有 profile 调用 AI `ConfigureCredentials` 参数入口，均由明确的动作门禁原因拒绝；不是缺文件或参数失败。
- 纯 helper 核对隔离 Start/Stop 映射不变，以及无 profile 的生产默认映射不变；没有调用生产凭据配置。
- 原维护资格的方向、漂移、精确集合、helper 固定摘要与旧 Pandas 兼容反例继续通过。

审查者原件：`D:/codex-artifacts/ai-native-control-isolation-20261108/astra-credential-gate-r1.tap`，SHA-256 `75a6bae635147e5db06503975c7b70df1d06524839b8bc1a5d48c2f80842108f`；对应 `astra-credential-gate-r1.stderr.log` 为空，SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。执行者 `credential-gate-r1.tap` 的原 5/5 结果也已核对，未替换原件。

## Pandas pending 分支的范围判断

该分支不需要再扩修。当前私有 profile 不允许 Prepare/Switch/CompletePandasRotation，正常私有安装没有 pending。即使 Start 读到 pending，原 prepared receipt 的 runtime/部署清单绑定和 publication owner 门禁仍在；更下层 `tools/pandas_broker_rotation.py` 的 `run()` 还要求 `HERE.parent` 精确等于固定生产 `PROTECTED_RUNTIME/app`（prepare/check 则为对应 app.deploy 路径）。实际私有 app 路径会在读取 operator、生产 config/key 或调用 WSL 前抛出 `protected_windows_runtime_required`。

审查者已作无文件写入、无网络的纯函数反例：只在内存中把该模块 `HERE` 设为本次私有 app/tools，给出合法 prepared ID 和 `startup-check`，将 `ordinary` 与 `subprocess.run` 替换为调用即失败的哨兵。实际先抛固定 runtime 拒绝，两个下游哨兵均未调用。因此不把伪造 lease 的理论场景扩大为生产 WSL 可达。私有 pending/rotation 仍是不受支持、保留记录并失败关闭的路径；未来若放宽底层固定 runtime，必须同时复核固定 WSL distro，不能沿用本结论。

## 冷启动证据绑定边界

正常原生启停实证的应用字节为 `b7280770`，不包含本次拒绝修复。可以在最终资格中明确复用该正常路径证据，并另外绑定本次唯一未调用动作的提前拒绝及新 helper 精确摘要；不能声称旧包已包含修复，不能热改封存包。本报告不替代完整两轮原生启停、最终释放、旧资源保全和 G02 原件的独立核验，也不授权合并或上线。
