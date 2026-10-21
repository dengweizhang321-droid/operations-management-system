# 规范瘦身交付报告

## 范围与改动

仅文档，本地分支 `codex/machine-cleanup-20261022`，worktree `D:\codex-worktrees\b3`。任务开始 HEAD 与本地 origin/main 均为 `f641685b60ca11a674da713e3b7b454f338c622c`；工作区干净。未 fetch/pull/push/merge，未改 tools/、代码、运行时状态或计划任务，未发布、启停或执行生产操作。既有封存报告、证据、批次/WAL 未修改。

- [规范正文](../规范/验证与发布.md)：原三步交付全文前移到一页入口，补通用变更/验证强度阅读表及完整历史索引。
- [新历史归档](../规范/历史记录/发布限定资格-20261022.md)：13 组资格/历史协议背景，保留原文、事故日期、结论原因、约束步骤、代码引用；含 Q09 下 3 个固定终止子资格。
- [当前执行细则](../运维/部署与启动/发布门禁执行细则.md)：G01～G03 承接工具/命令细节，正文必读链接保留其完整门禁；不把当前操作细节误标成已失效历史。
- 规范历史索引、完整文档目录、任务目录仅新增导航，不改既有封存记录。
- [REVIEW.md](REVIEW.md)：新上下文独立审查，审查者不参与实现。

## 被移动的限定资格逐条对照

原位置均指基线 `docs/规范/验证与发布.md`，避免编辑后行号漂移。新位置使用稳定显式锚点，每组均由正文历史索引反查。代码引用检查限本 worktree 受跟踪源码，不声称已安装同一版本。

| 原文位置与条款 | 新位置 | 是否仍被代码引用 |
| --- | --- | --- |
| L16：旧 supervisor 状态归档与监控窗口 | [Q01](../规范/历史记录/发布限定资格-20261022.md#q01) | 是，tools/django-local-service.ps1；tools/django-runtime-supervisor.ps1 |
| L19：legacy/pi19db 维护前检与有限桥 | [Q02](../规范/历史记录/发布限定资格-20261022.md#q02) | 是，tools/manual-maintenance-continuation.mjs:7；:18；:29；:53；:71；:148（releaseId/manifest/helper SHA） |
| L24：历史审查夹具有限 lint 语义 | [Q03](../规范/历史记录/发布限定资格-20261022.md#q03) | 是，eslint.config.mjs；tests/lint-evidence-scope.test.ts |
| L25：十工具无迁移闭包与 CF 缓存有限差异 | [Q04](../规范/历史记录/发布限定资格-20261022.md#q04) | 是，tools/release-impact.mjs:416（teruisi-tools-no-migration-v1 及 CF 资格） |
| L50：Django 摘要辅助与精确三项库存扩展 | [Q05](../规范/历史记录/发布限定资格-20261022.md#q05) | 是，tools/verify-release-candidate.mjs:91；:96；:306 |
| L51：Windows Pi 退出观察限定资格 | [Q06](../规范/历史记录/发布限定资格-20261022.md#q06) | 是，tools/verify-release-candidate.mjs:130；:396；tools/manual-maintenance-continuation.mjs（固定 helper SHA） |
| L69：Runner 首版尾部续接与历史一次性恢复 | [Q07](../规范/历史记录/发布限定资格-20261022.md#q07) | 是，tools/publish-main-status.mjs；tools/publish-main-known-resume.mjs:7；tools/pi150-forward-recovery.mjs |
| L77：v1→v2 hook/shim 首次桥接 | [Q08](../规范/历史记录/发布限定资格-20261022.md#q08) | 是，tools/install-main-prebuild.mjs；tools/main-control-dispatch.mjs |
| L81：准备队列原 unknown 的精确历史终止 | [Q09](../规范/历史记录/发布限定资格-20261022.md#q09) | 是，tools/main-prebuild-queue.mjs:214；:401；:615（FIXED_ADMIN_E2、FIXED_SCHEMA_ECE、FIXED_CACHE_0B） |
| L89：JD0016 147→148 首个结构 recipe 边界 | [Q10](../规范/历史记录/发布限定资格-20261022.md#q10) | 是，tools/main-schema-release.mjs:9；tools/jd_product_monitoring_catalog.py:7 |
| L167、L169–L184：旧批次验证类别与 full/reuse/not-required 资格 | [Q11](../规范/历史记录/发布限定资格-20261022.md#q11) | 是，tools/release-impact.mjs（requirementsForImpact、recoveryDecision）；tools/release-batch.mjs |
| L186–L192、L212：v4 首次采用顺序与 f15 当时采用事实 | [Q12](../规范/历史记录/发布限定资格-20261022.md#q12) | 是，tools/release-impact.mjs:389；:409；tools/release-batch.mjs（f15 是文档事实，未发现作为准入字面量） |
| L194–L202：CI 分级候选未采用与部分验证边界 | [Q13](../规范/历史记录/发布限定资格-20261022.md#q13) | 否，未发现本 worktree 的 tools/ci 或 verify:l0/l1/l2/l3 当前入口；固定候选提交仅归档引用 |

Q09 子资格逐条为 E2（dispatch e2a76305）、ECE（ece64080）、0B（0b4674f2），完整身份、原因、步骤与引用见归档子表。Q11 是旧协议资格，Q12 是首次采用及当时事实，均非新常态门禁或后续授权。

## 现行门禁强度未降低：逐项说明

| 门禁/边界 | 保留情况 |
| --- | --- |
| 常态三步及组件范围 | 原三步全文前移；前端 Worker、后端 Django、migration 才迁移、共享/未知完整组件流程保持；用户本轮明确禁止合并/推送，故只本地提交 |
| AI 检查／用户功能检测 | 原分工不变，历史清单不新增功能验收，也不跳过执行器内部检查 |
| 来源/依赖/请求/制品/前驱 | 完整字节、干净来源、PREPARED 及即时复验不变；提前检查不代替动态事实，无制品拒绝 |
| 身份/权限/锁/排空/维护/启动 | 唯一引擎、普通权限、原锁序、精确回执/进程和 ready 保持；Q01/Q02 保完整旧状态/桥条件及两分钟窗口 |
| 冷启动与局部证据 | 改真实生命周期仍须隔离原生冷启动，缺能力不合并；Q05/Q06 保三项逆投影、45 秒、AST/负例/真实同 token worker 闭环；false 不写通过 |
| 原失败/unknown/有限重试 | 保 STARTED/FAILED、owner/WAL/gate、原输出及真实退出，不换 ID/删原件/按文案推零效果；Q07 最多一次 Reconcile、Q09 双锁及独立新鲜见证保持 |
| 队列触发/派发/复用 | create-only＋fsync DISPATCH 后才准备；完整目标/代际绑定、queue→rotation、callback 前最多 30 分钟有限等待、DISPATCH 后 unknown 保持；Q08 旧 shim 不泛化 |
| 有限 recipe/结构迁移 | Q10 原 147→148 不授权其他迁移；完整证明和未知拒绝保持。后续结构迁移取消默认全库备份/恢复的现行约定原样保留，不复活旧默认步骤 |
| v2/v3 数据保障 | Q11 完整原表与 full/reuse/not-required 原文迁入：26 小时、7 天、日备份/摘要/三边界复验、v3 完整闭包/no-data-negative/零动作资格不变；缺资格不减免，未知 full |
| 无迁移闭包/CF | Q04 保双 Django 清单/库存、十文件字节、受限叶子逐 hash 及现场其余字段不变；migration-closure 不冒称执行 PG 恢复 |
| v4 首次采用 | Q12 保 strict、十工具/双 Django、额外 targeted-recovery-negative/installed-recovery-consumer、前 Backup→同点新 installed Restore→同 ID Exit→唯一 Start 及全部原检查；旧批准/WAL 不变 |
| 未验证/部分验证/未采用 | Q13 原 CI 分级、固定候选未采用、缺命令、L2/L3 pending、真实业务/冷启动未验收及 lint/覆盖缺口全文保留；SHA/草稿/局部探针不证明执行或采用 |
| 备份/包保留/生产恢复 | 原 7×24 小时与保护包、最多 3 恢复点/短暂第四份、先验证后淘汰、恢复另批精确点/目标/窗口保持 |
| 完成/计时 | SUCCESS/VerifyStartup/ready/维护退出齐备；不以 exit0 或历史成功替代，不追加功能验收；15 分钟是目标非豁免，原总等待/失败/未采样空档保持 |
| 文档/执行器边界 | 归档明确适用资格仍逐项约束；引用存在不证明已安装同代际；源码/候选不改称已采用；代码固定条件需后续独立任务泛化 |

## 通用操作细节位置对照

只移动当前操作细节，不改变资格或执行器。以下组的历史特例已分别进入 Q 条目，余下当前规则在运维细则保持全文；正文对应小节要求适用动作前逐项读取。

| 基线位置 | 新位置 |
| --- | --- |
| L14～L32（在线准备、前检、范围/数据保护、唯一引擎、ACL 和隔离） | [G01](../运维/部署与启动/发布门禁执行细则.md#g01)；事故细节另见 Q01～Q04 |
| L44～L52（合并前兼容、依赖锁、固定验证器、证据分类） | [G02](../运维/部署与启动/发布门禁执行细则.md#g02)；窄资格另见 Q05/Q06 |
| L54～L90（固定入口、完成判据/受限续接、自动准备） | [G03](../运维/部署与启动/发布门禁执行细则.md#g03)；事故细节另见 Q07～Q10 |

## 核对结果

- 基线正文 144 行非空原文逐行对照：在新正文、历史归档及执行细则中全部保留（只对移动后的 Markdown 目标路径作归一化比较）；无缺失。原三步保持全文。基线 UTF-8 SHA-256：`f61093be17ab2ce7a6119a6a4d0ea4a35269e7e7a48423edd18ba08935784b38`。
- 正文由 23,661 字符缩至 12,213 字符（减少 48.4%）；首部常态路径含标题、原三步及边界共 1,117 字符，约一页独立呈现。
- 首轮链接核对发现迁移后 3 个相对链接需重定位，已修正到现行正文和开发与交付；保留原条件不变。
- 当前正文/历史/细则/REPORT 共 90 个本地链接与锚点通过；现有受跟踪文档指向本规范的 27 条链接无新增锚点失效。基线已有 `发布与备份保留约定` 锚点缺失，未作为本轮新增问题修改旧记录。
- 独审要求补准 Q08 的 10 月 18 日桥形成日期及原提交，Q03 补有限 lint 原提交；已修正且增量复核通过。独立审查结论：通过，无未解决阻断；[审查证据](REVIEW.md)记录 144 条原非空行完整保留、八份交付/导航文档 1,329 个本地链接及锚点有效（含既有导航，非全为本次新增）。只做文档/源码引用的只读核对，不运行功能测试、发布工具或计划任务。

引用兼容：保留旧 `常规-full--reuse--not-required` 显式锚点，让原启动手册链接转到 Q11 完整资格；未追改旧手册或封存报告。

## Git 交付

仅在指定 b3 分支完成聚焦本地提交；没有合并、推送、准备制品或生产操作。分支/worktree 按本轮约束保留，供后续任务集成；不清理其他并行工作区。
