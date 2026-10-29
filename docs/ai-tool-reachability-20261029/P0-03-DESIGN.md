# P0-03 设计：来源、阶段、产物与用户修正的绑定

日期：2026-10-29。基线分支 `codex/ai-structured-output-20261029`（源自 `f205e96f`）。

P0-03 的目标是让一次 Pi 任务的结论可追溯：读了哪些来源、经过哪些阶段、产出哪些文件、用户做了哪些明确更正。这是 P1a 候选提炼的证据基础——没有它，Skill 候选只能引用模型自述。

**不依赖 U1。** 未改动任何业务代码。

## 1. 先结论：大部分已存在，真缺的只有用户修正

按方案「原账本能承载的字段不另迁移」先盘点现状，避免重建已有结构。

| 要素 | 现状 | 结论 |
| --- | --- | --- |
| 来源 | [PiExportPage.provenance_json](../../backend/ai_assistant/pi_models.py) 逐页存 source、dataCutoffDate、queriedAt、freshness、domainRevision、fields、units、rows；[pi_exports.py](../../backend/ai_assistant/pi_exports.py) 第 222 至 232 行聚合成 manifest，含 `domainRevisions` 去重、`snapshotComplete: false` 与四类 warning（revision 未知/变化、cutoff 未知、单位不全） | **已就绪**，不新建结构 |
| 阶段 | [PiEvent](../../backend/ai_assistant/pi_models.py) 有 operation、generation、`(session, event_seq)` 唯一、event_type、data_json；实际事件含 `tool_start`/`tool_end`/`tool_execution_start`/`tool_execution_end`/`message_update`/`message_end`/`file_ready` | **已就绪**，不新增事件类型 |
| 产物 | [PiFile](../../backend/ai_assistant/pi_models.py) 有 operation、generation、sha256、manifest_json、direction（input/output/export）、`(session, client_request_id)` 唯一 | **已就绪** |
| 任务身份与版本 | [PiOperation](../../backend/ai_assistant/pi_models.py) 有 epoch、generation、seq、model_id、model_version、skills_json、capability_hash、scope_json | **已就绪**，报告版本直接绑它 |
| 用户修正 | 全仓 `grep -i feedback\|correction` 在 `backend/ai_assistant/*.py` 零命中 | **缺失，本节唯一新增结构** |

因此 P0-03 的工程量集中在两处：新增用户修正结构，以及把上述四者绑成一个可被候选提炼引用的**报告版本**。

## 2. 用户修正：拟定结构

### 2.1 为什么不能复用记忆或知识

记忆是 owner 的稳定偏好与背景，知识是经确认的口径解释——两者都不记录「针对某次报告的某处更正」。方案第 6 节也把「执行记录/用户修正」与「知识」「个人记忆」列为不同对象。混用会让一次性的更正被当作永久规则，正是方案反复警告的事。

### 2.2 字段

拟新增 `AiTaskFeedback`（表名 `ai_task_feedback`），一条记录一处明确更正：

| 字段 | 约束与含义 |
| --- | --- |
| `id` | `uid("ai-feedback")` |
| `operation` | FK 到 `PiOperation`，`PROTECT`；更正必须绑定具体任务 |
| `generation` | 与 operation 当时的 generation 一致；scope 变更后旧更正不跨代沿用 |
| `owner_email` | 提出者，按 owner 隔离 |
| `target_kind` | `metric_definition` / `scope` / `section` / `threshold` / `other`，受控枚举 |
| `target_ref` | 被更正对象的定位（章节键、指标名、字段路径），不接受自由长文本 |
| `old_value_json` / `new_value_json` | 原值与新值，各自有界；原值可为空（表示此前未声明） |
| `applies_to` | `this_report` / `this_shop` / `all_shops`，默认 `this_report`——**适用范围由用户显式选择，不由系统推断** |
| `confirmed_by` | 确认者，服务端从 principal 写入 |
| `confirmed_at` | 确认时间 |
| `status` | `confirmed` / `superseded` / `withdrawn`；更正本身也可被后续更正取代 |
| `source` | `user` / `model_suggested`；模型自行提出的"更正"**必须标为后者**，不得与用户确认混同 |
| `version` | CAS 用 |

唯一约束：`(operation, target_kind, target_ref, status)` 在 `status = confirmed` 时唯一——同一对象同时只有一条生效更正。

### 2.3 必须守住的语义

- **模型自述不是用户修正**：`source = model_suggested` 的记录不能被候选提炼当作已确认依据。方案第 5.2 节明确要求「模型自行『修正』的文字必须仍标候选」。
- **适用范围不推断**：`applies_to` 默认 `this_report`。一次「ROI 低于某值就停投」的结论不能自动变成所有店铺的永久规则（方案第 15 节首条风险）。
- **更正不等于验证**：报告生成成功或用户更正了口径，都不证明报告中尚未执行的推广/补货建议有效。候选仍带「未验证建议」标签，不因有更正而消除。

## 3. 报告版本：绑定而非新建

不新增报告表。一次任务的"报告版本"由现有标识组合而成：

```json
{"operationId": "<PiOperation.id>", "generation": 3, "modelVersion": 7,
 "capabilityHash": "<已有字段>", "skills": ["..."],
 "sourceManifestDigests": ["<PiExport.manifest_json 的摘要>"],
 "fileShas": ["<PiFile.sha256>"], "confirmedFeedbackIds": ["<AiTaskFeedback.id>"]}
```

这组标识**全部来自既有字段**，服务端生成、不接受客户端提交。候选提炼（P1a）引用它即可回溯到精确的来源页、阶段事件与产物字节。

**已于 2026-10-29 实现**（[pi_sources.py](../../backend/ai_assistant/pi_sources.py)）：`GET /api/ai/pi/operations/{id}/evidence` 返回上述绑定加四组引用——来源（按 export 聚合 manifest、`domainRevisions`、warning、`snapshotComplete`）、阶段（按 `event_seq` 排序，仅 `eventSeq`/`type`/`createdAt` 三字段）、产物（文件名、SHA、direction、大小）、修正（含 superseded 与 withdrawn，但 `confirmedFeedbackIds` 只收生效那条）。

另有 `GET .../stages?after=N` 供跟随运行中任务，以及 feedback 的 `GET`/`POST .../feedback` 与 `POST .../feedback/{id}/withdraw`（撤回的目标 id 在路径而非正文，重放旧正文不会误撤别的修正）。

两处实现细节值得记下：阶段清单刻意排除 `message_update` 等携带正文的事件类型，证据视图只证明顺序不复制内容；`coverage.sourcesComplete` 在来源集为空时为 false——空集不能读作「全部覆盖」。

## 4. 展示要求

界面需明确区分三类状态，不得混为「完成」：

| 状态 | 含义 |
| --- | --- |
| `succeeded` | 原操作终态成功 |
| `unknown` | 已派发但无可信结果，**不以重跑消除** |
| 覆盖不完整 | manifest 的 warning 非空，或 `snapshotComplete: false` |

来源卡须显示 `dataCutoffDate`、`domainRevision`、行数与 warning。跨页 revision 变化（`source_revision_changed`）必须可见——它意味着该次导出横跨了数据版本。

不编造百分比进度：阶段展示来自真实 `PiEvent`，没有事件就显示没有，不插值。

## 5. 拟定改动点

| 位置 | 改动 |
| --- | --- |
| 拟新增 `backend/ai_assistant/task_feedback.py` | 更正的增删改查、CAS、状态迁移 |
| 拟新增 `backend/ai_assistant/feedback_models.py` 与 migration | `AiTaskFeedback` 结构、唯一约束、角色权限、readiness 与备份清单 |
| 拟新增 `backend/ai_assistant/pi_sources.py` | 聚合 export manifest、event 序列与 file 清单为 evidence 视图 |
| [pi_views.py](../../backend/ai_assistant/pi_views.py) | 新增 evidence 只读路由与 feedback 读写路由 |
| 拟新增 `app/ai-source-citations.tsx` | 来源卡、阶段清单、产物清单与更正入口 |

迁移编号以实施时最新 main 为准（当前已至 `0087`，不预占）。结构迁移只建表与约束，不自动提炼历史报告（方案第 17 节）。

## 6. 待确认项

| 编号 | 内容 | 影响 |
| --- | --- | --- |
| F1 | `target_ref` 的定位语法 | 需先有日报章节结构才能定义「章节键」。建议等 P1a 第一份日报产出后再冻结，先用自由字符串加长度上限，不在首版定死 |
| F2 | 更正是否需要审批 | 当前设计是 owner 自己确认即生效（`confirmed_by` 记录身份）。若需要第二人复核，结构要加 `reviewed_by`/`reviewed_at`，属产品决定 |
| F3 | `applies_to = all_shops` 的权限 | 跨店适用范围是否仅限无范围管理员？建议是，但需确认 |

三项都不阻塞 `AiTaskFeedback` 的基本结构落地，F1 建议刻意留到日报定稿后再收口。

## 7. 本文边界

设计与源码查证，未改动业务代码、未执行构建、未调用模型、未读取业务数据。所有拟新增名称为设计命名，开发前与当时最新 main 核对。新增表须按 [数据存储与迁移](../规范/数据存储与迁移.md) 与 [验证与发布](../规范/验证与发布.md) 同步角色、readiness 与备份恢复清单。
