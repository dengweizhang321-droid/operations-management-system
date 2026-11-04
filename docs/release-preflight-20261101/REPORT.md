# 合并前发布预检调查与方案

2026-11-01，Asia/Shanghai。状态：**只读调查和方案，未实施预检工具、未运行生产发布器 `--check`，也未声明当前环境通过准入。** 分支基线为 `3ce73dfa87884ceea23f3b71f90b2244704b4170`。本报告的行号均指这一 Git 对象；任务3并行修改分类器不改变本报告源码基线。

应新增独立的、可传入候选提交的 Windows 只读预检，优先暴露来源记账、真实控制代际、控制器资格、依赖与结构证据绑定问题。不能直接把现有 `publish-latest-main.mjs --check` 接到合并前：它会写控制审计、日志、Git引用、冻结工作树、请求和准备指针；有迁移时还会生成结构材料。此外，它把现场权限/部署/进程前置失败转为警告，随后仍可能打印“检查通过”。这两点比新增更多静态断言更应先解决。

## 证据与覆盖口径

逐条机器明细：[ASSERTIONS.csv](ASSERTIONS.csv)、[ASSERTIONS.json](ASSERTIONS.json)，共2,381个直接/候选依赖语法位置（JavaScript 1,549、PowerShell 77、Python 755）；每行保留文件、函数、行号、完整表达式、错误文字表达式、所处检查族、前移类别、现有check覆盖与新鲜度要求。无显式文案的 Node assert 写明默认 `AssertionError`，动态值不伪造为已发生错误。检查族与入口见 [GATE-GROUPS.json](GATE-GROUPS.json)，源码 Git blob/raw SHA 见 [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json)，完整方法与外部原始语料索引见 [COVERAGE.json](COVERAGE.json)。

先用 Acorn AST 解析基线全部 222 个 tools `.mjs`，提取 7,115 个 assert/fail/throw 语法位置；用 PowerShell Parser.ParseInput 解析 77 个 `.ps1/.psm1`，提取 2,315 个 throw 位置，两者解析错误均为0。再按实际调度入口、命名调用、静态及动态字面量 import、跨语言命令入口递归取闭包；结构 binder 使用 Python AST，并补 PiUpgradeCheck 的 Windows→WSL 入口。**这些全集不是9,430道发布闸。** 最终明细是直接审定检查族和保守依赖超集，`reachabilityStatus` 明确区分二者；同一函数里的prepare/check/recovery分支不会因函数可达就变成每次发布实际执行。

后续增量将仓库可读的内嵌脚本和动态目标单列为 [EMBEDDED-ASSERTIONS.csv](EMBEDDED-ASSERTIONS.csv) / [JSON](EMBEDDED-ASSERTIONS.json)，共44个位置，不混改已审2,381行主表：14段PowerShell静态展开/有界符号替换后语法解析0错误；再补Linux适配器字面量、DPAPI自有异常及实际被schema工具调用的Pi152/153静态ACL脚本。`process.pid`仅以合成整数供语法解析，明确不证明真实PID身份；内嵌行与原始表达式行分列，不能混报物理源码行。完整分项见 [EMBEDDED-COVERAGE.json](EMBEDDED-COVERAGE.json)。

本次没有通过关键词命中宣称全路径覆盖，也没有导入会自动执行的 `publish-main.mjs`。完整原始 AST 语料及取证脚本保留在 `D:/codex-artifacts/release-optimization-20261101/preflight/`；不作为工具代码修改提交。可复现命令为从本开发树运行该目录的 `extract-js-assertions.mjs`、`extract-ps-assertions.ps1` 和 `build-ledger.py`，它们只解析源码、读取Git对象并写调查输出；不得以其结果代替发布准入。

覆盖的边界必须保留：

- 外层正常发布/检查、冻结main子入口、内层 `publishPreparedMain` 写全局 `STARTED.json` 前，以及这段调用的原生只读校验分支，是本次主要边界。源码准备、旧专案续接、控制包采用/核销和全局STARTED后的生命周期分别列出，不混入普通路径。
- PowerShell 的 `& $Operation` 由实际 `VerifyPreparedApp`/`PiUpgradeCheck` 路由补边；两个PS动态调用语法点见 [DYNAMIC-EDGES.json](DYNAMIC-EDGES.json)，包含固定bundle/native、候选模块、PS→Python→WSL、有限binder及内嵌脚本的**16条已知动态边界**见 [DYNAMIC-BOUNDARIES.json](DYNAMIC-BOUNDARIES.json)，逐条给调用位置、精确目标/路径公式、已覆盖源码、剩余缺口和后续只读适配方式。CIM/TaskScheduler、Win32令牌、操作系统文件权限实现属于仓库外系统边界；本任务不枚举操作系统内部断言。未知版本输出 `unknown`，不能以“解析完源码”置PASS。
- Python依赖明细保留可能的校验函数超集，不能据此调用其Install/Finalize/database分支。`pi_agent_upgrade_runtime.py` 的Linux字面量、候选 `runtime_upgrade.check/context`、`server.private`、`protocol.decode`和`install_linux.source_digest`已索引；实际目标为 `/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases/<newSourceSha256>/backend/`。**未核的是该实际Linux不可变目录字节及当前DPAPI有效性**，不是把可读取的仓库源码留空；D07/D08明确后续隔离适配和只读绑定方式。本轮没有启动WSL或解密密钥。
- 读取/解码/导入、路径/ACL、子进程创建/真实退出、超时、HTTP传输、JSON重复键等还会抛系统异常。这些不是都有单一手写断言文字；表中相关入口加上这些失败类别才构成预检协议，不能只捕获 `assert` 文案。

因此，本表适合作为实施前的断言索引和适配器范围，不是“本机所有断言已通过”的证明，也不是任意未来版本动态调用的完备性证明。新增或无法解析的调用必须失败关闭并列缺口。

## 三层源码和多个 STARTED

实际链为：固定 `control/tools/publish-latest-main.mjs` 调度器 → 已采用bundle的 `runLatestMainCli` → `observeLatestMain` → `prepareLatestMainOnce` → 冻结包 `source/tools/publish-main.mjs` → `publishPreparedMain`。固定配置的 `nativeToolsSource` 用于外层现役链观察等操作；冻结包的 `publish-main.mjs:68-70` 又从**候选source**载入 Worker API、rotation和transport。不能用main某个导出替代固定旧native导出。

本次安全投影显示已采用控制bundle为 `3e01612a935319715ef082f3d9b73a9789401316c136e3e68a2712c5fab6dc6a`，来源 `271ab794fd487e5f943f83d8c83fb81542aa9c27`；固定native仍为 `native-tools/d08a3c4de4bd04325bd8e63811775934e97a9f63f757e40b6afec4a3166ddf31`，配置位于 `D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json`。完整字段/摘要及取证时间见任务2 [installed-safe-projection.json](../hash-pin-reduction-20261101/installed-safe-projection.json)。这些是只读文件身份，不是本次重新采用或全包原生验证。

| 标记 | 具体位置与语义 |
| --- | --- |
| 控制审计 execution | `main-control-dispatch.mjs:80-83`；调用审计，不是应用发布开始 |
| preparation/PREPARING | `publish-prepared-main.mjs:208-209`；开始准备，不能等同上线或排空 |
| `*-started.json` | `publish-main-step.mjs:10`；单个子步骤开始。复验已准备后台、PiUpgradeCheck、维护前只读检查均可在全局STARTED之前写它 |
| 普通冻结发布的全局 STARTED | `publish-prepared-main.mjs:288`；已通过前置后才写。其后才BeginWorkerDrain或EnterMaintenance |
| legacy/resume STARTED | `publish-main.mjs:144`；旧限定续接分支，不能套到当前冻结main普通分支 |
| handoff STARTED | `preparation-retirement-handoff`及runner自己的协议；S05b控制交接失败属于这一层，不是应用发布STARTED |
| `WorkerApply-started` / `Start-started` | 全局STARTED后的组件动作；不能把“启动服务”英文Start与发布STARTED混用 |

**STARTED前也未必没有写入。** 内层 `publishPreparedMain:89-91` 创建目录，`:165` 开始发布lease（`:110-114` 写Django runtime/run），原生步骤写日志；不能把整段前置函数直接当严格只读API。

## 从入口到全局 STARTED 的断言范围

下表按真实调用顺序汇总；逐条表达式和错误文字在机器明细。`可前移`指可以独立采集/比较相同事实，不表示可以不经拆分直接运行现有包装器。

| 检查族 / 位置 | 主要拒绝条件、原错误文字示例 | 无维护的合并前检查 |
| --- | --- | --- |
| G01–G02 固定调度/控制，`main-control-dispatch:24-84` | adopted状态、config/bundle/INTENT/transition/hook/Task闭包、文件类型/链接、前后CAS；`Control config changed`、`Control bundle changed:`、`Fixed preparation task changed` | 可读，但不得写controlExecution；实际已装版本单独绑定 |
| G03 退役准入，`preparation-retirement-admission:19-32` | intent/ban/seal、目标禁止重放、完整归档；`Preparation retirement is incomplete; new dispatch/source creation blocked` | 可只读；复用同次只读scope，不能跨操作缓存旧动态事实 |
| G04 队列/损失，`readRetiredPackets`→queue reader/损失reader | ticket→dispatch→result、unknown/abandoned/publication-retired、原生依赖、完整损失组及旁记录 | 可读；缺失不视为“尚未准备”，不得自动核销/新建票 |
| G05 现役来源，`publish-latest-main:33-68` | catalog三值同时等于实际Worker release/manifest、Django manifest，成功回执SHA/status/commit、来源HEAD/clean/tree、ready | 可提前观察；来源错误精确为“前后台来源不同且没有匹配发布记录，不能推定已发布版本” |
| G06–G08 候选/冻结/依赖，`:280-337`、`frozen-main-source:5-17`、`publish-main:20-81` | 半切换、retired packet、完整commit/tree、范围base/head、迁移支持、离线cache、pwsh字节、请求版本、普通token | 可检查候选实际字节；合并后的最终commit/制品身份仍须重绑定 |
| G09/G11 防重放和前驱，`publish-prepared-main:45-57,143-161` | 旧STARTED无SUCCESS、PREPARED缺失、旧SUCCESS不属于目标、两端前驱不一致 | 有最终包才完整；合并前无包标“尚不适用”，不可伪造PREPARED |
| G10 rotation/batch/链 | 锁占用、活动批次owner、唯一effective successor链、authority/fence/guard和当前头 | 静态链可读；原锁的互斥保障无法用提前快照替代 |
| G12–G14 准备包原生复验，`publish-prepared-main:172-203` | request/sourceIdentity/组件、source-binding、plan/candidate hashes、Django准备ID/receipt/manifest/前驱/指纹 | 只读纯校验可前移；rotation plan reuse/PS命令包装器仍有锁/日志 |
| G15 schema，`main-schema-release:42-145` | 有限父链、增删迁移集合、recipe字段、迁移归一字节、validation/recipe/evidence/code摘要、证据固定地址、父代证明 | 静态字节可在合并前比较；实际父代是动态输入。最终证据尚不存在时不能写PASS |
| G16–G17 Pi升级，`publish-prepared-main:17,243-245` | Runner image/registeredPlan/source、prepared=true/started=false；`PiUpgradeCheck`实际转PS→Python→WSL | Windows材料可读；完整跨WSL读法须按已装Runner闭包审定，不因命令叫check直接执行 |
| G18 维护资格，`manual-maintenance-continuation:171-319` | legacy/pi19db/native路线，installed/candidate AI byte pair、Wait/Stop函数资格、三个controller白名单、前驱与最初读字节一致 | **高优先前移**。真实发布在`:183`廉价先核，`:258`临近STARTED再核；CI覆盖不能代替实际前驱 |
| G19–G20 原生readiness，`manual-maintenance-preflight:4-7`及process模块 | 输入hash、route、完整/无重复pins、120秒、实际Pi receipt/config及PID/creation/exe/cmd | 可观察；发布时仍需新鲜原检查，不能把合并前120秒证据延长到上线 |
| G21 现场前置，`publish-latest-main:479-572` | 根/全树ACL、部署应用指纹、维护/排空残留、元数据不可读/出生早于声称父进程的假后裔 | 可提前读；当前probe会写controller诊断日志；现有check把失败降为警告，必须改变新预检输出契约 |
| G22–G23 最终材料，`publish-prepared-main:252-287` | 前驱再次变化、schema/readiness、旧新Worker入口、worker receipt、transport/pandas配置、原请求、材料SHA、源码最终身份、owner可读 | 可提前检查“现在存在/兼容”，未来publisher owner及最终材料不能预造；仍在发布前重核 |
| G24 子进程适配，`publish-main-step:14-25` | host/argv/environment、direct-exit-files、原始stdout/stderr/输出解码/JSON结果 | 参数/导出/版本可前移；未来退出和返回结果不能提前证明 |

结构摘要需特别区分：`check_schema_code_digest.py`入口只有CI调用，但它核的recipe/proof `codeSha256`也被真实 `main-schema-release`→`*_candidate.py`→`code_digest`消费。Sales/Pi候选的错误为 `Bound mandatory code checks do not cover these exact installer bytes`。不能把这类共享数据标成“仅CI、与发布无关”。

现行 `docs/规范/验证与发布.md:195` 将“checker仅CI调用”与“其比对的recipe/proof摘要无生产调用方”写在同一句，后者按摘要值理解与上述真实消费者不符。应在后续明确修正文案为“checker入口仅CI，摘要数据可能多用途”；本轮只读调查仅记录这一待修项，不扩改规范或放宽任何门禁。

全局STARTED后的排空、Stop/EnterMaintenance双锁、CAS/apply、迁移/权限/Finalize、ExitMaintenance、Start、VerifyStartup/ready的断言仍是原协议门禁。可以提前检查代码/材料兼容性，不能以本轮preflight声称这些真实动作已经完成；本次没有重新做功能验收。

## `--check` 实际覆盖、遗漏与副作用

| 行号 / 触发条件 | 实际动作 | 严格只读判断 |
| --- | --- | --- |
| `publish-latest-main:817`，v2受控配置 | `controlExecution`→`:80-83` mkdir/open wx/fsync审计 | 写固定状态目录 |
| `:846` | createReleaseProgress写stateDirectory/logs | 写检查日志 |
| `observeLatestMain:284` | git fetch origin/main，更新远端跟踪引用 | 网络+Git写入；会经过reference-transaction hook。当前manual-only在`main-prebuild-hook:73`返回，不能泛化为任何代际都不派发 |
| `prepareLatestMainOnce:313-316`，目标不等现役且source未建 | mkdir、worktree add、建codex/manual-main分支、worktree lock | Git/文件系统写入 |
| `:322`，有migration且没有匹配旧请求 | prepareMainSchemaRelease→`:129-132`建schema目录、binder写evidence；Pi路线还运行有限ACL校验脚本 | 材料写入/子进程；不是无效果dry-run |
| `:326,332-333` | 建node_modules junction；create-only scope/request | 来源/请求写入 |
| `:899`→`:932-934` | 写/rename `LATEST-PREPARED.json`为request-frozen | 改共用准备指针，即使尚无原生PREPARED |
| 子层 `publish-main:52-58`，有Django | temp/readiness.json，PS只读readiness检查，最后删除本次temp | 有临时写；未进维护 |
| `:900`→`:570-572` | probe ACL/deployment/CIM，失败catch→log警告→false | controller自身诊断日志可能写runtime；返回false未被当成整个check失败 |
| `:872-875,881` | check跳过发布queue锁及发布退休 | 不直接占发布queue；不能因此假定没有并发读漂移 |

它覆盖：固定控制及退役准入、现役来源/成功绑定、冻结候选/范围/依赖/host、结构证据、维护controller资格和readiness、PREPARED的轻量request/sourceIdentity绑定、现场前置的**诊断**。

它遗漏或不保证：完整Worker候选原生复验、Django `VerifyPreparedApp`、Pi升级计划真实复验、最终rotation/batch/owner、发布时新鲜前驱/锁/排空、最终材料清单，以及后续生命周期成功。`inspectMainPreparation:471`允许返回not-ready，最终check仍可“通过”；`publish-main:60`已返回，普通token检查`:71-72`和`publishPreparedMain`均未执行。**因此check成功既不表示制品已就绪，也不表示此刻可以发布。**

## 近30天失败和返工

窗口为上海自然日2026-10-03至本次2026-11-01取证时刻，按事件日期而非文件修改日期。逐项原文定位、唯一操作身份、门禁、阶段、可前移性及时间限定见 [HISTORY.json](HISTORY.json)，报告原文件摘要与匹配行见 [HISTORY-EVIDENCE.json](HISTORY-EVIDENCE.json)；S05d只读采集8轮的原始索引投影另见 [HISTORY-COLLECTOR-TRIALS.json](HISTORY-COLLECTOR-TRIALS.json)，8份原文件均已重算SHA匹配。其余历史事件以报告及其定位为证据层，不冒称全部原生失败日志都已重读；`assertionMapping`区分原断言、当前语义对应、仅历史报告和STARTED外路径。未合main的S05/S19报告以其保留worktree绝对路径标明，不复制旧证据或追改旧结论。

| 返工集中点 | 可证数量与时长 | 与合并前预检的关系 |
| --- | --- | --- |
| 真实依赖/入口闭包遗漏 | 10-10 owner-contract前5轮失败，第6轮通过；首轮开始至成功约17.02分钟。较大补闭包turn为97.23分钟 | 可以前置实际参数/依赖清单；97分钟不是一次发布失败、不是纯跑测试，也不能全称可节省 |
| 版本/字节资格与实际适配不一致 | 10-20一次发布前驱资格拒绝；10-24一个producer资格返工事件波及多个suite/两分支；10-25 Q14记录为静态兼容阻塞；10-29 Sales154一个静态失败及一次D08锁API实际适配失败 | 同为版本兼容问题但统计总体不同，不把静态测试数加成发布次数。最适合高优先前置 |
| S05d父子链与现场清单 | 两次不同run命中`Handoff parent has another child`；另8次只读collector尝试分别有实际索引/错误/时长 | 不是应用发布失败。要覆盖真实Task/原生导出/全部历史来源，不靠mock通过 |
| S19运行ACL与假后裔 | 10-24 r2、r3两次失败；r4为第三次尝试并成功。ACL处理报告19分钟；r3约26分钟中断/恢复跨度 | ACL和现有假后裔能维护前发现；未来进程变化仍须即时检查。两个跨度口径不同，不加成返工工时 |
| 制品损失 | 26个缺失packet，35条prepared dispatch；另14 unknown、4 non-production，合53关联dispatch | 完整外部依赖扫描可以前移；**不是35次发布失败**，不能恢复丢失PREPARED或据此推断过去零作用 |
| STARTED后动态问题 | 10-20 Finalize/Start fence/ready503，10-21 Start600秒超时等，各按原operation保留 | 静态预检不能承诺消除；保留原有限恢复协议，不能增加通用自动重试 |

按已识别**相同断言**次数：owner依赖失败5次属于开发依赖族，S05d唯一children断言2次，S05d只读120秒上限2次；普通发布中列出的具体ACL、假后裔、mutex和前驱资格各1次。没有完整每次修复起止与团队活动区间，无法诚实给出“哪个断言累计返工分钟最多”。上述排序是覆盖收益/已证重复频率，不是全主机故障排行榜；没有把缺ID、退出0但证据不足或仍在途记录强行计失败。

现场另见：当前catalog承认的Django来源与磁盘 `app/deployment.json` 的271来源不一致，271包有STARTED而无SUCCESS。任务4 [报告](../release-call-speedup-20261101/REPORT.md)和[timings.json](../release-call-speedup-20261101/timings.json)保留观察时间、路径和摘要。它可能是未闭合/在途操作，本调查不推断服务故障、实际进程版本或第四次失败，也不采取恢复/记账改写。

## 建议实施方案（待用户确认）

运行位置：实际Windows发布主机，当前登录普通用户；在最新main基础的隔离候选worktree执行一个**新独立入口**，输入固定的base/head commit与只读主机描述，输出到工作树外 `D:/codex-artifacts/release-preflight/<candidate>-<time>/`。命令名拟为 `node tools/release-preflight.mjs --base <生产基线> --head <候选> --host-config <固定配置> --out <新私有目录>`，**当前未实现，不要执行此拟定命令**。不fetch、不建/锁worktree、不写状态根、不建junction、不运行发布器/installer、不获取生产锁、不写lease、不唤醒Task、不解密业务秘密。

Windows外的CI仅做候选静态子集；实际安装控制/native/运行字节、ACL、CIM和Task事实必须在Windows主机取，CI绿色不能代替。读取配置只提所需路径、代际和摘要，环境/秘密不落报告。Git读操作设置 `GIT_OPTIONAL_LOCKS=0`，候选必须已提交且干净；输出目录不得位于生产runtime/state/packet或受保护源树内。

建议分三组一次输出，失败尽可能继续独立检查，以减少一关一修：

1. **静态候选**：完整Git差异/复制闭包、真实入口导出/签名/参数、受审controller候选资格、源码/recipe/proof/迁移字节、离线依赖锁与host身份。使用最终候选实际checkout字节，另记Git blob/tree；不把raw SHA与Git OID混用。任何授权期望必须来自现有受审资格，不自动把当前计算值写成期望。
2. **主机只读观察**：已采用控制bundle/native导出、catalog与实际三值及真实成功回执、源树/版本链、unknown/retired/artifact-loss、ACL/部署应用和CIM完整性。给动态时间/绑定；未知、权限不足、枚举漂移均不能PASS。现有会写日志的probe拆成纯投影，或者把日志接收器明确导向本次私有输出；不能静默调用原runtime诊断writer。
3. **最终制品条件**：合并前没有正式PREPARED时列 `not-applicable-yet`，说明后续仍由原准备/发布门禁核。已有相同精确版本材料可读其绑定，不能把候选测试包当最终main正式制品；有STARTED无SUCCESS则直接列阻塞/未知，不能调用adopt/retire/reconcile。

输出 `REPORT.json`、逐条 `checks.jsonl`、绑定文件清单、简短Markdown。每项含 `gateId/sourceLocation/inputIdentity/expectedAuthority/observedDigest/status/reason/recheckAtPublication`；状态至少 `pass/block/warn/unknown/not-applicable-yet`。总判定须分别给出 `candidateStaticReady`、`hostObservationReady`、`finalArtifactsReady`，并恒定注明 `publicationAuthorized=false`、`publicationPerformed=false`。存在required block/unknown即非零；warn不掩盖block，未有最终包不能显示“发布就绪”。

接入流程：任务分支完成必要构建/部署/启动代码检查后运行静态+主机只读观察，修复本任务可处理的确定缺口后提交审阅；用户授权合main后，从最终merge commit准备对应制品，重绑定变化输入；只有收到本次上线授权才进入原发布器。发布瞬间仍保留原身份、队列→rotation锁序、前驱CAS、制品完整性、排空/维护和启动门禁。预检不是新上线授权，也不变更旧封存批次。

先实施最小高收益范围：G05来源/目录三值与unknown、G18controller/实际native资格、G06/G08依赖和真实入口、G15共享schema摘要、G21现场失败不再转成功。完整性全树扫描和真实冷启动的成本/收益由任务4另评估；本轮不通过删除门禁、扩大豁免或反复全量测试求快。

本任务只新增报告与机器证据。未修改发布工具、hardcoded hash、`.gitattributes`、已安装控制包或历史封存证据；未合并main、准备制品、部署、启停服务、维护、业务写入或外发。
