# 本次候选兼容适配

2026-11-03。适用现行 G02（`docs/运维/部署与启动/发布门禁执行细则.md` 的合并前发布兼容性验证）、`docs/规范/验证与发布.md` 的“CI门禁不进入发布链路”，以及 AGENTS 的必需代码检查范围。该适配只用于原固定 verifier，不调用生产服务、不进入发布器，不改 CI。

## 精确范围

`candidateCompatibilityProfile()` 新增 `readinessStabilityOnly`，版本 `readiness-stability-v1`。剔除原有 docs/tests/README/AGENTS 后，必须同时具有以下完整13个运行文件及 `tools/verify-release-candidate.mjs`，且不含其他路径：

- `lib/django/backend-readiness.ts`
- `tools/desktop-launcher/Launcher.cs`
- `tools/install-main-prebuild.mjs`
- `tools/operations-system-control.ps1`
- `tools/operations-system-watchdog.ps1`
- `tools/publish-latest-main.mjs`
- `tools/publish-main-status.mjs`
- `tools/publish-main-tail.mjs`
- `tools/publish-prepared-main.mjs`
- `tools/start-local-worker.mjs`
- `tools/publication-readiness.mjs`
- `tools/django-local-service.ps1`
- `tools/manual-maintenance-continuation.mjs`

缺少成员、重命名移出一个未知运行文件、添加其他生命周期/业务/未知工具文件，均不获得此 profile；新增的服务/caller文件仍会落在 unsupported。没有把它们加入全局 supported。原 Pi 恢复、applyTimingReceipt、其他窄资格保持原条件，本次不冒用。

本次 Worker 聚合确有载荷变化，因此新 profile 的 `worker=true`；Django原已复制 prepared/tail，相关字节也是载荷，本次 `django=true`。Django控制器另做 `compareReadinessDjangoCopyOnly`：规范化 BOM/CRLF 后只允许在 prepared复制行后增加一个 `publication-readiness.mjs`复制行，其他所有内容逐字一致；删除、重复、位置错误或其他行为变化均拒绝。该比较不授予其他生命周期免验。

新增 `compareReadinessMaintenancePairOnly`：相对冻结基线只允许增加固定 `readinessCopyControllerPair`声明，以及在原 `assertMaintenanceControllerGeneration` 的原有相等判断后增加一条严格分支。必须同时匹配 Django控制器文件名、原始old SHA、原始new SHA且 `expected===candidateSha`；其他声明、原历史候选表、守卫、停止路由和控制逻辑逐字不变。不会把新SHA添加到泛候选表。

精确pair为 `af6b3b4242f0863296f018d3908ce9d9e93a1d8ec89565e299c7dba16e6e279c` → `c7e02ddbc55e2ff2a3790ef2dd89b76a580ef98ec479b6f40ae471c2af7fa5c0`。主负责人已只读核对已安装Django控制器及e7冻结source均为old SHA；本适配不再次读取runtime。固定verifier仅计算并检查 Git冻结基线与实际候选文件的**raw bytes SHA**分别等于pair声明，在机器报告记 `readinessControllerPair`及 `runtimeObservedByVerifier:false`。

`.gitattributes` 将 Django控制器设为 `-text`，old为5718条CRLF/BOM，candidate为5719条CRLF/BOM，仅增加42 bytes。规范化只用于辨认差异形状，资格摘要始终来自raw bytes；测试也确认把CRLF改成LF后不能匹配candidate资格SHA。当前新增资格只允许这一个已证前驱到候选的包内helper复制变更，不形成通用未知前驱的恢复许可。

## 固定运行命令与证据

主任务统一提交全部文件后，在干净的当前候选 HEAD 运行（输出目录必须尚不存在、位于工作树外；本例 base 是本任务核对时的最新 main，main推进则先重核完整差异）：

```powershell
node tools/verify-release-candidate.mjs --base e7aaf6c16939770d0941994873747fe301ef0b93 --out D:/codex-artifacts/readiness-stability-20261103/candidate-<unique> --dependencies D:/运营管理系统/node_modules
```

原工具仍绑定完整候选 commit/tree、全部载荷SHA、工具/依赖/模块树与环境摘要，在独立干净候选树执行，结束复核未漂移并清理候选。每项检查产生 `<name>.stdout.log` / `<name>.stderr.log`；`REPORT.json` 记录命令、开始/耗时、退出码、原输出SHA和类别。保留这些原始日志及报告；任何失败保留 failed，不能手填通过。原依赖目录仅以 junction只读复用，不安装依赖。首次运行前可先独立执行下面几项新适配自检，不代表原固定 verifier整体通过。

## 本 profile执行的程序检查

| 机器检查名 | 内容 | 报告类别 |
| --- | --- | --- |
| `readiness-profile` | 完整有限集合、缺失/额外/rename拒绝、Django单行复制和maintenance pair/原guard严格比较、原guard精确pair正例及wrong name/old/new/expected负例、实际raw SHA绑定 | isolated-functions |
| `readiness-entry-closures` | 修改MJS语法、目标TypeScript、固定control包相对模块闭包、Django必需静态导入闭包、冻结source全部literal相对导入闭包、immutable Worker观察入口 | package-integrity（仅这些程序/闭包证据） |
| `readiness-aggregate` | 13项聚合期限、并发、端点、取消、body/16KiB/redirect及脱敏既有/新增检查，精确名称过滤 | isolated-functions |
| `readiness-direct-callers` | 原Worker/总控38项模拟程序边界，保持重启/调度门槛 | isolated-functions |
| `readiness-observations` | publication helper受控响应/时钟、总预算/父期限/分类/清理 | isolated-functions |
| `readiness-publication-entry` | 原4项发布模式、缺准备拒绝及实际隔离Node CLI入口 | native-entry-boundary |
| `readiness-publication-callers` | 精确11项真实父deadline子进程、当前版本单次、tail瞬态恢复/失败不写SUCCESS、单次复用、原锁拒绝及前置失败 | native-entry-boundary（含真实子进程入口和编排替身；不是完整生命周期） |
| `readiness-watchdog-parent` | 48项既有/增量隔离诊断，含control90s/其他60s、snapshot120s与剩余父预算裁剪 | isolated-functions |
| `readiness-ps5-parse` | PS5只解析三处PS入口及BOM，不执行服务代码 | isolated-functions |
| `readiness-launcher-entry` | PS7解析/BOM、TEMP中真实C#编译及原假控制器/参数/receipt/deadline/cancel测试 | native-entry-boundary |
| `actual-django-package` | 复用原 `release-candidate-package.test.ps1`，私有实际Prepare/Deploy/hash/ACL/local R2闭包，原生产进程/schema准入被替换 | package-integrity；不是正式制品或冷启动 |

不运行原通用publication/queue全套、Pi恢复、迁移/数据库业务、全仓测试或额外业务验收。未改这些原profile的适用范围。此profile把必要检查留在同一机器报告中；不新建从手填摘要复用任意历史结果的通道，旧有效检查材料只按原工具已有精确绑定资格复用。源码再变只补受影响检查，正式main制品仍在合并授权后生成，不能把本检查的私有包视作正式制品。

`packageIntegrity` / `nativeEntryBoundary` 仅按已实际成功执行的原类别汇总，`nativeColdStart=false`；冷启动说明明确只有预算、观察、复制/导入、精确既有控制器代际准入和隔离入口证据。没有执行完整原生Start/Stop，不据此声称生产已ready或实际采用。

## Django导入范围与既有Pi断言

正常发布仍是固定control的 `runPublisher` 启动冻结 `source/tools/publish-main.mjs`，由其相对导入 prepared，再由prepared导入tail/helper。给Django复制列表增加helper仅保持新**必需静态**导入闭包，不创建Django内发布入口、恢复权限或采用授权。

原 `tests/pi-main-resume-profile.test.mjs:23` “installed publisher direct import closure”会递归所有literal `import()`，包括tail里可选诊断 `import('./publish-latest-main.mjs')`。只读对基线 `e7aaf6c1` 使用原算法已复现：`prepared → tail → publish-latest-main`，Django原复制表缺latest；本次加helper后原断言仍在此处失败。这是基线已有的Pi专用动态闭包断言，不是新helper缺失。tail现有try/catch及注释明确该导入用于apply timing诊断，失败不改变发布结果。

依主任务明确决定，旧Pi测试保持原样；新profile不调用它，不额外复制latest及其所有依赖。新入口检查仍完整检查冻结source与固定control的literal相对闭包；Django检查全部必需静态导入并确认helper存在。该处理只限定本次检查范围，不宣称旧Pi动态闭包断言已通过，也不追改历史资格。

## 本次适配自检结果

- 新profile/Django单行比较及maintenance pair/guard/raw绑定5项通过；原通用selection/weekly有限profile2项此前通过且其逻辑未变。新增guard反例使用未知、不在旧资格中的SHA；原有“installed与expected相同”和历史已登记候选规则仍原样保持，不把本次负例声称为删除那些原许可。
- 新entry程序/闭包5项通过，包括目标TS无诊断、所有修改MJS语法和三种真实入口闭包。
- 精确publication caller 11项通过，未运行其余schema/Pi/业务测试。
- 新PS入口脚本在PS7完成解析/编译/既有桌面隔离测试，在PS5 `-ParseOnly`完成解析/BOM；两者通过，无服务、安装器或HTTP调用。
- 纯profile计算为 `readinessStabilityOnly=true`、`unsupported=[]`、`worker/django=true`；实际基线与候选Django单行比较为true。`git diff --check`通过。

固定 verifier整体须待主任务统一提交、冻结干净候选后执行并读取其真实REPORT；本报告不预写整体passed。本次适配者未暂存/提交文件，未改CI、发布执行入口或正式环境。

## 主负责人最终执行结果

上节为适配完成时状态，现已完成原固定入口运行。目标提交`d4ad90b4c6049026f87809ec87cb4bbef3939b44`、tree`af8c4229f5e5a3bd63f16255fa9d0f30682462ec`，基线仍e7。北京时间22:52:19开始、22:55:26完成。

- 原生`REPORT.json`：`D:/codex-artifacts/readiness-stability-20261103/candidate-d4ad90b4-localpwsh/REPORT.json`，SHA=`f65debafaf77fdf05b1f93b6219bf36436e7c063a092dc1cb0bdb7bb3dabf0ca`。
- 状态passed；上表11组检查全部exit0，packageIntegrity=true、nativeEntryBoundary=true、nativeColdStart=false；candidateWorktreeRemoved=true。
- 每项原始stdout/stderr及SHA留在同目录。未生成可上线生产制品，未启动生产服务或运行生产健康/业务检查。
- 先前一次调用因输出父目录未建在入口前失败；建父目录后发现本机where首先解析到Windows Store的pwsh别名，读程序摘要EACCES，未运行任何检查，原failed报告保留在`candidate-d4ad90b4/REPORT.json`。
- 成功调用仅对该命令临时在PATH前置现有实际PS7目录`C:/Users/86137/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell`，并显式传`--python D:/teruisi-runtime/django-sales/venv/Scripts/python.exe`；finally恢复进程PATH，没有改系统环境、固定发布配置或已安装工具。原生报告记录实际工具与模块字节摘要。

源码与测试检查完成后，最终交付追加仅文档记录；这些记录不改写机器报告的原提交/tree，也不把结果追绑成另一份程序。原有纯代码检查与同字节证据按规范复用。
