# 最后批准范围：7389a4d4 元数据补登记

**已封存可审查，尚未批准或执行。AB整批未闭合。** 原0bcad05b只读UI补充已经获批并完成；本文件是新外置元数据接口范围，不能沿用旧UI item授权。

| 身份 | 精确值 |
| --- | --- |
| 新scope SHA-256 | `7389a4d45c9ac8356eae7a6cb50bf987ea647703fbd68ec8f63f83dbf949640c` |
| manifest实际字节SHA-256 | `278733b22abb3ba77193bbcc4bb634774834bbeb9c5ec1c97ede49850319c514` |
| 封存时间 | `2026-10-10T10:25:53.660Z` |
| 元数据接口源码提交 | `a9f2bd327fc6cfbd7248ee4da7dd9f5488743fd3` |
| 接口实际字节SHA-256 | `3fabc2009287d12088559f882e7b326903aeb8b0a1f8eb29cda6faf7f17b5865` |
| 调用器实际字节SHA-256 | `7b0e27fc5a0af121daa184366a186f972e569a0c05924255515f099c65b11105` |
| 原AB batch SHA-256 | `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15` |
| 唯一待协调unknown/head | `420fd5e13e5b637c1a6d62f6fad1e16dccd19c8f1f2c26c8302db892c34fcd09` |
| 原AB限定源码 | `5faac8151f59d66de72c3caead8cad916ea547da` |
| 现Worker | `20261010T014638Z-97833d2f2b7e7bc9`／`f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113` |
| Django | `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`，未变 |

封存根：`E:\codex-artifacts\release-integration-review-20261010\AB-backup-metadata-20261010-1025-final`，authority为其中 `metadata-scope.json`。原当前阶段4505依赖＋新增34输入，共4539唯一完整pin已实际验证；不重建Worker，也不执行main新合入的其他优化代码。原9批次、0bca封存22输入及其已执行历史保持。

新批准只允许该根 `execute-reconciliation.mjs` 针对真实完成备份点 `E:\运营管理系统业务数据\daily-20261010T093506Z-8a5a7107b3f6` 追加一次可验证、create-only/fsync的效果协调事件及5项真实输出。继续保留原unknown/exit1、`originalShellSucceeded=false`、`releaseRetentionStatus=blocked`、`backupReplayed=false`。没有生产数据写入、生产恢复、Backup重放、重启、调度定义修改、手工外发或C采用授权。详情及回退界限见 [方案](PLAN.md) 和 [源码独立复审](INDEPENDENT_REVIEW.md)。

该调用器只补登记，不执行tail；若用户明确批准补登记并续接AB，随后仍由原已批准9批次引擎在新鲜准入后继续17–21。原Restore是隔离 `34d6af76d635:55593` 演练，不是生产恢复；已passed前15项不重放。scope/head/owner/输入或恢复点变化必须拒绝，不能沿用失效批准。

**不能承诺整批通过**：原strict comparator已拒绝6张表的实际前后差异，第19步预计被原断言阻断；不白名单表、不改基线或unauthorized计数。原三槽轮转已删除pre dump，旧manifest/演练收据不能充当仍有效回滚包。当前post还未Restore，恢复资格和差异来源仍未闭合。releaseRetention cleanup仍blocked。页面200与10:19被动正常快照不能覆盖已有异常或下一次动态检查。

回退边界：新增调用器没有可部署服务或需停服的代码；未获新批准时不追加。成功追加后的旧unknown不可删改或倒退，追加本身不授权数据回滚。若后续阻断，保持active9及全部证据，不重放Backup、不回写业务数据凑比较成功；任何新的生产恢复/切换另行准备精确方案和批准。

四状态：源码实现完成；作者21/21及非作者15/15隔离验证与源码复审完成；精确元数据候选已封存，最终scope独立复核另附；实际生产元数据采用未执行。AB只已部分采用、验收未闭合。必要验收与完整交付计时继续从原05:28:51累计，80～120分钟保留为未验证预算，不报告节省收益。

建议批准语句：`批准补登记方案 7389a4d4 并续接 AB`。只能由本会话的新真实用户消息生成对应human-metadata-approval收据，不能借旧item、任务消息或此建议文字视为批准。精确提交、合并、推送和最终封存复核见后续DELIVERY文件；本方案准备本身没有执行生产新动作。
