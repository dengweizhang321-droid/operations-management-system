# P1b: 让已批准的 Skill 候选能被真实加载

工作树：`D:/.codex/worktrees/p1b-candidate-publish-20261105`，分支 `codex/p1b-candidate-publish-20261105`，基于 `origin/main` `11532ef3`。未 commit、未 merge、未 push。

## 为什么走 report_library 注入通道，不进容器

PLAN 原定让候选进 Pi 容器执行，但实查确认三道硬约束使这条路不可行：
`backend/pi_runner/server.py:780` 的单卷断言、`server.py:187` 要求命令来源路径烤在镜像里的 `/opt/pi/skill-bundles/<skillVersion>/` 前缀、以及还需要的新协议握手与受控镜像采用（需用户单独授权）。因此改走 `report_library.guidance()`：这是一条在用通道，`chat.py`、`reports.py`、`workflows.py`、`business_*` 真实消费它，且候选 schema 的 `body` 上限 2000 与 `report_library` skills 条目的 `body` 上限完全一致（`output_schemas.py` 注释原文印证）。

## 改动文件

- `backend/ai_assistant/skill_candidates.py`（追加在文件末尾，未重排或改动既有函数）：新增 `_slug_from_candidate()`、`_round_robin_keywords()`、`publish()`，以及 `MAX_KEYWORDS`/`MAX_DOMAINS` 两个常量、`PiSession` 和 `current_principal`/`integer`/`prompt_settings`/`report_library`/`pi_service` 几个新导入。
- `backend/ai_assistant/pi_views.py`：在 `dispatch()` 里接入 4 条路由。
- `backend/ai_assistant/test_skill_candidates.py`：新增 21 个测试方法，含 `admin`/`scoped_admin` 两个新 fixture。

未新增 migration，未改 `output_schemas.py` 的 `SKILL_CANDIDATE_V1`（会改 `schemaDigest`，让已存候选全部 409），未改 `MAX_NOTE`/`request_schema()`（另一代理在改这段，范围已避开）。

## 路由（4 条，`pi_views.py` 内 `dispatch()`）

| 方法 | 路径 | 函数 | 位置 |
| --- | --- | --- | --- |
| POST | `pi/operations/<id>/skill-candidates` | `skill_candidates.save()`，201 | `name == "operations"` 分支链条内，紧跟 `feedback` 之后 |
| GET | `pi/skill-candidates` | `skill_candidates.listing()` | 独立顶层判断，`parts == ["pi", "skill-candidates"]` 精确等值，不与 `parts == ["pi","skills"]` 冲突 |
| POST | `pi/skill-candidates/<id>/review` | `skill_candidates.review()` | 独立顶层判断，`len(parts)==4` |
| POST | `pi/skill-candidates/<id>/publish` | `skill_candidates.publish()` | 同上 |

`save()` 路由里 `registry_tools` 的来源：先按 `PiOperation.objects.filter(id=parts[2])` 取行并核验 `session.owner_email` 与 principal 一致（404 否则），再调用 `pi_gateway.catalog(principal, operation)`，取返回的第一个元素（完整登记目录，不是 `readonly` 子集）里每个条目的 `name` 作为 `registry_tools` 集合。这个 `operation` 一定是路径里这条 run 自己的，不是 `None`——测试 `test_save_route_passes_this_operations_catalog_to_save` 直接断言 `catalog.call_args` 的实参（而不只是替身的返回值），能钉住"路由传错参数"这类之前被证实测不出来的盲点。

ownership 在路由层重复检查了一次（`save()` 内部通过 `request_schema()`→`pi_sources.evidence()`→`_owned()` 还会再查一次）：路由层这次查询只是为了在调用 `catalog()` 之前就知道该用哪个 `operation`，两次检查独立，`test_save_route_rejects_an_operation_the_caller_does_not_own` 证实了未授权调用在到达 `catalog()` 之前就被拒（404），`catalog` 从未被调用。

## publish() 的设计决定

**权限**：`current_principal(principal, admin=True)`——unscoped admin，而不是 `_owned()` 的 owner 门。理由写在函数 docstring 里：候选的 owner 是提案人，不是被信任能让它系统级生效的人；admin 必须能发布别人的已批准候选。测试 `test_admin_can_publish_a_candidate_it_does_not_own` 和 `test_publish_requires_unscoped_admin_not_owner_or_viewer` 覆盖了两个方向。`test_scoped_admin_cannot_publish` 覆盖了之前从未被测过的一档：`role=="admin"` 但 `scope` 不为空——这正是 `current_principal(admin=True)` 的真实门槛（`policy.py:184-186`：`admin and (current.role != "admin" or current.scope is not None)`），之前所有测试文件的 `admin()` 固件都只造 `scope=None`。

**前置状态**：只有 `approved` 放行，否则统一 409（`AiError("只有已批准的候选可以发布", "conflict", 409)`），覆盖 `draft`/`in_review`/`rejected`。

**CAS**：`expectedLibraryVersion` 是请求体**必填**字段，不在函数内部读取当前版本后自动代入。理由（写在代码注释里）：如果 publish() 自己读当前版本再传给 `report_library.save()`，调用方对库的旧读永远不会冲突，CAS 形同虚设；要求调用方显式传入，才能让"调用方看到的版本已经过期"变成可见的 409，而不是静默地覆盖别人刚做的改动——这和 `review()` 对 `contentDigest` 的处理是同一个理由。

**幂等**：用从候选 id 派生的稳定 slug（见下方"session 取锁与 slug"一节的最终形态）作为 `report_library` 里的 skill id。发布前检查当前快照里是否已有同 slug 的条目，若有则 409 拒绝重复发布。代码注释里明确写清：这个检查只能看"当前快照"，因为 `report_library.save()` 从没有删除分支（只 append-or-replace-by-id），`views.py` 只暴露 `read()`/`save()`——所以今天"曾经发布过"和"当前快照里还在"是同一件事；如果未来加了删除路径，这条判断必须跟着改，注释没有写成面向未来成立的断言。

**domains / keywords 的来源**（没有改 schema）：

- `domains`：发布请求体显式必填（1–6 个，必须是 `prompt_settings.DOMAINS` 的合法键，不重复）。没有默认值，因为候选内容本身不携带领域信息（schema 里没有这个字段，也不该有——分类是发布时的判断，不是提炼时的判断）。
- `keywords`：请求体可选传入（admin 显式指定，1–8 个，不重复，逐词走 `text()` 校验）；未传时按 `prompt_settings.ALIASES` 在选中的域之间**轮取**（每轮每个域拿一个词，不是先把第一个域的词填满），上限仍是 8。轮取而非仅用域名标签的理由写在 `_round_robin_keywords()` 的 docstring 里：按 12 条运营风格提问实测过——只用域标签本身（如仅"网店"）命中 3/12，轮取 ALIASES 命中 12/12。测试 `test_keywords_default_to_alias_round_robin_across_domains` 断言了轮取顺序（两个域的第一个词各出现一次，排在任一域的第二个词之前）。

**事件**：通过 `pi_service.event(session, "skill_candidate_published", {...}, row.operation)` 写入（`session` 的取法见下方"session 取锁"一节），不是手算 `max(event_seq)+1`。`test_event_is_written_through_pi_service_event_not_hand_rolled` 直接断言 `session.event_seq` 在 publish 后自增了 1，并且同一会话上再写一条事件不会撞 `(session, event_seq)` 唯一约束——这是 `task_feedback._event()` 在当前 `origin/main`（`11532ef3`）上仍然留着的同类手算模式（修复在未合并分支 `codex/fix-event-seq-20261105` 的 `8dce0fcb`），本次 publish() 没有重蹈。独立反审复现了"会话写过任务修正后 publish() 必 IntegrityError"的场景（见下方交接项第 1 条）。

**写操作范围**：候选状态读取、重复发布检查、`report_library.save()` 调用、事件写入全部在同一个 `with mutation(principal):` 块内，与 `review()`/`save()` 的既有风格一致。

## 端到端断言

`test_published_skill_is_actually_selected_by_guidance`：approve 一个 goal 含"网店经营"字样的候选，publish 到 `netshop` 域，取新快照后直接调用 `report_library.guidance("京东店铺今天的转化怎么样", ...)`，断言返回的 `evidence["skills"]` 里包含这条候选派生的 slug，且注入的 prompt 文本里包含候选的 `body` 原文。这是整件事的目的性断言：证明发布后的候选确实会被 Pi 运行时的指导选中，不只是写进了表里。

## 测试结果

跑测命令（venv 在 `D:/teruisi-runtime/django-sales/venv`，仓库自带 `python` 没装 Django）：

```
cd D:/.codex/worktrees/p1b-candidate-publish-20261105/backend
PYTHONDONTWRITEBYTECODE=1 PYTHONUTF8=1 "D:/teruisi-runtime/django-sales/venv/Scripts/python.exe" manage.py test <module> -v 2
```

| 模块 | 开工前基线（反审三重验证确认为 10） | 本次改动后 |
| --- | --- | --- |
| `test_skill_candidates` | 10 tests / OK | 31 tests / OK（新增 21 个方法） |
| `test_report_library` | 21 tests / OK（1 skipped，需 PostgreSQL） | 不变，21 tests / OK |
| `test_task_feedback` | 本次实测为 9 tests / OK | 不变，9 tests / OK（文件未改动；曾转述"origin/main 11 tests"，本工作树实际 checkout 的文件是 9 个 test 方法，与我的改动无关，如实记录） |
| `test_pi_sources` | 8 tests / OK | 不变 |
| `test_pi_transport` | 5 tests / OK | 不变 |
| `test_pi_runtime` | 46 tests / 4 failures + 7 errors（既有基线，与本任务涉及文件无关） | 不变，同样 4F+7E |
| `test_pi_business_boundaries` | 28 tests / 3 failures + 4 errors（既有基线） | 不变，同样 3F+4E |
| `test_pi_workspace` | 31 tests / 2 failures（既有基线，文件未被本次改动触及） | 不变 |
| `manage.py check` | — | 通过，0 issue |

`test_pi_runtime`/`test_pi_business_boundaries`/`test_pi_workspace` 的失败与本次改动的两个文件（`skill_candidates.py`、`pi_views.py`）均无代码关联（未被我的 diff 引用、未被我的 diff 修改），实测确认是既有基线，不是本次引入的回归。

## 独立反审发现并已修复的两个问题

1. **状态守卫可删而测试全绿**：`test_only_approved_candidates_can_be_published` 原来发的请求体缺 `expectedLibraryVersion`，导致 `fields()` 在状态检查之前就抛 400，测试从未真正走到 `if row.status != "approved"` 这行；且断言只写了 `assertRaises(AiError)`，不检查 `code`/`status`，所以哪怕把整个状态守卫删掉，30 个测试依旧全绿。修法：补上 `expectedLibraryVersion`，并把该测试以及其余所有检查特定拒绝原因的 `assertRaises(AiError)` 都加上 `caught.exception.status` 的具体断言（409/403/400，视具体用例）。修复后人工删除状态守卫重跑测试，确认测试会红（`AiError not raised`），再恢复守卫确认恢复绿。
2. **goal 前导空白让 publish 永久失败且报错指向错字段**：`_validate_content` 的 `text(content["goal"], ...)` 校验时会内部 `.strip()` 后再量长度，但存入 `content_json` 的是未 strip 的原始值（`canonical()` 不做 strip）。如果 goal 前导空白超过 80/240 字符，`goal[:80]` 切出来是纯空格，`report_library.validate_item()` 的 `text()` 把它 strip 成空串后拒绝，报错写"名称不能为空"——这个字段 publish 调用方从没传过。修法：`goal = content["goal"].strip()`，再切片。补了专门的回归测试 `test_goal_with_leading_whitespace_past_the_slice_still_publishes`，人工还原 bug 重跑测试确认会红（复现出一字不差的"名称 不能为空"），再恢复修复确认绿。

## session 取锁与 slug（反审建议，已采纳）

**session 取锁**：`pi_service.event()` 的契约是"调用方持有 session 锁"。publish() 现在显式 `PiSession.objects.select_for_update().get(pk=row.operation.session_id)` 之后才调用 `event()`，不再依赖"读 `row.operation.session` 时已经在 `mutation()` 的全局锁之内所以暂时安全"这个隐含前提。反审用真实 SQL 语句序列核实了修改前的代码在 PostgreSQL 上不会损坏数据（全局锁已经在前），但没有做双线程实验（测试库是 sqlite），所以这条修复是消除契约违规和未来重构风险，不是修一个已证实的数据损坏。

**slug 用完整 UUID**：`_slug_from_candidate()` 原来只取候选 id 最后一个 `-` 分段，改为保留去掉 `ai-candidate-` 前缀后的完整 uuid（`"candidate-" + 完整uuid`，46 字符，`slug()` 上限 64）。反审核实过原写法就算碰撞也只会撞上 `already_live` 的 409 检查而不是静默覆盖（检查跑在 `report_library.save()` 之前），概率约 1e-12；改成完整 uuid 后这个顾虑不再成立，相关测试辅助函数也同步改为调用 `skill_candidates._slug_from_candidate()` 而不是在测试里重复推导格式。

## 已知缺口与交接项

1. **合并顺序约束（反审发现）**：独立反审复现了"会话写过任务修正后 publish() 必 IntegrityError"的场景（触发者 owner、受害者 admin，跨账号），判定根因在 `task_feedback._event()`、不可在本 diff 内修；并实测确认把本次补丁叠加到 `codex/fix-event-seq-20261105`（`8dce0fcb`）上跑同一场景可以通过。**这意味着合并顺序是硬约束：`fix-event-seq` 必须先进 main**，本分支不处理 `task_feedback`。
2. **Worker 侧白名单**：`lib/django/ai-service.ts:25` 的 `PI_PUBLIC_PATH` 白名单和 `app/api/ai/pi/` 代理目录需要分别加 `pi/skill-candidates`（含 `<id>/review`、`<id>/publish` 两个子路径）与 `operations/<id>/skill-candidates` 两条。按任务要求本次未改这两处（另一分支 `codex/pi-operations-wiring-20261105` 在同时改）。没有这一步，Django 侧的 4 条路由从 Worker 代理不可达。
3. **候选发布后的撤回**：`report_library` 没有任何删除路径，发布后的 skill 条目无法下线，只能 `enabled: false`（走 `report_library.save()` 的既有编辑路径，本次未新增撤回专用入口，因为任务范围只要求"能发布"）。如果未来要支持撤回已发布技能，"重复发布检测只看当前快照"这条设计前提要重新评估。
4. **guidance() 的 `[:3]` 上限让机制约 3 条候选后静默停止扩展（反审实测）**：`report_library.guidance()` 是既有代码、本次未改。反审实测发布 1/3/5/21 条候选后的真实命中率：已发布 1 条时 1/1 可被选中，3 条时 3/3，5 条时 3/5，21 条（库满 24）时 3/21。单条候选工作正常（默认 3 条技能只在自己 keywords 命中时才占位，不挤占尾部）；但一个同时命中全部三条默认技能的查询（如"网店库存和推广的情况"）会把 `[:3]` 的位置全部用完，挤掉任何候选技能。要继续扩展需要给 `guidance()` 加排序或提高上限，那是另一件事，本次不做。
5. **`name`/`description` 对 ≤80 字符的 goal 完全相同（反审实测）**：`SKILL_CANDIDATE_V1` 没有更适合做展示名的字段，真正修法是给 publish 请求体加一个显式的显示名字段——范围增长，本次不做。
6. **`test_task_feedback.py` 的用例数**：曾经转述"origin/main 上 11 tests / OK"，本工作树（`origin/main 11532ef3`）实测该文件是 9 个 `def test_` 方法、跑出来是 9 tests / OK。两者口径不一致的原因未查，如实记录，未做任何修改。
