# 已验证子集：具体送审范围与复核结果

2026-10-13。按用户选择2，完整CI候选和全部原失败保留；当前仅准备独立子集送审，**未合main、未生产采用**。没有生产候选、维护、启停、迁移、业务数据写入、调度启用或真实外发。主检出六处修改和未跟踪内容保持原状，由原任务继续处理。

独立分支`codex/release-validated-subset-20261013`从最新origin/main `5368e5014a418234bb2e8e436ce9e62012531c14`创建。完整CI固定在`dc94e6492ce34457529581239f2b682bb6d36264`；它仍包含原五包、所有后续修正和原失败。子集没有合入完整CI分支历史，只取精确文件字节，不把候选工作流/默认门禁/分支保护一并启用。后续合并需要对这个具体范围另作复核决定；本报告不批准main合并。

## 精确文件、提交与来源

| 子集 | 当前候选提交 | 文件与原产品/交付来源 |
| --- | --- | --- |
| S0 资料 | `279870fc09772aee7d3c7156fe2e164d30abef92` | 43份原规范/审计/证据闭包＋6份范围/依赖/续做资料，逐项见[原资料清单](SUBSET-DELIVERY-PROPOSAL.md#s0完整逐文件附表)与[逐文件摘要](SUBSET-ACTUAL-FILES.json)。来源74c5/39feb/f03/4968/2538/7ccb等完整SHA均保留。唯一规范派生修正：CI命令明确待采用，未交付package入口不能写当前可运行能力 |
| S1 退出码 | `97282a6bced9752f32deb35ba346475e3a32a11c` | tools/operations-system-service.ps1、tests/operations-system-service.test.ts、tests/operations-system-service-exit.test.ps1；原产品2f21c238d2a4766caad547d08be63acab769ab08，固定交付4968baedd7ac3fa0948258cdc854fd25045fe8cd；三文件精确字节相同 |
| S2 离线报告 | `da7f110f54fb67e069e767c1f91cf1584cd82847` | tools/release-closeout-report.mjs、tests/release-closeout-independent.test.mjs；原产品0ac64cefaa6e4398a24e578a33f25414e768d8bd，固定交付2538b8d5b51824a23bfc58f511d120c9c7cb8d2d；两文件精确字节相同 |

本报告、实际文件manifest及evidence-subset是附加资料，纳入最终审查提交；manifest逐项列其摘要/来源范围。原SUBSET-FILES和私有拟树是历史方案，不能冒充最终分支。43份原材料中的旧“本轮/目前/未合main”和失败是各自原截点；除了规范纠正，不改写这些历史正文。CONTINUATION和方案仅加当前报告导航，保旧测量/决定。原43文件中42份仍为原来源逐字节相同。

## 完整依赖与为何这个拆分不减免同一改动

S0只依赖固定来源、main已有规范/历史资料及被链接的30份证据；没有运行依赖。CI资料另以[完整候选固定材料](https://github.com/dengweizhang321-droid/operations-management-system/tree/dc94e6492ce34457529581239f2b682bb6d36264/docs/release-pipeline-optimization-20261012)为准，包含全量evidence-continuation及清单；本子集没有复制CI实现。

S1依赖Windows PS5/pwsh、.NET Process/Mutex、既有bat/npm入口、唯一operations-system-control/worker-local-service引擎及安装的Django/PG控制器、deadline/release/rotation/guard、manifest/authority/ACL/desired/维护/排空/lease与正式绑定。[SERVICE-DEPENDENCIES](SERVICE-DEPENDENCIES.json)逐文件列Git字节/调用边和现场输入；[此次核验](evidence-subset/scope-and-provenance.json)证明仓库依赖与5368及原WP5交付一致。现有依赖不表示本路径执行其全部行为，Git相同也不表示实际安装就绪。

S2依赖Node≥22.13（实测24.18.0）、锁定TypeScript、release-impact/release-readonly-retry/worker-local-release四模块闭包与builtin；[REPORT-DEPENDENCIES](REPORT-DEPENDENCIES.json)列全部literal导入，今回核验闭包与原交付一致。仅调用safeRead/hash/canonical、安全错误/进程投影及journal/report文件逻辑；node:sqlite被导入而不实例化，其他网络/构建/生命周期导出保持不调用。输入要求原spec/批准摘要/WAL/回执/sidecar/计划/版本/运行观察/交付原字节；缺项和冲突不补造。

S1/S2产品在WP5/WP3已独立存在，没有tools/ci依赖；package/lock、工作流、tools/ci、tests/ci及业务/前端/构建配置相对5368没有变化。因此不把WP1的requiredLevel=3从“失败”改成“通过”，完整CI门槛仍阻断完整候选。这个子集仍接受真实影响所需门禁：S1实测真实进程与锁的失败边界，S2实测绑定/漂移/历史未知和离线投影；若复审发现同一产品尚需更强验证，则保留该项，不以拆分免验。当前并不交付全系统生命周期可靠性、完整业务验收或冷启动能力。

## 当前树的最小充分检查

私有临时root/profile、显式PSModuleAnalysisCachePath和只读系统目录白名单；不继承生产连接/配置/凭据，不运行默认npm test或未审全部HTTP测试。实际命令和stdout/stderr原字节、摘要在[evidence-subset/results](evidence-subset/results.json)及其五份记录；验证临时驱动未加入项目运行入口。

| 检查 | 新子集实际结果 | 证据与边界 |
| --- | --- | --- |
| S1 service/lifecycle/startup-preparation受影响切片 | 17/17，无skip，40.173秒 | [原输出](evidence-subset/s1-lifecycle.json)；PS5/PS7真实0/9/259/null、直接父退出与后代输出、异常后独立进程获得锁、原维护/竞争/准备接缝；所有副作用使用私有root/库模式或明确stub；不是12组件启动 |
| S2原独立报告 | 21/21，无skip | [原输出](evidence-subset/s2-independent.json)；缺检查、重算摘要后漂移、source/artifact/predecessor/validator/计划/版本、runtime expired/future/unknown、原失败和未执行/协调分列、V2端点、敏感字段拒绝，acceptancePassed仍null |
| 同批内容指纹 | 6/6 | [原输出](evidence-subset/s2-fingerprints.json)；未变mtime仍拒绝内容变化及跨批/并发/失效 |
| 计时/离线WAL | 3/3 | [原输出](evidence-subset/s2-timing.json)；并集/父子区间、未完成不造终点、缺步拒绝 |
| 本次JS/TS改动lint | exit0，无输出 | [原输出](evidence-subset/changed-lint.json)；不关闭规则。PS实际两shell解析/执行。未运行无关全仓lint修复 |
| 精确字节、依赖、历史材料、scope/links/diff | 全部适用项核验 | [范围核验](evidence-subset/scope-and-provenance.json)与[资料核验](evidence-subset/document-validation.json)；仅五源码/测试与文档，未调用生产接口 |

原两批真实历史文件离线报告和create-only CLI结果复用[原WP3核验](evidence-wp3/offline-verification.json)、[create-only](evidence-wp3/cli-create-only.json)，并明确是原2538截点；产品和完整导入依赖摘要相同，故不重跑这些原批次，不把它们称新HEAD全部验证。新21项保null/未知及敏感类型拒绝再次实测。没有生产构建或应用HTTP/PG写域改动；Vinext应用图及其输入在5368上没有本子集delta，故仅验证改变的工具图，不以215b的整CI构建冒充此次构建；将来生产采用仍须精确候选自己的构建/准备和全部要求。

## 原失败、剩余风险与生产边界

完整CI原63项lint错误/112警告、13个L0/11个L1空域、真实PG/业务HTTP/四角色浏览器/完整冷启动适配器缺项继续保留；最终L3 pending与workflow failure不改。原Windows超时、ModuleAnalysisCache dirty（1263900字节）、隐藏制品运输、Docker两流ID、PG临时Unix server、Linux大小写probe失败在[续做报告](CONTINUATION-REPORT.md)及完整固定证据中保全；新成功不覆盖它们。原基线进程树失败同时见于base，其函数/断言未改；当前通过不证明历史根因。WP5原13个recovery夹具及未安全stub的watchdog失败，不宣称全系统通过。

S1仅保退出证据：旧500ms轮询无新总期限，输出增长/尾JSON旧风险未重写；失败不能证明后台零效果，不能自动重放。它不是v3被动展示或v4原十工具白名单，永久Status/全维护Stop安全采用不随它完成。S2仍为historical-observation-only，原validator/前驱/delivery digest等缺口保留，无自动hook、独立验收或现就绪授予；新增字段消费者须另审。

| 子集 | 是否需生产采用 | 如以后采用，另行方案/授权要求 |
| --- | --- | --- |
| S0资料 | 否 | 仓库资料送审；不能因文档入库启用CI/调度或变更实际发布策略 |
| S1包装器 | 仓库交付不需要；实际宿主使用新包装器需要 | 固定真实入口/调用者/PS工具链及前驱运行清单，仅包含兼容必要字节的候选；按实际strict影响列验证、默认full数据库保障、维护/切换/恢复边界并独立批准。不能直接部署5368或沿用f15批准；本轮未生成或执行计划 |
| S2离线CLI | 隔离离线使用不需Worker/Django发布 | 只读原证据、create-only新输出；若安装到生产消费者/自动hook，另固定调用者/位置/权限/绑定/失败方案与消费者验收，需对应授权，不自动更新冻结运行包 |

T1已有f15完整交付19h52m5.160及必要验收边界原事实，T2认证连续中断未测，T3不能把重叠区间相加；本子集不承诺净省分钟数。全域CI、完整应用冷启动和历史lint仅整理[P1–P5/H分阶段建设](L3-MINIMUM-CHECKLIST.md)，本轮不扩建。

当前三个聚焦提交及最终复核资料作为独立送审候选保留。main/主检出同步/生产是不同状态；本轮三者都未执行。所有未合入开发分支和worktree仍保留，清理没有执行；不为数量目标删除材料或运行目录。
