# 自动导入与全工作流统一：可施工方案（2026-10-29）

本文是**施工方案**，不是实施记录。本轮未改任何代码、未运行采集或导入、未修改 n8n、未合并、未准备制品、未上线。

参考资料：`E:\微软文件\OneDrive\桌面\实现\` 下五份他人系统方案（京东 POP 接入、规则化配置重构、规则页展示重设计、模块化重构、自动导入与站内信排期），共 1,693 行。本文采用其设计思想与踩坑判据，不采用其针对别人系统的运行结论、目录结构与历史授权。**本系统不做站内信。**

事实基线：本仓 `main` @ `491c1408`，本文所有"现状"均带文件行号，可逐条复核。

页面形态另见 [三视图示意.html](三视图示意.html)（单文件内嵌，可离线用 `file:///` 打开；数据与交互均为合成，按钮不发请求、不触发采集、不执行导入、不发送消息）。

---

## 一、结论

能达到参考方案的施工效果，但**路线必须不同**。

参考方案最终走向"系统内置调度 + 全局串行 worker + 退役外部执行器"。本系统照搬会引入**第二个任务所有者**：现有 n8n 已有 11 条正式工作流在线、`TeruisiHourlyRetry2026` 统一错误工作流已发布、本机 helper `127.0.0.1:5791` 已持有协调锁、Cloudflare Worker 有自己的 `scheduled()`、AI 域有独立队列。两个所有者并存的症状是"两条执行链各自以为自己在管这件事"，而每条记录都是绿的。

本系统的正确路线是**三层分离**：

| 层 | 谁负责 | 本方案是否改动 |
| --- | --- | --- |
| 定时与执行 | n8n（唯一定时所有者）+ 本机 helper + 各平台执行器 | 不改所有权 |
| 统一管理与证据 | Django `backend/workflow/` 新增运行投影与受控动作 | **本方案主体** |
| 业务事实 | 八个 Django 业务域，保留唯一写入权与内容幂等 | 只读取证据，不新增写入源 |

一句话：**规则不是调度源，而是"期望声明 + 与已发布调度的一致性核验"**。用户在系统里改的是期望；期望与 n8n 实际发布不一致时页面显示漂移；只有第三期的"受控应用"才通过已登记的原生能力把期望写回 n8n。这样既达到"在系统内配置"的效果，又全程只有一个定时所有者。

---

## 二、本系统的事实基线

### 2.1 已经具备、可直接站上去的四块

**① "登记能力 → 核验已安装 → 下发 → 权威回查"的完整范式已存在。**
`backend/workflow/pi_business_n8n.py`（466 行）已经做到：`_template()` 读受控模板与 `config/tmall-store-accounts.json` 核验店铺 `enabled`/`platform` 唯一匹配；`_native()` 比对已安装 n8n 图的 `digest()` 与 `versionId == activeVersionId`，不一致即 `n8n_version_changed` 失败关闭；`_entry()` 要求唯一 webhook 节点与精确锚点；`_coverage()` 经签名 Worker 内部入口查业务域权威覆盖。文件头写明的判据直接可用："webhook 回执只是接受，完成另须精确原生阶段回执与权威覆盖"。

**规则化方案要的"规则→任务→下发→回查"不需要从零造，照这个范式扩展即可。**

**② 受控动作的幂等账本已存在。**
`WorkflowWriteRequestReceipt`（[models.py:59](../../backend/workflow/models.py#L59)）：`request_id` 主键、`body_sha256`/`query_sha256`、`method`/`path`、`actor_email`、`status`、`claim_token`、`response_status`、`response_payload`、`expires_at`。配合 `write_requests.py` 的 `claim_write_request()`/`complete_write_request()` 与 `pg_advisory_xact_lock` 身份序列化，已实现"重复点击或刷新仍指向同一请求"。

`jackyun_recovery_authority.py` 与 `jackyun_close_authority.py` 已是**可泛化的动作授权范式**：动作种类白名单（`retry`/`new`、`close`）、精确目标绑定（`logicalExecutionId ≤ sourceExecutionId ≤ failedExecutionId` 顺序校验 + 3~6 个 64 位摘要）、UUID 请求身份、回执有效期。

**③ 本机执行代理与安全重试已存在。**
`helper/tmall-workflow-helper.mjs serve --port 5791`，提供 `/coordination/claim`、`/plan`、`/fetch`、`/coordination/retry-context`、`/coordination/reserve-retry`、`/jackyun/export-first/*`。`tools/worker-local-service.ps1` 做端口占用与进程身份校验。`automation/n8n/data-import-hourly-safe-retry.workflow.json`（`TeruisiHourlyRetry2026`）实现 60 分钟后创建**完整新 execution**（不是节点重放），并有明确的"必须停止自动重试"清单（验证码/风控、凭据失效、店铺身份不符、任务歧义、已提交但结果未知的 `export_submitting`/`task_click_invoked` 等）。

**④ 导入幂等、范围锁与内容指纹已是生产级，且在 Django 八域各自独立。**
`SalesImportScopeHead`/`NetshopImportScopeHead`/`InventoryImportScopeHead`/`ProductImportScopeHead`/`FinanceImportScopeHead`/`MarketImportScopeHead`/`CustomerServiceImportScopeHead`/`ErpReferenceImportScopeHead` 各配 `*ImportAttempt`。内容指纹口径为 `import-content-v3`、锁域为 `import-lock-scope-v1`（见 [backend/netshop/import_service.py:443](../../backend/netshop/import_service.py#L443)）。

> ⚠️ **更正一处易错判断**：`lib/imports/content-fingerprint.ts` 是**已退役的 D1 旧路径**，按[系统架构](../规范/系统架构.md)只作隔离迁移、退役审计或测试材料保留，**不是**当前幂等实现。新方案必须读 Django 域的 ScopeHead/Attempt，不得把旧 D1 文件当事实源。

### 2.2 真正的缺口（五条）

**① 没有持久的运行投影——这是唯一的核心缺口。**
`import_chain_status.read_today_status()`（[244 行](../../backend/workflow/import_chain_status.py#L168)）每次**现读** n8n SQLite 产出"今天快照"：`MAX_ROWS=2000`、2 秒读取预算、最多 64 条手动证据、单份 1 MiB / 总计 8 MiB 上限，超限即失败关闭。它做得很严谨，但只回答"今天完成没有"。

因此：下载/登录/导入**前**失败查不到；历史查不到；整条运行与业务批次无法关联；`app/import-run-records-view.tsx` 只能做**前端集合分页**（`app/import-run-records-view.tsx:26` 的 `rows.slice(...)`），页面自己写明"未返回工作流分步记录、发起人或执行编号"。

**② 规则是生成的静态目录，不可在系统内编辑，且同一事实有三份说法。**
`lib/imports/chain-catalog.generated.json` 由 `tools/build-import-chain-catalog.mjs` 生成：8 条链、17 份工作流配置、13 个主体。

已核实的一处真实漂移：天猫主数据节奏。
- `config/tmall-store-accounts.json`：亿玖/丽力/亿用 `intervalDays: 1`，拓丰/炊之王/马思图 `intervalDays: 3`
- 运行时 `lib/netshop/tmall-direct-daily-policy.ts` 的 `applyTmallDirectDailyPolicy()` 把六家核准店**统一覆盖为 1**（config 里的 3 只作门禁校验输入）
- `tools/build-import-chain-catalog.mjs:52` 对所有天猫店**硬写** `{ masterIntervalDays: 1 }`——结果巧合正确，但没有绑定有效策略，改策略不会跟着变
- `app/n8n-workflow-view.tsx:152` 文案仍写"M 按每店持久的三日节奏错峰更新"——**已过期**

一个事实、三处来源、一处过期文案：只有读代码才知道哪个生效。这正是"规则页展示重设计"要解决的问题，在本系统已经发生。

**③ 矩阵的稀疏度比参考方案描述的更严重。**
参考方案以"70% 格子永远是 —"为换掉矩阵的依据。本系统实测（按生成目录计算）：

```
8 链 × 13 主体 = 104 格
  有规则:        20 格 (19%)
  同平台未配置:  20 格
  跨平台恒为 —:  64 格 (62%)
  空格合计:      84 格 (81%)
```

`app/import-chain-rules-view.tsx` 的矩阵（109 行）已经需要横向滚动容器。每接入一个店多一列，每加一条链只多一格。

**④ 受控动作只有吉客云一家有。**
`app/jackyun-recovery-controls.tsx`（49 行）、`app/jackyun-close-controls.tsx`（75 行）配 `app/api/imports/recovery/{run,close,finish}/route.ts`。其余平台在页面上没有任何合法动作入口，只能开 n8n。

**⑤ AI 工具口径不全。**
`lib/ai/tool-registry.ts:1453` 的 `get_automation_run_status` 枚举只有 6 个 workflowKey，缺 `jd_customer_service`、`jd_logistics`、`tmall_warehouse`——目录里有、AI 问不到。

### 2.3 必须保持不变的边界

- **n8n 是唯一定时所有者**。无 Django 调度器（无 celery/beat，已核）。Worker 的 `scheduled()` 只允许唤醒 Django 持有的市场队列（[前端与性能](../规范/前端与性能.md)），不得扩为通用调度。
- **资源协调**：helper 所有者 + 浏览器共享根锁 + 各域写锁。京东四店共用一条工作流、共享 Chromium，**不得为提速并发启动**。
- **业务写入权**：控制面不得成为第二写入源。只读标识、状态、脱敏摘要，不复制销售明细、客服原文、Cookie、账号、浏览器目录。

---

## 三、取舍：参考方案的每条设计在本系统如何落位

| 参考方案的设计 | 本系统采用方式 | 为什么改 |
| --- | --- | --- |
| 规则表是调度源，内置 tick 每分钟建任务 | **规则表是期望声明 + 一致性核验**；定时仍在 n8n | 照搬就有两个定时所有者；n8n 11 条已在线，不能并跑 |
| `ChainConfig` 原地演进 / 新表 `ChainRule`（Q2 拍板选新表） | **新建 Django 模型**，但不迁移旧表——本系统的"规则"今天是生成的 JSON，没有旧表要冻结 | 本系统起点不同：是"从无表到有表"，不是"换表" |
| 指纹 `(rule, slot)` | **`(ruleRevision, planDate, moduleKey, subjectKey)`** | 本系统一条 n8n 工作流覆盖多店多模块（京东四店共用一条 execution），比 `(rule, slot)` 更细一维 |
| 一条规则一个店，后端原子建 N 条 | 采用。但"店"= `config/*-store-accounts.json` 的 `storeKey` | 本系统店铺注册表已存在且已被 `pi_business_n8n.py` 用作门禁 |
| 同店同模块只许一条规则（Q4） | 采用，判据照搬 | 重叠会让后一条"什么都不做却记 done" |
| 关规则不作废已排队任务（Q8） | 采用，并照搬"抽屉必须把那条排队任务照实显示为 ○排队" | 否则"我关了它它还是跑了"零报错 |
| 不限同格规则数（Q10） | **不采用，设上限**；但不照搬数字 6 | 本系统共享 Chromium，频次代价比参考系统更硬；上限值由第一期实测定 |
| 体检步复用（Q14，20 分钟内跳过） | 列为**可选**，先量一周 | 本系统 helper 体检开销尚未测量，不凭参考数字定 |
| 三视图（日程/按店/模块覆盖）取代矩阵 | 采用，默认日程 | 本系统 81% 空格，依据比参考方案更强 |
| 只改前端就能落地日程视图 | **不采用这个结论** | 参考系统的 `tasks` 接口已带 `created_at/started_at/finished_at`；本系统**没有**持久运行记录，必须先补后端 |
| 模块化：链路退役、平台×模块两层 | 采用**概念**，不采用改名清单 | 本系统"链"= n8n 工作流，是真实执行单位不能退役；模块维加在链之下 |
| 25 个模块注册表 | 由本系统目录生成，**不把 25 这个数字当验收要求** | 参考文件自身 "20+2+1" 与总数 25 及表内条目不一致 |
| 五道闸（尤其闸①：backend 按导入批次独立核对） | **全部采用**，闸①最要紧 | 判据不由被改的那一侧自述——本系统现在正是读脚本自述 |
| "零文件一律失败" | **按闸④精确采用**：下发 N 个模块、实得 0 文件 → failed | 但"无缺口/未到期/内容重复"是正确结果，必须带证据返回，不能一律判失败 |
| 新旧生产各跑一次做迁移对拿 | **不采用** | 会造成重复平台导出与同范围写入 |
| 站内信（Notice/NoticeReceipt/InboxSubscription、未读数、铃铛、订阅中心） | **全部不做**（见第七节） | 用户明确不做 |

**参考文件内部自相矛盾、不能照抄的四处**（施工时按本系统自己的决定）：
1. 规则化 §13.1 的 16 条拍板**推翻了正文**（新表、同模块只一条、关规则不作废 pending、不限规则数、jd_vc+tmall_ad 一期做完、体检复用一期做、立即上、全改名）。它们是**另一个用户**对**另一个系统**的决定。
2. 模块化 §6.4 拍板 S2"一规则一任务"，但后文 §3.3 的队列唯一键、`runner_key` 字段与跨 runner 示例仍是 S1 残留。
3. 模块化模块数"20+2+1"与声称的 25 及表内条目不一致。
4. 排期文首自己声明"有一整类判断作废"（外部调度器已退役）；POP 方案 §七 专门列出"正文里今天不成立的那几句"。

---

## 四、架构：统一记录，不另造事实源

```
React 页面 / 薄 Worker
  真实 principal、范围校验、请求解析、展示、受控动作入口
        ↓
Django 自动化管理服务（扩展 backend/workflow/）
  模块目录 · 规则修订 · 逻辑运行 · 执行尝试 · 模块结果 · 动作请求 · 异常视图 · 审计
        ↓
原执行所有者（所有权不变）
  n8n 定时与完整 execution · helper 5791 登录/下载/恢复 · AI 与市场队列
        ↓
八个 Django 业务域
  保留唯一写入权、ScopeHead 范围锁、import-content-v3 内容指纹、覆盖回查
        ↑
脱敏结果回传与有界对账
  原任务 · 文件签收 · 模块结果 · 精确批次 · 覆盖 · 资源收尾
```

### 4.1 数据模型（字段级）

新增 Django app 建议为 `backend/automation/`（与现有 `backend/workflow/` 的任务/新品/运营事项语义分开，避免把自动化堆进已有 20 个模型的 app），或作为 `backend/workflow/` 的独立模块文件组 + 独立迁移序列。**各域独立 app、迁移、写权限、revision、切换证据**是 [系统架构](../规范/系统架构.md)的硬要求。

**① `AutomationModule`（模块定义，代码侧注册表，不是用户可编辑表）**

| 字段 | 说明 |
| --- | --- |
| `module_key` | 稳定键，全局唯一 |
| `label` | 中文名 |
| `platform` | `ERP`/`京东`/`天猫` |
| `chain_key` | 所属 n8n 工作流链（本系统的"链"是真实执行单位） |
| `domain` | 业务域（sales/netshop/inventory/…），决定查哪个 ScopeHead |
| `dataset` | 数据集标识，与业务域 `dataset` 口径一致 |
| `date_policy` | 已注册政策枚举：`rolling_45d`/`month_to_yesterday`/`recent_7d_gap`/`snapshot_day`/`rolling_30d`/`fixed_yesterday` |
| `depends_on` | 依赖模块（吉客云五表有顺序、天猫 A→B→C→P→N→M 有顺序） |
| `imports_data` | 是否产生导入批次（保活类为 False） |
| `evidence_requirement` | 完成所需证据：`batch`/`coverage`/`pairing`/`release` |
| `allowed_actions` | 该模块允许的恢复动作白名单 |
| `schedulable` | 是否可进普通规则（独立调度的不出现在表单） |
| `contract_version` | 契约版本 |

> 数据库中的可编辑值**不得携带任意脚本、URL 或文件路径**。模块定义随代码走，不接受数据库注入的执行目标。

**② `AutomationRule` + `AutomationRuleRevision`（规则与修订）**

| 字段 | 说明 |
| --- | --- |
| `rule_id` | 主键 |
| `revision` | 修订号，单调递增 |
| `subject_kind` / `subject_key` | `store`/`department`/`owner`/`market_category`；`subject_key` 取自 `config/*-store-accounts.json` 的 `storeKey` |
| `chain_key` / `modules` | 链与模块子集 |
| `expected_schedule` / `timezone` | **期望**调度（cron），固定 `Asia/Shanghai` |
| `date_policy` | 从模块允许的政策里选 |
| `resource_group` | 资源组（共享 Chromium 的store 同组） |
| `enabled` | `disabled`/`manual_only`/`scheduled` 三态，不用布尔 |
| `state` | `draft`/`pending_apply`/`applied`/`drifted` |
| `applied_workflow_id` / `applied_version_id` / `applied_at` | 与 n8n 已发布版本的绑定 |
| `updated_by` / `audit` | 审计 |

**关键设计：`expected_schedule` 与 n8n 已发布调度分离。**页面必须同时显示"期望值"与"实际生效值"，二者不等时 `state=drifted` 并显示漂移原因。**只有 `applied` 状态才能说"已生效"**。

**③ `AutomationLogicalRun`（逻辑运行）**

`logical_run_id`、`rule_id` + `revision`（规则快照）、`subject_key`、`plan_date`（固定业务日）、`business_range`（固定业务范围）、`trigger_source`（`schedule`/`manual`/`recovery`/`backfill`）、`plan_summary`（原始计划摘要）、`overall_status`。

**手动重跑新采集与恢复原运行必须明确区分**：前者新建 logical run，后者挂在原 logical run 下新增 attempt。

**④ `AutomationAttempt`（执行尝试）**

`attempt_id`、`logical_run_id`、`native_workflow_id` / `native_execution_id`、`parent_attempt_id`、`recovery_reason`、`stage`、`started_at` / `finished_at`、`error_class`、`native_evidence_ref`。

**一条逻辑运行可有多次尝试。**重试预算按 logical run 计——恢复产生新 execution **不重置次数**。

**⑤ `AutomationModuleResult`（模块结果）**

身份 = `logical_run_id` + `module_key` + `subject_key` + `dataset` + `date_range/snapshot`。
阶段状态分列：`download`/`validate`/`import`/`verify`/`release`。
证据：`domain` + `batch_id`、`raw_file_sha256`、`content_fingerprint`（引用 `import-content-v3`）、`coverage_revision`、`row_count`、`warning_count`。
**当前上传文件身份与历史复用批次身份分开两组字段**，不能混。
另带 `evidence_state`：`verified`/`stale`/`missing`/`contradictory` + `source` + `observed_at`。

**⑥ `AutomationActionRequest`（受控动作）**

**直接复用 `WorkflowWriteRequestReceipt`**，不新建一套。新增薄表只存动作语义：`request_id`（外键到 receipt）、`action_kind`、`target_digest`、`authorized_by`、`stage`、`delivery_result`。

### 4.2 状态必须分三条轴

这是本方案最重要的单条设计。现状把三件事混成一个"状态"。

| 轴 | 值域 |
| --- | --- |
| **执行** | `not_due` / `pending_claim` / `queued` / `running` / `failed` / `needs_human` / `result_unknown` / `finished` |
| **业务** | `not_started` / `partial` / `submitted_unverified` / `verified` / `no_new_needed` / `gap_remaining` |
| **投递** | `not_required` / `pending` / `sent` / `failed` / `unknown` |

判据示例：
- "数据已核验、通知未送达" → **不能退回重跑导入**，只恢复投递部分
- "n8n 已结束、覆盖未核验" → **不能标业务完成**
- 关闭旧任务显示"已闭合，部分数据保留" → **不是"已完成"**
- "无缺口 / 未到期 / 内容重复"是**正确结果**，必须返回原因 + 原批次 / 权威覆盖证据，不得伪报新增导入，也不得按"今天没有新批次"判失败

### 4.3 观察与写入边界

- n8n SQLite 继续**只读**、白名单、有界读取，不改其表。沿用 `read_today_status()` 已有的全部上限（32 工作流 / 2000 行 / 2 秒 / 64 条手动证据 / 1 MiB 单份 / 8 MiB 总计），**超限失败关闭，不以截断集合推断完成**。
- 新增**脱敏阶段事件接收或增量对账**：按 `source + eventId` 去重，`checkpoint` 记录观察进度，保留来源时间与 `checkedAt`。事件乱序或来源删档时**保持未知**，保留原有证据索引。
- 运行列表**服务端过滤分页**，返回 `total/returned/truncated`（[前端与性能](../规范/前端与性能.md)硬要求），替换现在的前端集合切片。
- 控制面丢失连接时显示"**无法核实**"，不写零、不猜成功。

---

## 五、闸：怎么挡住"一条绿色的、什么都没取到的运行记录"

参考方案的核心贡献在这里。先说实话：**不能归零**，真正归零的唯一办法是不动执行。闸的作用是把这种失败从"没人发现"变成"当天就报"。

### 闸① · 后端按导入批次独立核对（最要紧，必须一期做）

**判据不由脚本自述。** 下发时后端已知这一轮要跑哪几个模块（`AutomationModuleResult` 的预期行）；收尾时后端**自己查对应业务域的 ScopeHead/Attempt 与批次**——这几个模块各自有没有新批次、各导了多少行、覆盖是否零缺口。

脚本说 ok 而域里没有新批次且无权威"无需新增"证据 → **判 failed，不是 done**。

> 现状正是缺这一道：`read_today_status()` 判的是 n8n execution 的节点成功，`_complete_manual_run()` 再严也只是"n8n 这一侧说成功了"。业务结果与执行结果从未交叉核对。

### 闸② · 三轴状态不得互相顶替

测试必须覆盖：执行 `finished` + 业务 `gap_remaining` 时页面**不显示**"已完成"；业务 `verified` + 投递 `failed` 时**不提供**"重跑导入"动作；`result_unknown` 时**禁用**普通重试并显示可核查入口。

### 闸③ · 下发 N 个模块、实得 0 文件 → 硬判 failed

不许 partial、不许 done。但"无缺口/未到期"必须带权威证据走 `no_new_needed`，与"实得 0 文件"是**两条不同的路**，测试要有交叉反例：把 `no_new_needed` 错配成"0 文件成功" → 用例必须红。

### 闸④ · 跳过标记的键名与日期归属（参考方案两条 P1 的本系统对应物）

参考方案 P1 之一：脚本打的是 `"skip"`、agent 只认 `"skipped"`，导致第二条规则命中标记后产出**一条不带任何跳过痕迹的绿 done**。

本系统对应检查项（施工第一期必须逐一核实，本轮未验证）：
- 各链"跳过/未到期"回执的键名是否与消费侧一字相同。已知 `COMPLETENESS_KEYS`/`not_due` 语义散在 helper 与各 pipeline，须做一次**源码字面量对拿闸**：遍历链的每一步脚本，出现非约定键名即红。
- **完成标记的"天"必须等于计划槽的日，不是导入时刻的日。** 跨午夜补跑若按 `date.today()` 落日，会让次日规则全命中跳过、前一日数据静默不取。本系统天猫七日循环、京东月内补缺都会跨午夜，必须核实日期归属取的是 `plan_date` 还是执行时刻。
- **数据日期在建任务时定死并随任务下发**，不由子进程启动时刻推算"昨天"。

### 闸⑤ · 配置漂移的只读扫描

`manage.py automation_config_parity`（只读，可重复跑，非零退出）：
- 规则 `expected_schedule` vs n8n 已发布调度逐条对拿，差异即列
- 模块目录 vs 各 pipeline 的实际模块清单逐值对拿
- 展示用的节奏/政策**必须由有效策略函数生成**，不得复制常量——直接钉住 `masterIntervalDays` 这类硬编码（现 `tools/build-import-chain-catalog.mjs:52`）
- "同一主体同一模块被两条启用规则覆盖"扫描（admin/shell 绕过表单也量得出来）
- 每条启用规则的"今天应否运行"判据与实际 n8n 调度一致性

**未解释差异为 0 才算过。**

### 闸⑥ · 告警不被噪声稀释

系统产生的 `superseded` / `rule_deleted` / `drifted` 类终态**不计入"今日失败数"告警阈值**，并把排除数写进 note。否则取代与作废会打满阈值、真失败被淹没。

### 闸⑦ · 现有门禁照旧

`tests/import-monitor.test.ts` 的 9 条（客服每店绑定唯一工作流、库存用事业部/货主行不虚构销售店、进行中/失败/未知不得标绿、时长对缺失/反序时间返回未知、目录与白名单一致且不打包运营配置、矩阵渲染、不可能的完成被拒、定时完成与自动重试区分）**全部保留**，新页面必须同样通过。CI 五步（baseline lint / build+类型 / 精选单测 / backend-boundary / pi152-acl）不放宽。

> 门禁自身的教训（本机已记录）：抽数字要验证取值——正则抓到列号当 error 数会让门禁静默失效；`pwsh` run 块要显式 `exit`。新增门禁脚本须遵守。

---

## 六、恢复、重试、漏跑：分别设计

| 情形 | 系统动作 | 用户看到 |
| --- | --- | --- |
| 短暂网络/下载失败 | 执行器按白名单错误与既有总期限重试**已绑定对象**，不重新生成报表；沿用 `TeruisiHourlyRetry2026` 的 60 分钟完整 execution | "原任务仍在恢复"，剩余次数与下一时间来自有效政策 |
| 验证码、风控、登录失效、身份不符 | **停止**相关业务动作，保留清单，返回明确人工步骤。身份不符**不回退别店** | `needs_human` + 受影响范围；按通知专项发本人单聊 |
| 导出已提交 / 派发结果未知 | 查原任务回执；有证据后按专用协议**续接原尝试**，**不换 ID 重发** | `result_unknown`；普通重试**禁用**，显示原因与可核查入口 |
| 部分模块已入库 | 保持原批次，只恢复未完成部分并重新核验整链；无合法续接则等待处理 | `partial` + 明确保留数据，**不把所有模块清零** |
| 文件内容重复 | 业务域按"域 + 精确范围 + 完整规范化内容"判定；签收本次文件并关联原批次 | "重复跳过 / 复用批次"，新增 0；**不混淆原文件哈希与内容指纹** |
| 错过定时时点 | 独立检查应运行时间槽、活动尝试与覆盖；按允许政策生成**唯一**补跑意图，经原生完整入口领取 | "漏跑"或"已被后续完整运行满足"；**不能认为失败重试会补一个不存在的 execution** |
| 作废/闭合 | 只走已支持的管理员入口，固定旧任务、保留证据，核验旧派发与迟到写入的拒绝 | "已闭合 / 部分保留"；新任务是**另一项动作** |

**跨日恢复**必须保留原 `plan_date`、原文件与原批次身份，不得自动把昨天失败改成今天成功。采集时间、业务日期、执行日期**分三个字段存**。

**性能**：先消除重复查询与重复下载、提前查缺口、独立读取并行。只有资源真正独立的队列才增加并发——**不得为提速让共享 Chromium 四店同时启动**。

---

## 七、不做站内信，如何形成完整闭环

参考排期把站内信放在 M0 第 2-3 步（`Notice`/`NoticeReceipt`/`InboxSubscription` 三模型、唯一发送口 `inbox.send()`、未读数/列表/已读 API、六类事件接线、`inbox_purge` 清理命令、M1 铃铛组件）。它承载三个职责：**发现**（有事发生了）、**定位**（哪条运行出的事）、**回执**（我已处理）。

本系统用三样现成能力替代，一样不少：

| 需要的效果 | 本系统实现 | 不做什么 |
| --- | --- | --- |
| 知道今天是否完成 | 运行总览显示应执行 / 已核验 / 正常无需新增 / 未完成 / 无法核实，直接看到数据截至日期 | 不做未读数、红点 |
| 知道要自己做什么 | 运行详情显示错误分类、具体操作、已完成部分、允许动作；筛选器提供"待人工 / 持续阻塞 / 无法核实"及数量 | 不做收件箱、已读标记 |
| 完成后有反馈 | 整条工作流达到业务成功与收尾要求后，按 `workflow-dingtalk-notifications.md` 发**一条**完成摘要 | 不逐节点轰炸，不做订阅中心 |
| 不重复提醒 | 完成键 = 工作流 ID + 逻辑运行标识 + 业务范围 + completed；异常键 = 工作流 ID + 业务范围 + 同一故障事件 + 所需人工动作。换 execution 不换完成事实 | 不做消息 CRUD |
| 消息发不出也能处理 | 业务结果保留；页面记录未投递及原因，**只恢复投递部分，不重跑导入** | 不做群发 |

**"发现"这一职责由运行总览的筛选器承担，而不是收件箱**——异常直接附着在运行记录上，进入对应运行即可处理。这是不做站内信仍能闭环的关键：参考方案需要收件箱，是因为它的运行记录当时查不到历史；本方案第一期就把持久投影补上了，异常天然有归属。

**通知路由**（现行规则，施工时统一引用，不得据旧段改收件人）：
- "需要人工协助"只由名称精确等于"志高助手"的唯一企业机器人**发本人钉钉单聊，绝不发群**
- 完成通知与不要求用户行动的纯状态阻塞发唯一"测试群聊"
- 每次发送前经 `dws profile list` / `contact user get-self` / `contact user search` / `chat bot search` **动态唯一核验**身份与机器人；不唯一则停止外发并记未投递，不回退群或其他个人
- 消息只含脱敏摘要，不含 Cookie/Token/账号/本机路径/userId/原始业务数据
- [导入与自动化](../规范/导入与自动化.md)中的旧"全部发群"表述与此冲突，**以通知专项为准**

> 机器人发群用 `--groups` 不是 `--group`（本机已记录的踩坑）。

**本轮未发送任何消息。**

---

## 八、施工顺序：四期，每期独立可验、独立可停

每期结束都是一个**可交付、可停止**的状态。不要求四期连续做完。

### P0 · 固定基线、消除配置歧义（纯代码与文档，无结构迁移）

**做什么**
1. 建立工作流 / 模块 / 主体的完整登记表，三类来源**分列**：仓库模板、有效策略函数、线上观察。
2. `tools/build-import-chain-catalog.mjs` 改为**绑定有效策略**：天猫节奏走 `lib/netshop/tmall-direct-daily-policy.ts` 的 `applyTmallDirectDailyPolicy()`，删掉 `:52` 的硬编码 `masterIntervalDays: 1`。
3. 修 `app/n8n-workflow-view.tsx:152` 的"三日节奏错峰"过期文案，以及同类旧说明。
4. `get_automation_run_status` 枚举补 `jd_customer_service` / `jd_logistics` / `tmall_warehouse`（按[安全与AI工具](../规范/安全与AI工具.md)，注册表变更须同步测试名称唯一、schema 一致、handler 存在、角色与 scope、surface 与风险边界）。
5. 新增闸⑤ 的只读 parity 命令骨架（此期只做配置漂移部分）。
6. 形成**原链路能力与依赖矩阵**：每条链允许哪些恢复动作、模块依赖顺序、资源组归属。

**完成效果**：页面能区分"已登记 / 待采用 / 已启用 / 未知"，不再把模板频率当在线事实。客服四店、京东物流、天猫入仓的时点与范围差异进入明确处理清单。

**不做**：不改 n8n，不加结构迁移。按[验证与发布](../规范/验证与发布.md)分级，这一期属"展示或领域业务变化"，但含目录生成器改动，发布范围按完整差异判。

### P1 · 持久运行投影 + 三视图（本方案主体，最大一期）

**做什么**
1. 新增 Django 模型与迁移：`AutomationModule`（代码注册表 + 自检）、`AutomationLogicalRun`、`AutomationAttempt`、`AutomationModuleResult`。**此期规则表只读**（从目录生成，不可编辑）。
2. 投影适配器：从 n8n 只读元数据 + helper 回执 + 各域 ScopeHead/批次，按 `source + eventId` 去重写入投影；`checkpoint` 记观察进度。
3. 实现**闸①**（按导入批次独立核对）与**闸②**（三轴状态）。
4. 读接口：服务端过滤分页，返回 `total/returned/truncated`；`逻辑运行 → 原生尝试 → 模块结果 → 批次/覆盖`四级下钻。
5. 前端三视图，默认**日程**；现矩阵入口平滑转入"模块覆盖"。复用现有 `import-monitor.css`、`subnav`、表格、弹窗与主题，**不另起第二套样式**（[前端与性能](../规范/前端与性能.md)）。
6. 异常筛选器："待人工 / 持续阻塞 / 无法核实"及数量。

**适配顺序**：先吉客云（五表、有依赖顺序、有现成恢复动作）+ 一个天猫店（A→B→C→P→N→M 循环、跨午夜、有日期归属风险）**两种典型结构**，验证模型够用，再接其余导入家族。

**完成效果**：登录前失败也有记录；整链成功与数据结果可区分；部分成功、无需新增、结果未明各有准确展示。**此期不修改任何原生调度。**

**风险**：投影与真实不一致。对策——投影只增量观察、按来源去重；旧历史能证明到哪一层就展示到哪一层，无法关联的旧记录标"历史未关联"，**不伪造 logical run**。

### P2 · 统一受控动作与通知闭环

**做什么**
1. 现有吉客云动作（完整重试 / 新采集 / 从头采集 / 一键闭合）收口到统一运行详情，保持原授权与回执语义不变。
2. 其余平台按**各自能力**提供：完整运行、原任务恢复、漏跑补齐、显式闭合。**不支持的动作明确禁用并说明原因**，不把吉客云能力不加区分复制给所有平台。
3. 动作统一经 `WorkflowWriteRequestReceipt`：`requestId` + 固定目标摘要 + 权限 + 回执 + 操作审计。
4. 投递状态关联：现有钉钉渠道的发送结果进第三轴。
5. 实现**闸③**（0 文件硬判失败）与**闸⑥**（告警不被噪声稀释）。

**完成效果**：不必到日志里猜该怎么操作；重复点击或刷新仍指向同一请求；通知异常不触发业务重放。

### P3 · 规则编辑与模块编排（开放"在系统里配置"）

**做什么**
1. 规则草稿 / 修订 / 依赖校验 / 范围预览 / 冲突检测。
2. **受控应用**：把期望写回 n8n——仅通过已登记的原生能力（照 `pi_business_n8n.py` 范式：核验已安装图摘要与 `activeVersionId`，不接受未登记脚本），应用后**读回验证**并绑定 `applied_version_id`。
3. 按平台逐条切换规则来源；**在途运行保留原快照**。
4. 同主体同模块唯一规则约束 + 并发编辑锁（`select_for_update` 锁同格全部行，create 与 update 共用同一把锁）。
5. 实现**闸④**（键名与日期归属对拿）的完整版本。

**完成效果**：用户能在系统里调整允许的周期、主体与模块组合，并知道**何时生效**。n8n 唯一定时所有权不变。

**此期才需要动 n8n，且每条都要独立授权。** 顺序照 `n8on-hourly-safe-retry.md` 已验证的受控发布序列：只读备份当前版本/active/owner/settings/nodes/connections → 先发共享错误工作流 → 逐条更新原 ID（不新建同名副本，保留 owner 与 active 状态）→ 维护窗口重启并回读 `activeVersionId == versionId` → 用隔离的可逆失败验证一次，**不制造平台业务点击或生产导入** → 保存脱敏证据。

### P4 · 其余工作流汇总与性能收敛（可选）

AI 定时 / Agent·DAG / Pi 动作、市场标注、运营归档与周报、备份与守护：**只做只读登记与跳转**，各自成功标准归原域。失败分类与耗时统计；无变化状态的有界增量观察；旧展示与重复监控口径收敛。

**不通过通用"重试 / 运行全部"启动发布、迁移、恢复或终止服务。**

---

### 期间依赖与建议

- **P0 + P1 是最小有价值集合**。只改页面达不到参考方案的效果；没有运行证据底座就开放编辑，只会把配置混乱扩大。
- P2 依赖 P1 的投影；P3 依赖 P1 的证据 + P2 的动作账本。
- **工期不在本文估算。** 参考方案给出 11 个工作日，那是**另一个系统**的工作量，且其排期自己记录了"排期里没有、实际做了的五件"。本系统的工期应在 P0 核实真实采用版本、接口缺口与改动清单之后再估，不以文件篇幅推算天数。

### 预计涉及的代码区域

| 层 | 文件 |
| --- | --- |
| 前端 | `app/import-chain-rules-view.tsx`（转模块覆盖）、`app/import-run-records-view.tsx`（服务端分页）、`app/import-module-view.tsx`（壳与页签）、`app/n8n-workflow-view.tsx`（文案与跳转）、新增三视图组件、复用 `app/import-monitor.css` |
| 共享契约 | `lib/imports/chain-status.ts`、`lib/imports/run-presentation.ts`、`lib/imports/chain-catalog.generated.json` |
| 后端 | 新 app 或 `backend/workflow/` 新模块组 + 独立迁移；扩展 `import_chain_status.py`（保留全部上限）、`import_chain_views.py`；复用 `write_requests.py`、`pi_business_n8n.py` 范式 |
| 业务域 | 各域只新增**必要的只读证据 consumer**，不动写入路径 |
| 工具 | `tools/build-import-chain-catalog.mjs`（绑定有效策略）、新增 parity 命令 |
| AI | `lib/ai/tool-registry.ts`（补全枚举，按规范同步测试） |
| 采集侧 | 仅 P3/P4 涉及 `tools/*-n8n-pipeline.ts`、`lib/<平台>/`、`automation/n8n/` |

### 迁移与交付约定

- 新结构迁移与历史业务数据回填**分开**；计划不自动授权生产写入。
- 新规则按家族启用；任何时刻只有一个定时/执行所有者。
- 新控制能力故障可关闭新增入口，原执行器继续保留原约束；**已提交业务数据不做反向回退**。
- 开发按 [AGENTS.md](../../AGENTS.md) 第 2 条从最新 `main` 建 `codex/*` 分支与独立 worktree；按第 4 条，**合并到 `main`、准备制品、发布上线三步各自单独取得授权**。
- 含结构迁移须同步交付有限迁移 recipe、原生安装器与隔离验证证明。
- AI 只检查影响构建、部署、启动的必需代码；功能效果由用户上线后判断。

---

## 九、怎么判断达到了参考方案的效果

以下是**产品完成标准**，供施工与用户验收使用。本轮未执行任何功能测试。

1. 新增一个已支持平台的店铺，经注册与凭据配置接入后，目录、规则、视图、运行记录**自动出现**，无须复制整页代码。
2. 三视图看到**同一版本、同一运行**；筛选到单店不会扩大到其他店数据。
3. 一次任务从计划、下载、导入到回查与收尾**完整可追溯**；**下载前失败也能查到**。
4. 每个"完成"都能展开到精确批次/覆盖，**或**明确的"正常无动作"证据；只有 n8n success 时不冒称业务完成。
5. 部分成功后能看到已入库模块与剩余项；系统只提供合法恢复动作，旧失败历史不被改写。
6. 修改周期后显示"待应用"与"实际生效版本"；旧任务仍用原快照，重复或迟到请求不覆盖新状态。
7. 错过定时时点可被识别并按政策补齐；定时重试与人工触发相撞时**只有一个执行所有者**。
8. 人工协助、持续阻塞、完成通知各按既定粒度去重；**无站内信仍能完成"发现→处理→回查"**。
9. 三轴状态互不顶替（闸②的全部用例通过）。
10. `automation_config_parity` 未解释差异为 0。

### 用哪些数字评估价值

先采集**同一观察窗口**的基线，再比较：首次完整成功率、自动恢复后完成率、人工介入次数、数据覆盖及时率、等待/登录/下载/导入/回查各段耗时、配置漂移数量、重复提醒次数。

"正常无缺口"、"未到期"、"新导入"**分别计数**。不要把少下载的次数直接当稳定性提升，也不承诺未经测量的提速百分比。

---

## 十、风险与对策

| 风险 | 静默失败形态 | 对策 |
| --- | --- | --- |
| 两个任务所有者 | 两条链各自以为在管，记录都是绿的 | 规则只作期望声明；P3 前不写回 n8n；任何时刻一个家族只有一个定时所有者 |
| 投影与真实分叉 | 页面绿、实际没跑 | 闸①按业务批次独立核对；增量观察 + 来源去重；无法关联标"历史未关联" |
| 跨午夜日期归属错 | 取到 D 而非 D−1，槽 D 却判 done，D−1 永远没人补 | 数据日期建任务时定死并随任务下发；完成标记的"天"= `plan_date`；闸④ |
| 跳过键名不一致 | 一条不带任何跳过痕迹的绿 done | 源码字面量对拿闸，非约定键名即红（参考方案两条 P1 之一，其系统当时真的在发生） |
| 恢复判据采样误判 | "worker 没起来"写进记录，而它正在下一秒领任务 | 按**事件**判而非状态采样：一条待领任务只有在"它建出来之后没有任何任务被领走"时才算没人领（参考方案另一条 P1） |
| 告警被噪声稀释 | 真失败被系统终态淹没 | 闸⑥，排除数写进 note |
| 配置改了页面没变 | 展示复制常量，策略改了不跟 | 展示由有效策略函数生成；闸⑤ 钉住硬编码 |
| 动作重复派发 | 换编号再提交，两次真实点击 | 复用 `WorkflowWriteRequestReceipt`；未决派发只核查同一请求 |
| 共享资源并发 | 四店同时启动 Chromium | 资源组 + 既有 helper 所有者与浏览器根锁，不因"优化"放宽 |
| 为提速放宽校验 | 超时延长、校验跳过 | [导入与自动化](../规范/导入与自动化.md)的失败关闭清单不放宽 |

---

## 十一、施工前须核实的事实（本轮未核实）

这些用于建立施工基线，**不阻止本方案成立**，但 P0 必须查清：

1. 17 个登记工作流的**实际采用版本、启停、调度、资源组与未决运行**。仓库里 `active=false` 是安全导出默认值，**不构成现场停用证据**；候选模板也可能尚未采用。
   **2026-10-30 补充实证**：仓库里的 **cron 表达式同样不构成线上调度证据**。两条京准通推广链的 n8n 定义与生成目录都写 `40 10` / `50 10`，而 `docs/evidence/jd-promotion-migration-guide-production-20260912.json` 的 `readback.promotionWorkflows` 记录线上是 **13:00 与 13:10**。这类漂移重跑生成器修不了——定义本身就落后于线上，只能查线上才知道哪个对。
2. 客服四店、京东物流、天猫入仓的**当前采用范围**与调度时点冲突的最终生效值。客服四店有历史采用记录、物流有真实运行记录、天猫入仓现有报告只证明停用草稿安装——**三者不混称从未上线**。
3. 吉客云近期恢复、一键闭合（`docs/jackyun-one-click-close-20261029/`）、销售预检（`docs/jackyun-sales-preflight-20261029/`）等增量的**部署状态**；不覆盖其他会话正在推进的任务。
4. 各链"跳过/未到期/完成"回执的**键名**与消费侧是否一字相同（闸④ 的输入）。
5. 各链完成标记的**日期归属**取 `plan_date` 还是执行时刻。
6. helper 体检的真实开销（决定"体检复用"值不值得多一条判据）。
7. AI / 运维 / 外部监控的实际任务总目录与可用只读接口。**登记到总览与开放控制是两件事。**

---

## 十二、来源与边界

**外部资料**（已完整阅读，1,693 行 / 223,277 字节）：

| 文件 | SHA-256 |
| --- | --- |
| 方案-京东POP接入自动导入-2026-08-31.md | `889711c25cf6e02acdc8ed14fe06d31f5d041dc9fae906ca9c4875e557f943a2` |
| 方案-自动导入链路规则页展示重设计-2026-09-10.md | `c55e477803233161b56f7ee80eee51d7f1c6e7543b2052b0c752f9c0208d0128` |
| 方案-自动导入链路配置重构-规则化-2026-09-10.md | `21bcf840fdc316370454c71b3851536cf3518db7fcd3ccef239bff66ce9953e9` |
| 方案-自动导入模块化重构-2026-09-12.md | `73d83ced008988ac19b27efff4dacfe8ab84640c40665741c26651b32a547cba` |
| 实施排期-自动导入与站内信-2026-08-29.md | `c968f1b9a788d2dbde641002c641155fd68519203ec192158b9e5e57c95c57b5` |

目录：`E:\微软文件\OneDrive\桌面\实现`。保留其设计思想与踩坑判据，**不采纳其针对别人系统的运行结论、原路径或历史授权**。

**本系统源码证据**（基线 `491c1408`）：
- `app/shell/navigation-catalog.ts`：导航模块、自动化中心与数据导入页签
- `app/import-chain-rules-view.tsx`：当前矩阵、30 秒轮询、详情与闭合入口
- `app/import-run-records-view.tsx:26`：前端集合分页
- `app/n8n-workflow-view.tsx:152`：天猫主数据过期文案
- `app/jackyun-recovery-controls.tsx`、`app/jackyun-close-controls.tsx`：已有恢复能力
- `backend/workflow/import_chain_status.py:168`：有界 n8n 只读观察与全部上限
- `backend/workflow/pi_business_n8n.py`：登记原生能力、图摘要核验、权威覆盖门槛
- `backend/workflow/models.py:59`、`write_requests.py`：受控动作幂等账本
- `backend/workflow/jackyun_recovery_authority.py`、`jackyun_close_authority.py`：动作授权范式
- `backend/netshop/import_service.py:443`：`import-content-v3` 内容指纹与 `import-lock-scope-v1` 锁域
- 各域 `*ImportScopeHead` / `*ImportAttempt`：八域独立幂等与范围锁
- `lib/imports/chain-catalog.generated.json`、`tools/build-import-chain-catalog.mjs`：8 链 / 17 配置 / 13 主体与目录生成
- `config/tmall-store-accounts.json`、`lib/netshop/tmall-direct-daily-policy.ts`：节奏事实的两处来源
- `lib/ai/tool-registry.ts:1453`：`get_automation_run_status` 枚举
- `automation/n8n/data-import-hourly-safe-retry.workflow.json`：共享错误工作流
- `docs/规范/导入与自动化.md`、`docs/使用手册/数据导入/import-monitor.md`、`docs/自动化/通用/workflow-dingtalk-notifications.md`、`docs/自动化/通用/n8n-hourly-safe-retry.md`：业务契约、展示边界、通知与重试专项

**本轮边界**：只阅读与规划。未运行采集、导入、调度修改、业务验收、外部通知；未合并、未准备制品、未上线；未修改任何源码或配置。

---

## 十三、工期（2026-10-30 补，按本仓真实交付速度校准）

### 校准依据：不用参考方案的 11 人日

参考排期给的是"约 11 个工作日"，那是**另一个系统**的工作量，且其执行记录自己承认"排期里没有、实际做了的五件"。本节改用本仓 `git` 历史里**形态可比**的任务度量。

| 可比任务 | 规模 | 实际 |
| --- | --- | --- |
| 客服域整域迁移（模型+迁移+页面+退役门禁） | 比 P1 稍小 | **22 个提交、1 天** |
| 导入监控页首版（矩阵 + n8n 只读投影 + 后端白名单） | ≈ P1 的前半 | 2026-09-10 **1 天** |
| 同页的语义修正 | —— | 9-12、9-24、9-29 **分 4 次、跨 19 天** |
| 本仓提交节奏 | —— | 日均 25–70 个提交 |

**关键形状：首版很快，语义修正很慢。** 导入监控页首版一天就上了，但"手动完整补跑算不算今天完成""恢复后状态怎么说"这类判据，花了 19 天分 4 次才稳。

P1 的核心正是这类判据密集的工作（三轴状态、闸①的"无需新增 vs 0 文件"、跨午夜日期归属）。**所以工期的大头不是写代码，是判据收敛。**

### 分期估算

| 期 | 编码 | 判据收敛与真机观察 | 合计（日历日） |
| --- | --- | --- | --- |
| **P0** 基线与消除歧义 | 1–2 天 | 核实 17 个工作流的实际采用版本：**须等自然运行观察**，1 周 | **1–1.5 周** |
| **P1** 持久投影 + 三视图 | 3–5 天 | 两种典型结构适配 + 判据修正：**按历史是 2–3 周** | **3–4 周** |
| **P2** 受控动作与通知 | 2–3 天 | 每平台动作边界需真实故障样本验证 | **2–3 周** |
| **P3** 规则编辑与写回 n8n | 3–4 天 | n8n 受控发布每条独立授权 + 自然故障验证 | **3–4 周** |
| **P4** 其余工作流汇总（可选） | 2–3 天 | 只读登记，无判据风险 | **1 周** |

**P0+P1（最小有价值集合）：4–6 周**
**P0–P3（完整效果）：9–13 周**
**含 P4：10–14 周**

### 为什么是周而不是天

1. **逐步授权是设计要求**，不是摩擦。[AGENTS.md](../../AGENTS.md) 第 4 条要求合并 / 制品 / 发布三步各自单独取得授权，P3 还要每条 n8n 独立授权。
2. **判据只能被真实运行证伪。** "无缺口是正确结果"与"0 文件是失败"的边界，必须等自然发生过才知道分对了没有。造不出来——造失败就是制造平台业务点击。
3. **AI 不做功能验收**（第 4 条）。功能由你上线后判断，这段往返是工期的一部分。
4. **17 个工作流的实际采用版本要观察一周**：仓库 `active=false` 是安全导出默认值，不构成现场停用证据。

### 可以压缩与不能压缩的

**可压缩**：编码本身（历史证明一天能交一个域）；P4 可以不做；P2 只做吉客云收口加一个平台。

**不可压缩**：n8n 受控发布的授权节奏；真机自然故障的等待；判据收敛的往返。

### 另一处正在发生的漂移（本节核查时发现）

2026-10-28 有一次 `chore(n8n): 仓库定时副本对齐 n8n 实际配置（物流 08:50、客服 12:10-13:10）`，`automation/n8n/*.workflow.json` 已改为 `50 8` 与 `10 12`，但 **`lib/imports/chain-catalog.generated.json` 仍是 `0 8` 与 `0 9`**——生成器没有重跑，页面此刻显示的时点是错的。

这证明闸⑤（配置漂移只读扫描）不是假想需求，并给 P0 增加一条：**目录生成须进 CI 或发布前置检查**，不能依赖人工记得重跑。P0 修这一处的成本是分钟级。
