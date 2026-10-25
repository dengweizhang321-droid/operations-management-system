# Handoff Task 实例可见性增量独审

2026-10-23。仅审 [HANDOFF-ISSUE-PLAN.md](HANDOFF-ISSUE-PLAN.md) 范围的一次空 Task 诊断及随后有限 owner/DACL 修正；复用 [REVIEW.md](REVIEW.md) 对原 c6 的前 native 调用拒绝结论。独审不参与实现、不运行 Task、不修改现场 ACL，也不重查退休全链。

## 已完成诊断的原件结论

原件目录为 `D:/codex-artifacts/s05d-residual-classification-20261023/task-visibility-2c99fc4a-08b5-496c-905c-7e2fc34b7ea2`。已读注册/RunEx、4 个普通侧查询及直接退出、6 个高侧 observation、Node 直接退出与清理前置/清理记录，核对 SUMMARY/RESULT，并核实际摘要：

- RESULT.json：`4261e2e736c7a499bbd5784c201a0b4fe3c1d20ad0e74137784dcb1efd1112cb`。
- EVIDENCE-SHA256.json：`baa8bb8bd4df6f627c726a487aa3519c87876a527f23ecbcba50bcb459fd9afa`。

普通侧 4/4、高侧 6/6 的原表达式、保存 collection、显式 COM Count 都是 1，GetInstances/Count/Item HRESULT 均为 0；唯一 GUID 同为 RunEx 返回的 `{FB208A8E-4AC4-4FD9-8688-58E916843D62}`，对应 action PID 39352、state 4。实际普通 query/Node/action 为原 SID、session 1、medium 8192、非 elevated；高侧查询为 12288。原件保留 scheduler-service 祖先进程 token 不可读的事实，没有把祖先的权限代替 query token。

实际回读 owner/group 均为目标用户，SYSTEM/BA 各 full access，用户 RX mask `0x1200a9`，另有 Scheduler 自动附加的 FR `0x120089`。不能写成“恰好一个 RX ACE”。Node 43804 直接 exit 0、输出完整且 stdout/stderr 均空，Node 时长 11.005 秒；清理前定义/安全描述符未变、Ready/0 instance、action 已退出，仅该诊断 Task 被删除并核不存在。RunEx 至清理约 15 秒，不是每个 query 精确落在预定毫秒偏移。

**诊断支持这组 owner/RX 配置在本次拓扑提供普通侧唯一实例可见性。** owner 与 ACE 同时改变，不能分离证明原 c6 的唯一根因，不能证明 t=0 可见，亦不构成业务调用或重试授权。原 c6 run/task/host 和 `attempted-unknown-no-replay` 保持不变。

## 最终修正结论

**该单叶增量通过独审。** 实际 [preparation-retirement-handoff.mjs](../../tools/preparation-retirement-handoff.mjs) 为 53,604 字节，SHA `8a306aff8bb12ebc6ef75de790a2b9a3a120e52f184b460cfc0483e817eadf74`；runner 未改，仍为 `7ad4e67e94fcdf5996dc2a962045e6f1d10ba6a1a0337058b211dea5312b531c`。可交 root 冻结新 host、新 run/task，继续本次有限 control-prepare 及原生门禁。本结论没有将空 Task 诊断写成真实控制采用成功。

注册 SDDL 的 owner/group 为精确目标 SID，输入 `D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;sid)` 与诊断原输入相同。执行资格核的是 Scheduler **实际回读**的有限形式：owner/group 均目标 SID，RawSecurityDescriptor controlFlags 为 32772，恰有 SYSTEM/BA 各 full `0x1f01ff`、用户 RX `0x1200a9`、同用户自动 FR `0x120089` 四个无 flags 的 allow ACE。仅忽略 ACE 顺序；未知 SID、mask、type、flags、ACE 数量及其它 controlFlags 均拒绝。直接解析注册输入 D:P 会含额外 protected 位，不能拿它代替实际 D: 回读正例。

JS 和同次 PowerShell validator 对上述结构保持同语义；PowerShell 从原生 RawSecurityDescriptor 投影，未知 ACE 类型/opaque 内容拒绝。必要入口均已绑定实际读回：register 的已有任务与新注册后、start、execute、verified parent、status、cleanup；RunEx 与 DeleteTask 前在同次 PowerShell 中再次核 ACL、定义及原运行状态。没有覆盖旧任务 ACL 或引入任意 SDDL/命令透传。

`instances===1`、普通权限、SID/session/token、冻结命令/父子进程、代码/config/代际、STARTED/RESULT/直接 EXIT 及 no-replay 条件均保持。唯一变化是新 Task 的注册权限及各入口严格读回。没有新增 relative import 边、模块或控制包成员，可复用此前未受影响的包结构证据。

## 必要检查原件

[handoff-acl-checks.txt](handoff-acl-checks.txt) 为 **1/1、exit 0、503.603 ms**，命令见 [handoff-acl-checks.json](handoff-acl-checks.json)。独审读取原始输出与 [单项源码](../../tests/preparation-retirement-handoff-acl.test.mjs)，未重跑。检查仅在原 PS5 用纯 .NET 解析实际回读形式的 SDDL，验证精确允许形式、顺序归一及修改 owner/group/control/数量/权限/继承/type/SID 后拒绝，同时核注册输入文本；没有调用 Task API。PS 同次入口 validator 的对应语义以代码差异审查核定，不声称此单项执行了注册/RunEx/DeleteTask。

已核实际摘要：test `0f924612625847845847bb76db77ddb8449056bcedca20385e25145f9839c695`；原始 TXT `87189ef098afc0a31fff34db6adccefade844e9175d587406def5ac4ee9fbbd1`；命令 JSON `146092719b97e7f3d099f5c720b09d2106811cb9c4d7b55345c4ba792c600f49`。未增加旧全套、现场任务或退休全链检查。

## 旧失败与新 run 的界限

新入口会严格拒绝旧 ACL，这不表示旧回执消失。原 c6 的冻结 host/runner、Task/run 和原件均不覆盖，仍可由其原冻结 host 读取；`attempted-unknown-no-replay` 不改，也不执行第二次。此次新 run 仅沿已独审核定的 c6 前 native 调用拒绝证据及当前 config/代际/材料路径重新资格化，不形成通用 unknown 重试规则。若新 run 在 STARTED 后失败或结果不明，仍按原 no-replay 停止，不能继承 c6 的前调用结论。

archive 前像未完、后续来源关闭/full boot/observer/ACK/SEALED 仍是各自门禁；本次 ACL 修正没有豁免或证明这些事项。
