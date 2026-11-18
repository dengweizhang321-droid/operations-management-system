# 京东物流流水 31 列、登录守卫与导入前失败闭合（2026-11-18）

基线 `main` e22dd208，分支 `codex/jd-logistics-flow31-login-20261118`。稳定规则见 [导入与自动化](../规范/导入与自动化.md)；本文记录问题、改动与检查结果，不代表已合并、已发布或已在生产闭合。

## 问题（2026-11-18 实测）

`JdLogisticsDaily2026` 每天 08:50 运行，当天有四处阻断：

1. 登录态过期时 `https://wl.jdl.com/bsc-inventory/flow` 跳到 `https://wl.jdl.com/login`，页内有两个 passport.jd.com 框架：`/common/loginPage`（可见，恰好 1 个账号框和 1 个密码框）与 `/common/mobile/loginPage`（body 不可见、0 个输入框）。`tools/jd-logistics-session.ts` 按 origin 统计所有 passport 框架且不看可见性，数到 2 即抛 `JD_LOGISTICS_LOGIN_CONTROL_AMBIGUOUS`，走不到只认可见输入框的 `autoLoginJdWithWindowsDpapiCredential`。
2. 流水 CSV 新增第 31 列：表头为原 30 列（`JD_FLOW_CSV_HEADERS`，顺序不变）末尾加 `销售平台单号`，`parseJdLogisticsCsv` 写死列数，报「CSV超过30列」。Django `_source_attributes` 接受任意额外文本列，导入按范围整段替换，无需改 Django、无迁移。
3. `tools/jd-logistics-n8n-pipeline.ts` 的 `code()` 把非 `JD_LOGISTICS_` 前缀的错误全部吞成 `JD_LOGISTICS_PIPELINE_FAILED_MANUAL_ACTION`，解析器中文报错无处可查。
4. 执行 11740（人工登录后运行）：流水导出已提交、`source.csv` 已下载，随后因问题 2 解析失败。manifest 为 `failed`、`failure={code:"JD_LOGISTICS_PIPELINE_FAILED_MANUAL_ACTION",stage:"run"}`，首项 operation 为 `exporting`（无 export/receipt 字段），其余 `planned`，通知 `pending`；`downloads/<runId>/<opId>/` 下有 `export-manifest.json`（stage `submitted`）和 `source.csv`。零效果闭合因失败码不在白名单且下载目录非空判 `not_closable`，此后每次 A 都报 `JD_LOGISTICS_PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION`。

## 改动

- 登录守卫（`tools/jd-logistics-session.ts`）：存在任一 passport origin 框架仍判为登录面；歧义判断与凭据目标只看可见框架（`frame.locator("body").isVisible()`，异常视为不可见）。可见多于 1 个仍抛 `LOGIN_CONTROL_AMBIGUOUS`，可见 0 个继续等待循环，可见 1 个作为凭据目标。`authorize(frame)` 额外要求 frame 就是选定的那个，否则 `LOGIN_ORIGIN_REJECTED`。失败码集合与「一次凭据尝试」语义不变，钉子测试的各码出现次数不变，无需调整。
- 流水 CSV（`lib/inventory/jd-logistics-workbook.ts`）：保留 `JD_FLOW_CSV_HEADERS`（30 列），新增 `JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER`（31 列）。流水 CSV 仅接受表头集合与两合同之一完全相等者，每条非空数据行列数必须等于表头列数；逐字符扫描的列数上限取两合同最大值。店铺商品 13 列合同不变。
- 失败码（新增 `tools/jd-logistics-source-file.ts`）：导出器与管线对下载文件的解析统一经 `parseJdLogisticsSourceFile`，解析器拒绝时落为 `JD_LOGISTICS_SOURCE_FILE_REJECTED_MANUAL_ACTION`（`_MANUAL_ACTION` 结尾，每小时重试分类器判终局），并把解析器原文一行写入 stderr（`[jd-logistics] source file rejected: ...`）。manifest 结构不变；该码不在零效果白名单。
- 导入前失败人工闭合：`tools/jd-logistics-zero-effect-closure.ts` 抽出共用的只读加载与 create-only 闭合协议（零效果闭合行为不变），新增 `assessJdLogisticsPreImport` / `closeJdLogisticsPreImportPlan` 等；CLI 在独立文件 `tools/jd-logistics-pre-import-closure.ts`（使用 `import.meta`，不得被 helper 打包闭包引用，已由 `tests/jd-logistics-helper-bundle-contract.test.ts` 钉住）。

### 「从未发起导入」的依据

`tools/jd-logistics-n8n-pipeline.ts` 在调用导入 API 前先 `operation.stage = "importing"; await persist(...)`（第 221 行），导入 API 调用在其后（第 223 行），`receipt` 与 `stage="imported"` 在返回之后才写入（第 235 行）。因此「无任何 operation 进入 importing/imported 且无 receipt」足以证明从未发起导入。

### 闭合判定（只读，全部满足才 closable）

active 与 manifest 的 runId/executionId/planHash 一致且通过 `assertLogisticsManifest`；`stage=failed`、`outcome=pending`、`failure.stage=run`；失败码不是 4 个凭据风险码；所有 operation 的 stage 只能是 `planned`/`exporting`/`downloaded`/`validated`，无 receipt 及未知字段；通知仍为 `pending` 且无结果。下载目录不要求为空、不删除、不移动，只列出文件清单和 sha256 写入证据；出现链接、未知条目、过深或过大一律不可闭合。

### 与自动零效果闭合的区别

- 只由人工 CLI 触发；A 阶段不会自动闭合此类计划。
- 目录前缀 `pre-import-<executionId>-<sha16>/`，intent 带 `kind: "pre_import"`、操作者原因、证据快照，committed 记 `committedBy: {channel: "manual_cli"}`。
- 中断续做只由该 CLI 完成（重跑同一条 `close --confirm`，要求 sha 与原因一致）；A 遇到未提交的 `pre-import-*` 直接保持 `PREVIOUS_RUN_UNRESOLVED` 拒绝，避免把带原因的人工闭合变成无记录的自动闭合。

## 验证

2026-11-18 在本分支（提交 10ab74cc）上：

- 相关测试 8 个文件（session、zero-effect、pre-import、flow CSV、source-file、pipeline、helper-bundle-contract、frontend）共 92 条全部通过。jd-logistics 全部测试中唯一失败的 `jd-logistics-workflow.test.ts`「…claim A B C D release chain」在基线 e22dd208 同样失败（时区期望 `Asia/Shanghai` 实得 `undefined`），非本次引入。
- `tsc --noEmit` 错误数基线 169、本分支 169，无新增；改动文件 eslint 无问题；`check-lint-baseline.mjs` 两边均为 65，无新增。
- helper 打包（全新空目录）exit 0；产物 `import.meta` 4 处与基线相同，CLI `tools/jd-logistics-pre-import-closure.ts` 未进入产物。
- 用本分支解析器离线解析 11740 实际下载的 `source.csv`（31 列）：5494 行，与导出前查询总数一致。
- 用本分支 CLI 对生产目录只读 `inspect`：11740 判 `closable`（`no_import_started`），未写任何文件。

## 上线后操作步骤（需另有上线授权）

1. 只读查看：`node --import tsx tools/jd-logistics-pre-import-closure.ts inspect <仓库根>`，确认 `verdict` 为 `closable` 且 active 指向 11740，记下 `activeSha256`。
2. 预演：`... close <仓库根> --dry-run`，核对将创建的 `pre-import-11740-<sha16>/`、证据中的下载文件清单。
3. 执行：`... close <仓库根> --confirm --expect-sha256 <activeSha256> --reason "<原因>"`。
4. 之后手动触发或等待 08:50 定时运行；该次运行会建新计划并重新导出。若再次失败，helper stderr 中有 `[jd-logistics] source file rejected:` 原文。
