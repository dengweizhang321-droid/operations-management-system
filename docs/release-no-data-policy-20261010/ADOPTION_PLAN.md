# 首次采用精确准备与批准边界

2026-10-10。状态为 **源码/完整构建载荷已准备；正式生产封存受原active9f79阻断**。本文件是可审查的准备范围，不是生产批准，不调用原旧范围协调，也不是可直接执行的正式Worker manifest。

## 精确来源和制品

| 项 | 固定值 |
| --- | --- |
| 开发基线 | origin/main `cb007f05152bccaf884e60b8cdeaad0c2077557d` |
| 实际前驱Worker | `20261010T014638Z-97833d2f2b7e7bc9` |
| 前驱manifest | `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113` |
| 前驱完整源 | 5157文件，`92c2656c064c6a202239f4f010f0d241e90ae19fb35638cd328727a7ac64973c` |
| Django当前manifest | `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9` |
| 九模块准备源 | `D:/codex-isolated/release-no-data-policy-20261010/adoption-source-v2` |
| 最终源 | 5160文件，`37fea79ac440245de9e13153bffbb63b2ea8e5d9c50218cef93609725681dfd5` |
| 完整源库存SHA | `53d3c84be3361c961cadb91d9f4d801e4d18abf82788d8c1603c0e81f3311b56` |
| 冻结载荷 | `D:/codex-isolated/release-no-data-policy-20261010/bootstrap-payload-v2-final` |
| prepared-payload-manifest原字节SHA | `7459951bfa30d080d91f2cb09a4fdac44f2e71683ec3051c0e9d82761a45d092` |
| 正式rotation plan / engine batch | null / null；不得把下方私有演示batch当生产计划 |

载荷以create-only复制，包含完整source-snapshot、dist、node_modules、原helper及其资源、原bundled入口；完整树与原构建输入逐字节一致，侧文件钉住manifest。九文件最终完整复验原记录为 `nine-file-payload-verification.json`，此前七文件复验独立保留。**它不是原引擎生产安装/ACL/guard/retirement/fence或prepared-build receipt，不能作为任意dist绕过原准备。** 实际生产准备必须由原已采用工具产生这些收据并校验全部物理来源。

只相对实际AB改变九个运行源码文件，不带入新main的业务/依赖/配置功能。旧七文件 `7c01ec67…` 载荷/源保留为被替代证据，不能作为最终采用范围：

| 文件 | SHA-256 |
| --- | --- |
| tools/release-impact.mjs | dd0fdafa3f464d7af253fcb475796feaefe8905b16af91eb805b66566867db26 |
| tools/release-batch.mjs | 5d157bdc5916fe440646e5951eab9b2e0daac7d73d6525888b86e31d86f7e9d2 |
| tools/release-batch-admission.mjs | eea31c0cfa8dfcdb9d689fc2ed1c8b72f555a92d60da5be2198a5b55f8658fe1 |
| tools/release-no-data-observation.mjs | 5dbeff46465554b038dcbc2c70aba3b4f618ffa6eb787ecfdcae0c3a8f4e50bc |
| tools/worker-local-release.mjs | 756b745f48f8f365d92834648bf0025981aabfc291f97a7eef0c5a114b45e456 |
| tools/release-preparation-evidence.mjs | 6dd3c327b0b886e4484a3651d74393119d1e855e31e38d4d01ea3d47428897b5 |
| tools/release-admission-timing.mjs | 7b14e75d7d7b6cbf726d2199330a1e99366e202d5c36becb99287ae9b3060e66 |
| tools/worker-local-service.ps1 | 717408ad7b7880617967b5e230ea110c15c58b887532d02bef8eb42236f7bc1e |
| tools/release-lifecycle-step.ps1 | c63e8fbaa5b02a13589538ab03468d07511b27a1dec44279a893d29c8467dbce |

preparation-evidence与admission-timing属于标准in-process collector必要的既有C依赖，AB尚无这些文件；service/lifecycle两脚本关闭隐式后端和接收器启动缺口。完整相关回归纳入137项，完整运行依赖仍在制品盘点中，九文件不等于整个runtime只有九文件。

## 首次采用保护及验收

规则/基础设施自身不能依据未采用的 `not-required` 为自身减免，采用策略为 **原已采用引擎strict/full**，封存前/后两Backup和两RestoreRehearsal，原保留、归档、角色/目录/迁移/序列和隔离清理契约保持。原应用维护/排空/切换/启动及失败保持规则不重写。没有业务后端源码差异，不随本任务部署新Django应用；若原严格生命周期需要停启既有应用，按原能力明确进入批准范围，PostgreSQL是否保持由原维护记录决定，不伪称仅静态文件直换。

批准前已有：核心/旧协议负例、真实全源功能示例、完整采用源构建/helper/领域边界、Astra及真实AGY复审、字节冻结和应用回退来源。批准后仍必须：原锁/owner、实际前驱、完整源码/工具/依赖/配置/制品/ACL与精确进程的现场复验；排空、原切换、精确资源与新入口拒绝路径、真实权限拒绝、全部已启用组件/启动绑定、自然守护和全部收尾。不能将其隐藏到后台。

以后合格Worker-only批次的Start适配器强制 `BackendStartPolicy RequireReady`；NotReady先失败、既有接收器保持，不偷偷执行Django Start/迁移/权限复位或AutoStartDingTalk。普通首次严格/full Start没有ExpectedDrainId，仍按原路径恢复已配置后端/接收器；该既有自动启动及其真实渠道效果也必须列入最终明确批准范围，不把此次开发授权当其生产授权。

具体首次生产验收脚本、原备份/恢复receipt引用、maintenance owner、typed Worker manifest及最终engine批次SHA待原owner闭合后由原准备/现场证据确定；当前不可预写一个虚假的可执行scope。全业务自然变化不默认要求全库前后相等，但不能借本任务删去旧9f79已批准比较步骤。新首次范围应按实际数据/目录/权限和影响确定相称验收，并独立复审，不对白名单或未知差异自动放行。

## 回退和具体阻断

应用回退来源为精确原AB源、Worker/helper完整包与Django237fbe0d；九文件变化反向准备兼容应用后走原受控rotation/new successor和新明确批准，不直接覆盖运行包/删successor或WAL。新规则没有数据库迁移，代码回退不等于DB恢复；任何真实数据恢复须指定仍有效的精确点另批。失败留维护/排空门和unknown，独立原scope协调，禁止自动重放Start/apply/Backup。

原 `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15` 持有 `integration-ab-v2-20261010-c22d8dd69a`，第19步仍unknown。解除条件只能是原执行者按其原批准/另审范围闭合；本任务不接管、换绑、协调、取消、删除active/gates或重放。它闭合后须重新解析实际前驱，若来源/制品/批准基础改变，重新准备并复审，不能把这里快照当可自动复用的新资格。

本次无生产维护、启停/切换、调度修改、新生产Backup/Restore、业务写入或真实外发。当前尚不存在可确认的完整生产切换SHA，因此不提前请求一个模糊“批准上线”。
