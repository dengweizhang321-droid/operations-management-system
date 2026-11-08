# 原生隔离控制器维护资格增量反审

日期：2026-11-08。审查范围：`b7280770fa5ff81e3939d6516f021c9f50b496a3` → `cf296d9e`，仅两个维护资格工具及两个专用测试。审查者未参与本增量方案或实现，沿原独立实现审查上下文复核；请求模型为 `gpt-6-astra/high`，工具没有独立回传实际底层型号。

## 结论

本小项通过，未发现阻断。资格仅接受登记的旧 main 控制器到 `b7280770` 控制器的精确方向及原始字节，不是任意同路径控制器准入，也不扩展生产发布或 unknown 恢复授权。该结论不证明完整原生冷启动、实际维护或生产发布成功。

## 核对内容

- `nativeIsolationControllerQualification` 固定 AI 前驱/候选和 Worker、Django、process-deadline 三组方向摘要；两个 native helper 另有固定摘要。旧 `pandasRotationControllerPair` 未改。
- Node 继续检查新旧 AI 的原 `Wait-PiWorkerExit`、`Stop-PiRuntime` 函数摘要，并检查四控制器及两个 helper。新资格继续返回 `native-exit-observer`，不进入旧 unknown 续接路线。
- 新资格结果保留原八项 `sourcePins`，在 `pins` 内加入两个 helper，并写明 `controllerQualification`。PowerShell 原 `Assert-MaintenanceReadiness` 对该资格要求精确 20 项集合、固定方向摘要及实际文件重新 hash；缺失、重复、额外、错误资格和重算摘要后的 helper 漂移均拒绝。原双锁调用位置、120 秒时效、Pi 回执/配置/CIM 身份检查未改。
- 原无资格字段的封存记录仍使用原集合；已审旧 Pandas 组合保持 18 pins。没有为兼容旧记录放宽新资格字段或新 helper 摘要。

## 检查证据

执行者原件：`D:/codex-artifacts/ai-native-control-isolation-20261108/qualification-r3.tap`，3/3 通过、无 skip；对应 stderr 为空。

审查者独立执行 `node --test tests/native-isolation-qualification.test.mjs`，原 Node 退出 0，3/3 通过、无 skip。包含正确方向、反向、混合、控制器字节漂移、helper 漂移，以及真实 Windows PowerShell 5 / PowerShell 7 的 pin 门禁反例和旧 Pandas 兼容检查。只使用临时文件及真实只读门禁，没有执行服务启停、网络请求或生产维护。

- 原始输出：`D:/codex-artifacts/ai-native-control-isolation-20261108/astra-qualification-r1.tap`（Node 默认 spec reporter 文本，扩展名不表示 TAP 格式），SHA-256 `216f64858fc7ad02e2bafe74cb895249328ff2976fa274c0e7c0bc2ca94a3a63`。
- 原始 stderr：`D:/codex-artifacts/ai-native-control-isolation-20261108/astra-qualification-r1.stderr.log`，空文件 SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
- 外层 Python 在已保存输出、已打印原 Node exit 0 后，因 GBK 终端不能显示勾号而产生 `UnicodeEncodeError`；随后只读回原件确认 3/3，未重新执行测试或更改原件。不能把外层显示异常当作 Node 测试失败，也不能隐去该异常。

## 与生命周期实证的边界

本小项没有复核近期实际 Start/Stop 的全部原件，不把负责人通报的首次启动失败、unknown 或 stale-receipt 恢复叙述计作成功冷启动。完整两轮原生启动/停止、实际就绪、精确进程收尾、旧资源保全和最终 G02 仍应按各自实证单独审查。此前 `4bce2a44`、`9b7c1e6a` 及字节固化增量的有限代码审查结论保持其原范围。
