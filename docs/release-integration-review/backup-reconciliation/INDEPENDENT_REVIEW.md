# 后备份真实回执元数据 API：非作者独立复审

2026-10-10，Asia/Shanghai。审查者 `/root/preparation_review` 未修改作者实现，仅新增独立测试、原日志与本报告。**当前准确API/调用器源码范围通过独立审查，无已知未闭合源码阻断。** 本次未调用生产API、Backup、Restore、生命周期、Status或生产WAL写入。

| 文件 | 被审SHA-256 |
| --- | --- |
| reconcile-completed-backup.mjs | `3fabc2009287d12088559f882e7b326903aeb8b0a1f8eb29cda6faf7f17b5865` |
| execute-reconciliation.mjs | `7b0e27fc5a0af121daa184366a186f972e569a0c05924255515f099c65b11105` |
| reconcile-completed-backup.independent.test.mjs | `228fbdbb6ae211213a213a432c7592848a3c0e97a0b9e8a7ceb980361f0bb7f1` |
| INDEPENDENT_TESTS_FINAL.log | `8183cb23bfd8f05a28f49b750f3c38c6195ef907e734e7f3307298b193bb817c` |

API/调用器在最终独立测试前后字节一致。详见 [机器审查记录](INDEPENDENT_REVIEW.json)。

## 安全协议与准确阶段

API只处理AB9的精确unknown `420fd5e1…`、native audit420adb及实际已发布备份点，持原rotation锁，经原journalState校验后使用原writeOnce/create-only fsync追加一个明确的协调事件和5个真实输出，不调用原生业务动作，不修改旧记录或内存latest来伪造原成功。

所有输出来自原native result，并与独立proof的verifiedOutputCandidate、原stdout字节摘要、manifest/sidecar/dump及原typed完整profile契约匹配。真实blocked清理保留，originalShellSucceeded/originalOperationPassed保持false；已产生备份效果不能被标成noEffect。

独立核对发现全阶段45,465声明／4,522唯一路径有两处真实历史冲突：control6037→0e87、worker-servicebc98→4c31。已经passed的维护/切换不能要求当前文件同时具有前后两种SHA，亦不得恢复旧脚本。正确现阶段闭包为原collector全部files＋backup-post至原17–21全部实际执行依赖：16,667声明／4,505唯一路径，无冲突，包含实际原engine/impact/rotation/worker。原collector的已保全前驱字节继续留作历史证据；前15passed不重放。

调用器在导入前核原authority原字节、自身与API pin、新批准、当前完整闭包、impact及TypeScript解析依赖、固定原validator，再导入原runtime/新API。没有C运行代码、mock/no-op或新系统主机硬链接例外。实际最终scope尚未封存，后续必须再核其完整字节与文件摘要。

## 独立隔离验证

最终15/15通过、0失败、0跳过，真实退出0，约10.370秒。测试只读真实已完成元数据；stream IO用已观察digest的内存替身，不扫描生产dump。两个明确拥有的临时目录使用真实原journalState/writeOnce及有限75条元数据前缀：验证一次合法canonical追加、旧unknown字节不变、重复执行拒绝，以及同一未决backup但head已改变时零追加。临时目录及登记已清理，生产WAL未改。

其他负例覆盖原typed validator不能换noop、长dump窗口内proof/observations/audit/manifest/sidecar变化、active/head改变、别的unknown/已开始tail、缺self/input/current-phase pin、旧或错误批准、缩小contract、把原外壳失败或实际备份效果洗成成功/零效果。测试正例实际把真实post content带入5字段输出。

首轮夹具在作者新增codePath字段后前置拒绝，旧二轮在全阶段冲突／二次路径搜索模型下未形成有效正例；原日志保留，不将这些前置拒绝计成目标negative。正确阶段14项先通过，再加独立真实temp changed-head例，最终15项有效通过。作者修复原validator绑定、最终输入复验、self/full-current-closure、Map查询及caller导入边界；复审者没有改作者代码。

## typed完成证明及输入范围

输入必须明确：新scope/source/caller/真人时间item、原batch/op/unknown及head、proof原字节和observations原字节、exact native audit、actual retained点manifest/sidecar与stream dump、原contract/validator和全部当前执行依赖。原proof.completed只证明PG备份发布及原三槽归档完成，不证明外壳正常、releaseRetention完成、post Restore或整批成功，也不是操作授权。

新范围只能允许一次元数据追加。原exit1/unknown、releaseRetention blocked、6表真实严格比较差异和fullBatchCompleted=false必须写进审批说明及报告；不能换成前点content或借元数据登记豁免。新caller不执行tail。原17–21若随后另按已授权范围续接，仍必须通过原动态准入／隔离恢复／完整比较。combined reviewer报告的后续core NotReady属于独立tail阻断；本API不运行健康检查，也不将元数据事实当当前core健康。

本结论不授予生产协调、Restore或数据恢复许可。最终精确scope仍须封存核对，并由用户另行明确批准；正式数据库恢复不在范围内。
