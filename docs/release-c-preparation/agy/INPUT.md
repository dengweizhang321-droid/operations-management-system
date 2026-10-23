# 下一阶段审查输入

父任务已加载共享Home、相关记忆、项目AGENTS和开发/发布规范。用户授权Antigravity协助排查稳定性并准备C；生产切换、启停、调度及业务写入不在本轮执行范围。另一会话中用户明确选择“C只做准备与复审，统一安排发布”；这里不得建立并行发布引擎或重复开发该会话正在实现的精确source binding。

请只读以下已存在工作区文件：
- docs/release-integration-review/production/HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.json / md
- docs/release-fastpath-evidence/HANDOFF_D.md、INDEPENDENT_REVIEW.md、REPORT.md
- tools/release-batch-admission.mjs（当前main源码为尚未生产采用v3；不能说C-alone已采用）
- docs/release-c-preparation/stability/FORENSIC.md、source/REVIEW.md（若尚不存在明确证据缺口，不乱猜路径或读取工作区外）

AB完整交付已经新独立确认，实际应用仍5fa/Worker f4e/Django237，原19/21/1cae unknown与严格false保留。C精确被测2b10f602，不等于可以整体采用该树；旧限定ABC9d41相对AB5fa只有6个运行工具增量，另38报告/测试文档。旧D5计划前驱失效，C须绑定当前AB前驱；机制首次自身采用仍strict/full。旧v2 reuse需要真实日备份/26h点/7天同点演练/现场资格，缺任何项拒绝；不得用其他会话尚未采用v3 not-required代替资格。

稳定性事实：同supervisor下退出/自动恢复已证；17:43与00:59退出表面ProxyWorker/Network connection lost，原因未知。原Restart-ExactWorkerChild用Stop-Process保持supervisor，但不写完整controlled-stop审计，因此不能排除另一任务显式结束child。用户提出其他对话执行任务可能相关，是待证假设。Root读到两相邻发布会话真实turn未覆盖这两个故障窗；sidebar updatedAt不证明正在执行。唯一找到Stop-Process针对私有freeze-bootstrap-payload脚本Node，在早先暂停时，有创建时间/命令身份保护，不是正式workerd。其他正常API任务、显式热重启、外部kill、框架错误均不能只凭时间或无审计认定。

源码接缝：原C collector成功Status之后才做recovery/session完整源码重读，再把Date.now当observedAtMs，会把实际Status年龄低估。新准备需完整慢核在动态采样之前、末尾不重置采样时间；测试必须注入慢检查/采样后延迟/过期使用，保留原deadline及身份权限维护排空等门禁。AB后source-only257失败证据和fc84健康预算补丁是否随C采用必须显式列入范围，不默默夹带。

请实际读取文件，用中文提出关键反例、对“他对话导致退出”的证据要求、最小隔离复现/修补建议，以及C严格首次采用的阻断与交接要求。你不能执行shell、HTTP、Status、SQL、生产生命周期、写文件、外部发送或权限绕过；只用view_file，结论不是实际测试/生产通过，不承诺分钟收益。
