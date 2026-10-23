# 发布优化统一集成报告

2026-10-12任务，2026-10-13收尾（Asia/Shanghai）。结论：**六任务已收齐并统一到独立候选分支；组合验证仍有阻断，未合并main，未执行生产发布。** 不把五项交付完成、局部测试通过或Git集成称作生产能力全部完成。本轮不是六次生产发布。

## 来源、交付与集成SHA

分支：`codex/release-pipeline-integration-20261012`；worktree：`D:/codex-isolated/release-pipeline-integration-20261012/运营管理系统`。创建前fetch的baseSha为`b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354`，最后复查origin/main仍该值。主检出main保持`2f55c3965e60b139381b6cc31ed868bcfe99a7bf`及既有用户改动。

| 任务 | 确定交付SHA | 集成SHA | 实际状态 |
| --- | --- | --- | --- |
| WP-B / WP-0 | `74c5e6330b88248c7ebcc778e32310c5b46631d3` | `68d243143ae75039cb2310c393a4b495c4e0f184` | 基线/盘点文档，无需产品代码改动 |
| WP-1 | `3558ba18ca9eed8971bf67e7e54220519596dc80` | `4354892f23bd3ec71db46cd464a4c8fd60a6912e` | CI候选已集成，整体验证不完整 |
| WP-5 / WP-5G | `4968baedd7ac3fa0948258cdc854fd25045fe8cd` | `a5e3259a9af71b30b7ecfbcdadc99717af95bcf3` | PS5真实退出码必要修复候选，未生产采用 |
| WP-4 | `39feb86c7c51b9b8c99232840bf55ad1b0027a02` | `6a7b496263c95f405f23fea56ef6d09fb3741595` | 时序报告/机器证据，无需产品代码改动 |
| WP-3 | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` | `849bee83e57cf8c4ed9f4b29b158997611c41c64` | 既有离线报告必要扩展，未安装自动hook |
| WP-2 | `f03cf9395d2a8bc7e4c471a9f6f7877e550e74f3` | 同一直接提交 | 唯一规范正文/历史证据对照；不运行历史分类器 |

WP-2完整SHA已从Git实际回读核定。最终报告/证据提交的HEAD是上述任务提交的文档后继，最终聊天及仓库外`D:/codex-artifacts/release-pipeline-integration-20261012/FINAL-DELIVERY.json`记录其真实远端回读，避免报告自指SHA。主线未合并，以上“集成”只指本候选分支。

[完整交付表](DELIVERY-TABLE.md)记录各任务baseSha、全部文件集合、验证、限制、依赖及无需改动判断；[机器清单](DELIVERIES.json)记录固定tip和文件全集。五分支真实origin tip与确定交付一致，且均为集成祖先；按基线→CI/可靠性/时序→证据扩展顺序正常merge，无冲突，不cherry-pick重复实现。最新main增量为空；共享依赖safeProcessEvidence已在base，WP-3不依赖WP-5新失败文本解码。

WP-1原四提交保持不变。另核原交接补丁SHA-256`eab391b05c19705ae2e5a6822e5dabb80946af27ab4b9076a981de81ddec22b2`，git apply --check通过后在集成分支追加`607a7c197aec7d7acbf5da218b60f5b709557899`及原交接证据`529a1b11af92283a20d093d0c758dbce37a6aa01`。修正PS5短名根的同语义规范化、系统Modules及必要审查摘要，没有扩大10秒/120秒预算。WP-5与WP-3最终产品/测试和原交付SHA语义diff完全一致。

## 完成、待验证与阻断

| 范围 | 本轮实际完成 | 限制与阻断 |
| --- | --- | --- |
| 基线/历史盘点 | 实现、采用、当前健康分别记录，原固定调查报告保留；本轮重采Git/可见进程/任务与正式绑定 | 未取得全OS句柄/cwd或所有聊天用途；没有因数量目标删除 |
| CI | 可运行明确资源审查的L0/L1；Windows根身份修正本机通过；失败传播真实云端保持 | L0原lint失败/域缺口；云端L1子夹具超时，后续业务契约未执行；云端summary dirty拒绝且原因未定位。L2/L3业务适配器及完整冷启动尚未验收 |
| 可靠性 | 普通包装器真实exit0/9/259、null拒绝、后代输出分离及锁异常释放两shell实际通过 | 不推断历史Backup/退出/OOM同源；未改广泛native/PG/持锁helper；既有进程树清理负例当前和固定base均失败，根因未知 |
| 证据报告 | 安全进程投影、required/recorded checks、候选/前驱计划、原字节、历史新鲜度、V2终点；原失败/unknown/reconcile分列 | acceptancePassed始终null；缺验证器版本/测试级前驱等旧字段不伪造；未接阶段自动hook，生成不是生产验收 |
| WP-2 | 唯一正文在验证与发布，其余专题链接；28份历史来源SHA与证据范围对照 | 缺完整前驱/候选/部署输入时无法判定精确减免；没有运行纸面分类或承诺历史可省动作 |
| WP-4 | f15完整T1补齐、T2采样边界和T3补证/正常恢复分类保持 | 并发/缓存/阶段重排/资源打点方案未实施，配对净收益未测 |
| WP-0G | 每树重核当前Git/包含关系、可见进程/任务引用及有限正式绑定；必要报告/证据保全 | 37树保留，0归档、0工作树删除、0分支删除。主检出由原任务继续处理；候选未合main，不满足本轮分支清理前提 |

实际组合计划requiredLevel=3、全部18域：package配置与未知发布工具路径不能凭名称下调。原L2/L3入口即使基础设施探针执行成功也只pending，缺真实业务适配器/完整冷启动。目前无法完成必要更高级别验证，按当前用户指令及开发规范保留候选并阻断main；不凭L0/L1通过放行，不启用branch protection或删掉缺口求绿。

## 组合验证与原失败边界

被测执行代码SHA为`529a1b11af92283a20d093d0c758dbce37a6aa01`。之后只新增规范/报告/编码证据，执行代码不变；旧验证fingerprint不能冒充最终文档HEAD的完整通过。未运行test:unit/npm test通配符、生产构建、Wrangler、真实PG/浏览器业务或生命周期。

| 本轮检查 | 实际结果 |
| --- | --- |
| L0 `--base b3c6018c --domains all` | 21项已审切片通过；完整lint63 errors/112 warnings，exit1；墙钟73.948秒；13个L0域缺口 |
| L1相同base/domain | 58项Node断言及PS5真实独立进程/互斥夹具通过；exit0，5.178秒；11个L1域缺口 |
| summary | exit2，“验证不完整”：L0未通过、L1覆盖缺口、L2/L3未验证；没有发合格全套回执 |
| WP-5受影响回归 | operations-system-service/system-lifecycle-race/startup-release-optimization合计17/17，exit0，32.384秒；两shell退出码修复通过 |
| 原安全deadline选名 | 原组合11/13；PS7因本轮封装缺APPDATA被拒，补齐独立临时profile后该项通过；ordinary isolated tree cleanup仍失败。不能写整组13/13 |
| 固定base树清理对照 | git archive仅原tools/该测试/合成fixture到tmp，原base同一环境精确选名1/1失败；工具与该case未被本轮修改。未知根因保持，不搭车修复 |
| WP-3合同/相邻回归 | 21/21独立报告、6/6内容指纹选名、3/3计时/原WAL选名通过；不称全缓存通过 |
| 两批原件离线CLI | f15与10-09均create-only新tmp目录成功，status=journal-completed-review-required、acceptancePassed=null；没有调用journal执行器或业务接口 |
| 原件保全 | 原112份大小/SHA再核全部一致，原80WAL仍原链；缺字段/原失败照存，未读dump/客户行 |
| 本包lint/后端边界 | 改动CI/报告/TS测试lint exit0；check-django-production-boundary exit0；不覆盖全仓lint失败 |
| 最终差异/文档 | 完整base→最终候选diff --check、暂存范围/JSON/链接及最终代码一致性按末次封存记录；AGENTS无改动 |

真实[GitHub run 38272683213](https://github.com/dengweizhang321-droid/operations-management-system/actions/runs/38272683213)绑定529a：L0完整diff和21切片通过而lint失败；L1只前6项Node，短名身份校验已越过，真实子夹具超10秒期限失败（测试整体38.837秒），后续业务契约未执行。summary拒绝“当前HEAD不干净”，未保存git status具体路径，原因未知；build/experimental-integration均skipped。不能把本机58项当云端通过，也不把新增timeout误当原短名错误仍存在。

首轮本任务封装遗漏TEMP/TMP和APPDATA，另有边界检查文件名写错及四份补丁证据未暂存导致clean-HEAD拒绝；这些是本轮取证封装错误，原日志完整保留。修封装/提交原补丁证据后只复验依赖这些修正的项；没有删首失败、扩大产品预算或改变断言。基线13个旧batch.recovery夹具失败、1个未安全mock全部HTTP的旧watchdog case，以及WP-1/3/5作者首失败按原报告保持，未危险重跑。

原始输出均在[evidence-integration](evidence-integration/local-ci--summary.json)编码封存：base64＋原长度＋SHA，避免换行/尾空格规范化改写日志。原log与ignored隔离输出继续留在本树tmp；WP-5独有原字节zip/日志仍在其原树，不以Git首次规范化SHA冒原SHA。[复审记录](INTEGRATION-REVIEW.md)记录具体审查和未通过边界。

## T1/T2/T3事实与未测收益

f15批准10-11 23:25:28到V2完整交付10-12 19:17:33.160，T1 **19小时52分5.160秒**。原必要验收19小时42分42.973秒、batch completed19小时42分42.976秒维持；completed→V2为562.184秒，不全等于写报告劳动。这是跨夜首次采用事故样本，不是常态基线。

T2分别记录维护门、精确停稳、HTTP和认证业务就绪；连续认证业务总秒数未测。离散失败、401与跨夜采样空档不回填。T3六次unknown补证、失败执行、故障恢复、正常同点隔离Restore及收尾分别保留，通常已包含在T1且可能重叠T2，不能相加。26次准入3544.472秒是实际毛成本，666.826秒Restore是正常新installed资格验证，不是可任意取消的故障。

本轮没有同源码/载荷/门禁/负载的生产配对实验，无已测净省分钟数、P95或SLA。WP4 P1并发、P2自动hook、P3前置资格、P4有条件阶段重排、P5资源打点只作为后续方案；已有PrepareApp/在线准备/同域重叠/ACL复用不重复计新增收益。

## Git交付、治理与保留

已正常推送集成分支，已推代码tip529a与同名origin一致；本报告及证据的最终提交/push由末次FINAL-DELIVERY回读补齐。**main合并/推送未执行**，origin/main仍b3c6018c。既有五分支完整保留，不删已发布历史、不强推、不自动stash/reset/clean、不在主检出切分支或同步。

本轮WP-0G重核37树，320个进程CommandLine不可见，不能声称全OS无引用。[治理明细](GIT-GOVERNANCE.json)逐路径记录HEAD、dirty、origin/main/集成包含、可见引用、任务绑定及保留原因。五任务树及集成树未合main/验证未闭合/证据仍需保留；其余原盘点树有活动、身份或ignored用途/保全未闭合，全部保留，不为数目清理。当前聊天无受管附件，未调用别树原生删除；未来受管树只能应用归档。

主检出六修改文件、未跟踪报告/process-deadline均保留。用户本轮明确答复“由原任务继续处理，主检出保持现状”。正式control0e87、worker717摘要与原盘点相同，e033 driver及Django85cf有限文件绑定重核；主树仍有n8n/计划任务/启动依赖。没有调用旧Status/Panel、删除运行目录/备份/归档或停止任何服务。未测空间释放，实际清理为0。

## 仓库交付与具体生产候选方案

WP-B/WP-0盘点、WP-2规范/历史审计、WP-4时序报告及本轮证据只需仓库交付，修复CI在GitHub一次性runner另验，不要求部署业务服务。package新增验证脚本不改start/dev，但整套CI仍受L3/域覆盖与云端失败阻断。

WP-5服务包装器在实际主检出/宿主生命周期调用中执行，**合并也不会自动把用户保护入口或包装器更新为已采用**。WP-3报告工具可只对冻结原件离线调用；本轮已这样验证，未接生产自动消费者。当前workerReleaseBundledSourcePaths/key paths没有这两个入口，source-snapshot包含不能证明生产会执行，也不因此单独重建Worker/Django。

仅列后续方案，不准备plan、冻结新生产包或执行：

| 候选与影响 | 准备/必要验证 | 数据库/维护/切换/恢复与授权 |
| --- | --- | --- |
| P-CI：本轮固定CI代码＋Windows修正 | 补齐真实隔离L2/L3业务HTTP/PG/完整冷启动适配器与域审查；定位云端子fixture期限/dirty，保原失败；未改预算；重新绑定最终base/head/审查和制品 | 仓库/一次性CI能力，不发生产命令或设置分支保护；修复完成前main阻断。历史lint另列范围，不为本轮全绿修改所有历史证据 |
| P-SERVICE：2f21的服务包装器精确产品字节（本轮实际SHA-256 38b1e5b2de4e20c6a0e75a8a8ab400c738a7fb0bdfae64803cfe14d97d48e97d） | 重核真正调用者/安装位置、主检出原任务保全/正式绑定；使用既有包装器/唯一引擎，不copy替换受保护入口；保持本轮17回归及对应真实隔离生命周期/异常退出/锁/输出资格 | 工具生命周期变化不在v4精确十工具白名单，不能沿用f15策略或Restart采用。默认full保障及精确维护/切换依赖需另审；兼容前向恢复，unknown不重放，数据恢复另批。须批准精确目标/源码/字节/窗口与失败方案 |
| P-REPORT：0ac64cef的既有closeout离线扩展 | 固定源码/CLI/原输入和输出目录；当前21+相邻回归和两批离线适配证据可复用，新增hook则须另审调用者、失败与完成标记；缺历史字段不补造 | 单纯离线新草稿无生命周期/DB动作，保create-only/null验收；若将其接为自动生产消费者，另审安装字节/权限/运行位置/绑定及授权。不能据报告生成重放发布动作或改WAL |
| P-COMPAT：已有永久Status/全维护Stop选路兼容采用（非本轮重新实现） | 从现采用85cf/21c/e033重核完整前驱；原Status安全图与typed维护路由实际隔离；匹配冻结collector/适配器/进程谱系/迁移闭包 | 原源码已存在但未采用；只提出精确兼容候选，不热改当前运行包/只读wrapper。其恢复策略按真实最终差异判断，不借本轮退出码修复或旧批准放行 |

以上尚无精确新生产候选SHA/plan/批准，不能称“可直接上线”。明确本任务未部署、启停、迁移、生产数据写入、启用调度或真实外发。后续要关闭的当前阻断是：必要L3未完成、L0 lint/覆盖缺口、云端L1/summary未通过、既有树清理负例根因未知；超出组合衔接的工程另列，不搭车修所有历史故障。

非敏感共享记忆在最终收尾更新：五项在候选分支已集成，main未合并，本轮没有生产采用。已合并main与已生产采用始终是不同状态；f15历史采用不能延伸授权。
