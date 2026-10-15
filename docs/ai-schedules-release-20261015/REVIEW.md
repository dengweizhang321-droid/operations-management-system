# 0083 正式准入与备份恢复增量独立审查

日期：2026-10-15。角色 `critical-review`，请求 `gpt-6.1-sol/xhigh`；实际底层型号未获工具独立确认。审查者未参与实现、未转派，未操作生产，仅写本报告。

**源码审查通过，当前未发现剩余准入阻断。** 本结论覆盖本轮有限 142→143 准入及备份恢复增量；正式组合、PrepareApp、Worker plan、维护和发布的精确绑定另审，不能将源码通过当作已生成正式制品或已完成部署。

## 授权与审查范围

用户已明确授权合并 main 并发布。旧保护点取舍另获明确授权：仅替换 `daily-20260928T125351Z-31cb501bc72d`，manifest `36f3c99be1a9c23421547a70600006d0a05027e5bc40e5579e4d973189b14ad5`；保留 9 月 29 日保护点。新 142 前备份、Verify 和同点隔离恢复成功后才允许原 Unprotect→Protect 新前点，仍受两保护点与三恢复点限制。当前只是授权和计划，未据此声称操作已执行。

已重读共享记忆启动要求、当前项目入口和开发交付、模型分工、验证发布、存储、权限、运行及相关发布/恢复专题。复用原 25 文件试点审查和有效功能验证，新增审查范围为：

- 独立 AI schedule addition、两表 catalog、私有演练及有限步骤证据。
- Django PrepareApp/DeployApp/启动与 integration gate 的 143 优先分派。
- no-key 138/139/140/142 兼容和新 143 catalog，PowerShell 备份证据契约。
- 原 `bi-app-adopt.ps1` 的 AiSchedule 接缝、精确 prepared 前备份及同一新前点 Protect，直接相关测试。

## 冻结绑定

| 证据 | SHA-256 |
| --- | --- |
| `ai_schedule_addition.CODE_FILES` 九文件闭包 | `ad495305af1d6a2901bdb77e32c36041bc385393b14ac6ac271ce8354c17dd5f` |
| 最终隔离 `schedule-validation.json` | `5e3e855754f134c0f554b8761b8bc8bd195b37eb50abcde3116062bee43a92be` |
| 完整规范化 migration inventory | `eeeca0033aba72e1ccb7dee6021dae57fda4ddb0b9eb42b9544e2b23fc697a63` |
| 正式两表与两函数只读 catalog 原件 | `a9de99f5abb55f71a88e71e21471fc5b4df5236b9462a27f01b417afb830f5f4` |

九文件闭包摘要由审查者独立调用当前 `code_digest` 重算一致。最终演练位于 `.codex-tmp/ai-schedule-addition-fmunc4gi`；生产 catalog 原件为 `D:/codex-artifacts/ai-schedules-production-20261015/production-schedule-catalog.json`。生产参考采集脚本使用固定 owner、5432、READ ONLY 和 15 秒时限，只读 metadata/函数体摘要；审查者已读取原件与脚本，未再次查询生产。最初 `/32` 地址格式导致的身份拒绝与后续成功是两个事实，不能回填为首次成功。

## 关键逻辑结论

1. 只准入固定 SHA 的 `ai_assistant.0083_schedule_execution_profile`，旧 migration 内容和集合必须保持。父 142 谱系从保存的原基线验证；新增 active 指针独立，原 Jackyun、BI、integration 记录不改。143 在 Django 和 integration 层优先路由；普通启动只验证已完成代际，不承接待安装步骤。
2. 两表固定完整 142 结构，并只允许目标九列与五个 CHECK 的 143 扩展。核对原列顺序、类型、可空性、默认表达式、identity/generated/collation、owner、RLS、policy、全部约束和索引有效性、trigger 及精确表/列 ACL。触发器完整定义包含 WHEN 与 UPDATE OF，两个公共函数核对正文 SHA、owner、ACL、语言、返回类型及配置。
3. 旧行内容按固定 142 原列流式摘要比较，保留原任务、unknown/sent 槽及身份；新列回填值另验。持久 intent 在事务前记录；事务内原 owner、advisory lock、精确旧目录和唯一待迁移步骤共同约束安装。提交后回执丢失只能按原 intent 和 143 实际状态 reconcile，不重执行 migration；原始临时发布证据不会被覆盖清除。
4. 旧代拒绝未登记/部分 0083 结构，143 备份校验是只读 catalog，不依赖 finalized active，避免后备份与 Finalize 循环依赖。原私钥空表 SHARE 锁、闭合角色和 owner/ACL 恢复、序列保护继续执行；没有“无新表/密钥即跳过”的入口。
5. prepared 前备份只允许本次 AiSchedule 证据、确切 PrepareApp receipt/manifest、维护 owner 和实际 142 前驱；保留原 service→PostgreSQL 互斥顺序、DPAPI、归档与保留。软件身份仍标实际 142，候选工具身份单列。Plan/load_plan 再核前点单列身份，不能借用另一候选的 prepared 前点。prepared Protect 仅接受该维护窗口中同一精确 fresh 142 点，未开放 prepared Unprotect 或任意归档保护。

## 已关闭的关键发现

| 原问题 | 关闭证据 |
| --- | --- |
| 新 helper 最初只查九列，父 142 也未核定时表完整旧结构；删旧 name、加列或放宽 ACL 仍可能被接纳 | 改为固定完整两表及函数 catalog；真实 PG 对旧列、约束、索引、RLS、表/列权限和函数 owner 的负例均拒绝 |
| 只查 trigger 名称、类型和参数会漏过 `WHEN(false)`、`UPDATE OF prompt` | 纳入完整 `pg_get_triggerdef`；真实 PG 在 142 与 143 均运行两项改写负例并回滚 |
| prepared 前点只在生成时绑定，Plan 可借其他候选同窗口的前点 | Plan/load_plan 绑定 candidate evidence、prepared manifest/receipt、ID 与维护 owner，跨候选和 owner 负例通过 |
| 旧 PowerShell no-key 仅接受到 140，且 prepared Retention/Protect 不适配新 142 前点 | 增加精确有限代际与同一候选前点的受控接缝，仍由原归档/保留/保护操作执行，不修改旧 pin 文件 |

## 验证与实际限度

- 审查者在冻结源码上独立执行 `tools/test_ai_schedule_addition.py`：8 项通过。
- 审查者分别在 Windows PowerShell 5.1 与 PowerShell 7 执行 `tests/ai-schedule-prepared-maintenance.test.ps1`：各自通过 9 个负例。它们使用合成函数替身，验证请求、维护 owner、开关、候选及精确前点边界；没有调用正式备份或修改 pin。相同负例跨主机执行不累加为新的独立业务覆盖。
- 审查者已读最终 `fmunc4gi` 的通过回执、演练源代码、142/143 dump/restore、PS 代际及 stop 日志：两个代际均从 exported snapshot 导出，并在独立 cluster 恢复，比对全部内容、owner/ACL/catalog；旧两表原列摘要相等，注入失败回滚、唯一安装及未知不重放、reader 新列读取/拒写和 writer 不可写库存均有对应验证。两代 PS5/7 metadata 契约各含三项未知/重复/不完整代际拒绝。
- 最终演练 `codeSha256` 与当前闭包一致；较早 `97rgq95x` 通过记录仍保持旧摘要，后续接缝变化没有倒填旧证明。已读取原 legacy 10 项通过日志；历史测试为隔离新增两表检查而使用的 mock 已明确标注，其完整 catalog 由新真实 PG 演练覆盖。
- `git diff --check` 独立通过。上述证明均为开发/隔离验证，不能表述为正式 PrepareApp、142/143 生产备份恢复或生产安装已经通过。

## 发布执行边界

正式生产来源应保留未采用的 Agnes 五行尾帧兼容缺失，仅组合本次改动；真实组合的 provider 专项和完整差异另行绑定。main 与生产组合提交不能混称整树相同。准备与执行须按同一脚本、composition/admission、source/main commit、双组件前驱及制品 tuple 再复验。

主代理独占普通用户发布操作。按本轮计划先完成新 142 前点及恢复，再唯一 Install 0083，143 后点及同点恢复、Finalize 后恢复服务；迁移提交后只走兼容 143 的前向修复，不直接运行不兼容旧包或自动恢复生产数据库。失败/未知保留原审计和 owner，先核精确效果，不能借新 operation 重放。

广东仓唯一文字任务采用原 save API 做 v2→v3 的 `executionMode` 定向 CAS，属于原需求的正式采用；原 prompt、空模型绑定、目标/staff、周期、开关和下次槽保持，截图任务与旧 run 不动。版本/唯一性变化则停止该配置写入；不 run_now、不人工模型试问、不额外外发。真实供应商 JSON/SSE 与钉钉受理仍保持各自未验证边界。
