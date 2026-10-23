# 整个系统的 GitHub 云端代码备份

2026-10-23。**源码、文档、原本地分支/标签与7个未提交源码快照的云端备份已完成并核对。** 用户明确选择完整云端备份，生产main和运行状态保持；原始客户数据、凭据及本机数据库不上传。

## 备份范围

- 初始登记151个worktree、132个本地分支、3个标签。24个detached HEAD均由这些分支/标签可达，不需要另建悬空HEAD备份。
- 132个原本地分支和3个标签已形成135条精确云端映射。57条已有同名同提交引用；新增78条引用。两个同名远端与本地不同的分支使用独立cloud-heads引用保存本地精确提交，没有覆盖远端main或原pi-upgrade分支。
- 7个worktree有未提交内容，共1919项状态记录。经公开上传内容审阅，纳入1544个当前文件和364项删除记录；11个原始客户评价、交易导出、工作簿/业务缓存文件留在本机。
- `.gitignore`已排除的凭据、数据库、浏览器登录状态、依赖、运行目录和生成物不属于本次Git源码备份。不会以“完整代码备份”表示真实数据库、凭据或整台电脑已备份。

## 未提交源码快照

快照以各自原HEAD为唯一父提交，保留完整已提交源码树，再叠加经审阅的当前文件和删除。每棵树独立保全，不把历史取消、候选或未通过修复整合进main，也不表示这些内容可发布。排除项在快照manifest中明确标注；对应本机原文件不删除。

精确引用与实际提交已写入 [cloud-backup-catalog.json](cloud-backup-catalog.json)。主目录的当前工作态对应 [wt000 云端快照](https://github.com/dengweizhang321-droid/operations-management-system/tree/codex/cloud-snapshot-20261023/wt000)。

| 快照 | 原来源 | 提交 | 当前文件/删除/排除 |
| --- | --- | --- | --- |
| wt000 | 主目录工作态 | `3b2581587d36d200fec5a909b8a24dc8fbed45ce` | 1515 / 364 / 11 |
| wt001 | ops-reliability | `9a5f5047cf2764a21efe841e1927acb1cd34e4a1` | 2 / 0 / 0 |
| wt006 | ai-agent-workflows 历史取消候选 | `056fe3bd7d8e172b2b2d558356f0da3abb9810ce` | 17 / 0 / 0 |
| wt017 | market-annotation-django-release | `d0aec23e731a2125a63f21c223cb054fc3db8783` | 2 / 0 / 0 |
| wt115 | product-combo-details-release | `a5b8df4f93f3b984e3303beb763b12890fca872b` | 4 / 0 / 0 |
| wt126 | jd-9896-rerun | `d93da9bb14c09077911e0a48571424c34c14d6db` | 3 / 0 / 0 |
| wt150 | weekly-release-lease | `cbd05249332aa80ea93229b99283e372b4a15038` | 1 / 0 / 0 |

各快照均为 `complete/uploadEligible=true`，源状态与原索引前后保持。快照读取区间记录在catalog；这是各树依次取证的有界快照，不声称所有目录在同一瞬间锁定。2026-10-23T11:14:36.708350Z完成135条原引用映射及7个快照的远端核对，初始119条远端引用均保持原对象。

快照工具使用仓库外独立Git索引，核原HEAD/branch/status/index前后不变，按已审SHA-256和长度读取文件，拒绝路径逃逸/重解析及读取中变化。原始文件字节直接写入Git blob，保留删除metadata；逐blob回读和精确tree差集通过后，只以create-only方式建立新的备份引用。7棵来源树均无独有暂存版本，原索引保持。

## 内容与交付核对

- 主树当前文件和另外6树29项均完成限定审阅；高置信凭据扫描未发现真实密钥。主树1393项与既有公开main同路径内容一致；明确含客户评价/交易原始数据的11项未上传。
- 新历史差集47个Git对象（5个commit、21个tree、21个blob）单独核查。连接串候选实际为运行时变量插值，无硬编码口令；正式恢复源码依赖中的脱敏摘要/PID/时间fixture按工程证据保留。没有将持续运行日志、完整配置或原业务明细夹带上传。
- 原135条映射已逐条通过ls-remote核对到精确对象，远端main仍为 `36668589cab03d5d2d9d98383fb58eeb19c391ee`。未使用force、未删除或覆盖已有远端引用。
- 保留本地main `2f55c3965e60b139381b6cc31ed868bcfe99a7bf` 与origin/main `36668589cab03d5d2d9d98383fb58eeb19c391ee`，没有fetch或推进这两个引用。交付索引独立保存在 `codex/full-cloud-backup-20261023`，不合main；备份分支和工作树保留。
- 这是文件与Git引用备份，没有修改业务逻辑或执行功能测试、构建、发布、迁移、服务启停、control-prepare/adopt或任何业务补跑。

## 本机保全与恢复

固定本机材料根：`D:/codex-artifacts/full-cloud-backup-20261023/`，包含初始盘点、内容审阅、批准范围、逐步日志与远端核验。清单只公开路径、长度、摘要和引用映射，不复制敏感原件到Git。

恢复源码时选择catalog中的精确备份分支/提交，在新的隔离目录检出；未提交快照的 `.codex-cloud-backup/manifest.json` 说明源HEAD、当前字节、删除及排除范围。Git检出的换行设置可能转换文本；要求逐字节恢复时直接读取对应Git blob，并按manifest的SHA-256核对。原工作树与本机排除文件保持；本次没有清理或取消任何聊天、任务、分支或来源。
