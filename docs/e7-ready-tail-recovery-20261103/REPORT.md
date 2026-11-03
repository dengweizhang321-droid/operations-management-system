# e7aaf6c1 ready 尾部记账恢复候选

2026-11-03，本目录只完成候选源码、原件证据配方与隔离必要检查。未运行生产 probe、未执行 `--apply`、未写生产记账，未启动、重启、重发、迁移或发送。负责人完成独审并决定只读 probe 后，实际记账仍须用户另行明确授权。本报告不是生产完成回执。

本次目标固定为 `e7aaf6c16939770d0941994873747fe301ef0b93`；原冻结来源为 `D:/codex-isolated/main-release-packages/e7aaf6c16939-f23d8bf6-5aaa7584/source`，原 attempt 为同父目录 `publish-e7aaf6c16939`。原发布在最后“确认服务可用”遇到 ready503 而 FAILED。负责人提供的只读观察显示之后 ready200；本候选不把该历史观察当作执行时的新鲜事实，不追认原发布成功。

## 固定实现及证据

[recover-ready-tail.mjs](recover-ready-tail.mjs)、[observe-retirement.mjs](observe-retirement.mjs)、[retirement-witness.mjs](retirement-witness.mjs) 复用此前 eab 已审实现，只替换本次精确 commit、冻结包、恢复 ID、证据/回执/见证 version、见证根及任务路径。恢复 ID 为 `e7aaf6c1-ready-tail-20261103`，见证根为 `D:/codex-artifacts/e7-ready-tail-recovery-20261103/witness`。新增固定绑定回归，防止 writer、observer、recipe 和见证根串用旧任务。未修改旧 eab 文件、冻结包、安装控制包或通用 status；未为仅支持 PiRunner tail 的入口补造 `piRunnerUpgrade`。

普通权限 writer 保留既有 fe4 控制代际、普通用户/Node 身份、queue→原 d08 rotation 双锁、来源 Git tree/内容树、原动作语义、旧 owner 退出、目标两组件 head/chain、active batch、维护/排空/lease 缺席、ready、CAS 及中断后同字节续接。unknown、opaque、第三值 CAS 或证据漂移均拒绝。高权限 observer 只支持精确只读跨 token 进程见证，不能导入记账 writer 或执行应用控制。

[derive-evidence.mjs](derive-evidence.mjs) 从原 e7 请求、STARTED、FAILED、PREPARED、五项完成动作、WorkerApply、consumption、Django prepared、当前控制安装文件逐个读取实际字节；沿旧已审依赖清单重新读取全部代码字节。调用已安装 `observeLiveIdentity`，只读原 native verified chain 及两组件 manifest，未运行 ready/probe/生命周期或记账。输出使用 create-only，仅写本目录候选 [EVIDENCE.json](EVIDENCE.json)，拒绝可配置目标或输出；没有递归枚举 runtime 大目录。

EVIDENCE 含 25 个原件 pin、44 个代码 pin，SHA-256 为 `4f8a3f466af1b0f889d74348bee1cecf4895becd74f1606b05b30a74495d0ff6`。源内容树来自实际目标 manifest（8197 文件，`30c8f68b6d0763d5bb9a9c78868f98fb47bd4f783780e659a5f585225914e896`），运行适配器时再用原算法完整比对源；chainState 为 `3cd1aa15207cb9b7db9c5ead71bf1181c0552e470dea12ab3648dd21eec1c784`。

| 绑定 | 实际摘要 / 版本 |
| --- | --- |
| 原 STARTED | `9cbb6dfca139b28aedd26427a8da2127d8f47c2f593833c4495c3075622eeed1` |
| 原 PREPARED | `27c28eb34df8fa24940582072937346d5277d328cd9482663d086d22c9d0b66b` |
| 原 FAILED | `5c38e81989b993426d18bd96f0ec783294fd9617702a1dd6df920a488c859ead` |
| 旧 PUBLISHED-MAIN 前像 | `5746c95af1214d4059f7dfeba7d8635aaef4c54ee098ca50dd34353672ad3007` |
| Worker release | `20261103T110935Z-c5916e23fb720393` |
| Worker manifest | `368cfb74d70a75f9245c71454972367d9fe4bf18c10cb8c771b9c6ccfc893913` |
| Django manifest | `527bb5f5e0c7ad67749676893f14629b66799128ca76fe114bd7827cd29832eb` |
| Worker consumption | `5dea71dbb12fe5d46f4a204cfda09ee2035ceb146e9b32db6c88916db065a14c` |

## 必要检查

- `node --test docs/e7-ready-tail-recovery-20261103/recover-ready-tail.test.mjs docs/e7-ready-tail-recovery-20261103/retirement-witness.test.mjs`：继承的 52/52 通过，exit0，13.694 秒。覆盖成功/幂等、缺失/unknown/非零/超时、特殊发布字段、原动作绑定、动态漂移、四个中断点、第三值 CAS、截断记录，以及私有 REQUEST→OBSERVATION→ACK、见证超时/身份漂移/observer 边界。真实 fe4 queue 与 d08 rotation 仅在私有管道运行，`forwardedProduction=0`，原 `readLivePublication` 使用私有目录夹具。
- 增加 e7 绑定回归后，用 `--test-name-pattern 'candidate, observer and witness'` 单独执行新增 1 项，通过，exit0；其余代码未变，复用前述 52 项。全部 53 项有效结果，无全仓/业务功能验收。
- 仅调用 `inspectOriginal` 核本次原件，再逐个核 44 项代码 pin：通过，五项完成动作与 WorkerApply=activated 相互一致。这不是生产 probe 或恢复。
- 七个 `.mjs` 的 `node --check` 及本次差异检查通过。候选文件未被现有 CI / `verify-release-candidate` profile 引用；未改已有被资格化测试。

检查输出保留在本次工具执行记录；[CHECKS.json](CHECKS.json) 记录命令、结果及最终文件摘要，未伪造生产回执。隔离测试只写 OS 私有临时目录并清理，不使用生产锁、端点或数据库。

## 拟执行的精确写入范围

以下均尚未执行。状态根固定为 `D:/codex-isolated/main-manual-release-20261016`，独立恢复根为其下 `accounting-recoveries/e7aaf6c1-ready-tail-20261103/`：

- `BINDING.json`，绑定最终 operator commit、program SHA、recipe SHA 与原 STARTED/FAILED。
- `superseded-PUBLISHED-MAIN.json`，逐字节保全旧 catalog 前像。
- `RECOVERED-SUCCESS.json`，独立手工恢复回执；明确 `manualRecovery=true`、`automatedPublisherSuccess=false`、`publicationPerformed=false`、`preparationPerformed=false`、`applicationActionsPerformed=[]`，保留原 `originalPublicationStatus=failed`。
- `invocations/<UUID>/STARTED.json`、`OBSERVATION.json`、`FINAL-OBSERVATION.json`、`COMPLETED.json` 或 `FAILED.json`，只记录本次调用与原件关联。
- 状态根下 `PUBLISHED-MAIN.json.e7aaf6c1-ready-tail-20261103.tmp`，create-only 暂存候选 catalog；最终再核旧 SHA、完整动态门禁与见证新鲜度后 rename CAS 更新 `PUBLISHED-MAIN.json`，并经原消费者回读。

有 opaque 时另在固定仓外见证根的 `<UUID>/` 写 REQUEST、OBSERVATION、ACK。管理员侧仅写该精确见证 OBSERVATION 并等待普通 ACK，不能获得 catalog、锁或应用控制能力。首次观察与最终 CAS 使用独立 challenge；证据开始至使用必须小于 60 秒。

负责人可将本次普通权限 writer / 精确 observer 的 stdout、stderr、退出状态和结果保存到 `D:/codex-artifacts/e7-ready-tail-recovery-20261103/probe/` 或 `apply/` 下独立诊断日志；这些仓外日志也属于后续授权需明示的有限证据写入集合，不是应用或业务写入。本候选未创建这些生产执行目录或日志。

原 STARTED、FAILED、PREPARED、所有步骤文件及 stdout/stderr 均只读保留；原 attempt 不补 `SUCCESS.json`。不重新准备制品、不调用 Deploy/Start/Restart/维护/迁移/WorkerApply 或发布入口。

## 交接

负责人独审最终提交及配方后决定普通权限只读 probe。若需跨 token 见证，observer 只接受 writer 输出的固定 `--request <REQUEST绝对路径> --sha <requestSha256>`；不得把旧 challenge 或旧观察用于新调用。生产记账必须另获用户对本 ID、独立恢复回执及 catalog CAS 的明确授权；默认只读通过不自动授权 `--apply`。

当前只提交本目录候选，按负责人指令暂不推送，由负责人补本轮发布记录后统一推送；未合 main。任何后续现场漂移仍由原门禁拒绝，不修改配方或放宽断言绕过。
