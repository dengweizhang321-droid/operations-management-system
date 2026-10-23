# 本组合必要L3检查及剩余实现范围

2026-10-13续做。保留`requiredLevel=3`、18域、L0完整lint、所有覆盖缺口及L2/L3的pending合同。下列检查逐项完成不自动产生正式L3 passed；本表不增加生产授权。

用户已选保留CI候选、先拟精确子集；本表较大设施仅作为后续分阶段清单，不在本轮实施。最新基础设施实测/原失败见[续做报告](CONTINUATION-REPORT.md)，已验证成果范围见[子集方案](SUBSET-DELIVERY-PROPOSAL.md)。

## 分解与复用

| ID | 检查项、原工具与断言 | 本组合对应事实 / 当前状态 |
| --- | --- | --- |
| C1 | base/候选完整Git成员、业务及构建依赖闭包、package生产入口逐字段比较 | 2165个app/backend/lib/worker/components/config/public文件无变化；锁/依赖/生产脚本不变；package仅新增6个verify脚本。`scope-proof.json`。证明影响范围，不能替代18域覆盖 |
| C2 | 一次性Linux runner干净固定HEAD，原`vinext build` | 实际执行；没有生产配置/凭据、生产Start或Wrangler直接发布。原job分别绑定准确源码、锁与产物；后续结果见CONTINUATION-REPORT |
| C3 | 原seal-artifact/verifyArtifact、同run独立下载再逐文件hash | 旧upload默认排除隐藏文件导致完整载荷不符，保原失败；新上传只对`.runtime/wp1-artifact`包含隐藏文件；原treeDigest协议不变，新增文件清单及具体不符诊断。丢失/新增/篡改隐藏成员负例通过 |
| C4 | 原CI离线边界、环境净化、真实失败/timeout/overflow、制品/审查指纹负例 | L0相关切片、L1本机与云端；PS5模块缓存定向隔离；dirty新增文件负例保拒绝。原10s/120s/输出上限不变 |
| C5 | 原PS5/PS7包装器0/9/259/null及直接父退出/后代输出/异常释放 | 原WP-5已验精确产品字节复用；本轮4项选名包括两shell实际退出/锁测试通过。不会从底层后置成功改写旧exit码 |
| C6 | 原deadline真实直接退出/EOF/Direct清理/进程树与并发互斥 | 13/13当前通过；基线树单例1/1当前通过；原失败保留。原树函数/断言没改。新test-only StartupShortcutPath消除无真实profile目录时的加载失败 |
| C7 | 原cold-start-coordination私有OS进程/锁/运行意图、排队超过30秒、超时/维护/stop/fence拒绝 | PS5/PS7两项真实竞争套件通过，合计88.983秒；33秒持锁、各原95/100秒限额与失败断言保持。仅原library-only/私有夹具，不是12组件完整应用冷启动 |
| C8 | 原固定PG镜像实验：独立随机数据库/用户/密码/端口、tmpfs、JSONB/FK/check/事务DDL | 实际调用原integrationProbe，固定Docker官方镜像digest；初次镜像参数空值及制品不符均发生在容器启动前，保原失败；最终原回执确认隔离、SQL及清理，见续做报告 |
| C9 | 原新浏览器context、service worker禁用、页面创建前HTTP/WebSocket全阻断，消费绑定CSS | 与C8同一原实验入口；只验证制品/CSS和浏览器隔离，不含真实Django业务路由、角色和整应用交互 |
| C10 | 原WP-3离线证据CLI/接口、原字节/检查/前驱/历史新鲜度、create-only/null验收 | 收尾实现本轮未改；复用已绑定原字节的21+6+3与两批离线结果，不无理由重做前五项；旧失败/unknown保持 |
| C11 | 来源/输出/清理、原失败与现在结果同存、最终文档/JSON/链接及差异 | 候选与原始日志均封存；不复制生产dump/密钥/客户行，不清运行目录/主检出；main仍受正式门槛阻断 |

C2/C3/C8/C9的实测只能按对应源码SHA及单项结果引用。没有通过的probe、清理或来源绑定不能写已完成。L3入口设计为实验pending，仍不能由合成SQL/静态CSS或上述私有生命周期接缝生成全域L3合格回执。

## 准确缺项与最小实现边界

以下不是“本轮业务代码缺陷”，而是WP-1新设施尚未交付/验收的覆盖和适配器。新增6个package脚本触发其保守全域L3要求；缺口在固定WP-1交付就存在。本轮不把无变化源证据当减免。

1. **L0/L1资源准入覆盖**：18域的具体已审条目与13个L0/11个L1空域在`coverage-attribution.json`。先挑已有安全测试作人工源码/运行导入/配置/夹具审查，补精确摘要；不自动续签、不新增“每域一个永真断言”。需要Python/DB/HTTP的现有测试不能塞入纯离线Node kind，需相应隔离执行器及失败传播。此项可优先单独补审，不能因此宣称全业务L3完成。
2. **真实PG业务HTTP适配器**：现`tools/ci/integration.mjs`只有两个合成schema，未加载Django models/迁移/角色或业务URL。最小新增为一套统一fixture launcher/cleanup与manifest，不再建第二发布引擎；复用原PG角色/恢复工具、域test settings和test client，提供一个业务断言适配器清单。至少包括实际业务结果、坏scope/角色拒绝、错source/owner、截断、超期/取消，以及写域原幂等/并发/审计契约；不能拿同一个合成SQL给16个业务域贴标签。
3. **完整隔离应用冷启动适配器**：现cold-start-coordination只证明真实互斥/意图控制，未启动完整12组件/23reader-writer。最小新增一个只接受显式私有root/随机独立PG及服务端口/合成凭据的兼容准备夹具；复用现有生命周期、进程receipt、authority/ACL、全部readiness、原恢复/退出检查。生产固定端口、运行入口、密钥、R2、n8n、浏览器profile不可回退；外部渠道/自动化须明确阻断。现在的正式引擎有固定路径/端口/Startup绑定，不能在CI内直接Start或复制生产配置来完成此项。
4. **完整应用角色浏览器适配器**：原探针只setContent并加入一份CSS。最小新增消费已封存真实制品的隔离HTTP路由/身份种子、四角色及至少允许/拒绝scope、关键业务结果/取消、全部所需资源实际消费；页面创建前阻断外发与WebSocket；明确哪些角色/页面未覆盖。静态200、401或CSS加载不等同角色业务验收。

最小设施文件边界可限定为：新增`tools/ci/application-fixture.mjs`（创建/身份确认/就绪/清理同一manifest）、`tools/ci/business-adapters.json`（域→已有runner/测试标签/许可资源）、`tests/ci/application-fixture.test.mjs`（错误DB/端口/root/进程/清理负例）；扩展现有`integration.mjs`消费这些适配器，逐域审查必要测试，保持现有`verify.mjs`失败和pending传播。manifest必须绑定source/artifact/lock及PG镜像或binary、私有data/root、精确进程receipt、端口、合成角色、结果/清理证据，绝不记录密码。生产入口、业务实现、备份operator和调度不属此设施改动范围；若固定引擎在独立镜像仍不能复用，应先形成具体兼容接口差异再审，不临时复制生产状态或放宽authority。

域归属具体为access_control、ai_assistant、bi、business_analysis、customer_service、erp_reference、finance、inventory、market、netshop、pandas_runner、products、sales、system_backups、system_datasets、workflow，另有platform与ci。既有可复用runner包括netshop-foundation/crossdomain/comparison/finance、product-overview、BI test settings及integration-migration-role/protected-restore；它们各有独立范围/历史generation，不能整批机械运行或把旧138代际当当前140的完整验收。当前没有统一“全部18域＋完整应用冷启动”已验入口。

以上适配器不是本轮几行组合衔接：涉及业务断言所有权、真实角色/迁移、端口及主机隔离、失败清理和构建/验收回执协议，需要分阶段工程及复审。当前授权内先完成C1–C11可用部分；不擅自扩大为所有域重构/历史故障修复。

## 不降低门槛的替代交付

后续建设按下表分阶段申请工程范围；本轮只保留清单，不实施。阶段完成只取得对应能力，不能提前声明全域L3。历史lint专项可以独立推进，但默认L0仍要完整lint无错误及域覆盖满足才能通过。

| 阶段 | 精确范围与依赖 | 交付/验收边界 |
| --- | --- | --- |
| P1 资源准入 | 现tiers/audit和安全切片；逐项审查现有测试的导入、配置、进程/网络/文件资源；补13个L0/11个L1空域；不机械绑定所有历史测试 | 每条绑定原代码摘要及真实runner；失败/过期拒绝、不得自动续签。需PG/HTTP的条目留至P2，不伪装离线 |
| P2 统一业务fixture | application-fixture.mjs、business-adapters.json、对应负例及原integration入口；依赖已有PG角色/恢复工具和域settings | 随机私有root/PG/端口、精确进程和制品/锁/source绑定、外发阻断、身份和清理失败传播；先验fixture本身，再分域真实models/角色/URL及幂等/审计/权限负例 |
| P3 完整应用冷启动 | 在P2基础上核12组件/23启用reader-writer原安装与启动合同；固定端口/绑定差异先列兼容接口，复用唯一引擎 | 全部组件真实ready、maintenance/drain/owner/fence/退出/清理负例；禁止生产root/配置回退。现协调suite通过不充当此验收 |
| P4 完整角色浏览器 | 消费P2/P3真实制品和隔离HTTP/身份种子；四角色及必要业务/取消/scope | 页面创建前阻断外发/WS，逐角色允许/拒绝和结果比对；静态CSS/200/401不替代业务断言 |
| P5 全组合门禁 | 前四阶段、对应Windows证明与历史lint专项完成后，重新固定最新完整候选 | 新HEAD独立构建、完整制品复验、真实域覆盖及清理；保持pending/失败传播，全部必要项齐备再审正式CI采用 |
| H 历史lint专项 | 仅原十文件的规则/脚本合法性独立审查；原逐条清单固定在完整候选lint-attribution.json | 保原失败样本/字节可追溯，必要修复另交付；不ignore docs、关闭规则或允许baseline errors求绿 |

- **完整集成候选继续保留**：交付现成工具修正、原失败、隔离实测及上列明确缺项；不合main、不把L2/L3 pending改passed、不启生产。
- **分阶段工程交付**：先补资源审查和统一fixture启动/清理，再分域真实PG/HTTP与完整冷启动/角色浏览器验收；每阶段只标其已验范围，全部必需项完成后才考虑当前完整组合main合并。
- **范围拆分的独立交付**：可以单独保全/送审已验证的报告、文档或工具修复，不随它们启用默认CI/认领全域L3；如要另作main合并范围，须先明确精确子集及该子集完整验证/依赖，不能将拆分当绕开同一改动的高层门禁。本任务不自行批准任何例外。

lint的63错误/112警告是现有十份历史证据脚本的逐项相同基线问题；不关闭完整lint就仍阻断当前默认L0。最小另行处理范围是该十文件的规则/脚本合法性独立审查及必要修复，不能删除原失败样本、忽略docs或允许baseline errors求绿。是否把这项和上述较大基础设施扩入任务，需要用户选择工程范围，而非批准豁免门禁。
