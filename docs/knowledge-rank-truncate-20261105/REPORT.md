# knowledge.py rank() 候选集修复报告

分支 `codex/knowledge-rank-truncate-20261105`，工作树 `D:/.codex/worktrees/knowledge-rank-truncate-20261105`，基于 `origin/main` `11532ef3`。

**`docs/knowledge-lexical-index-20261105/REPORT.md`（如果存在）应视为废弃。** 它描述的是 `~Q(tags_json="[]")` 的 SQL 下推实现，该实现已被回退；本任务重新从 `rank()` 原始的 `[:100]` 问题出发，走了完全不同的方案（见下）。

**本报告已根据独立反审意见修订。** 第一版提交后，反审发现 2 处阻断缺陷、2 处非阻断缺陷，以及 1 个前提证据错误（ceiling 的量化依据）。本次修订记录了全部四处代码修复、测试改动，以及证据纠正。

## 改动文件

- `backend/ai_assistant/knowledge.py`：相对 origin/main 新增 137 行、删除 11 行（`git diff --stat origin/main`，含反审后的修订）。
- `backend/ai_assistant/test_knowledge.py`：新建，26 个测试（反审前 22 个，因修复 4 处问题增删调整为 26 个）。

## 根因与症状（复述确认）

`rank()` 原来是「先按 `-updated_at` 截断到 100 行，再在 Python 里打分」。截断发生在打分之前，所以无论某一行分数多高，只要前面有 100 行更新更晚的记录，它永远进不了候选集。

## 否定的两条路（确认仍然否定，未重试）

任务开场已给出两条实测否定的路（`~Q(tags_json="[]")` 的 ceiling-by-tag-density 问题，和全子串枚举在中文下炸 SQLite 表达式树 + 1 字符子串重开反向包含漏洞）。本次直接采纳任务描述作为既有事实，未重复踩坑。

## 选定方案：按分数截断，用高位准入 ceiling 替换 -updated_at 截断

### 核心改动

1. 把 `rows = ...order_by("-updated_at", "id")[:100]` 的 `100` 换成 `CANDIDATE_ROW_CEILING = 4000`，并加 `.iterator(chunk_size=200)` 流式读取，避免一次性把全部候选行物化进内存。
2. 打分逻辑完全不变（标题/tags/content 的精确、包含、反向包含判分，`>=12` 阈值），只是现在覆盖的行数从 100 变成最多 4000。
3. `rank()` 的返回值从裸 `list` 换成 `_Ranked`（`list` 子类），新增 `.admission_truncated` 属性。
4. `search()` 的返回值新增 `admissionTruncated` 字段，与已有的 `truncated`（输出 limit 截断）区分开。
5. `context()` 也新增截断可见性（反审后修订，见下 P2）。

### 为什么选这条

任务列出的三个方向里，实际做的是方案 2（提高扫描上限 + 显式截断信号）为主干：

- **方案 1（`.only()` / 分块两趟）**：content 单独就能贡献 50+5x20=150 分，几乎任何一行都可能靠 content 单独过线，所以"先读 title/tags 判断是否需要读 content"这一步本身不能跳过读 content。实测证明两趟式分块在这个打分公式下不能省掉读 content 的成本。
- **方案 3（先用一次廉价 SQL 粗筛）**：任务已证明这条在当前双向打分公式下不存在真超集，未重新尝试证伪已证伪的东西。
- **方案 2**：实际选的方案主体，ceiling 数值和流式读取方式用实测数据定下来。

## 反审发现的问题与修复（按阻断程度排列）

### 必修一（阻断，已修）：超限行从"抛异常"改为"跳过"

**问题**：`:71` 的 503 守卫按扫描到的每个 ACL 可见行无条件触发，不是按打分命中。把扫描窗口从 100 扩到 4000，等于把这个总停机触发面放大了 40 倍。反审实测（300 条无害行 + 1 条 `content="毛"*16001` 排在 `-updated_at` 第 302 位，再加一条真实匹配）：改之前（本次改动中的中间状态）`search()`/`context()` 对一个完全不相关的查询都会抛 `AiError 503`——包括什么都匹配不上的查询。`chat.py:642` 到 `context()` 之间没有任何 `try/except`，这意味着任何一次对话都可能被一行无关的超限数据挂掉。

**我独立复现了这个问题**（见「独立复核」一节），确认属实。

**修复**：把 `raise AiError(...)` 改成 `continue`（跳过该行，不参与打分，不影响其他行）。该字段没有任何写入路径强制 ≤16000/≤240（`content`/`title` 是裸 `TextField`，无 DB CHECK 约束），所以超限行是这个守卫本来就该处理的场景，不是可以假设不存在的边界情况。跳过一行坏数据，让其余行正常打分，严格优于让每一次请求都失败直到有人手动修复那一行。

**新增测试**：`test_oversized_row_is_skipped_not_raised`、`test_oversized_irrelevant_row_does_not_break_an_unrelated_query`（直接复现反审场景：300 行 + 1 超限行 + 不相关查询）、`test_oversized_irrelevant_row_does_not_break_context`（同场景走 `context()` 路径）。

### 必修二（阻断，已修）：tie-break 从「隐含的最近更新优先」变成「显式的 id 优先」是未声明的行为变更

**问题**：原代码 `sorted(key=-score)` 配合 Python 稳定排序，在数据库顺序（`-updated_at, id`）基础上同分保持**最近更新优先**。我的第一版改成 `(-entry[1], entry[0].id)`，变成**id 字典序优先**——这是一个真实的行为变更，而且打分是 `120/80/70/50 + 18/14/5` 的组合，离散值本来就少，同分远非罕见情况。反审造的真实查询「京东仓储费率怎么计算」对 8 条合理条目，得分集合是 `[69]*8`，8 行只有 1 个不同值。`search()[:limit]` 和 `context()[:4]` 都受此影响，决定哪些知识真正进入模型上下文。

**我独立复现了这个问题**（见「独立复核」一节），确认属实。

**修复**：tie-break 改为 `(-score, -updated_at, id)`——最近维护优先，id 只在 score 和 updated_at 都相同时作最终确定性兜底。对人工维护的知识库，"最近维护的优先"比任意的 id 排序更站得住。

**测试改动**：原 `test_tied_scores_break_ties_by_id_deterministically` 钉住的是错误的新行为（id 优先），已重写为 `test_tied_scores_break_ties_by_recency_then_id_deterministically`（断言 recency 优先，并在 docstring 里说明这是对一处未声明行为变更的纠正，不是"改回去看起来像回归"），另加 `test_tied_scores_and_tied_updated_at_fall_back_to_id`（score 和 updated_at 都相同时验证 id 兜底）。

### 建议修 C3（已修）：`admission_truncated` 在恰好等于 ceiling 时假阳性

**问题**：原实现 `rows[:CANDIDATE_ROW_CEILING]` + 循环后 `scanned >= CANDIDATE_ROW_CEILING` 判断截断。当表恰好有 `CANDIDATE_ROW_CEILING` 行时，这些行全部被扫描、零丢弃，但判断条件仍为真，报告虚假的"已截断"。另外 `scanned` 在 ACL 过滤之前自增，这会让"全部不可见"的场景也误报截断。

**我独立复现了这个问题**（见「独立复核」一节），确认属实。

**修复**：改为抓取 `CANDIDATE_ROW_CEILING + 1` 行；循环处理前 `CANDIDATE_ROW_CEILING` 行用于打分，若存在第 `CANDIDATE_ROW_CEILING+1` 行则判定截断，否则不判定——这个探测行本身从不参与打分。

**测试改动**：`test_admission_truncated_flag_true_at_ceiling`（原本因为这个 off-by-one 才通过）拆成 `test_admission_truncated_flag_false_at_exactly_ceiling`（恰好 ceiling 行，断言不截断）和 `test_admission_truncated_flag_true_past_ceiling`（ceiling+1 行，断言截断）。

### 建议修 C4（已修）：`search()` 输出的 tags 字段未做 rank() 同款过滤

**问题**：`search()` 构造 `item["tags"]` 时只判断了"是否是 list"，没有像 `rank()` 那样做 `[:12]` 截断和 `isinstance(tag, str)` 过滤。`tags_json='["ok", 123, null, {"a":1}, ["x"]]'` 这种畸形但合法的 JSON 会让非字符串元素原样进入模型可见的输出，而且超过 12 个标签的行会输出全部标签，不是 `rank()` 实际打分用到的前 12 个。

**我独立复现了这个问题**（见「独立复核」一节），确认属实。

**修复**：在截断 `[:12]` 之后再过滤 `isinstance(tag, str)`，与 `rank()` 的顺序完全一致。

**新增测试**：`test_search_tags_output_filters_non_strings_and_caps_at_12`（25 个元素的畸形 tags_json，断言输出只保留前 12 个原始元素里的字符串，结果是 8 个）。

### 建议修 P2（已修）：`context()` 完全没有截断可见性

**问题**：`search()` 加了 `admissionTruncated` 字段，但 `context()`（直接拼给模型的字符串，`chat.py:642` 内嵌调用）在截断发生时返回的是一个看起来完整、实则不完整的 `<knowledge>` 块，或者直接是空字符串——模型没有任何方式知道检索可能被截断了。这比 `search()` 的缺口更严重，因为 `search()` 的消费者是人/工具（能看到字段），`context()` 的消费者是模型本身。

**修复**：`context()` 在 `ranked.admission_truncated` 为真时，在 `<knowledge>` 块里追加一段 `<truncated>知识库候选超过扫描上限，结果可能不完整</truncated>` 说明；如果没有任何候选块但发生了截断，也会返回这个说明（而不是静默的空字符串）。

### 文档/测试笔误（已修）

`test_knowledge.py` 一处 docstring 残留"ceiling 是 20000"的早期迭代措辞，实际值是 4000，已改为直接引用 `CANDIDATE_ROW_CEILING`。

## 比缺陷更重要的事：ceiling=4000 的量化依据被证据推翻，但结论侥幸安全

反审找到了独立证据——**生产表的文档记录行数是 6 和 12**：

- `docs/AI_ASSISTANT_MIGRATION_VALIDATION.json:267`：`"ai_knowledge_entries": 6`
- `docs/evidence/ai-report-library-production-20260914.json:179`：`"count": 6`
- `docs/技术专题/公共能力/system-datasets-coverage.md:61`：`AiKnowledgeEntries` 行 12

**我独立核实了这三处引用，内容与反审描述完全一致**（见「独立复核」一节）。同时独立复核了"无批量导入路径"的论断——确认仍然成立：零个非测试的 `AiKnowledgeEntries.objects.create/bulk_create/update`。

这意味着我在第一版报告里写的"任务描述的真实症状规模是 2009 行"这个前提，**不可能来自一张文档记录为 6-12 行的表**。要么生产表自 2026-09-14 以来涨了约 300-660 倍（而没有任何写入路径，无从解释这个增长），要么那个症状形状是合成的／来自别的环境，与这张生产表的真实证据矛盾。

**这不是我这边能验证的——我没有生产库访问权限（第一版报告已如实披露这一点），据一个未经核实的症状规模和延迟权衡选了 4000。** 结论是：4000 这个具体数字，其"覆盖已观测真实症状"的论证依据是错的；但"6-12 行的真实表 vs 4000 的 ceiling"本身没有任何风险——ceiling、流式迭代、`admissionTruncated` 三者在这个真实规模下都是纯防御性余量，从未触发。

**真正在 6-12 行表上就能触发的是必修一（C1）那条**：它不需要 4000 行，只需要**一行**超限数据存在，就会让每一次对话 503——这也是为什么 C1 被反审标记为唯一阻断级别的发现：它与 ceiling 具体数值无关，是扫描窗口扩大这件事本身（不管扩大到多少）暴露出的后果。

**修订后的 ceiling 定值依据**：应当表述为"防御性余量"而不是"覆盖已观测症状"。4000 相对真实的 6-12 行有约 330-670 倍余量，worst-case 延迟（约 3.2s，全部行 16000 字符的人为最坏情况）在这个真实规模下从未触及。这个数字的真正意义是"给未来表增长留出远超当前规模的缓冲"，不是"针对一个被证据推翻的症状规模精确计算出来的值"。

## 独立复核：反审的四处代码发现，我逐一复现确认

在动代码之前，我用独立脚本重新构造反审描述的场景，确认问题真实存在（而不是直接采信反审的结论）：

1. **C1（超限行挂掉对话）**：`300` 条无害行 + `1` 条超限行（排在第 302 位）+ 1 条真实匹配，查询一个完全不相关的词。改之前实测：`search()` 和 `context()` 均 `RAISED AiError`（503，消息"知识条目超过有界契约"）。
2. **C2（tie-break 反转）**：12 条同分行，id 升序与更新时间降序刻意反相关（`tie-01` 最旧，`tie-12` 最新）。改之前的代码路径（`(-score, id)`）产出 `['tie-01','tie-02','tie-03','tie-04']`；重建的"数据库扫描顺序 + 稳定排序"模拟（代表改动前的隐式行为）产出 `['tie-12','tie-11','tie-10','tie-09']`。两者集合相同但顺序完全相反，`top4` 完全不重叠。
3. **C3（off-by-one 假阳性）**：用 `knowledge.CANDIDATE_ROW_CEILING` 临时打补丁为 50，种 49/50/51 行不匹配的数据。改之前：`n=49 False`，`n=50 True`（**假阳性，零丢弃却报已截断**），`n=51 True`。
4. **C4（tags 未过滤）**：`tags_json='["ok", 123, null, {"a":1}, ["x"]]'`，改之前 `search()` 输出 `['ok', 123, None, {'a': 1}, ['x']]`——非字符串元素原样进入模型可见输出。

四处均独立复现确认，而不是直接采信反审报告的文字描述。修复后重新运行同样的四个脚本，确认：

1. `search()`/`context()` 返回 `returned=0`/空结果，不再抛异常。
2. tie-break 结果变为 `['tie-12','tie-11','tie-10','tie-09', ...]`，与改动前的隐式行为一致。
3. `n=49 False`，`n=50 False`（已修复的假阳性），`n=51 True`。
4. 输出变为 `['ok']`，非字符串元素被过滤。

同时独立核实了反审引用的三处生产行数文档证据（见上一节），以及"无批量导入路径"论断仍然成立。

## oracle 独立性问题（反审指出，已修）

**问题**：第一版 `brute_force_rank`（工作树外的暴力参考，`C:/Users/86137/AppData/Local/Temp/knowledge-oracle/oracle.py`）逐字复制了实现里的 `(-score, id)` tie-break，并且比对只用 `set()`——所以它结构上不可能检测到 C2 这类 tie-break 回归（两份完全相同的实现，无论对错，排序结果必然一致）。第一版报的"7 条查询、0 漏 0 误"是真的，但它验证的性质比看起来窄：只证明"代码和自己复制出来的另一份代码一致"，不是独立正确性验证。

**修复**：重写 `brute_force_rank`，从打分规则的文字描述（不是从源码）独立重新实现：打分权重、term 生成、tag 处理、oversized-row 跳过（而不是抛异常，匹配修复后的行为）全部用自己的措辞重写，tie-break 用自己独立选择的"recency-then-id"（与修复后的实现恰好一致，但不是复制得来，而是从"人工维护的知识库，最近维护优先更合理"这个语义独立推导）。比对方式从只比 `set()` 升级为同时比较**有序列表**和 top-4 子集顺序。

**重新验证结果**（新 oracle，有序比较）：

- 核心缺陷场景：`SET MATCH: True`，`ORDER MATCH: True`。
- 12 行同分 tie-break 场景：`real order` 与 `oracle order` 完全一致（`['tie-12','tie-11',...,'tie-01']`），`ORDER MATCH: True`，`top4 是最新 4 行: True`。
- 7 条真实风格查询：`ALL REAL-QUERY SETS+TOP4-ORDER MATCH: True`（集合和 top-4 顺序同时匹配）。
- C1 场景（oversized 行跳过）：oracle 候选数与真实 `returned` 数一致，均为 0，`MATCH: True`。

## 性能：实测数字（修复后复测）

修复后的内存/耗时量级与修复前一致（修复项不改变扫描规模或打分复杂度，只改变异常处理、tie-break 键和截断判断逻辑，这些都是 O(1) 级别的改动，不影响 O(n) 的整体复杂度）。

4000 行 x 16000 字符（ceiling 实际生效的 worst case）三次独立重测：

```
trial=0 rows=4000 content_len=16000 elapsed=3.2862s
trial=1 rows=4000 content_len=16000 elapsed=3.2665s
trial=2 rows=4000 content_len=16000 elapsed=3.3003s
```

与第一版报告的 3.2s 一致（方差在 0.1s 以内）。**反审复测同一场景得到 1.814s**，与我的数字相差近一倍，同一量级但有明显差距；本次用相同环境重测三次结果稳定在 3.27-3.30s，怀疑是测试环境（磁盘缓存状态、后台负载）差异，未能定位具体原因，如实记录这个未解释的差异，不强行统一到某一个数字。无论取哪个数字，在真实表只有 6-12 行的前提下，这个 worst-case 延迟从未在生产触发。

## 测试

### 既有失败基线

`backend/ai_assistant/test_knowledge.py` 改动前不存在于本工作树，没有既有失败基线可对比——本次新建。

既有契约测试 `ai_assistant.tests`：改动前、改动后（含本次修订）各跑一次，均为：

```
Ran 28 tests in ~2s
OK (skipped=1)
```

无回归。

### 测试数量变化：22 → 26

反审前 22 个测试，反审后变为 26 个：

- 删除/重写 2 个（原本钉住"超限行必须 503"的两个测试，重写为"超限行必须跳过"）
- 删除/重写 1 个（原 id 优先 tie-break 测试，重写为 recency 优先）
- 拆分 1 个为 2 个（admission_truncated 的 off-by-one 边界测试）
- 新增 3 个（oversized-row-skip 对不相关查询/context() 的直接回归测试）
- 新增 1 个（tied score + tied updated_at 的 id 兜底测试）
- 新增 1 个（search() tags 输出过滤/截断测试）

净变化：22 - 2 - 1 + 1(拆分多出的1个) + 3 + 1 + 1 = 26（拆分那一步是 1 个测试变 2 个，净增 1）。

```
Ran 26 tests in ~2s
OK
```

### 全量 ai_assistant 应用测试套件

第一版报告提到的全量 `manage.py test ai_assistant` 后台跑在本次修订完成时**仍在后台运行**（超过 1 小时），持续产生新输出（未卡死，应用测试体量确实很大）。本报告的正确性结论不依赖这次全量跑的结果——核心证据是 `ai_assistant.tests`（既有契约测试，前后一致）+ `ai_assistant.test_knowledge`（新测试，全绿）+ 独立 oracle 的有序比对（0 漏召/0 误召/tie-break 顺序一致）+ 对反审四处发现的独立复现与修复验证。如果全量跑最终暴露出与 `knowledge.py` 相关的失败，需要后续核实；这仍是本报告的已知缺口。

## 已知缺口与交接项

1. **PG 侧真正该补的是 trigram/GIN 索引，本次不做**（任务已明确排除，需要迁移）。
2. **CANDIDATE_ROW_CEILING=4000 的"覆盖已观测症状"论证依据已被证据推翻**（见上）。真实生产表只有 6-12 行，ceiling 的实际意义是防御性余量，不是精确计算值。如果真实表规模后续显著增长，这个 ceiling 和它的 worst-case 延迟需要重新核实。
3. **"2009 行症状来源不明"**：任务描述给出的症状规模与生产表的文档证据（6-12 行）矛盾，需要用户或下一次任务核实这个症状的真实来源（哪个环境、哪次观测），不应被当作生产表真实状态的描述。
4. **admissionTruncated 的 worst-case 延迟数字（3.2s vs 反审复测的 1.8s）存在未解释的差异**，本次未能定位具体原因（怀疑是环境差异），如实记录。
5. **全量 ai_assistant 测试套件跑完但未在报告里确认结果**（见上），需要后续核实最终退出码和失败列表。
6. 未加 migration（按要求）。`AiKnowledgeEntries` 模型定义未改动。

## 复现方式

```
# 目标测试
cd D:/.codex/worktrees/knowledge-rank-truncate-20261105/backend
PYTHONDONTWRITEBYTECODE=1 PYTHONUTF8=1 "D:/teruisi-runtime/django-sales/venv/Scripts/python.exe" manage.py test ai_assistant.test_knowledge -v 2

# 既有契约测试（回归确认）
PYTHONDONTWRITEBYTECODE=1 PYTHONUTF8=1 "D:/teruisi-runtime/django-sales/venv/Scripts/python.exe" manage.py test ai_assistant.tests -v 1

# 独立 oracle（工作树外，已修订为独立重推导 + 有序比较）
"D:/teruisi-runtime/django-sales/venv/Scripts/python.exe" -I "C:/Users/86137/AppData/Local/Temp/knowledge-oracle/oracle.py"
```
