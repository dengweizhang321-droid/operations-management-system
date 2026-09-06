# 吉客云 n8n 五表先导出后导入

工作流：`automation/n8n/jackyun-five-dataset-daily.workflow.json`，名称“吉客云导入系统”，沿用 ID `J8kY2mQ5vR7sT4pN`。默认手动运行、未激活，不含定时器。配套策略为 `config/jackyun-export-first-policy.json`，协议版本 `2026-09-06.export-first.1`。

## 节点与业务口径

| 阶段 | 操作 | 完成条件 |
| --- | --- | --- |
| 协调 | 领取共享 helper | 与京东、天猫等流程串行；最多等待 6 小时 |
| A | 固定本轮上海日期 | 库存采集日为今天；销售截止为昨天 |
| 1 | 分仓库存查询 → 筛选 → 右键 → 导出所有页 | 全仓范围、成功查询响应、精确行数、当轮下载 |
| 2 | 组合装查询 → 筛选 → 右键 → 导出组合装及子件 → 导出所有页 | 母件与子件双表，母件总数和关系覆盖完整 |
| 3 | 销售单明细账 → 发货时间 → 本月 1 日至昨天 → 筛选 → 右键 → 导出所有页 | 时间类型和起止时间逐项读回 |
| 4 | 库龄分析 → 筛选 → 右键 → 导出所有页 | 成功查询响应、真实数据行、当轮下载 |
| 5 | 货品查询 → 规格模式（SKU）→ 筛选 → 右键 → 导出所有页 | SKU 模式读回、货品表头和总数完整 |
| 6 | 全部文件校验及导入演练 | 五表齐全；无业务写入地完成全部正式解析、过滤、成本匹配和组合装基线校验 |
| 7 | 统一导入运营管理系统 | 按货品 → 库存 → 库龄 → 销售 → 组合装执行，使用当前 Django 公开接口 |
| 8 | 独立回查 | 五个精确批次完成，事实归属、日期、行数、原文件与业务内容摘要一致 |

销售采用用户第 3 张截图的普通“导出”菜单；“导出组合装及子件”用于组合装模块。每月 1 日沿用既有销售导入口径处理上月整月，避免形成逆序日期范围。

分仓库存继续使用完整公司仓库范围；导入副本沿用正式过滤规则，保留原始文件。库存及库龄是实际采集日的当前查询结果，不能标成昨天的历史余额。旧 `jackyun:daily` 历史快照协议继续要求真实历史日期控件，不能通过新模式降级旧证明。

## 使用与发布

1. 在隔离 worktree 完成相关测试、helper 构建和审查。
2. 将 JSON 导入现有同 ID 工作流并保存草稿；不要创建另一个同名的自动调度副本。
3. 配套 helper 必须经过项目受控发布，支持 `/jackyun/export-first/` 的 plan、五个 export、validate、import、verify 路由。仅导入 JSON 不会升级运行中的 helper；旧 helper 会返回 404，不能据此开始业务导出。
4. 正式服务发布、停止或重启仍遵循 `AGENTS.md` 和现有 Worker successor 流程，不能直接替换运行目录或绕过 immutable release。
5. 专用 Chrome 登录使用 Windows DPAPI：先运行 `npm run jackyun:credential:setup` 在本机录入，再用 `npm run jackyun:credential:status` 检查保存结果。纯登录验证使用 `npm run jackyun:authenticate`；遇到验证码或安全验证时停止，由操作者使用 `npm run jackyun:login` 处理。账号、密码、Cookie 和会话不进入 n8n。详见 `docs/吉客云DPAPI登录配置.md`。
6. 发布后从“手动运行”启动完整工作流，最后节点完成才算成功。保存工作流、文件下载完成或导入响应成功都不能代替最后核验。

重新生成模板：`node tools/generate-jackyun-export-first-workflow.mjs`。

## 证据与失败处理

- 原文件：`D:\谷歌浏览器\jackyun\<RUN_ID>\<module>\`；事件：`outputs/jackyun-browser-events/<RUN_ID>/`。
- 运行计划：`outputs/jackyun-export-first/<RUN_ID>.json`；当轮 ID 由真实 n8n execution ID 派生。
- 无业务写入的预检结果：`outputs/jackyun-export-first-validation/<RUN_ID>/`；正式导入及归档：`outputs/jackyun-import-runs/<RUN_ID>/`。两者分离，不能把 `prepared` 改成 `completed`。
- 导出步骤乱序、文件或交接 SHA 变化、缺表、跨日、其他 execution 接管、未完成运行重复创建均停止。仅协调领取自动重试；业务节点不进行盲目自动重放。
- 同一 execution 对已签收导出节点的重试只重验文件，不重复点击导出，也不会把导入阶段倒退。已记录导出 intent、尚无下载的节点只能恢复原任务的下载证据；不能重新创建导出任务。
- 中断后保留原运行。不能直接删除 active 清单或改 execution ID；先核查原阶段、原文件、导入尝试及精确批次。已生成库存任务但尚未下载时，仅下述独立 operator 核验并发布的续跑许可允许一个新完整执行接回原批次。
- 对首个库存节点的精确 `inventory 导出未完成：login_unknown`，支持下述无业务效果闭合 operator。它保留原计划与 active，只发布失败闭合回执；原运行不视为成功，也不转移其文件给新执行。
- 导入接口使用规范化业务内容幂等。新协议使用服务端返回的精确批次及业务摘要，允许内容相同但 XLSX 字节不同的 `duplicate`；不得再把当前批次号假设成原文件 SHA。
- 五表导入不构成跨领域的单一事务。后续模块失败时保留前面已完成批次并停止，禁止为“回滚工作流”删除已发布业务事实。

## 验证边界

### 首次登录检查失败后的受控恢复

前提是当前 helper 已受控采用恢复实现。运行以下命令生成脱敏计划，再使用输出的 `approvedSha256` 精确执行 apply：

```powershell
node --import tsx tools/jackyun-preflight-recovery.ts plan 841 > outputs/validation/preflight-recovery-plan.json
node --import tsx tools/jackyun-preflight-recovery.ts apply 841 outputs/validation/preflight-recovery-plan.json <approvedSha256>
```

operator 只读当前 Windows 用户的本机 n8n SQLite，限定工作流 `J8kY2mQ5vR7sT4pN` 和指定 execution；核验失败状态、原错误、仅经过首次库存节点及之前节点、无活跃执行，并再次核验原计划、active、策略和四类当轮路径。数据库中的凭据、恢复令牌和原始输出不会复制到计划。全部检查在相同的吉客云全局运行锁内进行，且要求 helper 空闲。任何变化、业务记录、路径重解析或摘要不匹配均停止。

apply 不改写原计划，也不删除 active；仅以 create-only 方式发布 `outputs/jackyun-export-first/preflight-closures/<RUN_ID>.json`。此后从 n8n 的“手动运行”开始新的完整 execution。A 节点重验闭合证据并按新执行的实际上海日期建立计划，原 execution 拒绝再执行。不能用此入口处理文件不完整、已点击导出或已开始导入的运行。

查询失败的唯一例外是 842 遇到的精确首次库存 `TABLE_TIMEOUT [query_refresh]`，旧诊断包含“包含目标日期 缺失”。此时 operator 还要求导入运行目录中只有 `browser-controller-state.json`：仅 inventory/queried、仓库读回、查询意图与 table_timeout，所有时间均属于原 execution，任何稳定表格、导出意图、额外字段、其他模块或额外文件均拒绝。其他三类路径仍必须不存在。回执状态为 `closed_before_export`，绑定 controller 原文件 SHA，发布时和新计划建立时均重新读取；原 controller、plan、active 均保留。这不是通用超时重试，也不会接管旧导出任务。命令格式相同，仅将 execution ID 换为 `842`。

### 测试与实际验收

仓库测试使用临时目录和合成工作簿验证顺序、跨日、缺文件、证据变化、并发、重复和批次回执。真实吉客云菜单、登录状态及正式五表导入仍须在配套 helper 发布后进行验收，不能把夹具通过表述为生产跑通。

2026-09-06 已将 15 节点新版保存至本机上述工作流草稿，刷新后下载回读的业务节点、参数及连线与模板一致；等待节点的 n8n 默认值已从页面读回为 5 分钟，工作流保持未激活。旧画布已在隔离工作树的 `outputs/n8n-before-change/jackyun-original.json` 保留副本。

首次草稿的隔离验证结果：全量单元测试 1,854 项通过、23 项跳过、0 失败；lint 为 0 错误、9 项原有警告；配套不可变 helper 构建及 42 项发布测试通过；Django 生产边界检查通过。额外 TypeScript 全库检查仍有 141 项既有诊断，与当时基线按文件、错误码和消息逐项对比没有增加或减少，不能宣称全库类型检查通过。该次草稿阶段没有发布服务或执行真实导入；后续实际采用记录如下。

## 2026-09-06 受控发布及一次试跑

用户明确确认发布并试跑一次后，已合入最新 main 的天猫改动，再将本功能以 `c0e7f9ca11d190f5d0716c2905f8803bace17e8d` 合入 main。执行器根目录改为由既有 helper 显式传入，保持受保护 builder 和 release verifier 不变，未更改 Django 数据库结构或写入 authority。

- 集成验证：1,882 项单元测试中 1,859 项通过、23 项跳过、0 失败；lint 为 0 错误、9 项既有警告；Django 生产边界、生产构建和 20 项渲染检查通过。此处不把历史 TypeScript 差异检查表述为当前全库类型检查通过。
- 发布前备份：`daily-20260906T084255Z-cb9e25ccc4b2`，manifest SHA `246a61ba3c1f195ecbcdf6269a07801e2b09289bcffc1dd88ccfda761f383f5c`；备份复验和恢复演练 `06bb2570b113` 均完成，原始/恢复内容 SHA 一致。演练使用独立端口 `55641`，未写入生产数据库、未改变数据库服务状态。
- Worker/helper 已通过停止旧服务、精确 plan SHA 授权 apply 和受控启动采用 release `20260906T085035Z-568a59bc151c39d7`；manifest SHA 为 `bff4704bd7a1d83f6201f6ba5cd101b93f7a662c171939563685041a0db42a20`，plan SHA 为 `baa01dc4982b34cc296d76c8af2374553c98afca7ed4e3e040d31669a951274b`，successor SHA 为 `061236c4991cc9dd27fbe4275511fffe888bb31f3d111b017874ef21c7858e99`。启动绑定、精确 release、首页和后端 readiness 已回读通过。
- 启动 CLI 出现服务已就绪但等待进程未返回的异常。核验该启动器的 PID、创建时间、精确命令、零直接子进程及服务健康后，只结束该孤立等待进程；随后官方 Status 为 `Running / Ready / exact_release`。不能把该 CLI 的退出结果记成正常成功，也不能据此再次重启已经健康的服务。原始回读和处理证据保存在隔离工作树 `outputs/validation/launcher-return-recovery.json` 与 `post-release-system-status.json`。

仅从 n8n 画布点击了一次完整执行，真实 execution 为 **841**，运行 ID 为 `n8n-export-first-841`，采集日为 `2026-09-06`，销售截止为 `2026-09-05`。领取 helper、条件判断和日期计划成功；第一个分仓库存节点返回 HTTP 500 / `PIPELINE_FAILED`，具体错误为 `inventory 导出未完成：login_unknown`。后续四次导出、全部文件校验、导入和独立回查均未执行，不能宣称五表链路已跑通。

失败发生在专用浏览器登录状态判断处，早于模块导航、筛选、导出及 controller 状态写入。四类当轮目录（浏览器事件、下载、验证、正式导入）均不存在，计划 `exports` 为空。保留了原始计划和 `active.json`，未删除清单、改写 execution ID 或再次触发整轮任务。后续新的 execution 会因原运行未闭合而停止，恢复前必须先处理原运行证据，不能直接点击重新运行。

试跑后辅助服务为 `ready`、`busy=false`、无活动 owner；后端为 `django-postgresql / ready`。销售只读健康检查仍为 revision `14:10`、覆盖截至 `2026-09-03`，与试跑前一致。日常 Chrome 的已登录页面不代表自动化独立 profile 已认证；现有错误无法区分专用登录失效与页面尚未加载完。代码在调试端口就绪后立即探测一次登录，是需要继续验证的时序风险，尚未确认它就是本次根因。

后续验收需先检查专用 profile 的页面加载与登录识别，必要时通过既有专用登录入口完成人工验证，再按原运行证据设计受控恢复。不得绕过 n8n 改为直接生产导入，不得把登录检测失败误报成导出成功或数据已同步。工作流继续为手动入口，未启用日调度。

## 2026-09-06 DPAPI 后续试跑及查询识别修复

DPAPI 登录与无业务效果恢复受控采用 release `20260906T110340Z-73a29ca80836ac11`（manifest SHA `764e7aba90fe46f703b7a07b5c9586e18a3633cda9dd46fa4a784739a9583eec`）。841 经只读 n8n 和文件证据核验后闭合；原计划字节未改写。随后从 n8n 全局手动入口启动一次 execution **842**，本轮通过登录、进入分仓库存并选中 244 个仓库，在查询刷新验证处停止，尚未点击导出，没有文件下载或业务导入。

通过已登录页面的底部“筛选”按钮进行一次只读查询，观察到 `/jkyun/erp-stock/warehouseStock/stockSkuList` 的 XHR、HTTP 200 及同请求 loadingFinished，页面显示查询耗时与分页结果。旧模块匹配只接受 branch_stock 或 stock…query，漏掉该实际主表接口。修复只增加精确路由识别，其他模块、相邻总数/导出接口不能替代；历史日期门槛保持不变。当前采集的错误文字也改为“当前采集的模块网络请求”。后续生产验收须以实际新 execution 的五表校验、导入及独立回查结果为准。

### 查询修复发布及 843 的实际结果

查询识别修复提交为 `4b16acfd`。相关测试 39 项通过；全量单元测试 1,903 项中 1,883 通过、20 跳过、无失败或取消；lint 最终 0 错误、9 项既有警告；生产构建、20 项渲染检查及 Django 生产边界检查通过。TypeScript 全库仍有 142 项既有诊断，按文件/错误码/消息与原基线比较无新增；不称为全库类型检查通过。

沿用本次任务已复验并独立恢复的备份 `daily-20260906T101758Z-a1cc5328435f`（manifest SHA `5434b7ba95ea2d3bf96fb8d7cf4c2c10dd1ba719e655550b1e82498e6a3d6c9b`，恢复演练 `fbdfc0c67106`、独立端口 55642、内容 SHA 一致）。本次没有数据库结构变更、数据库服务重启或业务写入。

- 当前 Worker/helper：`20260906T113045Z-e1a943dd272d5547`；manifest SHA `2038f6d362518831918703dcf9836a44cfffa7ff81d9f274c94205c68bc3ef79`。
- 精确 plan SHA：`0a01a68b9f1ab31161cecf7bbe5049e68be02465e4f6a592f439e5c7c28ff3c1`；successor SHA：`321e7283eef40cd69c3dc32753948cdcab4bbb62ec48bc71f0c57aeecf357aca`。已按受控 Stop/plan/apply/Start 执行，Status 为 exact_release，启动绑定及 readiness 回读通过。隐藏、重定向输出的官方 Start 子进程正常返回 started，没有再处理孤立等待进程。
- 842 闭合回执 SHA：`7b17204e0731bac1f771fc347e99deed5e6166033290fd618ce54168b00f65b1`，状态 closed_before_export，原 plan/controller 保留。

随后从 n8n 全局手动入口仅启动一次新 execution **843**，于 `2026-09-06T11:37:04.545Z` 开始、`11:37:26.934Z` 停止。专用 DPAPI 登录成功，库存选择 **244** 个仓库；本轮主表 HTTP 成功刷新完成于 `11:37:10.567Z`，精确行数 **25,595**。此后错误为 **“未找到当前模块唯一的导出所有页菜单。”**，n8n 运行数据 SHA 为 `c72519e3ce9fca4069e28c3c309531744ffd3c1629727ff8ef87327802badb54`。

843 的原计划保留 phase=exporting、exports={}、exportIntent=inventory；controller 为 export_armed，已有 exportIntentAt。浏览器事件、下载和验证三个当轮目录不存在；正式导入目录只有 browser-controller-state.json，没有导入清单或批次。本机只读 `/api/sales/data-health` 于 `11:45:17.991Z` 仍为 revision `14:10`、销售覆盖截至 `2026-09-03`，与运行前一致；helper 空闲，所有 backend readiness 正常。原始脱敏证据在隔离工作树 `outputs/validation/n8n-execution-843-final-status.json`。

诊断只在日常浏览器查询并打开右键父菜单：同模块 `branch_stock_main_v4.html` 中，“导出”及“导出所有页（限500000行）”均为可见 `.mini-menuitem-text`。没有手动点击“导出所有页”，未直接创建导出或执行生产导入。该观察仅证明日常浏览器的菜单存在，尚未证实专用 headless 执行时的定位失败原因；不能把它表述为菜单修复通过。

当时登录/查询失败闭合 operator 不适用已有 exportIntent 的 843，继续拒绝；后续采用下述独立审计例外。原始运行一直保留，没有删除 active、套用 842 的闭合证明或绕过 n8n 导入。

## 专用浏览器菜单修复与 843 审计例外

专用 headless 浏览器的只读菜单诊断已逐项验证五个模块：分仓库存、组合装、销售、库龄、SKU 货品。诊断使用独立 `outputs/jackyun-menu-inspection/` 目录和 `inspect-menu-*` ID，持有正式浏览器全局锁，完成登录、字段读回、筛选和菜单展开后即返回，不写导出意图，不点击最终导出，也不生成下载/导入事件。

实际问题及修复：

- MiniUI 会在右键菜单出现后重绘父菜单；鼠标必须移出再移回“导出”，才能稳定触发子菜单悬停。仅扩大 viewport 或点击父菜单不能解决。准备阶段允许有界重试，但不发送鼠标按键。
- 组合装和货品的首选 grid 选择器此前也匹配表头 `tr`，实际打开的是“锁定此列/配置列”菜单。新协议只在真实数据行上右键一次。
- 销售时间类型是 `#selectTimeStr` 自定义 buttonedit；仅遍历 `.mini-combobox` 会漏掉。等待日期控件就绪后，按实际选项的 textField/valueField 设置“发货时间”，并读回验证。日期仍为月初至昨天。
- 导出所有页叶节点必须属于当前模块、唯一可见、未禁用，且本层和每层 iframe 的点击位置都无遮挡。鼠标移入后再次验证位置，随后持久化导出意图并仅发送一次最终点击。意图之后不自动重放；菜单准备失败不再提前写 `export_armed`。

843 的旧 controller 在菜单准备前写意图，但该 execution 的精确错误只可能在最终点击分支之前抛出。已审阅部署 `20260906T113045Z-e1a943dd272d5547` 的不可变 controller，文件 SHA 为 `8d64fafc73e815c94b7aa0f56020b2314b8dd3754a829863c5f15eedf4fb7677`。专用例外绑定 execution 843、精确起止时间、上述原始 n8n 运行数据 SHA、计划 SHA `f7f871b06decd6aecde7becae70434d155d0d4b6a240428920b2b48bf3c36f59` 和 controller SHA `fdfa4f7d58ba9517222c750aa45c20a8ee09760180358db8b639a7277ca2a56e`；仍要求无活跃执行、原始导入目录只有 controller，下载/事件/验证目录全部不存在。

该例外只证明已审计 843 在最终点击前失败，不依据“没有文件”推断一般导出未发生，也不允许任意 `export_armed` 重置。operator 以原格式 `plan 843` → 精确摘要 `apply 843` 发布 create-only 回执；原计划、controller 和 active 字节保持不变，只有之后的新完整 n8n execution 才可推进 active。身份、摘要、时间、原文件、路径或回执变化均拒绝。

隔离验证：20 项相关测试通过，其中本地真实 Chromium 夹具检查表头/数据行、嵌套 iframe、悬停展开、遮挡/禁用/重复目标、移入后位移、意图持久化失败以及单次最终点击；843 例外覆盖原始字节保持、身份/摘要/时间篡改、额外效果和回执变化。全量 1,913 项测试中 1,893 通过、20 跳过、无失败或取消；构建、20 项渲染检查和 Django 生产边界检查通过，lint 无错误、9 项原有警告。TypeScript 仍为 142 项既有诊断，按文件/错误码/消息对比无新增或减少，不能称为全库类型检查通过。真实五表下载及导入结果以之后的完整 n8n execution 为准。

### 844 导出任务及受控续跑

菜单修复 `2241361d` 已受控采用 release `20260906T132751Z-95f3eae828758ddc`，manifest SHA `e76a767bbb302be112331c7a64ab25671c04eb010ae3ad1714f26292b9da3d75`，plan SHA `b9e1f2ef61d89da719e0883607c17c18326a3550b28709bd88a8350eb89c8720`，successor SHA `612f51c32a15d35414a1b7380efb1e976d1687049925bad947b77ce95f5c5c7d`。Status、启动绑定及全部 backend readiness 通过。843 create-only 闭合回执 SHA 为 `714ddc47c75c3a7d497e593d3c29da91e42e9a13d74168bae1e345d5fd2e54eb`。

之后完整手动 execution 844 在 `2026-09-06T13:34:57.691Z` 开始，原始库存导出意图为 `13:35:05.712Z`，页面精确总数 25,709。点击成功产生平台任务，但自动下载关闭；旧执行器只等待浏览器下载事件，且 300 秒配置被旧模块预算截成 45 秒，因而于 `13:35:51.148Z` 返回 FILE_BINDING_FAILED，尚无导入。此运行不能按无导出效果闭合。

日常浏览器及专用 headless 浏览器均在“下载记录和系统任务”中独立读到 `sys-111899727`、`【导出任务-密文】分仓库存查询(25709条)`、已完成、唯一附件；平台 `data-gmtcreate=1788701705000`，即 `13:35:05.000Z`，与平台仅精确到秒的时间吻合。原始附件 URL 仅在内存读取，持久化 SHA `a19317e27989adba0a5b227d81e31f48c6787be23b8dfde8f1ebd99368924cd9`，不存签名链接或用户字段。

新协议点击最终导出后打开该任务列表，按模块完整名称、精确总数、意图所在秒及之后的创建时间、唯一完成任务和唯一白名单 OSS 附件匹配，先持久化任务绑定再下载。恢复已有 exportIntent 的节点只查原任务，不重复查询或导出；同形任务不唯一、绑定变化、附件数量或地址异常均停止。沿用既有 downloader 将白名单 HTTP OSS 地址升级为 HTTPS 传输，URL 哈希保留源地址；等待任务完成的预算独立采用 300 秒。

独立 `tools/jackyun-export-resume.ts` 以只读方式核验 n8n 原始失败记录、工作流、节点序列、无活动执行、无成功重试及时间顺序；生产 helper 不读取 n8n SQLite。operator 在共享业务锁和 helper 空闲时绑定原 plan/controller/policy/active 的 SHA、任务编号/时间/行数/URL SHA，要求没有后续下载、验证或导入文件。执行 `node --import tsx tools/jackyun-export-resume.ts plan 844 <task-binding.json>` 保存提案，再以 `apply <proposal.json> <approvedSha256>` 发布 create-only 许可。

许可发布后 30 分钟内，从 n8n 完整工作流入口手动启动一次，正常经过“领取共享 helper”节点。计划节点独占领取许可并以 create-only `outputs/jackyun-export-first/resumptions/n8n-export-first-844.json` 绑定新 execution；只有它的后续节点可沿用原 RUN_ID、日期、文件和阶段。原失败记录、plan/controller/active 的身份不被改写；跨日、其他执行、许可或原始证据变化均拒绝。不要点击 n8n 原生的“重试失败节点”，因为它会跳过共享 helper 领取。后续仍受五表齐全、正式导入幂等和独立批次回查约束。

任务未完成时，每 10 秒通过已观测的下载中心“刷新”按钮刷新列表；不会重新点击业务导出。专项 17 项、全量 1,918 项（1,898 通过、20 跳过）、构建、20 项渲染及生产边界检查通过。lint 为 0 错误、9 项既有警告；TypeScript 142 项既有诊断与基线一致。原 844 的只读续跑提案检查通过，实际采用和导入结果以下续执行证据为准。

### 845 五表落地与组合装名称修复

续跑修复 `bf75eef4` 保留了期间已发布的界面改动，采用 release `20260906T141849Z-75fb691dce9c14bd`，manifest SHA `4bc80d9b76899561f18de12ec0a6da948388677d02077bb54043dc9f05366688`，plan SHA `2d6b7e7aad30aa7f4b7e947b83da03a29a47e34616b1ddecf7917d301d47bc5d`，successor SHA `c240d90f3eed7d43c4c2c13591342570ae0c9793d26be233b7cc8623cb1ca1a4`。一次 apply 因旧服务被重新启动而在正式门禁处拒绝，受控 Stop 后相同计划成功 apply；没有绕过端口停止检查。Status、VerifyStartup、全部 readiness 通过。

原 844 续跑许可提案 SHA 为 `2f3ec26d13d41675c9426da1921a91998e8a937e94ad96c9cf0de1fa2a2ade15`。完整手动 n8n 845 于 `2026-09-06T14:27:21.207Z` 开始，独占领取原运行，consumption 绑定许可文件 SHA `d2a0a72580a960a56e368b4eaac782811fcfe07ee7b46690d91aa69d189ccd89`。分仓库存 25,709 行复用原任务，其余依次实际生成：组合装 1,942 个母件/4,392 条关系、销售 4,828 行（发货时间 9 月 1–5 日）、库龄 5,629 行、SKU 货品 8,476 行。五张原始 Excel 均在 `D:\谷歌浏览器\jackyun\n8n-export-first-844`，原交接及 SHA 保留。

组合装首个确认点击没有关闭模块内图片列提示框；operator 只在精确原弹窗、1,942 小于 2,000 上限、原 intent 未变且无新任务的证据下点击一次确认，并重新打开下载中心，未重复发起导出。此人工介入记录为 `outputs/validation/845-combo-confirmation-intervention.json`。后续修复把确认限制在组合装 iframe 内唯一、内容吻合、可点击的 `.mini-messagebox`，点击前后校验位置，并要求确认框消失后才读取下载任务；拒绝遮挡、禁用、重复和未消失弹窗，不自动重点击。

845 的五表完整校验及演练通过。正式导入已成功发布货品 8,476 行、分仓库存 22,642 行、库龄 5,554 行、销售 4,478 行，随后组合装被 Django 400 `parentName 无效` 拒绝，845 于 `14:34:30.057Z` 结束为 error。原文件中恰有两个 parentName 含 U+0009 制表符（子件源行 1,243 与 1,247），没有超长名称。解析边缘仅把组合装展示名称的制表/换行空白规范为空格，附聚合警告；不改编号、关系、数量、其他控制字符或原文件。Django 的 `_combo_rows` 在 `transaction.atomic`、scope owner 与业务写入之前拒绝该请求，因此这次错误可证明未写组合装事实。

受控续导例外精确绑定原 run ID、原文件 SHA `b10ec87fbb0175a7041d83361d40b9266d8bc80dc1f5ed9df24d85f36d1edb67`、输入契约 SHA `b7bf347a04436a19165434491be89edf4346adf817bc6482c250361b0a022a24`、完整失败 audit 规范化 SHA `d15f2096c8d3aa03760a74644703d99e18aa875344227f3405652dc81a26a93f`。重新解析须保留 4,392 条关系、无错误且名称规范化成功；先 create-only 归档旧失败 audit，再由原正式 runner 重新上传组合装。四个 completed 模块只核验已有文件、契约与批次，不重复导入；不能推广为任意失败或结果未知的写入重试。845 的 n8n error 记录保留，operator 续导完成后以原计划 completed 和独立 PostgreSQL 批次回查作为业务完成证据。

组合装专项 3 项通过；全量以 `node --import tsx --test --test-concurrency=4 tests/*.test.ts` 检查 1,921 项，1,900 通过、21 跳过，无失败/取消。默认无并发上限的一次全量中 Chromium 夹具 30 秒超时，单独检查及有界并发全量均通过。构建、20 项渲染、生产边界检查通过，lint 0 错误/9 项既有警告，TypeScript 142 项既有诊断未变。辅助诊断为 ignored outputs 下的 `.mjs`，未纳入产品代码。
