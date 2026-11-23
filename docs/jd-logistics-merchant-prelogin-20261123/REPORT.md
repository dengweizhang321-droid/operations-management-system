# 京东物流商家预登录开发报告

日期：2026-11-23。分支：`codex/jd-logistics-merchant-prelogin-20261123`。基线：`7f80bc110351629135958aea5a121dd04e95645c`。状态：开发候选，未推送、合并或采用。

## 根因证据与范围

来源为 Lead 2026-11-23 原派工单第 1–4 项既有只读证据，本轮没有读取真实 Cookie、凭据、Profile 或生产运行记录：

- 物流定时运行早于客服登录；自 11 月 18 日起定时运行均在 B 首来源登录守护失败，历史 completed 来自白天手动运行。
- 客服使用同一注册账号和 Profile，商家 passport 的 DPAPI 登录已有成功记录。凭证创建时间与客服运行相符，物流早晨运行时此前会话已失效。
- 物流入口出现扫码/验证语义，原守护只接受两个既有 JD passport HTTPS 来源，因此失败码随页面渲染时机不同。
- 客服登录后手动物流运行成功，支持先建立商家会话再走物流 SSO 的方向。物流扫码页所属域名仍是 Lead 未截图证实的推断，本修复不依赖它。

## 改动

1. `tools/jd-logistics-session.ts`：复用 `jdCustomerServiceWorkflow.entryUrl`：`https://shop.jd.com/jdm/kefu/kf-manage-lite/#/UtilsSetting/ChatLog`。该地址已经用于客服流程，`jdSessionSurfaceDecision` 要求精确地址和“聊天记录、列表视图、消息视图、查询、重置”完整控件，适合作为商家已认证证据。复用 `waitForJdSessionSurface` 和原 DPAPI 底层函数，没有直接调用会抛 `JdLoginGateError` 的通用 ensure 函数。
2. 首次导航商家入口，确认后标记 `existing_session` 或 `windows_dpapi_credentials`，再导航物流来源并执行原业务 frame 守护。商家页面不替代物流 frame 与事业部身份校验。
3. 预登录与物流阶段共用 `attempted`，缺失、拒绝或未知结果同样消耗该次机会；JH 冷返复用认证状态。导航、凭据解密、填写、密码模式选择、提交和返回 frame 前的既有所有权检查保持。
4. 原 passport HTTPS 来源白名单、唯一可见表单、绑定元素和挑战/拒绝/锁定判定保持。商家跳转恰好发生在异步读取期间时，仅对原白名单 passport 重新采样，再走全部检查，不提交凭据或接受业务 frame。
5. 浏览器导航、读取和等待异常在守护内脱敏映射；所有权校验留在该映射之外。独立审查指出的页面关闭异常漏映射已修复，增加提交前后各 3 类反例。
6. `tools/jd-logistics-export.ts` 仅将 `navigate()` 内的 `goto` 移入守护。保留 `navigate()` → `identity()` → 导出顺序。原顺序先打开物流再调用守护，无法满足本次“首次物流导航前预登录”，因此需要该最小一行调整。
7. 扩展 `tests/jd-logistics-session.test.ts`，同步 `tests/jd-logistics-zero-effect-closure.test.ts` 当前源码位置约束；本报告为第五个变更文件。

## 错误码映射

以下均从 session guard 抛出，前缀为 `JD_LOGISTICS_`，没有新增错误码。

| 预登录结果 | 既有码后缀 |
| --- | --- |
| 挑战/安全验证 | `LOGIN_CHALLENGE_MANUAL_ACTION` |
| 凭据拒绝 | `LOGIN_CREDENTIAL_REJECTED_MANUAL_ACTION` |
| 临时锁定 | `LOGIN_LOCKED_MANUAL_ACTION` |
| 提交结果未知 | `LOGIN_SUBMISSION_UNKNOWN_MANUAL_ACTION` |
| 已尝试后仍未认证或页面读取/等待失败 | `LOGIN_NOT_COMPLETED_MANUAL_ACTION` |
| 凭据读取不可用 | `LOGIN_CREDENTIAL_UNAVAILABLE_MANUAL_ACTION` |
| 表单/提交控件未就绪，未尝试时导航/读取/等待失败或商家页面持续 pending | `LOGIN_FORM_NOT_READY_MANUAL_ACTION` |
| 需要登录但账号未启用或非 DPAPI | `LOGIN_REQUIRED` |

控件歧义、来源拒绝、店铺键不符和业务 frame 异常继续使用原有对应码。凭据风险列表继续留给人工处理，zero-effect 白名单及 `whitelistVersion = 1` 未改。

## 检查结果

运行位置始终为本 worktree。沿用 Lead 建立的只读共享依赖联接，没有安装、更新或写入共享 `node_modules`。

- 基线完整组：93/93 通过（约 324 秒），没有既有测试失败。
- 最终完整组：103/103 通过（约 311 秒），0 失败、0 跳过；所有结果来自恢复后的最终源码。
- 最终定向 session：28/28 通过，包括合成 DOM、会话有效/失效、零/一次提交、拒绝/锁定/挑战、未白名单扫码页、所有权撤销、再次出现 passport、异常脱敏及跳转竞争。
- 最终源码位置 pin：2/2 通过。
- 严格 TypeScript：通过。使用工作树 `node_modules/.bin/tsc.cmd --project .codex-tmp/merchant-prelogin-tsconfig.json`，临时配置继承仓库 tsconfig 的路径映射，仅 include 本次 4 个 TS 文件，`strict/noEmit=true`、`incremental=false`。最初显式 CLI 未带项目 paths 导致新复用模块的 `@/` 路径诊断，改用继承项目配置后通过；新增 mock 的严格类型断言也已修正。
- ESLint：两个生产文件和 session 测试通过；zero-effect 测试基线及改后均为第 34、89 行两处既有 `no-explicit-any` 错误、第 169 行一处既有 unused 警告，无新增 lint 诊断，未顺带修复。
- `git diff --check`：通过。变更文件保持 UTF-8、LF。
- 合成浏览器所有请求被测试 route 接管并禁止未匹配请求。开发中 mock 302 触发本环境 `ERR_NETWORK_ACCESS_DENIED`，改为受拦截 HTML 内延迟导航；完整组随后暴露商家异步跳转的竞争，增加确定性反例后修复，未访问真实京东。

完整组命令：

```powershell
node --import tsx --test tests/jd-logistics-session.test.ts tests/jd-logistics-export.test.ts tests/jd-logistics-pipeline.test.ts tests/jd-logistics-zero-effect-closure.test.ts tests/jd-logistics-identity-readiness.test.ts tests/jd-logistics-helper-bundle-contract.test.ts tests/jd-saved-login.test.ts
```

实际 grep 仅发现一份 `jd-saved-login*.test.ts`。上述为派工单明确要求的合成测试，未追加真实业务验收。

## 注入错误验证

最终源码两次各注入一次后单独运行指定测试，均 exit 1，随后用 `finally` 恢复原字节并核对一致：

| 注入 | 变红测试 | 失败证据 |
| --- | --- | --- |
| 商家认证后清除 `attempted`，允许物流再次提交 | `merchant prelogin consumes the sole attempt even if logistics still presents passport` | 原应拒绝却进入业务 frame：`Missing expected rejection` |
| 首轮商家阶段跳过挑战检查 | `merchant prelogin challenge, rejection and lock stop before any login invocation` | 登录调用次数为 1，期望 0 |

恢复后的 `tools/jd-logistics-session.ts` SHA-256：`cc0ac3b6b147657610746418070fb59e40688ef35096cdc01540781c3d07f392`。最终完整组在恢复后启动。

## 字节/文本约束与独立审查

- 9851、11037 历史闭合工具核验冻结历史 `source-snapshot`、helper、receipt 与哈希，不依本轮源码更新历史摘要；工具与目标文件未改。
- 当前源码 zero-effect throw-site 仍只允许守护抛出业务前码。因统一浏览器异常和商家 pending 路径，`FORM_NOT_READY` 的字面抛出计数由 1 改 3，`NOT_COMPLETED` 由 1 改 2；其余计数与禁止其他源文件抛码的检查保持。
- 当前 exporter 整行 `navigate()` pin 随导航责任迁移同步更新；唯一守护构造/调用、两个 navigate 调用点及其在 manifest/导出前的位置检查保持，并核对商家认证到物流阶段的先后。
- helper bundle contract、n8n metadata reader source/摘要与各历史 closure 源码只核对依赖/约束，没有修改历史门禁、摘要或白名单。
- 按项目自动化流程变更规则进行了独立 review，请求模型 `gpt-6.1-sol/high`，工具未独立返回实际底层型号。审查指出一个异常映射遗漏，修复后增量复审通过、无剩余阻断；审查者未修改文件或重复执行完整测试。

## 交付边界

开发、检查及独立审查已完成，但本地暂存/提交被沙箱阻塞，未产生提交。2026-11-23 首次 `git add` 无法创建 `D:/运营管理系统/.git/worktrees/jd-logistics-merchant-prelogin-20261123/index.lock`，返回 `Permission denied`。未重试、提权、修改权限或扩大可写范围；HEAD 仍为基线。待 Lead 通过既有受控 CLI 显式暂存本次 5 个文件，创建一个含 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 的聚焦提交。不 amend、不 push。

没有合并 main、准备制品、发布、迁移、生产数据写入、真实外发、访问真实京东/凭据/Profile、修改 n8n 工作流或定时。合成测试通过不代表定时任务已在真实环境恢复。

按本轮“仅在给定工作树写入”限制未写外部 Obsidian vault；可复用结论及候选状态留在本报告供 Lead 后续归档。
