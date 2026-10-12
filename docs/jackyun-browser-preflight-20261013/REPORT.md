# 吉客云浏览器 PID 校验失败的安全闭合

日期：2026-10-13，Asia/Shanghai。状态：源码修复及隔离验证完成；正式闭合、部署和业务补跑尚未执行。

## 问题与修复

原定时执行 8548 在 B 节点报 `waiting_login：调试端口不属于本次启动的独立浏览器，已停止接管。`；随后人工完整执行 8555 在 A 被旧运行未闭合阻止。PID 校验位于凭据提交及导出回调之前，但原恢复分类没有这个精确错误。

唯一生产行为修改是在 `lib/jackyun/preflight-failure.ts` 将该完整错误归为 `manual`。浏览器 PID 校验、当前账号/Profile/端口校验和失败收尾均保持。复用原 n8n 只读证据、全局锁、空 exports/无 exportIntent、四类效果路径全部不存在、create-only 回执及新执行独占消费；原计划和 n8n 失败历史保留。

定时和 Webhook 入口仍拒绝恢复该错误，不能扩为通用 waiting_login 或绕过浏览器身份校验。原 operator 可生成精确闭合方案；完整手动 A 可产生绑定该新 execution 的 v3 回执。补齐恢复分类不证明最初 PID 不一致的底层原因已经修复；若新浏览器仍失败，应保留新证据并停止，不连续重跑。

## 验证

- 74 项相关测试全部通过：人工闭合、自动/手动入口、DPAPI、五表、n8n/小时分类器。新增覆盖手动 A 接续、旧计划/执行正文不变、原执行禁止重放、精确摘要、create-only、防迟到文件/空目录、导出 intent/已有成果、并发执行、错误阶段及相似错误拒绝。
- 四次真实 helper/Worker 隔离验证通过：既有页面恢复、PID 不匹配的手动恢复、trigger 拒绝、webhook 拒绝。仅临时合成 n8n/profile 与模拟健康接口；其他网络请求拒绝，真实业务动作 0，原合成执行正文和计划字节不变。
- helper 构建、Vinext 生产构建、改动 ESLint、650 模块边界检查通过。未运行全库单元或独立 TypeScript 检查。
- 上述主线候选 helper SHA：`87ab5191d441595996eaffd64f58db31c4ac4e6d87e7b0464db2713fc726e162`。发布不得直接将最新 main 中其他未采用变化带入；另以实际前驱源快照准备单文件差异候选。
- 正式前驱的 5,160 个源文件逐字节比较：只变更 `lib/jackyun/preflight-failure.ts`，由 `735ab7e0…` 变为 `e210666c…`。隔离采用源 `D:/codex-isolated/jackyun-browser-preflight-20261013/source` 已完成独立依赖安装和完整构建，并再次通过三种 PID 场景的真实 helper 验证，bundle SHA 与上述主线候选一致。未复制生产凭据或运行数据。单独生成长期保留 helper 时一次使用相对 `--source-root .` 被原构建器拒绝，随后改用精确绝对路径生成成功，未修改构建门禁。

## 真实现场与兼容边界

原 `plan 8548` 使用新规则已通过只读取证，证明四类本轮效果路径不存在；计划摘要 `1f8fa20528b9b787ba1c97356161d85ce6f1df8ad5c2395e53b48250821e8c83`，只生成外部方案，未 apply。

正式进程回执指向 `20261011T090355Z-21c2645a63247749` / manifest `6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4`。以该包 source-snapshot 中原 `inspectPreflightClosure` 只读验证同一真实方案，明确拒绝「原计划不属于无业务结果的首次登录失败」。因此不能先用新 CLI 写回执再宣称旧 helper 可以重跑，也不能改写错误、删除 active 或伪造其他闭合类型。

## 采用及恢复顺序

1. 采用候选以正式前驱为底，仅合入这一个恢复分类变更；通过原不可变 Worker/helper 发布及回退流程，不热改运行包。部署前重新核验前驱、发布所有权、在途任务和当前健康。
2. 按项目开发交付规则，正式更新/短暂停启 Worker/helper 需要本次明确部署授权。用户已经授权的闭合及完整补跑无需重复确认，部署授权单独明确；本报告不授予服务操作。
3. 新 helper 就绪后，重新生成并复验 8548 原执行证据；从原 n8n 手动完整入口执行一次，A 使用既有 v3 机制闭合旧运行并绑定新执行。也可按原 operator 精确 plan/apply，但不能同时重复执行两条恢复路径。
4. 跟踪 A/B/C/D/E、五表文件/批次/日期及最终回查；旧 8548/8555 保持 error。新执行再失败时保留原阶段与现场，不盲目重导。

外部证据目录：`D:/codex-artifacts/jackyun-retry-20261013/`，包括 targeted-tests.log、smoke-*.log、build.log、closure-proposal-8548.json、candidate-source.json 及原 8555 截图。方案是取证截点，apply 前必须重新核验，不能把该摘要当永久许可。
