# Pi 一期取消边界修复与定向回归

日期：2026-10-18。工作树：`D:/worktrees/pi-phase1-closeout-20261018`，基线 `aaca18485021b6f98107fe168b69c8f57d55ee46`。本文记录源码候选及执行者验证，不代替独立审查、真实整链验收或生产采用证明。

请求执行角色为 `gpt-6.1-sol / xhigh`（取消并发复杂局部）；客户端未返回可独立核实的底层型号回执。按共享记忆及项目必读协议加载现行规范；实施未转派。规划见 [取消窄方案](cancellation-plan.md)。

## 修复范围与行为

- 保留 `principal_for` 对取消控制、已完成回执及终态观察的授权；新增 `principal_for_work` 单独拒绝新工作。普通取消不进入权限冻结路径；背景身份检查可能耗时，因此返回后重新读取取消状态。
- 网关每个新 model/tool/file 请求在原 `mutation()` 权威锁内检查取消、唯一登记 sent；目录查询后、实际模型/工具/文件内容读取前再次检查。只有本层 `PiWorkCanceled` 明确证明执行器尚未调用，才记 completed 固定取消回执。取消回执重读先分类，再考虑模型私有响应解密；不会重新派发。
- 已发送模型调用的取消或未知结果维持原 unknown/freeze；已知工具结果可完成持久回执，取消不会把已知成功改成未知。精确 completed 回执在 canceling 时仍可被动读取。
- 每个导出页有独立 `export:page` 派发准入。取消在同一事务把 queued/running 导出记为 `failed / pi_operation_canceled`，在途页返回后不能继续未来页或发布完整文件。最终取消检查、文件保存与 succeeded 仍在同一个权威事务。迟到错误只更新仍为 queued/running 的记录，保留停止原因。
- worker 先检查并发送 abort，再考虑桥接；桥接中遇本层已知取消，退出本次待办列表。继续观察真实终态协议，保留 ack；取消完成不新增发布 Runner 本轮文件，已有文件及卷保持。普通已知停止后下一轮仍沿用原 epoch/generation。

停止受理点是取消事务提交；单次准入点是同锁内未取消检查与 sent 登记。模型与业务查询 HTTP 不在单次准入事务内；既有背景身份核验仍保留原权限接缝。停止前已赢得准入的精确单次调用可在途完成；再次执行前检查缩短尚未实际发送的窗口，但不宣称数据库提交与物理网络发送原子化。整个分页导出和待桥接列表都不能预先取得未来调用资格。

## 定向回归

在候选 `backend` 目录，只读复用已有 `D:/teruisi-runtime/django-sales/venv/Scripts/python.exe`；使用 `-B`、显式清空生产相关环境变量、`TERUISI_DJANGO_ENVIRONMENT=test`、`TERUISI_DJANGO_PROCESS_ROLE=development`、`TERUISI_DJANGO_SQLITE_PATH=:memory:`。只建回归所需内存表，没有运行全库迁移或连接 PostgreSQL。供应商、业务 HTTP 及 Runner 接缝均为合成替身，没有付费或真实外部发送。

```powershell
# 在本候选 backend 目录执行；脚本内再次断言数据库为 :memory:
& 'D:/teruisi-runtime/django-sales/venv/Scripts/python.exe' -B -c "import runpy;runpy.run_path('D:/codex-artifacts/pi-phase1-closeout-20261018/backend-test/run-pi-memory-tests.py',run_name='__main__')"
```

最终结果：**46 / 46 通过，2.673 秒，exit 0**。范围是现有 `ai_assistant.test_pi_runtime.PiRuntimeTests` 的 34 项，加本次 12 项；没有运行全仓测试。原始日志 `D:/codex-artifacts/pi-phase1-closeout-20261018/backend-test/pi-memory-tests-reviewed.log`；内存运行器在同目录。日志里的权限拒绝 403 是原有 reader 负向用例的预期结果。

新增验证覆盖：

1. 真实 abort 已返回后分别请求新 model/tool/file，零底层调用、零新派发，控制观察仍授权。
2. 已登记 sent，目录内真实 abort 后实际业务调用为零、固定已知取消回执、不冻结；模型目录内取消后零供应商调用，同 request 重读不解密错误或重派。
3. 文件执行器进入前取消，零内容读取；背景身份核验中停止，旧内存 operation 不能漏过取消。
4. 已在途只读工具在停止后成功返回，保持 completed；精确重读不再取数。桥接列表首项中停止，其余项没有派发。
5. worker 优先 abort、真实服务 ingest/complete/ack 路径可达；后续 prompt 仍同 epoch/generation。
6. 取消终态不发布新 Runner 文件、不等待导出；已有文件保持。第一页内停止，只有一页查询且无完整文件；末页已持久化后停止，终稿文件仍不发布；迟到来源错误不替换已受理取消原因。

直接旧回归同时覆盖：未知模型不重放、换 requestId 不能绕在途模型、供应商在途取消维持 unknown、queued prompt 明确未发停止、权限/跨代际隔离、agent_end 与 settled 区别、晚到观察不冻结下一轮、2005 行/101 页完整导出、来源版本变化拒绝、文件哈希和归属、模型私有回执、脚本预算与中文响应约定。该内存集验证确定性交错；不把 SQLite 结果称为 PostgreSQL 跨进程行锁实测。

独立审查指出首版固定取消 model 回执重读仍走私有模型解密路径；已在解密前显式分类，并补同原 request 重读回归，上述最终日志包含修复。测试启动初次使用旧审查脚本外部绝对路径时缺候选 import path，随后使用主目录旧开发 venv 又缺 cryptography，均在加载阶段退出、未执行回归主体；最终改为上述完整只读解释器及 runpy 内存运行器，没有安装或修改依赖。

## 兼容性与交付边界

改动只涉及四个 Pi 业务服务文件和原 Pi 定向测试；没有修改 `pi_models.py`、Django migration、依赖、配置、Windows 生命周期/发布入口、Runner 源码/协议、Pi 版本或容器镜像。因此不需要结构迁移、重新构建 Runner 镜像或修改既有权限清单。`git diff --check` 通过。

本执行者没有提交、推送、部署、启停服务、操作生产数据或真实供应商。真实 UI → Worker → Django → Pi/容器 → 下载/刷新/续问，以及私有 PostgreSQL 并发证据由主任务的隔离整链负责人提供；本报告不冒充该整链结果。最终独立审查、合并和绑定 main 的原生 PrepareApp 由主任务统一完成，制品就绪与正式上线分开报告。
