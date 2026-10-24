# S16 准备阶段热点：先核实再改

2026-10-24 夜间，草稿仓库 `codex/release-rework-20261024` 提交 `22193950`；行号按该提交。返回 [本轮报告](REPORT.md)。

结论：今晚只实施首尾分项计时（仅日志），其余三项不实施，给出设计与待确认事项；没有改哈希内容、manifest、文件布局或作用顺序。按代码对照，首段 339.210 秒和尾段 384.287 秒的主体是“前驱完整自校验”，一次非复用准备共做 5 次，另有 5 次源码身份采样；不是复制或编译。下一次自然准备的新计时会给出实数，以下凡标“推断”的数都待它核实。

## 1. 首尾两段对应的代码

前端阶段入口是 publish-prepared-main.mjs:211-219（构建前端）：workerPreparationIdentity(source) 写 source-binding.json，再同进程调用 planWorkerReleaseRotation({prepareOnline:true})（worker-local-release-rotation.mjs:1112 起），其中调用 buildWorkerReleaseInternal（worker-local-release.mjs:1932 起）。

首段（前端开始→源码快照开始，339.210 秒）依次为：
1. 入口源码身份采样（publish-prepared-main）。
2. 轮换锁、批次归属、服务锁（PowerShell 互斥子进程）、生效链解析（含已安装入口校验）。
3. 前驱完整自校验 P1：verifyReleaseWithOwnVerifier 以子进程运行前驱自己的 worker-local-release.mjs verify，完整校验前驱的 source-snapshot、dist、node_modules（31418 文件/708.9MB）、helper 及各收据。
4. 切换证据与 D1 退役回执读取，释放服务锁。
5. 源码身份采样（sampleSource，含 readWorkerSourceBinding、verifyBoundWorkerSource）。
6. 已准备构建清单扫描。
7. 构建入口：verifyBoundWorkerSource（第 3 次身份采样）、前驱边界校验（服务锁+生效链+前驱完整自校验 P2）、resolveBundledNpmToolchain。

候选完整复验（242.007 秒）末尾的 processState 也是一次前驱边界校验 P3（worker-local-release.mjs:3125）。

尾段（候选复验结束→前端阶段结束，384.287 秒）依次为：
1. 前驱边界校验 P4（worker-local-release.mjs:2260-2261）。
2. 回到轮换模块：第 5 次源码身份采样。
3. 尾段服务锁、生效链、前驱完整自校验 P5（持服务锁直到计划发布）。
4. 生效链复核、候选绑定、受保护入口计划、publishRotationPlan、准备身份落盘；最后 publish-prepared-main 写 worker-plan.json。

量级推断（非实测）：“封包结束→候选复验开始”12.286 秒内含一次 verifyBoundWorkerSource、两次 npm 工具链解析和清单写入，所以一次源码身份采样不超过约 12 秒。首段约为 2P+3I+杂项，尾段约为 2P+I+杂项，推得一次前驱完整自校验约 150 至 185 秒，5 次合计约 750 至 900 秒，可能占前端阶段一半以上。

## 2. 已实施：首尾分项计时（仅日志）

提交 22193950，只改 tools/worker-local-release-rotation.mjs（+57/-21），新增 tests/worker-preparation-timing.test.mjs。

- 新增导出 preparationTimingLine、logPreparationTiming、timePreparationStage。输出走与 buildTiming 相同的 stdout 和 [构建明细] 标签，格式为 `[UTC] [构建明细] stage=<ASCII 键> elapsedMs=<毫秒> outcome=ok|failed <中文名>`。ASCII 键和数字放在前面，避开 51e runner 日志乱码吞首位数字的问题（S05c 中“?5835 ms”等无法恢复）。失败也记一行（outcome=failed），便于 unknown 时定位；记录器出错被吞掉，不改变返回值和异常。
- 标记点（planWorkerReleaseRotation 内）：rotation-lock、batch-ownership、head.service-lock、head.chain-resolve、head.predecessor-self-verify、source-identity#n、predecessor-boundary#n.service-lock/.chain-resolve/.self-verify（包住传给构建的前驱回调；新建路径 #1 在构建入口、#2 在候选复验内、#3 在候选复验后，复用路径只有 #1）、reuse.candidate-verify、candidate-build、tail.service-lock、tail.chain-resolve、tail.predecessor-self-verify、plan-publication。
- 和现有 buildTiming 行合起来：首段可拆为入口身份采样（前端开始至 rotation-lock 开始之差）、首段锁/链/P1、source-identity#1、清单扫描（差值）、构建入口身份采样（candidate-build 开始至 predecessor-boundary#1 开始之差）、P2、工具链解析（P2 结束至源码段开始之差）；候选复验 242 秒拆为候选自身与 predecessor-boundary#2；尾段拆为 predecessor-boundary#3、source-identity#2、尾段锁/链/P5、plan-publication、worker-plan 写入（差值）。
- 未改：哈希内容、manifest、计划和收据字段、文件布局、调用顺序。受保护的 Worker verifier worker-local-release.mjs 未改。用旧版与新版 planWorkerReleaseRotation 抽取 29 类读、锁、校验、写调用的顺序逐项比对，完全一致，测试也固定了该顺序。
- 测试：worker-preparation-timing 6/6（去掉两个包装后 1 项失败，恢复后 6/6）；main-prebuild-queue-abandonment 13/13；release-scope-control-only 5/5。tests/worker-local-release-rotation.test.ts、tests/worker-local-release.test.ts 需 tsx 并起子进程，留到早上沙箱外运行。
- 采用：这是冻结在包内运行的原生发布工具，按 S08 冻结规则随下一次真实应用发布生效；下一次自然准备即产出分项数据，不为测量单独准备或重复构建。

## 3. 候选一：docs/tests/demos 不进运行包，不实施

- 位置：Worker 源码快照来自 listGitSourceFiles（worker-local-release.mjs:926，git ls-files --cached --others --exclude-standard，只排除 dist、node_modules、.git、.runtime、outputs、tmp 和 .dev.vars）。packet 的 3.7 万文件/850MB 里 node_modules 被 .gitignore 排除，不在 Worker 源码快照中。本分支跟踪文件 9986 个、159MB，其中 docs 5300/75.1MB、tests 1279/31.5MB、demos 106/11.2MB，合计约占 67% 文件、74% 字节；生产 release 的 source.tree.fileCount 由 9143 增至 9653。
- 成本：一次准备中快照约被完整处理 16 遍（5 次身份采样、源树哈希、两次复制（:2015、:2019）、复制后哈希、3 次 closure 复核、候选复验 source-snapshot、5 次前驱自校验各校验前驱的 source-snapshot），部署复验和启动校验还要再读。按一遍不超过约 10 秒推，docs/tests/demos 份额约 60 至 110 秒/次（推断）。
- 运行时是否读：tests 会被读。lib/market/admin-service.ts 与 lib/market/annotation-service.ts 引入 ../../tests/legacy/market/annotation-model，进入 Vinext 构建，所以 tests 不能排除。docs、demos 在 app、lib、worker、components 和 vite/next/tsconfig 中未检索到引用，这只是静态检索，未做构建对照。
- 兼容性：manifest.source.tree、sourceFingerprint、sourceInventorySha256 都按这份集合计算，多个消费者用同一规则重算再比对：publish-latest-main.mjs readLivePublication（无 PUBLISHED-MAIN 记录时以 manifest.source.tree 比对用 nativeToolsSource 的 listGitSourceFiles 重算的树，不一致即“已部署来源与实际运行包不一致”）、publish-latest-main.mjs:376 发布后写 catalog sourceTree、release-batch-admission.mjs:211、release-payload-retention.mjs:94、assertWorkerSourceBindingTuple 及已准备构建复用身份。不加版本就改规则，新旧工具对同一提交会算出不同的树，现役 release、前驱链与 nativeToolsSource（d08a3c4d…）之间比对失败。
- 结论：今晚不做。要做须：①只排除 docs、demos（tests 不行），并用构建对照证明 dist 字节不变；②manifest 增加源码范围版本字段，所有重算方按 manifest 声明的范围重算，旧 release 走旧规则；③nativeToolsSource 与控制包同步升级（S09）；④为部署复验、readLivePublication 和保留期工具补回归测试。收益约 1 至 2 分钟/次（推断），优先级低于第 4 节的前驱复验次数。

## 4. 候选二：同进程只哈希一次并复用，未证明，不实施

逐处核对 hashTree( 与 hashRelativeFiles( 调用：
- resolveBundledNpmToolchain 前后两次 hashTree(npm 包根)（:642、:678）：有意检查版本探测前后不变。一次准备里该函数被调用十余次（每次身份采样、构建入口、依赖安装后、清单前、候选复验、每个前驱子进程）。npm 根在 Node 安装目录，进程外可写，不是本进程的不可变树。不复用。
- 源码树 sourceTree（:2013）与复制后 copiedSourceTree（:2016）：根不同，是复制校验，必须保留。
- assertIsolatedSourceClosure 三次（:2048、:2057、:2075，buildRoot）：前两次之间有 helper 构建子进程；第 2、3 次之间本进程只读（dist、node_modules 哈希与纯函数 requiredPublicationCodeChecks），但 buildRoot 是可写暂存目录，构建子进程的后代可能滞留，第 3 次正是跨时间复核，不能证明期间无写入，收益也只有几秒。不复用。
- 产物 distTree、nodeModulesTree（:2060-2061）与封包后 validateTree（:2130-2132）：根不同（build 到 release），是复制校验，必须保留。
- helperTree（:1643）、validateTree（:2330）、候选复验（:3020-3036）：写入 releases 后在新根上的独立完整校验，按要求保留。
- 前驱完整自校验 P1 至 P5：各是独立子进程，跨时间，期间为不挡服务恢复而释放服务锁，不属于同进程同一不可变树。不能缓存哈希。
- 5 次源码身份采样：目的就是发现准备期间源码变化（“Preparation inputs changed during build”），不能复用。

结论：没有一处同时满足“同进程、同一不可变树、期间无写入、复用键覆盖精确文件列表和根”，按规则不实施。

真正的大头是前驱复验次数，以下设计需独立审查确认：
- D-1 去掉被支配的 P4：P3（候选复验末尾）结束后紧接 P4（:2261），之后只有一次源码身份采样，再到 P5（持服务锁直到计划发布）。P4 能发现的状态 P5 都会再查，失败后果相同（候选保留、不生成计划；P4 失败时同样不删候选）。差别只在瞬时异常出现在 P4 时刻、到 P5 已恢复的情形不再报错。预计省一次前驱复验（约 150 至 185 秒，推断）。
- D-2 中间边界改为轻量：P2、P3 只做服务锁、生效链与 head 绑定比对及进程状态检查，不重哈希前驱树；P1（入口）和 P5（终点、持锁）保持完整。预计再省两次（约 300 至 370 秒，推断）。需确认：准备期间前驱 release 目录被篡改的风险由 P5 覆盖是否足够；候选复验的 processState 改由轻量检查提供是否可接受。
- 两项都要改 worker-local-release.mjs（受保护 verifier）或轮换语义，须先用新计时取得 P 的实数，再单独审查，随真实发布带出。

## 5. 候选三：依赖按锁哈希共享存储并硬链接，不实施

- 位置：每次在 .staging/deploy-<uuid>/build 下执行 npm ci（:2032，--ignore-scripts=false），哈希 nodeModulesTree（:2061），再 cp 到 release/node_modules（:2115）并 validateTree（:2131）。每个 release 各存一份 709MB。
- 成本：依赖所在区间 132.862 秒（含 package/lock 校验）；封包 161.589 秒中 node_modules 复制与复验占大部分，产物哈希 90.917 秒中 node_modules 哈希占大部分（均未单独计时）。
- 只读证据：生产 D:\teruisi-runtime\teruisi-worker-sales\releases 的 328 个 manifest 中，同一 lock 的 nodeModulesTree 大多一致（8ec00f80… 20 个、2d908402… 76 个、6a7a36db… 61 个、93f3f3d9… 21 个，各组全同），但 lock 486154660ca7… 有两种树：ef2eccbd…（46 个，09-14 至 09-28）与 9fed34ef…（104 个，09-29 至 10-18），文件数 31248、npm 版本、npmCiArguments、npm 包树、Node 路径都相同。可见 npm ci 输出不只由 lock 和工具链决定（可能是安装脚本、环境或外部 npm 配置），存储键至少要覆盖准备身份中除源码树外的全部输入（lock、Node/npm 工具链、外部 npm 配置、环境哈希），链接后仍须完整哈希验证。328 个 release 中仅 96 个仍保留 node_modules 目录（其余已被保留期工具清理）。
- 风险：硬链接共享 inode 与 ACL，任一 release 或运行时写 node_modules 会同时改动所有 release；validateTree 不查 nlink，现有校验发现不了共享；release-payload-retention 的删除和 ACL 加固要重审。
- 结论：今晚不做。需确认：①运行时（wrangler dev、workerd、helper）不写 release/node_modules（运行前后比对哈希）；②共享存储的只读 ACL 方案；③键的组成，以及同键不同树时拒绝复用、回到 npm ci；④与保留期工具的配合。较稳的第一步是同键时把已验证的 npm ci 结果复用到 buildRoot，其余照常复制和校验，只省 npm ci，不改 release 布局。

## 6. 候选四：拆分尾段 384 秒计时，已实施

见第 2 节，首段 339 秒一并拆分。

## 7. 已知限制

- tools/preparation-producer-qualification.mjs 的 closures[0] 固定了 publish-prepared-main.mjs、worker-local-release-rotation.mjs、worker-local-release.mjs 的字节，preparation-retirement-qualification.mjs 复用它，tests/preparation-retirement-collector.test.mjs 断言仓库实际字节等于固定值。S05d（24dd52ac）已改 publish-prepared-main.mjs，该测试在基线已失败；本次再改 rotation，不改变该测试结果。资格检查看的是 packet 自带的冻结源码，a3d53227 的 packet 不受影响，新包走 S05d 的结构化终态。（10-24 早上更正：该测试在基线通过，S05d 起才失败；同一固定也用于管理员 resolution。已追加 S05d 与 S05d+S16 两个资格闭包，第一个闭包不变，夹具改读冻结的原审查字节，见[夜间报告](REPORT.md#2026-10-24-早上推送脚本中止与修复)。）
- install-main-prebuild.mjs 的 codeOnlyNativeToolsPins、successor512NativeToolsPins 固定的是 nativeToolsSource 的字节，与应用源码无关，不受影响。
- 新计时行进入发布器 stdout（runner 日志）；runner 日志的 GBK 误解码未修，只是把 ASCII 字段放前面以免丢数。
