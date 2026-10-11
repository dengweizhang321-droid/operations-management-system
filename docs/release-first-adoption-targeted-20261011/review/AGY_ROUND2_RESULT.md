### 一、审查立场与事实纠正基准

1. **立场与权限重申**：独立审查者严格保持零工具调用、零文件/磁盘访问、零测试与生产授权；模型无任何 Git/生产批准权。本审查只审阅提示中提供的三模块补丁与 IG04 guard 源代码。
2. **已纠正的首轮事实（保留分歧并更新技术基准）**：
   - **Retention Planner 的消费链有效性**：已确认同目录 `release-payload-retention.mjs` 会导入 rotation/verifier，并在 `planReleaseRetention` 内部真实调用 `resolveEffectiveReleaseChain({verifyInstalledHead: true})` 与 `verifyWorkerRelease({processPolicy: 'stopped-or-exact-release'})`，且在结束前再次执行 `resolve`。因此，新 Django 安装目录下的无参数 planner 确实消费了新 Worker 的 manifest 并解析了 `sourceBinding` 历史链。它能够证明只读规划层面的解析兼容，但不等同于真实执行清理删除，也不证明运行中的跨进程业务通信。
   - **容量断言条件**：已纠正容量门限判定，确认为 `free < required` 时拒绝（即允许 `free >= required`，其中 `required = dump * 32 + 2GB`）。
   - **备份端口连接**：已纠正物理事实，发布前 `backup-pre` 必须连接生产 5432 端口以拉取全量转储，原“生产零写入/未改 service”不涵盖“备份读取 5432 零连接”。
   - **Sealer 纠正**：确认旧 65fc sealer 误传 `-Json` 与缺失 12 位十六进制 ID 已被废止，新 sealer 改为不传 `-Json` 并传递固定 12 位 ID / 55433 / E，原 PowerShell 脚本 AST 保持零修改。

---

### 二、源码漏洞与逻辑缺陷（P1 / P2）

#### P1 级别（阻断执行或破坏安全断言的致命缺陷）

1. **`release-batch.mjs` 中 `workerRuntimeRoot` 未定义引用（运行时 ReferenceError）**
   - **位置**：`tools/release-batch.mjs` -> `runTargetedRecoveryConsumer`
   - **缺陷**：
     ```javascript
     ||item.path!==path.join(workerRuntimeRoot,'releases',item.releaseId,item.name)
     ```
     在 `tools/release-batch.mjs` 模块中，`workerRuntimeRoot` 既未在本文件顶部声明为常量，也未从 `./release-impact.mjs` 或 `./worker-local-release-rotation.mjs` 中 import。当执行到此处时，将直接抛出 `ReferenceError: workerRuntimeRoot is not defined`，导致已安装消费者验证在首个 target 比对时直接崩溃。
   - **纠正**：必须显式导入或从受控配置中统一定义 `workerRuntimeRoot`，并确保路径大小写规范化后再进行比对。

2. **IG04 进程分类器中大小写敏感导致前缀绕过（Case-sensitivity Escape）**
   - **位置**：IG04 `inspectProcessReference(p)`
   - **缺陷**：
     ```javascript
     let physical;
     try {physical=(await realpath(path.win32.normalize(p.ExecutablePath))).replace(/^\\\\\?\\(?=[A-Za-z]:\\)/,'').toLowerCase();}
     catch {return unknown('executable-identity-unreadable');}
     if(atOrBelow(physical,target))return {kind:'process',processId:pid};
     ```
     `physical` 经过了 `.toLowerCase()` 转换为全小写，且 `managedRoots` 均为小写。然而，若外部传入的 `target` 变量包含大写盘符（如 Windows 标准的 `D:\...`），由于 JavaScript 原生 `String.prototype.startsWith` 是大小写敏感的，`atOrBelow(physical, target)` 将恒为 `false`。这会导致直接运行在目标根目录下的进程逃逸前缀匹配！
   - **纠正**：在调用 `atOrBelow(physical, target)` 之前，必须对 `target` 强制执行 `.toLowerCase()` 规范化。

3. **`runApprovedOperation` 中 `backup` 作用域及收据结构不匹配**
   - **位置**：`tools/release-batch.mjs` 行 535（+613）
   - **缺陷**：
     ```javascript
     if(batch.version===targetedBatchVersion&&(typeof receipt.backupId!=='string'||receipt.backupId!==backup.backupId))throw new Error('Targeted restore backup identity changed');
     ```
     - 变量作用域缺失：当前执行分支为 `op.kind === 'restore'`，若当前局部上下文未显式绑定对应备份操作的输出或对象引用，直接访问 `backup.backupId` 会引发 `ReferenceError`。
     - 契约结构不匹配：原 `django-postgres-maintenance.ps1` 的 `Invoke-MaintenanceRestoreRehearsal` 明确**保持原脚本不修改**，其原生的 `rehearsal-result.json` 顶级字段中根本不包含 `backupId`（原生只接受并记录 `RehearsalId`、`ApprovedManifestSha256`、`BackupDirectory` 等）。强制校验 `typeof receipt.backupId !== 'string'` 会导致演练即便物理恢复成功，也会在批次收件校验时被无条件拒绝。
   - **纠正**：统一收据中备份标识的传递协议；若原生维护脚本不输出 `backupId`，应校验批次执行器记录的母收据，或校验 manifest 中的固定标识，而非对不可变原脚本强加不存在的字段要求。

4. **`runTargetedRecoveryConsumer` 中 `deployment.json` 文件摘要与候选摘要混淆**
   - **位置**：`tools/release-batch.mjs`
   - **缺陷**：
     ```javascript
     if(await safeFileDigest(path.join(installedRecoveryTools,'../deployment.json'))!==batch.binding.djangoCandidateSha256)throw new Error('Installed recovery consumer Django identity changed');
     ```
     `batch.binding.djangoCandidateSha256` 代表整个 Django 候选产物（2933 文件的完整镜像/压缩包）的绑定哈希。而 `path.join(installedRecoveryTools, '../deployment.json')` 是部署到现场的应用描述文件。对 `deployment.json` 单个文件计算 `safeFileDigest`，其值必然不等于整个候选包的哈希；且若 `deployment.json` 包含部署时间戳等元数据，其哈希每次构建均不相同。
   - **纠正**：应读取并解析 `deployment.json` 的内部字段（如 `candidateSha256` 或预埋指纹），或比对已部署文件的清单哈希，而非将单个描述文件的字节哈希直接等同于候选整体哈希。

---

#### P2 级别（设计偏离与边界鲁棒性缺陷）

1. **`collectBatchAdmission` 中字段命名与对象约束的不一致**
   - **位置**：`tools/release-batch-admission.mjs` 行 169
   - **缺陷**：
     ```javascript
     if(batch.version===targetedBatchVersion&&['recovery-consumer','restore'].includes(step)&&!djangoSwitched)throw new Error('Targeted recovery requires the confirmed newly installed Django');
     ```
     在 `validateTargetedOperations` 中，`consumer` 的键被严格限制为 `['id','phase','kind','mutating','covers']`，根本不允许出现 `step` 键（其分类标识为 `kind: 'recovery-consumer'`）。若准入收集逻辑传入的是操作的 `step` 字段，则对于消费步骤将传入 `undefined`，导致该准入阻断失效。
   - **纠正**：统一判断条件为 `['recovery-consumer', 'restore'].includes(op.kind || op.step)`。

2. **`validateTargetedOperations` 生命周期步骤白名单与 19 步终案的边界冲突**
   - **位置**：`tools/release-batch.mjs`
   - **缺陷**：
     ```javascript
     ||ops.some(o=>o.kind==='lifecycle'&&!['EnterMaintenance','StopWorker','HardenAcl','ExitMaintenance','StartWorker','VerifyStartup','AggregateStatus'].includes(o.step)))throw new Error('Targeted scope contains additional write/lifecycle operations');
     ```
     在终案声明的 19 步中，包含 `VerifyStartup closeout`、`natural-watchdog` 等收尾与观测阶段。若这些收尾步骤在批次清单中将 `kind` 设为 `lifecycle` 且保留其具名 `step`，将直接触发该白名单抛错。
   - **纠正**：明确各收尾步骤的 `kind` 分类（如收敛至 `acceptance` 或 `closeout`），或将白名单扩充涵盖合法的终案收尾步骤。

3. **`validateOperation` 假借 `restore-pre` 绕过阶段校验的隐患**
   - **位置**：`tools/release-batch.mjs`
   - **缺陷**：
     ```javascript
     validateOperation({...restore,phase:'restore-pre'});
     ```
     通过浅拷贝强行将 `switch` 阶段覆盖为 `restore-pre` 以迎合旧校验函数，说明旧 `validateOperation` 本身并不支持 `switch` 阶段。若批次在其他未修改的生命周期验证点遍历 `batch.operations`，原生的 `restore` 对象仍可能因 `phase === 'switch'` 被意外拦截。
   - **纠正**：在底层操作校验器中显式赋予 v4 批次对 `switch` 阶段合法性的支持，而非通过临时字段置换隐藏分歧。

---

### 三、已接受但需明确披露的残余成本与未测风险

1. **维护期历史大树 I/O 扫描与停机时间不可控风险**：
   - 补丁在应用停机、服务中断的维护窗口内触发 `release-payload-retention.mjs`。该脚本遍历候选发布的 `source-snapshot`、`dist`、`helper`、`node_modules` 并逐层计算 `hashTree`。
   - 该扫描包含大量小文件，且未在生产环境进行配对样本耗时实测。在 NTFS 文件系统上，此 I/O 成本可能占据数分钟甚至更长，团队必须接受该维护窗口延长，严禁在发布计划中承诺“秒级或净分钟内极短切换”。
2. **IG04 窄系统例外导致的生产准入常态化阻塞**：
   - 现场已测得 821 个进程中有 194 个进程命令行不可读（包括 PID 47936 的 PowerShell 进程）。在 IG04 的强安全约束下，解释器无法读取命令行一律判为 `unknown` 并拒绝准入。
   - 这是已知且被接受的物理防御表现：当前生产准入正处于被拦截状态。在此类进程完成系统级审计或合规关闭前，生产环境保持不动；静态封存与构建可独立推进。

---

### 四、生产批准后必要现场验收清单（非批准前强制执行项）

针对“新 Django 消费与 Restore 尚未在生产执行”的现状，应作为**正式批准后的第一优先级现场核验指标**，严禁在批准前违规先行测试：

1. **同次 Backup Receipt 的防替换血缘验证**：
   - 现场核验 `RestoreRehearsal` 执行时，其绑定的 `BackupDirectory` 和 `ApprovedManifestSha256` 确实由本次批次刚完成的 `backup-pre` 产出，严格杜绝读取历史测试目录或缓存备份。
2. **新安装 Tools 目录的逐字节一致性**：
   - 部署完成后，现场提取 `D:\teruisi-runtime\django-sales\app\tools` 下的 `release-payload-retention.mjs`、`worker-local-release.mjs`、`worker-local-release-rotation.mjs`、`d1-retirement-proof.mjs`，核验其 SHA-256 摘要与批次 inventory 完全一致。
3. **隔离恢复端口与生产库物理绝缘性**：
   - 现场验证隔离演练启动在独立端口（55433），且生产数据库（5432）在整个演练期间无新连接建立、无数据写入（`productionDatabaseTouched == false`）。
   - 演练结束后，现场检查隔离数据目录已被安全清理（`isolated_data_removed == true`）。
4. **失败保护与 WAL 保留门禁**：
   - 确认在任何阶段（包括已安装消费者规划验证或演练恢复）触发异常时，维护锁、排空状态、原所有者权限及 WAL 日志严格封存保留，禁止执行静默重试或删除失败步骤。

