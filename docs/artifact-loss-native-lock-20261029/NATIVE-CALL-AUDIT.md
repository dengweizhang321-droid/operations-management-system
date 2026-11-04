# 核销分支原生接口逐项核对

对象为 BASELINE.json 中实际固定 D08 三文件，不用开发仓库的新版本代替。以下将真实执行与静态接口核对分开；本轮未执行生产链读取、真实核销或生产锁。

| 接缝 | 实际接口与调用形态 | 本轮证据范围 |
| --- | --- | --- |
| CLI `--retire-lost-artifacts` → `retireLostMainArtifacts` | handler 从 `config.nativeToolsSource` 动态导入，调用 `rotation.withRotationLock(operation)` | 专用子进程真实执行该共享 handler、D08导出及原生锁逻辑；固定 CLI 分支调用 handler 的接线与原门禁保留另有静态断言。 |
| 原错误调用 | D08 没有 `acquirePreparationRotationLock` | 同一 D08 副本执行旧语句明确产生 TypeError，且初次失败不进入核销追加；不以仓库新版里存在该导出来替代核对。 |
| R1b collector 的源绑定接口 | `api.validateWorkerSourceBinding(sourceEnvelope)`；D08 签名 `(envelope, {predecessor, predecessorChainStateSha256, identity} = {})` | 导出、参数形态静态相容。本轮锁测试未执行真实源绑定验收。 |
| R1b collector 的链读取接口 | `rotation.resolveEffectiveReleaseChain({verifyInstalledHead:false})`；D08 签名 `(options = {})` | 导出、参数形态静态相容；未运行生产链读取。seal读取不申请rotation锁，未发现回调内再入相同锁。 |
| `loadRetirementNativeTools` 的导出门禁 | `api.hashRelativeFiles(root, relativeFiles)`、`api.windowsPathSha256(value)` | 实际 D08 均有导出；此 loss→seal 路径对它们只做 typeof 门禁，不宣称调用执行。 |
| 同 loader 的常量门禁 | `treeHashAlgorithm`、`workerRuntimeRoot`、`workerSourceRoot`、`workerLegacySourceRoot`、`workerDevVarsSource`、`rotation.djangoSalesRuntimeRoot` | 静态核对实际常量；算法为 `sha256-ordinal-path-length-content-v1`。 |
| `native.sourceDigest` | 本 bundle 的 `hashRetirementSourceInventory` 别名，seal reader 使用 seed | 不是 D08 原生导出，不混称原生摘要函数真实执行。 |
| `readD1RetirementReceipt` | D08 rotation 的静态 import 依赖 | 三文件闭包摘要与实际模块导入覆盖，未执行生产 D1 证明读取。 |
| 其他前置门禁 | `assertControlGeneration`、`readAdoptedControl`、`controlExecution`、退役 scope/admission、系统 PS5 普通权限探针 | 使用原 bundle/API 或绝对系统路径，本轮保持；未发现第二处同类导出或签名不匹配。隔离测试注入的 generation/admit 不能代表完整生产 CLI 身份验收。 |

## 真实适配器测试边界

专用 driver 校验三文件固定 SHA 和私有路径，在独立子进程覆盖 `net.Server.prototype.listen` 的**传输地址**：只有精确生产轮转管道名被改为本用例唯一的私有管道；其余地址只允许本私有队列锁、提交锁和该私有轮转管道。未知地址直接拒绝，转发生产管道前再次断言禁止。未替换 native 锁函数、adapter 或核销 writer。

九种模式的实际统计见 [NATIVE-ADAPTER-RESULTS.json](NATIVE-ADAPTER-RESULTS.json)，原始 TAP 见 [PROTOCOL-FINAL.tap](PROTOCOL-FINAL.tap)：

- success：全部阶段中三锁均被占用，核销结束可重获。
- throw-before-write：回调首次抛错时两个核销目录不存在，全部锁释放。
- throw-after-record：完整旁记录追加后抛错，全部锁释放；仅在私有用例内按同一清单对账完成。
- busy：原生锁被私有占用时回调不进入，核销目录不创建，queue/submission释放。
- queue-busy / submission-busy：在外层拒绝，尚未申请原生锁。
- generation / admission：在前置门禁拒绝，尚未申请原生锁。
- old-call：原错误语句在相同真实导出集合上明确 TypeError，不进入核销追加。

失败模式随后在私有用例中解除故障并重获锁，以验证没有泄漏；因此结果JSON最终 `status=retired` 是私有验证后半段的成功，不表示失败初次写入或生产核销成功。全部九项 `forwardedProductionListens=0`、`allLocksReacquired=true`、`pendingUnchanged=true`。
