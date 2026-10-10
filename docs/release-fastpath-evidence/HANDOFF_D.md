# 给集成任务 D 的精确接口

当前最终代码提交 `2b10f602`：C实现 `bfb058ca`，有界IO `f11db8a1`，配置监听收口 `ab375587`，B合入与接缝修复 `dcd71adf`/`baf8eb0`，最终A合入 `2b10f602`（包含A `5fb35182`、B `c9586ab8`）。最终推送主线SHA在DELIVERY中核验，不能用主检出旧main当最新基线。

1. impact policy与batch都是v2，旧批准不换绑；恢复证据字段仍v1，现行26小时/7天/连续日备份和现场条件没有放宽。
2. 新collector可加 `transport:'in-process-content-evidence-v1'`，executable为本次Node精确路径，args严格为 `[本次tools/release-batch-admission.mjs,'collect',本次batch文件,本次tests文件]`；cwd若声明须等于执行cwd。默认旧subprocess不获得内存复用。该新transport须在整批批准内，不自动认领其他adapter。
3. collector.files完整pin Node与 `release-batch, release-batch-admission, release-impact, release-preparation-evidence, release-admission-timing, release-daily-backup, release-readonly-retry, worker-local-release, worker-local-release-rotation, d1-retirement-proof, collect-d1-retirement-proof` 及TypeScript的lib/typescript.js与package.json；按A要求另pin实际helper/控制入口闭包。不得用旧工具文件SHA。
4. `collectBatchAdmission(batch,testsPath,phase,{session,step,onStatusAttempt})` 合并B接口。in-process也create-only保存状态尝试，返回 `admissionStages` 和B的 `statusObservation`；失败将受限计时挂error后写原journal，保留B错误/attempts和A processEvidence。子记录不改latest/WAL，也不重复加进总时。
5. session只复用准备身份派生计算；每轮完整内容重读/原动态进程门禁，原artifact admission/drain/closeout及apply边界完整。A的reserved deadline用其原 `preparationEnvironmentSha256` 排除，其他env全部绑定。C不替A/B实现第二套期限、重试或生命周期。
6. v2 `databaseOperations:{required,operationIds}` 在封存时确定。Worker-only四步typed/唯一/正确phase与同maintenanceId；Start遵守A精确两端manifest及ExpectedDrainId，command.files含同目录process-deadline.ps1。任何排空/解除/未知失败保持原门禁与不重放。

已完成：完整源/真实四文件、API/写/权限/依赖/混合拒绝、恢复资格变更、WAL未知不重放、真假步骤、字节/同mtime、并发/中断、真正源变化与配置父目录/无关兄弟事件、PS5/7和最终A/B/C206项联合回归。测试范围与原失败见REPORT。

仍需D定量：原完整release的collector分项；原Django/PostgreSQL/Worker同制品完整镜像切换；最终组合净收益与源读取/身份重叠去重。普通Node私有进程样本没有证实3～6分钟；身份三阶段只省21.6～24.2秒，没有证实10～20分钟。不得从小样本推生产SLA。

采用阻断：日备份e仍PAUSED；每个最新日点的完整演练与最新失败/未知的可信结果覆盖尚须验证/必要修复。无前置资格不得生成减免四项数据库操作的批次。机制自身首次采用严格；本任务未授权/执行生产。
