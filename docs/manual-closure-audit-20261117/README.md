# 工作流「手动闭合」盘点与方案（2026-11-17）

状态：只读盘点与方案，未改代码、未改生产、未触发工作流。是否进入实现待用户决定。

用户问题：「现在所有的工作流排查一下，看全部都做成有手动闭合的，会不会更好」。

## 一句话结论

**不建议「全部做成手动闭合」，建议「全部有受控闭合口」。** 三类卡点要分开处理：

1. 能证明零业务效果的（提交前失败）应**自动**闭合。改成手动反而多一道人工。
2. 已向平台提交、结果未决的应**手动**闭合，但必须走受控入口。这一步要人去平台核对，不能自动猜。
3. 已下载但内容错的，走**窄例外作废**，必须有精确错误证据。

真正的缺口有两个：

- 天猫推广 P 直连至今没有任何受控入口，只能手改 JSON。
- 客服、吉客云的闭合要读 n8n 执行记录，而 n8n 只保留约 14 天，过期后闭合会失效，和 11037 旧工具失效是同一个坑。

先补这两处，再把公共协议抽成共享内核、逐条迁移。不要一次性推翻现有工具。

## 1. 盘点范围与证据来源

- n8n：`C:/Users/86137/.n8n/database.sqlite`，只读打开（`?mode=ro`）。
  - 共 24 条工作流，17 条启用、7 条未启用。
  - 执行记录最早是 11117，开始于 2026-11-03 08:48 UTC，最新 11735。说明 **n8n 只保留约 14 天**，之前的执行记录和 execution_data 已被清理。
- 线上状态目录：`D:/运营管理系统/outputs/`（只读）。
- 代码：main `e3ecd40b`。
- 京东物流零效果判定实测：`node --import tsx tools/jd-logistics-zero-effect-inspect.ts inspect D:/运营管理系统`，该工具只读。

### 1.1 未启用的 7 条

不运行就不会留下活动清单，不会卡死，不在本次闭合范围。

| ID | 名称 | 不启用原因 |
| --- | --- | --- |
| `JdN8nM3uL7tI2026` | 京东多店铺商品数据统一下载与导入 | 已由静默副本 `JdN8nSilentCopy2026` 取代 |
| `JdMarketDaily2026` | 京东市场榜单缺失日 | 已由 `JdMarketSilentCopy2026` 取代；规范要求两者不得同时启用 |
| `cF7wN8k2pQ5sR1vX` | 天猫-亿玖生意参谋逐日签收 | 旧版，已由 `M4xY8kQ2vR6sT9pC` 取代 |
| `DlSNhk4y5H1e7AJ6` | 天猫一次性跳过 M 恢复 | 一次性恢复流程 |
| `TmallWarehouseDaily2026` | 天猫入仓监控·实时库存 | 从未发布（`workflow_publish_history` 为空），启用前另议 |
| `NewProductWeeklyDingTalk2026` | 新品销售周报 | 10-22 12:50 UTC 停用，不是导入流程 |
| `20ZtTLAAbsx5KvTp` | My workflow | 空测试草稿 |

## 2. 启用工作流逐条盘点

表中「近 14 天」统计窗口为 2026-11-03 至 11-17。连续失败段从 `execution_entity` 计算。

| 工作流（定时，北京时间） | 活动指针 / 阻塞点 | 近 14 天卡死记录 | 提交前零效果闭合 | 提交后 / 内容错的闭合 | 依赖会过期证据 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 吉客云五表 `J8kY2mQ5vR7sT4pN`（00:10） | `outputs/jackyun-export-first/active.json`；拒绝在 `tools/jackyun-export-first-pipeline.ts:564` | 11221 未闭合，11-05 至 11-06 连败 5 次（11223–11247）；11680 于 11-17 卡住 | 自动：`lib/jackyun/automatic-preflight-recovery.ts`；人工：`tools/jackyun-preflight-recovery.ts plan/apply`；a6ba0edb 新增的零效果人工关闭 | 操作员闭合：helper `POST /coordination/jackyun-close`（`lib/jackyun/operator-close.ts`），intent 采用不覆盖 rename，另有 `pruned-evidence.json` 兜底 | **是**：零效果闭合读 n8n `execution_data`；操作员闭合有兜底 | active 指向 11711，已完成 |
| 京东商品四店 `JdN8nSilentCopy2026`（10:00） | `outputs/jd-ware-export/active-task-<store>.json`，拦截在 `tools/jackyun-ware-export.ts:1255-1266` | 11-15 连败 3 次（runner 未完成），同日恢复 | **自动**作废：无 taskId、超过 30 分钟、无候选任务（`lib/jd/ware-export.ts:147-161`），归档为 `.abandoned-<ts>.json` | 有 taskId 时按任务状态恢复 | 依赖京东任务列表（只用于判断"有没有候选任务"） | 无 active |
| 京东市场榜单 `JdMarketSilentCopy2026`（10:30） | 无 active；`claimRecoverableJdMarketPlan` 自动接管同身份的唯一未完成计划 | 无 | 自动接管续跑 | 人工可用 `resumeRunId` 显式恢复；**running 计划永久卡住时没有作废入口** | 否 | 11723 已完成 |
| 京准通两店 `JdPromotionDaily2026` / `JdPromotionCutMeat2026`（10:40 / 10:50） | 无 active；每轮按覆盖缺口重新规划（`tools/jd-promotion-n8n-pipeline.ts:301-325`） | 11-03 连败 3 次（HTTP 413，不是闭合问题） | 天然收敛 | 生成点击未决时由恢复清单失败关闭（规范第 17 行），没有人工入口 | 否 | 11724 / 11725 已完成 |
| 京东客服四店 `JdCustomerService*2026`（09:05–10:05） | `outputs/jd-customer-service-pipeline/[jd-<store>/]active.json`；拒绝在 `tools/jd-customer-service-n8n-pipeline.ts:88-108` | 洗碗机 11-06 至 11-13 连败 8 次（其中 7 次 LOGIN_GATE）；四店各有 2 次 PREVIOUS_RUN_UNRESOLVED | 自动：`closeCustomerServicePreSubmitFailure`（`tools/jd-customer-service-failure-closure.ts:54-83`） | 人工：Worker `POST /api/imports/recovery/customer-service-close`，经 Django 签发授权，由 helper 执行，回执写入 `operator-closures/`；另有 source-recovery | **是**：自动闭合与人工闭合都读 n8n `execution_entity`，自动闭合还读 `execution_data`（`lib/jackyun/n8n-preflight-evidence.ts:12-75`），**没有兜底** | 四店均已完成（11716/11717/11718/11722） |
| 京东物流 `JdLogisticsDaily2026`（08:50） | `outputs/jd-logistics-pipeline/active.json`；拒绝在 `tools/jd-logistics-n8n-pipeline.ts:107-122` | **全部 14 次失败**（11124–11714），一直被 11037 挡住，最后成功是 10-16 | **自动**：`tools/jd-logistics-zero-effect-closure.ts`（77cba7bb，create-only，不覆盖移动） | 无；旧专用工具 `close-jd-logistics-login-11037.ts` 依赖 n8n 证据，**已失效** | 新方案否，旧方案是 | **仍阻塞**。实测只读检查对 11037 的判定为 `verdict: zero_effect`，下一次 A（11-18 08:50）会自动闭合 |
| 天猫六店 · 推广 P 直连 | `outputs/tmall-direct-promotion-export/active-tmall-<store>.json`；拒绝在 `tools/tmall-direct-promotion-export.ts:486-489`（换日）和 `:510-517`（未决或缺 taskId） | 炊之王、马思图 11-04 各连败 13 次和 15 次，均为 `report_submitting`；马思图 11-05 遇 403；丽力 11-13 起连败 68 次 | 无专门闭合（`planned`/`browser_ready` 失败可直接续） | **没有任何受控入口**：11-04 和 11-05 都靠手改 JSON 的 `resumeStage`/`taskId`，或手工归档为 `operator-archived-*.json` | 是：依赖阿里妈妈报表列表（任务会过期） | 丽力 `failed/downloading`，taskId 22117697，日期 11-12 |
| 天猫六店 · 货品 M 直连 | `outputs/tmall-direct-product-master-export/`；拒绝在 `tools/tmall-direct-product-master-export.ts:275` | 拓丰 11-13 起连败 58 次（第 8 批串单） | 无专门闭合 | 人工窄例外：`tools/tmall-direct-master-admin.ts --action abandon-batch-content-mismatch --dry-run/--confirm`（e3ecd40b），11-17 已对拓丰执行 | 否：现场重新解析本地文件 | 无 active |
| 天猫 · 逐页 M / 商品管家 M（旧协议） | 各自目录 | 无（新工作流不再使用） | 业务点击前失败归档为 `preflight-failure-*` | 逐页：`tools/tmall-pagewise-audit-admin.ts --action abandon-invalid-downloaded --confirm`（**没有 dry-run**）；商品管家：`abandonActiveTmallProductMasterAudit`（**没有 CLI**，只有测试调用） | 依赖平台导出记录 | 无 active |
| 天猫 · 生意参谋 B/C 与回环 | 没有活动清单（只有 backfill/coverage/manifest 进度文件） | 不适用 | 不需要 | 不需要 | 否 | 无阻塞 |
| 每小时安全重试 `TeruisiHourlyRetry2026` | `outputs/n8n-retry-dispatch/<wf>-<failedExec>.json`：按失败 execution 一次性预留，**永不释放**（`lib/jackyun/retry-dispatch-reservation.ts`） | 报错 62 次，其中 56 次是终局告警被写死成「dispatch result unknown」的误标（已由 c77f472b 修正） | 不适用 | 无；预留只防同一失败被重复 POST，不阻塞新的定时运行 | 是：人工核对要看 n8n 执行记录 | 共 320 个预留，上限 4096 |
| 共享 helper 协调（127.0.0.1:5791） | owner 只在内存里；落盘的只有 `.runtime/jackyun-automation.lock`，进程死后自动清理 | `coordination_wait_expired` 共 10 次，10 条流程各 1 次 | 不需要（失败发生在 A 之前，零效果） | `quarantined` 槽位只能重启 helper | 否 | `/health` 显示 busy=false |

## 3. 按卡死频率与影响排序

近 14 天的实际卡死都来自下面这些点；更早的记录已被 n8n 清理。

| 排名 | 卡点 | 次数 / 时长 | 当时怎么解的 | 现在的状态 |
| --- | --- | --- | --- | --- |
| 1 | 京东物流 11037 未闭合 | 14 天全败，最后成功 10-16 | 旧专用工具从未执行，后来证据过期 | 通用自动闭合已上线；实测 `zero_effect`，11-18 自动解开 |
| 2 | 天猫丽力 P 内容拒绝（店铺直达） | 68 次 | b728fd7c 修了口径 | 卡在 `downloading`，明天能不能续接取决于阿里妈妈任务 22117697 还在不在。**任务过期就会卡死，且没有作废入口** |
| 3 | 天猫拓丰 M 串单 | 58 次 | e3ecd40b 新增作废入口，11-17 18:04 执行 | 已解 |
| 4 | 天猫炊之王 / 马思图推广 `report_submitting` | 28 次（11-04 至 11-05） | **手改 JSON** | 已解，但入口缺口仍在 |
| 5 | 吉客云 11221 / 11680 | 5 次加 1 次 | 操作员闭合；a6ba0edb | 已解 |
| 6 | 客服 PREVIOUS_RUN_UNRESOLVED | 每店 2 次（更早还有超过 8 天的积压，见既有记录） | 自动闭合加操作员闭合 | 已解 |

还要注意两点：

- 洗碗机 8 次 LOGIN_GATE、拓丰和马思图的验证码、京准通 413 这类失败，是登录或代码问题，**不是闭合问题**。手动闭合救不了它们，只能让人登录或修代码。
- 「全部做成手动闭合」解决不了这一半的失败。

## 4. 方案比较：各自专用工具 vs 统一闭合框架

| 维度 | 各自专用工具（现状） | 统一闭合框架（推荐方向） |
| --- | --- | --- |
| 协议一致性 | 不一致。逐页 M 没有 dry-run；商品管家没有 CLI；推广 P 只能手改 JSON；客服要三个请求头加 Django 授权 | 一套固定协议：只读检查 → dry-run 输出摘要 → confirm 带摘要 → create-only 审计 → 不覆盖地移动原清单 → 运行中互斥 |
| 证据过期 | 客服、吉客云依赖 n8n 执行记录；11037 旧工具已因此失效 | 内核规定：**失败当时就把所需证据封存进计划目录**，闭合时只读封存件，不再回读 n8n |
| 判定逻辑 | 每条线都有精确的阶段划分（如客服 `querying/confirming` 才算提交前），这是多次反审的成果 | **判定逻辑保留在各线适配器里，不统一**；只统一外壳和协议 |
| 误闭合风险 | 各工具的白名单都很窄；手改 JSON 没有任何保护 | 不提供通用的"强制关闭任意清单"按钮；每个适配器必须列出可闭合阶段与错误码白名单，默认拒绝 |
| 迁移成本 | 无 | 中等。现有工具能用，可以逐条迁移；京东物流、直连 M 的协议已基本符合，可当作样板 |
| 操作体验 | 每条线入口和参数都不一样，操作员要查记忆 | 一个入口：`闭合 inspect/plan/apply --pipeline <线> --store <店>`，输出统一的判定与拒绝原因 |

**推荐做法**：统一外壳（共享内核 + 统一 CLI），判定逻辑仍由各线适配器负责。零效果场景保持自动。已提交未决场景用"只读探测平台 + 人工 confirm"。

## 5. 分批优先级（待用户批准后实施）

| 批次 | 内容 | 理由 | 涉及 |
| --- | --- | --- | --- |
| **P1-a** | 天猫推广 P 直连受控入口，提供三个动作：①只读探测阿里妈妈报表列表（按 `ext.fileName` 和日期核对 taskId 是否存在）；②`report_submitting` 改回 `planned`（证明报表从未建成）或绑定为 `report_submitted`（找到唯一 taskId）；③`downloading` 但平台任务已过期时，作废并保留原清单 | 唯一只能手改 JSON 的线；近 14 天卡死次数最多；丽力当前就有风险 | `tools/tmall-direct-promotion-export.ts` 加新 admin CLI；仅 Worker helper，无迁移 |
| **P1-b** | 把客服、吉客云闭合所需的 n8n 证据在失败时封存到计划目录；闭合时优先读封存件。参照吉客云操作员闭合已有的 `pruned-evidence` 兜底 | 超过约 14 天就无法闭合；客服完全没有兜底 | `lib/jackyun/n8n-preflight-evidence.ts`、客服 failure/operator closure |
| P2 | 抽出共享闭合内核（create-only 证据目录、link 后 unlink 的不覆盖移动、摘要绑定的 dry-run/confirm、helper `/health` 与端口互斥），先迁移京东物流和直连 M 两条已合规的线做验证，再接入 P1-a | 降低后续每条线新增入口的成本 | 新 `lib/closure/`，各线适配器 |
| P3 | 补齐旧协议小缺口：逐页 M 加 `--dry-run`；商品管家作废补 CLI；京东市场榜单 running 计划的作废入口 | 当前都不在新工作流路径上，或从未卡过，影响小 | 对应工具 |
| P3 | 重试预留归档：原失败 execution 已被 n8n 清理且已终局的预留，移入按月归档目录，防止触到 4096 上限（当前 320 个，11-14 至 11-17 空转期间日增 17–62 个） | 不影响闭合，属于容量隐患 | `lib/jackyun/retry-dispatch-reservation.ts` 或运维脚本 |

不建议做的：

- 把京东物流、客服提交前、吉客云零效果这几类**自动**闭合改成手动。会退化。
- 做一个"任意清单一键作废"的通用按钮。会拆掉各线已有的阶段白名单，有重复建任务和丢数据的风险。
- 再写按执行号的一次性闭合工具（如 `close-jd-logistics-login-11037.ts`）。证据过期就会失效。

## 6. 误闭合的风险对照（实现时的硬约束）

| 场景 | 误闭合后果 | 约束 |
| --- | --- | --- |
| 已提交未决（推广 `report_submitting`、客服 `submitting` 之后、M 的 `export_submitting`） | 重复建报表或重复导出，平台侧会出现重复任务 | 必须先只读探测平台；探测不了（掉登录、403）就拒绝 |
| 已下载或导入中 | 丢掉已正确下载的内容，或导入错店的数据 | 只允许窄例外：要有精确错误文案，并现场复验文件 |
| 零效果提交前 | 风险低，Django 侧内容幂等 | 仍须证明下载目录为空、无导出或导入字段 |
| 任意闭合 | 静默跳过日期 | 闭合后由新的完整 n8n execution 按覆盖缺口重新规划；不允许"标记完成" |

## 7. 本次未核实

- 丽力任务 22117697 在阿里妈妈是否仍存在。明天 11:10 的定时会给出答案。
- 56 次「dispatch result unknown」只抽查了 11122（京东推广 413），没有逐条核对。
- 客服 `readCustomerServiceOperatorEvidence` 在 n8n 记录被清理后的真实报错，没有用隔离环境复现；结论来自源码（`lib/jackyun/n8n-preflight-evidence.ts:18-20` 查不到行就抛 `CUSTOMER_SERVICE_CLOSURE_EVIDENCE_INVALID`）。
- 同组会话 `retry-fingerprint-stop` 正在处理重试同指纹止损，本方案不重复覆盖。

## 8. 第一批实现（P1-a + P1-b，2026-11-17）

状态：已开发并在分支提交，**未合并、未准备制品、未上线**。代码由 Sonnet 子代理实现，Opus 独立反审。

### P1-a 天猫推广 P 直连受控入口

- 新增 `tools/tmall-direct-promotion-admin.ts`（CLI）、`tools/tmall-direct-promotion-admin-core.ts`（逻辑）、`tests/tmall-direct-promotion-admin.test.ts`，共 23 个用例。
- `tools/tmall-direct-promotion-export.ts` 只给既有符号加了 `export`，runner 行为不变。运维工具不进 helper 打包。
- 用法：

```bash
node --import tsx tools/tmall-direct-promotion-admin.ts --action inspect --store-key tmall-lili
```

```bash
node --import tsx tools/tmall-direct-promotion-admin.ts --action probe --store-key tmall-lili
```

```bash
node --import tsx tools/tmall-direct-promotion-admin.ts --action abandon-expired --store-key tmall-lili --dry-run
```

```bash
node --import tsx tools/tmall-direct-promotion-admin.ts --action abandon-expired --store-key tmall-lili --confirm --expect-sha256 <dry-run 的 sha256> --reason "<原因>"
```

| 动作 | 前置 | 平台探测结果 → 处理 |
| --- | --- | --- |
| `inspect` | 无 | 纯本地只读：清单、本地 zip、可用动作 |
| `probe` | helper 对该店空闲 | 只读：复用该店 Chromium、核验身份、分页扫描最多 25 页 × 20 条 |
| `resolve-submitting` | `failed/report_submitting`、无 taskId、无文件 | absent → `planned`；unique 且未失败 → 绑定 taskId 并改为 `report_submitted`；unique 且失败 → `planned`；ambiguous、incomplete、超过 30 天的 absent → 拒绝 |
| `abandon-expired` | `failed/report_submitted\|downloading`、有 taskId、无文件 | absent（含超 30 天窗口截断）或任务失败 → 不覆盖地归档到 `operator-abandons/<runId>-<sha16>/`；任务仍有效 → 拒绝 |

- 实测：对丽力线上清单做只读 `inspect`。结果是 `failed/downloading`，taskId 22117697，本地 zip 已存在（sha `32d137d8…`），可用动作 `probe` 与 `abandon-expired`。
- `dry-run` 同样会连接该店 Chromium 做只读探测。若该店 Chromium 未运行，`ensureTmallStoreAuthenticatedSession` 会启动它，必要时走 DPAPI 登录。探测完成后只断开 CDP，不关闭浏览器。

### P1-b 客服 n8n 证据封存

- `lib/jackyun/n8n-preflight-evidence.ts` 新增 `sealCustomerServiceExecutionEvidence`。两个读取函数加了可选参数 `sealedDirectory`：活库行还在时行为不变，并与封存件比对；行被清理或已 `deletedAt` 时改读封存件，返回值逐字段相同，已有回执的比对仍成立。替代 execution 检查与运行中检查始终查活库。
- 封存时机有两处：`planCustomerServiceRun` 遇到未完成旧计划时，以及操作员闭合执行时。都是尽力而为，失败吞掉，不改变原流程。
- `tools/n8n-metadata-read-boundary.mjs` 的审阅摘要更新为 `da3c4ce8…48c4`，按 LF 字节计算，与 git 存储一致。
- 新增 `tests/jd-customer-service-n8n-evidence-seal.test.ts`，共 9 个用例，其中一个是行被清理后 `closeCustomerServicePreSubmitFailure` 端到端仍能闭合。

### 检查结果

| 检查 | 结果 |
| --- | --- |
| 13 个相关测试文件，共 131 个用例 | 129 通过，2 失败。2 个失败在干净 main（e3ecd40b）上同样失败，属既有：客服定时期望 `0 9 * * *`、亿用时区 `undefined` |
| `node tools/check-django-production-boundary.mjs` | exit 0 |
| `tools/build-worker-helper.mjs` 实跑打包 | exit 0；封存函数已在包内，运维工具不在包内 |
| `tsc --noEmit`，过滤改动文件 | 只有 `tools/tmall-direct-promotion-export.ts:268` 原有的 `signal possibly undefined` 两处，该行未改动 |

### 交付范围与遗留

- 发布范围：P1-b 改了 helper 闭包内的文件，需要 **Worker 发布**，无 Django 改动、无迁移。P1-a 是运维 CLI，不进运行时，但与 P1-b 同批合并。
- 未覆盖：真实探测 `probePromotionPlatform` 没有自动化测试，按约束不能起浏览器，首次使用要人工观察；`planCustomerServiceRun` 里的封存触发与 `consumeCustomerServiceOperatorClosure` 的封存端到端，只做了代码审查。
- 既有问题，未修：runner 的 `apiFindTask` 只查任务列表第一页 20 条。卡住期间该店一般不会新建任务，所以很少触发；但 `resolve-submitting` 绑定的 taskId 如果排在 20 条之后，runner 续跑会超时。
