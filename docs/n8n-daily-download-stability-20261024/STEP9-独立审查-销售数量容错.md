# STEP9 独立审查：销售导入数量小数容错

- 审查者：独立审查代理（critical-review，Opus 5.5），未参与本次实现
- 审查对象：worktree `D:\codex-worktrees\sales-quantity-decimal`，分支 `codex/sales-quantity-decimal-tolerance`，commit `1474afad`
- 基线：`origin/main` `b15bc095`
- 变更范围：`lib/sales/import-service.ts`（+77/-7）、新增 `tests/sales-quantity-decimal-tolerance.test.ts`（+420）
- 审查方式：只读。差分等价扫描、变异（阴性）测试、两份真实文件独立解析、告警预算边界枚举。临时产物在 `D:\codex-artifacts\review-sales-qty-20261027\`，未修改仓库或 worktree 任何文件。
- 必读规范已读：`AGENTS.md`、`docs/规范/导入与自动化.md`

## 结论摘要

**可以合并，但建议先修 1 条「必须修」。** 核心修复（负整数放行、小数四舍五入、负小数阻断）经独立验证正确且无误伤。问题集中在告警预算这一条：实现者想解决的「固定业务告警被挤掉」在真实文件的告警基数下并没有被解决，这正是库龄表那次的同一个坑的变体。

- 确认正确：7 条
- 必须修：1 条（告警预算对 `parsed.warnings` 基数失效）
- 建议改：4 条
- 待确认：2 条

---

## 一、确认正确

### 1.1 负整数放行逐字节等价，3290 行退货单不受影响（重点项 1，确认通过）

对 `quantity` 做了修复前/修复后的差分等价扫描（`verify-differential.ts`），覆盖 `-5000..5000` 全部整数、`-1..-20000` 负整数、以及 `±MAX_SAFE_INTEGER`、`±2^53`、`±1e308`、`±Infinity`、`NaN`、`-0` 等边界，共 30007 个输入：

- 整数输入（10007 个）：`errors` 数组逐字段 JSON 等价，**mismatch = 0**；`row.quantity` 被改写次数 **0**；整数产生多余 warning 次数 **0**
- 负整数（20000 个）：mismatch **0**，修复后阻断数 **0**

机理确认成立：`import-service.ts:199` 的 `if (Number.isSafeInteger(value)) return;` 让所有安全整数（含全部负整数）在改写与告警之前就返回，后续 `value < 0`、`Math.round`、`row.quantity = rounded` 三处均不可达。

`integerFields` 移除 `quantity` 没有意外放宽任何东西：该数组仅在 `import-service.ts:242` 一处使用，移除后剩余 10 个字段的 `Number.isSafeInteger` 判定原样保留（重点项 6 确认）。`lib/netshop/normalized-import.ts:924` 也有同名 `validateRows`，但是另一个独立函数，本次未触及。

真实文件复核（我自己跑，未采信任何人的数字）：

| | 11006（10-23 成功） | 11012（10-27 失败） |
|---|---|---|
| 解析行数 | 39331 | 39081 |
| 正整数 | 36126 | 35790 |
| 负整数 | **3205** | **3290** |
| 正小数 | 0 | **1**（第 2492 行 = 1.5） |
| 负小数 | **0** | **0** |
| businessType | sale 36126 / return 3205 | sale 35791 / return 3290 |
| 修复前 quantity 阻断 | 0 | **1** |
| 修复后阻断 | **0** | **0** |
| 修复后 warning | 0 | **1** |

两份文件的全部数字与协调者给出的表格一致。11006 文件在修复前后行为完全相同（0 阻断、0 告警），证明本次改动对已成功导入过的批次是零影响。`businessType=return` 与负整数数量的 3205/3290 对应关系也独立复现，确认负数量确实是退货单的合法判定依据（`lib/imports/sales-ledger.ts:532`）。

### 1.2 `Math.round` 边界与 `-0` 坑不存在（重点项 3，确认通过）

- `.5` 向上：`1.5→2`、`2.5→3`、`3.5→4`、`0.5→1`，与 `Math.round` 语义一致，符合用户选定的「四舍五入」
- `-0` 未被绕过：`Number.isSafeInteger(-0) === true`，`-0` 走整数路径，与修复前一致；且 `JSON.stringify({quantity:-0})` 得到 `{"quantity":0}`，不会把 `-0` 发给后端
- **库存表那次的 `Math.round(-0.4) === -0` 死代码问题在这里不存在**：负小数在 `value < 0` 分支就被阻断，`Math.round` 对负数永远不可达。我确认 `Math.round(-0.4)` 确实是 `-0`（`Object.is(Math.round(-0.4), -0) === true`），但该代码路径取不到
- 负小数阻断真实生效：`-0.1 / -0.4 / -0.5 / -1.5 / -2.5 / -3.5 / -1e-7` 全部阻断，报「quantity 不能为负小数」

### 1.3 非安全整数的阻断决策与修复前完全一致

`±2^53`、`1e308`、`Infinity`、`NaN` 等 14 个边界输入，修复前后「是否阻断」的决策 **100% 一致**（`equivalentBlockDecision` 全为 true）。只有错误文案在负值侧从「必须是安全整数」变成「不能为负小数」（见 3.3）。

### 1.4 四舍五入后的值真的落到了 Django 分片

这是测试没覆盖、我单独验证的一层（`verify-staged-payload.ts`，拦截 PUT chunk 读取真实 payload）。`row.quantity = rounded` 作用于 `mapAnalysisSafeRow` 产出的新对象，`rows` 与 `splitRowsForStaging(rows)` 共享同一引用，因此改写确实生效：

| 输入 | 落到分片的 quantity | 是否整数 | 后端 `_normalize_row` 是否会拒 |
|---|---|---|---|
| 1.5 | **2** | 是 | 否 |
| 2.5 | **3** | 是 | 否 |
| -2 | **-2** | 是 | 否 |
| -1.5 | 未发送（已拒） | — | — |
| 3 | 3 | 是 | 否 |

这一点很关键：后端 `backend/sales/write_service.py:437-443` 的 `INTEGER_FIELDS` **仍然包含 `quantity`**，且用 `isinstance(raw, int)` 严格判定。若 Worker 侧只告警而不改写数值，后端会以 `INVALID_INTEGER` 整批拒绝——修复等于无效。实测确认改写生效、后端闸门能通过。

### 1.5 后端对 warnings 是截断而非超限拒绝（重点项 2 第一问，已查实）

查 `backend/sales/write_service.py`：`sanitize_issues`（第 396-419 行）对输入 `values[:200]` 截断，没有任何「超限拒绝」路径；全文搜索 `len(warnings)`、告警上限相关的拒绝逻辑，**零命中**。`write_views.py` 也不校验 `parserWarnings` 条数。

**所以销售这条路径与库龄表不同：销售是截断，库龄表是超限拒绝。** 实现者「必须截断」的方向判断正确，但「必须截断」在销售这边并不是硬性的正确性要求（不会导致整批失败），只是告警可观测性要求。这降低了本次问题的严重度（见 2.1）。

### 1.6 其余 10 个字段的校验行为完全未变（重点项 6，确认通过）

- `integerFields` 仅剩 10 个字段，判定逻辑（`Number.isSafeInteger`）一字未改
- 真实文件 39081 行中，10 个字段映射后全部是安全整数，0 条阻断
- 需要澄清我自己的一个中间误报：首轮 harness 报 `grossMarginBps` / `untaxedGrossMarginBps` 各 7344 条「非安全整数」。复核（`verify-mapped-fields.ts`）确认这是**我的 harness 误报**——我读了 `SalesLedgerRow` 的原始 `null`，而 `mapAnalysisSafeRow`（`import-service.ts:85,87`）用 `?? 0` 转成 0 才进 `validateRows`。映射后非安全整数计数为 **0**。该 `?? 0` 是基线既有行为，本次未改
- 金额字段在解析阶段（`moneyToCents` / `optionalRateBps`）就已 `Math.round` 成整数 cents/bps，不会以小数形式到达 `validateRows`，本次放宽确实只限 `quantity` 一个字段

### 1.7 变更范围未超出；无未提交残留

diff 只含 2 个文件，`git status --porcelain` 在 worktree 内为空。改动函数仅 `validateRows`（签名改为返回 `{errors, warnings}`）与新增 `normalizeQuantity`，调用点唯一。符合 `AGENTS.md` 第 3 条「只做本需求所需的修复或扩展」。

回归：`tests/sales-*.test.ts` 全量 **191 tests / 191 pass / 0 fail**。`tests/business-sales-options.test.ts` 有 1 条失败（"actual Python contract SHA and Unicode exact identities match TS"），但我在基线 `D:\运营管理系统`（main，313c8d35）上复现了同一条失败，**属于既有基线失败，与本次改动无关**。`npx tsc --noEmit` 与 `eslint` 对本次两个文件零报错（仓库整体 205 条 tsc 报错是既有基线）。

---

## 二、必须修

### 2.1 告警预算对真实的 `parsed.warnings` 基数失效——150 软上限保护不到它想保护的东西（重点项 2）

这是本次唯一的实质缺陷，也正是**库龄表那次坑的同一形态**：预算只对自己新增的那部分计数，没把已经存在的告警算进分母。

`import-service.ts:378-388` 的装配顺序是：

```
combinedWarnings = [...parsed.warnings, ...rowWarnings.slice(0, 149)]  (+ 可能 1 条汇总)
parserWarnings = sanitizeSalesIssues(combinedWarnings)   // 这里再 slice(0, 200)
```

150 的上限只约束 `rowWarnings`，而 `parsed.warnings`（解析阶段的 `ALLOCATED_AMOUNT_MISMATCH` / `GROSS_PROFIT_MISMATCH`）不计入。**真实文件的 `parsed.warnings` 不是 0，而是 119 条**（11012 文件 119 条，11006 文件 118 条，全部是 `ALLOCATED_AMOUNT_MISMATCH`）。119 + 149 = 268 > 200，于是 `sanitizeSalesIssues` 的 200 截断重新开始起作用，150 的预算形同虚设。

以真实的 119 条解析告警为基数枚举（`verify-threshold.ts`）：

| 小数行数 | Worker 输出总条数 | 小数明细存活 | 汇总提示是否出现 | 留给后端固定告警的余量 | 后端 3 条固定告警存活 |
|---|---|---|---|---|---|
| 1（当前真实情况） | 120 | 1 | 不需要 | 80 | **3 / 3** |
| 50 | 169 | 50 | 不需要 | 31 | 3 / 3 |
| **79** | 198 | 79 | 不需要 | **2** | **2 / 3 开始丢** |
| **82** | 200 | 81 | 不需要 | **0** | **0 / 3** |
| 150 | 200 | 81 | **应出现但被截掉** | 0 | 0 / 3 |
| 210（实现者的测试场景） | 200 | 81 | **应出现但被截掉** | 0 | 0 / 3 |

三个具体后果：

1. **固定业务告警从 79 行小数起就开始被挤掉**，82 行起全部丢失（`EXCLUDED_FUTURE_DATE_ROWS` / `EXCLUDED_BRUSH_WAREHOUSE` / `EXCLUDED_NON_WHITELIST_CHANNEL`）。实现者声称 150 是「为固定业务告警预留余量」，但在 119 条基数下预留量实际是 `200-119-149 < 0`，预留失败。
2. **汇总提示本身会被截断**（第 150 行小数起）。提示被 `push` 到数组末尾，而 200 截断从尾部砍——这正是库龄表那次「固定告警排在小数明细后面，截断时被挤掉」的同一个顺序错误，只是对象从固定告警换成了汇总提示。
3. **静默截断**：82 行小数起，有 1 条以上小数明细被 200 截掉，而此时 `roundedOverflow == 0`（因为没超过 149），**不会生成任何汇总提示**，用户完全不知道有告警被丢。

实现者的测试 9 之所以显示预算有效（150 条、余量 50、提示存在），是因为测试构造的行成本为 20、金额为 0，**`parsed.warnings` 恰好是 0 条**。测试把真实链路里最关键的那个分母设成了 0，于是验证的是一个真实中不存在的场景。

建议改法（与库龄表最终采用的方案同形，把分母算全）：

```ts
const MAX_SALES_IMPORT_WARNINGS = 150;   // 总预算，不是"行告警预算"
const fixed = parsed.warnings ?? [];
const budget = Math.max(0, MAX_SALES_IMPORT_WARNINGS - fixed.length - 1); // -1 给汇总提示
const limitedRowWarnings = rowWarnings.slice(0, budget);
const roundedOverflow = rowWarnings.length - limitedRowWarnings.length;
const combined = [...fixed, ...limitedRowWarnings];
if (roundedOverflow > 0) combined.push({ /* 汇总提示 */ });
// 此时 combined.length <= 150，sanitizeSalesIssues 的 200 不会再砍，
// 后端固定告警有稳定 50 条余量
```

注意 `parsed.warnings` 自身也可能超过 150（公式不一致是逐行告警，理论可达全表）。若 `fixed.length >= 150`，上式 `budget = 0` 且小数告警全部丢失但仍有 1 条汇总提示说明，优于当前的静默丢弃；如果希望小数告警优先于公式告警，则需要显式调整两者的相对优先级，这属于产品口径选择，建议一并问用户。

严重度判断：**不阻断导入，不影响任何落库数值**（后端是截断而非拒绝，见 1.5）。纯粹是告警可观测性缺陷。但 `docs/规范/导入与自动化.md` 第 9 条要求导入必须保留「告警」作为完成要件，静默丢弃告警与该条取向不符；且这是同一模式连续第三次在告警预算上出问题，建议这次彻底修对，不要再留。

---

## 三、建议改

### 3.1 测试 9 的分母是 0，没有测到真实场景（重点项 4）

如 2.1 所述，测试 9 的 `parsed.warnings == 0`。建议把该测试的构造行改成会触发 `ALLOCATED_AMOUNT_MISMATCH` 的组合（例如 `allocatedUnitPrice=100, allocatedAmount=0, quantity=1.5`，分摊后金额与单价×数量不一致），让分母非 0，这样 2.1 的缺陷会被测试直接抓住。

同时 `assert.ok(warnings.length <= 150)` 这类写法要警惕——它单独存在时接近恒真（当前实现下输出也可能是 200，所以这条其实不恒真，见下）。好的一点是测试 9 还断言了 `assert.equal(warnings.length, 150)` 和 `assert.match(overflowNotice.message, /61/)` 两条精确值，这使它能抓住上限相关的回归（变异 M1、M4 都被它抓住了）。

### 3.2 变异测试结果：9 条测试抓住 4/6，漏掉 2 个关键变异（重点项 4）

我在 `D:\codex-artifacts\review-sales-qty-20261027\scratch\`（worktree 的独立副本，未动原仓库）做了阴性测试：

| 变异 | 测试是否失败 | 评价 |
|---|---|---|
| M1 去掉 150 上限 slice | **9→8 失败** | 抓住 |
| M2 `Math.round` → `Math.floor` | **9→8 失败** | 抓住 |
| M3 去掉负小数阻断 | **9→8 失败** | 抓住 |
| M4 去掉汇总提示 | **9→8 失败** | 抓住 |
| M5 把 `quantity` 放回 `integerFields` | **9 全过** | **漏** |
| M6 删掉 `row.quantity = rounded` | **9 全过** | **漏** |

两个漏掉的变异都有实际意义：

- **M6 最严重**：删掉 `row.quantity = rounded` 后，Worker 仍然产生 `ROUNDED_DECIMAL_QUANTITY` 告警、`parserErrors` 仍为空、9 条测试全绿——但发给 Django 的 quantity 还是 1.5，后端 `_normalize_row` 的 `isinstance(raw, int)` 会整批拒绝，**修复完全失效而测试察觉不到**。根因是 9 条测试全部只断言 `parserErrors` / `parserWarnings`，没有一条断言真正发给后端的分片行里 quantity 是什么。建议补一条：拦截 PUT chunk，断言 `rows[0].quantity === 2` 且 `Number.isInteger` 为真。（我的 `verify-staged-payload.ts` 可直接参考。）
- **M5**：把 `quantity` 放回 `integerFields` 后，由于 `normalizeQuantity` 已先把 1.5 改写成 2，后续 `Number.isSafeInteger(2)` 通过，不产生错误。所以 M5 其实是等价变异（行为确实没变），**漏掉它无害**，不必补。但它说明 `integerFields` 里是否含 `quantity` 已不影响行为，移除它更多是意图表达而非功能必需。

### 3.3 负小数复用 `INVALID_INTEGER` 错误码，下游无法区分新口径

负小数阻断沿用了 `code: "INVALID_INTEGER"`，只改了 message。好处是对已有消费者零影响；代价是任何按 code 聚合的监控都无法把「负小数」这个新引入的独立拒绝原因与原有的「非安全整数」分开。建议改为独立 code（如 `NEGATIVE_DECIMAL_QUANTITY`），后端 `sanitize_issues` 对 code 是透传的，不需要后端配合。属口径选择，不阻断合并。

### 3.4 四舍五入到 0 会产出 `quantity=0`，绕过解析阶段「数量必须非零」的既有契约

实测（`verify-staged-payload.ts`）：输入 `0.4` → 告警后落库 `quantity=0`；`1e-7` 同理。

而解析阶段 `requiredNumber`（`lib/imports/sales-ledger.ts:558-565`）对**原始**的 0 是明确拒绝的：`if (parsed === null || parsed === 0)` 推 `INVALID_NUMBER`「数量必须是非零有效数字」。也就是说源表直接写 0 会被拒，但写 0.4 反而能变成 0 混进去——新路径绕过了既有契约。

下游确实有处理 0 的分支（`backend/products/combinations.py:133` 的 `if count or not line["quantity"]` 明确「Preserve zero-quantity adjustment amounts」；`models.py` 的 `is_net_quantity_row` 与 `businessType="zero"` 也存在），所以不会崩，但 `quantity=0` 原本是给补差价类调整行准备的语义，让一个录入错误的 0.4 变成它并不干净。

真实数据中 `0 < |q| < 0.5` 目前是 0 行（两份文件都没有），所以不是现网问题。建议把「四舍五入结果为 0」单独阻断或单独告警，与 `requiredNumber` 的既有契约保持一致。

### 3.5 `totals` 的 `quantity` 保留小数原值，与落库行的整数和不一致

`sourceTotals` 由解析阶段 `calculateTotals` 算出，用的是**改写前**的 1.5，所以 11012 文件的 `totals.quantity = 178151.5`；而落库 39081 行的 quantity 之和是 178152，差 0.5。

这不是 bug——保留来源原值符合规范第 11 条「保留原值并告警，不得截断」的取向，而且后端 `_stored_totals` 会用落库行重算并覆盖 `quantity` 键（`write_service.py:1626-1666`，`totals = dict(source_totals)` 后 `totals.update({"quantity": 0, ...})` 再逐行累加整数），所以最终存储的 totals 是整数口径、自洽的。`_canonical_value` 也允许 float（`write_service.py` 中 float 分支只拒非有限值），不会报错。

需要留意的只有一点：`sourceTotals` 原样存入 `session.source_totals`，且 `init` 的重复判定会对它做 `_canonical_json` 比较（`write_service.py:1250-1251`）。同一文件重传时 1.5 稳定复现，比较仍然稳定。建议在实现注释里写明「sourceTotals 故意保留小数原值，后端会重算覆盖」，避免后来人误以为是漏改。

---

## 四、待确认

### 4.1 四舍五入是否需要同时修正金额一致性（请用户确认口径）

第 2492 行 quantity 从 1.5 改成 2，但 `allocatedAmountCents`、`costAmountCents`、`grossProfitCents` 全部保持原值不动。于是该行的「分摊后金额 = 分摊后单价 × 数量」「毛利 = 金额 − 成本 − 费用」在改写后更不成立了。

- 解析阶段的 `ALLOCATED_AMOUNT_MISMATCH` 公式告警是在改写**之前**算的（`parseSalesLedgerXlsx` 内，`import-service.ts:366` 调用），所以改写造成的新偏差不会产生告警
- 单价 × 数量的口径偏差只影响该 1 行，金额本身未被改写，营收/毛利汇总不受影响（金额是独立列，不由数量推导）
- 下游 `backend/sales/write_service.py:1540` 的零成本清洗用 `unit_cost * int(row["quantity"])` 重算成本——若该行恰好是零成本行，会按 2 而不是 1.5 算成本，这反而是整数口径更自洽

倾向判断：保持现状（只改数量、不动金额）是对的，因为金额是源表权威值、数量才是录入错误。但这意味着该行「数量 × 单价 ≠ 金额」，若用户的经营分析里有按此交叉核验的口径，需要知情。建议向用户明确：**四舍五入只纠正数量，不联动金额；该行的单价×数量口径会有 0.5 件的偏差。**

### 4.2 是否需要把 quantity 的容错同步到其他导入链路

本次只改销售表。`docs/规范/导入与自动化.md` 第 30 条要求「调整白名单或排除仓时要同步领域查询与测试，不能只改某一条导入链路」——该条文面针对白名单，不直接覆盖本次。但同一来源系统（吉客云）的其他四表若也可能出现小数数量，口径应当一致。库存表（`lib/imports/inventory-stock.ts` 的 `optionalQuantity`）已有自己的结论（只阻断负小数），库龄表在另一分支处理中。建议确认五表口径是否需要统一收口，或明确「各表按自身业务语义分别决策」。

---

## 五、合并结论

**可以合并。** 核心修复正确、范围干净、对已成功批次零影响、负整数退货单经 30007 个输入的差分扫描确认逐字节等价、191 条销售回归全绿。

但建议**先修 2.1（告警预算）再合**，理由：
1. 这是同一模式连续第三次在告警预算上出问题，当前实现并未真正解决它声称解决的问题（真实基数 119 条下预留量为负）
2. 改动很小（约 5 行），风险低，且实现者的测试 9 只需把构造行改成触发公式告警即可覆盖
3. 另建议顺带补 3.2 的 M6 测试（断言落库分片里 quantity 是整数 2）——这是当前测试集最大的盲点，它漏过的变异会让整个修复静默失效

若用户希望尽快恢复 10-27 的导入（当前只有 1 行小数、`parsed.warnings` 119 条、预算余量 80，**现网场景不触发 2.1**），则按原样合并也不会出问题，2.1 与 3.x 可作为紧随其后的收口项。这个选择权在用户。

本次审查未修改任何文件，未提交、未推送、未发版。

---

## 附录：全量回归失败的归因（报告正文交付后补充）

`npm run test:unit` 全量结果为 pass 4257 / fail 42 / cancelled 10 / skipped 22。这 42 条已归因为**与本次改动无关**，依据如下。

### 结构性证据（决定性，不依赖任何一次跑测）

- `lib/sales/import-service.ts` 的导出面与基线 `b15bc095` **逐符号完全一致**：`isXlsxSignature`、`XLSX_CONTENT_TYPE`、`MAX_SALES_IMPORT_RANGE_DAYS`、`MAX_SALES_IMPORT_CHANNELS`、`validateSalesImportChannels`、`validateSalesImportDateRange`、`importSalesLedgerBytes`、`SalesImportExecution`
- 三个共享导出的函数体 SHA-256 **逐字节相同**：`isXlsxSignature` = `2372cca2…`、`validateSalesImportDateRange` = `d5ab8a3b…`、`validateSalesImportChannels` = `23b951dd…`
- 实际改动的 `validateRows` 与新增 `normalizeQuantity` 均为 **module-local（非 export）**，唯一调用点在 `importSalesLedgerBytes` 内部
- 跨域 importer 只取未变更的符号：`lib/erp-reference/import-service.ts`、`lib/inventory/import-service.ts`、`lib/inventory/django-age-import-service.ts` 三者**只 import `isXlsxSignature`**；`lib/sales/chunked-upload.ts` 只 import `SalesImportExecution` 这个 type

结论：库存表、库龄表、ERP 参考表三条导入链路从本模块取得的内容逐字节未变，**本次改动在编译期即不可能影响它们**。

### 跑测证据（辅证）

- 基线对照：未改动的 main（313c8d35）跑同一条全量命令得 pass 4219 / **fail 60** / cancelled 20，失败数多于分支的 42
- 基线 80 条失败名的性质：PowerShell/pwsh 托管进程、workerd supervisor 就绪超时、真实 Chromium/浏览器集成、cmd.exe 启动器、Django 部署并发等环境依赖类，**无一条属于销售导入数量路径**
- 诚实说明一个方法缺陷：我最初把基线与分支两个全量跑并发了，造成资源争抢——分支那一轮在 03:15 卡死，基线的 60 条里也必然含被争抢放大的超时。**因此 60 vs 42 这两个数不可直接比较**，不作为主证据使用，仅作辅证；归因成立依靠的是上面的结构性证据
- 依赖方测试全绿：所有 import 被改模块的测试文件单独跑均通过——`tests/sales-*.test.ts` 191/191，`fourth-batch-customer-finance-safety` + `import-content-dedup-contract` 38 tests / 25 pass / 0 fail / 13 skipped（跳过为环境门控）
- `tests/business-sales-options.test.ts` 的 "actual Python contract SHA and Unicode exact identities match TS" 已在 main 基线复现同一条失败，属既有基线失败

### 对合并结论的影响

无。正文「可以合并、建议先修 2.1」的结论依赖的是 191 条销售回归 + 依赖模块测试全绿 + 两份真实文件验证，均已完成；现在可进一步确认本次改动对销售导入以外的链路在编译期即无影响。

### 补充：分支单独全量跑完后的逐条名单对比（归因收尾）

重新单独跑的分支全量（无并发争抢）：pass 4259 / **fail 40** / cancelled 11 / skipped 22。与基线名单逐条 `comm` 对比，仅 7 条「只在分支出现」：

```
a cancelled old detail denial cannot clear the restored scope's new successful rows
an accepted detail save finishing under a new identity cannot overwrite its rows or reopen its detail
an accepted save may finish after leaving customer view without refreshing the unmounted instance
detail hides old periods synchronously, rejects late/error responses and recovers
failed customer scope cannot revive prior rows when returning to the previous filter
same-range refresh reads detail, retains success on failure and enforces source version
web-session export uses the original enabled handler exactly once and never opens a context menu
```

这 7 条分属 `tests/customer-service-read-scope.test.ts`、`tests/jackyun-web-session-export.test.ts`、`tests/product-detail-performance.test.ts`——均与销售导入无关（客服读取域、吉客云网页会话导出、商品详情性能）。

双向隔离验证（决定性）：

| 这三个文件单独跑 | 结果 |
|---|---|
| 基线 main（313c8d35） | 22 tests / **22 pass / 0 fail** |
| 分支 1474afad | 22 tests / **22 pass / 0 fail** |

两边都全绿。且全量日志里这 7 条的失败原因是 `test timed out after 30000ms` / `after 60000ms`，是**超时而非断言失败**。

结论：这 7 条是全量负载下的 flaky 超时（它们在基线名单中缺席，是因为基线那轮争抢时它们落入 cancelled 20），**不是本次改动引入的回归**。归因完毕，正文结论不变。
