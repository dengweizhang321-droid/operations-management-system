# 京东物流登录守护独立复审

结论：**PASS**。初轮确认的一项凭据目标导航竞态已修复，并在相同独立真实 DOM 反例上复验关闭；最终四文件差异未发现剩余阻断。

- 日期：2026-10-17。
- 受审目录：`D:/.codex/worktrees/jd-logistics-login-20261017/运营管理系统`。
- 基线：`origin/main 66ad3e408f4b979dcb476fd89d98abc676724d9f`。
- 角色映射：`2026-10-15-v3 deep-review`，请求 `gpt-6.1-sol / xhigh`；工具未返回实际型号，未独立确认底层型号。
- 范围：`tools/jd-logistics-session.ts`、`tools/jd-logistics-export.ts`、`tools/jd-saved-login.ts`、`tests/jd-logistics-session.test.ts` 及直接依赖。
- 已读：共享 Home/相关偏好、工作流、京东 POP 项目记忆；受审树 AGENTS、README、开发与交付、任务模型分工、系统架构、安全与 AI 工具、导入与自动化、前端与性能；京东多店铺切换/链路审查技能及其审查手册。

## 初轮已确认并关闭的问题

**[P1，已修复] 授权后的 Locator 自动重解析会把账号填到导航后的外来文档。**

初轮实现先 `authorize(form.frame)` 再 `form.account.fill(username)`。独立合成 Chromium 验证：原 passport 文档表单可见；第 4 次 owner 检查时移除账号输入，100ms 后将同一 iframe 导航到 `https://foreign.invalid/login`，其文档包含相同输入 ID。Locator 的 actionability 等待在新文档中重新解析输入并填入合成账号；下次授权才拒绝 origin。结果为 `LOGIN_ORIGIN_REJECTED`，但 `syntheticAccountFilledIntoForeignDocument=true`，表明事后拒绝不能撤回已发生的账号泄露。所有页面均由 route 合成响应，无真实网络或秘密。

最终 `tools/jd-saved-login.ts:168`、`:169` 和 `:206` 在授权前绑定原始 ElementHandle；密码模式点击也绑定原始元素（`:115`）。导航使原元素脱离，不再把动作转移给新文档。相同独立脚本复验：

- `foreignDocumentReached=true`
- `syntheticAccountFilledIntoForeignDocument=false`
- `credentialObjectCleared=true`
- 错误为固定脱敏 `JD_LOGISTICS_LOGIN_SUBMISSION_UNKNOWN_MANUAL_ACTION`
- 路由合成请求 3，真实网络请求 0。

独立脚本：`D:/codex-artifacts/jd-logistics-login-20261017/independent-origin-race.mts`。新增仓库真实 DOM 回归也覆盖此行为，最终运行通过。

## 最终契约核对

- `jd-logistics-session.ts:20` 只允许精确 HTTPS JD passport origin，拒绝用户信息、非标准端口、伪后缀和其他物流登录来源；外层必须为计划来源 portal 或已准入 passport。
- `:51-67` 先确认启用/DPAPI 模式及 owner，再按同一 storeKey 加载原凭据 helper；原 DPAPI 脚本继续核受控启用注册项、storeKey、CurrentUser 和熵绑定。本次未读取任何真实凭据。
- `:34,52` 的 attempted 由浏览器操作闭包保留，包含缺凭据、拒绝和未知结果，不因再次导航重新提交。
- `:53-60` 每次敏感动作前重新核 owner、challenge、凭据拒绝、锁定、frame 存续与 origin；异常使用固定错误码，无法确认的提交结果不重放。
- `jd-saved-login.ts:175-185` 在填入失败、来源拒绝或 owner 失效时仍清空凭据对象和局部字段；未传授权回调的既有调用继续保留原 Locator 行为。
- 业务 frame 使用锚定来源路径，登录 frame 优先于旧业务 iframe，缺失/歧义/未就绪均停止。认证返回之后仍由 exporter 精确核事业部，未把 URL 或通用商家壳当业务身份。
- `jd-logistics-export.ts:719-722` 创建一个 guard 后首次导航并核身份；JH `:409-410` 冷返回再次使用同一 navigate/guard 并清空旧观察、核新身份，然后才进入范围/查询/导出。
- 任务、原 manifest、导出提交未知、全来源文件屏障、导入幂等和 9851 active 的处理不在本次差异内，未扩展旧任务恢复能力。

## 验证与打包闭包

独立运行：

```powershell
node --import tsx --test tests/jd-logistics-session.test.ts tests/jd-saved-login.test.ts
git diff --check
```

结果：**23/23 通过，0 跳过；diff 检查通过**。含真实合成 DOM 登录成功与外来文档导航反例。测试仅启动新的临时浏览器上下文，全量 route 合成响应；未打开真实 Profile。

另外直接核对正式 immutable builder 的 `QKIaNi/build-receipt.json`：以下四个输入均列入真实 helper 闭包，且收据 SHA 与当前文件完全一致；`jd-credential-vault.ps1` 也列入资源输出。真实 helper 路线 smoke 由执行者运行，本审查独立核对其输入闭包与源码绑定，不把闭包核对声称为再次执行 smoke。

| 文件 | 最终 SHA-256 |
| --- | --- |
| tools/jd-logistics-session.ts | 0010aa30336ba456ab6f5b5af7bdcc5a7f2f645c044ac39aefa8a5e55e6a3cb1 |
| tools/jd-saved-login.ts | b3ce0525b978669c58de7527d9e24683af7fffd6ad033da3dddc8567eee08d10 |
| tools/jd-logistics-export.ts | b766c86ac59377a80b253697b91b38f05e008db3b6edaaa514caa94630b2df32 |
| tests/jd-logistics-session.test.ts | 1a16e790a5bcf1e020be8e7f86c7d22960257a241539099c3b356a165175b0cb |

终态增量仅更正非 DPAPI 测试夹具的类型字面量：`saved_browser_credentials` 改为注册表真实支持的 `manual`（`tests/jd-logistics-session.test.ts:71`）。三个运行时代码文件 SHA 与上表原值一致；将该字面量逆替换后，完整测试文件 SHA 精确恢复为原复审值 `46d05d247d5bff18ba9d1ee91b2d8b889958351ef8d443b498a452d5fec8fa43`，证明没有其他字节变化。独立执行 `node --import tsx --test --test-name-pattern='disabled/non-DPAPI accounts' tests/jd-logistics-session.test.ts`，1/1 通过、0 跳过；原 23 项及 helper 结果沿用，不重复声称本增量重跑全套。该测试现在使用合法但无自动登录权限的模式，仍确认读取凭据为 0。PASS 结论保持。

执行者的 `current-session-four-sources-v2.json` 报告四来源当前认证与事业部一致，凭据读取/导出/导入均 0；本审查只读此报告，没有重复打开实际 Profile，也不从当前会话正常倒推 08:00 的具体挑战原因。

本次审查未修改被审文件，未暂存/提交，未部署/重启，未创建真实京东任务、导出或导入，未读取秘密、未外发，未闭合/重放 execution 9851。结论仅覆盖上述绑定源码；生产采用及旧任务协调仍由原任务按授权处理。

