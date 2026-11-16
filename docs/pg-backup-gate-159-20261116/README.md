# 每日 PostgreSQL 备份闸扩到第 156/158/159 代（2026-11-16）

## 现象

生产每日无新增密钥备份最后一次成功是 2026-10-30（第 154 代）。11-08、11-10、11-14 三次正式 Backup 都在 `consistent_dump` 阶段失败，审计 `reasonSha256 = 9ddb7005…` 等于 `sha256(UTF-8 "无新增密钥备份迁移代际未获核验")`，`sourceLine=403`。

## 根因

无新增密钥备份由两层分别校验迁移代际：

| 层 | 文件 | 允许到 |
| --- | --- | --- |
| Python 证据工具（导出前） | `tools/postgres_no_key_backup.py` | 156 / 158 / 159（`90bec5d9`、`9f2d06a8`、`47b8e878` 随 addition 扩展） |
| PowerShell 收尾校验（导出后） | `tools/django-postgres-maintenance.ps1` `Assert-MaintenanceNoKeyGeneration` | 154（`d95852dd` 之后再没扩） |

生产已到 159 代，所以 Python 放行、`pg_dump` 跑完约 10 分钟，PowerShell 再拒绝。

修第一处后审查发现**第二处必然失败**：`Assert-MaintenanceEvidence` 要求证据里每张 `ai_*` 表都在已采用清单内，而 0088/0089/0090 新建的 7 张表（`ai_task_feedback`、`ai_skill_candidates`、`ai_task_definitions/revisions/grants/runs/incidents`）在 PowerShell 侧没有登记；Python 侧由 `backend/ai_assistant/table_manifest.py` 承认。只修代际会在下一行以 `AI table is outside the adopted inventory` 失败。workflow 0009 的 `automation_*` 表不在证据前缀内、不会触发；`pg_dump` 是整库导出，它们照常被备份。

## 修复

- `Assert-MaintenanceNoKeyGeneration`：新增 workflow 0009/0010、ai 0088/0089/0090 五个计数器；允许 156/158/159，不允许 155/157（成对安装）；所有累计清单同步扩展；`finance_erp_targets` 清单同步扩展。138 项目录与其摘要不变。
- 新函数 `Get-MaintenanceAiTaskTables`：按迁移回执承认 7 张表，缺前驱、重复回执、无回执而表存在一律拒绝；在 `Assert-MaintenanceEvidence` 的 `ai_*` 清单检查之前调用。
- `tests/test_postgres_no_key_generation_159.py`：真实 PowerShell 5.1 与 7 双宿主行为测试。
- `tests/schema-addition-enumeration-consistency.test.mjs` 关系 8（CI 运行）：`main-schema-release.mjs` 的每个 `toGeneration` 必须出现在该 `.ps1` 的允许代际清单和 `finance_erp_targets` 清单中。下次建新一代漏改会在合并前变红。

## 必需检查（2026-11-16）

- 两种 PowerShell 解析：0 错误；文件保持 UTF-8 BOM + 全 CRLF。
- 新测试 5/5；既有代际测试（JD 148、JD 146/147、天猫 149）全部通过；CI 绊线 32/32。
- `tests/django-postgres-maintenance.test.ts`：分支与 `d26e4e67` 基线失败集合完全相同（同为 3 个既有失败），无新增失败。
- 独立注入 8 个变异：6 个被测试抓到；其余 2 个经实测为等价变异（138 项目录计数使 `sales12` 条件无法单独被违反；`+=` 对空返回不追加 `$null`，两宿主实测）。

未做：功能验收、生产只读预检、真实备份（按 AGENTS.md 由上线后检测）。

## 交付与上线

载荷是 `tools/django-postgres-maintenance.ps1`（随 Django app 发布）。该脚本不在 `maintenance-controller-qualification` 的字节钉子内，无需追加控制器资格哈希。它属于第 140–159 代 addition 的 `CODE_FILES`，会改变 `code_digest`；但 `check_schema_code_digest.py --recipe ai-0090.json` 在 `d26e4e67` 上已因其他文件变更失败，与本改动无关，需另行处理。

上线后：先确认没有心跳会话持有旧的暂停指令，再在 Codex 界面启用自动化 `e`（自 2026-11-14 23:00:03 为 PAUSED），核对 `status` 与 `updated_at` 同步变化。
