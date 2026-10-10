# 原自然守护步骤：唯一复验独立闭合

2026-10-10，Asia/Shanghai。审查者 `/root/preparation_review`。**AB9 op15的唯一原样复验通过原断言，独立证据核对通过。** 本轮只读3份原快照/sidecar/seen、7件首次失败档案、有限WAL前缀及3个原pin，并纯计算原validators结果；未调用Status、UI、collector、重型测试或任何生产动作，不接触正在进行的后备份/恢复。

000070 started：UTC09:31:08.110，event `a2f0be1b14ea204c455fa4382ec00da19662f482a134d3877f63deee3dce3e8b`。000071 passed：09:33:13.719，event `47aff59ae9ca52f17ffaf07d48eb50b4e62bebce6d8a48b217fd2a1e260abb50`；原duration125609.5898ms、PID70364真实exit0，stderr0。

新观察1仍是旧初始baseline，at09:30:27.6822120、seen09:31:08.478，counted=false。新观察2/3的at分别09:31:27.0320653、09:32:28.2836875，严格递增且晚于本次started及首seen。原after未落盘；独立检查采用更晚的首seen09:31:08.478作为严格上界，原 `closeNaturalObservations` 对raw2/3依然通过，未修改raw或原时间规则。

两个合格样本同release `20261010T014638Z-97833d2f2b7e7bc9`、fence `d01e5b5f…`、supervisor48744/worker18720，完整12组件和4探针均满足原规则、healthy=true/probeError=false。business.status仍unknown，不能写成业务全部健康。

重算原结果的canonical receipt SHA `c6a5954749e7d599bdedecdb278a2241a917abfb70839b50fd8146682b75e5f6`与000071一致；canonical stdout共227bytes、SHA `69383ae4…`亦与原processEvidence完全一致。这证明本次新观察通过，不把首次unknown/failed反写为成功。详细原字节摘要见 [INDEPENDENT_NATURAL_CLOSEOUT.json](INDEPENDENT_NATURAL_CLOSEOUT.json)。

首次7个输出在 `E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/production/natural-first-failure/` 逐大小/SHA与首次独立失败证据匹配，迁移及failed协调记录保留。000000–000071共72个小WAL文件的canonical/摘要/previous链及batch绑定通过；6个旧UI unknown/failed和2个旧natural unknown/failed仍保持原SHA。续接000067–000071只有准入及新的op15 start/pass，没有重Install、UI控制器或前生命周期/备份。

原adapter、validators及handoff摘要仍与原pin一致，原命令/参数、600秒命令期限、300秒观察窗和after/断言未变。000069准入结束到000070仅3ms，native deadline起点也在started后3ms，无该边界的额外run等待证据。实际初准入138.926秒、boundary109.239秒，与约273秒择时预算不同；这一次成功不能推成稳定quiet窗口或分钟SLA。

此处只关闭自然守护步骤。原后Backup/Restore、深比较和完整收尾仍由原engine继续；本审查没有验证其完成，也不宣称AB9已经完整完成。无需再执行原自然观察复验。
