# 任务 A 非作者独立复审

日期：2026-10-10（Asia/Shanghai）。作者与复审者为不同智能体。复审工作树为 `D:\.codex\worktrees\release-process-deadline\运营管理系统`，分支 `codex/release-process-deadline`；开始时 HEAD 为 `99eaa0b90149a860d3e286c678ea4b2ab0a27160`，实现尚未提交。**本文仍待最终源码摘要及完整回归结果绑定，不能作为当前合并通过声明。**

复审先读取共享记忆启动协议、相关项目记忆、实际 AGENTS/README 和开发、验证发布、运行启动规范；核对用户指定的三份 PRODUCTION、夜审 REPORT/WATCHDOG 及 RELEASE_BATCH_WORKFLOW。只读源码和日志，仅执行真实隔离进程夹具；只修改本报告。没有生产启停、部署、调度、业务数据写入或真实通知。

## 调用链与边界

- 审查 `runApprovedOperation → runProcess → release-lifecycle-step → Worker Start/Status → Control Status → Django AggregateStatus`，以及 watchdog 公共进程/DWS 传输。
- 生命周期、只读探针及普通测试/构建清理分别核对；精确直接进程句柄不能被当作整棵服务树的所有权。
- 启动确认须有原引擎成功完成、批准 manifest、精确 release/PID、已启用组件全部就绪及预期维护/排空状态。非零退出和不可解析结果不能被 HTTP 200 覆盖。
- 三次生产记录证明启动主体已完成而外层仍等待；继承输出句柄是与现象一致的推断。夜审 R02 是另外一条 watchdog 实验的已复现期限缺口，未证明与三次历史事故同根因。

## 发现与作者修正

| 发现 | 证据 | 当前状态 |
| --- | --- | --- |
| 初版后代夹具未证明实际持有 EOF | Windows Node 未 detached 时，独立两次样本约 80ms 返回且后代已退出；改用 detached 后真正复现 | 作者已改夹具；独立 detached 样本确认 |
| 编码 bootstrap 丢原始退出码 | 真实临时脚本写 passed 后 `exit 9`，原 EncodedCommand 捕获为 1 | 两处 bootstrap 已显式传播；独立 PS5/7 复验均为 9 |
| 失败 metadata 丢下划线错误码 | `safeProcessEvidence` 原字符串白名单不接受 `process_deadline_exhausted` 等 | 已放行固定安全字符；最终负例待整套复验绑定 |
| 缺身份、非法 PID、任意组件集合可能误报完成 | 多层缺失字段可 null==null；ValueType 也接受 bool/小数；原组件只检查数量 | 已改 int/long 正整数 PID、固定组件及可选 AI、协议版本；待最终负例绑定 |
| 新 Start 参数可能到切换之后才被拒绝 | 缺/错 manifest/drain 原只在执行 Start 检查 | 已前移 verifyBatch 并保留运行前校验；helper 依赖闭包也已绑定 |
| 控制器内部可迟到等待 | Worker mutex 原 900s、resolver/verifier 原 native pipeline、启动循环及收尾未消费共同剩余期限 | 已加入原期限/文件传输/过期不再查状态；最终独立静态复核待绑定 |
| 普通 tree 超时清理退化与阶段错误 | 1000ms 初版返回时根及后代仍活；direct cleanup 被诊断为 output timeout | 根 fallback 与冻结失败阶段已修正；3000ms 独立样本全部清理；1000ms 后代清理限制保留 |
| DWS 新异常失去诊断分类 | 原 catch 将新 ProcessEvidence 全映射成 preflight_failed | 已保存固定过程 metadata，sending/unknown/sent 不重发保持；没有真实发送 |
| 时间汇总可因容器枚举错误失效 | 两项 OrderedDictionary 的原 Measure-Object 表达式独立返回空 sum | 作者已转换 PSCustomObject 并分出 receipt 阶段；独立原嵌套成功样本已恢复 |
| shared helper 未进入 protected entrypoint 安装/守护闭包 | helper 已在 bundled/keyFiles，但未在 workerGuardEntrypointPaths；rotation build/install 只遍历 guard.receipt.entrypoints，新 protected Control/Worker 会 dot-source 未被本批 apply 发布的 helper | **最终闭包复审新阻断**，已交作者；须纳入 guard 并验证旧前驱首次引入与中断恢复 |

曾发现静态测试替换误删原 readiness 回归和未定义变量；作者已恢复原覆盖，仅改必要 transport 断言。初轮失败日志必须保留，后续通过不能反推旧执行当时通过。

## 复审者自身真实隔离样本

以下是本复审独立调用当前函数、临时 `node -e` child/grandchild 的真实结果，不是只查作者日志。grandchild 使用 `detached: true`，实际继承 stdout/stderr，存活上限 20s；每次结束均按本夹具记录的 PID 精确清理。没有借用正式服务作为夹具。

| 样本 | 观测 | 结果 |
| --- | --- | --- |
| Node 文件协议，直接 exit0，后代持有双流 | 函数 evidence 159ms，exitCode=0；直接已退出、后代仍活 | 通过，不等 EOF |
| Node EOF 协议，相同后代，1000ms 总期限 | evidence 1015ms，exitCode=0，process_timeout/output；后代仍活 | 通过，保留直接成功但拒绝总观察成功 |
| Node direct 清理，根挂起、后代模拟服务 | 修正后 evidence 372ms，timeoutType=direct-exit；直接不在、服务后代仍活 | 通过精确清理与阶段修正 |
| Node tree 清理，1000ms 总期限 | 修正后 evidence 1009ms，pending=true；直接不在、后代仍活 | **限制**，没有宣称零遗留；复审者随后精确清理 |
| Node tree 清理，3000ms 总期限 | evidence 1392ms，treeCleanupExitCode=0、pending=false；100ms 后根及后代均不在 | 通过，保留普通隔离进程树清理能力 |
| PS5 原生句柄文件协议，后代持有双流 | 518ms 返回，UTF-8 中文完整，exitCode=0，后代仍活 | 通过 |
| PS7 同类夹具（实际 bundled 主机） | 350ms 返回，UTF-8 中文完整，exitCode=0，后代仍活 | 通过 |
| PS5/7 原 `-File` 适配链，脚本显式 exit9 | 两主机均捕获 nonzeroCode=9，中文输出完整 | 通过 |
| 原嵌套 PS5 Step，11 个基域就绪、AI 未启用 | 5254ms passed；零残留测试探针 | 通过合法完整就绪 |
| 同链缺 releaseId/supervisor 身份 | 2987ms rejected，candidate-identity，原 engine exit0 保留 | 通过失败关闭 |
| 同链以 boolean 作为 PID | 2843ms rejected，candidate-identity，原 engine exit0 保留 | 通过非法类型拒绝 |
| 同链仅有 12 个 domain 任意组件 | 4439ms rejected，full-readiness，三个原 engine exit0 保留 | 通过完整组件集合拒绝 |
| 同链原 Start 输出成功形状后 exit9 | 2918ms rejected，engine，原 engineEvidence exit9 保留 | 通过非零退出优先 |
| 同链 Worker manifest 与批准不符 | 3530ms rejected，candidate-identity，两个原 engine exit0 保留 | 通过错候选拒绝 |
| 同链 2500ms 总期限，原动作迟到 | 2509ms rejected，process_timeout/direct-exit | 通过有界返回；夹具 driver 随后有界等待，零残留探针 |

PS5/7 传输样本计时从加载共享类型之后的调用开始；不是完整宿主冷启动耗时。Node/PS 的 isolated 时间不代表生产 3.7～4.2 分钟启动可变成秒级。OS 调度、文件快照和有限哈希存在小幅墙钟超调，不能宣称硬实时保证。

原嵌套样本使用真实 Node 批次 runner → 系统 PS5 EncodedCommand → 复制的原 Step → 原共享 native transport → 隔离 PS5 engine。只替换固定业务路径为临时 fake，并绑定临时 adapter/helper/宿主字节及 Worker/Django 两个精确候选。全部成功/错误都经过原批次解析断言。此组首轮恰逢作者增加必需 Django manifest 参数，七项均在准入阶段正确拒绝、没有启动探针；补齐该真实协议后才得到上表结果，不把首轮拒绝记为目标负例通过。原动作 deadline 样本的函数返回与夹具 driver 清理分别计时，没有用 driver 等待掩盖调用超时。

自身 PS7 首次误用不存在的 `C:\Program Files\PowerShell\7\pwsh.exe` 导致夹具 ENOENT；纠正为 Get-Command 的实际 bundled 路径后通过。这是复审夹具错误，不是候选故障。该首轮临时目录 `C:\Users\86137\AppData\Local\Temp\teruisi-review-native-WH6XvS` 的递归清理，以及随后缩窄为三个精确普通文件加空目录的清理，均被自动审批拒绝（CreateProcess blocked by policy，未给进一步理由）；未绕过。全部记录的测试进程已清理，小目录仅留两个 74 字节测试脚本及一份 35 字节测试 PID 记录，不含生产数据或凭据。

## 最终待绑定

最终提交 SHA、八个核心文件字节摘要、作者完整入口及原 PS5/Unicode/nested、watchdog 通知 mock、Worker 生命周期回归的实际结果将于代码稳定后补入。当前未运行生产 fault injection、实际冷启动、备份或部署；不覆盖夜审 R01 代理退出根因、R03 完整分阶段状态保留及生产 P95。

给集成任务 D：新的 helper 必须进入实际发布制品和所有 adapter/Control/Worker 外部工具闭包；候选需重做源/前驱/工具绑定，旧批次不得偷偷升级参数。未知 Start 继续保留 started/unknown，经独立精确协调后才续接，不能重放。普通短期限 tree 清理未确认须保持失败并由隔离夹具拥有者收尾；生命周期从未获泛化树杀权。
