# Web 数据库连接释放与 Pi 建连超时修复

日期：2026-11-02。状态：隔离开发及独立代码审查完成，开发提交见本分支 Git 记录；未合并、未准备制品、未上线。基线：`557654fe03ef6c0d9380fc1b2ab89c266a773d3d`；分支：`codex/web-db-connections-pi-recovery-20261102`。

## 采用范围与实现

- Web 入口 `backend/teruisi_backend/wsgi.py` 在任何 Django 导入前直接设置 `TERUISI_DJANGO_DB_CONN_MAX_AGE=0`，覆盖控制器传入的 60。23 个现有 Waitress 服务均使用该入口，请求结束后由 Django 原生命周期释放数据库连接。Pi 与 management 进程不经过此入口，继续沿用共享设置的 60 秒。
- 保留现有 Waitress 线程总数 116、PostgreSQL 连接上限 128；不扩容 PostgreSQL、不减线程、不增加连接池、监控或固定观察周期。控制器和发布工具字节未改，无新增依赖或资格条目。
- Pi 主循环与导出循环保留 `close_old_connections()`，紧接调用同一 `ensure_loop_connection()`，成功后才进入原调度、领取和执行。已有连接时不额外查询数据库。
- helper 的 `try` 只包 `ensure_connection()`。仅捕获 Django `OperationalError`，且调用前与异常后连接均为 `None`、直接 `__cause__` 为 `psycopg.errors.ConnectionTimeout` 才允许重试。首次尝试后最多重试三次，使用 `stopped.wait()` 等待 1、2、4 秒；每次尝试前及成功返回前检查停止信号。耗尽或其他异常原样抛出，不重放业务循环。
- 原任务执行、事务、unknown/回执、`finally` 和线程收尾逻辑保持原样；不输出异常文本或连接参数。

## 必需程序代码检查

- 两个改动 Python 文件使用标准库 `ast.parse` 解析通过；没有导入应用、连接数据库或生成 `.pyc`。
- `git diff --check` 通过。
- 独立代码审查通过：复核了 WSGI 初始化顺序、两循环插入位置、已安装 Django/psycopg 的连接赋值及异常包装、重试上限和停止边界，未发现合并阻断。审查请求模型为 `gpt-6.1-sol/high`，工具未另行返回实际型号标识。
- 静态核对：两处调用均位于循环内 `close_old_connections()` 之后、首个业务动作之前；异常捕获仅覆盖 helper 的建连调用；Web 环境变量覆盖先于 Django 导入；原 WSGI 应用初始化顺序保持。
- 依赖静态核对：既有 `backend/requirements.txt` 已固定 Django 5.2.17、psycopg 3.3.4、Waitress 3.0.2，无依赖变更。原连接 URL 的 `connect_timeout=5` 不变。
- 仓库发布范围分类为 `backend`、组件仅 `django`、`migrate=false`、未知路径为空；无 Worker、共享控制器或发布工具改动。代码检查不代表生产效果或功能已验证。

按 [发布检查与功能验收分工](../规范/验证与发布.md#发布检查与功能验收分工)，未新增或执行功能测试、故障注入、业务接口/权限场景验收或综合验收。未构建、准备制品、发布、启停服务、执行迁移或业务读写；生产恢复状态未验证。

## 限制与后续交付

重试仅覆盖业务开始前显式 `ensure_connection()` 的纯建连超时；不覆盖旧连接中途断线、后续 healthcheck 重连、事务/提交、业务执行线程错误，或其他不带该 `ConnectionTimeout` 类型的连接拒绝。一次正在进行的建连仍受原连接超时约束，不能被停止信号立即中断。此修复不能证明此前超时由 PostgreSQL 槽位耗尽导致，也不保证持续连接故障下 Pi 保持运行。

Web 请求结束即释放连接会增加后续请求的建连次数；实际时延及连接占用变化未做运行验证。若获合并授权，由最终合并提交准备对应 Django 制品；发布上线另须明确授权。回退须在独立分支恢复本次两处代码并走同一受控合并、制品和发布流程，不直接修改 runtime 或数据库参数。Pi 使用及恢复边界沿用 [Pi 运行说明](../技术专题/AI助手/pi-agent-runtime.md)。
