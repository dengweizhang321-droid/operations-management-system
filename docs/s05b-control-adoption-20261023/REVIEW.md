# 两次旧 handoff 的有限事实独审

2026-10-23，独立只读关键事实审查。范围只含原两次 pre-native 拒绝、真实退出、当前隐藏实例及迟到作用；复用已审源码与已有有效检查，未重审整条 S05d、未测试或运行诊断任务。

结论：两个旧 run 的证据均足以认定原 native control-prepare 未被调用，且当前没有可迟到继续该业务的在途原实例。旧 run 永久保留 attempted-unknown-no-replay；这不是将旧 unknown 改写为成功或允许重放。任务登记、请求及 ATTEMPT/PARENT/EXIT 等已有控制元数据作用保持原事实，不声称整轮零作用。可以由主负责人依本次明确新授权和新冻结输入调用一次新的 control-prepare，成功后才按原门禁 control-adopt，并核对原生回执。本结论不替代新调用的身份、唯一实例、权限、来源、锁和原生准入。

## 原绑定与边界

- c6be141b-9f7a-488a-9671-f97807c26458：RUN SHA b3381f4f57277171d4667e2945c9bc389c4c10531bfaf7406b90fe39f171982e；EXIT SHA 410ec508cd248918c556af39374ba918f779dab3da1ddab9182ddac20e4249ef。Node 40860 / creation 2026-10-23T03:54:49.1583539Z 直接 exit 1，于 03:54:51.9700999Z 收到直接退出；父进程 26988 / creation 03:54:45.7476320Z。已有 handoff-first-attempt.json 的 8 个原件大小/SHA 全部匹配，复用其结论。
- 28a038c6-34ae-482b-9855-965cf0adc307：RUN SHA fdcfa19f05ebe25087dd3e1be38e606b20df4833a74f8b787f9a17a0316b1d52；EXIT SHA 04fd357c974ba97eff18525fbfea72d68a7b9caa1903e90373c87325f98f4adb，与原 control-prepare-acl-status.txt 绑定一致。Node 53628 / creation 2026-10-23T04:39:12.2137255Z 直接 exit 1，于 04:39:14.8054185Z 收到直接退出；父进程 58236 / creation 04:39:09.6153980Z。
- 每次实际核 RUN/TASK/REQUESTED/ATTEMPT/PARENT/EXIT/CONFIG-PREIMAGE、stdout/stderr 的完整有限字节。两次 outputComplete=true，stdout 为 0 字节，stderr 为 92 字节，其 SHA 均为 fc3757389cca27f673ad1e055bc137a95b7893da3bf3fbf498a1639e50364035，全文仅为 handoff-refused 的 Runner task instance count is ambiguous / 0 !== 1。runId/runSHA、父记录SHA及日志大小/SHA逐项相符。
- 冻结 host SHA 分别为 da1e08c8b1d8b0adf2285c5a3d31f7dce4c3b2ff35a05e4f3b375c302111c397、8a306aff8bb12ebc6ef75de790a2b9a3a120e52f184b460cfc0483e817eadf74；runner SHA 均为 7ad4e67e94fcdf5996dc2a962045e6f1d10ba6a1a0337058b211dea5312b531c，与各 RUN 绑定一致。
- host 的 executeHandoff 分别第 78 / 87 行在实际 load、ordinary identity、unchanged、task definition/state 后，对 instances===1 同步断言拒绝。STARTED 在第 83 / 92 行，installer 动态导入和 prepareControlUpgrade 在第 87 / 96 行，均位于该拒绝之后。因此是精确完整 stderr＋直接退出＋冻结代码顺序证明未调用 native，而非仅凭缺 STARTED/RESULT/materials。完整 runner 直接 WaitForExit 观察内核进程，随后有界等待输出 EOF 并 create-only 写 EXIT；没有异步业务续接或自动重试。

## 当前迟到资格

2026-10-23T09:56:33.6043375Z 的只读观察使用 Schedule.Service.GetRunningTasks(1) 包含隐藏项；两精确任务没有匹配运行实例，state=3。GetInstances(0)=0 只保留为 advisory，没有把它当隐藏实例不存在的依据。当前任务全部固定字段与 TASK 相符；COM 返回 UserId=86137，另按原冻结投影归一为 SID 后匹配预期。triggers=[]、restartCount=0、startWhenAvailable=false、afterLogon=false，无自动触发/重启/登录续接。

四个旧 PID 当前均不存在；同时核相关可执行进程的原始及 EncodedCommand 解码命令，未见两旧 run 或冻结 host 相关命令，候选进程没有不可读命令行。旧 Node 有直接退出证明，父进程亦已退出，当前无隐藏实例或相关控制进程。原 runner 在创建新 Node 前，先拒绝已存在 ATTEMPT/STARTED/RESULT/EXIT/PARENT/stdout/stderr；host 的 notStarted、start/register 的 notAttempted 也拒绝原件。即使未来有人显式 demand start，原无改写字节仍会在 native 首效前拒绝；本轮没有触发它。

config a90c9b8072e1ed6dd225072aa59e78075ea82639498f9ad74c19fc1be5f77642、installation 74724dfae400f312e1907ee1f565faf28d46c3842f29916c0f8f2d9f143e4b0e、hook 582301cd2a8a7be84faf25ac762fd31de130c6bd984c360de05c1f068d11f987 均保持原绑定，作为旁证。

本限定范围无未闭合事实缺口。观察是当时事实，不是跨操作缓存或永久健康保证。旧失败根因、完整 archive/40/60 门禁、退休、来源关闭、封存、队列恢复、应用发布均不在本审查授权内。

## 证据

- old-unknown-evidence-20261023-01.json，SHA 2bc6955138e48fe14c8042e945322cc671addc9eac86f2bdba6792fb2c9f1b1f：全部原件索引、完整 stderr、冻结代码边界、当前原生任务与进程投影。
- old-task-userid-normalization-20261023-01.json：仅补充 COM 用户名按原任务投影规范归一 SID 的证据，以及第二次原状态文件 SHA。
- review-old-unknown-20261023-02.ps1：本次只读取证脚本。01.ps1 同逻辑的初次脚本未加实际 UTF-8 BOM，PS5 在最后读取中文 hook 路径时编码拒绝；未生成证据文件，未改变任务/状态或触发业务。02 为 create-only 新文件，显式 BOM 后成功；全部原文件均保留。

本次仅 create-only 写入本目录审查脚本及证据；没有修改原件、任务、代码、main、引用或配置，没有 fetch、run/retry/replay/cleanup，也没有退休、封存、队列或生产业务动作。