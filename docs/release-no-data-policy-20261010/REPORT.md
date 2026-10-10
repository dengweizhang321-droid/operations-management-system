# 无数据影响发布策略实施交付

2026-10-10，Asia/Shanghai。开发基线为最新 `origin/main cb007f05152bccaf884e60b8cdeaad0c2077557d`，分支 `codex/release-no-data-policy-20261010`，独立 worktree。用户中途要求暂停，所有现场保留，收到“继续”才恢复。本报告区分源码交付、隔离验证、准备制品与实际生产采用。

**已实现可执行 v3 `not-required`，合格新批次封存时没有 Backup/Restore 操作。分类、数据库决策、封存、自验、标准现场准入和原协调器执行均已接通。没有生产采用；原 AB 的 active 所有权与第19步 unknown 阻止新正式 plan/batch。** 已完成不受其影响的开发、真实全应用隔离候选、独立复审及九文件精确首次采用准备，不依赖第二个合批组。

## 新旧规则及支持范围

| 范围 | 旧规则 | 本次 v3 |
| --- | --- | --- |
| 已证明纯展示 | `reuse` 要26小时点、7天同点演练、持续日备份；缺任一条件回到四DB阶段 | `not-required`，零DB操作、恢复证据为空；不查询上述资格 |
| 普通CSS展示值 | 可能获展示分类，但恢复资格仍绑定上线 | 原选择器/属性/规则结构不变、有限展示值；完整部署输入及副作用复审通过后短流程 |
| 静态文案/已有有限布局类 | 旧TSX骨架规则 | 首版只开放完整静态被动、零参数、无导入/事件/表达式/自定义祖先的客户端组件；复杂页面改字不自动放行 |
| GET查询、筛选事件、权限/生命周期/依赖、PNG/Markdown及未知代码 | 严格或旧展示边界 | 目前没有足够无数据证明，列具体路径/部署证据缺口并保留 full；不能靠目录、GET或 caller boolean 取得资格 |
| 写入逻辑兼容结构 | 完整四阶段 | 首轮未自动化此类风险方案，仍 full；后续按实际写入风险审恢复点/前备份、隔离写验证、旧版兼容，不把“严格测试”本身当四阶段理由 |
| 迁移/批量修正/存储/恢复机制 | 严格保障 | 针对实际风险方案；本轮不扩大复杂类别自动化 |
| 旧已批准批次 | 原引擎及WAL | 不升级协议、不删步骤、不改批准/owner；v1继续原采用版本，v2语义显式兼容 |

三条轴分别记录运行组件、持久数据/部署效果、备份机制。验证强度不是数据库开关；合格候选追加更严格测试也不会因此自动生成DB操作。首版没有承诺全部普通功能都能走短流程。无数据针对本次差异及部署动作，业务自然导入不要求停止，也不默认验收前后全库完全相等。

切换仍为原 `BeginWorkerDrain → StopWorker → apply → StartWorker → EndWorkerDrain`，Django/PostgreSQL保持运行；任何未知后台/备份任务、owner冲突或排空异常正常阻断。后端变更不因数据库策略改变而免除必要服务切换。

## 实现与安全边界

七个改动运行模块为 `release-impact.mjs`、`release-batch.mjs`、`release-batch-admission.mjs`、新 `release-no-data-observation.mjs`、`worker-local-release.mjs`、`worker-local-service.ps1`、`release-lifecycle-step.ps1`；首次采用再包含两个必要C依赖，九文件闭包。详见[设计](DESIGN.md)。

- 完整实际前驱/最终候选库存及全部变化原字节，JSON往返后重新分类；不把 normalized skeleton 摘要替代原字节。
- 前后原 preparation receipt 比较所有非源码输入：运行配置、继承环境、Node/npm工具链、npmrc。现场根据实际采用谱系从固定受保护根回读原收据和sidecar，拒绝 caller 自制来源。
- 精确副作用复审原报告绑定源码、前驱、制品、plan、delta/closure；必须说明文本消费者、布局观察器、写入、启动/构建和操作词汇。报告真实性是可信独立复审与真人批准边界，字符串长度检查不是语义或密码学证明。
- 新批次 `SEALED`；`databaseOperations={required:false,operationIds:[]}`。拒绝插入DB阶段、business、DeployApp、任意命令或多余生命周期参数。缺证明需在执行前重备 full 范围，不能执行中跳过旧步骤或自动换策略。
- 标准 collector、原适配器/transport、系统PS5、Node/TypeScript、Chrome/Playwright按完整字节及精确路径绑定。源、依赖、配置、制品、路径/硬链接/重解析点、ACL、进程、ready、mutex、排空、CAS/fence及动作前复验保留；漂移拒绝，不用TTL接受新字节。
- 固定观察器只读首页和候选真实静态资源，逐字节核实际响应，声明式DOM/样式断言，不接受 caller JS/点击/任意API。API GET被阻断并留证，不以GET断言只读。POST等写尝试失败；WebSocket在页面创建前关闭、不转发握手，真实负例 server upgrade=0。仍不宣称全浏览器通道形式化隔离。
- 最终调用链核查发现原Start可能隐式启动Django、执行迁移/权限复位，并自动启动钉钉接收器。Worker-only适配器现在强制 `BackendStartPolicy=RequireReady`：后端未就绪先拒绝，不启动后端；就绪时仅启动Worker并跳过接收器自动启动，现有接收器保持。普通Start/full维护原行为保留。PS5/PS7实际原函数、顶层分支、原参数传输及失败WAL已验证；[缺口与纠正](ASTRA_BACKEND_START_CORRECTION.md)保留。旧七文件结论和载荷已被替代，不能用于生产。
- 固定unsigned reader鉴权拒绝和精确候选权限回归，原Status/VerifyStartup与两次新鲜自然watchdog观察继续验收；观察原值/失败先保全，unknown不重放。

## 验证、首次失败与未测范围

| 实跑范围 | 结果 |
| --- | --- |
| Astra最终相关六文件套件，含原组合检查 | 137/137，38.491秒串行；`astra-backend-guard-final-serial.log` |
| 主agent独立复验同套件 | 137/137，38.741秒串行；同逻辑用例重复验证，不相加；旧113/134样本保留 |
| 原服务/生命周期兼容回归 | 6/6；原drain另组PS5/PS7 2/2；两native新guard测试已在137内 |
| 原真实runtime packer/源快照漂移/构建闭包定向回归 | 3/3 |
| 实际功能源码权限/请求生命周期回归 | 12/12 |
| 九文件采用源正常npm ci/postinstall、完整Vinext构建、helper证据/完整复制字节验证 | 通过；helper源码未改、原构建及原验证通过，构建警告保留 |
| Django/Worker领域边界扫描 | 650模块，通过 |
| 改动ESLint、diff check | 通过；未运行独立TS typechecker或全仓unit |
| 旧完整rendered-html套件 | 16/20，四失败在实际前驱单独构建的原源/原断言路径重放同样16/20；不冒称全绿或生产故障根因 |

四个既有 rendered-html 失败为销售导入/分析字符串、筛选挂载字符串、商品利润字符串和Codex MCP文档断言。此前七文件准备源及实际前驱的测试/相关应用/文档输入保持原字节，基线复验只重定向原测试源/制品URL和私有Miniflare依赖，不改断言；后续两PS修复也不改变这些输入，未为无关断言扩大改动。原日志及生成器保全，不把16/20写成全绿。

新负例覆盖：伪造 noData/readOnly/effects、迁移/写GET/依赖及启动钩子夹带、完整库存遗漏、变化字节/制品/前驱漂移、非源码配置变化、复审报告缺口、权限未验证、任意命令/参数、探针提前、重新计算批次摘要后的篡改、资源响应漂移/重定向、POST和WebSocket。旧v2套件继续原协议，不把fixture状态当生产事实。

原失败完整保留：Astra Django缺hash负例32/33因更早TypeError拒绝、预期诊断不符，v3新增显式hash诊断后33/33；主agent首个实际CSS选择器不存在、第二个样式被主题覆盖，均真实浏览器失败；未封存源随后改到实际可见账号控件字体14→15并重建。私有修正脚本一次LF/CRLF假设失败、helper输出目录第一次不符合既有隔离要求，也保存了原输出，纠正路径/字节处理后通过，没有修改原门禁。

九文件首次并行组合136/137，既有watcher报inputs changed；未改该断言/实现，原case定向复验及137串行通过，首次失败原文保留。尚未证明根因，不把资源并发推测当事实。新增guard用枚举name/value而非新switch，避免放宽原PS5封闭参数传输；native测试实际验证该选择。

正式生产ACL/角色矩阵、原Windows启停/排空/切换、真实全部组件、自然watchdog、正式typed Worker manifest/guard与恢复验证尚未执行。私有测试适配或完整构建均不能替代它们。

## 真实全应用隔离候选

从实际AB 5157文件 source-snapshot 完整复制，最后仅 `app/shell/top-navigation.css` 的账号控件字号14→15发生变化；事件、请求、后端、权限、存储及启动行为保持原字节。核查了现有文本消费者和ResizeObserver调用链，未用“没有fetch”判定。

使用原 identity collector、同一私有开发配置/环境/工具链分别真实构建前后应用，前源 `92c2656c…`，后源 `71d5964f4ce5cf1e7855f75607fde892291dc8f2232fb71ec3235f0381507793`。完整原应用Worker由私有Miniflare运行，没有生产服务或凭据；真实DOM计算字号15px，19个实际资源响应匹配制品字节。

最终九文件代码绑定的原批次协调器私有封存/完整字节准入/切换/固定浏览器验收/收尾11步闭合，batch `ce45f3fd559955275d4fcc173204b37e8fee13cea099ac811ac5282c4661f160`；36条私有WAL，零Backup/Restore、零恢复资格收集调用。私有生命周期、权限拒绝及watchdog为明确标记的测试适配，未调用固定生产包装；新Start guard另由原PS控制流与native传输验证。该示例证明机制与实际应用CSS路径可以闭合，**不授予在尚未采用新规则的生产上首次免除保障**。例子只在隔离环境，不合入应用、不重放历史四项UI发布。此前91a40252批次和原结果保留，不改旧WAL去换绑。

## 收益口径与独立恢复治理

| 口径 | 已有证据/边界 |
| --- | --- |
| 批准前准备 | 本次开发、构建、字节校验、复审与私有回退准备均前移；原日志分项保留，用户主动暂停时段单列，不捏造独占总工时 |
| 批准到必要验收 | 新生产未批准/执行，未测；私有示例不含正式角色/自然调度/Windows生命周期 |
| 批准到全部交付 | 最终私有协调器72.494秒；此前64.074/69.527秒另样本保留；均非生产SLA |
| 用户总等待净改善 | 没有同条件生产配对样本，未测；不承诺分钟数 |
| 机器工作 | 四DB步骤及其调用数量在私有样本为0；源/制品每边界重新采样。没有独占CPU/IO或生产净改善测量 |
| 日常后台成本 | 未新增或启用调度/演练，新增生产成本为未发生；未来周期演练成本须另测 |
| 真实不可用窗口 | 本任务未采连续正式HTTP可用性；最终私有switchSpan23.237秒不是生产停服，也不冒充其精确不可用时间 |

历史两Backup＋两Restore约50～55分钟只作为毛成本池，不能直接称本次净省。同机准入子耗时包含在所属阶段内，不重复相加；三实际历史样本旧展示0/3不能外推所有未来功能覆盖率。

日常唯一 `e` 仍PAUSED、上海22:30；本次只读，未启用、修改或新建调度。建议另行审批：既定每日备份治理不变；每月一次选定仍保留点完整隔离恢复，加数据库大版本、存储、备份/恢复工具和权限机制重大变化触发。历史单点恢复约11.8～12.5分钟级墙钟，仅作预算参考，不是新计划SLA；不在每次普通发布补整轮，也不要求每天新点都演练以服务v3。三份及保护策略不变；备份健康异常独立报告，未决原操作/owner继续正常阻断。详见[旧复用与独立治理边界](../release-fastpath-evidence/DAILY_BACKUP_ADOPTION.md)。

## 当前状态、采用准备与Git

恢复后上海22:20及交付前22:51只读复验：有效Worker仍 `20261010T014638Z-97833d2f2b7e7bc9` / manifest `f4e537eb…`，Django `237fbe0d…`；完整87条WAL序号、canonical字节、SHA/previous链通过，最后仍第19步 `full-postgresql-deep-comparison unknown`。前后备份、恢复及UI的最新状态已passed，不能沿用旧UI/后备份阻断叙述。原active9f79未改；该有限观察不等于全系统原子健康检查。

首次采用精确准备源/完整制品、剩余阻断及回退见[采用方案](ADOPTION_PLAN.md)。源码/制品冻结九模块闭包，不把main中其他功能顺带采用。旧七文件载荷保留并明确被替代。准备制品已完成，正式Worker plan与engine batch为null/blocked。旧批次由原执行者闭合后，重新核实际前驱，按原准备能力产生精确typed manifest/guard/plan和批次，再对具体生产范围询批；当前不提交无效切换确认。

真实GPT-6 Astra与Antigravity原审查、交叉答复和纠正见[事实核对](AGY_FACT_CHECK.md)、ASTRA_ROUND1/2/3、[第七轮交叉答复](ASTRA_ROUND4.md)、启动纠正及AGY_ROUND2～7。原native调用/拒绝/输入/STREAM/result/call均保全 `E:/codex-artifacts/release-no-data-policy-20261010/`。模型认可不是测试。

Git最终提交、main/分支远端回读、材料SHA和保留状态以本目录 `GIT_DELIVERY.json` 及外部 `DELIVERY.json` 为准。当前受管worktree、九文件源/冻结载荷、旧七文件证据和私有前后包因候选/collector绝对路径引用保留；原主检出、原在用来源和其他工作树不清理。合并推送不等于生产采用。
