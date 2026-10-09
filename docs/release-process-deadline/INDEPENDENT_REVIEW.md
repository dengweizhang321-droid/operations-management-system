# 任务 A 非作者独立复审

日期：2026-10-10（Asia/Shanghai）。作者与复审者为不同智能体。复审工作树为 `D:\.codex\worktrees\release-process-deadline\运营管理系统`，分支 `codex/release-process-deadline`；开始时 HEAD 为 `99eaa0b90149a860d3e286c678ea4b2ab0a27160`。**最终结论：源码提交 `67622d61ee326dc610c498356e518ec2ec7fdd81` 通过非作者独立源码与隔离行为复审，未发现尚未收口的任务 A 阻断。此结论不授予生产采用许可，不表示全量单测曾一次全部通过。**

作者实现 `05a78f85` 与任务 B 主线 `c9586ab8` 在 `65c7b8a9` 组合，最终源码提交进一步收口晚到状态、临时预算环境、helper 发布闭包与完成证据。复审独立比对 [最终核心源摘要](source-sha256-final.json) 的全部 11 个文件，物理字节 SHA-256 零漂移；下文单独列出这些摘要。

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
| 失败 metadata 丢下划线错误码 | `safeProcessEvidence` 原字符串白名单不接受 `process_deadline_exhausted` 等 | 已放行固定安全字符，最终传输/失败回归通过 |
| 缺身份、非法 PID、任意组件集合可能误报完成 | 多层缺失字段可 null==null；ValueType 也接受 bool/小数；原组件只检查数量 | 已改 int/long 正整数 PID、固定组件及可选 AI、协议版本；独立原嵌套负例及最终回归通过 |
| 新 Start 参数可能到切换之后才被拒绝 | 缺/错 manifest/drain 原只在执行 Start 检查 | 已前移 verifyBatch 并保留运行前校验；helper 依赖闭包也已绑定 |
| 控制器内部可迟到等待 | Worker mutex 原 900s、resolver/verifier 原 native pipeline、启动循环及收尾未消费共同剩余期限 | 已加入原期限/文件传输/过期不再查状态；静态复核与 PS5/7 互斥负例通过 |
| 普通 tree 超时清理退化与阶段错误 | 1000ms 初版返回时根及后代仍活；direct cleanup 被诊断为 output timeout | 根 fallback 与冻结失败阶段已修正；3000ms 独立样本全部清理；1000ms 后代清理限制保留 |
| DWS 新异常失去诊断分类 | 原 catch 将新 ProcessEvidence 全映射成 preflight_failed | 已保存固定过程 metadata，sending/unknown/sent 不重发保持；没有真实发送 |
| 时间汇总可因容器枚举错误失效 | 两项 OrderedDictionary 的原 Measure-Object 表达式独立返回空 sum | 作者已转换 PSCustomObject 并分出 receipt 阶段；独立原嵌套成功样本已恢复 |
| shared helper 未进入 protected entrypoint 安装/守护闭包 | helper 已在 bundled/keyFiles，但原未在 workerGuardEntrypointPaths；rotation build/install 只遍历 guard.receipt.entrypoints | 已纳入 guard 且去重；候选 preflight 必须有 helper；旧 11 入口→新 12 入口实际 apply、回读、丢失观察恢复与缺失/异字节八项通过；候选 verifier 仍严格要求新集合 |
| 日常 Control Visible 仍忽略原期限 | 独立原函数继承 1000ms 预算，实际 sleep3s 子进程仍在 3959ms 返回 passed | 已复用共享 Preserve 文件协议；同夹具 1031ms 明确超时失败，真实退出未知保留 |
| 成功 WAL 丢失内层退出与三段计时 | 原成功 receipt 只留下 hash/有限 outputs，engineEvidence/timing 未进入 WAL | 已在有效断言之后有限提取 engine metadata、非负整数计时；成功 WAL 和真实 ready/drain 回归通过 |
| 迟到 ports 可宣称健康 | 原 Get-WatchSnapshot 在 ports 前检查预算，之后未复验；独立 300ms 预算/800ms port seam 实际 933ms 返回 healthy=true | 已在 HTTP 消费及最终 snapshot 再验原期限；相同独立负例 922ms 返回 healthy=false、probeError=true、明确 snapshot-final/process_deadline_exhausted |
| 临时预算污染准备身份及永久 supervisor | 每次 deadline 值不同可使原全环境准备 hash 不一致，永久 supervisor 也不应继承已结束预算 | 仅排除保留传输变量，其他环境继续严格 hash；启动永久 supervisor 时暂清除并 finally 恢复控制器；纯负例及最终源码复核通过 |

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
| 原 Control Visible，1000ms 总期限、child sleep3s | 原函数 3959ms passed；修正后 1031ms failed、process_deadline_exhausted/direct-exit、Preserve、exitCode=null | 通过修正，未伪造成功或强杀服务树 |
| 原 watchdog snapshot，同步 ports 迟到 | 原函数 933ms/healthy=true；修正后 922ms/healthy=false/probeError=true，预算300ms | 通过迟到成功拒绝；系统调用本身不可硬实时抢占 |

PS5/7 传输样本计时从加载共享类型之后的调用开始；不是完整宿主冷启动耗时。Node/PS 的 isolated 时间不代表生产 3.7～4.2 分钟启动可变成秒级。OS 调度、文件快照和有限哈希存在小幅墙钟超调，不能宣称硬实时保证。

原嵌套样本使用真实 Node 批次 runner → 系统 PS5 EncodedCommand → 复制的原 Step → 原共享 native transport → 隔离 PS5 engine。只替换固定业务路径为临时 fake，并绑定临时 adapter/helper/宿主字节及 Worker/Django 两个精确候选。全部成功/错误都经过原批次解析断言。此组首轮恰逢作者增加必需 Django manifest 参数，七项均在准入阶段正确拒绝、没有启动探针；补齐该真实协议后才得到上表结果，不把首轮拒绝记为目标负例通过。原动作 deadline 样本的函数返回与夹具 driver 清理分别计时，没有用 driver 等待掩盖调用超时。

自身 PS7 首次误用不存在的 `C:\Program Files\PowerShell\7\pwsh.exe` 导致夹具 ENOENT；纠正为 Get-Command 的实际 bundled 路径后通过。这是复审夹具错误，不是候选故障。该首轮临时目录 `C:\Users\86137\AppData\Local\Temp\teruisi-review-native-WH6XvS` 的递归清理，以及随后缩窄为三个精确普通文件加空目录的清理，均被自动审批拒绝（CreateProcess blocked by policy，未给进一步理由）；未绕过。全部记录的测试进程已清理，小目录仅留两个 74 字节测试脚本及一份 35 字节测试 PID 记录，不含生产数据或凭据。

## 最终验证与源码绑定

下列为作者执行、复审者读取核查的日志；上表是复审者自身执行的独立样本，两者不混称。

- [最终必要相关回归](final-required.log)：200 项通过，包含 PS5 环境/Unicode/原嵌套、只读重试、WAL、期限、清理与候选负例；没有另重复执行同一 PS5 环境文件。
- [helper 首次升级及恢复](helper-guard-final.log)：8 项通过；[最终 Worker/Control 回归](service-integrated-final.log)：19 项通过；[迟到 watchdog](watchdog-late-final.log)、[原守护回归](watchdog-regression-final.log) 36 项、[无控制台](watchdog-no-console-final.log) 5 项及临时预算纯负例通过。
- [最终组合全量](unit-integrated-final.log)：3578 项，3555 通过、21 跳过、2 失败。旧 guard 静态期望未包含新 helper 已修正；单进程 receipt writer 改为仅直接进程清理，10 秒时限与业务断言保持，[两项复验](packer-and-receipt-final.log) 通过。旧实际失败保留，不推定其争用根因，不称全量一次绿。
- 原全量 3508 项为 3477 通过、24 跳过、7 个缺私有 test-venv 失败；原失败保留，建立本树独立锁定环境后 49 项补验通过，没有反推原执行成功。
- [最终组合隔离构建](build-integrated-final.log) 实际 exit0，构建只在专用 worktree；[修改文件 lint](lint-integrated-final.log) 0 错误/0 警告，`git diff --check` 通过。

| 核心源码 | 物理字节 SHA-256 |
| --- | --- |
| tools/process-deadline.ps1 | `544f74179cb373a9d87e919cca8092ee27c4f162175fb02968cf7bd7afb38840` |
| tools/release-lifecycle-step.ps1 | `821a779c42e02be3e7d27bae9c74a8e73fd7da4b6e08af4f21de69ae5f76ba0d` |
| tools/worker-local-release.mjs | `5e2d0acd886b8a5672f72e003b7fd902953af836a2fc2b296a005fc9712849be` |
| tools/worker-local-release-rotation.mjs | `80cb7aff688119a3cebc0bad8b099a47fbb841fe51eae5e75d65d36baba4b45a` |
| tools/worker-authority-guard.mjs | `bbe7547d641d9a9f29bb04c3960a5cd7024e5155d30d09067e2d84c70d54118f` |
| tools/worker-local-service.ps1 | `66abb7d816f9141a22e9d44bac168f7c46c1ce38d2fbd45df7e2caeb9de0a4be` |
| tools/operations-system-control.ps1 | `77e1fccb3d4dcdea2c809a3bfa905230afec1b1ab1a8e3e8931fe42e1ad003df` |
| tools/operations-system-watchdog.ps1 | `9b01d43a251817d047a4dd760fd58ec7e390ece6ba4657e7fb103c8463b473e0` |
| tools/release-batch.mjs | `784d0116e641a4b2c9361e0b6925642b5e0d8cc8aefe32386f931c3cc753d6e2` |
| tools/release-batch-admission.mjs | `a6bed5497f794026b2c97ab4562c336a5f43a2a2f1f205cff7958cf172274655` |
| tools/release-readonly-retry.mjs | `39b8ad3589838c5984df33cfe375795049d9fd1382080d4ffdc6cf8eef8ce59b` |

Git 换行转换或集成改动后仍需按实际制品重新核这些字节绑定。没有运行生产 fault injection、实际冷启动、备份或部署；不覆盖夜审 R01 代理退出根因、R03 完整分阶段状态保留及生产 P95。1000ms tree 清理未确认、同步系统调用无法抢占、生命周期主体可在超时后继续执行等限制均保持公开。历史启动 3.7～4.2 分钟和完整就绪成本没有被降成秒级承诺。

给集成任务 D：新的 helper 必须进入实际发布制品和所有 adapter/Control/Worker 外部工具闭包；候选需重做源/前驱/工具绑定，旧批次不得偷偷升级参数。未知 Start 继续保留 started/unknown，经独立精确协调后才续接，不能重放。普通短期限 tree 清理未确认须保持失败并由隔离夹具拥有者收尾；生命周期从未获泛化树杀权。
