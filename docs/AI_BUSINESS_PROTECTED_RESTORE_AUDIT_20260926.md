# 0068–0072 受保护 SQL 侧表的正式备份与异集群恢复阻断审查

状态：**阻断生产采用**。本审查只读源码，没有连接正式数据库、运行迁移、备份或恢复。`tools/protected-ai-restore-static-audit.py` 是保守静态探针：当前返回 `status=blocked`、退出码 2；将来返回 0 也只表示已知源码阻断消失，仍须真实隔离异集群演练。

## 现有路径与确定缺口

1. 正式 `tools/django-local-service.ps1` 以 `teruisi_sales_owner`、`NOSUPERUSER NOCREATEROLE` 执行 Django migration。`0068` 在 `install()` 中创建两个 NOLOGIN 角色、临时 `GRANT KEY_OWNER TO installer`、把密钥表和私有 MAC 函数转给 KEY_OWNER、撤回成员资格，然后再 `SELECT count(*)` 密钥表。普通 installer 无法创建/授予角色；即使预置角色，零成员约束使其不能靠预留 ADMIN 成员身份执行临时 GRANT，转移所有权和撤权后的 SELECT 也没有经过真实普通角色验证。`0067` 以及后续受保护角色迁移同样有建角前提。隔离测试以超级用户 `SET SESSION AUTHORIZATION` 模拟 NOLOGIN 角色，不能证明正式 migration 身份能安装。
2. 正式 `tools/django-postgres-maintenance.ps1` 的日常备份固定以 `teruisi_sales_owner` 调用 helper。`tools/postgres-consistent-backup.py` 先对所有 `protected_business_*` 表执行 `COUNT(*)`，再用相同账号 `pg_dump`。`0068` 密钥表由独立 NOLOGIN KEY_OWNER 所有，表和列禁止其他角色读取；普通备份账号没有该表的 SELECT，备份将拒绝。不能为使备份通过而向普通 Web、AI writer 或日常备份角色开放密钥 SELECT。
3. 当前 helper 的自定义归档备份带 `--no-privileges`，恢复带 `--no-owner --no-privileges`。PostgreSQL 17 文档说明 `pg_dump --no-owner` 对 archive 格式无效，而 `pg_restore --no-owner` 会令恢复连接用户拥有全部对象，`--no-privileges` 不重放 GRANT/REVOKE。因此单纯在恢复时去掉两个参数也未必能从**已有**归档找回已排除的 ACL；先用 `pg_restore --list` 和隔离恢复核实归档内容。当前形式必定不能维持 KEY_OWNER 私有表/函数所有权和精确 EXECUTE 授权。见 PostgreSQL 官方 [`pg_dump`](https://www.postgresql.org/docs/17/app-pgdump.html)、[`pg_restore`](https://www.postgresql.org/docs/17/app-pgrestore.html)。
4. 正式恢复演练确实 `initdb` 新集群，但 `Initialize-MaintenanceRehearsalRoles` 只预置旧服务角色，列表止于 `teruisi_ai_reader`/`teruisi_ai_writer`，没有 0067–0072 十二个受保护 NOLOGIN 角色，也没有更早的专用 AI 角色清单。其角色名校验 `^teruisi_[a-z_]{1,64}$` 还会拒绝含 `v11`/`v2` 的新版角色，即使直接加入数组也不能恢复。它不重放 Django migration、不重建对象所有权/ACL。`collect_evidence` 根据同一归档中的 `django_migrations` 调用 0068–0072 的 `verify_catalog`，其中 0068 要求密钥表和 MAC 函数仍归 KEY_OWNER、权限精确；即使行数与 revision 摘要一致，恢复探针仍会失败。此前升级演练在**同一**临时 PostgreSQL cluster 内 `createdb`、dump/restore，已有全局角色保留，且不走正式 operator，不能替代异集群验证。
5. `382c6e55` 已让 protected 表进入备份的存在性清单和行数摘要；这是必要的数据覆盖，但不是密钥表可读性、角色元数据、所有权/ACL 或恢复权限的证明。归档若含已启用的私钥，则它是高敏感备份，正式目录和 E 盘归档的静态加密、访问控制、密钥轮换与销毁边界需独立落实，不能把密钥值写入日志或证据。

## 最小受控修复顺序

1. **迁移安装**：先在全新隔离 PostgreSQL 17 以真实 `teruisi_sales_owner` 运行 0067/0068，证明按现状失败且事务零副作用；设计单次、可审计的特权安装通道来建 NOLOGIN/零成员角色及转移对象所有权，安装后回读全部角色属性、成员、KEY_OWNER 对象、SECURITY DEFINER 函数正文与 ACL。不得永久授予普通迁移/Web 账号 `CREATEROLE`、超级用户或私钥读取权。若拆分特权 bootstrap 与 migration，必须保证失败原子性/幂等和 migration 收据不早于安全目录验收。
2. **备份**：为含 0068 的库引入隔离的特权备份执行身份/进程或等效受控机制，允许读取私钥表但不扩展普通服务身份。保持 exported snapshot 对证据与 dump 的绑定，移除备份对 ACL 的抑制并验证归档 TOC/恢复后有效授权；升级备份 manifest 版本及精确工具摘要。归档与复制加密、最小可读 ACL、日志脱敏必须先到位。若采用外部私钥封存而将其排除于数据库归档，必须证明旧证明可验、密钥轮换与恢复一致性，不得仅以零行恢复冒充完整备份。
3. **新集群恢复**：在独立目录/端口上按可信 migration 版本白名单预置所有需要的全局角色，受保护角色 `NOLOGIN NOINHERIT`、零成员、无密码；普通业务角色的登录凭据另行受控配置。用经完整性批准的 archive、受控超级用户、`--single-transaction --exit-on-error` 重放原始 owner 和 ACL；不能保留当前两个抑制参数。恢复后先查角色属性/成员/表和函数所有权/ACL、SECURITY DEFINER 与密钥表行/摘要，再运行原 `collect_evidence`，比较 snapshot 内容；业务进程仍不连接隔离集群。
4. **回归门槛**：同一版本与跨版本空库分别做含 0068–0072 的全新 cluster 备份恢复，包括非空**合成**私钥和受保护表、负例角色/ACL 漂移、普通角色拒读私钥、旧版无这些 migration 的历史备份。保留源/归档/恢复三方的目录及授权摘要，而非只比较行数。通过后才考虑正式迁移/备份 operator 发布；正式生产恢复是另一项单独审批操作，不由演练自动覆盖。

静态复核命令：`python tools/protected-ai-restore-static-audit.py`。它不生成密码、触碰数据库或修改文件；当前非零退出就是明确阻断。生产仍没有授权部署 0068–0072。

## 隔离异集群原型（不是正式备份或迁移）

独立工作树中可运行 `python tools/ai-postgres-rehearsal.py --business-protected-cross-cluster-restore --upgrade-only --port <空闲55440–55999端口>`。新测试开关先完整重放 0072 的前驱链，然后在**第二个**新 `initdb` 集群中预置精确的 12 个受保护 NOLOGIN/NOINHERIT/零成员角色以及原合成集群的其他无密码角色。它只给源端写入一条随机合成私钥，完整 custom dump，目标端用合成超级用户在单事务内恢复原 owner/ACL；逐项执行 0068–0072 `verify_catalog`，比对 8 张受保护表完整行摘要和角色属性，证明普通 AI writer 不能 SELECT 私钥。目标所有权或函数 ACL 被故意改坏时，目录检查必须拒绝并回滚该负例。目标集群使用独立回环端口、独立数据目录与另一随机密码，成功/失败都只停止其所属进程。

首次原型运行的通过证据已在核验两个集群停机后归档为 `E:\codex-artifacts\ai-business-trial-acceptance-20260925\archived-pg\ai-pg-4f7953f8f7b8-protected-audit\protected-cross-cluster\evidence.json`，但首次版本尚未包含故意 owner/ACL 漂移负例。第二轮包含负例的完整演练证据在 `E:\codex-artifacts\ai-business-trial-acceptance-20260925\archived-pg\ai-pg-38e31f193b17-protected-audit\protected-cross-cluster\evidence.json`：0068–0072 目录验证、12 角色、8 表与 1 个合成密钥恢复通过，私钥表所有权和验证函数 EXECUTE 两项故意漂移均被拒绝并回滚。结束后源/目标 `pg_ctl status` 均为 no server running，目录已受控归档。这个结果只证明**隔离合成超级用户**保留了 owner/ACL。正式路径仍保持旧参数、旧备份身份和未加密归档；不能据此宣称正式备份可用、真实非超级用户 migration 可安装、真实密钥受保护归档完成或生产可恢复。
