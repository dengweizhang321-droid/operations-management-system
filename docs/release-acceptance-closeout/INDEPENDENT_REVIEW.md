# 任务 B 非作者独立复审

2026-10-10（Asia/Shanghai）。审查在 `codex/release-acceptance-closeout` 专用 worktree 完成。审查者只修改独立测试及本复审记录；实现由作者修复。未调用生产启停、部署、业务写入、调度修改或外部发送，也未改写 E 盘封存脚本、基线、批次或日志。

结论：任务 B 当前实现通过非作者独立复审，无未解决的本次发现。最终 `node --import tsx --test tests/release-closeout-independent.test.ts` 17 个 JavaScript 测试全部通过，其中一例执行全部 5 个 Python 独立测试。被审的六个实现文件与三个独立测试文件，在执行前后字节 SHA 相同，见 `independent-final.log` 与 `independent-source-sha256.json`。此结论限开发实现与隔离验证，不授权生产采用，也不代表新执行了生产验收。

## 复审范围

检查 `release-history-preservation.py`、`release-acceptance-ui.mjs`、`release-readonly-retry.mjs`、`release-closeout-report.mjs`，以及 `release-batch.mjs`、`release-batch-admission.mjs` 的最小接缝。按既有客服 import/model 契约、系统 Status 实际状态与域名集合、原发布批次协议判断；历史资料只用于事实追溯。

独立新增 `tests/release-closeout-independent.test.mjs` 和 `.py`，使用合成客户标记、临时目录、模拟时钟和本测试自己创建的短寿命进程。Python 用有效原独立来源回执字节验证合法对照及失败，避免因缺少回执而让负例表面通过。

## 发现与处理

| 发现 | 原复现依据 | 作者修复及复验 |
| --- | --- | --- |
| 摘要检查后沿用旧剩余时间，可能在共同期限后新增 Status | `remainingMs` 在 awaited 文件摘要之前计算，之后直接用于启动进程 | 改为每项摘要前后、进程启动前复验同一 `remaining()`；过期禁止新探针独立负例通过 |
| 合法重导可能同时豁免不可变迁移标记改变 | 给足有效来源回执，修改 `migration_generation` 后原实现允许通过 | 增加迁移标记 HMAC 相等门禁；变更拒绝及同源合法对照均通过 |
| 完成后的执行区间被平移到完成前 | 完成时刻 2000ms，后来 4000ms 的 1000ms 执行错误计入完成前覆盖 | 先按原事件结束时间计算区间，再裁剪；覆盖为 0 的负例通过 |
| 字段名白名单可保留嵌套客户内容 | 回执 status 对象、backupId 数组、版本或运行 releaseId 对象携带合成客户标记 | 增加类型、摘要、枚举和不可变 release ID 约束；拒绝/脱敏负例通过 |
| 未完成报告仍引用旧 completed 的完成时间 | 最新操作 unknown，却返回非空 `approvedToCompleteMs` 与 `completedAt` | 不完整状态计算时排除旧完成事件；独立负例通过 |
| 证据落盘后超出共同期限仍返回成功 | 查询 900ms + onAttempt 200ms，总预算 1000ms | 落盘后再次检查共同期限；超期失败负例通过 |
| 任意十二个组件键可冒充全域就绪 | 十二个 unexpected 键均 true，原完整状态断言接受 | 固定当前实际十二个域名；独立负例通过 |
| 中断操作已落盘的尝试详情被报告遗漏 | observation-attempt 的细节在 `record.observation`，原报告仅看数组 | 投影单次 observation，并支持绑定同批的外部观察回执；中断报告负例通过 |
| CLI JSON 解析错误可能输出原始片段 | 损坏输入为合成客户标记，原任意 error.message 输出包含该标记 | CLI 固定脱敏错误码；独立负例通过 |
| 运行失败枚举与真实 Status 不一致 | 实际 StatusError / Error / status_error 被报告拒绝 | 增补原系统真实失败状态；未完成报告保留失败事实的负例通过 |
| 新观察回执的 at 未验证 | at 为嵌套合成客户标记时原投影包含该内容 | 增加字符串与时间解析检查；最终拒绝/脱敏负例通过 |

首次独立九例：3 通过、6 失败，原输出保留在 `independent-first.log`。后续补强复验曾达到 15 个 JavaScript 独立例及 5 个 Python 独立例通过；新增观察时间字段负例后是 16 个 JavaScript 例中 15 通过、1 失败。这里保留原失败，不用后续通过反推原执行已经通过。

最终 17 个 JavaScript 例和其中运行的 5 个 Python 例均通过；独立 `.test.ts` 入口已纳入后续 `npm run test:unit`。全仓构建、lint、回归及其原失败/环境修正由作者另外记录，不能把本复审 17 例写成全仓回归。

## 继承输出句柄夹具的修正

首次 Node/libuv 孙进程夹具没有稳定建立 Windows 输出 EOF 被后代保持的假设：即使 IPC 已收到 ready，独立观测仍是父进程退出约 124ms 后立即 close。其偶尔超时通过来自启动时限，不作为 EOF 验证。这个夹具缺陷不归责实现；原失败保留在作者组合测试日志。

换成 PS5/.NET 原生继承路径后，先独立校准 exit/close 时间，证明父进程已 exit、EOF 仍被保持：一轮 exit 295.6ms、EOF 2130.2ms、相隔 1834.5ms；负载下另一轮相隔 2022.0ms。再运行同一夹具的有界只读 runner，700ms 预算正确得到 `STATUS_TIMEOUT`。测试孙进程自行在 1800ms 到期，不结束生产或其他任务进程，不使用 killtree。

## 事实与限制

历史 3299 / 3302 差异不能由旧聚合计数反推旧主键或客户内容保全。新工具有固定截点、同范围前后行指纹和独立原来源回执，缺少旧行基线保持无法证明；本次没有生成旧行基线。

已阻止的精确 HTTPS 回环 favicon 与候选 HTTP 字节核验分别报告；危险请求和业务写入仍阻止。独立请求负例确认外部 HTTPS、带查询的图标、静态后缀 POST 继续失败，允许的业务 GET 网络失败也使 UI 审计失败。实际四店 UI 与权限操作由作者的真实源码隔离浏览器验证提供，本复审不把纯分类函数测试当作生产 UI 验收。

状态重试只针对新批次明确批准的原只读 Status，最多四次查询、三次两秒等待，共同总期限包含实际查询、绑定验证和证据落盘。身份错误不重试；Start、apply、备份、恢复及业务动作未增加重试。状态 JSON 不就绪或原未知错误保守失败。

自动报告只证明原文件摘要、日志链与可投影的记录，不能建立验收通过。历史恢复回执不证明旧备份载荷仍可用；运行观察为该观察时刻事实，不证明当前生产版本。预计减少 10～18 分钟误报和 5～10 分钟文档收尾仍未实测，不作为每批节省承诺。

另只读复核当前历史报告输入：原 71 个 canonical WAL 事件、8 个回执及 5 份执行日志，19 项最终 passed、3 个原 unknown 记录、4 次独立协调完整保留。报告仍是 `journal-completed-review-required`，`acceptancePassed=null`。批准到完成 8,554,676ms、区间并集执行覆盖 6,246,206.409ms、未打点/等待残差 2,308,469.591ms、文档收尾 1,466,985ms、批准到文档完成 10,021,661ms，均与原记录相符；协调跨度另列，不重复相加。源码 e1f384e1、原事件 head c12e6522、10 月 9 日的历史 Worker 运行观察精确绑定。完整精度和校验结果见 `independent-historical-fact-check.json`。未对 E 盘任何原文件写入。
