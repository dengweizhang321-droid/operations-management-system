# 后备份元数据封存范围独立复审

2026-10-10 10:28:25 UTC，只读复审通过。结论是**元数据候选可供用户精确批准**；尚未获本范围生产批准，也未执行补登记或尾部。复审不是生产授权或 AB 完整验收通过。

封存对象为 `E:\codex-artifacts\release-integration-review-20261010\AB-backup-metadata-20261010-1025-final\metadata-scope.json`，sealedAt 为 `2026-10-10T10:25:53.660Z`。直接对原字节用 Node `JSON.parse`，按原 canonical 规则复算 core，scope SHA 为 `7389a4d45c9ac8356eae7a6cb50bf987ea647703fbd68ec8f63f83dbf949640c`，文件 SHA 为 `278733b22abb3ba77193bbcc4bb634774834bbeb9c5ec1c97ede49850319c514`。没有经过 PowerShell 日期转换或改写 E 文件。

| 核对项 | 结果 |
| --- | --- |
| 源码提交 | `a9f2bd327fc6cfbd7248ee4da7dd9f5488743fd3` |
| 外置 API SHA | `3fabc2009287d12088559f882e7b326903aeb8b0a1f8eb29cda6faf7f17b5865` |
| 外置调用器 SHA | `7b0e27fc5a0af121daa184366a186f972e569a0c05924255515f099c65b11105` |
| 原适用闭包 | collector＋16–21，共16667个声明、4505个唯一路径，无冲突，全部 SHA 被 scope 精确覆盖 |
| 封存 pin | 4539个唯一绝对路径＝原4505＋新增34；新增34件逐件原字节 SHA、单链接及安全祖先核对通过 |
| 独立复审和测试 | 封存 API/调用器与此前复审字节一致；15/15独立测试最终日志 `8183cb23bfd8f05a28f49b750f3c38c6195ef907e734e7f3307298b193bb817c` |
| 原 WAL | 75件逐条事件摘要、previous链、批次绑定通过；head仍 `420fd5e13e5b637c1a6d62f6fad1e16dccd19c8f1f2c26c8302db892c34fcd09` |
| 原状态 | backup-post仍unknown/exit1；前15项latest passed；17–21未开始；active仍原AB9 |
| 新批准和执行证据 | 封存目录无human-metadata-approval.json，无执行outputs；WAL尚无补登记事件 |

五项 outputs 与真实 native result、独立 proof 完全相同：备份为 `E:\运营管理系统业务数据\daily-20261010T093506Z-8a5a7107b3f6`，manifest SHA `4cc95143e5feffbd801388cb5de8dd59e269f099ce193afbdc4cfaba310e0f88`、dump SHA `bd3c532a8f897eea2f09f3b60270543993abcda802bd2147c3937539dfc680c8`、content SHA `b2a042fd4e5287ab30642180365d05a74694f7d07ed490c83454bd40f50cf6ce`。native result 的纯序列化与原unknown保留的1319字节/stdout SHA一致；这不声称找回了已删除的原 stdout 文件。manifest/sidecar与原合同/validator原字节也分别核对。

scope 的唯一新动作是使用原锁、原 journalState/writeOnce 和受限新 API 追加一次明确协调事件。它不改旧批次、历史事件、Worker候选或数据，不重跑Backup，不执行17–21，不恢复生产数据，不采用C。新事件必须继续保留 `originalShellSucceeded=false` 与 `releaseRetentionStatus=blocked`，不能把原非零退出写成原命令正常成功。审批必须是晚于封存的新精确范围和真人记录；旧AB/UI批准不覆盖它。

以下阻断仍然存在，不能因元数据可补登记而消失：

- 严格比较的六表差异仍保留：market_write_request_receipts、workflow_task_activity_logs、workflow_task_comments、workflow_write_request_receipts、workflow_data_revisions、workflow_tasks。来源尚未独立确认；原严格比较不得豁免。
- 发布前 `E:\运营管理系统业务数据\daily-20261010T054420Z-3f75a3055cf6` 目录在本次读取时确实不存在，旧manifest/Restore回执不等于当前可用dump。当前后备份还不能声称完成隔离Restore或完整回滚资格。
- releaseRetention仍blocked；原shell exit1、unknown及原错误摘要保持，底层原因未进一步证明。
- 10:18 HTTP200但core NotReady以及10:19恢复仅为已有观测。补登记不证明当前健康，不豁免尾部的新鲜身份、权限、维护、排空或每步动态准入。
- `fullBatchCompleted=false`。第19项严格比较预计仍阻断；本范围不保证完整验收闭合，不重算耗时或节省时间。

本次没有Status、HTTP/UI、collector、Backup、Restore、锁获取、生产API调用或生产写入。为避免同机争用，只核原4505完整pin集合覆盖，并重核新增34件真实字节，没有重复整套磁盘哈希或946874951字节dump扫描；已审调用器及API在执行时必须重新完整检查，文件、head或数据变化即拒绝。本次inline checker曾误假定原unknown存在operationSha256字段；按真实WAL schema改为原authority中的精确operation摘要及完整事件链绑定后检查通过，这是检查方法更正，不是源码缺陷或断言豁免。

机器结果见 [SEALED_SCOPE_INDEPENDENT_REVIEW.json](SEALED_SCOPE_INDEPENDENT_REVIEW.json)，源码及15项测试边界见 [INDEPENDENT_REVIEW.md](INDEPENDENT_REVIEW.md)。
