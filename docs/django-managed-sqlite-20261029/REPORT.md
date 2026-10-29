# Django 受管应用树 SQLite 兜底修复

状态：开发候选，待用户核阅；未合并 main、未准备制品、未发布。

基线：`491c14081e65a905d8cc31d4f6d37b086b8dbc34`。分支：
`codex/django-managed-sqlite-20261029`；独立树：
`D:/codex-isolated/django-managed-sqlite-20261029`。

## 选择与实现

采用 b：`BASE_DIR.parent / "deployment.json"` 是受管应用的保留标记。
`Prepare-Application` 在封存候选根写该文件，`Deploy-Application` 将整树移动到安装根，
因此标记覆盖已封存候选、已安装应用及保留该标记的旧应用副本，不依赖机器盘符或目录名。

在没有 `TERUISI_DJANGO_DATABASE_URL` 的分支，先对标记做 `lstat()`：
只有 `FileNotFoundError` 才继续原开发兜底；存在文件、空文件、坏 JSON、目录或链接
均拒绝，其他访问异常自然失败。检查发生在 SQLite 路径构造和 `mkdir()` 前。
不解析清单、不复刻部署校验，也不改变完整性算法或排除项。
受管目录中显式设置 `TERUISI_DJANGO_SQLITE_PATH` 也不能启用 SQLite。
URL 分支仍只支持 PostgreSQL，原生产环境、密钥、角色及连接限制保持。

| 方案 | 取舍 |
| --- | --- |
| a：移动默认路径 | 可以避免默认位置污染，但仍把配置缺失静默变成另一套数据库；全局改路径还影响既有开发数据发现，临时目录也不适合持久开发库。本次不采用。 |
| b：受管安装拒绝兜底 | 直接消除本次误配置写入，开发默认路径和自定义路径均保持；修改最小且可用已有部署标记识别。采用。 |
| c：扩大环境拒绝或改默认环境 | 会影响 `manage.py`、`tools/django-dev-backend.mjs` 的 SQLite 开发模式和隔离预览；为解决受管树问题不必改变全局默认值。本次不采用。 |

本次不是通用写入沙箱，也不将“标记存在”等同于清单有效。
如果标记本身丢失，该局部判断无法识别这棵树；已有安装/启动清单门禁仍负责拒绝缺失或损坏清单。
不能通过删除标记把安装目录当开发树。正式 PostgreSQL 配置完整但环境值错误的其他安全语义
不在此次修改内；此补丁没有自动把所有受管进程改成 production。

## 回归覆盖

新增 `backend/teruisi_backend/test_settings_database.py`，11 项测试。
测试在临时应用布局中复制真实 settings 及其轻量配置依赖，独立进程实际导入，
使用 `-I -B`、只保留 OS 必需环境，显式禁用 n8n 注册表配置回退；不继承生产凭据。
失败前后比较整个临时根下的目录集合与所有文件 SHA-256，确认无新目录、新文件或旧文件变更。
`-B` 仅防止 Python 导入缓存干扰断言，不修改生产字节码策略。

覆盖：缺 URL 与环境、显式 development/test、空白 URL、树内/树外 SQLite 覆盖、
空/坏/目录标记、完整生产 PostgreSQL 配置成功导入、SQLite URL 拒绝、
开发默认路径及既有数据、开发自定义路径、原 production 缺 URL 守卫。
PostgreSQL 成功用例只解析合成配置，不连接数据库。

将同一新增核心测试对基线 `491c1408` 的原始 settings 在临时副本运行，测试如预期失败：
旧代码成功导入并返回应用树内 SQLite 路径。修复后全套通过。
证据见 [回归反例与边车实测](regression-and-sidecars.log)。

## 其他运行期文件核查

以下来自本次源码定向扫描和隔离实验，未读取或修改生产目录；不是全系统任意文件写入的安全证明。

| 对象 | 核查结论 |
| --- | --- |
| SQLite 主库 | settings 导入只创建父目录，首次连接才创建主库；隔离实测首次连接生成 0 字节文件。今天进程的身份/退出原因仍是用户给出的推测，本次未据此断言。 |
| SQLite journal / WAL / SHM | 本配置未设置 WAL；新库实测默认 DELETE 日志模式，未提交写事务产生同目录 `-journal`。启用 WAL 后出现同目录 `-wal` 与 `-shm`。既有 SQLite 库也可能已启用 WAL，不能假定只有主库。拒绝整条兜底路径同时避免这些文件，而不是扩大指纹排除。 |
| `migrate` | 迁移表及 schema 写入所选数据库；若旧兜底被使用，会写该 SQLite 库并可能产生 journal。已扫描仓库 `backend/**/migrations/*.py` 的文件创建调用，未发现另一条直接落在应用树的运行期文件写入。 |
| `makemigrations` | 是独立的源码生成命令，会在 `backend/<app>/migrations/` 写 Python 文件；本地 Django 5.2.17 的 `makemigrations.py` / `MigrationWriter` 已核对。它不是正常服务启动产物，本次没有封禁合法开发命令，也没有运行该命令。若显式在受管树执行且配置通过，仍可能改树，原清单应继续拒绝。 |
| 日志 | `settings.LOGGING` 只有 `logging.StreamHandler`；`tools/django-local-service.ps1` 的 `$LogDirectory = Join-Path $RuntimeRoot "logs"`，stdout/stderr 重定向到 `app` 的兄弟目录。未发现 `BASE_DIR.parent` 下默认文件日志。 |
| 缓存与上传临时文件 | 本配置为 `LocMemCache`，没有设置文件缓存、`MEDIA_ROOT`、`STATIC_ROOT` 或 `FILE_UPLOAD_TEMP_DIR`。报表代码使用 `tempfile` 临时目录；不默认由 `BASE_DIR.parent` 派生。外部覆盖 TEMP/TMP 或显式指定输出路径仍需遵守部署边界，本补丁不提供通用路径约束。 |
| 配置与 SQL | `inventory/dingtalk_sync.py`、`jd_logistics_notifications.py`、`warehouse_mapping.py` 及 `workflow/pi_business_n8n.py` 的应用树路径用于读取配置/模板；历史退役命令的 `BASE_DIR.parent/drizzle/*.sql` 用于读取受控 SQL。历史命令另有显式来源/输出参数，不能据此宣称任意运维命令都不会写树。 |
| 排空锁、备份、独立 Runner | `automation_drain.py` 写 runtime `run/`；备份控制状态位于 runtime `backups/`；独立 Linux Pi/Pandas Runner 的 SQLite 按其 state/config 定位。它们不是 Django 默认 SQLite 兜底的第二条应用根写路径。 |
| 字节码 | Python 仍可能写 `__pycache__` / `.pyc`，原指纹算法已按约定排除。本次不更改该约定，更不将 `.runtime` 纳入排除。 |

## 实跑检查

环境：Windows，Node `v24.18.0`，隔离 venv Python `3.14.6`、Django `5.2.17`。
Node 依赖通过本工作树 `node_modules` junction 复用主检出的同锁文件安装，未运行依赖安装或修改该目标。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 完整 lint 基线脚本 `node .github/workflows/check-lint-baseline.mjs` | PASS：56 errors / 132 warnings，错误基线56；不是零 lint 错误 | [lint](lint.log) |
| `npm run check:backend-boundary` | PASS，736 modules，`violations: []` | [边界](backend-boundary.log) |
| `npm run check:pi152-acl` | PASS，27 checks | [ACL](pi152-acl.log) |
| CI 原白名单全部13文件，Node `--test-timeout=30000` | 66/66，零失败/跳过 | [CI](ci-allowlist.log) |
| Django 新增11项 + 原 `test_settings_validate_secret` 7项 + `sales.tests.test_settings` 4项 | 22/22，system check 无问题，无数据库 setup | [Django](django-tests.log) |
| 原代码回归反例、SQLite边车实验 | 预期 RED 成立，DELETE/WAL 文件行为已实测 | [实验](regression-and-sidecars.log) |

Django 命令：隔离清除 `TERUISI_*` / `DJANGO_*` / AI 加密主钥，设置 test 环境、
本工作树 `.runtime/settings-tests.sqlite3` 路径后运行：
`python -B backend/manage.py test teruisi_backend.test_settings_database teruisi_backend.test_settings_validate_secret sales.tests.test_settings --verbosity 2`。
首轮夹具的 sqlite3 context manager 只提交事务、不关闭连接，导致 Windows 清理临时文件失败；
已改成 `contextlib.closing` 后重跑通过，保留 [首轮日志](django-tests-initial.log)，不覆盖历史失败。

独立审查按项目 critical-review 要求请求 `gpt-6.1-sol / high`，使用新上下文只读核对源码、部署标记来源及日志，结论无阻断。
审查者未重复全量测试，未操作生产或验证原生冷启动；工具未独立返回实际模型身份。

## 范围与后续采用

可执行差异只有 Django `settings.py` 和其新增测试；其余为规范、报告、索引及日志。
四个禁改文件以及 `tools/django-local-service.ps1` 均保持基线字节。
未访问 `D:/teruisi-runtime/`，未合并/推送 origin/main，未打包、迁移、启停服务或发布。

`settings.py` 属于 `Prepare-Application` 复制的 backend 应用包，修复必须完成
**合并 main → 从最终合并提交准备 Django 制品 → 发布 Django 应用** 才能在生产进程生效。
本次范围为 Django，不需要 Worker 制品，没有 migrations 变化，不需要数据库迁移。
实际未来发布还须按届时完整组合差异重新确定范围，不能把此单任务范围当成整条 main 的范围。
每一步分别等待用户明确授权，当前只交候选核阅；现有外来文件的清理不在本次动作内。

此候选尚未做原生制品准备或完整冷启动，不能称“制品就绪”或“生产已修复”。
已完成的检查在源码/依赖不变时复用。独立工作树和分支保留供用户核阅。
