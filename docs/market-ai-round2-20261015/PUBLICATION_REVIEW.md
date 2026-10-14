# 发布来源与受保护入口恢复增量审查

2026-10-15。最终结论：本轮市场源码、工具注释、限定原字节恢复及Worker/Django精确制品独审通过。首次EnterMaintenance未知已按下文补充零效果协调审查，冻结Recovery1脚本无未关闭真实阻断；实际新lease复验并记录后，可以同维护ID执行一次已授权续接。通过不表示生产已经切换，实际采用另由总控记录。审查者仅只读核验及写本文/`evidence/review-*`，未写生产、用户文件、凭据或业务队列。

## 已核事实

主线为 `028804a43bde2598e34c8a2b2668bf014f2e3f6e`。原窄发布源 `d6901002…` 从已采用生产来源 `86fa943d…` 只加入本轮77路径；原离线导航两文件不进入载荷。此次新增现行工具注释后，来源为 `d3c664cd18ada5eaf6a5a1d376e4681db47919ca`，额外差异只有 `tools/worker-local-release-rotation.mjs` 一行文档路径注释。九个受测应用文件仍逐SHA匹配；本轮不新增迁移或模型调用。

独立读取已采用 `20261014T170130Z-17e3867852424323` 的guard receipt，12个受保护入口中只有该工具与当前root不匹配。旧不可变来源工具SHA为 `ec5254ee24eed93639c2a819037b41356ea6351e7f22c0ba71402b0edc6b1f3a`；当前用户root、create-only保全文件及新增注释的窄source均为 `7dd49103f5b672dae484d3b5e70207d6644657701a5b6be23c85203cad62b72f`。逐行归一比较仅一处 `// See docs/...` 注释路径；Acorn整棵AST去位置属性后完全一致。当前root文本归一LF后与合并主线工具相同。独立原件见 [review-publication-comment-result.json](evidence/review-publication-comment-result.json)，它记录的是核验时刻的事实，不代替动作前重新CAS。

原Worker尝试在 `resolveEffectiveReleaseChain({verifyInstalledHead:true})` 的完整入口检查中拒绝，尚未进入 `planWorkerReleaseRotation` 的构建/计划发布调用；这不是已生成候选后的未知重放许可。原guard未被放宽，其拒绝原件应保留。

原Django Prepare实际已完成 `f225aec060354cc19ef9721dda858984`，receipt SHA为 `697e8114d85ae46f363704c897bbca4f6d227f82affd301ce9e045625e580685`。原三字段返回与物理receipt、candidate deployment manifest及未变安装前驱相符；wrapper错误期待不存在的status是完成后的观察错误，不能否定该候选已生成，也不能重复该同源Prepare来消除旧失败。

旧比较证据只证明旧候选相对安装应用差异限市场三业务、三新增测试、deployment和精确六个CF叶，其余canonical应用/迁移字节保持。它不证明加入新工具后的最终包。独立核到 `tools/django-local-service.ps1::Prepare-Application` 的固定复制列表明确包含 `tools/worker-local-release-rotation.mjs`；因此此工具注释确实改变Django应用指纹。旧f225不能作为新源的制品复用，必须保留为未采用历史候选，通过原Prepare生成新receipt，不手改旧receipt或deployment。

## 允许继续的最小条件

1. 新来源提交、完整范围计划和绑定文件纳入这一工具原字节变化。范围按tools升为完整组件流程，仍为Worker+Django、无migration；复用已有效的市场功能验证与注释AST证明，不增加无关全仓验证或假称无工具差异。
2. 保存用户当前字节采用create-only外部原件、固定SHA及精确路径；不修改其他用户root内容。候选source中的该工具必须保留完全相同的 `7dd491…` 原字节。仅AST或LF语义相同不够：最终candidate guard中该入口的candidateSha必须等于保全原件SHA。
3. 在原 `withRotationLock` 互斥及同一模块的有效内存lease内，动作前复验精确前驱、全部12入口和目标物理身份，确认仅该已保全注释差异，再以精确CAS把这一个root入口临时恢复为部署旧字节。继续调用原plan/apply及其head、service mutex、源码/制品、权限、进程、guard、active-owner和CAS检查；不得删guard、忽略入口或修改校验算法。
4. 内存rotation lease不能跨进程充当持久所有权。临时旧字节窗口应由原有效lease持续覆盖，或由原批次active owner保证跨阶段占用且每次重新取得互斥并CAS。如果准备和切换是两个独立窗口，已知未切换的准备窗口先在锁内恢复保全原root字节并回读；切换再独立验证进入新短窗口。不得无owner地把root留在临时状态，也不得把恢复回原来已知guard差异的root称为guard健康。
5. 原apply的 `installProtectedEntrypoints` 先安装activation fence，再按每入口predecessor/candidate精确SHA执行。最终通过原apply把该工具安装为候选的 `7dd491…`，回读应精确等用户保全原件。不能另以手工写回取代apply的guard安装或成功判定。
6. 新Django Prepare重新绑定当前真实前驱和新应用指纹；新Worker source-binding、plan、manifest及guard绑定最终来源和完整实际构建输入。最终比较应只增这一个工具注释和相应制品元数据/精确CF传输叶，市场受测代码和所有迁移、其他runtime保持原字节。新制品生成后按确切ID/SHA追加独立核验，旧比较/旧receipt不冒充新证据。

## 失败与未知处理

准备脚本叶子增量已独立收口，正式切换的最终制品/发布脚本核验见下文。初版PS叶子的批准源与临时文件SHA未固定、首次替换在try外，两项先修正；私有原生PS5又复现 `$null` 备份参数导致File.Replace拒绝及继承ACL自动继承标记变化。后两者未通过生产试错，原 [null参数失败](evidence/review-publication-restore-leaf-nullstring-original-failure.log)、[ACL失败](evidence/review-publication-restore-leaf-acl-original-failure.log)及 [仅SID脱敏的结构差异](evidence/review-publication-acl-diagnostic-result.json)保留。

最终 `restore-guard.ps1` 放弃Replace、rename和ACL修改，使用同一原文件对象的 `FileStream(Open,ReadWrite,Share.None)`：批准replacement buffer在开目标前按固定SHA验证；持独占句柄读取完整旧buffer并验证Expected后才写、定长及Flush(true)，持柄回读验证新SHA；写后失败仅在同柄回写已验证旧buffer，未解决则unknown。关闭句柄后再核完整SDDL与文件SHA，Node保留nlink1、parent/reparse及原rotation lease检查。首次恢复/后验记录已纳入try，catch只在同chain、全其他入口/fence、old/original有限SHA及初始SDDL仍匹配时协调；foreign或ACL未知不覆写。

独审以普通Windows token、原两份工具精确字节、私有路径和原生PS5 Modules验证：继承私有ACL与保护私有DACL各四例（两向精确写回/完整SDDL不变、坏source零写、持柄写后故障还原）共8例通过。私有故障注入明确标注，没有调用生产Prepare、生命周期或模型，也不保存原SID。当前producer与PS叶子SHA、fixture和测试结果见 [review-publication-restore-leaf-result.json](evidence/review-publication-restore-leaf-result.json)。该证据验证准备前的限定写叶子，不表示原apply或未生成制品已通过。

新Django `722fdc383e98498f898e135b5d10edbb` / receipt `e0b6e889…` / candidate manifest `79a9d21a…` 已独立核物理绑定。按原 `relative-path-file-sha256-ordinal-v2` 规则重算2951 payload行，得到 `276566a88a3c07b08ee74e036b7532e179032699f55a3ff1a432e9ec0cebecf0`；逐字节差异精确限市场三业务、三新增测试、一注释工具、deployment与CF。CF仅原六叶变化，结构与所有叶子类型不变；迁移和其他canonical payload同，安装前驱仍原 `a28626fe…`。这证明新候选已准备，未表示已部署；[独立结果](evidence/review-publication-django-result.json)。

发布脚本的持久owner门禁已前移到取得新rotation lease后的第一步，先调用原 `assertActiveBatchOwnership`，再恢复root/维护/部署；不能等Django Deploy后才在apply中发现foreign active owner。最终Worker与发布脚本已在同上下文按下列元组核验。

## 最终发布绑定

独立核对物理文件、原sidecar、原receipt和嵌入source-binding，不重复已成功原producer的全依赖/构建树validator。有效原源码与构建验证直接复用。最终元组：

| 项目 | 精确绑定 |
| --- | --- |
| 主线 / 窄组合来源 | `028804a43bde2598e34c8a2b2668bf014f2e3f6e` / `d3c664cd18ada5eaf6a5a1d376e4681db47919ca` |
| Worker候选 | `20261014T202834Z-1943995b435ba5c7` |
| Worker manifest | `f1e8c5a67790535092afdbfd5063f74a3e2918e6b10a19612e914940a5a9639e` |
| Worker guard receipt | `da038e8b20466719228b3b0b1ada26946d497ca7871f491688a9fb59da95dd65` |
| 原rotation plan | `3475f5b7b1a7c267da78e08fa19f028d385f918a0f7bd2373c1b444056f31736` |
| Source-binding | `e06dfee7992e705b90e131d47c0a86109a68bae40554ada2e349b0a883dc1be2` |
| 8424文件源码树 | `31a248b2c28b3778a181ebf1cee7d73ad1968d458a5b416c872763aa94a1abe6` |
| Django prepared / receipt | `722fdc383e98498f898e135b5d10edbb` / `e0b6e8892565c88672f56ce3ea4e8480374127821b8bba2e33ad4d5a10686f96` |
| Django candidate manifest | `79a9d21add467114cc54149e233f6e5310953f3f306b462540c537d8b9ecf10b` |
| 发布脚本 | `479cf2621cc3d387816c4064c8550f43711e333ce4ece24b6f8ff93d47aaa99b` |

Worker manifest、guard与plan中的candidate相同，plan与source-binding的原前驱/chain相同，嵌入raw binding等外部物理文件。source-snapshot的九个应用文件均等受测摘要；guard与snapshot中的rotation都精确为用户保全 `7dd491…`。原prepareReady已exit0，确认未apply且原root精确恢复；独立再次回读root为该SHA。[最终独立结果](evidence/review-publication-worker-result.json)。

最终publisher在同一新rotation lease内先原active-owner门禁和完整旧入口检查，再进入精确短恢复窗口、原EnterMaintenance KeepPostgres/Stop、原DeployApp/HardenAcl、精确plan apply、同ID ExitMaintenance与原Start/VerifyStartup；apply后不手工写回入口、不重发业务操作。当前目标任务自然结束，无在途，不恢复它或历史paused任务；未知封顶仍保护。本审查不扩展到正式Prompt、模型切换、金标质量或批量入库。若上述元组、脚本或真实前驱变化，保留原审计并按相应增量与协调规则处理，不能借本报告覆盖新未知内容。

准备失败且有精确证据证明未开始切换时，仅在目标仍为旧 `ec5254…`、原前驱/全入口/fence仍匹配、无原并发owner变化的互斥窗口中，恢复保全原 `7dd491…` 并回读；保留原失败、候选残留和观察记录，不自动重放Prepare或业务操作。若原动作其实已完成，只读核实并复用该精确结果。

一旦apply开始、输出缺失或结果未知，旧head仍在不能证明零效果：activation fence及部分入口可能已先安装。必须保留原owner/WAL/gate，独立核对完整入口、fence、successor record/sidecar、consumption及原回执，按原协调/恢复协议续接；不能凭单一head或工具SHA盲目写回、清owner或再apply。此前用户普通权限生产发布授权保持，guard恢复不增加后台任务恢复、旧unknown重放、Prompt采用、模型切换或批量入库权限。

## 首次维护未知与一次恢复审查

原EnterMaintenance于 `2026-10-14T20:50:06.648Z` 开始，34.871秒后PID29268返回exit1及 `worker_gate_failed` unknown，原底层异常被现有Json路径抹去。总控保留首次raw并停止，未执行Stop、Deploy或apply；不能把30秒mutex等待及同期周报日志称为已证明根因。原维护ID为 `21ecd2f7d60b483380d65b56a36a14bc`，原临时工具仍精确为旧 `ec5254…`。

独审读取原失败/阶段记录与当前原源码，随后实际运行仅只读 `recovery-preflight.ps1`，在 `2026-10-14T21:14:28Z` exit0：原29268及直接子进程不存在；旧45004的创建时间 `2026-10-14T17:31:14.4978970Z`、canonical receipt payload `75bdd328…`、完整进程/端口归属为exact_release；旧Django manifest `a28626fe…` 与app指纹 `abeaee20…` 保持，Assert-DeployedApplication通过；maintenance、drain及active owner均不存在，所有launcher.jsonl*无该ID事件。另逐物理SHA核12个原guard入口（包含activation fence）全部匹配。只保存SDDL摘要，不保存SID。

零效果依据为上述组合及原代码顺序：GetCurrentManifestPath中的Node解析只读且被等待，BeginMaintenance与失败进程同线程；mutex、部署应用及ACL检查先于排空，WaitAutomationDrain先持久写helpers gate，后续才可能停止服务或部署。其异常路径不会删除gate；只有显式同owner Cancel/End可删除，原发布记录没有该调用或后续Stop/Deploy/apply，当前旧服务精确身份又未变。因此可协调为维护与切换的 `failed_zero_effect`。这不表示没有日志、互斥或观察活动，也不依靠单一日志缺席证明效果。gate前没有未等待的业务子孙调用，无需扩展全机程扫描。

恢复三个冻结脚本的独立SHA及事实见 [review-publication-recovery-result.json](evidence/review-publication-recovery-result.json)。Node与两个PS叶子语法检查通过。`publish-recovery1.mjs`在新原rotation lease首行拒绝foreign active owner，再复验原12入口、head/chain、原失败脚本/exit/PID、旧Worker receipt与创建时间、Django字节及无gate和后续阶段。实际lease应create-only写 `RECOVERY1_RECONCILIATION.json` 为failed_zero_effect，并保留原MID；审查者未预写该实际执行文件。冻结版本publisher SHA为 `ec8fd8e815cce7a632ac2220b1d890309351e4ced94db26efa9325fdcfd1dbfa`。

mutex readiness只进行WaitOne(0)，获得后立即Release/Dispose；busy或abandoned必须先归档并退出，不调用生命周期，不杀周报、不跨进程持Django mutex。它只是即时观察，不能保证下一次原Enter不会竞争。Recovery1只允许同ID/KeepPostgres调用一次原Enter，其余制品参数、Deploy/Harden/apply/Exit/Start/Verify保持；当前旧工具已匹配，不重复手工恢复，成功后由原apply安装用户原字节。新阶段原件create-only保存，原尚未存在的apply及最终结果路径也不得覆盖。若再次unknown，继续保留原owner/gate/记录并精确协调，不凭此次结论重发。
