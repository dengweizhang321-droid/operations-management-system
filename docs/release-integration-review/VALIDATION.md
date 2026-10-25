# 第二阶段隔离验证方案

2026-10-10追加：当前精确批次与最后批准范围见 [EXACT_AB_BATCH_PLAN](EXACT_AB_BATCH_PLAN.md)，下文早先未封存状态为历史快照；生产批准/实际采用仍false，C快路径仍拒绝。


第二阶段已按本方案串行完成最小充分联合回归、439文件拆分覆盖、必要负例、隔离构建、现存完整点实恢复和两份候选prepare-online；实际日志/范围/未测与首轮失败见[REPORT](REPORT.md)。下文原方案不自动构成所有预期项通过。生产前后对照、采用/不可用观察和严格批次的新前后备份恢复尚未执行。

本文件是准备方案，命令均未在第一阶段执行。执行门槛为用户指定通知及 [完整交接](HANDOFF.md)。不能在收到通知前安装/构建/集成或借测试调用正式生产入口。

## 执行顺序与环境

1. 刷新远端，读取每项最终Git对象、被测文件摘要、原日志、独立复审、残留事项与合并状态。保存变更快照；不能把作者分支tip当交付SHA。若缺项，先列出待交接，暂停依赖该项的集成。
2. 在D专用worktree形成隔离组合；原任务被审文件变化、冲突解决和必要补修形成清晰差异，重新独立复审。从最新main开发不等于用整棵main准备生产：另按实际拥有方读取Worker immutable source-snapshot和Django应用包前驱，形成仅包含批准功能的生产组合闭包。
3. 开始前核验源码干净、Node/系统PS5/实际PS7/锁文件/Python/浏览器版本；单独创建依赖和Python环境。不得复制生产.dev.vars、DPAPI秘密、用户浏览器Profile、下载目录或生产数据库连接。
4. 先审查测试的所有硬编码路径和端口、fixture加载器、外发封锁/调度关闭、生产回退拒绝和清理归属，再运行测试。私有PG使用独立空目录、独立凭据、可证明空闲的55432–55999回环端口；禁止在正式5432 cluster内创建测试库。HTTP/浏览器用本任务私有端口和合成数据，关闭ServiceWorker及真实外部发送。
5. 轻量文档/静态检查先行；真实子进程专项→联合发布专项→原受影响回归→必要领域/PG/实际UI→全量单测→lint/边界→隔离构建→完整备份/恢复镜像演练，重资源步骤按排期串行。每段进程正常结束并核清理后再开始下一段。
6. 记录同机其他重任务的时间与实际资源观测；协调错峰不擅自停止其他任务/生产服务。若资源归因没测清，保留未知，不能为计时关闭正式调度。
7. 最终组合通过后，准备精确制品/回滚计划/新批次，独立审查最终SHA、范围与全部证据；生产候选准备只在第二阶段。合并推送按规范复验最终源码闭包；生产采用另需最终精确范围批准。

## 最小充分联合回归入口

以下是当前已定位的入口；A/C新增文件从冻结观察SHA定位，不存在于D阶段一基线。第二阶段先逐项核对最终文件/导入关系，避免重复运行已经被wrapper导入的测试；不得省掉关键联合负例。

```powershell
# 仅在第二阶段已形成隔离组合、隔离夹具审查通过后，在D专用worktree执行。
node --import tsx --test --test-concurrency=1 tests/release-wait-optimization.test.ts tests/release-process-deadline.test.ts tests/release-acceptance-closeout.test.ts tests/release-closeout-independent.test.ts tests/release-fastpath-evidence.test.ts

# 原受影响的生命周期、排空、打包/安装、Control、watchdog、恢复目录回归。
node --import tsx --test --test-concurrency=1 tests/worker-local-release.test.ts tests/worker-local-release-rotation.test.ts tests/operations-system-control.test.ts tests/operations-system-watchdog.test.ts tests/release-worker-drain.test.ts tests/system-lifecycle-race.test.ts tests/startup-release-optimization.test.ts tests/django-local-service.test.ts
```

原 `release-wait-optimization.test.ts` 导入PS5环境回归，不再单独重复该mjs。Python历史/恢复测试先检查TS入口是否已执行；需要单独运行时使用本worktree独立锁定环境和原测试参数。`watchdog-no-console.test.ps1`及真实prepared-app/PG演练先读脚本，只在明确独立Scratch及权限/路径替身审查通过后执行。缺联合负例时第二阶段新增针对J01–J10接缝的实质测试，不写仅镜像实现的断言。

根据最后差异决定全量范围；发布控制链变化默认至少保全一次最终组合完整单测。采用原 `npm run test:unit` 或其同文件范围串行Node等价命令，保留完整覆盖、原超时和断言；`npm test`会先构建，不作为默认入口。全量异常保留原日志/精确测试名/被测SHA，定向收口不能反写原全量全绿。修复后只复验相关及依赖闭包，不无理由反复跑重型全量。

`npm run lint`、`npm run check:backend-boundary`、`git diff --check`及隔离 `npm run build` 均记录真实退出码。构建前检查3000当前监听和命令/cwd，证明其不监听本worktree/dist；不触碰正式runtime或生产准备源。隔离构建不自动成为不可变候选，最终候选需原完整打包/硬链接/重解析点/guard/receipt验证。

## 非作者复审

第二阶段可使用非作者子智能体复审最终组合；审查者仅新增自己的测试/报告，不改实现。若D修复了实现，该部分必须交其他非作者复审，并重新绑定最后修改的文件SHA。复审须覆盖原发现的精确触发、最终负例和实际runtime闭包，不能只读成功日志。源码/工具闭包变化后旧复审不得自动继承；保留每次首次失败和后续复验。

## 前后比较与计时

比较对象：同一冻结业务源码、同一制品字节、同一锁文件/宿主/配置、同一数据规模和验收范围，仅替换经审查的编排/传输机制。因工具变更导致的完整源树SHA差异显式列出，不能谎称两套工具源码完全相同。若构建身份变化无法复用同制品，独立列样本，不将差值归为机制节省。

优先用真实隔离原控制链、子进程、原打包验证和私有PG执行；简化HTTP child少重启一个进程只作为机制样本。至少串行交替前/后顺序并记录冷热缓存和异常；范围不一致、并发争用或退出/清理未闭合样本不能用于有效比较，也不删除失败。完整生产数据规模、正式鉴权和自然负载未覆盖时明确标注，隔离小库不证明生产达到30～60/80～120分钟。

| 字段 | 测量边界与关系 |
| --- | --- |
| approvedToAcceptance | 实际人类精确批准时间→全部必要验收/最终状态门禁闭合；协调和续接不重置起点 |
| approvedToDelivery | 同一批准→独立复审、文档、Git提交/合并/推送及证据保全完整交付；单独记录晚于batch completed的工作 |
| queue | 其他批次等待、互斥阻断、人工续接间隔；保留原因，不假称自动后台队列 |
| prepare / admission / backup / restore / drain / switch / acceptance / closeout | 每段起止、原duration、真实结果；批准前准备单列，批准后复验仍计总等待 |
| engine / validation / adapter / attempt / admissionStage | 都是父区间子项或并行重叠；以时间区间并集拆账，不再加一次 |
| failure / reconcile / resume | 首次失败、未知、独立协调及续接原事件和等待完整保留；未知归因不猜测 |
| unavailableObservation | 同一客户端/入口/请求期限/采样间隔，失败样本区间与相邻成功边界、未覆盖间隙；响应正文不保存，switchSpan不能冒充停服 |

报告执行覆盖区间并集和墙钟残差；残差可能含未打点工作/等待/协调，不能一概叫空闲。不同批准区间重叠不能累加成全天停服，各项数据库/Worker-only/检查/误报节省存在重叠，不相加作承诺。

当前只引用历史边界：客服新批准到批次142.578分钟，吉客云277.259分钟含排队145.113分钟，四项交互186.395分钟到批次；完整交付另有结束回执。三批启动主体约3.7～4.2分钟，不能把协调跨度全归EOF；这些不同负载/范围样本不是此次前后对照。本阶段新增实测耗时为**无**，只有文档/文件取证检查，性能预算待验证。
