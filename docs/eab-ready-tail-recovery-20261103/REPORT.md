# eab998f8 ready 尾部记账恢复

2026-11-03，实施状态：源码与必要隔离验证就绪；本实施代理未提交、推送、合并或操作生产。实际执行结果由负责人在生产回执产生后另行记录。用户本次“授权执行”已覆盖开发验证、独审后的精确恢复，不含合并 main；授权记录位于 `D:/codex-artifacts/eab-ready-tail-recovery-20261103/AUTHORIZATION-SCOPE.json`。

原发布目标为 `eab998f81c984ee3d9e722bcd39f0f46a53a9820`。原部署、权限、WorkerApply、退出维护、Start 与 VerifyStartup 已有成功回执；最后 ready503 导致原 FAILED。原失败和外层 ExitCode=null 保留，不能声称原自动发布成功。

## 实现范围

- [recover-ready-tail.mjs](recover-ready-tail.mjs) 是本次固定目标的离线适配器，默认只读，唯一写模式是 `--apply`。没有部署、切换、启动、维护、迁移或发布 CLI 调用，不修改原 attempt、冻结来源或安装控制包。
- [EVIDENCE.json](EVIDENCE.json) 用现场小文件真实字节生成 25 个原件摘要与 44 个控制/辅助源码摘要，绑定 fe4 已采用控制、d08 native、原请求/准备/失败/完成回执/consumption、当前目标 head/chain 和旧 catalog 前像。Git tree 与源内容树分别核验。
- 持原普通身份、既有 queue→真实 native rotation 顺序，重新检查控制代际、retirement、原 owner/旧恢复 owner、来源完整性、目标两组件、维护/排空/lease 缺席及原 ready 门禁。opaque interesting 进程保留失败关闭；成功步骤不以裸 PID 判活动。
- 固定恢复 ID 为 `eab998f8-ready-tail-20261103`。只在状态目录 `accounting-recoveries/<id>/` 保存绑定、invocation、旧 catalog 与 `RECOVERED-SUCCESS.json`，再以旧 SHA 做 `PUBLISHED-MAIN.json` CAS。新回执明确标记 `manualRecovery=true`、`automatedPublisherSuccess=false`、应用动作列表为空。原 `FAILED.json` 不变，原 attempt 不补 SUCCESS。
- 回执已成而目录仍旧值时，只协调索引；目录已精确等于该回执时幂等返回。第三值、损坏记录和绑定漂移均拒绝。写后原生消费者失败时保留已写状态，不回滚或重发。

## 必要验证

`node --test docs/eab-ready-tail-recovery-20261103/recover-ready-tail.test.mjs`：29/29 通过，exit0，12.588 秒。覆盖缺失/unknown/nonzero/timeout/特殊发布字段、原动作绑定、来源/代际/head/owner/opaque/markers/lease/ready 漂移、四个写入中断点、receipt 字节复用、第三值 CAS、截断记录及同 receiptPath 其他 catalog 字段漂移。全部写入使用私有目录，核心测试没有生产回退能力。

[private-lock-check.mjs](private-lock-check.mjs) 运行真实 fe4 queue 与原字节 d08 native 模块，仅在子进程最底层 `net.listen` 将 rotation 地址映射到私有管道；未知传输拒绝。成功、队列占用、rotation 占用、callback 异常后均正确释放。结果：`rotationArity=1`、`mappedNativeListens=5`、`forwardedProduction=0`、`allReleased=true`。私有 Git 与源树夹具调用真实既有 `readLivePublication` 成功，`resolvedOriginalAttempt=true`，不使用生产目录或端点。

三个 JS 文件语法检查与 `git diff --check` 通过。只执行本次必要检查，未跑全量 tsc、全仓 tests、业务接口或功能验收。隔离 npm ci exit0（611 packages），日志中的既有 allow-scripts 提示保留，未额外批准安装脚本。

原始输出位于 `D:/codex-artifacts/eab-ready-tail-recovery-20261103/`：`targeted-tests.log`、`private-lock-check.log`、`npm-ci.log`。首轮真实 d08 busy 错误仅在 message 中保留 EADDRINUSE、第二轮测试脚本局部变量重名的失败日志分别保存在 `targeted-tests-first-failed.log`、`targeted-tests-second-failed.log`；修正后定向验证通过，不改生产接口。

## 交接

负责人对最终源码/recipe/提交及独审结果绑定后，从普通权限、已采用 Node、清理后的固定发布环境运行本脚本，先默认只读，再按本次已有授权执行 `--apply`。本次参数不接受更换目标、attempt、恢复 ID 或输出目录。

生产执行必须单负责人串行。执行后依据实际恢复回执与 catalog 回读报告结果，分别说明原发布 FAILED 保留、本次恢复状态、真实 receipt/catalog SHA 和未合 main。应用不重新打包、重新部署或启动。本报告的就绪声明不代替现场动态门禁与生产回执。
