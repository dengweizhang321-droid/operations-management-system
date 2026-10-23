# Wrangler 代理退出：只读调查与修复方案

2026-10-09。该文件属于剩余运行风险调查，不改变已完成的四项交互修复发布结论。本轮仅读取现存日志、实际安装源码和版本元数据，未发起生产请求、故障注入、测试、构建、重启、业务写入或新部署。

**结论：已定位“单次代理错误如何升级为整段 Worker 服务退出”，初始连接为何丢失仍未知。** 原始 debug 日志并非完全没有原因：其嵌套 `cause.message` 是 `Network connection lost.`。当前 Wrangler 把这个普通 JSON 对象包装为没有 message 的 `Error`，并把这一类代理错误传播到 `wrangler dev` 主等待 Promise，最终退出 1。原监督器随后按既定流程重新启动同一个 D5 包。后续另有两次相同错误文字，但来自 Inspector 控制通信，已捕获为 debug 日志，不能算作同类致命错误重复发生。

## 受审版本与证据边界

| 项目 | 本次核实结果 |
| --- | --- |
| 调查 worktree | `runtime-risk-readonly-audit-20261009`，HEAD `0b45017836dab43a85cedcbae7d80f0169c4484b` |
| 实际 Worker | `20261009T080026Z-d5fb5b62de630ae2`，简称 D5 |
| manifest | `01590c5698c6b68e996c7d2963b94cbf35b109205bd4e0e3993e5a6d991c4d78` |
| 正式来源提交 | `01a0ea6de9bfc1237a761f927fff068eb55d6e41`；本轮沿实际包依赖分析，不用最新 main 代替生产 |
| 当前进程收据 | `worker-process.json` 仍绑定 D5 / manifest 01590 / supervisor 32284；本轮未重新执行 Status 或 CIM |
| 实际依赖 | Wrangler `4.92.0`；Miniflare `4.20260515.0`；Windows workerd 包 `1.20260515.1` |
| 前驱 | `20261009T030646Z-9f93e52aa005de7c`，简称 A083 |

本轮对照 9 个选定文件：三个包的版本声明、Wrangler CLI、编译后 ProxyWorker、InspectorProxyWorker、ProxyWorker TS 模板、Wrangler bin、TERUISI 监督器。在 A083 与 D5 中全部逐字节一致。说明下面的包装与退出机制在四项交互修复前已存在；这不等于证明某类业务请求不可能触发它，也不等于核验了整个依赖树。

脱敏证据见 [proxy-evidence.json](evidence/proxy/proxy-evidence.json)，包括实际文件 SHA256、日志快照大小/哈希、原文件与行号、时间和白名单错误字段。未复制请求 URL、参数、正文、身份、令牌或整段 config/bindings。正在写入的日志哈希仅对应读取时快照，不应要求后续文件继续匹配。

## 实际事件链

以下时间均为 UTC；上海时间加 8 小时。Wrangler 日志目录为 `C:/Users/86137/AppData/Roaming/xdg.config/.wrangler/logs/`，监督器日志为 `D:/teruisi-runtime/teruisi-worker-sales/logs/supervisor-lifecycle-0.jsonl`。

| 时间 / 原始位置 | 已观察事实 | 可以支持的结论 |
| --- | --- | --- |
| 12:16:05.079；`wrangler-2026-10-09_10-46-13_474.log:6063` | 下一行报告 `Error in ProxyController: Error inside ProxyWorker`；6075 行嵌套 message 为 `Network connection lost.` | 代理错误确实存在；不能由此确定掉线端点、请求种类或下层原因 |
| 12:16:05.101–.102；同日志 6320–6334 | 用户可见错误为空，debug 打印的顶层 stack 也只有 `Error` 加包装函数栈 | 与 `new Error()` 未复制 message 的实际代码吻合；原始 cause 尚保留在更早日志中 |
| 12:16:06.179；监督器 219 行、seq 98 | worker wrapper 66080 `child_exit`，code 1 | 实际退出，不是只打印一条业务错误 |
| 12:16:06.186；220 行、seq 99 | 安排 1000 ms 后重启 | 既有监督器自动恢复路径 |
| 12:16:07.187；222 行、seq 101 | 启动前验证 | 延迟并非只由 1000 ms 定时器构成 |
| 12:16:12.531；223 行、seq 102 | 新 wrapper 21656 启动，manifest 仍为 01590 | 同包重启，不是新发布；该时间不是页面已恢复可用时间 |

本轮读取到的 supervisor 32284 生命周期窗口为 10:46 起至 13:27 左右：**1 次 child_exit、1 次 restart_scheduled、0 次 liveness_termination**。因此这次重启走子进程退出路径；没有该窗口内“监督器探活超限主动终止”的对应记录。不能由此推广到日志保留窗口外。

原 12:11 收尾准入失败早于此次 12:16 退出，不能用后发生的退出直接解释先前失败。备份恢复、CPU、内存、数据库连接/锁与这次掉线的因果关系均未被本轮证据建立。

## 当前安装源码如何形成退出

以下行号均来自 D5 实际目录 `D:/teruisi-runtime/teruisi-worker-sales/releases/20261009T080026Z-d5fb5b62de630ae2/`。在该目录中核对，避免拿其他安装版本的行号定位。

| 文件与行号 | 实际行为与含义 |
| --- | --- |
| `node_modules/wrangler/wrangler-dist/ProxyWorker.js:115–140` | 代理 fetch 与随后响应处理共用 catch；满足当前 URL 比较分支时，把 error 的 name/message/stack/cause 序列化发送给控制器，并拒绝该请求。catch 覆盖响应后处理，因此单看入口不能证明只可能是网络调用本身失败。 |
| `node_modules/wrangler/wrangler-dist/cli.js:311356–311360` | `PROXY_CONTROLLER` 读取 `req.json()`，接收到的是普通对象。 |
| 同文件 `311625–311631`、`311742–311755` | `type: error` 进入 `emitErrorEvent("Error inside ProxyWorker", message.error)`；包装 reason 与 cause。 |
| 同文件 `65570–65576` | `castErrorCause` 对普通对象使用空的 `new Error()`，只把原对象放入 `.cause`，没有恢复 `.message`。这是空错误提示的具体原因。 |
| 同文件 `312621–312624` | 默认监听器先把原嵌套 cause 和上下文写入 debug；故 6075 行能够找回固定错误文字。原上下文可能含敏感绑定，本次未复制。 |
| 同文件 `312688–312713` | 仅两种特定 ProxyController reason 被作为非致命 debug 处理；`Error inside ProxyWorker` 不在其中，继续 emit `error`。 |
| 同文件 `309738–309744` | `dev` handler 正等待 `events.once(devEnv, "teardown")`。等待另一事件时，`error` 会让该 Promise 拒绝，即使已经存在普通 error 日志监听器。此语义可参见 [Node 官方 events.once 文档](https://nodejs.org/api/events.html#eventsonceemitter-name-options)。 |
| 同文件 `306513–306524`、`307135–307145` | 命令错误处理解出 event.cause，却只打印它的空 message 和包装 stack；然后继续抛出。 |
| 同文件 `317252–317255` | 主入口 catch 默认 `process.exit(1)`。 |
| `node_modules/wrangler/bin/wrangler.js:24–39` | 外层 wrapper 继承子进程退出码，因此监督器收到 66080 退出 1。 |
| `tools/worker-local-runtime-supervisor.mjs:293`、`418–470` | 记录 child_exit，并走已有受控重启；与本次日志对应。 |

原 stack 中的 `node_modules/miniflare/dist/src/index.js:88266` / `88500` 属于内部 loopback 自定义服务分发。它们出现于“控制器收到错误报告”的栈，**不能据此断定原始丢失连接来自 Django、PostgreSQL或浏览器**。初始 error 的 stack 仅为固定文字，没有请求相关底层栈。

可信度分层：**包装丢 message 与错误传播机制：高，实际源码可直接复核；该机制与本次 exit1 对应：高，顺序和栈一致但未加运行时跟踪；初始掉线根因：未知。** 本轮不是故障复现实验，也未测性能分位数。

## 前后同类错误计数

在 13:27 左右读取了当日仍保留的 235 个 Wrangler 日志文件，按明确的错误类别统计，而非简单搜索同一句文字。

| 范围 | 结果 |
| --- | --- |
| D5 第一段日志 10:46:13.629–12:16:05.110 | 1 条 `ProxyController / Error inside ProxyWorker`，即上面的致命事件；另有 1 条 `Uncaught` 标记，不将它自动视为此次事件或另一次进程退出 |
| D5 重启后日志 12:16:13.821–13:27:13.241 | 0 条上述致命类别；2 条 Inspector 控制请求失败，分别在 12:44:13.314、13:10:22.423 |
| 其余当日保留文件 | 未匹配到上述 ProxyController 致命类别；这不是前驱长期无故障证明，日志可能有轮换、清理、其他用户目录或未记录区间 |

两条后续错误位于 `wrangler-2026-10-09_12-16-13_393.log:2290` / `2299`，标签为 `InspectorProxyWorker / FAILED TO SEND PROXY CONTROLLER REQUEST`，嵌套文字同样为 `Network connection lost.`。实际 `InspectorProxyWorker.js:157–170` 已捕获该内部控制请求错误，只发送 debug 并返回；它不走本次 ProxyWorker 的 fatal 事件。因此不能写成“又连续崩溃两次”，也不能因为没再退出就写“连接问题已解决”。该控制路径为何失败仍未知，是否与 watchdog 相关也尚无因果证据。

## 上游资料交叉核对

Cloudflare 官方仓库中的 [#15317](https://github.com/cloudflare/workers-sdk/issues/15317) 报告了同类普通对象包装、空提示和致命分类问题，但报告版本为 4.125.0；[#15452](https://github.com/cloudflare/workers-sdk/issues/15452) 在 4.126.0 / Linux 下给出了 WebSocket 配合请求节奏的另一触发场景。本轮检索时后者仍为 Open / Untriaged。这些是同仓库的报告者材料，不能当成维护者已经验证本机根因或某版本已修好的证明。

本机是 4.92.0 / Windows，其机制由上表实际源码独立证实。上游多个触发场景恰好提醒：**相同错误签名并不唯一对应请求取消、WebSocket、POST body、keep-alive 或某个业务模块。** 本轮未核实任何升级候选的修复有效性；不能直接建议升级“最新版”并承诺解决。

## 最小方案与隔离验证清单（均未执行）

建议先把“请求失败导致整服务退出”的放大问题与“为什么连接失败”分开处理。当前原监督器自动重启仍是恢复机制，不能通过关闭监督器、扩大超时或把健康门禁改为忽略来掩盖风险。

| 顺序 | 具体方案与操作收益 | 约束 / 回归范围 |
| --- | --- | --- |
| 1 | 在隔离候选保留错误的 name/message/cause 分类及时间，补代理层级、请求方法类别、响应是否已开始等非敏感元数据。使下一次故障能区分单请求、流结束、内部控制通信和整进程退出。 | 不记录 URL/查询/正文/token/config；验证脱敏、日志轮换与采集成本。仅补日志不等于修好连接。 |
| 2 | 先用 D5 精确依赖创建隔离基线，验证“特定请求错误是否终止主服务”；再选择一个有对应修复源码和锁文件的升级候选，或评估对确切代理请求错误的窄范围非致命处理。业务应收到明确失败，服务其余请求保持可用。 | 不原地修改已封存生产 node_modules；不把所有 DevEnv error 统一吞掉。配置/启动/权限错误仍须阻断；不得自动重放 POST/PATCH/保存/导入等写操作。单独请求失败仍应可见。 |
| 3 | 若隔离复现仍仅见连接丢失，逐项比较客户端中断、用户 Worker 响应中断、HTML 响应处理、SSE/WS、Inspector 控制通信。每项独立运行，保持版本、请求数和时间窗口可对照。 | 使用合成数据与隔离端口，无真实模型、业务写入或外部发送。若使用无副作用合成 POST，也仅用于验证请求体机制；不能把该结果当真实业务写链验收。 |
| 4 | 在选定修复后，验证真实 Home 导航/筛选/详情、只读失败恢复、流式连接、已接受 AI 任务持续语义及原监督器/健康门禁/不可变制品链；最后再评估是否发布。 | 一个代理请求失败不应清除已成功状态；不重放已接受任务。验证通过也需保留初始掉线原因尚未完全定位的边界。 |

推荐的判定条件是“注入的单请求错误有明确失败结果，其他隔离正常请求能继续，主进程未退出，错误日志可诊断”，不是仅看空错误消息消失。错误包装可以解释可观测性缺口，非致命处理可以缩小影响，两者都不能单独证明底层连接已稳定。

尚未完成：本机初始触发复现、每一跳连接/取消记录、资源争用测量、workerd 内部 keep-alive/流状态验证、升级或窄修候选验证、长时稳定性观察。此次风险仍开放，不把已闭合的发布验收扩展为“全系统无运行风险”。
