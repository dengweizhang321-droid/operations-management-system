# 财务分析 Django 后端迁移手册

## 1. 当前结论与边界

本批只迁移“销售分析 → 财务分析”的后端，不重做前端模板。既有页面、交互和三条公开 API 保持兼容：

- `POST/GET /api/imports/finance`
- `GET /api/finance/analysis`
- `GET/POST/DELETE /api/finance/targets`

截至 2026-08-30，Django 代码、历史迁移、权限隔离、单写切换和真实 HTTP 联调只在隔离环境完成。本机正式环境未部署财务 Django 进程、未修改正式 D1、未切换 Worker，财务唯一权威仍是 Worker/D1。销售 Django/PostgreSQL、ERP bridge、其他页面和自动化不属于本次切换单元。

## 2. 目标拓扑

```text
现有浏览器页面
  -> 公开 Worker：真实 principal、权限/scope、Excel 解析、HMAC、体积和超时边界
     -> finance_reader（建议 127.0.0.1:8011）：分析、导入历史、目标读取、有界消费者
     -> finance_writer（建议 127.0.0.1:8012）：规范化导入、目标写入/删除
        -> PostgreSQL finance_*：唯一权威事实、revision、幂等和审计
```

建议端口是财务专用保留值，正式配置前仍须检查占用。两个进程必须使用不同 URL 和不同数据库身份；不能共用销售的 `8001/8002` 进程或凭据。财务故障只使财务 API 失败关闭，不能改变销售、ERP 或其他模块的可用性。

## 3. 已实现契约

- Django `finance` app 拥有财报批次、月份、行、目标、版本、删除审计、内容指纹、导入尝试、scope head、请求 receipt、revision、迁移运行和 write authority。
- 现有 TypeScript Excel 解析器继续输出 `finance-normalized-v1`；Django 二次校验所有字段、金额分、比率基点、月份归属、稳定身份、总行数和业务指纹。
- 内容相同但文件名、行序或对象键序不同返回 `duplicate`；同范围内容变化在一个 PostgreSQL 事务中完整替换。
- 写请求 receipt 同时绑定 actor、method、path、原始 query 摘要和 body 摘要。DELETE 没有正文时仍绑定 query，防止同 request ID 删除另一目标。
- 读写路由按进程角色拆分。reader 成功响应必须携带合法 `X-Finance-Data-Revision`；writer 必须匹配激活的 authority epoch 与 cutover ID。
- reader 数据库事务只读；writer 只能写财务业务表，不得更新 authority，不得写销售事实。authority 只能由 migration owner 在切换命令中改变。
- reader readiness 要求 PostgreSQL 提供 `zh-Hans-CN-x-icu`；店铺选项按与浏览器 `localeCompare("zh-CN")` 一致的 ICU 规则排序，等额费用项保持源顺序，避免 PostgreSQL 默认 collation 或 Python set 造成响应漂移。
- 全局搜索在 Django 模式只调用固定的 `line_search`、`target_search`、`import_batch_search`，不接收任意 SQL、表名或排序表达式。

## 4. Worker 路由模式

| 模式 | 读取 | 写入 | 用途 |
| --- | --- | --- | --- |
| `legacy` | D1 | D1 | 当前正式默认 |
| `shadow` | 返回 D1，后台脱敏摘要比较 Django | D1 | 上线前只读观察；禁止双写 |
| `django` | finance_reader | finance_writer | authority 激活后的正式模式 |

reader/writer URL 必须不同。Django 模式遇到超时、重定向、签名错误、响应超限、非 JSON、revision 缺失或服务不可用时直接失败关闭，不查询或写回 D1。

## 5. 历史迁移门禁

先从权威 D1 创建财务专用、不可变的演练副本；该工具只读源，只复制财务表和共享导入控制表中 `domain=finance` 的行：

```powershell
python tools/finance_d1_rehearsal_snapshot.py `
  --source <权威D1绝对路径> `
  --output <新的finance-source.sqlite> `
  --authority-sql drizzle/0093_finance_write_authority.sql `
  --manifest <新的source-manifest.json>
```

迁移命令必须使用 `migration_writer` 和 PostgreSQL migration owner。省略模式是 dry-run；apply 只能消费一个材料完全一致的成功 dry-run，verify-only 只能核验对应成功 apply：

```powershell
cd backend
python manage.py migrate_finance_from_d1 --source <finance-source.sqlite>
python manage.py migrate_finance_from_d1 --source <finance-source.sqlite> --apply --approved-run-id <dry-run-id>
python manage.py migrate_finance_from_d1 --source <finance-source.sqlite> --verify-only --approved-run-id <apply-run-id>
```

命令会拒绝：源与目标是同一文件、非只读源、schema 缺失、非 completed 批次、月份所有权不完整、进行中的导入、非 `d1` authority、零事实、超过行数上限、源在审批后变化、审批复用、目标回查不一致或生产角色不是 `migration_writer`。

早期批次若缺少现行内容指纹，或旧指纹已经与当前已发布事实分歧，迁移只从该批次当前拥有的完整月份和事实行按当前算法确定性重建。系统额外写入 `finance-legacy-audit-synthesis-v1` 审计，记录 `missing_source_fingerprint` 或 `source_fingerprint_diverged_from_current_facts`，并保留原始哈希；它不冒充原始导入尝试。

reader 启动后可执行真实新旧分析响应对比。密钥只放环境变量，工具仅输出场景标签、摘要和首个差异路径，不输出财务值或店铺名：

```powershell
$env:TERUISI_DJANGO_INTERNAL_SECRET = "<内部HMAC密钥>"
node --import tsx tools/finance-analysis-parity.ts `
  --source <finance-source.sqlite> `
  --reader-url http://127.0.0.1:8011 `
  --writer-url http://127.0.0.1:8012
Remove-Item Env:TERUISI_DJANGO_INTERNAL_SECRET
```

正式本机运行必须使用受保护 runtime 中的操作者脚本，不能从源码工作树直接解密凭据或修改 authority。服务配置从 v3 升级到 v4 时，顺序固定为：完整停止 Django 本机栈、用源码脚本 `Configure` 和 `DeployApp`、执行 `HardenAcl`、从已部署脚本执行 `ProvisionFinanceRoles`，最后再执行 `Start`。首次启动只会启动 `8011` reader；PostgreSQL 财务 authority 仍为 `d1` 时，`8012` writer 保持停止。

```powershell
$sourceService = "<隔离工作树>\tools\django-local-service.ps1"
$runtimeService = "D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1"
$financeOperator = "D:\teruisi-runtime\django-sales\app\tools\django-finance-cutover.ps1"

& $sourceService -Action Stop
& $sourceService -Action Configure -ErpSourceD1 "<精确权威D1绝对路径>"
& $sourceService -Action DeployApp
& $runtimeService -Action HardenAcl
& $runtimeService -Action ProvisionFinanceRoles
& $runtimeService -Action Start
& $runtimeService -Action FinanceStatus -Json

& $financeOperator -Action Snapshot
& $financeOperator -Action MigrateDryRun -FinanceSource "<Snapshot返回的受控sqlite路径>"
& $financeOperator -Action MigrateApply -FinanceSource "<同一路径>" -ApprovedRunId "<dry-run-id>"
& $financeOperator -Action MigrateVerify -FinanceSource "<同一路径>" -ApprovedRunId "<apply-id>"
```

`Snapshot` 只在 `D:\teruisi-runtime\django-sales\audits\finance-cutover\` 下生成 SQLite 快照和清单。`MigrateApply`/`MigrateVerify` 必须消费同一路径、同一内容和精确前序 run ID；脚本在内存中使用 migration owner，日志只记录有界诊断。

## 6. 正式不停服切换顺序

除“财务写入短暂停顿”外，其他模块持续运行。任何一步失败都停止在当前阶段，不重启销售服务，不改变其他模块配置。

1. 确认销售、ERP、Worker 和其他模块健康；确认财务路由仍为 `legacy`。
2. 生成并验证 PostgreSQL 备份；对权威 D1 做精确财务快照和清单，不修改源。
3. 部署独立 finance_reader/finance_writer 代码和最小权限数据库角色，但只启动 reader；writer 尚无激活 authority，必须保持停止，若被误启动则 readiness 失败关闭。
4. 执行初次 dry-run/apply/verify-only，在 `shadow` 只比较读取。影子异常不改变用户响应。
5. 在财务导入和目标维护入口短暂停写；销售总览、渠道、品类和其他系统继续运行。
6. 对最新权威 D1 重新执行财务快照、dry-run/apply/verify-only，并核对公开分析、导入历史、目标、权限、scope、幂等和响应契约。
7. 仅由操作者将 operator-only `0093_finance_write_authority.sql` 应用于精确 D1；普通 Drizzle journal 不得自动应用该迁移。
8. 用同一个成功 verify run 和唯一 cutover ID 执行 `--prepare`；此时 D1 财务写保护生效，但尚未允许 PostgreSQL writer。
9. 若 writer 尚未接流量且检查失败，可用同一 verify run/cutover ID 执行 `--abort-pending` 回到 D1。检查成功后执行 `--activate`，记录返回的 authority epoch。
10. 用独立财务 writer 凭据、相同 epoch/cutover ID 启动 finance_writer，确认 readiness；再将 Worker 模式原子切换为 `django`，完成真实公开读写和落库回查。
11. 恢复财务入口，持续观察。其他模块的进程、端口、数据库角色和路由配置全程不变。

authority 命令骨架：

```powershell
python manage.py finance_write_authority --source <权威D1> --prepare --verify-run-id <verify-id> --cutover-id <唯一cutover-id>
python manage.py finance_write_authority --source <权威D1> --abort-pending --verify-run-id <verify-id> --cutover-id <唯一cutover-id>
python manage.py finance_write_authority --source <权威D1> --activate --verify-run-id <verify-id> --cutover-id <唯一cutover-id>
```

正式环境对应的受保护入口如下；每次 authority 变化前都会再次证明 `8012` 无监听且没有登记的 finance writer：

```powershell
$financeOperator = "D:\teruisi-runtime\django-sales\app\tools\django-finance-cutover.ps1"
& $financeOperator -Action InstallD1Authority
& $financeOperator -Action AuthorityStatus
& $financeOperator -Action AuthorityPrepare -VerifyRunId "<verify-id>" -FinanceCutoverId "<cutover-id>"
# 仅 prepare 后、activate 前发生失败时允许：
& $financeOperator -Action AuthorityAbort -VerifyRunId "<verify-id>" -FinanceCutoverId "<cutover-id>"
& $financeOperator -Action AuthorityActivate -VerifyRunId "<verify-id>" -FinanceCutoverId "<cutover-id>"
& "D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1" -Action StartFinance
```

## 7. PNR 与恢复

`prepare` 后、`activate` 前且 PostgreSQL writer 未接收请求时，可以用 `--abort-pending` 恢复 D1 财务写入。`activate` 和第一笔 PostgreSQL 权威写入后即跨过 PNR，不允许把 Worker 切回 legacy、让 D1 继续写或执行反向迁移。

PNR 后的恢复只允许：兼容 Django/Worker 版本、PostgreSQL 备份/WAL/PITR、或审批过的前向修复。D1 财务对象在稳定观察、旧路径不可达证明和独立退役审批前保留为受写保护的审计材料；不能作为回滚事实源。

## 8. 2026-08-30 隔离演练证据

演练使用权威 D1 的只读财务投影生成约 21.58 MiB 的专用副本，随后在独立数据目录、`127.0.0.1:55439` 临时 PostgreSQL 和临时 Django 端口完成；正式 D1、正式 PostgreSQL、Worker 和在线进程均未修改或重启。

| 项目 | 结果 |
| --- | --- |
| 财务批次 / 月份 / 行 | 3 / 19 / 40,233 |
| 目标 / 删除审计 | 0 / 0 |
| dry-run | `13a7d4f41314444d88f7a77d52c9c31c` |
| apply | `fb1a7cfdd9ce4f369a0505ebf8a20d65` |
| verify-only | `2e6c83706ffb4ac383cc3c17b94495b9` |
| 目标投影摘要 | `89cd0f9ab86e4373399fbc66be0deaa85f3e17af8bf2b75587937186e3f852d0` |
| authority 演练 | prepare → abort → prepare → activate 全部通过 |
| 数据库权限 | writer 不可更新 authority/销售事实；reader 只读；财务目标写权限正常 |
| HTTP 联调 | 独立 reader/writer 的分析、目标创建、请求重放、revision 推进和 reader 可见性通过 |
| 新旧响应对比 | 19 个单月、默认、全量、连续两月、5 个平台及 8 个店铺共 35 个分析场景逐字段摘要全部一致；导入历史和目标读取契约一致 |

演练结束后临时 Django 和 PostgreSQL 监听均已停止。该证据证明候选实现可迁移和可隔离运行，不代表正式环境已经切换。

## 9. 正式验收清单

- 前端模板文件无改动，财务页面现有操作与字段契约全部通过。
- 财务公开读写、重复提交、内容变化、删除 query 重放、并发 owner、旧 owner 迟到、非管理员、受限 scope、HMAC 篡改和服务故障均通过。
- reader/writer 分离、数据库最小权限、revision 和 authority readiness 通过。
- 最新历史迁移的表计数、逐投影摘要和公开 API 新旧结果一致；迁移后新导入的 duplicate 行为一致。
- 销售总览、渠道、品类、销售导入、ERP bridge、全局搜索中的非财务来源和其他导航模块回归通过。
- 正式部署、Worker effective head、切换 receipt、备份/恢复证据和观察结果均已保存后，才能宣布财务迁移完成。
