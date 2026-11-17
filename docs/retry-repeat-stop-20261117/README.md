# 重复失败无限重试：终局正则补漏（2026-11-17）

## 问题

共享错误工作流 `TeruisiHourlyRetry2026` 的分类器是「没命中终局正则就每小时重试」。天猫两店的两条确定性内容校验错误没有命中任何终局正则，被无限重试：

- 丽力 `TmallLiliDaily2026`：「天猫商品报表计划维度包含非商品主体，拒绝汇总」（`lib/netshop/normalized-import.ts`），统计为 61 次。
- 拓丰 `TmallTuofengDaily2026`：「天猫分批商品 XLSX 的商品 ID 集合与提交批次不一致」（`tools/tmall-direct-product-master-export.ts`），统计为 53 次。

次数口径：任务提出时的统计为近 7 天丽力 61、拓丰 53；独立审查用生产 156 条错误载荷回放，丽力 61、拓丰 52。拓丰差 1 条的原因未核实，也未取得精确统计区间，以回放数字为可复核口径。

活动清单停在 downloading，每次重试只重新校验同一个本地文件，结果必然相同；每次重试还要登录千牛或阿里妈妈，疑似因此触发验证码。可重试失败不发钉钉，问题持续数日无人知晓。

## 改动

- `tools/n8n-hourly-retry-policy.mjs`：`terminalFailurePatterns` 新增一条精确字面量规则，覆盖上述两条及同类本地文件校验失败（下表）；`terminalAlertReasons` 与「准备人工提醒参数」的 `codes` 新增 `manual_action_content_invalid`；「收集被丢弃的终局失败」不再把 `terminalCode` 写死为「dispatch result unknown…」。
- `tools/n8n-manual-action-alert.ps1`：`$hints` 新增 `manual_action_content_invalid` 文案（仓库副本；生产使用主检出副本，见文末注意）。
- `automation/n8n/data-import-hourly-safe-retry.workflow.json`：由生成器重新生成，仅 3 个节点的 `jsCode` 变化：「仅保留可安全自动重试的失败」「收集被丢弃的终局失败」「准备人工提醒参数」。节点数、连线、settings 与其余 13 个节点不变。
- `tests/n8n-hourly-retry-workflow.test.ts`：新增 4 个测试（精确终局、窄匹配不误伤、文案分类、终局告警链透传原因码）。

### 新增终局的片段

| 片段 | 抛出点 | 判断 |
| --- | --- | --- |
| 计划维度包含非商品主体、缺少有效商品 ID | `normalized-import.ts` prepareTmallPromotionRows | 对已下载文件的汇总校验，同一文件结论固定 |
| 商品 ID 集合与提交批次不一致 | `tmall-direct-product-master-export.ts` 分批文件回读 | 本地 XLSX 与提交批次比对，同一文件结论固定 |
| 与活动清单证据(数量)不一致 | 直连 P/M 恢复（`tmall-direct-promotion-export.ts`、`tmall-direct-product-master-export.ts`）与逐页货品（`tmall-pagewise-product-master-export.ts`）共 6 处 | 本地文件 sha256/行数与冻结清单比对，同一文件结论固定 |

### 考虑过但没有加入

- 「出售中商品集合在 MTOP 导出恢复期间发生变化，拒绝继续补批」「存在未完成的…清单，拒绝覆盖为…」：比对对象是远端实时状态或清单日期，不是本地文件校验；会持续到人工处理，但语义归属另一条链，不在本次精确范围。
- 「导出记录行数与本批不一致」「恢复的导出记录状态或行数不一致」：比对的是远端导出记录，状态未完成时可能是瞬态。
- 「逐页货品文件 … 校验失败」：文件名含空格时无法写出不跨字段的字面量，且该文件已在下载时通过同一校验。
- 各类表头缺失、文件格式不符：范围过宽，留给后续同指纹止损兜底。

## 同指纹连续失败止损

本任务当时没有实现：静态数据方案在当前部署下无法落库。后续改用 n8n 执行历史实现，阈值为 4，见 [retry-same-fingerprint-stop-20261117](../retry-same-fingerprint-stop-20261117/README.md)。

## 验证

- `node --import tsx --test tests/n8n-hourly-retry-workflow.test.ts tests/automation-drain.test.ts tests/jackyun-page-selection.test.ts tests/jackyun-retry-budget.test.ts tests/n8n-retry-context.test.ts`：基线 75 通过 0 失败；改动后 79 通过 0 失败。
- `python -m unittest tests/test_n8n_schedule_watch.py`：29 个中 1 个失败，`test_v1_local_clock_baseline_preserves_delivery_behavior` 对 ps1 前缀的哈希钉子在基线上就已失效（基线前缀 `fbd2d226…`，钉子 `acee5435…`，由 cf05e971 引入的分条文案造成），不是本次引入，也未更新该钉子。

## 生产生效

本分支只改仓库定义，没有发布或导入任何 n8n 工作流。生产生效须按 2026-11-06 [`n8n-classifier-publish-20261106/REPORT.md`](../n8n-classifier-publish-20261106/REPORT.md) 的方式，只替换上述 3 个节点的 `jsCode` 并在 n8n UI 发布，这一步需要另行授权。

注意：

- ps1 不会随合并生效。钉钉命令调用的是主检出 `D:\运营管理系统\tools\n8n-manual-action-alert.ps1`，合并到 origin/main 不会更新它；旧 ps1 对未知 code 抛 `invalid_payload`，返回 `not_sent`，提醒节点 `continueErrorOutput` 后整条提醒静默丢失。发布前必须先让主检出 ps1 包含 `manual_action_content_invalid`，并用预览模式（不带 `-Execute`）验证退出码为 0，再发布 n8n。
- 生产现役共享错误工作流版本是 `dbe5c5ea`（2026-11-06，来源 `e3f2b1b8`），不含 `cf05e971` 的 `alertCode`，生产终局提醒至今使用通用 `terminal_manual_action` 文案。本次发布会同时首次上线 `cf05e971` 与本分支改动。
