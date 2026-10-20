# 2026-10-21 恢复真实模型与投递验收

用户明确“你可以继续”，撤销00:04的停止安排；旧停止、取消、失败材料保留。不合main、不上线、不改生产配置或共享服务生命周期。本轮先使用正式公开HTTP，发现容量条件后仅对候选代码使用精确私有PG/Runner。实际投递仅允许当前账号唯一绑定的机器人单聊、明确合成正文和既有合成PDF/XLSX；不发群或经营/客户数据。

## 正式来源与原未知

只读正式部署来源为`2be62f90e6dd`，上海时间2026-10-21 02:57:58，已含网关短authority事务修复，不沿用旧20ee来源推断。[部署观察](live-evidence/resume-20261021/formal-deployment-observed.json)。

04:48正式OpenCode操作`pi-op-b59d4836-4b87-4990-84e8-c82fa6ff3c02`在响应头阶段`unknown/provider_unavailable`，requestStarted=true、无HTTP状态，无工具/业务动作/正文附件派发。原freeze完成且native disposed。原pause HTTP错误正文未保存，工作区无对应control，不冒称其已成功或某个精确HTTP码。

独立正式Agnes既有附件任务`pi-op-3b8f5147-41d6-4a31-b8d0-90e5c4cd2464`是第一model完成、两个tool完成后第二model unknown/provider_unavailable。options读取完成，随后prepare返回已知not_found、action计数0，原freeze disposed。不能称所有模型首POST失败，也不能把tool completed当prepare成功。[正式Agnes结果](live-evidence/resume-20261021/agnes-direct-delivery/public-results.json)、[工具投影](live-evidence/resume-20261021/agnes-direct-delivery/tool-response-projection.json)。

只读采样为pg_stat_activity总行数128、max_connections128；总行数含不同backend_type，不能单凭它认定client连接槽耗尽。直接容量拒绝证据是两条本地PG FATAL 53300，与两次unknown写入相差8/9ms；结合旧取消watch每250ms重建连接、异常切socket却未保原错的源码，高度支持本地容量耗尽造成取消监视中断链。缺原watch线程trace/PID，不能称捕获了原线程异常，也不能证明供应商全站故障。[容量窗口](live-evidence/resume-20261021/postgres-capacity-window.json)。独立无密钥GET成功和空JSON无认证POST HTTP400仅证各自小请求可达/拒绝，不证认证模型POST恢复。原脚本及结果保留，未重放旧请求。

## 已修复并独审的候选

`e9d113a4`修复取消检查：HTTP准入等待watch线程专属连接首检成功，活动期复用、退出关闭；owner仅网络前一次老化边界，期间真实SELECT不周期close。首错锁存并优先于socket/JSON包装；stop后迟到检查不拆已释放socket，清理未确认不成功。固定code `ai_cancellation_check_unavailable`通过provider→Pi网关→原dispatch/event，只留有限stage/reason/requestStarted/SQLSTATE。满容量首检失败零provider HTTP；unknown不重放，取消/撤权及最终身份、epoch/generation围栏保持。

19项无网络、1项真实私有PG连接归属、8项前端提示检查通过并独审。首次PG测试在允许的单次老化边界前采PID导致FAIL，原日志保留；仅纠正活动期测试基线，未删产品前检。这不证明正式PG容量负载恢复。外部日志cancellation-*.log保留，私有55873已停并核关闭。

首个候选投递`candidate-isolated-delivery`在runner:create unknown/command_outcome_unknown，无model/tool/外发，原dispose和精确清理闭合。init空技能→prompt excel-report是合法产品路径，不能缩夹具绕过后称技能能力通过。新无付费rootless反例明确得到thinking_level_requires_explicit_change：同模型技能重启丢原实际档。另无网络复现旧reader污染新目录及decode交错，修复中的锁序反转也由独审指出并纠正。

`fdd65231`仅在同模型技能重启恢复已核实际档，保持新模型不支持组合显式拒绝；proc替换与record应用同锁，decode/read/pipe IO锁外，旧帧/异常/gateway不作用新proc，cancel锁内摘录、锁外写出。5项无网络交错及1项无付费真实技能切换通过（actual off、gateway0、disposed、cleanup），独审闭合。原unknown没有改写为成功。[独立审查](capability-audit.md)。

## fdd65231后的Go限流

[Go候选原结果](live-evidence/resume-20261021/candidate-isolated-delivery-after-skill-fix/results.json)使用新session/intent、原合成文件当前收集记录与SHA及完整实际v4参数。5个workspace控制、create/skills/prompt完成；model1完成、get_pi_business_options工具完成，model2 unknown/provider_rate_limited。第一model用量3022 token（prompt2991、completion31），金额未获。

旧fixture未保存该dispatch的responseDiagnostics，私库已原finally销毁，不能补造直接httpStatus或SQL COUNT。源码固定code仅对应HTTP429，限流判断基于此契约。原native事件确认为仅options读取，脚本失败在prepare/专用confirm之前、deliveries空，没有走报告外发路径。区分路径依据与未保存的精确SQL计数，见[原证据边界](live-evidence/resume-20261021/candidate-isolated-delivery-after-skill-fix/original-evidence-limits.json)。原native dispose complete/disposed，[cleanup](live-evidence/resume-20261021/candidate-isolated-delivery-after-skill-fix/cleanup.json)双端口closed、Runner exit0、精确namespace容器卷清除；不重发Go。

## Agnes独立工具能力验收

用户持续多模型/实投授权及独审允许另一已启用模型的独立验收，不作为旧Go未知恢复。新namespace `pi-test-live-resume-20261021-6e9a2d74`、新会话/意图、Agnes专属caption，来源fdd65231，fixture脏改明确标记。读取当前Agnes `ai-model-363b2b27-713a-4aa2-b6d1-8cbb4d6f4f9e` v3完整实际参数：max4096、timeout20000、reasoning auto、temp200、maxToolRounds6/maxTotal12及原generation配置，不改global。不把已启用/probe unverified当工具闭环已验证。

每次guard短只读动态核实际principal、policy、机器人启用和唯一direct；密钥仅初始读一次、仅内存/stdin。实际中央目录、prepare、专用confirm expectedVersion/previewDigest、正文/媒体transport保留。确认前断言direct、精确正文、当前fileId和SHA。unknown/拒绝/部分成功保原停止，不改投或盲试更多模型。

本轮已通过，[Agnes原结果](live-evidence/resume-20261021/candidate-agnes-tool-capability/results.json)、[实际参数](live-evidence/resume-20261021/candidate-agnes-tool-capability/run-metadata.json)与[原生工具/处置账本](live-evidence/resume-20261021/candidate-agnes-tool-capability/native-ledger-projection.json)均保留。XLSX操作`pi-op-ece50104-f5cf-4e96-be3f-455ea22567c1`、PDF操作`pi-op-95efa5e3-d360-460f-80e1-68e4d2b67317`各完成3次真实model、get_pi_business_options和prepare_pi_report_delivery两个实际工具往返，随后具体预览和专用confirm一次。

| 附件 | 原动作 | 正文 | 附件 | 原动作终态 |
| --- | --- | --- | --- | --- |
| XLSX | pi-action-8b6d7886-54e7-4179-9842-56d801964259 | accepted | accepted | succeeded / accepted_by_platform |
| PDF | pi-action-72979c3b-1376-4697-a991-7cccf53f20a4 | accepted | accepted | succeeded / accepted_by_platform |

两份正文均带AGNES TOOL CAPABILITY合成验收标识。不可变附件SHA分别为XLSX `5808407b9198903cdc066561b29d70421ce769f4ba89b4432752383cba3b5b1d`和PDF `80d2ce183f4e925aff91c3069927dd6676698d4ad11ef8f5b6e7aa08bf66a206`。正文/附件各保原平台回执SHA，mayReplay=false。此结论仅为平台受理，不称收件人已读、已打开或已验证接收端文件。

最终finally在私库销毁前刷新effects=actions2/bodyDispatches2/attachmentDispatches2；[逐动作原审计计数](live-evidence/resume-20261021/candidate-agnes-tool-capability/business-per-action-readonly.json)核每个动作confirm、body dispatch/receipt、attachment dispatch/receipt各1。早期round保存的发送前0计数只是阶段快照，不能覆盖最终回执。最后6个成功模型请求共39949 token（prompt37447、completion2502），[用量原汇总](live-evidence/resume-20261021/candidate-agnes-tool-capability/usage-summary.json)；金额未获，也不据此判断此前unknown是否计费。

原native dispose completed/disposed，原finally成功退出，PG55541与Runner18123均closed、私有Runner exit0，精确namespace容器/卷已清除，[资源清理](live-evidence/resume-20261021/candidate-agnes-tool-capability/cleanup.json)。在核对每个目录归属、无精确Runner进程、无namespace容器卷及端口关闭后，分别仅删除7f4d2a16、4ca9e731、6e9a2d74三个本阶段私有namespace的临时HMAC key/config，保native ledger；[本轮控制凭据清理](live-evidence/resume-20261021/candidate-agnes-tool-capability/ephemeral-credentials-cleanup.json)，旧两轮各自同名回执也保留。未停止共享WSL relay或正式服务。

原始耐久材料：`D:/codex-artifacts/pi-unified-chat-20261020/live/resume-20261021/`。旧停止清理与本轮各精确namespace清理分别记录；不停止共享生产Runner/DB/WSL或追求所有进程为零。
