# STEP6 独立审查：库龄表 availableQuantity 小数静默截断修复

- 审查者：独立审查代理（critical-review，Opus 5.5），未参与本次实现
- 被审对象：worktree `D:\codex-worktrees\erp-age-decimal-and-retry-cap`，分支 `codex/erp-age-decimal-and-retry-cap`，commit `49223d67`
- 基线：origin/main `1100e9c7`
- 改动范围：`lib/imports/erp-reference.ts`（+56/-4）、新增 `tests/inventory-age-available-quantity-decimal.test.ts`（+140）
- 审查方式：只读。未修改、提交或推送任何文件；临时脚本仅位于 `D:\codex-tmp\review-age-probe\`、`D:\codex-tmp\review-age-data\`。复核结束时 worktree `git status --porcelain` 为空。
- 规范依据：`AGENTS.md` 第 3、11 条；`docs/规范/导入与自动化.md`（"保留原值并告警，不得截断"）

## 结论（先行）

**不建议按当前状态合并。** 负数阻断的业务判断经真实数据核实是正确的，小数四舍五入+告警的方向符合规范，但存在 **2 条必须修**的缺陷，其中 1 条会在真实可达的场景下把整批导入拒绝——即把"小数静默截断"这一故障模式平移成"warning 超限整批阻断"，恰好是实现者在代码注释里声明要避免的那件事。两条都集中在告警容量与装配顺序上，修复量小。

---

## 一、确认正确（6 条）

### 1.1 负数一律阻断的业务判断——经真实数据独立核实，成立

实现者的判断不是推测，我用真实数据独立验证通过，并且与昨天库存表的情形有实质差别：

| 数据源 | 行数 | `availableQuantity` 负数 | 最小值 |
| --- | --- | --- | --- |
| 库龄 xlsx 真实文件（272 个） | 1,558,109 | **0** | 1 |
| PostgreSQL `inventory_age_lines`（97 个快照日，2026-07-14 ~ 2026-10-25） | 550,964 | **0** | 1 |
| 历史 D1/SQLite `erp_inventory_age_lines` | 253,602 | **0** | 1 |
| 对照：PostgreSQL `inventory_stock_lines`（姐妹表） | 2,222,263 | **1,113**（最小 -39） | -39 |

库龄表在 97 个快照日、约 236 万行（文件+库）里没有任何一条负数记录，最小值恒为 1；姐妹库存表在同一个库里有 1113 条生产负数。两张表的业务语义确实不同：吉客云库龄报表只列实际在库货品，不承载超卖/欠货口径。昨天"2356 条合法负整数"的误伤在这里不会重演。

补充核实实现者引用的代码依据：`lib/inventory/query-contract.ts:106` 的 `classifyInventoryAge()` 确实把 `availableQuantity <= 0` 统一归为 `no_stock`/"无可用库存"，库龄侧没有任何分支依赖负值区分超卖。引用属实。

需要同时记录一个**不影响本次结论、但应知悉**的事实：Django 侧 `backend/inventory/import_service.py:257` 对库龄行的 `availableQuantity` 允许范围是 `-MAX_ABSOLUTE_QUANTITY .. MAX_ABSOLUTE_QUANTITY`（允许负数），而库存行在 `allow_negative=False` 时才收敛到 `0..`。也就是说本次阻断只存在于解析层，后端契约本身仍接受负数。现状下两层不一致不会产生问题（真实数据无负数，解析层更严格属于安全方向），但这说明"负数阻断"是本次新增的解析层策略，而非后端既有契约的下移。

### 1.2 不照搬库存表"负整数放行"的结论，是对的

库存表那次收窄成"只阻断负小数、负整数放行"是被真实数据逼出来的妥协。库龄表没有同类真实数据支撑放行，在这里照搬反而会无依据地放宽一个本应收紧的字段。实现者选择按本表数据独立定策，符合 `AGENTS.md` 第 3 条"只做本需求所需的修复"的取向。

### 1.3 `.5` 边界与负零处理正确

- `Math.round(180.5) === 181`，测试已覆盖且实测通过。
- 负零不可达：`parsed < 0` 在取整**之前**拦截，所有负小数（含 `(-0.5, 0)` 区间，例如 `-0.4`）都走 errors 分支，不会到达 `Math.round`。我实测确认 `Math.round(-0.4)` 返回 `-0`（`Object.is(Math.round(-0.4), -0) === true`），若把判断放在取整之后就会漏出 `-0`；当前顺序规避了这一点。
- 这同时避免了库存表注释指出的陷阱：`Math.round` 对负数向零偏移（`Math.round(-3.5) === -3`），负小数若走四舍五入会把真实负值悄悄改小。

### 1.4 非数字、NaN/Infinity、超安全整数范围仍然阻断，行为未放宽

`parseNumber` 已过滤非有限值，`!Number.isFinite(parsed)` 是冗余防御但无害。`Number.isSafeInteger(rounded)` 在取整**之后**判断，比基线的 `Number.isSafeInteger(Math.trunc(parsed))` 等价或更严格。`MAX_SAFE_INTEGER + 2` 的测试实测通过。

### 1.5 `integer()` 签名变化的影响面——独立确认只有一个调用点

没有采信实现者的说法，自行核实：

- `integer(` 在 `lib/imports/erp-reference.ts` 内只有定义（189 行）与唯一调用（292 行，库龄 `availableQuantity`）。
- 该函数**未导出**（模块私有），仓库内不存在跨文件调用的可能。
- 同文件的 `optionalInteger()`（`inventoryAgeDays` / `sales7dQuantity` / `sales30dQuantity`）、`moneyCents()` 未改动，`parseProducts` / `parseCombos` / `parseJkyComboWorkbook` 不经过 `integer()`。货品与组合装两条链路行为不变。
- 全量 `tsc --noEmit`：改动的两个文件零错误（仓库存量 205 条基线错误与本次无关，分布在 `docs/*/demo.tsx`、`lib/ai/*`、`lib/market/*` 等处）。

结论：签名变化不影响调用方以外的任何代码，该说法成立。

### 1.6 回归测试通过

`node --import tsx --test` 跑过：新增套件 10/10 通过；`django-erp-reference-runtime`、`django-erp-reference-service`、`django-inventory-runtime`、`django-inventory-service` 19/19 通过；`inventory-age-parser`、`inventory-age-bucket-filter`、`inventory-stock-decimal-quantity`、`inventory-import-decimal-warning-passthrough`、`erp-reference-import-runner`、`import-content-fingerprint` 31/31 通过。

---

## 二、必须修（2 条）

### 2.1 【阻断级】下游追加固定告警后会超过 Django `MAX_WARNINGS=200`，导致整批被拒

解析层的截断上限算错了一格，没有为下游要追加的固定告警留位。

`lib/imports/erp-reference.ts:294` 的条件是 `warnings.length < MAX_ISSUES - 1`，即允许 `warnings` 增长到 **199** 条小数明细，超限时再追加 1 条汇总提示，解析层上限正好是 **200**。问题在于 `parseInventoryAge` 的返回值并不是最终发给 Django 的数组。`lib/inventory/django-age-import-service.ts:103-106` 还会往后追加固定告警：

```ts
const warnings = [
  ...parsed.warnings.map(issue),
  ...(excluded ? [{ code: "EXCLUDED_BRUSH_WAREHOUSE", message: `已从库龄分析中排除刷刷仓 ${excluded} 行` }] : []),
];
```

而 `backend/inventory/import_service.py:143` 是硬性拒绝，不是截断：

```python
if not isinstance(value, list) or len(value) > MAX_WARNINGS:
    raise _error("warnings 无效")
```

下游这里**没有任何 `slice(0, 200)` 兜底**（对照库存侧 `lib/inventory/django-import-service.ts:237` 有 `warnings.slice(0, 200)`）。我用临时脚本实测了这条路径：

| 场景 | 解析层 warnings | 追加固定告警后 payload | 结果 |
| --- | --- | --- | --- |
| 200 行小数，唯一业务键 | 200 | 201 | **超限，整批拒绝** |
| 300 行小数 + 重复业务键（触发 `DUPLICATE_KEYS`） | 201 | 202 | **超限，整批拒绝** |
| 199 行小数 + 刷刷仓 | 199 | 200 | 恰好通过 |

两点需要注意：

1. `DUPLICATE_KEYS` 本身也在解析层 `pushDuplicateWarnings` 里**无条件 push**（`erp-reference.ts:325`），它在小数明细与汇总提示之后追加，直接把解析层推到 201 条，解析层自己的 200 上限就已经被突破了。
2. 真实数据里 `刷刷仓` 剔除与业务键重复都是常态（下游专门为此写了 `EXCLUDED_BRUSH_WAREHOUSE` 和 `DUPLICATE_INVENTORY_IDENTITY` 两条路径，`processed` 目录里就有"已剔除刷刷仓及异常货值"的真实文件），所以这不是只有构造数据才能触发的理论场景。

这正是实现者在 `erp-reference.ts:282-285` 注释里声明要避免的后果——"避免'小数行多'把故障模式从'小数静默截断'平移成'warning 超限阻断'"。当前实现没有达成这个目标。

**建议修法**（任一即可，建议同时做第二条做纵深防御）：

- 解析层把预算下调，为下游固定告警留位（例如把小数明细上限降到 `MAX_ISSUES - 2`，并把 `pushDuplicateWarnings` 也纳入同一预算）；
- 在 `lib/inventory/django-age-import-service.ts` 组装后补一次 `warnings.slice(0, 200)`，与库存侧 `django-import-service.ts:237` 的做法对齐。

### 2.2 【中等】告警装配顺序未学到昨天的教训：固定告警排在小数明细之后，会被挤掉

任务书问的是"是否学了昨天'固定告警优先于小数明细'那个教训，还是这次没有同样的固定告警需要排序"。核实结果是：**这次同样有固定告警，而且顺序是错的。**

库存侧昨天的结论写在 `lib/inventory/django-import-service.ts:210-214` 的注释里，意思很明确：小数明细自带"还有 N 条未显示"的汇总兜底，固定业务告警没有兜底，一旦被截掉就是静默丢失，且固定告警通常比某一行取整更重要，所以固定告警必须优先占位（`const warnings = [...fixedWarnings, ...roundedQuantityWarnings]`）。

库龄侧的两处顺序都与此相反：

- `lib/inventory/django-age-import-service.ts:103`：`[...parsed.warnings, ...(excluded ? [EXCLUDED_BRUSH_WAREHOUSE] : [])]`——固定告警在**最后**；
- `lib/imports/erp-reference.ts:319-325`：溢出汇总提示与 `DUPLICATE_KEYS` 也都在小数明细**之后**追加。

一旦按 2.1 的建议引入 `slice(0, 200)`，被截掉的就恰好是 `EXCLUDED_BRUSH_WAREHOUSE`（"已剔除刷刷仓 N 行"）和 `DUPLICATE_KEYS`（"N 行仓库与货品组合重复"）这两条真正影响数据解读的固定告警，而保留 199 条"某行取整"明细。这与昨天的结论正好相反。

注意这两条必须一起改：只加 `slice` 不排序，会把阻断缺陷转成静默丢失重要告警；只排序不加 `slice`，整批仍会被拒。

**建议修法**：在 `django-age-import-service.ts` 里按库存侧的形状组装——固定告警在前，小数明细在后，然后统一 `slice(0, 200)`；解析层把 `DUPLICATE_KEYS` 也移到小数明细之前，或为其预留固定名额。

---

## 三、建议改（3 条）

### 3.1 错误与告警文案里的"可用库存"在真实文件中并不存在

真实的 272 个库龄文件中，匹配到的列头 **全部是 `库存数量`**（`AGE_ALIASES.availableQuantity` 的第 5 个别名），没有任何一个文件含 `可用库存` 列。新增的错误文案 `可用库存不能为负数` 和告警 `可用库存第 N 行为小数 ...` 会指向一个操作者在文件里找不到的列名。不是正确性缺陷，但会增加排障摩擦。建议文案回显实际命中的列头，或同时给出行号与实际列名。

### 3.2 `库龄(天)` 在真实数据里 100% 是小数，仍被 `optionalInteger` 静默截断

这是与本次同源的、规范上同性质的问题，只是不在本次改动范围内：272/272 个文件的 `库龄(天)` 含小数，约 54.9 万行（约 35%）形如 `29.33`、`62.5`、`279.43`，当前经 `optionalInteger()` 的 `Math.trunc` **静默截断，无任何告警**，与 `docs/规范/导入与自动化.md`"保留原值并告警，不得截断"的取向同样不符。

不建议在本次 PR 里顺手改：按每行一条告警的做法，单次导入会产生约 2000 条告警，立刻撞上 `MAX_WARNINGS=200`（也正说明 2.1 的容量问题必须先解决好）。合理做法是单独立项，用"共 N 行库龄天数含小数已取整"这类聚合告警而非逐行明细。建议登记为后续事项，不要遗忘。

另：`前7天销量`、`前30天销量` 真实数据中各有 3 条小数（如 `16.5`、`136.5`），同样被静默截断，属同一问题。

### 3.3 解析层与后端的负数契约建议对齐

如 1.1 所述，后端库龄行仍接受负数。若"库龄不接受负数"是确定的业务结论，建议后续把 `backend/inventory/import_service.py:257` 的下界也收到 0，使两层口径一致；否则解析层这道闸门绕过前端直连后端时并不生效。属加固项，不阻断本次合并。

---

## 四、待确认（2 条）

### 4.1 `3323.5` 这条真实数据的取整方向需要业务确认

真实文件中确实存在 **1 条**会触发小数分支的记录，值为 `3323.5`，恰好落在唯一一个 `Math.round` 与 `Math.trunc` 结论不同的边界上：

- 修复前（`Math.trunc`）：`3323`
- 修复后（`Math.round`）：`3324`

出现在同一快照的 3 个副本中（`outputs\jackyun-export-first-validation\n8n-export-first-11010\raw\inventory_age-*.xlsx` 行 737 列 I，及其 `processed` 副本与 `D:\谷歌浏览器\库龄分析(正式勿删).xlsx`）；核对原始 sheet XML 确认同行 `核算数量` 也是 `3323.5`。

这同时回答了任务书第 5 点：**存在真实文件能真正触发这条路径**，不止于实现者报告的"3 个文件 0 errors/0 warnings"。实现者的取样结论偏保守——真实数据中负数路径确实不可达，但小数路径是可达的，上面这个文件就是可用于正向验证修复有效性的真实样本，建议补做一次该文件的实际导入验证（取整结果 `3324` + 1 条 `ROUNDED_DECIMAL_QUANTITY` 告警，远低于 200 上限）。

需要业务确认的是：库存数量按 `+0.5` 向上取整是否符合口径。四舍五入比静默截断更符合规范是清楚的，但 `.5` 的方向选择没有业务依据记录。考虑到全量 236 万行里仅此 1 条，影响面极小，记录确认即可，不必阻断。

### 4.2 告警上限策略是否应与库存侧抽成共享实现

目前"截断 + 汇总提示"的逻辑在 `lib/imports/inventory-stock.ts`（局部常量 `MAX_INVENTORY_STOCK_WARNINGS = 200`）和 `lib/imports/erp-reference.ts`（复用 `MAX_ISSUES = 200`）各写一份，下游两个 service 的组装顺序和 `slice` 兜底又不一致——2.1 与 2.2 两个缺陷正是这种分叉的产物。两处都硬编码 200 去匹配后端 `MAX_WARNINGS`，任一侧调整都会静默失配。建议后续抽取共享的上限常量与装配helper。本次按 `AGENTS.md` 第 3 条"避免无关重构"不要求在此 PR 完成。

---

## 合并结论

**暂不可合并，修完 2.1 与 2.2 后可合并。**

- 核心业务判断（库龄表负数一律阻断）经 236 万行真实数据独立核实**正确**，昨天库存表的误伤不会重演，这是本次改动最关键也最容易出错的决定，实现者做对了。
- 小数四舍五入 + 告警的方向符合 `docs/规范/导入与自动化.md`"保留原值并告警，不得截断"；`.5` 边界、负零、取整前拦截负数这些细节都处理正确。
- 但告警容量与装配顺序有 2 条必须修：固定告警追加后会突破后端 `MAX_WARNINGS=200` 导致**整批拒绝**（2.1，已实测复现），且固定告警排序在小数明细之后，加兜底截断后会被静默挤掉（2.2，与昨天库存侧已确立的结论相反）。两条必须一并修，只修一条会把缺陷从"阻断"转成"静默丢失重要告警"。
- 修复集中在 `lib/imports/erp-reference.ts` 的告警预算与 `lib/inventory/django-age-import-service.ts` 的组装顺序，改动量小，建议补一条覆盖"小数明细 + 刷刷仓剔除/重复键共存"的测试——这正是现有 10 条测试的缺口：第 112 行那条上限测试只断言了 `parsed.warnings.length <= 200`，没有覆盖下游追加固定告警后的最终 payload 长度，所以测试全绿发现不了 2.1。按昨天"审查建议要先用真实数据核影响面""测试全绿发现不了"的教训，这条用例应当补上。

---

# 增量复审（commit `1fdb24b6`）

- 复审范围：只看 `49223d67..1fdb24b6`，不重审已确认正确的部分
- 改动：`lib/inventory/django-age-import-service.ts`（+16/-3）、新增 `tests/django-age-import-service-warnings.test.ts`（+85）
- 只读复核：worktree `git status --porcelain` 为空；临时脚本仅在 `D:\codex-tmp\review-age-probe2\`

## 结论（先行）

**2.1 与 2.2 两条必须修均已修复，可以合并。** 修法与库存侧 `django-import-service.ts` 的既有形状一致，阻断级缺陷已消除。复审另外发现 1 条**原有**（非本次新引入）的问题和 1 条测试有效性问题，均不阻断合并，列在下方待确认/建议改。

另需指出：协调者在派工说明里提出的"重复键检测在这段代码之前就直接 reject，确认不会和超限截断叠加"这一前提**不成立**（见 增量-3）。结论不变，但该推理不能作为后续依据。

## 增量-1：两条必须修已正确修复（确认）

`lib/inventory/django-age-import-service.ts:102-116` 现为 `[...fixedWarnings, ...roundedQuantityWarnings].slice(0, 200)`，与库存侧 `lib/inventory/django-import-service.ts:232-237` 形状一致。实测两层 200 的边界行为：

| 小数行数 | 解析层 `parsed.warnings` | 合并后 | `slice(0,200)` 后 | 固定告警在 `[0]` | 被截掉的条数 |
| --- | --- | --- | --- | --- | --- |
| 198 | 198 | 199 | 199 | 是 | 0 |
| 199 | 199 | 200 | 200 | 是 | 0 |
| 200 | 200 | 201 | 200 | 是 | 1（末尾明细） |
| 201 | 200 | 201 | 200 | 是 | 1（末尾明细） |
| 500 | 200 | 201 | 200 | 是 | 1（末尾明细） |

即：两层 200 不产生意外结果。解析层先把明细压到 ≤200（199 条明细 + 1 条"还有 N 条未显示"汇总），服务层叠加固定告警后最多 201，再截到 200，被丢弃的恒为排在最末的 1 条小数明细，固定告警恒在首位。原 2.1 的"整批拒绝"已不可复现，原 2.2 的顺序倒置已纠正。回答协调者第 1 问：**边界安全，无意外结果**。

## 增量-2：真实文件独立验证通过（确认）

未采信实现者结论，自行用解析器跑了真实文件 `outputs\jackyun-export-first-validation\n8n-export-first-11010\raw\inventory_age-2598327073546744960-4fde14f7-c422-4de2-a5f7-c57d49fb5af4.xlsx`：

- 解析 6066 行，**errors = 0**，**warnings = 1**
- 唯一告警：`ROUNDED_DECIMAL_QUANTITY`，第 **737** 行，`availableQuantity`，文案"可用库存第737行为小数 3323.5，已四舍五入为 3324"
- 解析结果中负数 `availableQuantity` = 0 条
- 叠加固定告警后 payload 仍为 2 条量级，远低于 200 上限

与实现者所述一致（`3323.5 → 3324`），修复在真实数据上**正向生效**，不只是"没有回归"。这也补上了 49223d67 阶段缺失的有效性证据。

## 增量-3：`DUPLICATE_KEYS` 仍可能被截断，且服务层的重复键 reject 是死代码（待确认，不阻断）

协调者的前提"重复键检测在这段代码之前就直接 reject，确认不会和超限截断叠加"经实测**不成立**，两处都需要修正认识：

1. **服务层的重复键 reject 实际不可达。** `parseInventoryAge` 在返回前已经按 `仓库\u001f货品编号` 做了 `new Map(...)` 去重（`erp-reference.ts:326`），所以 `django-age-import-service.ts:98-102` 读到的 `rows` 永远不含重复键，`DUPLICATE_INVENTORY_IDENTITY` 这条 reject 分支是死代码。实测：输入 3 行含 1 组重复键 → `parsed.rows` 返回 2 行，残留重复键 0 组。
2. **重复键告警走的是另一条路，且排在最后。** 重复仍会被 `pushDuplicateWarnings` 以 `DUPLICATE_KEYS` 写进 `parsed.warnings`（`erp-reference.ts:325`），位置在小数明细与溢出汇总**之后**。实测 250 行小数 + 1 组重复键：`parsed.warnings` = 201 条，`DUPLICATE_KEYS` 落在 index 200；经服务层 `[brush, ...parsed].slice(0,200)` 后 **`DUPLICATE_KEYS` 被截掉**（溢出汇总反而保留）。

也就是说，2.2 的那条教训（固定告警不能被明细挤掉）在 `EXCLUDED_BRUSH_WAREHOUSE` 上已经落实，但在 `DUPLICATE_KEYS` 上**尚未落实**——它仍是一条没有兜底、会被静默丢掉的固定性告警。

需要说明两点，所以不作为"必须修"：

- 这是 `49223d67` 之前就存在的既有行为（`pushDuplicateWarnings` 的位置未被本次改动触及），**不是 `1fdb24b6` 新引入的回归**；
- 触发需要"小数行 ≥200 且同时存在重复业务键"，而真实数据中小数行实测仅 1 条，距 200 很远。

建议后续把 `DUPLICATE_KEYS` 并入 `fixedWarnings` 的优先档（或在解析层为其预留名额），与刷刷仓告警同等对待；同时考虑清理服务层那段死代码，避免后来者误以为重复键在服务层仍会被拦截。

## 增量-4：新增 3 条测试方向正确，但边界那条的断言是"宽松通过"（建议改）

回答协调者第 3 问。3 条测试覆盖"共存且固定告警在前""超限后固定告警保留""无告警时为空"，方向正确且真实跑通（45/45 全绿，含既有套件）。但第 2 条自称覆盖超限的用例，实际**没有真正触发 `slice` 截断**：

用例构造 199 行小数 + 1 行刷刷仓。实测该形状下 `parsed.warnings` = 199 条（未达解析层上限，因此**不产生**"还有 N 条未显示"的汇总提示），合并固定告警后恰好 = **200**，`slice(0,200)` 未丢弃任何一条。`assert.ok(warnings.length <= 200)` 因此是恒真断言——把服务层的 `.slice(0, 200)` 删掉，这条测试依然会通过。注释里描述的"199 条明细 + 1 条汇总 = 200，叠加后 201 必须被再截断到 200"与实际执行路径不符。

这正是 `review-advice-needs-real-data-check` / `ci-gate-verify-the-number` 两条记忆指向的同一类问题：断言的数字看着对，但门禁并未真正生效。建议把小数行数提到 **≥200**（例如 200 或 250 行），此时 `parsed.warnings` 达到 200、合并后 201、`slice` 真正丢弃 1 条，断言才有回归保护力；并补断言"固定告警 `EXCLUDED_BRUSH_WAREHOUSE` 仍在 index 0"与"最终长度严格等于 200"。

属测试有效性问题，不影响生产代码正确性（生产逻辑已由我的独立探针在 200/201/500 三个点验证），故列为建议改。

## 增量-5：回归与类型检查（确认）

- 聚焦套件 **45/45 通过**：`django-age-import-service-warnings`、`inventory-age-available-quantity-decimal`、`inventory-age-parser`、`inventory-import-decimal-warning-passthrough`、`django-inventory-service`、`django-inventory-runtime`、`inventory-stock-decimal-quantity`、`erp-reference-import-runner`
- `tsc --noEmit`：本次改动的 2 个文件零错误；仓库存量 205 条基线错误与 `49223d67` 阶段一致，未增减，与本次无关
- 改动范围干净：仅 1 个生产文件 + 1 个新测试文件（协调者称"4 个文件含 2 个测试文件"，按 `git diff 49223d67..1fdb24b6 --stat` 实为 2 个文件；若把 `49223d67` 一并计入则为 4 个，口径差异而非问题）
- 库存侧链路未受影响：`parseErpReferenceXlsx` 的货品/组合装分支与 `django-import-service.ts` 均未改动

## 增量合并结论

**可以合并。** 原报告的 2 条必须修（2.1 整批拒绝、2.2 固定告警顺序）已在 `1fdb24b6` 正确修复，修法与库存侧既有实现对齐；两层 200 的边界经实测无意外结果；真实文件独立验证确认修复正向生效（第 737 行 3323.5 → 3324，0 errors / 1 warning）；聚焦回归 45/45 通过，无新引入回归。

合并后建议跟进（均不阻断）：把 `DUPLICATE_KEYS` 提到固定告警优先档并清理服务层那段死代码（增量-3）；把边界测试的小数行数提到 ≥200 让 `slice` 真正被执行（增量-4）；原报告 3.1（文案写"可用库存"但真实列头全为`库存数量`）、3.2（`库龄(天)` 真实数据 100% 含小数仍被静默截断，须用聚合告警单独立项）、3.3（后端负数契约对齐）仍然有效。
