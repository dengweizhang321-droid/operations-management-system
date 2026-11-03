# R1：ready 判定自锁的只读调查与路径比较

日期：2026-11-04（Asia/Shanghai）。任务来源：`D:/运营管理系统/codex-提示词-R1-解开ready自锁.md`。源码基线：远端 `main` 的 `ba78ceff052c543ff568f7c7eac0c42b983129e7`；独立工作树 `D:/codex-worktrees/readiness-selflock-20261104`。

## 结论与排序

**推荐 A：保留现有双组件冻结包，经过用户选择和本次上线授权后，有限尝试原固定入口。** 当前包没有 `STARTED.json`，正式发布前真正受旧 Worker 4 秒整轮预算影响的聚合 HTTP 检查只有一次；先单独跑 `--check` 再正式发布，则合计两次。按题设单次成功率 `p≈0.5`、且两次独立的假设，整组通过概率约 **25%**；已经拿到一次成功 `--check` 后，后续正式入口仍有一次，条件概率约 **50%**。它有失败和等待成本，但不需要改包、改门禁或拆分版本。

| 推荐顺序 | 路径 | 结论 | 主要依据与代价 |
| --- | --- | --- | --- |
| 1 | A：重新观察后按原流程发 | **可行；发布需另行授权** | 本次正常分支没有多重隐藏的旧聚合 ready 硬币；原包可继续核验使用。概率为假设估算，成功不保证。失败后按新现场分支处理，不无限重跑。 |
| 2 | B：降低被探对象负担 | **只读定位可行；确定性解锁未证实，生产调整需另行授权** | AI 写锁等待和网店聚合慢查询确实存在；未取得把某条 SQL 与每次 3.4→4.2 秒探测逐一关联的证据。不可把降载收益当成确定结果。 |
| 3 | D：先单发 Worker | **组件机制支持；不能直接用于当前冻结包，重新设计/准备/上线需另行授权** | 仍受固定入口同一 ready 检查；两组件请求摘要、制品范围、前驱和发布记账不能原地拆开。 |
| 4 | C：只放行这一次 | **没有适用于本次的既有一次性豁免入口** | 参数白名单无跳过 ready 开关；adopt-live 要求记账真实失配并仍探 ready；缩短 deadline 不能放宽内部预算。 |

本次仅交方案和只读证据。没有执行 `--check`、打包、控制包重建/采用、发布、维护、重启、数据库命令或生产写入；没有重测题设的连续聚合探针及 23 端口。

## 1. 现场与源码载体核验

证据：[本地文件与日志摘要](READONLY-EVIDENCE.json)、[运行身份快照](RUNTIME-SNAPSHOT.json)、[制品绑定核验](BINDING-CHECK.json)。观察约为北京时间 01:39–01:42，属于当时快照，不是以后执行的通行证。

| 对象 | 本次观察 |
| --- | --- |
| 发布记账 | `PUBLISHED-MAIN.json` 仍为 `e7aaf6c16939770d0941994873747fe301ef0b93 / deployed_and_ready`。 |
| 现役 Django | `app/deployment.json` 实测 SHA 为 `527bb5f5…`，与记账一致。 |
| 现役 Worker | 进程回执为 `20261103T110935Z-c5916e23fb720393`，manifest 实测 `368cfb74…`，与记账一致；3000 端口有监听。监听存在不等于 ready 成功。 |
| 候选 Worker | `20261103T151159Z-f230d1a1bd5bf0d3`；manifest 实测 `186b7a0f…` 与 PREPARED 一致，bundle 文件存在。 |
| 候选 Django | `app.deploy-fd4361f6ff2041d294067805b6791b7e`；manifest 实测 `2c9a9ad3…` 与 PREPARED 一致。 |
| 准备记录 | 实际路径是包下 `publish-ba78ceff052c/preparation/PREPARED.json`，不是包根。时间 `2026-11-03T15:22:45.122Z`，即北京时间 23:22。 |
| 请求绑定 | `SHA256(JSON.stringify(request)) = 35ab75bb…`，与 PREPARED 相等；components 为 `worker,django`，两个制品记录均存在，migrate=false。 |
| 在途发布 | `publish-ba78ceff052c` 仅有 `preparation` 和 `maintenance-preflight-dt0D7V`，无 STARTED/SUCCESS。维护、排空、发布 lease 三个已知标记均不存在。 |
| Pi | PID 3748 存在，创建时间、可执行文件、命令行与原回执精确一致；`django-ai-pi-worker.control.json.stopped` 不存在。未改身份闸。 |
| 冻结 source | `git status --porcelain` 为空。未修改任何冻结文件，也未重新进行完整制品逐文件资格化；正式发布仍做原生核验。 |

**存在三种不同载体，必须分开：**

1. 现役 Worker bundle 仍是旧实现；题设给出的 4 秒整轮预算、成功/失败采样与候选 `round_budget` 证据直接复用，不重测。
2. 冻结 `ba78ceff` source 已含 18 秒整轮/4 秒单服务预算和原生发布末端 120 秒有界等待。[聚合源码](../../lib/django/backend-readiness.ts) 第 18–19、35–54、78–85 行；[发布尾部](../../tools/publish-main-tail.mjs) 第 59 行。
3. **固定发布 CLI 当前采用的控制包还是 `fe4e34dcea03ad77c47c288bd572841ae69428bb05147893f69c452102d45aa6`**，安装记录状态 adopted。这个包的 `publish-latest-main.mjs` 第 34、130、620 行仍是 15 秒 fetch；第 65–66 行做单次检查。仓库中已修好的三处没有再次修改。发布应用包也不会自动替换这个独立控制包。

后文用 **L** 指上述现役控制包的 `tools/publish-latest-main.mjs`，其完整目录见证据 `control.bundleRoot`；用 **S** 指冻结 `ba78ceff` 源码（本报告工作树同提交）的相对文件。两者行号不能混用。

## 2. A：全部检查点、分支与概率

### 2.1 维护前检查点清单

| 检查点 | 实际调用位置 | 是否请求旧 Worker 聚合 ready | 当前分支次数 |
| --- | --- | --- | --- |
| 固定 `--check` 观察线上版本 | L:877–880 → `observeLatestMain` L:287 → `readLivePublication` L:34、65–66；新源码对应 S `publish-latest-main.mjs`:33–66、885 | **是，单次** | `--check` 一次 |
| 正式固定入口再次观察线上版本 | 同上，正式入口重新执行 `observeLatestMain`，不复用上次 `--check` 的健康结果 | **是，单次** | 正式部署一次 |
| `inspectNotEnteredPublication` | L:620–651；正式入口 L:881–884 调用退役检查；S 对应 622–653、886–889 | **有条件才是**。L:623 检查无 STARTED 立即返回，尚未到 HTTP L:651 | **当前为零**；`--check` 本身也不进入退役分支 |
| `adoptLivePublication` | L:130、150–151、186–188 | 是，但属于显式 `--adopt-live` 独立模式 | 当前为零，不是普通发布流程 |
| native `publish-main.mjs --check` | S `publish-main.mjs`:49–60 → `maintenanceReadiness`:223–279 → `manual-maintenance-preflight.ps1`:4–8 | **否**。核对控制器/文件摘要、时效、Pi 身份；`ready=true` 是资格结果 | 不是概率因子 |
| 固定发布前置 | L 检查清单:484、`probePublicationPreconditions`:544–556，正式 `deployReadyMain`:694–699；S 对应 486、546–558、697–704 | **否**。运行 ACL、应用树和进程归属检查 | 不是概率因子 |
| 已准备包第一次维护前驱资格 | S `publish-prepared-main.mjs`:184–186 | **否**，同一 `maintenanceReadiness` 文件/身份核验 | 不是概率因子 |
| 候选 Worker 原生计划复验 | S `publish-prepared-main.mjs`:189–197 → `worker-local-release-rotation.mjs`:1200–1221 → `worker-local-release.mjs`:2888–2891、3125–3133 | **否**，候选完整性及前驱进程验证；闭包未调用聚合 ready | 不是概率因子 |
| STARTED 前最终维护资格与 PS preflight | S `publish-prepared-main.mjs`:260–266；`manual-maintenance-process.psm1`:25–62 | **否**，文件、120 秒材料新鲜度及精确进程身份 | 不是概率因子 |
| 原生维护入场 | S `publish-prepared-main.mjs`:289–306；`manual-maintenance-start.ps1` | 进入原维护协议，不另请求旧 Worker 聚合 ready | 不是额外硬币；入场后的排空/停止仍可独立失败 |

附带分支也查明：S `publish-prepared-main.mjs`:147–158 的已有 SUCCESS 复用分支在第 156 行单次 `ready()`，但本包没有 SUCCESS，故不计入。`publish-main-status.mjs`:43、56 及恢复分支是显式状态/续接，不是本次普通首次发布调用链；旧 `publish-main.mjs`:213 的 ready 位于历史恢复末端，同样不能加到本次维护前次数。

正式尾部 S `publish-main-tail.mjs`:50–59 在切换/启动后才 `waitReady()`，由 `publish-prepared-main.mjs`:132–139 配置为 120 秒有界等待。它探的是切换后的新 Worker，不再是旧 4 秒整轮预算的同一硬币；也不能用它为维护前失败兜底。

### 2.2 概率的适用范围

- 单独固定 `--check`：`p≈50%`。
- 每轮都重新做 `--check → 固定正式发布`：`p_check × p_deploy≈0.5×0.5=25%`。
- 已经成功完成 `--check`，下一次正式入口：只剩一次旧聚合探测，假设条件通过率约 `50%`，不是再次按 25% 算。
- 当前不应计算 `0.5^3` 或把两次 `maintenanceReadiness` 当独立健康探测。若以后出现 STARTED，必须重新审定状态；退役分支即使成功也会退役旧包、要求新准备，不是简单多过一次就续用同包（L:667–676、881–889）。

这是**仅针对旧聚合 ready 障碍的概率模型**。题设约 50% 是历史小样本估计，未证明独立、平稳；同机负载可能让相邻探测相关。版本、ACL、互斥、进程、排空、启动等门禁的通过率未测量，25% 不能称为实测全链路成功率。

上次日志 `release-2026-11-03T17-01-40.353Z-0e5b594f-f423-4d6c-a906-7906b9acb602.log` 第 1–15 行确认：整个步骤耗时约 211.6 秒，最后报 **`The operation was aborted due to timeout`**。它没有 HTTP 状态或逐服务耗时，不能把这一次具体失败写成“已证实收到 4 秒 503”，也不能把 211 秒视为 HTTP 探测耗时。15 秒客户端超时、HTTP 503 与端口不监听必须分开归类；工具显示的 HTTP `000` 不是服务器响应码，也需结合连接错误/监听证据判断。本次只核监听存在，没有重新发 HTTP。

## 3. B：慢查询与抖动的只读定位

### 3.1 方法及口径

先读取任务指定的 `netshop-rows-covering-index-wont-help.md`、`netshop-rows-never-vacuumed.md` 和 `control-bundle-rebuild-steps.md`，位置均为 `C:/Users/86137/.claude/projects/D--------/memory/`。索引/未 vacuum 的历史测量作为线索，不冒称本次查询到最新统计。

本次使用[有界采集脚本](collect-readonly-evidence.py)，逐行扫描两份已定位的 PG 日志，限制每份不超过 5 MiB，不执行 SQL；实际约 2.39 MB、0.05 秒。只保存分类计数、时间、耗时、原文件行号和扫描前缀摘要，不复制 SQL 全文或业务数据。duration 统计是已记录的精确语句类别，不是所有执行次数；低于日志阈值、未记录或未完成语句不包含在内。

**文件日期不能代替事件日期**：`postgresql-2026-11-03.log` 包含 11 月 4 日 00 时及少量 01 时事件。因此“日志里 22 次”与“11 月 3 日自然日 22 次”不同。

### 3.2 三个嫌疑逐条结论

| 嫌疑 | 可核实事实 | 能否解释这次 3.4→4.2 秒抖动 |
| --- | --- | --- |
| AI revision 单行 `FOR UPDATE` | `policy.py`:267–268 的确持有域 revision 行锁。11/3 23 点 duration **170 条**，最慢 **42,413.530 ms**，与题设相符。两文件中 00:30 后仍有等待，最慢已到 **10,034.466 ms**（11/4 文件第 1322 行，01:27:05.261），不再只有历史 5.97 秒 | **与失败 check 的宽时间窗重叠，直接因果未成立**。211 秒步骤窗口包含 AI 写入锁等待，但没有该次 HTTP 探针起止与 SQL 的逐请求关联；线程排队/共享资源属于待证间接路径 |
| 网店身份 `COUNT(*) FROM (SELECT DISTINCT …)` | 11/3 文件匹配 **121 条 duration**，其中 11/3 自然日 **117 条**，11/4 00 时 **4 条**；11/4 文件另 **2 条**。最慢 **53,960.318 ms**（11/3 文件第 1831 行，23:46:20.025），11/4 两条分别 22,344.054 和 24,115.443 ms | **慢查询存在，未证明抬高该次 ready**。这些已记录 duration 区间与上次 check 01:01:40–01:05:12 无交集；不排除其他未记录资源压力。题设“351 次”按本次精确模式和两文件范围无法复现 |
| PG error code 487 | 11/3 文件有 **22 条** `could not reserve shared memory region`，按行内日期为 11/3 **20 条**、11/4 **2 条**；最后一条 00:12:27.109。11/4 文件截至扫描时没有此错误 | **错误真实存在，但无该次 check 同窗证据**。日志不能确认涉及哪个健康连接、是否为连接失败/后台子进程，不能仅凭错误号断定物理内存不足或指定修复参数 |

### 3.3 为什么不能说“AI 锁拖慢所有带 AI 写入的健康检查”

本次还读取了**现役 Django 应用内**同名文件，确认与下面调用路径一致：

- `backend/teruisi_backend/health.py`:2728–2733 将 AI reader/writer ready 委托给 `ai_assistant.health.ready`。
- `backend/ai_assistant/health.py`:249–265 建立健康检查事务并验证连接角色；第 702 行是普通 `AiDataRevision.objects.get`，第 732–739 行返回结果，没有调用 `policy.mutation`，也没有 `select_for_update`。
- `backend/ai_assistant/policy.py`:267–299 才是业务 mutation 行锁和包住业务写入的事务。
- PostgreSQL 的行锁不会阻塞普通 SELECT；日志里的 `AccessExclusiveLock on tuple` 也不能误读为表级 ACCESS EXCLUSIVE。[PostgreSQL 17 锁文档 §13.3.2](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS)

**间接拖慢是合理嫌疑而非已证根因**：AI writer 原生 waitress 配置为 6 线程，reader 为 2 线程（`tools/django-ai.ps1`:596、622），业务写等待可占用 writer 请求线程；是否耗尽并导致 ready 排队，需同时间请求排队/线程证据。本次查看的现役 AI reader/writer stderr 小日志仅有 Serving 启动行，未提供请求级排队时间。健康检查本身还逐表逐权限运行目录查询（`ai_assistant/health.py`:285–300），因此请求数、健康检查工作量、CPU/调度与其他数据库负载也可能影响总耗时。

网店精确慢查询可对应 `backend/netshop/consumers.py`:251–252、289–306 的身份集合计数，是业务投影路径。本次不重跑 EXPLAIN ANALYZE、不加覆盖索引、不 VACUUM、不改 statement_timeout。既有记忆已测得窄索引不能消除全量 DISTINCT 聚合成本；未 vacuum 是另一个维护问题，不能直接当作这个 ready 自锁的修复。

**B 的最终定位结论：现有证据不能唯一指出哪条慢 SQL 导致每轮多出的约 0.8 秒。** 已证的直接边界仍是题设中的旧 Worker 4 秒整轮预算，23 服务在 6 个槽中排队，整体只留很小余量；嫌疑负载存在但没有逐次探针起止、队列、SQL 等待和系统资源的同步关联。若另选 B，应先明确低负载窗口/待暂停工作的业务范围并另行授权；不擅自暂停任务、杀连接或调数据库。补充采样若有必要，应限一次有界同步观察，不再重复既有十次测试，也不承诺观察本身能解锁。

## 4. C：有没有现成的一次放行入口

**没有适用于这次正常发布的现成一次性豁免。**

1. L:793–807 的 CLI 参数白名单没有 `skip-ready`、`force-ready` 或超时豁免。函数注入 `fetchReady`/context.fetch 是隔离测试接缝，不是生产 operator 开关，不能拿假响应填进去。
2. `--adopt-live` 用来弥补真实记账失配；L:150–151 发现三值一致就拒绝，L:186–188 仍要求真实 ready。这里 PUBLISHED 与现役一致，既不适用，也违反本任务不动 PUBLISHED 的边界。
3. `publication-readiness.mjs`:15–27 取传入和继承 deadline 的较早值、再取单次 timeout 与父预算的较小值。延长外层期限不能改变旧 Worker 内部 4 秒；现役固定控制包甚至尚未采用这份 helper。不能用环境变量把“收紧”解释成“放宽”。
4. 原生 `source/tools/publish-main.mjs --check` 确实不探聚合 HTTP，但这是内层资格检查，不等价于完整固定 `--check`，通过它不会产生一张可以绕过 L:65 的票据。
5. 直接调用内层 `publish-main.mjs --deploy-only`/导出 `publishPreparedMain` **确实没有维护前旧 Worker HTTP ready**，但不是完整的“一次放行选项”：它会离开固定入口的控制/队列和前置编排；`publish-main-tail.mjs`:60–62 只写 SUCCESS，当前固定外层 L:906–918（新源码 911–923）才补齐 PUBLISHED 目录记账。不能把局部可调用函数当成无需设计的完整受控续接，也不能现场写适配器或手工补记账。本包无 STARTED，不属于已进入发布的恢复；现有“续接本次发布.bat”明确绑定历史 `2f875fb0`，不能用于本包。

既有 `publish-main-status.mjs --resume` 也不能接本次未开始的发布：第 30 行先读取 STARTED，`publish-main-resume.mjs`:61 还要求对应 Pi Runner 升级准备，本包均不满足。需要区分“存在可调用的原生部署子入口”与“存在覆盖全部职责的独立续接 CLI”；前者真实存在，后者当前未找到。直接原生成功后也**不一定再次自锁**，L:47–52 可能通过同源新 Worker/Django 和 SUCCESS 识别新版本，但这不等于 PUBLISHED 收尾已闭合。若另评估原生恢复路线，应先交付明确的控制世代、锁序、固定环境、前置和目录 CAS 协调方案，再获专项授权；本次不临时拼装。

因此不提供绕过命令。不增加开关、不改 helper 或控制包、不扩大已有历史恢复授权。

## 5. D：Worker-only 的能力与冻结包限制

### 能力存在，但没有解除第一道 ready

S `publish-prepared-main.mjs`:56–59 接受只有 worker 的 components；第 292–299 行走 BeginWorkerDrain/StopForRelease；`publish-main-tail.mjs`:51–53 以 `RequireReady` 启动 Worker 并结束前端排空，Django 保持原部署。这说明系统具备 Worker-only 正规组件流程。

但是固定入口依然先执行 L:287→65 的旧聚合 ready，**并非先切 Worker 再检查**。所以单发 Worker 自身不能消掉最开始那次硬币。

### 当前双组件包不能拆

- 完整 Git 差异涉及发布控制/复制规则，原范围计划已判 `worker,django`。`release-scope-plan.mjs`:29–39 对共享控制及未知规则保留两组件；L:320–333 现算计划并用 write-once 校验冻结请求，不能手填范围覆盖。
- `publish-main.mjs`:44–45 要求 request.components 与 releasePlan.components 完全一致。
- `publish-prepared-main.mjs`:174–180 要求 request SHA、source identity、Worker plan 和 Django package 与范围都一致。只删 components.django 会在摘要/范围处拒绝；连 PREPARED 一起改就是破坏冻结制品。
- 即使另经授权开发拆分流程，第一阶段切换后的 Worker 前驱已经变化，原第二阶段请求会被第 161–162 行前驱断言拒绝。不能承诺原 PREPARED 原封不动作为 Django 补发包继续使用。
- 现工具没有把双组件 PREPARED 直接“投影成单组件”且重新绑定完整记账的 operator 入口。需要新的来源/请求/范围及准备材料。底层存在同一来源和同一前驱的计划复用机制（rotation:1200–1221），但**未证明新拆分材料可满足该身份**，不能许诺绝不重新构建 523 秒，也不武断说所有 payload 都必然重建。

### 版本错配应分两层回答

`git diff e7aaf6c16939 ba78ceff052c` 没有 `backend/`、migration 或依赖变化；核心 ready 预算修复在 Worker，响应校验契约仍兼容旧 Django。**没有发现必须同时更新 Django 业务 API/schema 才能运行新 Worker 的证据。** Django controller 的实际差异仅在 `Prepare-Application` 复制清单增加 `publication-readiness.mjs`（`django-local-service.ps1`:2266–2272），旧 Django 不会因未复制一个供新发布工具导入的 helper 就使业务接口必然失效。

但 `tools/*.mjs` / `*.ps1` 并非都仅属 Django：固定控制包、冻结 source、Django app、Worker immutable 工具、桌面/看门狗各有独立采用面。单发 Worker 会留下旧 Django 中的发布工具副本、旧固定控制包及其他消费者，不能宣称全套修复已采用；具体载体见已有 [PROBES.md](../readiness-stability-20261103/PROBES.md) 和 [COMPATIBILITY.md](../readiness-stability-20261103/COMPATIBILITY.md)。

另有明确的**后续漏发风险**：tail 第 60 行按 request.mainCommit 生成成功；如果 Worker-only 就记成 `ba78ceff`，固定入口 L:305 发现 main 相同会直接 already-current，后续范围又以 L:320 的 live.mainCommit 为基线。这样“同一 ba78ceff 再补 Django”不会自动发生，未来差异也可能漏掉本轮未装工具。拆分方案必须先解决组件完成度与版本记账，不能改 PUBLISHED 冒充已经两端交付。

因此 D 是额外工程/交付方案，当前风险和工作量均大于 A，不推荐作为这次解锁捷径。

## 6. 建议的下一步与停止条件（未执行）

用户选 A 并另行授权上线后，继续使用**原固定 shim、原无后缀 config、原双组件包**，保留单次 `--check` 和正式入口各自的原检查。可以在自然低负载时段有限重跑只读检查，不改变服务/任务状态。检查成功只表明那一次观察成立，正式发布仍会重新检查。

正式发布若再次在 readLivePublication 拒绝且没有新 STARTED/维护/排空作用，保留失败日志，核对拒绝种类后再由本次具体授权决定是否另试；不能将所有错误泛化为可重试。若出现 STARTED、前驱变化、维护标记或结果未知，退出 A 的“未进入维护”假设，转入原受限恢复流程。末端 120 秒等待保留原规则，不修改为无限等待或强行成功。

当前没有必要以重建控制包、数据库调参或拆分包作为解锁前置条件。以后采用新版固定控制包可使外层单次观察期限与新 Worker 18 秒整轮上限匹配，但那是另外的受控采用动作；本次不把它插入方案执行，更不启动重建。

## 7. 明确未核实事项与交付检查

- 50% 的实时准确值、探测之间的独立性、完整发布成功率：未测。
- 上次客户端 timeout 是否由同一 4 秒预算问题、Worker 调度/连接延迟或其他原因造成：缺请求级证据，未唯一归因。
- 哪条 SQL 造成每一次 0.8 秒抖动、writer 是否耗尽全部线程、487 涉及的具体连接：未证实。
- “351 次”的原统计来源/范围、当前 netshop vacuum/analyze 统计、当前查询计划：本次没有数据库查询，不能声称复核通过。
- 本次制品核验覆盖存在、关键 manifest/request 摘要和干净来源，不替代全部原生完整性/运行互斥资格化；没有尝试获取发布锁或新鲜准入。
- 最终合入或正式采用：本次均未执行。现报告是未合并分支交付，不会使上述方案自动获批。

文档检查范围：本次差异、引用文件/行号、脱敏 JSON、计算与独立审查。不新增功能测试、不运行全仓测试或业务验收。独立审查按现行映射请求 `gpt-6.1-sol/high`；工具未独立回传底层实际型号，不把请求值冒称实际核验。

独立审查结果：无阻断项。已按审查意见修正现役前置探针行号，明确原生子入口与完整发布职责的区别，并将 AI 竞争表述限定为 check 宽时间窗重叠。三个证据 JSON 可解析，采集脚本语法和报告八个本地引用通过，概率计算及本次差异检查通过。
