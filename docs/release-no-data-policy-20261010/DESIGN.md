# v3 无数据影响发布设计

## 范围

复用 `release-batch.mjs` 的封存、唯一锁、active 所有权、started/result WAL、unknown 协调、动作前 collector、原 Worker rotation/lifecycle。新增 `not-required` 与原 `reuse/full` 独立。改变发布策略自身的首次采用属于 strict/full；旧 v1 使用其原采用引擎，新验证器明确拒绝解释 v1，旧 v2 验证逻辑和批准字节保持。没有生产维护、迁移、恢复、调度或业务写入授权随代码合并产生。

## 完整证据与三条轴

`makeBatch` 读取完整 before/after 源树，绑定 tree SHA 和完整 inventory SHA；proof 保存完整库存及全部变化字节。`verifyImpactProof` 检查清单增删改集合、字节、额外项和前驱/候选身份，再重算 v3。现场 collector 再由实际 immutable 前驱 source-snapshot、实际候选/源码/依赖/工具链/配置重建绑定。只改 JSON 后重算 batch SHA 无法改变结论。

源码之外的输入同样必须证明：`deploymentProof.beforeRaw/afterRaw` 保存原 prepared-build receipt 字节，绑定前后 preparation SHA、plan SHA、manifest SHA、source/inventory SHA，并比较 identity 中除 sourceTree/sourceInventory 之外的所有字段（包括环境、runtime config、npmrc、Node/工具链）。缺少原前驱收据或发生变化即为逐项 full 缺口；新生产 collector 从已验证 successor 链定位前驱真实 approved plan，并从固定 state/worker-prepared-builds 读取原收据/sidecar，不能由 caller 任意文件冒充。它不是恢复点/日备份前提。机制首次 strict 采用形成未来基线。

CSS 值证明只说明规则和执行源码未变，不能单凭语法推导全应用既有 ResizeObserver、delegated handler 或文本消费者必无副作用。因此还必须封存实际独立 effect-review 原报告：`witness.reportRaw` 为 `teruisi-no-data-effect-review-v1`，包含精确前驱/候选/制品/plan/delta/closure SHA、reviewer 和 `no-change-related-persistent-effects` 结论；`findings` 分别记录 DOM 文本消费者、布局观察器、持久写入、构建/启动、操作词汇的实际检查发现。SHA 纳入 binding.effectReviewSha256，不能用 effects=false 或空泛勾选取代。工具无法密码学证明报告作者身份，独立审查真实性仍属既有受信任审查与真人批准边界；代码不会把该报告当成绕过受限语法/动作检查的通行证。

- components：Worker replace；首版合格证明要求 Django unchanged。
- persistentData：受限展示证明为 none；其余为 unproven，并列每个路径的具体缺口。
- backupMechanism：机制/依赖/部署相关改动为 changed-or-unproven；该轴绝不由 caller 布尔开关设置。

代码验证强度继续通过 requirements/tests 管理；恢复决定消费数据/机制/组件轴，不消费“测试严不严格”标签。严格权限代码变动首版仍会因无受支持的证明而 full，而不是因为验证强度这个词直接要求数据库四阶段。`noData/readOnly/effects:false` 不授予资格；独立复审必须绑定完整差异/闭包，已报告副作用会阻断。

首版机械规则：

1. 既有 app/components CSS，只替换原允许属性的展示值，选择器、结构、属性、外部资源、变量定义、content、pointer-events 等字节保持。
2. `use client` TSX，要求整个组件是零参数、无导入/表达式/事件/自定义祖先的单一静态被动组件。仅原生被动标签静态文本，或已有 className 中有限 Tailwind 间距/字号/字重/圆角字面集合可归一化。既有 button/onClick 基于 textContent 触发写入的反例不能进入此路径。调用、导入、事件、JSX 结构、server directive 都不改变；跨组件消费者仍由完整闭包独立审查覆盖。
3. 不接受新增/删除文件、PNG、Markdown、任意 GET、查询代码或事件处理变化。即使它们可能无数据影响，也先列缺口并 full；不引入通用副作用分析框架。

## 封存及操作白名单

新默认版本 `teruisi-release-batch-v3`，state `SEALED`。合格批次 recovery 为 `{mode:not-required,reasons:[],evidenceSha256:null}`；databaseOperations 为 `{required:false,operationIds:[]}`，recoveryEvidence/recoveryCurrent 都 null。禁止混入 business、Backup、Restore、DeployApp、HardenAcl、维护后端或任意 command。v3 无证明时 full，旧 v2 才按旧条件决定 reuse/full。

操作只允许原 worker-plan/apply、BeginWorkerDrain/StopWorker/StartWorker/EndWorkerDrain、VerifyStartup/AggregateStatus，以及 no-data-observation。原生命周期命令为固定系统 PowerShell + 当前可信 `release-lifecycle-step.ps1` + 精确 Step 参数；不接受替换同名脚本、额外参数、cwd、backend/source 路径覆盖。启动必须绑定同批 Worker/Django manifest 与排空 owner。适配器、transport、PowerShell 完整字节钉住，运行前再次 safeFileDigest。

最终启动调用链复核曾发现真实缺口：原 Worker `Start` 在后端 NotReady 时会调用 Django Start，可能运行迁移/权限设置；fresh/already-running 两分支还会尝试 AutoStartDingTalk。仅声明 Worker-only、Django manifest 相同或事后ready检查不能阻止这些动作。现沿用原控制器增加 `-BackendStartPolicy RequireReady`（普通默认 EnsureReady），仅允许 Start。StartWorker 适配器在同批 ExpectedDrainId 存在时固定传入该策略：原 Ensure-DjangoSystemReady 若后端未ready，须在任何 Django Start 前拒绝；后端已ready时继续原Worker启动，并跳过两个分支的接收器自动启动。普通Start与full维护不传该策略，原fallback保持。

此策略使用原transport支持的枚举名称/值，未扩充switch解析器或创建新生命周期。原维护/owner/进程身份先验、完整制品验证和后置ready检查保持；失败留gate/active/unknown，不继续EndDrain或自动重试。自然业务和既有相同配置的Worker计划任务仍由原唯一Stop→Start及requests drain控制，不要求全系统数据库冻结，也不新增cron/追赶任务或切换Django接收器。

因此首次机制采用的实际源码差异扩大为九个模块：原七文件再加 `worker-local-service.ps1` 与 `release-lifecycle-step.ps1`，自身仍strict/full。早先七文件载荷7c01及第6轮清除意见仅覆盖当时字节，保留为已被替代的证据，不能继续作为最终采用载荷。

collector 必须为原 standard in-process transport；直接实现闭包、TypeScript 解析器与 package resolution、Node 均锁定，启动时核精确 batchPath/testsPath，动作前检查全部 pinned 文件及相同完整源码/工具链。原完整制品校验仍在 admission/drain/apply/closeout，Start 动态就绪/身份也保留。新 observation 被加入 immutable release bundled/key-file 清单。

## 固定观察器

`tools/release-no-data-observation.mjs` 提供三个动作，没有用户脚本或外部命令输入：

- display：声明精确 `/assets/<name>.(css|js|png|woff|woff2)`，从同批 candidate/dist/client 读取预期字节；浏览器仅允许固定首页和这些精确资源 GET，不允许重定向。资源实际响应逐字节 SHA 必须一致，且声明资源确实被页面消费。断言只能是有界 selector + 固定 computed-style 属性/值或文本。生产 URL 固定 `http://127.0.0.1:3000`，不接受 caller origin/cookie/JS/click。所有 API GET 被拦截并记录，因此不能把“返回 GET”当作只读证明。任何写尝试失败。页面在该范围下无法就绪时验收失败，不能宣称通过。Chrome 可执行文件和 Playwright 库树 SHA 分别绑定。
- permissions：仅原两个固定 unsigned reader GET 8071/customer-service/conversations、8101/access-control/users；必须 401/authentication_required。它不是全部角色矩阵的替代，完整 permissions-regression 仍属于精确候选测试证据。
- natural-watchdog：只读原 latest.json；计时开始后两次不同、递增、同进程、同 desired-state fence、同 releaseId 的完整健康观测。初始旧记录只能作为基线，之后任何坏/旧记录立即失败；每一份原始遇见值先 create-only 保全，既不主动触发 watchdog，也不修改任务。

所有观察在原 batch 日志旁创建固定 `observations/<operation>-<uuid>/`，保全 started、完整结果或失败详情。结果目录/摘要进入操作 outputs；失败不覆盖旧证据。私有测试显式函数 seam 可注入 origin/readResource/chromium，生产包装不读取这些参数，私有成功不替代原正式运行门禁。

浏览器在创建页面前还显式安装 WebSocket 路由；记录任何连接尝试并直接关闭，绝不 `connectToServer`，随后按写尝试使观察失败。普通 HTTP 路由不能代替此检查。真实回环负例验证 websocket upgrade 次数为零，并保留被拒路径；这不是浏览器全面安全沙箱或任意网络渠道的形式证明。

## 不依赖恢复复用条件

admission `collectBatchRecovery` 对 not-required 直接返回 null，不调用日常调度、恢复点 Verify、26小时/7天条件、retention 或 ReleaseEvidence。所有其他字节/权限/进程/ready/锁/排空/CAS/动作前门禁保留。日常备份与周期演练继续作为单独能力，不擅自启用 PAUSED；推荐周期/事件触发方案须另行审查。

## 验证与限制

新增测试覆盖零 DB 封存及真实 WAL 调度、无恢复收集调用、caller 伪声明、写 GET、迁移/启动/依赖夹带、库存遗漏、源/制品/前驱漂移、重新计算摘要后的策略/操作/参数伪造、权限步骤遗漏、observer 任意请求和真实浏览器资源/样式/写拒绝。原 v2 wait/fastpath 用明确原版本继续回归。

小型 HTTP/browser 场景只证明机制。主代理另用实际 AB 的 5157 文件完整 source-snapshot、真实仅 CSS 改动、正常 postinstall/完整构建和实际应用 DOM 进行私有候选验证；具体成功/失败、封存和关闭证据由 REPORT 记录，不用本设计声明替代。旧 active9f79 仍在途时，不能准备或切换另一个生产批次；实际机制首次采用所需的严格资料/批准仍列显式缺口。
