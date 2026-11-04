# B 层：独立 PostgreSQL 17 合成 156→158

2026-11-04 完成。最终命令 `D:/teruisi-runtime/django-sales/venv/Scripts/python.exe -B tools/ai_task_feedback_candidates_rehearsal.py` exit 0，使用代码提交 `9f2d06a8` 的原始字节重新执行。结果见 [b-layer-result.json](b-layer-result.json)：13 类检查、824 个明确反例全部通过。结果内绑定 96 份相关源码的原始 SHA256，运行开始与结束一致；复核未发现差异。文件 gate、prepared 与最终回执链由 A 层另行证明。

## 环境与父态

- 二进制只读复用 PostgreSQL 17.11 和 venv Python；启动日志实际报告 `PostgreSQL 17.11`。
- 数据库 `teruisi_ai_feedback_candidates_rehearsal`，仅监听 `127.0.0.1:55512`；临时数据、合成凭据和环境均由脚本创建，不继承生产连接或复制生产数据。
- AI 明确固定到 `0087_pi_native_capabilities`，workflow 明确固定到 `0010_customer_service_chain_modules`，其他 app 使用当次图的精确 leaf。完整 targets 和 156 条 receipt 清单保存在结果内，并由祖代 `verify_receipt_generation` 认定为精确 156。
- 复用当前 `database_contract.provision`，以及 inventory/workflow 服务原始 here-string 的实际 provisioning；未手抄祖代授权清单。全部祖代 catalog 和 ACL 同时通过。
- 四张 workflow 父代表均含合成行：3 条模块注册记录，以及 logical run、attempt、module result 各 1 条。保留摘要计数为 6，安装与 provision 后的行和权限摘要不变。

## 本代实测

1. 实际运行新 addition 的 `install_schema` 和 `apply_steps`。0088 完成后，在 0089 创建 guard 时让 PostgreSQL 真正执行 `SELECT 1/0`；外层事务回滚两表、两函数及 migration receipts，仍为原 156，原行和 ACL 不变。
2. 拒绝过时 preservation intent、157/部分父态及已安装后的重放。正式安装同一批两个迁移后认定为 158，两表为空且严格 owner-only，最终 ACL 门禁此时拒绝通过。
3. 用真实 psycopg 连接执行真实 `provision`。仅在实际新表 GRANT 传输点注入 PostgreSQL 除零错误，其余 SQL 原样执行；确认该点确实命中一次。整个 provision 事务回滚，两表仍 owner-only，旧 ACL 保持，最终数据库门禁拒绝，不产生 finalized 文件。完整文件级 finalize 拒绝由 A 层覆盖。
4. 通过实际 `install_schema('reconcile', ...)` 确认已提交 158。`apply_steps` 使用一旦调用就失败的哨兵，实际 SQL 同时审计；观察到零 CREATE/ALTER/DROP，未重放迁移。
5. 再真实执行 `provision` 成功，严格匹配 AI writer `SELECT/INSERT/UPDATE/DELETE`、AI reader 零表授权；最终全部祖代与本代 catalog 通过，精确 158，无 pending migration。
6. 714 个表/函数快照叶值分别改坏，保持真实数据库不变并调用真实比较函数，每项均拒绝，其中 120 项属于新增外键内部 trigger 属性。另以真实 SQL 在回滚事务中改坏列、CHECK、索引、六个用户 trigger 的启用状态、函数体/安全属性/配置/ACL，以及两表 ACL，均被拦截。每个 CHECK 和独立索引都有移除反例。
7. 修改 workflow 旧行或 ACL 会改变 preservation；累加超过 500000 的父计数在 DDL 前拒绝。新增模型默认值逐项改坏均被拒绝，之后恢复原 Field 及缓存。
8. 只定位两张新表 FK 所属的 8 个原生 RI 内部 trigger，包含新表上的 INSERT/UPDATE 与被引用表 `ai_pi_operations` 上的 DELETE/UPDATE；逐个实际 DISABLE，查询确认启用状态已为 D，再以完整 `verify_catalog` 验证，8 项均拒绝。每项事务回滚后原结构恢复通过。

## 冻结 catalog

`tools/ai_task_feedback_candidates_catalog.json` 来自独立 PG17 的真实迁移与真实最终 provision，采集命令 exit 0。不是从生产学习，也未改写祖代基线。

| 对象 | 列 | CHECK（含自动正数约束） | 全部索引（含 Django 自动索引） | trigger |
| --- | ---: | ---: | ---: | ---: |
| ai_task_feedback | 16 | 8 | 7 | 3 |
| ai_skill_candidates | 18 | 7 | 7 | 3 |

两个条件唯一索引均保留真实 predicate。两个 guard 的源码、完整定义、签名、trigger 返回值、plpgsql 语言、owner、search_path、安全属性与 ACL 均冻结。函数保留迁移产生的 OWNER/PUBLIC EXECUTE 原状；表权限的 owner-only/最终 writer 四权限分两个阶段核验。

每张新表的 `foreignKeyTriggers` 另冻结其 FK 对应的 4 个原生内部 trigger，覆盖父子两端。仅记录作用表、约束所属表、对端表、约束名、事件/启用/延迟属性、系统函数身份及参数，共 15 个稳定字段；不固定 OID、系统随机 trigger 名或带随机名的完整定义。不扩展祖代 collector 或全库触发器快照。

审查补项的修复前实证保留在 [b-layer-fk-internal-probe.json](b-layer-fk-internal-probe.json)：8 个 RI trigger 实际禁用后，旧窄 catalog 拒绝 0 项。修复后实证单独保存在 [b-layer-fk-internal-probe-after.json](b-layer-fk-internal-probe-after.json)：完整 catalog 拒绝 8/8，全部回滚还原。旧 696 反例版本的结果原样保存在 [b-layer-result-before-fk.json](b-layer-result-before-fk.json)，只作为历史覆盖范围记录，不作为最终实现的通过证明。

无数据库静态检查 `tests/ai158-acl-catalog-boundary.py` 实际 exit 0、48 项检查通过；执行原始 grant 定义与 catalog 比较函数，核两表 ACL、迁移不 GRANT、guard 源码与六 trigger 绑定及 ACL 反例。`tools/check_catalog_baselines.py` exit 0，OWNER 八权限含 MAINTAIN 无漏项。原始输出与退出码见 [b-layer-static-execution.json](b-layer-static-execution.json)。

## 清理、失败记录与边界

最终私有目录 `.codex-tmp/ai158-pg17-n84kqrkd` 的 child/stop 均 exit 0；集群已停止，password 文件和 data 目录已删除。保留私有非敏感日志；结果里的五项 cleanup 值均为 true。修复前探测目录 `ai158-pg17-fxgrtpxm` 和重采目录 `ai158-pg17-45n7xl5l` 也已停止并删除 password/data。

先前一次完整演练因测试脚本没有将原生 `psycopg.errors.DivisionByZero` 纳入预期拒绝而 exit 1（目录 `.codex-tmp/ai158-pg17-b1sd4uwn`）；已修复异常类别并重跑，失败日志保留。该次也正常停止并移除 password/data。随后通过的 683 反例版本，在补齐总行数边界、默认值和源码绑定后成为 696 反例版本；再修复上述真实 RI 漏检并独立重采快照、完整重跑，最终为本报告的 824 反例版本。

本层未执行生产连接/迁移、PrepareApp、DeployApp、控制包采用、发布、备份或恢复，也未声称原生冷启动或 AI 业务效果验收。直接调用的私有函数接缝不改变生产 CLI 的固定 runtime/身份约束。成功 finalize 文件绑定与控制器参数边界由 A 层及总报告说明。A 层真实验证新 158 和 workflow156 回执与 baseline 递归；154 以下父证明使用合成接缝，未声称全祖链真实回执验证。
