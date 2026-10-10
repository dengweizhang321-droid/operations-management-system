# 两批固定源码范围非作者复审

2026-10-10（Asia/Shanghai）。本次仅执行只读 Git 对象、候选源码字节及已有生产 manifest 摘要核对；没有切分支、修改实现、运行测试/构建/数据库演练或生产 operator。本文是**源码范围复审通过**，不是制品、生产候选、发布计划或实际采用通过。

**后续完整性复核发现：原 AB `c117c60d` 的无 Git 盘点排除了实际前驱中的 `.env.example`。已在新 AB `5faac815` 最小修复；补强负例及主任务串行实际5050文件/精确treehash证据均经只读复审，原AB盘点阻断已闭合。** ABC 的19字节核对保持有效。原路径范围、对象比较与失败条件保留，不把原 `c117` 升级为当时已通过。

## 精确来源

| 用途 | 精确提交或绑定 |
| --- | --- |
| 已采用 D5 的固定源码底座 | `01a0ea6de9bfc1237a761f927fff068eb55d6e41` |
| 第一批 A+B+D，含完整盘点最小补修 | `5faac8151f59d66de72c3caead8cad916ea547da` |
| 第一批原范围复审来源（历史） | `c117c60d1dd23e87ebd03a4b72f0edbe09654d61` |
| A+B+C+D 合并替代源码 | `9d41ce4fa2c7ee4d47ba1bfda0f0967d7727be9c` |
| D 非作者实现复审基准 | `58bce3f7709f36b5eb8c61f324d34facb65f4e67` |
| 只读核到 D5 Worker | `20261009T080026Z-d5fb5b62de630ae2`，manifest `01590c5698c6b68e996c7d2963b94cbf35b109205bd4e0e3993e5a6d991c4d78` |
| 同次只读核到拥有方 Django | deployment manifest `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9` |

固定候选来源目录为 `D:\运营管理系统-sales-django-release`；复审时检出 ABC，Git 干净。AB 使用该仓库的精确 Git 对象核对，未切换检出。D5 manifest 的 source tree 为 5050 文件、`8662394ff24c116685c1342ed6b8b9fa5dd58d8ffa7c0bb869be31e49e5e0646`，锁文件 SHA `486154660ca7b1c32822078584c7938ae5de172a0dc8bcd47891100563af935e`。该 manifest 未提供 `source.gitCommit` 字段，不能把空字段写成直接声明了 `01a0ea6d`；固定底座关系按原采用来源与完整源码比较证据追溯。

原准备记录见 [scoped-source-baseline.json](evidence/scoped-source-baseline.json)。本复审没有重新调用 effective-chain/进程 collector；这里只独立重算两份已有 manifest 的物理摘要，不能由 manifest 文件存在推断当前进程完整健康。

## 全集合变化与功能范围

所有改变路径、A/M 状态、前后 Git blob 及运行工具 SHA 逐项保存在 [scoped-source-object-inventory.json](evidence/scoped-source-object-inventory.json)，文件 SHA `9deb24e38bf6bdadba249a1bd72d3377f64efd488ca0d794ef41d807ccaf6821`。只读盘点脚本为 [scoped-source-inventory.py](evidence/scoped-source-inventory.py)，仅执行 Git 对象读取。

| 比较 | 总改变路径 | tools | tests | docs | 其他路径 |
| --- | ---: | ---: | ---: | ---: | ---: |
| D5 底座 → 原 AB c117（历史） | 123 | 15 | 20 | 88 | 0 |
| D5 底座 → 新 AB 5faac815 | 124 | 16 | 20 | 88 | 0 |
| D5 底座 → ABC | 164 | 18 | 22 | 124 | 0 |

两份源码的 `app/`、`backend/`、`lib/`、`worker/`、`package.json`、`package-lock.json` 相对 D5 底座均 **零差异**。没有改 AGENTS、根配置或运行入口以外的业务源，也没有删除原底座文件。新增测试/夹具和 A/B/C 报告日志分别只在 tests/docs 内；ABC 的协议正文更新是 `docs/RELEASE_BATCH_WORKFLOW.md`。完整改变集合没有主线后来新增的业务或依赖路径，因此不会把那些功能顺带加入这两份源码。

| 改变运行工具 | AB | ABC | 范围说明 |
| --- | --- | --- | --- |
| `operations-system-control.ps1`、`operations-system-watchdog.ps1`、`process-deadline.ps1` | 有 | 有 | A 共同期限、文件输出、直接进程与外壳边界 |
| `release-lifecycle-step.ps1`、`worker-local-service.ps1` | 有 | 有 | A 原引擎、完成身份/就绪/维护及 preserve 协议 |
| `worker-authority-guard.mjs`、`worker-local-release-rotation.mjs` | 有 | 有 | A helper 首次进入保护安装闭包与精确前驱恢复门禁 |
| `worker-local-release.mjs` | 有 | 有 | A 子进程传输；ABC 另把 C 新模块加入 bundle/keyFiles |
| `release-readonly-retry.mjs`、`release-acceptance-ui.mjs`、`release-closeout-report.mjs`、`release-history-preservation.py` | 有 | 有 | B 只读重试、UI 审计、离线报告、历史行证据 |
| `release-batch.mjs`、`release-batch-admission.mjs` | 有 | 有 | A/B 原期限、错误与收尾接缝；ABC 另有 C v2 分级和有界同批准备身份 |
| `release-daily-backup.mjs` | 有 | 有 | D 必要修复：同期限、PS5 子环境、保留未知、可信最新调度覆盖未证明时关闭快路径 |
| `release-impact.mjs` | 有，仅盘点两条安全补修 | 有 | AB保持v1分类与串行读取；ABC另有C窄展示证明 |
| `release-admission-timing.mjs`、`release-preparation-evidence.mjs` | 无新增变化 | 有 | 仅ABC：C子阶段计时与准备派生身份复用 |

上表按文件分组覆盖当前全部 16/18 个改变工具路径；原15工具清单与字节见对象库存，新AB124路径见[补修复审记录](evidence/scoped-ab-inventory-repair-review.json)。所有发布机制本身都在受保护工具面内，首次采用属于严格流程；没有因选 AB 或 ABC 改成展示快批次。

## AB 移植兼容性

原 AB 的 15 份运行工具中，除 `release-daily-backup.mjs`、`release-batch-admission.mjs` 两个 D 接缝外，**13 份与 A+B 原交付 `5fb35182` 的精确 Git blob 全部相同**；当前新AB另增加一份 `release-impact.mjs` 盘点安全补修，其余15份保持。

- 日备份包装完整使用已独立复审的 D 字节，SHA `4b77088b234734fcfedeb658c81c489771d26f320b0a66a1a5286417a7857705`。它依赖的 `writeOnce`、`productionCommandArguments`、`productionCommandEnvironment`、`runProcess`、`processDeadline`、`safeProcessEvidence`、`withRotationLock` 都由 AB 原模块提供；没有依赖 C session/timing/v2 扩展。
- AB collector 与 `5fb35182` 相比，仅删未再使用的 `readdir` import、将 daily import 改为 `readScheduledBackupStatus`、将 `dailyStatus()` 改为调用该 reader。精确差异在 [scoped-ab-admission-transplant.diff](evidence/scoped-ab-admission-transplant.diff)。其 Git 字节 SHA 为 `1bb6dc999e7b0b0e3e091505288574e93b4a22287435e226e97369734a2a92c6`。
- AB collector `:85–144` 保留原 A/B：每次计算完整准备身份、原 admission/drain/closeout 完整制品验证、acceptance/closeout 原完整 Status 重试、`statusObservation` 回传，以及最终完整来源复读。没有 C in-process session、阶段计时函数或新增 v2 分类。
- 标准 daily reader 的 `lastResult=unknown`、`latestAttemptCoverageVerified=false` 在 AB/ABC 一致。AB 原恢复准入要求 latest success，故这次移植只收紧不可信旧包装成功的资格，没有自动改变数据库四项完整保障或开启 e 调度。
- 原整体 D patch 因 C-only import 上下文拒绝 check，未被 apply。当前三处移植与精确包装可由对象差异独立重建；没有把“曾拒绝整体 patch”改写为当时 apply 成功。

这是静态接口兼容性及来源核对。本轮没有在 AB 固定源码运行新构建、联合测试或候选验证；后续必须让精确 AB 制品获得相应执行证据，不能直接借用 ABC 的构建回执。

## ABC 最后字节与打包闭包

ABC 所有 18 份改变运行工具的 Git blob 均与 D 已复审 `58bce3f7` 相同；再核当前 ABC 检出的 **19 份核心物理文件 SHA 全部匹配**原独立复审摘要。第19份 `postgres_no_key_backup.py` 相对 D5 底座未变，未借本次 Worker 工具发布替换拥有方备份实现。物理比较见 [scoped-abc-physical-source-comparison.json](evidence/scoped-abc-physical-source-comparison.json)，SHA `836be2ab0a38d9003b67debd1eb33bfafb5c29b9b0413186d106fea2fa2a8a1a`。

A 的 `process-deadline.ps1` 已进入 guard entrypoint、bundle、keyFiles，原 rotation 的候选 preflight 要求该入口存在；原 guard 的旧集合兼容只允许真实旧前驱，新增 helper 不能省略。AB/ABC 的 B `release-readonly-retry.mjs` 在 bundle/keyFiles，并可被 release-batch/admission 直接导入；生命周期 command.files 仍须绑定 adapter 同目录 helper 的实际路径与 SHA。

ABC 的 `release-preparation-evidence.mjs`、`release-admission-timing.mjs` 在 bundle/keyFiles；C in-process collector direct closure 继续要求 release-batch/admission/impact/daily/retry、原 Worker/rotation、D1 两工具及 TypeScript lib/package 精确 pin。AB 没有这两项 C 运行模块引用，不需要把 C 模块错误加入第一批。

B 的 UI/history/closeout-report 是独立验收及离线工具，源码存在不等于 runtime bundle 已包含。最终调用这些工具须固定其精确源码路径和完整依赖 SHA；UI/历史实际行为与离线报告生成还需要各自执行证明，不由 release-batch runtime 模块打包代替。

## 方案必须闭合的边界

1. **watchdog 独立安装。** `operations-system-watchdog.ps1` 的安装副本不由 Worker guard 切换自动更新。A 交接已说明未执行 Install；当前 Install `:350–400` 会复制 watchdog/helper、核 SHA/ACL/installation 元数据，再 Set/Enable/Start 原计划任务。最终可审查方案必须单列精确 task XML、脚本、launcher、helper、installation SHA、安装回读与准确调度授权范围，或明确 watchdog 部分尚未采用。只完成 Worker apply 不能宣称 A 全部生产生效。本轮未执行 Install/Set/Enable/Start；不另造绕过原 installer 的生产文件替换入口。
2. **Django 拥有方不回退。** 两候选业务/后端/依赖相对 D5 固定源不变，与本次读取的 Django manifest 没有相反改动。然而 Worker source 零 backend 差异不是已安装 Django 全应用/依赖身份证明。最终候选应绑定当前拥有方 `237fbe0d…`，Django candidate 与 predecessor 相同并不部署替换；若方案需要 PrepareApp/DeployApp，必须先按完整拥有方已采用闭包复验，不从 main 或旧 Worker 源覆盖它。
3. **第二批重新绑定。** 当前 AB/ABC 两份源码都从原 D5 底座组合。ABC 可作为第一批未采用时的合并替代来源。若 AB 先正式采用，C 的计划、影响集合、守护/工具、制品与所有批次绑定须依据新的实际前驱重新准备；本文不能把旧 D5 计划升级成已批准第二批。
4. **快路径资格继续拒绝。** 无可信最新 native scheduler 尝试源、e 尚未另行采用与真实日点恢复资格未闭合时，AB/ABC 标准 reader 都拒绝数据库证据复用。没有把 C 首次机制采用用自身快路径减免；可信最新尝试与日备份配置另需独立范围和授权。
5. **最终制品与批准。** 本文没有 build、plan、PrepareApp、actual apply 或原恢复点生产操作。之后需要精确制品 manifest、完整制品/guard/依赖校验、相应固定源码测试、回滚与最终范围，以及用户另行对精确批次批准。

## 本次结果

两份源码全路径审查、AB 限定移植静态接口、ABC19实际字节绑定及受保护模块可达性通过；后续新AB两条盘点安全修复、补强负例与完整实际前驱盘点证据也经只读复审闭合。原两份相对底座与新AB补修的 `git diff --check` 均通过。上列拥有方、watchdog独立采用、C最新调度、最终制品/测试/计划与批准项仍是发布准备条件，不能提前登记为生产候选或实际采用通过。

## 后续 AB 完整前驱盘点补充

原 AB `c117c60d1dd23e87ebd03a4b72f0edbe09654d61:tools/release-impact.mjs:192` 的无 Git walker 对所有 `startsWith('.env')` 文件一律排除。实际已采用 D5 `source-snapshot/backend/.env.example` 存在，物理 SHA `983a1883885c58528ccbc737713367b785694566ac3c2b4550abb588e8b1a27c`。未读取其正文或真实环境文件。完整源码 inventory 必须含此示例文件；原 AB 专项通过不能证明实际前驱全部5050文件及字节已覆盖。

要求的最小修复是只让 `.env.example`/`.env.sample` 示例参与盘点，实际 `.env`、`.env.production`、`.dev.vars` 与原生成/运行目录继续排除；无需引入 C 分类扩展、有界 IO 或缓存。修复后重做 AB 源码提交、影响 inventory/treehash、工具 SHA、对应必要负例及候选绑定。本次只读确认，未改实现或执行测试。

必要验证建议：无 `.git` 的合成树同时含示例与真实形状环境文件；示例精确入库、其余排除；只改示例字节并保持 mtime，完整 inventory/treehash 必须改变。最后读取实际 D5 immutable snapshot 的全部合格文件，要求 count=5050 **且** treehash=`8662394ff24c116685c1342ed6b8b9fa5dd58d8ffa7c0bb869be31e49e5e0646`，不能只检查文件数。

同时记录原 AB `:181–186` 的 broad ENOENT catch 仍可能在 Git 已选择文件读不到时降级为物理盘点；ABC/C 已将“只有 `.git` 探测不存在才 fallback”分开。若 AB 不移植这条安全边界，应明确旧行为及实际准入其他门禁的覆盖，至少用真实 tracked-file 缺失负例确认不接受减少后的集合。此项不属于有界 IO/缓存性能收益，不应以 C 扩展范围为理由声称旧行为已证实安全。

### 当前安全补修复审

`5fac08e7a30db9b1aed359874cde37b5e04b2481` 只调整公开示例排除规则；`5faac8151f59d66de72c3caead8cad916ea547da` 将 ENOENT catch 收窄到 `.git` 的 lstat。两提交只改变 `tools/release-impact.mjs`，其物理 SHA 为 `ad101d63a295ca79ee53c601cbe44c1525de47870505e2059947ba676b5c0944`。Git已选择集合后的 list/read ENOENT直接传播，不再允许缩小为另一盘点；无Git读取仍串行，`teruisi-release-impact-v1`、分类规则和其余所有AB工具保持，没有引入C分类/有界IO/缓存扩展。ABC与D主线实现未因此改变。

本复审读取[负例脚本](ab-inventory-negative.mjs)与[主任务当前日志](evidence/ab-inventory-negative.log)，没有执行它们。公开样例/私有形状环境文件断言有效；Git选择后的真实file read接缝删除选中文件并抛ENOENT，实际旧fallback不能通过该负例。当前脚本SHA `2811b2bd41e099e27e7689ed7c3a38c3a3bde49929769f25c2fc7d41dfa06a64`、当前日志SHA `96f0497baaad02e0755ef781c80f4f3df5415e60b32ef9e330fc1cc775040c49`。

“same mtime”首次证据不充分：原脚本先取得before，再把文件mtime改为固定时间。首次日志已保留[ab-inventory-negative-first.log](evidence/ab-inventory-negative-first.log)，SHA `fcce470cc4fbe166d17a9c0947ad73fe3d76760d4173f5bee09ff45f367b8bfc`。当前脚本在before前固定mtime，真实stat前后都为 `1767225600000`，改字节后恢复同时间且inventory/treehash改变；该负例现在成立，没有反推首次标签已证明条件。

主任务在恢复演练结束后串行执行实际D5完整盘点，证据[ab-full-predecessor-inventory.json](evidence/ab-full-predecessor-inventory.json)，SHA `36be30a3f3d773192c6cb27e2a3729d762c54a9d8883334bfdc2ae5e21558b1b`。实际5050文件、tree SHA `8662394ff24c116685c1342ed6b8b9fa5dd58d8ffa7c0bb869be31e49e5e0646` 与原D5 manifest完全相同；示例SHA `983a1883885c58528ccbc737713367b785694566ac3c2b4550abb588e8b1a27c` 与本复审先前独立读取的实际文件相同；inventory SHA `fd9654449c7e5afa58b5ab56493dd188e69a3b938091e48695bdc2e2d906644c`。本复审只读对照原manifest和主任务实际输出，没有重复运行盘点或原恢复。

## 现存恢复点镜像只读证据复核

本次核对的是主任务已执行的原 installed Verify/RestoreRehearsal。没有创建新的生产备份、改变保留策略、恢复生产或重新跑镜像。镜像来自现存 `daily-20261009T114230Z-7117da1c1055`，manifest SHA `c3def80e40bf8ebad3e0d3e3a2c09a64b2d4d99bd6cf95d48c41b7b12ff62400`，独立端口55591、rehearsal `4088f7ed4793`。这不是候选最终批准批次的前后两次严格备份/恢复，也不能代替日备份 native latest 成功。

本复审直接读取原受保护 `E:\TERUISI-Postgres-Rehearsals\restore-4088f7ed4793\rehearsal-result.json` 及 sidecar，原字节SHA `0a0cfa4f72415b8a6def5afa76bdfa2a27e1d7277905853b555adb1c70e0ef6d` 与sidecar一致。与实际 retained manifest核对：dump SHA `c58c008b90079bf1ac9612a6f16bff3f6899ff854fe265f31c94c85acdc8ed49` 相同；expected/restored content均 `8c640b74691222c76176798d86e554e7c259f381a1f91dd81c361ac25d81f904`；profile content绑定相同；`profileRestoreVerified=true`、`sequenceHealthVerified=true`、`cleanupStatus=isolated_data_removed`、`productionDatabaseTouched=false`、`serviceStateChanged=false`。

[主任务执行摘要](evidence/restorerehearsal-existing-point.json)保留直接exit0/completed、文件协议/preserve及原stdout SHA `2b56ee732e9403b2027d63539f4b11d5712913430fb8f8b1ac0616484ae02187`，耗时 `706423.0375ms`；Verify为 `3167.7967ms`。它是源输出摘要，不等于上面的受保护JSON文件SHA；两种原始格式不得互换。原回执额外记录 `policySyntaxEquivalenceVerified=false`、空witness：该附加语法见证未通过，不把profile必需门禁通过泛化为全部SQL语法等价已证明。

[主任务清理记录](evidence/restore-closeout.json)保留首次PS7自动日期类型转换导致的JSON比较误报，并按PID+UTC ticks重新核对，没有改原operator回执。本复审另做轻量只读现场回查：生产PID4080存在，创建时间UTC ticks与 `2026-10-04T14:26:47.0957370Z` 一致；55591无监听；本镜像data目录不存在。详见[独立镜像复核记录](evidence/independent-existing-mirror-review.json)，SHA `b6e835ea34e41c799cec04da12bbb6ce26e5348dfad013ebac0caec009cab5ae`。

镜像身份、该恢复点的内容/必需profile与序列验证和当前清理证据闭合。没有把一次镜像成功推算为候选整批发布时间、生产不可用窗口、日备份快路径资格或实际采用。
