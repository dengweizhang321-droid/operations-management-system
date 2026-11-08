# 隔离功能环境独立审查

2026-11-08。请求模型 `gpt-6-astra/high`；工具未回传实际底层型号，实际型号未独立确认。审查者未参与环境实施；本上下文先审方案，再审实施和修复。除本审查记录外未修改被审文件，未启停服务或调用业务写接口。

## 结论

当前基础环境可用于限定的合成功能 HTTP 验证，前述实际阻断已关闭。它不是生产 SQL 角色资格、系统级网络沙箱或本轮原生冷启动证明。

- `tests/ai_functional_environment.py` 使用新 PG 根 `D:/codex-isolated/ai-functional-20261108/pg`、55488、随机凭据和 CurrentUser DPAPI。根已存在时拒绝初始化重放，initdb 使用 SCRAM。管理员负责结构和合成初始数据，运行角色为非超级用户 `functional_app`。
- 初审指出的真实宿主 n8n 注册表回退已用显式空 `TERUISI_N8N_STATUS_DATABASE_PATH` 关闭。migration 子进程及服务在导入 Django 前安装 audit；HTTP、Runner 和 PG 仅列本轮端口，socket.connect 仅允许精确 `127.0.0.1/::1`。
- audit 只约束所覆盖的 CPython socket/DNS 事件，不覆盖全部 native libpq、子进程或系统网络。libpq 使用固定私有连接，并以真实连接身份核对，不将其描述为全系统防火墙。WSL/容器另审。
- `tests/ai-functional-service.py` 在28444、28447分别承载原 `get_wsgi_application()`。Waitress 自唤醒动态端口触发拒绝后，使用 threaded wsgiref；没有放宽端口白名单。这是承载设施变化，不证明 Waitress 或完整23域原生启动通过。
- `tests/ai-functional-edge.mjs` 使用原 `handleAiEdge`、签名校验和注册表；所有域 reader/writer 分设28444/28447，ERP mode 为 django。outboundService 只转发上述两个 origin，重定向不自动跟随；其他公开路径404，没有伪造宿主登录。

## 真实证据和原失败

外置根：`D:/codex-artifacts/ai-isolated-functional-20261108`。

- `PG-IDENTITY.json`：目录为本轮新目录，端口55488，目标库 functional_ai，bootstrap 库 postgres 单列。
- `INIT-FAILURE.json`：首次非超级用户读取 data_directory 被拒绝；保留该失败，未重新初始化。管理员核目录、运行角色核地址/端口/库/用户/rolsuper 的有限续接正确，未为验收增加角色权限。
- `PG-RUNTIME-IDENTITY.json`：127.0.0.1、55488、functional_ai、functional_app、superuser=false。审查者独立以 `default_transaction_read_only=on` 连接并复核地址/端口/库/用户，返回一致且 transaction_read_only=on。
- `schema-migrate.log`、`PROCESS-LAUNCH-R2.json`、`PROCESS-LAUNCH-R3.json`、`edge.log` 与实际聊天/权限 HTTP 证据共同证明该测试设施已运行。启动失败和替换设施的历史保留，不把后续成功倒写为首次成功。

结论仅覆盖上述环境与接线；Runner profile/镜像/原签名生命周期由对应审查负责，完整宿主登录仍未验。合并、正式制品和上线不在本轮授权内。
