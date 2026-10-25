# STEP4 独立审查：库存小数容错改动

- 审查者：独立审查代理（未参与实现），只读审查
- 被审对象：worktree `D:\codex-worktrees\inventory-decimal-tolerance`，分支 `codex/inventory-decimal-tolerance`，commit `73403c1d`
- 基线：origin/main `36668589`
- 改动文件：`lib/imports/inventory-stock.ts`（+48/-11）、`lib/inventory/django-import-service.ts`（+2）、`tests/inventory-stock-decimal-quantity.test.ts`（新增 126 行 / 8 测试）
- 验证环境：`D:\codex-artifacts\review-decimal-20261025\`（隔离目录，未改动任何仓库文件）
- 参照规范：`AGENTS.md`、`docs/规范/导入与自动化.md`、`docs/规范/业务口径.md`

> **当前状态（2026-10-25）**：本文前十节为首轮审查（commit `73403c1d`），其中 M1、M2 已在 `51f411de` 修复，
> 首轮“不能直接合并”的结论**已被取代**。另需注意：首轮 M1 建议的“负数一律阻断”修法**经真实文件回归证伪**
> （真实文件有 2356 个合法负整数单元格会被误拦），最终采用的收窄规则见增量复审。
> 最新结论见文末“增量复审（51f411de）”一节。

## 结论速览（首轮，已被增量复审取代）

| 分类 | 条数 |
| --- | --- |
| 确认正确 | 7 |
| 必须修 | 2 |
| 建议改 | 4 |
| 待确认 | 3 |

**合并结论：改完能合并。** 当前状态下**不能**直接合并，缺两处：数量字段负小数的静默取整（M1）、以及 `-0` 作为入库值进入事实集合（M2）。两处都只需几行改动，不需要重新设计。

---

## 一、确认正确

| 编号 | 确认项 | 核对证据 |
| --- | --- | --- |
| C1 | 放宽范围**确实只限 6 个数量类字段** | 逐行比对 `git show HEAD`：`optionalInteger` → `optionalQuantity` 的替换只发生在 `lockedQuantity`、`inTransitQuantity`、`onHandQuantity`、`availableQuantity`（第 301-304 行）和 `sales7dQuantity`、`sales30dQuantity`（第 333-334 行）共 6 处，无遗漏无多余 |
| C2 | 成本价/库龄/日期**完全未改** | `optionalMoneyCents`（415-430 行）、`optionalDays`（432-446 行）、`normalizeSalesLedgerDate` 调用（315 行）在差异中无任何变化；`optionalDays` 仍为 `Math.floor` + `Number.isSafeInteger`，`optionalMoneyCents` 仍为 `Math.round(x*100)` + 非负检查。实测 `固定成本价=25.5` → `unitCostCents=2550` 零 warning，`固定成本价="abc"` → `INVALID_NUMBER/unitCost` 阻断 |
| C3 | 旧函数名无残留引用 | `grep -rn "optionalInteger" lib/ tests/` 只命中 `lib/imports/erp-reference.ts`（库龄/ERP 参考域的同名私有函数，与本改动无关），`inventory-stock.ts` 内已无残留 |
| C4 | 非数字、NaN/Infinity、超安全整数范围**仍阻断** | 实测：`"abc"` → `INVALID_NUMBER`；`1e21` → `INVALID_NUMBER`；`9007199254740992.5`（取整后超安全范围）→ `INVALID_NUMBER`。第 402-405 行对 `Math.round` 结果二次做 `Number.isSafeInteger` 检查，这一层是正确的 |
| C5 | 整批拒绝逻辑本身未被削弱 | `django-import-service.ts:158-162` 的 `parseErrors.length > 0 → reject` 原样保留；零行失败关闭（`:159` 的 `NO_DATA_ROWS`）、质量门禁（`:183`）、重复身份（`:190`）、多快照日期（`:194`）全部未改。符合规范"零行必须失败关闭" |
| C6 | warning 通道**真的能传到最终导入结果**，不被吞掉 | 完整追链：解析层 `parsed.warnings` → `django-import-service.ts:209-211` 并入 `warnings` → `:240` 进入 POST payload → Django `import_service.py:321` `_warnings()` 校验 → `:757-758` 落 `warning_count` + `warnings_json` → `:881` 随 `status=imported` 回执返回 → `_batch_payload()` `:468-469` 暴露 `warningCount`/`warnings` → 前端 `app/import-module-view.tsx:304-307` 以"导入完成，含 N 条提示"展示。`backend/inventory/models.py:104-105` 确认 `warning_count`/`warnings_json` 为持久字段。审计/回执链路完整 |
| C7 | 真实故障文件数字可复算，与主代理一致 | 直接解析原始 XLSX：rows **26452**、errors **51**（全为 `MISSING_VALUE/unitCost`）、warnings **2** 条（均 `ROUNDED_DECIMAL_QUANTITY`，onHand/avail 各 1，均为第 1928 行）、第 1928 行入库 **3326/3326**、其他行产生 warning **0** 条。与主代理给出的数字完全吻合 |

### C7 补充：真实生产链路的数字与"裸解析"不同（重要上下文）

主代理的 26451→26452 是**直接解析原始文件**的结果。实际 n8n 五表链路会先过 `lib/jackyun/post-download.ts` 的 `prepareJackyunWorkbook` 预处理。实测该路径：

| 口径 | rowCount | parseErrors | warnings |
| --- | --- | --- | --- |
| 原始文件裸解析（改后） | 26452 | 51（unitCost 缺失） | 2 |
| 真实链路 `importBytes`（改后） | **24476** | **0** | **2** |

预处理已剔除：刷刷仓 1888 行、无效成本 46 行、异常货值 74 行、负数量 19 行。所以生产链路里那 51 条 `MISSING_VALUE/unitCost` 根本不会出现，小数行在预处理后位于第 1735 行。

**基线对照已复算**：对同一份 `importBytes`，基线 `optionalInteger` 会产生 **2** 个 `INVALID_NUMBER` 小数单元格（1 行），`parseErrors>0` → 整批拒绝、当日零批次。这与 10-24 故障现象一致，**故障归因成立**，修复方向对症。

---

## 二、必须修（阻断性）

### M1：`onHandQuantity` / `availableQuantity` / 销量的**负小数被静默取整通过**，且 `Math.round` 对负数偏向零

这是本次审查最严重的发现，主代理的担心是对的，而且比预想的更广。

`optionalQuantity` 第 391 行：

```ts
if (parsed === null || !Number.isFinite(parsed) || (nonNegative && parsed < 0)) {
```

`nonNegative` 只对 `lockedQuantity` / `inTransitQuantity` 传 `true`。`onHandQuantity` / `availableQuantity` / `sales7dQuantity` / `sales30dQuantity` **不传**，所以负小数直接走到 `Math.round`。

实测（隔离环境，改后代码）：

| 输入 | 字段 | 结果 | 入库值 | warning | 评价 |
| --- | --- | --- | --- | --- | --- |
| `-3.5` | onHandQuantity | 通过 | **-3** | 有 | 绝对值被**缩小** 0.5 |
| `-3.4` | onHandQuantity | 通过 | -3 | 有 | 正常就近 |
| `-3.6` | onHandQuantity | 通过 | -4 | 有 | 正常就近 |
| `-2.5` | availableQuantity | 通过 | **-2** | 有 | 绝对值被缩小 |
| `-1.5` | sales7dQuantity | 通过 | **-1** | 有 | 绝对值被缩小 |
| `-0.4` | onHandQuantity | 通过 | **-0** | 有 | 见 M2 |
| `-0.5` | onHandQuantity | 通过 | **-0** | 有 | 见 M2 |
| `-0.4` | lockedQuantity | **阻断** | — | — | `nonNegative=true` 生效，正确 |

两个独立问题叠在一起：

**(a) `Math.round` 的负数方向不对称。** JS 的 `Math.round` 是"向 +∞ 就近取整"，不是"远离零就近取整"。`Math.round(3.5)=4`（绝对值变大），`Math.round(-3.5)=-3`（绝对值变小）。库存/销量是**有符号业务量**，同一个"半单位"在正负两侧得到相反的处理方向。对负库存（欠货/超卖）而言，`-3.5 → -3` 等于**少报了 0.5 个单位的欠货**，方向上偏乐观。这会直接进入备货计划：按 `docs/规范/业务口径.md` 第 20 条，"负可用库存可能形成补货缺口"，缺口公式 `max(0, ceil(30日销量/30×周期 − 可用库存 − 采购在途 − 调拨在途))` 里 `可用库存` 取负会放大建议量，取整方向偏乐观则**系统性少建议补货**。

**(b) 负数本身该不该静默通过，没有被这次改动表态。** 基线 `Number.isSafeInteger(-5)` 为 `true`，所以**整数负库存在基线就是通过解析层的**（改动没有引入这个口子，这点要公允）。真实文件里非刷刷仓负库存有 19 行，全部被 `post-download.ts` 的 `excludedNegativeQuantityRows` 预处理剔除，所以当前生产链路看不到。但解析层是**公共入口**：`app/api/imports/inventory/route.ts`（管理员直传）和 `chunks/route.ts`（分片上传）都不经过 jackyun 预处理。走这两条路的负小数，就只剩 `validateInventoryImportRows` 的 `NEGATIVE_INVENTORY_NOT_ALLOWED` 兜底。

实测兜底的有效性：

| 输入 | 入库值 | `allowNegativeInventory=false` | `allowNegativeInventory=true` |
| --- | --- | --- | --- |
| `-3.5` | -3 | `NEGATIVE_INVENTORY_NOT_ALLOWED` 阻断 | **放行，-3 入库** |
| `-3.6` | -4 | 阻断 | 放行，-4 入库 |
| `-0.4` | **-0** | **不阻断**（`-0 < 0` 为 false） | 不阻断 |
| `-0.5` | **-0** | **不阻断** | 不阻断 |

`allow_negative_inventory` 默认为 `False`（`backend/inventory/models.py:479`），所以**默认配置下 (a) 的风险被下游质量门禁挡住**。但这是巧合式的防御，不是设计：一旦管理员打开负库存开关（这是个受支持的业务设置），带偏差的取整值就直接落 `BigIntegerField`。而 `-0.4`/`-0.5` 这一档**在任何配置下都穿透**。

**触发条件**：吉客云或人工上传的库存文件中，`库存数量`/`可用库存`/`前7天销量`/`前30天销量` 出现负小数。销量字段尤其值得注意：它没有任何下游负值门禁（`validateInventoryImportRows` 不检查销量符号，Django `_stock_row` 的销量下界是 `-MAX_ABSOLUTE_QUANTITY`），所以**负小数销量在任何配置下都会带着取整偏差静默入库**。实测 `sales7d=-1.5 → -1`，零阻断。

**影响**：库存和销量事实带方向性偏差；按业务口径第 20/21 条，这些值直接驱动补货建议量与库存健康判定（缺货/低周转）。规范第 35 条"未经用户明确授权不改写业务数据"的精神是不应静默改变业务量，这里改变了且方向不中立。

**建议改法**（二选一，推荐前者）：

1. **数量字段全部按非负处理**：给 `onHandQuantity`/`availableQuantity` 也传 `nonNegative=true`，负值回到阻断。代价：会把基线放行的整数负库存也变成阻断，属于行为收紧，需确认（见 Q1）。
2. **保留负值但改取整函数**：把 `Math.round(parsed)` 换成远离零的对称就近取整，例如 `Math.sign(parsed) * Math.round(Math.abs(parsed))`，使 `-3.5 → -4`、`3.5 → 4` 方向一致；同时对负值单独产生一条区分度更高的 warning。这保持与基线一致的"负整数可通过"，只修取整方向。

无论选哪个，`sales7dQuantity`/`sales30dQuantity` 的负小数都应单独表态——销量按业务口径"必须明确是正向销量、退货量还是净销量"，吉客云这两列是正向销量列，出现负值本身就是来源异常，静默取整并不合适。

### M2：`-0` 作为入库值进入事实集合与内容指纹

`Math.round(-0.4)` 和 `Math.round(-0.5)` 在 JS 中返回 **`-0`**（负零），不是 `0`。实测 `Object.is(row.onHandQuantity, -0) === true`。

后果链条：

| 环节 | `-0` 的表现 | 风险 |
| --- | --- | --- |
| `validateInventoryImportRows` | `-0 < 0` 为 `false` → **不触发** `NEGATIVE_INVENTORY_NOT_ALLOWED` | 负值门禁被绕过 |
| `JSON.stringify` | 序列化为 `0`（实测 `{"q":0}`） | 传输时静默变成正零 |
| Django `_integer` | 收到 `0`，通过 | 落库为 0 |
| 规范化内容指纹 `_content_hash` | 基于 `_canonical()`（`json.dumps`）计算 | 指纹层面与 `0` **不可区分** |

单看落库结果，`-0 → 0` 是无害的（库存 0 和 -0 业务上同义）。真正的问题是**它让负值门禁在 `(-0.5, 0)` 区间失效**：一个来源值为 `-0.5` 的异常单元格，既不被解析层拦（不是 `nonNegative`），也不被质量门禁拦（`-0 < 0` 为假），warning 里虽记录了原值 `-0.5`，但事实集合里只剩 `0`，看起来和一个正常的零库存完全一样。这是**静默吞掉一个负值信号**，与规范"保留原值并告警"的意图相悖——原值进了 warning，但被告警的那个异常**没有被挡下也没有在事实里留下痕迹**。

**触发条件**：任一数量字段出现 `(-0.5, 0)` 区间的负小数（含 `-0.5`）。

**影响**：负库存门禁存在一个确定的盲区；M1 修法 1 若只加 `nonNegative=true` 则顺带修掉，修法 2 需单独处理。

**建议改法**：取整后做 `+ 0` 规范化（`const rounded = Math.round(parsed) + 0;` 不行，`-0 + 0 === -0`；应用 `Object.is(r, -0) ? 0 : r`，或直接 `r === 0 ? 0 : r`），并确保负值判断发生在规范化**之前**（即对 `parsed` 而非 `rounded` 判负），这样 `-0.5` 会按负值走它该走的路径。

---

## 三、建议改（非阻断）

### S1：warning 条数无上限，极端情况会把"整批拒绝"换成"整批 400"

`optionalQuantity` **每个小数单元格**产生 1 条 warning，单行最多 6 条（实测确认）。解析层没有 warning 上限（对比：errors 有 `if (errors.length >= 200) break;`），`django-import-service.ts:240` 传 `warnings` 时**没有 `.slice(0, 200)`**。对比同文件：`parseErrors` 在 `:158` 有 slice，reject 路径的 warnings 在 `:138` 有 slice，唯独成功路径这条没有。

Django `import_service.py:143` 的 `_warnings()`：`len(value) > MAX_WARNINGS(200)` 时 `raise _error("warnings 无效")`，HTTP 400，整批失败。

实测临界点：

| 带小数的行数（每行 6 字段） | 解析 warning 数 | 加固定 warning | Django 校验 |
| --- | --- | --- | --- |
| 33 | 198 | 202 | **拒绝（400）** |
| 34 | 204 | 208 | 拒绝 |
| 100 | 600 | 604 | 拒绝 |

本轮真实文件余量充足：固定 warning 5 条加小数 2 条等于 7 条，距 200 上限还有 193 条。但这意味着**只要约 33 行同时出现多字段小数，或约 195 行各出现 1 个小数，导入就会从"因小数被拒"变成"因 warning 太多被拒"**。故障模式换了个名字，根因没解。考虑到小数行数从 10-05 到 10-22 是 0、10-23 突然出现 1 行，来源系统的行为正在变化，不能假定它会一直停在 1 行。

建议：解析层对 ROUNDED_DECIMAL_QUANTITY 设上限（如前 50 条明细加 1 条汇总"另有 N 处小数已四舍五入"），或在 `django-import-service.ts:240` 按 200 截断并补一条汇总条目。注意：规范第 9 条要求导入保留"告警"，截断明细时必须保留**总条数**，否则就成了规范禁止的那种信息丢失。

### S2：availableQuantity 推导发生在取整之后

第 306-311 行的 `availableQuantity = onHandQuantity - lockedQuantity` 推导用的是已取整的值。当报表只有"库存数量"没有"可用库存"时，`10.5` 取整为 `11`、`locked 0.5` 取整为 `1`（各 1 条 warning），推导得 `available = 10`；按原值推导应是 `10.5 - 0.5 = 10.0`，恰好相同。但 `10.5 - 0.4` 这类组合会产生 `11 - 0 = 11`，而真值为 `10.1`。误差最大可达 1 个单位，且**不产生额外 warning**（推导出的 `availableQuantity` 没有自己的 warning）。真实文件同时有两列，不触发此路径。建议在推导分支补一条说明，或改为按原值推导后再取整。

### S3：销量字段与库存字段用了同一套规则，但业务含义不同

`sales7dQuantity` / `sales30dQuantity` 是销售出库件数。按业务口径第 22 条"3日和15日销量仅取来源快照的同名销售出库件数原始列，缺失保留未知，不从7日或30日折算"，该条强调销量列的原始性。销量出现小数更可能是来源折算或单位错误（销量天然是整数笔数），而库存小数还有拆零库存这种合理解释。把两者用同一条 `Math.round` 规则处理，丢掉了这个区分。建议：销量字段的小数按阻断处理（恢复 `optionalInteger` 语义），或至少给一个独立 warning code 便于区分追溯。

### S4：测试缺少关键边界

8 个测试全部通过，但没有一个覆盖 M1 / M2。详见第七节。

---

## 四、规范解读：四舍五入算不算"不得截断"

主代理问的是 `docs/规范/导入与自动化.md` 第 11 条：

> 负值和超过 100% 的比率保留原值并告警，不得截断。

**我的解读：该条款不直接管库存数量，但它表达的原则适用，而当前实现只满足了一半。**

| 维度 | 分析 |
| --- | --- |
| **条款适用范围** | 该句位于"SKU 快递费率导入"这一条内，上下文全部是 `SKU累计` 工作表、B/M/Z/AA 列、`Z / M` 重算费率。它是**费率字段的专项条款**，不是全库导入的通则。按字面不能直接判库存数量违规 |
| **"截断"的所指** | 在原文语境里，截断指把超范围值**夹到边界**（如把 150% 的费率改成 100%）从而丢失异常信号。库存的 `Math.round` 不是夹边界，是就近取整，严格说不是同一动作 |
| **条款的立法意图** | 核心是两句话的组合：**保留原值加告警**，目的是让异常数据既不阻断全批、也不被静默改成看似正常的值。这个意图对任何数值字段都成立 |
| **当前实现对意图的满足度** | 告警：**满足**（warning 含字段、行号、原值、取整后值，且实测贯通到审计和回执）。保留原值：**只满足在 warning 里，没有满足在事实里**。事实集合中只有 3326，原值 3325.5 不在任何可查询的事实字段中，只在 `warnings_json` 这个非结构化 JSON 里 |
| **更贴近的条款** | `AGENTS.md` 第 3 条"保护原有功能…只做本需求所需的修复"，以及导入规范第 35 条"未经用户明确授权，不删除、改写或重新导入业务数据"。四舍五入是对业务量的**改写**。但它是在"改写 1 个单元格"与"丢弃 26451 行"之间取舍，有授权链路（本任务）和完整告警，**我认为这个取舍本身是正当的** |

**结论**：四舍五入**不构成对第 11 条"不得截断"的违反**（该条管费率，且动作不同）。warning 保留原值**基本满足**规范的告警要求，并且已验证能传到审计和回执。

有一个口径不一致值得指出：第 11 条对费率的做法是"保留原值并告警"，即异常值原样入库、不改数。库存这里选的是"改数加告警"。两者是不同策略。规范没有要求库存必须和费率一致：库存落 `BigIntegerField`（`backend/inventory/models.py:135-136` 已确认），`import_service.py:207-208` 用 `int()` 转换，物理上存不了小数，所以"原样入库"对库存不可行。**在"必须取整"这个物理约束下，取整加告警是规范允许的做法。** 这点我认同实现者的判断。

真正的规范风险不在"是否取整"，而在 M1 的**取整方向不中立**：把 `-3.5` 变成 `-3` 是向"情况更好"的方向改写业务数据，这比对称取整更难用技术约束来辩护。

---

## 五、业务含义评估：三种成因下四舍五入是否可接受

| 成因 | 四舍五入是否可接受 | 理由 |
| --- | --- | --- |
| **(a) 吉客云单位换算问题**（按 kg 记但单位写 PCS） | **不可接受，且比阻断更危险** | 若 3325.5 其实是 3325.5 kg 而非 3325.5 件，那么整个数量的**量纲**是错的。取整成 3326 件只是把一个错误值变成一个"看起来合法"的错误值。后续它会进入库存货值（`availableQuantity × unitCostCents`）、30 天销量比对、补货建议量，污染面远超这一行。主代理的判断成立 |
| **(b) 真实拆零库存** | **可接受** | 物理模型（`BigIntegerField`）不支持小数，取整是唯一出路；误差不超过 0.5 单位，有 warning 留痕。这是最可能的真实成因 |
| **(c) 数据录入错误** | **勉强可接受** | 单个单元格误差不超过 0.5，有 warning 可追溯并人工复核。比整批拒绝 26451 行更合理 |

**关于 (a) 能否被当前实现识别：不能。** 我查了解析层，`headerAliases`（第 141-159 行）**没有"单位"这个 canonical header**，该列完全不被读取。实测真实文件表头确实含"单位"列（第 4 列），但解析器看不见它。所以当前实现**没有任何机制区分 (a) 和 (b)**。

这个风险的实际严重性要打折扣，有两道已存在的防线：

1. `validateInventoryImportRows` 的 `IMPLAUSIBLE_INVENTORY_QUANTITY`（单行数量超过 1000 万）和 `IMPLAUSIBLE_ROW_STOCK_VALUE`（单行货值超过 10 亿）会拦住量纲错到数量级的情况；
2. `post-download.ts` 的 `excludedImplausibleValueRows`（实测本轮剔除 74 行）在预处理阶段就清掉货值异常行。

量纲错 0.5 个单位（kg 与 PCS 对同一货品可能只差百分之几）这些门禁拦不住，但那种程度的偏差本身也在业务噪声范围内。

**我的评估**：应该区分对待，但不必在本次改动里做。当前做法（统一 Math.round 加 warning）是合理取舍，前提是 M1 的方向问题修掉，且 warning 真的会被人看到（C6 已验证会）。把"单位"纳入解析并对 PCS 单位的小数单独告警，属于独立改进（见 Q3）。

---

## 六、rowCount 26451 到 26452 对内容指纹与重复判定的影响

**结论：不会导致重复导入，也不会与已有批次冲突。安全。**

逐条核对 `backend/inventory/import_service.py`：

| 机制 | 代码位置 | 对本改动的影响 |
| --- | --- | --- |
| 业务内容指纹 | `_business_content_hash()` 332-344 行 | 由 version 加 scope(dataset,snapshotDate) 加 `len(business_rows)` 加排序后的逐行 SHA 组成。行数与行内容都变了（多 1 行、该行数量 3326），**指纹必然变化** |
| 指纹排除的字段 | `_content_hash()` 346-357 行 | 显式 `pop("sourceRowNumber")` 和 `pop("rowKey")`。符合规范第 10 条"原始行号…等非业务差异不得触发新导入"。所以 rowCount 变化**不是**靠行号驱动的，是靠真实业务行数 |
| 重复判定 | 659-677 行 | 按 `dataset` 加 `snapshot_date` 加 `status=completed` 加 `content_hash` 加 `row_count` 查 `existing`。新指纹查不到旧批次，走正常导入路径，**不会被误判为 duplicate** |
| 规范要求 | 导入规范第 10 条 | "通过校验的权威业务集合中任一业务字段、业务行数或业务范围变化都必须创建新批次"。本改动使行数与基线不同，**按规范就应该创建新批次**，当前行为与规范一致 |
| 与已有批次冲突 | 671-677 行 | `existing_owned_rows not in {0, len(rows)}` 触发 409；`existing_owned_rows == len(rows)` 且 hash 不等触发 409。这些检查针对**同指纹批次的事实完整性**，新指纹不进入这些分支 |
| 原子替换 | 828 行 `InventoryStockLine.objects.filter(snapshot_date=snapshot_date).delete()` | 同快照日全量替换，不会残留旧行。符合规范第 12 条 |
| 落库回查 | 830-833 行 | `inserted != len(rows)` 触发 503；`readback_count` 或 `readback_hash` 不符触发 503。符合规范第 9 条"返回成功前做落库回查" |

关键点：**基线那天根本没有产生任何批次**（整批拒绝），所以不存在"同一天数据被判为内容变化而重复导入"的场景，没有旧批次可冲突。即使假设历史上有一个 26451 行的批次，新的行数与指纹不同，按规范也**应当**创建新批次并原子替换同快照日事实，这是正确行为而非缺陷。

另外确认 `tools/jackyun-n8n-pipeline.ts:447` 的 C 节点交叉核验会校验 `result.warningCount === batchWarningCount`，新增的 2 条 warning 会被一并核对，不会造成证据不一致。

---

## 七、测试质量评估

实测运行 `npx tsx --test tests/inventory-stock-decimal-quantity.test.ts`，结果 **8 pass / 0 fail**。既有回归 `tests/jackyun-post-download.test.ts` 加 `tests/warehouse-mapping-settings.test.ts`，结果 **27 pass / 0 fail**，无回归。

| 编号 | 测试 | 覆盖 | 断言严格度 | 评价 |
| --- | --- | --- | --- | --- |
| 1 | 小数四舍五入加 warning | 正小数 10.5 / 9.5 | **严格**：断言 errors 为空数组、warning 条数为 2、code、sourceRowNumber、message 含原值与取整值 | 好。唯一检查了 warning 实际内容的测试 |
| 2 | 真实故障值 3325.5 | 真实值回归 | 中等：断言入库 3326、warning 字段集合 | 可以，但只断言 `fields.includes(...)`，没断言条数，多出一条也会通过 |
| 3 | 非数字 "abc" 阻断 | 非数字 | **严格**：rows 为 0、errors 为 1、code、field、warnings 为 0 | 好 |
| 4 | 负数加 nonNegative 阻断 | lockedQuantity 为 -1 | 严格，含 message 匹配"负数" | 好，但**只测了整数负数，没测负小数**，也**只测了 nonNegative 字段** |
| 5 | 超出安全整数范围 | MAX_SAFE_INTEGER 加 2 | 中等 | 可以。但这个输入是**整数**，走的是第 391 行的旧分支；没有测 `Math.round` 后越界的新分支（402-405 行），该分支实测有效但**无测试覆盖** |
| 6 | 整数输入行为不变 | 回归保护 | **严格**：`deepEqual(warnings, [])` | 好 |
| 7 | 成本价不受影响 | unitCost 25.5 与 "abc" | **严格** | 好。正面验证了 C2 |
| 8 | 销量小数容错 | 7.4 与 29.6 | 弱：只断言取整值和 `fields.includes` | 可以，但 7.4 与 29.6 都是**非 .5 值**，没测销量的 .5 舍入 |

对照主代理点名要查的三项：

| 主代理关注点 | 是否覆盖 | 说明 |
| --- | --- | --- |
| 有没有测负数小数 | **没有** | 测试 4 用的是整数 -1，且在 `nonNegative=true` 字段上。`onHandQuantity=-3.5` 这个 M1 的核心场景**零覆盖** |
| 有没有测 .5 的舍入方向 | **只测了正向** | 测试 1（10.5 到 11）、测试 2（3325.5 到 3326）都是正数。负向 .5（-3.5 到 -3，这是 bug）**零覆盖**。测试 2 的标题还写了"统一就近取整，.5 向上"，这个描述对负数**是错的**：-3.5 向上（向正无穷）得到 -3，绝对值反而变小。标题把一个不对称行为描述成了统一规则，容易误导后续维护者 |
| 有没有测 warning 的实际内容 | **测了，仅测试 1** | 测试 1 断言了 message 含原值和取整值、sourceRowNumber、code。这是唯一一处，其余测试只看 field。已足够证明 warning 内容正确，但不足以防止 message 格式回归 |

其他缺口：`-0` 场景（M2）、warning 条数上限（S1）、`availableQuantity` 推导分支（S2）、`Math.round` 后越界分支，以及通过 `importInventoryStockToDjango` 验证 warning 并入成功路径。本改动的第二个文件 `django-import-service.ts` 的 2 行**完全没有测试**，我是靠读代码加追 Django 侧确认的。

**总评**：测试对"已实现的 happy path 和旧阻断行为"覆盖扎实、断言大体严格，但它们只验证了实现者**设想中**的行为，没有一个测试去试探边界。M1 与 M2 两个问题都落在测试盲区里，这正是 8 个测试全绿却仍有阻断性缺陷的原因。

---

## 八、是否有更合适的做法

评估主代理提的几个替代方案：

| 方案 | 评价 |
| --- | --- |
| **只对"小数部分为 .5 且单位为 PCS"放宽** | **不推荐。** 过拟合到本次故障的单个样本。`.5` 只是 10-23 那一行恰好的形态，来源系统完全可能下次给出 `.33`（三等分拆零）或 `.25`。而且解析层目前不读"单位"列（见第五节），要实现"单位为 PCS"需要新增 header 识别，改动面反而比现在大。规则越窄，下次故障的概率越高 |
| **按字段区分：库存数可取整，销量不该取整** | **推荐，作为 S3。** 这个区分有业务依据（业务口径第 22 条强调销量列原始性；销量天然是整数笔数，小数几乎必然是来源异常）。实现成本低：给 `optionalQuantity` 加一个参数，或销量字段继续用原 `optionalInteger`。但它是改进而非阻断项 |
| **当前做法（统一 Math.round 加 warning）** | **方向正确，是合理取舍。** 在"物理模型只能存整数"的约束下，取整加完整告警既解决了"1 个单元格废掉 26451 行"的脆弱性，又保留了审计线索。规范上站得住（见第四节） |
| **我的建议** | 保持当前整体设计，修掉 M1（取整方向加负值表态）和 M2（`-0`），补 S1（warning 上限）。S3 可本次做也可后续做。不要走"只认 .5 加 PCS"那条路 |

一个额外的观察：实现者在 `optionalQuantity` 里把基线的 `!Number.isSafeInteger(parsed)` 换成了 `!Number.isFinite(parsed)`。这步是**必要且正确**的（否则小数会在第一个分支就被拦掉），而且 402-405 行补了取整后的安全整数二次检查，没有留下越界口子。实测 `1e21` 和 `9007199254740992.5` 都仍被阻断。这个改法比直接放宽 `isSafeInteger` 更严谨，值得肯定。

---

## 九、待确认（需用户或业务决定）

| 编号 | 待确认事项 | 为什么需要决定 |
| --- | --- | --- |
| Q1 | **数量字段的负小数应该阻断还是取整？** 若选阻断（M1 修法 1），`onHandQuantity` / `availableQuantity` 加 `nonNegative=true` 会把**基线放行的整数负库存也变成阻断**，这是行为收紧，可能影响 `allowNegativeInventory=true` 的业务场景。若选取整（修法 2），需确认 `-3.5` 应得 `-4`（远离零，偏保守）还是 `-3`（当前，偏乐观） | 涉及负库存业务口径与补货建议量方向，属业务判断，不应由代理替定 |
| Q2 | **销量字段出现小数时应阻断还是容错？** 销量是正向出库件数，小数几乎必然是来源折算或单位异常。容错会让异常数据静默入库并进入 30 天销量窗口与补货公式 | 业务口径第 22 条强调销量列原始性，但没明确小数情形 |
| Q3 | **是否需要识别"单位"列以区分量纲错误？** 当前解析层不读该列，无法区分"真实拆零"与"kg 当 PCS 记"。真实文件确实有这一列 | 属于新增能力，有成本；需用户判断量纲错误的实际发生概率是否值得 |

---

## 十、最终结论

**改完能合并。当前状态不能直接合并。**

整体方向正确：故障归因准确（已复算基线在同一份 `importBytes` 上确实产生 2 个 `INVALID_NUMBER` 并整批拒绝）；放宽范围严格限于 6 个数量类字段，成本价、库龄、日期零影响（逐字段核对加实测双重确认）；整批拒绝、零行失败关闭、质量门禁、原子替换、落库回查全部保留；warning 链路从解析层一直贯通到 Django 持久化、回执与前端展示；内容指纹与重复判定无风险；8 个新测试加 27 个既有回归全绿，无回归。

合并前必须处理两项：

| 编号 | 问题 | 最小改法 |
| --- | --- | --- |
| **M1** | `onHandQuantity` / `availableQuantity` / 两个销量字段的负小数被静默取整，且 `Math.round` 对负数偏向零（`-3.5` 得 `-3`，少报欠货）。默认 `allowNegativeInventory=false` 下库存字段有下游兜底，但**销量字段在任何配置下都穿透**，`allowNegativeInventory=true` 时库存字段也穿透 | 按 Q1 决定后，或给数量字段传 `nonNegative=true`，或改为对称就近取整 `Math.sign(x) * Math.round(Math.abs(x))` |
| **M2** | `Math.round(-0.4)` 与 `Math.round(-0.5)` 返回 `-0`，使 `-0 < 0` 为假，**绕过 `NEGATIVE_INVENTORY_NOT_ALLOWED` 门禁**（实测在 `allowNegativeInventory` 两种取值下均不触发）。`(-0.5, 0)` 区间的负值信号被静默吞掉 | 取整后规范化 `-0` 为 `0`，并确保负值判断基于 `parsed` 而非 `rounded` |

两处都是 `optionalQuantity` 内几行的改动，不需要重新设计。建议同时补上 S1（warning 上限，防止故障模式从"小数被拒"平移成"warning 超 200 被拒"），并为 M1 / M2 各补一个测试——现有 8 个测试全绿恰恰说明这两个缺陷位于测试盲区。S3（销量单独处理）和 Q1 至 Q3 可在本次或后续处理，不构成合并阻断。

---

## 附：审查方法与证据

- 只读审查，未修改 worktree 或主工作区任何文件；验证脚本全部位于 `D:\codex-artifacts\review-decimal-20261025\`
- 真实文件以只读方式解析，报告中不含货品名称、金额等业务明细
- 真实文件：`D:\谷歌浏览器\jackyun\n8n-export-first-11007\inventory\` 下单个 XLSX（3,017,381 字节）
- 验证脚本：`verify-neg.mts`（正负小数与边界矩阵）、`verify-cap.mts` / `verify-cap2.mts`（warning 条数上限）、`verify-real.mts`（真实文件裸解析）、`verify-pipeline.mts`（真实 jackyun 预处理链路）、`verify-baseline.mts`（基线行为复算）、`verify-gate.mts`（下游质量门禁与 `-0`）、`verify-fixedwarn.mts`（warning 余量）、`hdr2.mts`（真实表头与 coverage）
- 导入 .ts 统一使用 `pathToFileURL` 加 `npx tsx`（脚本用 `.mts` 扩展名以支持顶层 await）

---

# 增量复审（51f411de）

- 复审范围：只看新提交 `51f411de`，不重审 `73403c1d` 已确认正确的部分
- 改动范围已独立核实：`git diff $(git merge-base HEAD origin/main)..HEAD` 只含 4 个文件（`lib/imports/inventory-stock.ts`、`lib/inventory/django-import-service.ts`、2 个测试文件）。worker/ 下的差异来自 main 新提交 `525ad36b`，与本分支无关，不在复审范围
- 复审方法：差分等价性验证（基线 `optionalInteger` 与现 `optionalQuantity` 的逐输入决策对比）、真实文件回归、边界穷举、测试独立复跑
- 验证脚本：`r2-edges.mts`、`r2-equiv.mts`、`r2-negzero.mjs`、`r2-cap.mts`、`r2-order.mts`、`r2-real.mts`、`r2-s2.mts`、`r2-negzerostr.mts`

## 结论速览（增量）

| 项 | 结果 |
| --- | --- |
| M1 是否真的修好 | **是**（已独立验证） |
| M2 是否真的修好 | **是，但修复生效的机制与注释声称的不同**（见 R2） |
| 我上轮的错误建议 | **确认我错了**，收窄后的规则正确（见"先说我上轮的错"） |
| 新发现问题 | 3 个（1 个建议改 S5、2 个观察 R2/R3），**0 个阻断性** |
| 回归 | 无新引入；`import-monitor` 那条失败已独立确认与本改动无关 |

**合并结论：能合并。**

---

## 先说我上轮的错

我上轮 M1 给的修法 1 是"给 `onHandQuantity` / `availableQuantity` 也传 `nonNegative=true`，负值回到阻断"。**这条建议是错的**，我独立复算确认了：

| 真实文件（11007 库存，裸解析）核实项 | 我这轮实测 | 协调者给的数 |
| --- | --- | --- |
| `onHandQuantity` / `availableQuantity` 两列负整数**单元格**数 | **2356** | 2356 一致 |
| 涉及**行**数 | **1180** | 1180+ 一致 |
| 负小数单元格 | **0** | 0 一致 |
| 正小数单元格 | **2**（第 1928 行） | 2 一致 |
| 负零入库行 | **0** | 0 一致 |

这 2356 个负整数单元格落在两个不传 `nonNegative` 的字段上，**基线一直合法放行**（`Number.isSafeInteger(-118)` 为 `true`）。按我的建议一律阻断，会把 1180 行全拦掉并撞上 `errors.length >= 200` 的全局上限——与实现者报告的"errors 暴涨到 200+、rows 跌到 1951"现象一致。

我上轮虽然把"行为收紧需确认"写进了 Q1，但**低估了量级**：我当时只统计了"负库存行数 1180、非刷刷仓 19"，没有去数这 1180 行里有多少是会被新规则拦下的负整数，就把"一律阻断"列为推荐修法 1。这是我的疏漏。实现者用真实文件回归自己抓出来并改正，判断比我的建议准确。

## 核心判断：收窄后的规则是否正确

**正确。** 规则是"整数路径保持原行为（只有 `nonNegative=true` 才拦负数），小数路径的负值一律阻断"。

我用差分等价性验证（`r2-equiv.mts`）把基线 `optionalInteger` 和现 `optionalQuantity` 的决策逻辑并排跑了 29 个输入 × 2 种 `nonNegative`，共 58 组：

| 输入类别 | 行为差异数 | 评价 |
| --- | --- | --- |
| **安全整数输入**（含 `-0`、`-5`、`-118`、`-7974`、`±MAX_SAFE_INTEGER`） | **0 处** | 整数路径与基线逐输入完全一致 |
| 非整数输入 | 10 处 | 全部是本次有意变更（正小数由阻断改为取整通过） |

关键确认：**所有 10 处差异都是"正小数从阻断变为通过"，没有一处是"负数从阻断变为通过"或"原本通过的变成阻断"。** 这正是本次改动应有的语义边界。

真实文件回归我也独立跑了：

| 口径 | rows | errors | warnings |
| --- | --- | --- | --- |
| 裸解析 | **26452** | **51**（全为 `MISSING_VALUE/unitCost`） | **2** |
| 生产链路 `importBytes` | **24476** | **0** | **2** |

与实现者报告一致，且 2356 个负整数全部照原样放行、零 warning、零阻断。

---

## 逐项复审

### 1. 收窄后的规则是否还有漏洞

协调者点名要查的三类输入，实测结果：

| 输入 | parsed 实际值 | 走哪条路径 | 结果 | 是否穿透 |
| --- | --- | --- | --- | --- |
| `-3.5` | -3.5 | 小数 | 阻断"不能为负数" | 否 |
| `-0.6` / `-0.5` / `-0.4` | 原值 | 小数（`parsed < 0` 命中） | 阻断 | 否 |
| `-1e-20`（极小负数） | -1e-20 | 小数（`parsed < 0` 命中，实测 `-1e-20 < 0` 为真） | 阻断 | 否 |
| `-1e21` | -1e21 | 小数（非安全整数） | 阻断 | 否 |
| `-0`（数字） | **-0** | **整数**（`Number.isSafeInteger(-0)` 为 `true`） | 通过，入库 `0` | 见 R2 |
| `"-0"` / `"-0.0"` / `"-0.00"`（字符串） | **-0** | **整数** | 通过，入库 `-0` | 见 R2 |
| `"(0.0)"`（括号转负） | **-0** | **整数** | 通过，入库 `-0` | 见 R2 |
| `"(0.4)"`（括号转负小数） | -0.4 | 小数 | 阻断 | 否 |
| `-5` / `-7974`（负整数） | 原值 | 整数，不传 nonNegative | 通过，原值入库 | 否（有意保留） |

**结论：负小数路径无穿透。** 每一个负小数输入，包括 `-1e-20` 这种极小值，都被 `parsed < 0` 捕获并阻断。

### R2（观察，非缺陷）：`Object.is(parsed, -0)` 这个子句**永不触发**，M2 实际是靠 `parsed < 0` 修好的

实测（`r2-negzero.mjs`）：`Number.isSafeInteger(-0)` 为 **`true`**。所以 `-0` 永远在小数路径之前就被整数路径 `return` 掉了，**小数路径里的 `Object.is(parsed, -0)` 是不可达分支**。我穷举了能产生 `-0` 的 7 种候选值，"既非安全整数又是 `-0`"的数量为 **0**。

这不影响修复的正确性，M2 确实修好了，但修好的原因和代码注释说的不是一回事：

| 说法 | 实际 |
| --- | --- |
| 注释称"`(-0.5, 0)` 区间的负小数四舍五入后是 `-0`，`-0 < 0` 为 false，必须用 `Object.is` 识别" | 该区间的输入（如 `-0.4`）**`parsed` 本身是 `-0.4` 而不是 `-0`**，`-0.4 < 0` 为真，已被第一个子句拦住。`-0` 只会在 `Math.round` **之后**出现，而现在根本走不到 `Math.round`（负值已先被阻断） |

换句话说：`Object.is(parsed, -0)` 是对 `parsed`（取整前）判断的，而注释描述的是 `rounded`（取整后）的现象。判断对象错位了，所以这个子句是无害的死代码。

**M2 原始缺陷确实消除了**：`-0.4` / `-0.5` 现在阻断（实测 `rows=0`、`errors=1`、消息含"负数"），负值门禁盲区关闭。

唯一残留：字符串 `"-0"` / `"-0.0"` / `"(0.0)"` 仍会把 **`-0` 原值**写进 `InventoryStockRow`（实测 `Object.is(stored, -0)` 为 `true`），且不触发 `NEGATIVE_INVENTORY_NOT_ALLOWED`。但这**与基线完全相同**（差分验证里 `-0` 在整数输入上行为差异为 0），是既有行为而非本次引入；且 `JSON.stringify` 序列化为 `0`、Django 落库为 `0`，业务上零影响（库存 0 与 -0 同义）。不构成阻断。

建议（可选）：把小数路径的 `|| Object.is(parsed, -0)` 删掉或移到 `rounded` 上判断，并修正注释——留着一个永不触发的子句加一段描述错位的注释，后续维护者会误以为 `-0` 是经由这里被挡住的。

### 2. 整数路径是否真的与基线一致

**是，已逐输入证明。** 基线的阻断条件是三项或运算：

```
parsed === null || !Number.isSafeInteger(parsed) || (nonNegative && parsed < 0)
```

现在拆成了"`null` 或非有限值" → "安全整数则只判 `nonNegative`" → "小数路径"三段。拆分等价性的关键在于：基线 `!Number.isSafeInteger(parsed)` 覆盖了"非有限值"和"小数"两类，拆分后前者归第一段、后者归第三段，**安全整数这一类在两版里都只受 `nonNegative && parsed < 0` 约束**。

差分验证确认：**安全整数输入上 0 处行为差异**（含 `-0`、`-1`、`-5`、`-118`、`-7974`、`±MAX_SAFE_INTEGER`，两种 `nonNegative` 取值）。2356 个负整数单元格行为零变化，真实文件回归 `errors=51` 与修复前一致（那 51 条是 `unitCost` 缺失，与数量字段无关）。

一个细节值得记录：基线的错误消息三元表达式 `nonNegative && parsed !== null && parsed < 0 ? "不能为负数" : "不是有效整数"` 里的 `parsed !== null` 守卫，在拆分后不再需要（第一段已把 `null` 滤掉），实现者相应简化了消息逻辑。消息文案在各路径上与基线一致（负数场景"不能为负数"、其余"不是有效整数"），差分验证已覆盖。

### 3. S1 的 warning 上限实现

协调者点名的三个问题，逐一实测（`r2-cap.mts`、`r2-order.mts`）：

| 问题 | 结论 |
| --- | --- |
| 汇总 warning 本身会不会把总数顶到 201 | **不会。** 截断条件是 `warnings.length < MAX - 1`（即 199），明细最多 199 条，汇总条补到第 200 条，合计正好 200。实测 34/50/100/500 行场景，解析层 warnings **恒为 200**，从不越界 |
| 两层截断是否会把汇总 warning 二次截断掉 | **不会被截掉。** 汇总条位于 `parsed.warnings` 末尾（第 200 位），`django-import-service.ts` 的装配顺序是 `[...roundedQuantityWarnings, ...固定告警]`，小数告警在**前**，所以 `slice(0, 200)` 恰好保留全部 200 条含汇总条。实测"汇总条存活"为 `true` |
| 实际造 200+ 场景是否仍触发 Django 400 | **不再触发。** 最终数组长度恒 ≤ 200，满足 Django `MAX_WARNINGS=200` 的 `len(value) > 200` 校验。实测 30/33/34/50/100/500 行全部"通过" |

对比修复前：33 行多字段小数即会产生 202 条触发 400。现在 500 行场景仍为 200 条通过。S1 的核心目标（故障模式不从"小数阻断"平移成"warning 超限阻断"）**达成**。

### S5（新发现，建议改）：warning 装配顺序使小数告警在超限时挤掉全部固定业务告警

这是 S1 修复带来的一个副作用，不阻断但值得处理。

`django-import-service.ts` 的装配顺序把 `roundedQuantityWarnings` 放在**最前面**，固定业务告警在后：

```
const warnings = [ ...roundedQuantityWarnings, ...(retainedZeroCostRows ? [...] : []), ... ];
const boundedWarnings = warnings.slice(0, 200);
```

当小数告警占满 200 条时，实测（`r2-order.mts`）`slice(0, 200)` 后：

| 项 | 结果 |
| --- | --- |
| 保留的 code | 仅 `ROUNDED_DECIMAL_QUANTITY` |
| 被丢弃的固定业务告警 | `RETAINED_ZERO_UNIT_COST`、`MISSING_PRODUCT_NAME`、`MISSING_SPEC_SUPPLIER`、`MISSING_LOCKED_QUANTITY`、`MISSING_IN_TRANSIT_QUANTITY`（全部 5 条） |

这些固定告警是**聚合性**信息（"N 行零成本已保留"、"N 行缺货品名称"、"报表未提供锁定数量，本批次暂按 0 处理"），每条代表整批的一个口径事实；而小数告警是**逐单元格**明细，第 150 条和第 151 条的信息价值远低于任意一条聚合告警。超限时丢掉全部聚合口径、只留小数明细，优先级反了。

`MISSING_LOCKED_QUANTITY` / `MISSING_IN_TRANSIT_QUANTITY` 尤其要紧：它们说明"本批次该字段按 0 处理"，直接影响补货公式里 `采购在途` / `调拨在途` 的解读（业务口径第 20 条）。丢掉这条，使用者会把"没有在途"和"报表没提供在途"混为一谈。

另外，规范第 9 条要求导入保留"告警"，第 10 条要求可追溯。小数明细有汇总条兜底（"还有 N 条未显示"），聚合告警被丢弃后**没有任何兜底痕迹**。

实际触发门槛不低（需约 34 行多字段小数或约 100 行双字段小数；本轮真实文件只有 1 行、7 条告警、余量 193 条），所以**不阻断合并**。

建议改法：把固定业务告警放在装配顺序**最前**，小数明细放后（小数明细已有自己的汇总条，被截断不丢信息）。即 `[...固定告警, ...roundedQuantityWarnings]`。或在解析层把小数明细上限从 199 降到如 150，给固定告警留固定配额。

### 4. S2 的时序结论是否成立

**前提成立，结论基本成立，但代码注释比实际情况说得满。** 实测（`r2-s2.mts`）：

| 场景 | 实测结果 | 评价 |
| --- | --- | --- |
| A：表头**有**"可用库存"但单元格为空 | `avail=0`（推导**未**触发） | 注释的"推导只在整列表头缺失时触发（而不是单元格为空时触发）"**正确**。协调者担心的"表头存在但值为空走到推导分支"不会发生：推导由 `indexes.has(...)` 门控，`isBlank` 的空单元格走 `return 0` |
| B：整列缺失，`onHand=10`、`locked=3` | `avail=7` | 推导正常 |
| C：整列缺失，`onHand=10.5`、`locked=0.4` | `onHand=11`、`locked=0`、**`avail=11`** | 按原值推导应为 `10.5-0.4=10.1` → 取整 `10`。实际得 `11`，**仍有 1 个单位偏差** |
| D：整列缺失，`onHand=2`、`locked=10` | `avail=-8`，零 error、零 warning | 推导可产生负值且无告警（既有行为，非本次引入） |

注释称"整数之间的加减法不会再产生小数，因此先取整再推导不会比先推导再取整引入额外偏差"。**前半句对，后半句不严谨**：参与推导的值确实已是整数，但它们**各自已经承担了取整误差**，两个误差叠加后与"按原值推导再取整"的结果可以相差 1 个单位（场景 C 实测 11 vs 10）。这正是我上轮 S2 指出的现象，这次只加了注释、没有改行为。

不阻断的理由：

1. 真实文件两列都存在（实测 `hasOnHandQuantity` 与 `hasAvailableQuantity` 均为 `true`），推导分支**不触发**；
2. 要触发需同时满足"整列缺失"加"另一列或锁定数量是小数"，概率很低；
3. 偏差上界 1 个单位，且两个来源单元格各自都有 warning 留痕（场景 C 实测 `warn=2`），可追溯。

所以 S2 的处理（记录结论、不改行为）可以接受，但注释里"不会引入额外偏差"的措辞建议改为"偏差上界 1 个单位，且来源单元格均有 warning 留痕"，避免后续维护者据此认为该路径已无误差。

### 5. 新增测试是否真的覆盖 M1/M2

**覆盖到了，且这次断言明显更严。** 独立复跑：`tests/inventory-stock-decimal-quantity.test.ts` 加 `tests/inventory-import-decimal-warning-passthrough.test.ts` → **18 pass / 0 fail**。

对照我上轮点出的盲区：

| 上轮盲区 | 这次是否覆盖 | 断言严格度 |
| --- | --- | --- |
| 负小数（M1 核心） | **已覆盖**，两个参数化测试覆盖 `onHandQuantity` / `availableQuantity`，各跑 `-3.5` / `-2.5` / `-1.5` / `-0.4` 四个值 | **严格**：断言 `rows=0`、`errors=1`、code、field、消息匹配"负数"、**且 `warnings.length === 0`**（后者关键——证明负小数没有悄悄产生取整 warning） |
| `.5` 负向舍入方向 | **已覆盖**，`-3.5` / `-2.5` / `-1.5` 全在阻断集里 | 严格。原先那条会误导的测试标题（"统一就近取整，.5 向上"）仍在，但现在负向 `.5` 由独立测试明确锁定为阻断，误导性已大幅降低 |
| `-0`（M2） | **已覆盖**，两个专门测试：`nonNegative` 字段上的 `-0.4` / `-0.5`，以及非 `nonNegative` 字段上的 `-0.4` | 严格，含 `warnings.length === 0` |
| warning 条数上限（S1） | **已覆盖**，110 行 × 2 小数字段 = 220 条原始告警 | 较严：断言 `≤200`、末条 code、消息匹配"还有…未显示"**且含"200"**。另有一个反向测试确认不超限时不产生汇总条 |
| 负整数不受影响（新增回归防护） | **已覆盖**，两个测试锁定 `-118` / `-5` 和销量 `-3` / `-1` | **严格**：`deepEqual(errors, [])`、`deepEqual(warnings, [])`、逐字段断言原值。这是防止我那条错误建议被再次引入的护栏，很有价值 |

**`django-import-service.ts` 透传测试的可信度：可信。** 我读了实现：通过注入 `fetchImpl` 拦截三个 Django 端点，在 `INVENTORY_IMPORTS_PATH` 上捕获 POST body 并 `JSON.parse`。断言链是：`result.ok === true`、`writerPayload` 非空（证明 POST 真的发生）、从 **POST body** 里过滤 `ROUNDED_DECIMAL_QUANTITY` 断言条数 `=== 2`、字段含 `onHandQuantity` 与 `availableQuantity`、`row === 2`，最后断言 `result.warnings` 也含该 code。

这个设计是可信的，因为它验证的是**实际发出的 payload**而非中间变量——这正是我上轮只能靠读代码确认的那一环（`parsed.warnings` 并入 `warnings` 的 2 行）。两点可以更好但不影响可信度：(a) 没有断言 `boundedWarnings` 的截断行为（200+ 场景未走这条链路）；(b) 环境变量用了 `process.env` 直接改写加 `finally` 恢复，并发跑测试时可能互相干扰，不过 `node:test` 默认同文件串行，实测通过。

**本轮无"测了但断言宽松"的情况。** 几乎所有新测试都带 `warnings.length === 0` 或 `deepEqual(warnings, [])` 这类负向断言，这是上轮缺失的关键一环——它让"静默取整通过"这类缺陷无法再藏在全绿测试后面。

### 6. 是否有新引入的回归

**无新引入回归。**

| 套件 | 结果 |
| --- | --- |
| `inventory-stock-decimal-quantity` 加 `inventory-import-decimal-warning-passthrough` | 18 pass / 0 fail |
| 加 `jackyun-post-download` 加 `warehouse-mapping-settings` | **45 pass / 0 fail / 0 skip** |
| `import-monitor.test.ts` | 8 pass / **1 fail** |

**`import-monitor` 那条失败与本改动无关，已独立确认**（不是采信实现者的声称）：

1. 失败测试是 `display catalog matches allowlisted workflow definitions without bundling operational configuration`，断言差异在 n8n 节点属性 `onError: 'continueErrorOutput'`（workflow JSON 定义比对），与库存解析毫无关系；
2. 该测试读取的全部输入——`lib/imports/chain-catalog.generated.json`、`backend/workflow/import_chain_catalog.json`、`app/import-chain-rules-view.tsx`、`lib/imports/run-presentation.ts`——相对 merge-base `36668589` **逐个确认为 IDENTICAL**；
3. 本分支相对 merge-base 只改 4 个文件，`automation/` 零差异；
4. `grep` 确认 `tests/import-monitor.test.ts` 对 `inventory-stock` / `django-import-service` 的引用次数为 **0**；
5. 工作树干净（`git status --porcelain` 为空），排除本地未提交改动干扰。

输入逐字节相同、改动文件与该测试无引用关系，因此该失败必然在基线上同样存在，属 main 既有问题（很可能是 main 新提交 `525ad36b` 或更早改了 workflow JSON 而未同步 catalog）。**与本改动无关，不构成合并阻断**，但建议另案跟踪。

---

## 增量复审问题清单

| 编号 | 类别 | 问题 | 阻断 |
| --- | --- | --- | --- |
| R2 | 观察 | 小数路径的 `Object.is(parsed, -0)` 是不可达死代码（`-0` 是安全整数，先被整数路径返回）；M2 实际由 `parsed < 0` 修好，注释对判断对象描述错位 | 否 |
| R3 | 观察 | S2 注释"不会引入额外偏差"不严谨，实测整列缺失加小数来源时推导结果仍可与按原值推导相差 1 个单位（场景 C：11 vs 10）；真实文件不触发该路径 | 否 |
| S5 | 建议改 | warning 装配顺序让小数明细（有汇总条兜底）在超限时挤掉全部 5 条固定业务聚合告警（无兜底），优先级反了 | 否 |

上轮遗留：S3（销量与库存同规则）、Q1 至 Q3 仍待业务确认。实现者已在代码注释中明确记录这两项留待业务确认，未擅自拆分，处理方式恰当。

---

## 最终结论（增量）

**能合并。**

M1 与 M2 两个阻断性缺陷**确实已修好**，且我是用差分等价性验证加真实文件回归独立确认的，不是采信提交说明：

| 验证项 | 结果 |
| --- | --- |
| 负小数是否还能穿透（含 `-1e-20`、`-0.4`、`-0.5`、括号负小数） | **不能**，全部阻断 |
| 负值门禁盲区 `(-0.5, 0)` 是否关闭 | **已关闭** |
| 整数路径与基线行为差异 | **0 处**（29 输入 × 2 配置穷举） |
| 2356 个真实负整数单元格 | **行为零变化**，全部放行 |
| 真实文件回归 | rows 26452 / errors 51 / warnings 2，与修复前负整数行为一致 |
| warning 上限 | 恒 ≤ 200，汇总条存活，Django 400 不再触发 |
| 新测试 | 18 pass / 0 fail，断言含负向 `warnings.length === 0`，M1/M2 不会再藏在全绿后面 |
| 聚焦回归 | 45 pass / 0 fail；`import-monitor` 单条失败已独立证明与本改动无关 |

收窄后的规则（整数路径保原行为、小数路径负值一律阻断）**是正确的取舍**，而且比我上轮给的"负数一律阻断"更贴合真实数据——那 2356 个负整数是既有业务状态，不该被这次改动牵连。实现者用真实文件回归抓出我的建议错误并自行改正，这个过程本身提高了改动的可信度。

新发现 3 项均不阻断：R2 和 R3 是注释与实际机制的措辞偏差（代码行为正确），S5 是超限场景下的告警优先级问题（触发门槛约 34 行多字段小数，真实文件余量 193 条）。建议合并后另案处理 S5，并顺手修正 R2/R3 的注释措辞——留着不可达分支和过于乐观的注释，会让后续维护者对边界产生误解。

### 增量复审证据

- 只读审查；review worktree `git status --porcelain` 为空，未修改任何仓库文件
- 验证脚本位于 `D:\codex-artifacts\review-decimal-20261025\`：`r2-edges.mts`（17 个边界输入矩阵）、`r2-equiv.mts`（基线与现版差分等价性，58 组）、`r2-negzero.mjs`（`-0` 路径可达性）、`r2-cap.mts`（warning 上限 6 档）、`r2-order.mts`（装配顺序与截断丢弃项）、`r2-real.mts`（真实文件两口径回归加负整数计数）、`r2-s2.mts`（S2 四场景时序）、`r2-negzerostr.mts`（`-0` 字符串路径与质量门禁）
- 真实文件只读解析，报告不含货品名称、金额等业务明细
