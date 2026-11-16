# Pi 调度：后台身份核验移出全局 AI 锁（2026-11-16）

分支 `codex/pi-scheduler-principal-outside-lock-20261116`，基点 `origin/main` 81cfdb9e。Opus 策划与反审，Sonnet 实现。
范围：仅 Django `backend/ai_assistant/pi_native.py` 的 `scheduler_tick()` 及新增测试。无迁移、不改发布控制器。

## 事故与根因（已实测）

2026-11-16 18:12 发布 81cfdb9e 在「进入维护」失败：控制器写入 Pi 停止指令后等待 45 秒（`tools/django-ai.ps1:317`），Pi 59 秒后才写出 stopped 回执。

- `scheduler_tick()`（`pi_native.py:795-823`）先 `with mutation():` 拿全局 AI 锁（`ai_data_revisions` 行，`policy.py:283-284`），再对每个非 frozen 的 PiNativeState 调用 `current_principal(..., write=True, background=True)`。
- 本地管理员账号的 background 核验是 HTTP：`transport.edge("authorize_background")` → Worker `127.0.0.1:3000/api/ai/internal/edge`，超时 35 秒（`transport.py:889-906`）。
- 生产现有 35 个 native state，全部属于 `local-admin@teruisi.local`，30 个非 frozen → 每轮在锁内顺序做 30 次 HTTP；空闲时主循环约每 0.5 秒一轮。
- 发布先停 Worker；Windows 上连接已关闭的本机端口每次 2.02 秒才被拒（实测）→ 一轮持锁约 60.6 秒（PG 日志实测 60.78/60.86/60.93 秒）。主循环只在两轮之间检查停止信号，所以停止延迟落在 0–61 秒，超过 45 秒即发布失败。
- 平时也有代价：实时采样中 Pi 队列持续占用全局 AI 锁（单次事务最长 0.63 秒），钉钉进程常排队等待。
- 规范写法已存在：`mutation(principal, background=True)` 在**拿锁之前**做 background 核验（`policy.py:280-282`），锁内只做数据库核验。`scheduler_tick` 绕过了它。

## 修复

在 `scheduler_tick()` 中：

1. **拿锁前**：不加锁读取最多 100 个 PiNativeState 及其 root session（与锁内同样的排序/切片），收集非 frozen root 的不同身份键 `(owner_email, actor_role, scope_json)`；对每个键调用一次 `current_principal(Principal(...), write=True, background=True)`，结果记为允许/拒绝（`AiError` → 拒绝；其它异常照旧向上抛出，与现状一致）。
2. **锁内**：保持原有流程与顺序（`wake_waits`、`reconcile_mode`、stable/frozen 判断不变）。原来调用 background 核验的位置改为：身份键不在预检结果中或被拒 → `continue`（本轮跳过，下一轮再查）；预检允许 → 再调用一次**不带 background** 的 `current_principal(..., write=True)`（只查数据库，无 HTTP），`AiError` → `continue`。
3. 不改 `mutation()`、`current_principal()`、`edge()`，不改第二段 switching 循环，不改其它文件里的 background 调用（`pi_worker.py:71`、`pi_native.py:58` 等按操作触发，不在每轮热路径上；在报告里列出，不在本次修改）。

效果：每轮 HTTP 次数从「非 frozen state 数」降为「不同 owner 数」（生产为 1），且全部在锁外；Worker 停止时每轮最多约 2 秒且不持锁，Pi 能及时看到停止信号。

## 测试（Django，SQLite 隔离库）

新增 `backend/ai_assistant/test_pi_scheduler_principal.py`（参照 `test_pi_context.py` 的夹具与 `ready()`/`bound_follow_up()` 写法）：

1. 多个 state 同属一个 owner：一轮 `scheduler_tick()` 只发生 **1 次** background 核验（mock `transport.edge` 或 `policy.current_principal` 的 background 分支计数）。
2. background 核验发生时**不持有**全局锁：在 mock 中断言 `policy._mutation_depth.get() == 0`（或 `transaction.get_connection().in_atomic_block` 为假）。
3. background 核验被拒（mock edge 返回 `{"ok": False}` 或抛 AiError）：该 owner 的 follow-up 不会被启动（`PiOperation` 数不变），其它 owner 不受影响。
4. 预检后、拿锁前新出现的 state（身份键不在预检结果中）：本轮跳过、不报错。
5. 现有 `test_pi_context.py` 中所有 `scheduler_tick` 相关测试保持通过。

## 必需检查

`python backend/manage.py test ai_assistant.test_pi_scheduler_principal ai_assistant.test_pi_context --noinput`（SQLite）。如 `test_pi_context` 在 main 上已有失败，另开基线 worktree 对比（不要用 git stash）。
