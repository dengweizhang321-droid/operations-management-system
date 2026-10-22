# 独立审查

审查上下文：`/root/independent_review`，未参与方案实施或代码修改。请求角色 `gpt-6.1-sol / high`；工具未回执实际模型，实际型号未独立确认。审查基线 `f641685b60ca11a674da713e3b7b454f338c622c`。

**结论：候选必要启动代码审查通过，无剩余阻断。** 不证明已合并、已发布或真实完整冷启动。本文件由负责人保存审查者返回正文，最终验证回执由负责人补列，并区分于审查者自行执行的核验。

## 覆盖

审查者读取共享记忆启动协议、本 worktree 规范、完整相关差异、`worker-local-service.ps1`、`operations-system-control.ps1`、`process-deadline.ps1`、`django-ai.ps1` 直接消费链、`operations-system-service.ps1` 包装入口及本次测试。对预算动态作用域、父期限、异步身份/锁/维护/排空、原失败证据及禁止文件边界进行了核对。未执行生产操作，未修改实现。

## 已闭合发现

1. 原 P1：Start 异步派发后，后续 BeginWorkerDrain 可能先完成排空，observer 再新增接收器/调度器。修复后 `Invoke-IndependentDingTalkObservation` 取得原 Worker 锁，复读维护、automation drain 与 exact release；active drain 返回 `deferred_drain`。审查者私有临时 runtime 反例实测 `nativeCalledUnderActiveDrain=false`、`status=deferred_drain`，确认修复。
2. 原 P2：AutoStart 退出 0 只证明原生进程启动/复用，不能直接声称 connected。修复后原生启动结果为 `native_completed`；`Wait-IndependentDingTalkReady` 复用原 AI Status，四字段同时为 enabled/running/running/connected 才 ready，disabled 单列，invalid/ownership_error 失败，其他状态只等待独立 deadline。只读观察已移至 Worker 锁外，不为等连接延长写生命周期锁占用。
3. 原 P2：observer 函数之前的 manifest/head 拒绝可能不生成声明的观察文件。主 catch 现补 create-only 独立失败记录；原 ProcessEvidence、stdout/stderr 保留，已存在的原观察记录不覆盖。记录本身无法写入时仍保留进程失败输出，不推断执行结果。

## 关键结论

- 四分项预算按 `min(父 deadline, 当前时间+分项预算)` 下传所有既有 native gate；函数退出恢复环境与作用域，较短显式父期限不被延长，兄弟阶段重取自身预算。
- Start 只以原 Django/Worker/supervisor 结果闭合；接收器派发、失败、超时为独立诊断，不反写 Start。RequireReady guarded release 继续 preserved，并发加入只观察。
- 原完整 release 校验、supervisor 身份及 readiness、维护/排空/锁、AI mutex、unknown 和 STARTED/FAILED 原件均未被绕过或改写。不需要修改用户禁止的文件。
- 不调整维护退出/Start 顺序，不新增业务代码或数据库迁移。

## 非阻断建议

常用总控 `-Json` 仍不向上传播 Worker 新增 startupPhases/observationPath：原子调用不传 `-Json`，wrapper 原逻辑丢弃 stdout。直接 Worker JSON、发布步骤原 stdout 与独立观察文件可用于取证。本轮已在 REPORT 明确读取边界，不扩成包装层重构。

## 验证证据归属

审查者自行完成只读源码检查、`git diff --check` 和私有排空竞态反例。最终新增 readiness/disabled/drain 与回执保全测试、PS5/PS7 语法、边界和构建的命令、输出及退出码由负责人执行并保存在 [verification.json](evidence/verification.json)；不冒称审查者另跑完整冷启动或业务验收。最终日志及原件索引见 [EVIDENCE.md](EVIDENCE.md)。

最终增量审查已核对：6 项源码摘要、14 项最终 stdout/stderr 摘要、2 项原计时文件摘要全部匹配；最终定向 3 项、钉钉/总控 20 项及前次私有并发协调 3 项的通过归属成立。旧组合命令 exit 1 为旧 deadline 静态断言，原日志未追认成功。预算代入及原失败保留均通过；审查指出的证据索引归属已修正。无剩余代码阻断。
