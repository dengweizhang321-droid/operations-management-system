# netshop ZIP 上限与 AI 写回执租期/TTL（2026-10-29）

- 分支：`codex/netshop-zip-receipt-limits-20261029`，已变基到 `main` = `1415c2c4`
- 来源：2026-10-24 系统审查第 39 项（对应分报告 D2-8、D2-10、D2-11）
- 状态：**改动完成、必需检查通过；未合并、未推送、未准备制品、未发布**（AGENTS.md 规则 4）
- **不需要 Django migration**：`makemigrations --check --dry-run` 实测 `No changes detected`

## 一、三个子项

| 子项 | 审查来源 | 缺陷 |
| --- | --- | --- |
| A | D2-8 | netshop ZIP 无条目数上限、无解压总量上限 |
| B | D2-10 | AI 写回执卡在 `processing` 不超时，同一 request_id 之后永远 409 |
| C | D2-11 | `AiWriteReceipt` 无 TTL、无清理，`response_payload` 永久保存 |

## 二、子项 A：ZIP 条目数与解压总量上限

`lib/netshop/normalized-import.ts` 的 `parseZip()` 原本只有「单条目解压后 ≤25MB」（`MAX_UNCOMPRESSED_ENTRY_BYTES`），**没有条目数上限、没有解压总量上限**，而且是先把所有条目全解出来再检查「只能 1 个」——解压炸弹在检查之前就已经落地。

### 照既有模板改，不自创

模板取自 `lib/netshop/product-image-assets.ts` 的 `extractTmallProductAssetImages()`（:290-336），两段式校验：

1. 在 `unzipSync` 的 `filter` 回调里累加条目数与「自报总量」，**超限立即 throw，不等解压完**；
2. 解压后用 `Object.values(zip).reduce(...)` 的**实际字节**复核总量，防止谎报 `originalSize` 绕过。

新增常量（紧邻既有单条目上限）：

```ts
const MAX_ZIP_ARCHIVE_ENTRIES = 50;
const MAX_UNCOMPRESSED_TOTAL_BYTES = 25 * 1024 * 1024;
```

### 取值依据（实测，非估计）

netshop ZIP 的唯一真实业务用法是 `tmall_promotion`（天猫推广日报），协议固定单日单 CSV：

- 同文件 `:294` 强制 `source === "tmall_promotion" && (archiveEntries.length !== 1 || entries.length !== 1 || !/\.csv$/i.test(...))` —— **必须且只能一个 CSV**；
- `docs/自动化/天猫/天猫商品与推广缺失日规划.md` 第 8、178 条：「只接受本轮唯一 `.zip`」「每个 ZIP 通过唯一目标日、商品主体、行数和哈希校验」；
- 现有测试 `tests/tmall-promotion-title.test.ts`、`tests/tmall-netshop-import.test.ts` 的全部 ZIP 夹具都只放 1 个条目。

**真实条目数恒为 1，上限 50 留出两位数量级余量**（应对意外混入的目录项、说明文件），不会误伤任何已知正常导入。解压总量沿用既有的 25MB 单文件口径，因为业务上本就是单日单文件。

行数上限 `MAX_TABULAR_ROWS = 50_000` 本来就有，是解压后的二道闸，本次未动。

## 三、子项 B：写回执租期

### 缺陷位置

`backend/ai_assistant/views.py` 的 `write()` 在 `external=True` 路径上：`mutation()` 事务内创建 `processing` 回执并提交，随后**在事务外**执行外部 handler。进程若在 handler 执行期间崩掉，回执永远停在 `processing`，同一 `request_id` 之后永远返回 409。

连带影响：`management/commands/ai_write_authority.py:83` 与 `ai_cutover_check.py:350` 都用 `AiWriteReceipt.objects.filter(status="processing").exists()` 当切换门禁，**卡死的回执会连带卡住写权限切换**。

### 实现（不加字段）

新增 `PROCESSING_LEASE = timedelta(minutes=30)`。命中既有回执且 `status == "processing"` 且 `created_at <= now - 30min` 时：

1. 在原 `mutation()` 事务内把回执原子转为新状态 `stale_manual_review`；
2. 对外返回 409 `processing_lease_expired`，**不自动重放 handler**（结果未知的外部操作不可重放）。

转为 `stale_manual_review` 后该行不再满足 `status="processing"`，**上述两处切换门禁自动解锁**，不需要改那两个命令。

30 分钟租期取自 `docs/规范/导入与自动化.md` 里「30 分钟无进展才可原子接管」的既有口径。

**不需要 migration**：`AiWriteReceipt`（`control_models.py`）已有 `created_at`（创建时一次写入、此后不变）与 `completed_at`（null 直到完成），足够当租期锚点，无需新增 `lease_expires_at`。

### 施工时踩的坑（记录以免重犯）

第一版把「转 stale」与「抛错」写在同一个 `with mutation()` 块里，结果抛出的 `AiError` 把刚 `.save()` 的状态转换**一起回滚**了（Django `transaction.atomic()` 语义），测试表现为该行永远卡在 `processing`。改成状态转换在块内提交、`raise` 挪到块外才正确。

## 四、子项 C：已完成回执的 TTL 清理

其他域（如 `customer_service`）的 7 天 TTL 靠专用 `expires_at` 字段实现；`AiWriteReceipt` 没有该字段，但 `completed_at` 足够等价：「7 天前已完成」= `status="completed" AND completed_at <= now - 7d`。

新增 `COMPLETED_RECEIPT_TTL = timedelta(days=7)` 与 `_prune_expired_receipts()`，在 `write()` 的 `mutation()` 事务开头**机会性**删除最多 20 条过期的 `completed` 回执（连带其 `response_payload`）。

**只清 `completed`**，`processing` 与 `stale_manual_review` 绝不触碰——那是子项 B 的人工对账范围，被 TTL 误删会丢掉对账依据。

## 五、测试

| 范围 | 结果 |
| --- | --- |
| `tests/netshop-zip-bomb-limits.test.ts`（新增） | **5 通过 0 失败** |
| `backend/ai_assistant/test_write_receipt_lease.py`（新增） | **7 通过 0 失败** |

ZIP 侧覆盖：条目数超限拒绝（且不解出全部条目）、谎报总量超限拒绝、实际解压总量超限拒绝、单条目超 25MB 仍拒绝（回归既有上限）、边界内天猫推广 ZIP 正常通过、非天猫推广来源在上限内正常通过。

回执侧覆盖：崩溃后租期内重试仍 409 `request_pending` 且不重放、超租期转 `stale_manual_review` 且不重放且切换门禁查询不再命中、租期边界内 1 秒仍判未过期、已完成回执照常重放、超 7 天已完成回执被清理、7 天内不清理、TTL 绝不碰 `processing`/`stale_manual_review`。

### 必需检查

| 检查 | 结果 |
| --- | --- |
| `npm run build` | **通过**，exit 0 |
| lint 基线门禁 | **通过**，56 errors / 119 warnings 与基线一致 |
| `check:backend-boundary` | 通过，729 模块 0 violations |
| `check:pi152-acl` | 通过，27 checks |
| CI 单测白名单（12 文件 59 测试） | 全通过 |
| `manage.py check` | 无问题 |
| `manage.py makemigrations --check --dry-run` | **No changes detected**（确认不需迁移） |

### 回归基线对照

`ai_assistant` 与 `netshop` 两域体量极大（`ai_assistant` 单域约 1797 个 `test_` 方法），完整跑一轮约 100 分钟。改用**本次改动唯一可能影响的面**做对照——仓库里所有直接引用 `AiWriteReceipt`/`control_models` 的 23 个测试文件：

```
worktree（含新增 test_write_receipt_lease.py）  233 tests  41 failures  32 errors  51 skipped
clean main（同一清单，减去新文件）              226 tests  41 failures  32 errors  51 skipped
```

233 − 226 = 7，正好是新增且全部通过的 7 个测试；**两边失败/错误清单逐行 diff 完全一致（73 行，0 差异）** —— 零回归。

另单独核实 `test_business_screening_http.py` 里唯一一处 `access_denied` 失败（与 `DJANGO_PROCESS_ROLE` 的测试间状态泄漏有关）在 clean main 上同样失败，属既有问题。

> 另据同期独立核实：`manage.py test ai_assistant` 全量为 1822 tests / 142 failures / 232 errors / 206 skipped，在 clean main 上复跑得到相同数字，**属既有基线**，与本次改动无关。

## 六、硬约束遵守

未触碰 `package.json`（被 guard 收据按 sha256 钉死的受保护发布入口），未触碰被三代闭包字节钉死的 `tools/worker-local-release-rotation.mjs`、`tools/publish-prepared-main.mjs`、`tools/worker-local-release.mjs`。未新建 migration。

## 变更记录

2026-10-29：建立。补 netshop ZIP 条目数与解压总量上限、AI 写回执 30 分钟租期与 7 天 TTL 清理；三项均未新增数据库字段。
