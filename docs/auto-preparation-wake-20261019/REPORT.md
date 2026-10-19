# 自动打包唤醒的交互会话识别修复

2026-10-19，基于 `de3c1226b42c234121d1b98675403cb793e376d5` 的独立 `codex/auto-preparation-wake-20261019` worktree。源码独立审查通过；没有安装控制入口、应用打包、部署、服务启停或数据库操作。

## 问题与修改

共同身份读取器此前将“当前用户在当前会话中只有一个 Explorer 进程”作为资格。本机同一用户、同一交互会话存在多个合法 Explorer 进程，导致控制执行记录、唤醒及 preparation consumer 在创建业务打包作用之前被误拒绝。

[`tools/main-prebuild-task.mjs`](../../tools/main-prebuild-task.mjs) 保留当前进程会话的 WQL 过滤和精确 SID 比较，改为至少一个同用户 Explorer。每个当前会话 Explorer 的 owner 都必须成功读出，ReturnValue 必须为 UInt32 零且 SID 为有效字符串；即使已经找到匹配进程，后续 owner 读取不明仍拒绝。没有同用户匹配、只有其他会话或其他用户、查询失败及 owner 不明均失败关闭。

`assertOrdinaryIdentity` 原样保留：同 SID、正整数交互会话、`elevated=false`、`integrityRid=8192`。控制执行记录、任务创建/唤醒、普通权限 consumer 和有限协调入口继续使用同一 reader，没有新增唤醒框架、硬编码本机 SID/会话或扩大任务权限。管理员调用方仍仅提交固定普通权限任务，实际 consumer 继续通过原普通权限断言。

## 必要验证

- `node --test tests/main-prebuild-task.test.mjs`：3/3 通过，约 27.8 秒。新增用例从实际源码提取原 PowerShell 脚本，使用原 `taskPowerShell` 的 Windows PowerShell 5 执行路径，仅替换 CIM 查询及 owner 接缝。11 个场景覆盖单/多个同用户进程、混合其他用户/会话、无进程、仅其他用户或会话、owner 异常/缺失/非法 SID/非零返回码及查询异常。
- 同文件原 token 用例保持 elevated/high/low integrity、其他 SID 和非交互会话拒绝。既有真实私有按需任务用例通过：管理员父进程唤醒同 SID/会话的未提升 medium integrity 子进程，普通子进程再经原 RunEx 唤醒排队实例；固定 action、无任意参数、完整冻结环境、注入变量排除、两次 host 顺序、运行中拒绝更新和最终任务/临时目录清理均通过。未进入业务 preparation。
- `node --test --test-concurrency=1 tests/main-prebuild-eligibility.test.mjs tests/main-prebuild-hook.test.mjs`：15/15 通过。原管理员/探针异常在 fetch/DISPATCH 前拒绝，已有 dispatch、hook 触发条件、队列及固定环境回归保持。
- `git diff --check` 通过。未运行全仓测试、五组候选验证、PostgreSQL、生产应用构建或恢复演练。
- 独立 Sol High 审查通过，无阻断。审查者另用真实 PS5 只读核验当前两个 Explorer 均属于当前用户/会话，GetOwnerSid 返回 UInt32 零及 String SID，新 reader 在现场可成功读取；复用以上已通过测试，没有重复运行私有任务。

## 交付边界

本分支由发布负责人处理 main 合并、不可变控制包准备和授权范围内的采用。真实采用后的普通权限唤醒及原生 PREPARED 仍须由负责人核对；本报告不把源码修复、私有任务成功或排队当作正式制品就绪，也不改变已上线应用。
