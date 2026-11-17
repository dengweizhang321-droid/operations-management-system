# 天猫直连 M 批次内容串单作废（2026-11-17）

规范依据：[导入与自动化](../规范/导入与自动化.md) 中“直连 M 同类窄例外”条款。本文只记录本次问题、放行条件、命令与预期，不代表已执行作废。

## 问题

拓丰店（`tmall-tuofeng`）货品主数据（M，MTOP 直连 `tmall_mtop_batch_export_v1`）自 11-14 起每天失败。

- 活动清单 `outputs/tmall-direct-product-master-export/active-tmall-tuofeng.json`：`snapshotDate=2026-11-14`，`stage=failed`，`resumeStage=downloading`，错误为“天猫分批商品 XLSX 的商品 ID 集合与提交批次不一致”。
- 共 8 批 143 个商品；前 7 批 `downloaded`，第 8 批（期望 3 个商品，`recordId=352301881`）停在 `downloading`。
- 第 8 批本地文件 29 行，实际只含另一家店的 1 个商品，疑似平台导出串单。
- `tools/tmall-direct-product-master-export.ts` 的恢复逻辑在 `downloading` 且文件存在时只重新校验该文件，每次必然失败；没有作废后重导的路径，规范原先对直连 M 也没有作废入口。

用户已决定“拓丰作废重导”：作废整张清单，由 n8n 的下一次完整 execution 用当天日期重导全部 8 批，不单独补第 8 批（避免同一快照混入不同日期数据）。

## 放行条件（全部满足才作废，否则拒绝并给出 reason 码）

| 条件 | 拒绝码 |
| --- | --- |
| 原 M（逐页、商品管家）目录无活动清单 | 抛“检测到原 M 节点活动清单” |
| 协议、版本、storeKey、shopName 与注册表一致，runId/快照日期格式有效 | `audit_identity` |
| `stage=failed`、`resumeStage=downloading` | `stage` |
| `error` 精确等于上面那句文案 | `error_text` |
| 没有 `mergedFile` / `importResult` | `merged_or_imported` |
| 第 1…k-1 批 `downloaded` 且带 `file`（含 sha256） | `downloaded_without_file` |
| 第 k 批为 `downloading` 且带 `recordId`（`submitting`/`submitted` 一律拒绝） | `batch_stage` |
| k 之后全为 `planned`，且无 `baselineRecordIds`/`submittedAt`/`traceId`/`recordId`/`file` | `later_batch_evidence` |
| 第 k 批本地文件按原命名存在 | `batch_file_missing` |
| 文件可解析且商品 ID 非空（行数不符、解析失败都不属于该例外） | `batch_file_unparseable` |
| 现场重新解析所得商品 ID 集合与该批 `itemIds` 不相等 | `batch_content_matches` |
| reason 4–300 字符、带 `--confirm` | `reason_length` / `not_confirmed` |
| helper 没有正在运行该店的 tmall 执行（读 `GET /health`，未启动视为空闲；无法确认则拒绝） | `helper_store_active` / `helper_probe_failed` |
| 归档目标 `-original.json` 不存在 | `archive_target_exists` |

## 动作与中断续做

1. 同目录 `wx` 创建 `abandoned-batch-content-mismatch-<store>-<snapshotDate>-<runId>.json`：原清单 + `abandonment`（`abandonedAt`、`previousStage`、`resumeStage`、`reason`、`batchIndex`、`recordId`、批次文件路径/sha256/大小/行数、`expectedItemIds`、实际商品 ID 数量、排序后摘要及前 5 个样例、活动清单原字节 sha256、`operatorConfirmed: true`）。
2. 复验活动清单字节 sha256 未变，再用绝对路径 PowerShell `File.Move` 不覆盖地把 `active-<store>.json` 移为 `<记录名>-original.json`；目标已存在即拒绝。移走后复核归档字节一致且活动清单未被重新写出。
3. 中断续做：记录已存在、活动清单仍在且其字节 sha256 与记录一致、记录主体与活动清单内容相同，则只续做第 2 步（返回 `resumed: true`）；其他不一致情形一律失败关闭，不改动任何文件。
4. 串单的批次文件保留原地不删，作为证据；新一轮 runId 不同，文件名不冲突。

## 并发保护与残余风险

代码库中没有天猫直连 M 的跨进程文件锁（helper 的店铺占用是 helper 进程内存中的 slot，Chromium 运行锁只存在于京东/吉客云链路）。因此：

- 正式执行前读 `GET http://127.0.0.1:5791/health`（只读），该店有 tmall 执行则拒绝。
- rename 前一刻再次读取活动清单字节核对 sha256，并在移走后确认活动清单未重新出现。
- 残余风险：探测与 rename 之间若有 helper 刚好启动并持有内存中的清单，它之后的 `persistAudit` 可能重新写出 `active-tmall-tuofeng.json`，此时入口报错 `active_reappeared`，需人工核对。操作时应确认没有 n8n execution 正在运行（建议在 11:20 定时之前或 n8n 空闲时执行）。

## 执行命令

在主检出 `D:/运营管理系统`（合并到 main 后），无需发布 Worker（新脚本不在 helper 打包闭包内）：

```powershell
# 只读检查，不写任何文件，也不探测 helper
node --import tsx tools/tmall-direct-master-admin.ts --action abandon-batch-content-mismatch --store-key tmall-tuofeng --reason "拓丰第8批下载文件为其他店铺商品(串单)，作废整张11-14快照后由n8n当日重导" --dry-run

# 正式执行（须操作者本人确认后）
node --import tsx tools/tmall-direct-master-admin.ts --action abandon-batch-content-mismatch --store-key tmall-tuofeng --reason "<同上>" --confirm
```

`--dry-run` 可附 `--audit-directory <目录>` 指向其他检出时的生产审计目录。`--dry-run` 与 `--confirm` 互斥。

## 作废后的预期

依据（代码核对）：

- `runTmallDirectProductMasterStage` 先 `assertNoLegacyMasterAction`（只检查逐页/商品管家目录里是否有 `active-<store>.json`），再 `readAudit`；活动清单不存在时返回 `null`，`resolveTmallDirectProductMasterSnapshotDate(undefined, undefined, 今日)` 取当天上海日期新建清单、新 `runId`。
- 节奏门禁 `hasPendingTmallProductMasterAudit` 同样只看 `active-<store>.json`；残留的 `abandoned-*.json`、`-original.json` 不会被当作未决清单。节奏状态文件（`.runtime/tmall-product-master-cadence/tmall-tuofeng.json`）的 `nextDueDate=2026-11-13`，早于今天，因此下一次运行判定为 `scheduled` 到期，无需强制标记。
- 旧批次文件名含旧 `runId`，新一轮文件名不同，`writeFile(..., { flag: "wx" })` 不会冲突。
- 下一次 11:20 定时或 n8n 手动运行，将以当天日期重导全部 8 批并一次性合并导入。11-13 至 11-16 的快照无法补回。

## 生产只读 dry-run 输出（2026-11-17，未写入任何文件）

```json
{
  "ok": true,
  "stage": "dry_run_abandonable",
  "storeKey": "tmall-tuofeng",
  "shopName": "天猫-志高拓丰专卖店",
  "snapshotDate": "2026-11-14",
  "runId": "9dc4c9e5-c341-46b2-9a70-3d13f95bbbbb",
  "batchIndex": 8,
  "recordId": "352301881",
  "batchCount": 8,
  "activeSha256": "9f5a036183e46d15f1c04d4da3526485a6a1a7621ef2e6781a2ba688f22d4d15",
  "fileSha256": "e494a5d81e1cc4c329af797233408ae4e43e5954837d3df526c4b7e575cd8d11",
  "fileSizeBytes": 11312,
  "fileRowCount": 29,
  "expectedItemIds": ["992979039094", "997013956046", "997150035424"],
  "actualItemCount": 1,
  "actualItemIdSamples": ["1077814899603"]
}
```

输出中的 `wouldWrite` 列出将创建的记录文件与 `-original.json` 文件名。
