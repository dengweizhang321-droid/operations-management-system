# 任务 C 非作者独立复审

2026-10-10，任务 C 开发基线 `origin/main 99eaa0b9`，最终独立被测代码为 **`2b10f6021a0b5bda1f52424604bf697b17218e3c`**（保留 A、B 接缝）。审查者为独立子智能体 `/root/independent_review`，未修改实现、未提交或操作生产。**审查范围内无剩余已知源码阻断；独立 166 项与 12 项探针通过。** 九份实现文件在测试前后 SHA 完全相同，见[源码摘要封存](INDEPENDENT_SOURCE_SHA256.json)。这不表示生产采用条件或分钟级目标已经满足。

## 审查范围与最终边界

审查 `release-impact.mjs`、`release-batch.mjs`、`release-batch-admission.mjs`、新增准备身份证据与计时模块，以及原 Worker 制品打包清单。读取共享记忆启动协议、实际 AGENTS、项目说明、开发交付、验证发布、运行启动、数据存储、安全规范和发布批次协议。

- 影响证据绑定实际生产前驱的完整 source-snapshot 和最终候选。`app/api`、权限、写入、配置、依赖及无法证明的执行变化保持严格流程；第三批真实四文件变化仍为 strict。
- 新 UI 交互证明只覆盖无参、单一 React Boolean state 的窄组件：直接返回受限内建展示节点，局部按钮事件和被动文本／条件显示。请求资源、提交控制、构造调用、其他事件、全局赋值及自定义内建元素均拒绝。
- CSS 只掩去固定展示属性的值；选择器、规则结构、资源加载、变量定义、安全相关属性保持字节绑定。PNG 必须满足受限结构、CRC、解压大小及扫描行校验；SVG 等未纳入。
- 恢复证据仍要求 26 小时恢复点、7 天同一精确恢复点完整演练、持续成功日备份和现场环境／目录／权限／序列／保留匹配。每个操作边界重新检查资格。数据库步骤在封存时明确，不能执行中减免。
- Worker-only 四项生命周期步骤必须是原 adapter 的真实 lifecycle 操作，绑定精确 owner、类型、阶段与唯一顺序；沿用 `BeginWorkerDrain → StopForRelease → apply → Start → EndWorkerDrain`。unknown／started 不自动重放，失败保留 gate 与所有权。
- 新内存复用只覆盖准备身份的派生计算；每轮重新读取源文件、Node/npm 和配置的完整字节，并在观察后、WAL 前和实际调用前复验变化／期限。源盘点前后比较兼顾 Git 外部 index；watcher 只负责失效，不能替代字节相等。上下文有 10 分钟、24 次、同批绑定、并发拒绝、异常失效与 dispose 边界。
- 源文件读取为每组 8 个 `Promise.allSettled` 的有界并发，全部 `safeRead`、字节、排序协议和失败同伴等待保留。只有 `.git` 探测本身不存在才使用物理目录盘点；Git 读取中断不能降级。
- 大制品未纳入本轮缓存。原 admission／drain／closeout 完整验证保持，实际 apply 边界另保留完整验证；原 apply／Start 自身验证继续。实时 Worker/helper 进程身份每轮现场检查。原已存在的非大树阶段不计为本次缓存收益。

A 接缝保留精确 Start 参数、同一 deadline、`direct-exit-files`、变异操作 preserve、不重放未知结果及 `processEvidence`；原 adapter 仍调用唯一生命周期引擎。新准备上下文与 A 的 `preparationEnvironmentSha256` 一致，只排除每次调用的 `TERUISI_PROCESS_DEADLINE_UNIX_MS`，其他环境变量继续参与身份。B 的只读重试、完整 readiness 断言、attempts 和脱敏诊断在 CLI／in-process 及 journal 接缝保留，B 模块在 bundle、keyFiles 与 collector pin 中。

## 独立发现与闭合

| 独立触发例 | 初始问题 | 当前收口 |
| --- | --- | --- |
| 普通 Boolean toggle | `Function` 正则命中 function 声明，扩展完全不生效 | 声明与动态构造检测分开；合格局部显示通过 |
| state 控制 `img src`／submit disabled | JSX 位置被误当纯显示证明 | 节点、属性、状态表达式均有窄白名单 |
| assignment／new／tagged template／其他事件 | 没有 CallExpression 仍可能产生副作用 | 整个 JSX 表达式纯度检查拒绝 |
| return 外层 comma／assignment | 副作用绕过 JSX 内表达式检查 | 去括号后必须直接返回 JSX |
| `<button is="write-on-connect">` | 内建 tag 可选择自定义执行能力 | 静态属性白名单拒绝 `is` |
| recheck 的源读完后修改真实临时文件 | 最终观察返回旧身份 | 前后全源盘点、持续失效监视及调用门禁拒绝 |
| 开始 599999 ms、观察结束 600001 ms | 期限只覆盖观察开始 | 完成和使用时复验期限 |
| StartWorker 改成非 lifecycle、保留 step 标签后重算 batch SHA | count／order 不能证明实际调用原引擎 | step 必须匹配类型、效果和阶段 |
| D1 实现及 TypeScript 解析依赖未 pin | in-process 直接依赖闭包不完整 | 必需实现／解析文件与包解析清单绑定 |
| 新模块只在 source-snapshot | runtime/tools 缺模块，采用后入口无法导入 | 原 bundled/keyFile 清单包含新增模块 |
| failed collector 抛错 | 子阶段耗时无法到达 journal | 受限阶段数组随受控失败进入 journal |
| 扩大每轮完整大树验证 | 原基线只在固定阶段完整验证；扩大门禁会掩盖性能回退 | 复核原基线后保留原阶段，不把原有省略当新复用 |
| Git 树内读文件 ENOENT | catch 范围可能切换到物理盘点，改变忽略文件语义 | 仅 `.git` 探测允许不存在；其余失败直接拒绝 |

审查曾建议旧 collector 每轮完整校验，后按 `origin/main` 原实现纠正：基线已经只在 admission／drain／closeout 执行大树验证。此修正已明确通知作者，不将扩大门禁说成保留原行为。

## 已执行证据

最终[独立联合日志](INDEPENDENT_TESTS.log)：**166／166 通过、0 失败、0 跳过，70.076 秒**。串行运行 fastpath、原 wait optimization、PS5 environment、acceptance closeout、independent closeout、A process deadline、payload retention 七个入口；覆盖原读状态重试／未知不重放以及 A 真实 PS5／PS7、后代持有流、原 adapter 正反例。`git diff --check` 通过；九份源码 SHA 与 HEAD 在测试及探针前后稳定。

中间版本 78／78（39.334 秒）仍是中间验证。一轮在作者合并 A 期间误读到未解冲突 marker，五个入口导入失败；保全于[合并中日志](INDEPENDENT_TESTS_DURING_A_MERGE.log)，未修改或代作者解冲突。该轮不是稳定候选实现失败，也没有删除后冒称原先通过。

最终独立 [探针脚本](INDEPENDENT_PROBES.mjs) 和 [原始结果](INDEPENDENT_PROBES.log)：**12／12 通过**。覆盖普通被动显示、请求资源／提交控制／内联赋值／构造／tagged template／其他事件／自定义 `is`／return 外层副作用，以及真实字节 TOCTOU。实际临时 source/runtime/npmrc、只读 Node/npm；未读取真实 `.dev.vars` 或真实 user/global npmrc，生产 operator 调用为 0。最终探针运行约 1.80 秒属于热缓存样本，不计为发布性能对照。

## 计时和采用限制

完整制品、恢复资格与状态计时由正式 collector 的阶段字段提供；隔离身份阶段对照不能替代整批 initial／boundary 耗时。普通 Node HTTP child 的 stop／relaunch 仅证明夹具少重启一个进程的差值，不能证明原 Worker／Django 生命周期节省 3～6 分钟。只包含 dist 与 node_modules 的摘要不能称完整 release 制品摘要。

已独立核对[完整配对结果](timing.json)：在 **C+B／4421677c** 冻结来源 `bf7d492e6b3cc9af184ec4771728c724ac16ec530deebb4dc24862ba33200da2`、同一 dist+依赖 payload `ccc9f19ffb2b574ef048cb50de8b8e062e4b15303a8f22fcd22ec815752dcfd1` 下，三个身份阶段顺序为 admission／prepare／closeout，反转配对顺序；四个最终身份摘要完全相同，completed 与正常清理均通过。

| 配对 | 原完整身份计算 | 准备派生身份复用 | 差值 |
| --- | ---: | ---: | ---: |
| baseline → optimized | 96.248 秒 | 72.082 秒 | 24.167 秒 |
| optimized → baseline | 96.942 秒 | 75.328 秒 | 21.614 秒 |

这里仅实测三阶段净省 21.6～24.2 秒；**未证明额外省 10～20 分钟，也不是 A+B+C 的完整发布计时**。完整源读单阶段 8.162→4.110 秒另列，不再与配对差值相加。私有普通进程 full 212.954／252.379 ms、worker-only 108.679／109.531 ms 仅为其机制范围，不外推为原引擎分钟数。早期九轮 354.372 秒单边样本与中断反向样本均未闭合，见[原未完成记录](timing-incomplete.json)及[未完成有界记录](timing-first-bounded-incomplete.json)，不得与当前配对直接拼接。

数据库流程预计省 48～55 分钟来自既有生产记录与满足条件时不再新做四项数据库操作；并非本次实际删除生产步骤或实测新恢复。Worker-only 的 3～6 分钟及重复检查 10～20 分钟预算，必须与实际测量范围分列，不重复累计，不宣称已验证生产节省。

日备份 PAUSED 的事实不能由新机制改变，生产快路径目前仍被该前置条件阻断。本轮发布机制首次采用继续严格发布；本报告不授予部署、启停、数据写入、调度变更、备份或外发许可。全量单测／构建及集成任务 D 的完整同制品生命周期测量由作者与集成方保全，本独立复审不将未亲自执行的检查列为独立实测通过。

早期隔离计时留下 `C:/Users/86137/AppData/Local/Temp/teruisi-fastpath-measure-AZ78bE`；原强制递归清理被自动审批拒绝（blocked by policy），作者未绕过。该限制与当前完成配对的 cleanup=passed 分开记录，不据此声称所有旧夹具都已清理。
