# 用户、角色、数据范围与权限审计域 Django 迁移手册

## 当前状态

本分支已按 Django/PostgreSQL 单写契约完成权限域实现、Worker 薄适配、React 管理界面、迁移/切权工具、最小权限运行编排和自动化测试。2026-09-05 已对当前本机 D1 `app_users` 做只读快照，并先后在隔离 SQLite 与独立端口 PostgreSQL 17 镜像中完成 `dry-run → apply → verify-only` 演练；生产 PostgreSQL、生产 D1 authority、受控运行目录和 Worker release 均未改变。

隔离演练证据：

- 源用户 1、启用 1、停用 0、管理员 1、受限 scope 0；
- PostgreSQL dry-run：`access-control-dryrun-4b57587f6f104430b94031f0dcc4140a`；
- PostgreSQL apply：`access-control-6692d8dac02047c89d91cbf56e8c2d21`；
- PostgreSQL verify-only：`access-control-verify-38aefa9ae6394466abf81f65904944e7`；
- SQLite 补充演练 apply：`access-control-428697830f904021a4593dac859170ce`，最终代码复验：`access-control-verify-e8164a3719b54116831645b3fb04c373`；
- 源/目标规范摘要：`526175808c1c6a6aa1d2656f266d12eaba4692a782f3674ebd4a1e7602082e08`。
- PostgreSQL 镜像中的独立 reader/writer 均通过固定角色、只读事务、authority 与精确表/序列权限 readiness；向 reader 临时注入一项跨域 `SELECT` 后 readiness 按预期返回 503，撤权后恢复。临时实例随后受控停止并释放独立端口。

这些 ID 只证明本次隔离镜像演练，不是生产 cutover、authority epoch 或 D1 退役凭据。

## 架构与契约

- Django app：`backend/access_control/`；PostgreSQL 是迁移完成后的用户、固定角色目录、数据范围、权限变更审计、revision、幂等回执和迁移证据的唯一权威。
- 公开 Worker 保留 ChatGPT 登录身份、同源写入门禁、请求解析、HMAC principal 信封、请求/响应体积与超时边界；它不再读取、写入或自动补建 D1 `app_users`。
- reader 固定监听 `127.0.0.1:8101`，仅使用 `teruisi_access_control_reader`；writer 固定监听 `127.0.0.1:8102`，仅使用 `teruisi_access_control_writer`。二者必须使用独立 DPAPI 凭据和回环地址。
- 固定角色为 `viewer`、`analyst`、`operator`、`admin`。角色能力目录由代码和迁移共同定义，管理端只分配角色，不允许在线改变能力集合。
- scope 必须为 `null`（不受限），或完整声明 `warehouses`、`channels`、`platforms` 三个字符串数组。后台 Agent 每个微步重新解析当前账号，并验证当前 scope 仍覆盖任务创建快照。
- 未登记、停用或响应契约漂移的账号一律失败关闭，不再自动创建 `viewer`。权限管理和审计只允许当前数据库中仍为启用、无限制 `admin` 的签名 principal。
- 每次用户权限变更都要求 1–200 字原因、`expectedVersion` CAS、稳定内部 request ID；审计保存操作者、目标、前后快照与摘要。系统引导管理员不得停用、降权或限制 scope，并始终至少保留一名启用且不受限的管理员。

## 服务配置

Worker 必须同时配置：

```text
TERUISI_DJANGO_ACCESS_CONTROL_READER_BASE_URL=http://127.0.0.1:8101
TERUISI_DJANGO_ACCESS_CONTROL_WRITER_BASE_URL=http://127.0.0.1:8102
TERUISI_DJANGO_INTERNAL_SECRET=<与 Django 相同、至少 32 字节的受保护密钥>
```

生产 writer 还必须由进程环境绑定已激活的：

```text
TERUISI_DJANGO_ACCESS_CONTROL_AUTHORITY_EPOCH=<UUID>
TERUISI_DJANGO_ACCESS_CONTROL_CUTOVER_ID=<本次受控切换 ID>
```

`tools/django-access-control.ps1` 负责独立凭据、最小权限角色、reader/writer 启停、readiness 和 `access-control-enabled.json`；顶层 Django/Worker 控制器把该域纳入统一启动、停止和完整就绪门禁。

## 数据迁移与切权

生产操作只能在批准的停写窗口，由 `migration_writer` 指向独立 PostgreSQL 权限域执行。不得把下列骨架中的占位符、密码或连接串保存进仓库或命令历史。

1. 备份并验证 PostgreSQL 全库；冻结旧权限写入口，复制同一时点 D1 权威文件并记录哈希。
2. 只读执行 dry-run，并保存精确 run ID、规范摘要和计数：

   ```powershell
   python backend/manage.py migrate_access_control_from_d1 --source <冻结的-D1.sqlite> --mode dry-run
   ```

3. 使用同一文件和精确 dry-run ID 执行一次 apply，再独立 verify-only。源路径、内容、计数或摘要变化都会拒绝 apply：

   ```powershell
   python backend/manage.py migrate_access_control_from_d1 --source <冻结的-D1.sqlite> --mode apply --approve-run-id <dry-run-id>
   python backend/manage.py migrate_access_control_from_d1 --source <冻结的-D1.sqlite> --mode verify-only
   ```

4. 在 Worker 停止、旧写入口冻结且处理中写请求为零时，先以 operator-only 方式安装 `drizzle/0111_access_control_write_authority.sql`，再使用精确 apply run 与 cutover ID 执行 `prepare`。此阶段仍允许同一 cutover 的受控 abort。
5. 回查 PostgreSQL 用户、角色、scope、审计、revision、最小权限和 reader readiness；激活 PostgreSQL authority 后启动 writer，并原子发布只调用 Django 的 Worker release。
6. 完成真实登录正向/负向测试、未知用户拒绝、角色与 scope 收紧、后台任务撤权、并发 CAS、幂等重放和审计回查后，才可运行 operator-only `drizzle/0112_access_control_domain_retirement.sql`。该脚本要求精确退役回执，将旧表替换为空 tombstone views，并安装 6 个永久写入 guard。

一旦 `0112` 完成即跨过 PNR：禁止恢复 D1 用户权限读写、自动补建、`legacy`/`shadow`、双写或反向迁移。恢复只允许 PostgreSQL 备份/WAL/PITR、兼容代码或审批过的前向修复。

## 验证清单

开发和隔离验证至少执行：

```powershell
cd backend
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test access_control

cd ..
npm run test:unit
npm run lint
```

生产 cutover 还必须补齐受控 PostgreSQL 镜像演练、角色越权拒绝、reader 只读事务、writer authority 绑定、真实部署回读、D1 guard/tombstone 证明、备份恢复证据，以及与最新 `main` 的完整回归。合并代码不等于发布或生产迁移。
