# Pi 本地工具准入事务修复

日期：2026-10-20。开发基线：`20eea975`。用户要求排查截图中的 `pi_gateway_unknown` 并修复。

## 现场证据与原因

以 AI writer 角色在强制只读事务中查询 PostgreSQL，仅取运行状态、固定错误码和事件元数据，不读取模型私有回执、原始业务数据或凭据。目标环境的第二轮操作 `pi-op-12658546-89bc-4542-bfef-5186671f05ea` 于上海时间 18:35:04 进入 unknown：

- 第 45–49 事件依次为 queued、running、skills_loaded、tool_start(bash)、error(pi_gateway_unknown)。
- 本轮唯一 model 派发已 completed；唯一 admission 派发为 unknown，`error_code=pi_gateway_unknown`、`response_json={}`；没有成功的本地工具准入回执。
- 环境 control:freeze 已 completed。前一轮操作为 succeeded。

`pi_gateway.execute()` 在短 `mutation()` 中完成派发登记后，退出事务再调用处理器。`_local()` 的 local_admit 分支随后调用 `pi_native.authorize(..., lock=True)`；其 `state_for()` 会执行 `select_for_update()`。该调用没有事务包围。实际已安装 app 保留相同实现，实际 Django SQL compiler 在 autocommit 且支持事务时明确抛出 `TransactionManagementError: select_for_update cannot be used outside of a transaction.`。Pi 队列桥直接调用网关，没有额外的请求事务包围。

因此这条 PostgreSQL 执行路径存在确定的事务缺陷，且与现场失败阶段一致；失败在本地工具准入，而非供应商模型响应阶段。历史账本未保留原异常类型或 traceback，本次不能声称读到了该次原始异常栈。没有将旧记录改为成功，也没有解冻或重放原操作。

## 修改范围

- local_admit 在既有 AI authority `mutation()` 中重查代理树准入，并在同一事务中取得返回的 admission 快照，保留行锁及权限、模式、代际检查。
- 同文件 `_tool()` 的业务准备、业务状态与选项分支存在相同的事务外 `authorize(..., lock=True)`，同样使用短 authority 事务包围该检查。远程工具请求继续在事务外执行；业务准备内部的再次校验保持。
- 不更改网关重放规则、未知结果处理、供应商参数、Runner 镜像或数据库结构。

## 必需检查与交付边界

- 使用实际 runtime Python 对修改文件执行内存 `compile()`，语法通过；未生成生产源码或缓存文件。
- `git diff --check` 通过。
- 按用户当前发布分工不新增或执行功能测试、真实模型调用、业务回查或浏览器验收。故障只读取证与源码检查用于定位本次问题。
- 独立审查请求角色为 `critical-review`，模型 `gpt-6.1-sol`、强度 High；无独立底层模型回执，不声称另行确认实际模型。
- 独立审查结论：无阻断。审查者直接核对 HTTP/队列入口、网关处理器、其余带锁授权调用及业务准备内部事务；确认两处短事务修复覆盖本次缺陷，外部请求未被包进长事务。历史异常栈缺失的结论边界保持。

本次仅后端应用代码变化，无 migration、Worker 或 Runner 载荷修改。最终合并提交及原生制品结果由交付回执补充。合并、准备与上线分别报告；生产切换、服务启停、旧任务恢复及业务重跑均未执行。用户明确说“上线”后才执行生产发布。
