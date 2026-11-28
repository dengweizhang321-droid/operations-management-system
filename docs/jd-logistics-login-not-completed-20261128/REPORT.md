# 京东物流「自动登录未完成」可自动闭合（2026-11-28）

## 现象

- `JdLogisticsDaily2026` 08:50 定时执行 12049 失败，失败码 `JD_LOGISTICS_LOGIN_NOT_COMPLETED_MANUAL_ACTION`：守卫已用 DPAPI 凭据提交一次，未见拒绝、锁定或验证，但在有界等待内没进入业务页。计划 manifest 中四个 operation 均无导出进展，下载目录只有空目录。
- 同日 CLI 补跑被 `JD_LOGISTICS_PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION` 拒绝（发生在建计划前，无副作用）：该码属于凭据风险码，零效果自动闭合与人工 pre-import 闭合都拒绝，后续每次运行都会被卡住，直到人工处理。
- 同一账号 09:05 的客服工作流登录成功。用户确认当时账号已经处于登录状态。

## 改动

1. `tools/jd-logistics-zero-effect-closure.ts`：把 `LOGIN_NOT_COMPLETED_MANUAL_ACTION` 移出凭据风险列表，白名单版本 1→2。理由：每小时重试不会重排物流，下一次计划只会来自每日定时或人工运行；守卫在同一次浏览器操作内最多提交一次。所以最坏情况是每次运行多提交一次密码。凭据被拒、账号锁定、提交结果未决三个码仍需人工处理。
2. `tools/jd-logistics-session.ts`：登录后恢复导航到目标页时重置有界等待计数，让登录跳转后的页面有完整的渲染时间。每个页面最多恢复一次，循环仍然有界。
3. `tests/jd-logistics-zero-effect-closure.test.ts`：同步可闭合列表。pin 测试允许 `tools/jd-logistics-export.ts` 只读引用登录码（e96b319e 的弹窗码集合；main 上该测试原本失败），但仍禁止它抛出这些码。
4. `docs/规范/导入与自动化.md`：同步规则说明。

## 检查

- `tests/jd-logistics-zero-effect-closure.test.ts`、`tests/jd-logistics-session.test.ts`、`tests/jd-logistics-pre-import-closure.test.ts`：50/50 通过。
- 改动的两个源码文件 eslint 无问题；测试文件中原有的 2 个 `any` 错误和 1 个告警是 main 已有问题，不是本次引入。
- `tools/build-worker-helper.mjs` 用本 worktree 打包 helper 成功。

## 未执行

未合并、未准备制品、未上线。现场执行 12049 留下的 active 计划保持原样，没有闭合也没有补跑。上线后的下一次物流运行（定时或人工）会自动零效果闭合 12049，再建新计划。
## 审查

独立只读审查结论 PASS，没有阻断项。审查提示，白名单版本 v1→v2 会让「写了 v1 intent 但 active 尚未归档」的旧闭合目录无法续做（结果是失败关闭，不会误闭合）。已只读核对现场 14 个 `zero-effect-*`/`pre-import-*` 目录，全部带有 committed.json，不存在这种目录。旧说明 `docs/jd-logistics-zero-effect-closure-20261117/README.md` 已同步。
