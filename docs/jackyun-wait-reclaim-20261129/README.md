# 吉客云“等待原任务”续接修复（2026-11-29）

## 现象

2026-11-29 凌晨吉客云五表工作流 `J8kY2mQ5vR7sT4pN` 连续失败：12071（定时）、12073（手动）、12074（手动）。

- 12071：库龄导出提交后 5 分钟内任务未出现 → B 返回等待 → 约 5 分钟后再次领取 helper 被拒（409，n8n 报 `coordination_rejected_manual_action`）。
- 12073：库龄导出提交被吉客云直接拒绝，报 `JACKYUN_EXPORT_SUBMISSION_UNCONFIRMED`。
- 12074：组合装导出提交后 5 分钟内任务未出现，后续与 12071 相同。

吉客云导出慢是外部原因。但无论吉客云慢多久，系统都必定失败，这是自身缺陷。

## 根因

- B 返回 `recoveryDecision: "wait"` 后，执行单元在 0.5 秒后关闭（`tools/tmall-sycm-cookie-pipeline.ts` 中 jackyun 阶段的 `scheduleOneShotServerClose`）。
- 该执行单元已转发过业务请求，干净退出时 helper 把 execution 记为 retired（`tools/tmall-isolated-helper.ts`）。
- n8n 等待结束后，同一 execution 再次领取时被拒，报 `execution_already_finished`。
- 2026-10-13 加入等待循环以来，这条路径从未续接成功。生产 `recovery-waits` 记录的 `polls` 都只有 1。

## 修改

1. **等待释放可续接**
   - 执行单元因持久化等待而关闭时，在 `finished` 消息中带上 `waitRelease: true`。
   - helper 收到后不把该 execution 记为 retired，而是记一条可续接记录（仅限 jackyun、干净退出、已转发过业务请求）。
   - 再次领取时须匹配原 workflow、执行槽与 `scheduledAt`。每条记录只能用一次，超过 360 分钟或被闭合即转为 retired。
2. **快速缓解**
   - B 内每个模块等待吉客云任务出现的时间从 5 分钟改为 12 分钟。
   - 整个请求另设 20 分钟截止，避免碰到 n8n B 节点 30 分钟的超时。
3. **测试与规范**
   - 新增 4 个 helper 测试。
   - 更新 `docs/规范/导入与自动化.md`。

## 检查结果

- `tests/tmall-isolated-helper.test.ts`：15/15 通过。
- `tests/jackyun-api.test.ts`、`tests/jackyun-api-execution-resume.test.ts`、`tests/jackyun-export-first.test.ts`：34 个中 4 个失败，均为既有失败。在 worktree 中 `git stash` 撤下本次改动后，于 origin/main `4047ca1e` 上运行，同样是这 4 个失败。
  - API plan dispatches only its adapter and a sales cost validation failure blocks every import
  - pipeline enforces order, all-file barrier, replay checks and execution ownership
  - web batch shares one controller and preserves a verified export prefix after partial failure
  - HTTP plans stay distinct, preserve the five-file import barrier, and require matching handoff transport
- `tests/jackyun-capture-retirement.test.ts`、`tests/jackyun-automatic-preflight-recovery.test.ts`：22/22 通过。
- `tsc --noEmit`：本次改动的文件没有类型错误。仓库原有的其他错误不在本次范围内。

## 独立审查

审查者为独立上下文的 critical-review。

- 第一轮：阻断。最初的“等待 5→1 分钟”方案判断错了根因，已撤回。
- 第二轮：需修改后通过。
- 第三轮：可通过，附带下面两项已知事项。

## 已知限制与风险（待用户确认）

- **D 导入等待续接失败**：普通 new 运行在 D 导入等待后续接时，会在 B 的阶段检查处失败。失败是安全的，不会重放，之后由每小时安全重试续接，约晚 1 小时。昨晚的失败都属于 B 导出等待，已经修复。
- **n8n 执行证据上限**：retry 运行的 D 导入等待每轮约新增 11 次节点运行，按每次约 19 个 values 计，约 170–210 个 values。约 47–60 轮会碰到 n8n 执行证据的 10000 个 values 上限，相当于导入持续等待 4–5 小时。触发后会转为人工处理，不会重放。B 导出等待每轮约 110–130 个 values，按单个 reason 最多约 20 轮计，远低于上限。

## 生效方式

改动在 5791 helper 的不可变打包内，需要 Worker 完整发布、重建 helper 才生效，热重启不会生效。本次未合并、未准备制品、未发布。
