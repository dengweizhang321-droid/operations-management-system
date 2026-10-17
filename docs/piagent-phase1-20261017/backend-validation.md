# Pi 一期 Django 验证

日期：2026-10-17。范围为本任务独立 worktree 中的候选源码；生产数据库、正式进程、生产配置和付费模型均未操作。最终合并与采用状态以本任务主报告为准。

## 权威与隔离

- `ai_pi_sessions / operations / dispatches / events / files / exports / export_pages / gateway_nonces` 八表独立于旧 Agent/DAG 队列。迁移为 `0084_pi_agent_independent_runtime`，只增加结构；旧 20/40/64/240 限制未修改。
- 会话唯一活动操作，客户端 key 绑定正文，服务端分配 operation ID、epoch、generation、seq。未知派发保留原操作围栏；刷新只读取持久状态，不重发模型 POST。
- 每次模型和业务工具调用重新核验当前 principal、scope 与精确操作代际。单店选择是独立 `shopSelection`，不冒充渠道或仓库权限。改变范围/选店后使用新环境，旧上下文与文件被隔离。
- 模型轮次由真实 Pi 驱动。Django 仅执行受控单轮模型传输与中央只读工具，不持有另一个 Agent 循环。配置预算保持可调；Pi 不使用旧对话的隐式裁剪，任务剩余时限绑定同一持久 deadline。
- 模型私有响应与 Runner 完整私有回执加密缓存；明文审计保留状态、摘要、usage 与供应商 request ID，不保存 capability 或思考签名。当前模型配置不匹配时，不把其他协议的私有 frame 原样带入新模型。
- 文件字节被动保存，owner/session/operation/generation/大小/MIME/SHA 绑定，下载重鉴权。未知合法 MIME 作为附件 `application/octet-stream`，保留声明 MIME；嵌套产物只保存安全相对来源，显示文件名使用摘要前缀避免同 basename 碰撞。
- 异步导出逐页保存源证明，可超过旧 2000 行界限；完整性受来源分页、字段、总行数和 source revision 校验约束。TOP、截断和变化中的 Pi 网店 source revision 不被声明为完整。未知截止日/单位/水位保留为 null 或 warning，`complete` 仅表示所声明来源的行覆盖，不代表跨域原子快照或行业全量。

## 合成单元与回归

在 `backend` 目录，使用 `.runtime/pi-validation-venv`，清空生产数据库环境变量，设置 `TERUISI_DJANGO_ENVIRONMENT=test`、`TERUISI_DJANGO_PROCESS_ROLE=development`：

```powershell
..\.runtime\pi-validation-venv\Scripts\python.exe manage.py test `
  ai_assistant.test_pi_runtime ai_assistant.test_pi_transport `
  ai_assistant.test_pi_selection ai_assistant.test_provider_roundtrip `
  ai_assistant.test_conversation_workspaces ai_assistant.test_datasets --noinput --verbosity 0
```

当前该组 77/77 通过。覆盖 owner/reader/viewer、正文幂等、独立队列、活动操作互斥、未知不重放、真实 Windows CurrentUser DPAPI、HMAC、模型在途取消与冷启交错、终态后迟到观察、配置毒项不阻塞 FIFO、跨协议 frame、技能资源摘要、加密回执、通用文件及事件字节分页。另验证 2005 行、101 页导出及 TOP/版本变化拒绝。

`manage.py check`、`makemigrations --check --dry-run` 均无问题。两份运行控制 PowerShell 由原生 Parser 检查；其首次采用与完整生命周期的最终证据由主任务记录。

## 真实 Pi 垂直链路

`ai_assistant.test_pi_real_stack` 仅在 `PI_REAL_STACK_TEST=1` 时执行，HMAC key 来自私有 `PI_RUNNER_HMAC_KEY_FILE`，不把 key 写入报告。真实使用 rootless 容器、Pi 1.3.0、原生 bash、签名 Runner、Django 操作队列、异步导出、文件桥与 `excel-report` 技能脚本。

合成替身仅在供应商 HTTP 边界和中央 edge HTTP 边界；未使用 FakePi，未发真实供应商请求。此验证证明运行链路、权限与文件机制，不能证明真实模型的分析质量或生产数据新鲜度。

三轮场景：销售/推广/库存合成来源生成 Excel；同 generation 下一轮读取前轮 marker；选定单店后 generation 增加，旧环境停止、新环境导出该店并生成四工作表 Excel，下载重新核验字节。技能列表来自实际 bundle，并须与 Runner 实际 `get_commands` 及资源摘要匹配才记录 `skills_loaded`。

SQLite 真实传输演练曾连续完成（22.569 秒、22.250 秒），随后一次并发 export/heartbeat 演练出现 `pi_worker_unknown`；当时未保留原异常类型，不能仅凭该码确认底层原因。SQLite 不具备 PostgreSQL 的行锁语义，最终并发证明必须使用独立 PostgreSQL。原失败保留，不作为生产已采用的证明。

最终在独立 PostgreSQL 17.11 / `127.0.0.1:55541` 执行同一三轮实际 Pi 测试，主体 1/1 通过，23.120 秒，进程退出码 0，独立测试数据库成功销毁。实际 Runner source `90812210898b7b69269a977a02828a6943adc15651e6ae0c07c664f89fe92407`，镜像 `sha256:c393a84818c0c7f941803da2db11b1cd94395b8188b69af7294490468a48e26d`。证据：[执行输出](postgres-real-stack.log)、[结构化证明](postgres-real-stack.json)。测试进程从私有 `.runtime/pi-stack-pg-env.json` 加载临时环境，设置 `PI_REAL_STACK_SKIP_FLUSH=1` 后运行单独模块；该标记仅接受专用 55541–55549、`test_` 数据库，不放宽生产 TRUNCATE 守卫，最终由测试 runner 销毁整个私有测试库。

此前 PostgreSQL 演练主体也通过，但测试库销毁因一个线程连接未关闭而失败，原输出保留为 [连接修复前证据](postgres-stack-before-connection-fix.log)。现 heartbeat、export 线程退出均显式关闭当前线程连接，模型取消观察线程也及时关闭其连接；最终测试库销毁成功，未通过终止其他连接或放宽数据库保护来消除失败。

## 已定位并修复的会话竞态

早期第二轮 `cat` 找不到 marker。只读的隔离 Runner 账本证明：首轮 bash 成功，下一轮意外从 generation/epoch 1 跳至 2，进入另一个 workspace，而非原文件丢失。原始纯合成工具回执保存在 [synthetic-bash-trace.json](synthetic-bash-trace.json)。

原因是完成与 heartbeat 交错：heartbeat 持有旧操作对象，终态清空 active 后，旧权限检查的失败分支无条件冻结了已完成会话。修复后，迟到检查只拒绝旧观察，不能改变终态或下一代；heartbeat 在同一 authority 事务内锁会话与操作，并先退出终态。确定交错回归验证后，实际同 generation 续轮读取 marker 成功。该失败历史未被后续成功覆盖。

## 运行入口

独立 worker 为 `python -m ai_assistant.pi_worker`，由 `tools/django-ai.ps1` 的 opt-in 配置纳入现有 AI authority 与受管进程；默认未配置时不启动。原始 channel key 使用独立 CurrentUser DPAPI 文件，配置分别绑定包装文件 SHA 与解密 channel SHA。停止先让 worker 取消并冻结未知，再确认其专属停止回执，最后调用精确 Runner 生命周期；不得杀其他域或借旧队列恢复。

本轮仅交付源码与隔离验证，没有生成正式启用配置、安装正式 unit、启动正式 Pi、迁移生产或调用付费模型。
