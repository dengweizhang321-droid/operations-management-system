### 一、差异处理与审查意见修正记录（4项 P1 与 3项 P2）

依据提供的完整文件上下文、外部闭包及调用方参数降级逻辑，独立审查者对第二轮提出的 4 项 P1 及 3 项 P2 逐一核验，现做出正式的差异处理与撤回记录：

---

#### 1. 关于 P1 项的核验与撤回

*   **P1-1：`release-batch.mjs` 中 `workerRuntimeRoot` 引用问题**
    *   **上下文事实**：文件前 15 行已显式声明 `import { ..., workerRuntimeRoot, ... } from './worker-local-release.mjs';`。
    *   **处理结论**：**正式撤回**。变量在模块作用域完全可见，前轮因受限于局部 patch 视界产生过度断言。
*   **P1-2：IG04 `inspectProcessReference` 大小写敏感逃逸问题**
    *   **上下文事实**：`target` 在进入检查函数前已执行 `const target=path.resolve(record.source).toLowerCase();`，外部闭包保证了 `target` 与内部规范化的 `physical` 均处于全小写形态。
    *   **处理结论**：**正式撤回**。大小写在物理路径比较时已闭环对称，不存在前缀绕过缺陷。
*   **P1-3：`backup` 作用域与 `backupId` 契约不匹配问题**
    *   **上下文事实**：
        1. 局部变量 `const backup = outputsFor(op.backupOperationId)` 紧邻新条件，局部作用域有效。
        2. 原 PowerShell 脚本虽然不接受命令行入参 `-BackupId`，但在其执行成功生成的 `$result` 对象中原生提取了 `$backup.Manifest.backupId` 并输出为顶级字段 `backupId`；同时 `outputsFor` 也捕获了该字段。
    *   **处理结论**：**正式撤回**。`receipt.backupId !== backup.backupId` 在原脚本输出与批次接收器之间具有完整的契约闭环，不会引发意外拒绝。
*   **P1-4：`deployment.json` 摘要与候选摘要混淆问题**
    *   **上下文事实**：在 TERUISI 规范中，`djangoCandidateSha256` 专指 `deployment.json` 的不可变原始字节 SHA-256（即 `85cf`），而整体 2933 个文件的完整性由独立的 `appFingerprint` 覆盖，且部署前后 `deployment.json` 字节恒定。
    *   **处理结论**：**正式撤回**。该比对完全符合项目既定口径与准备收据契约，前轮以通用包哈希习惯断言专有字段含义属于误判。

---

#### 2. 关于 P2 项的核验与撤回

*   **P2-1：`collectBatchAdmission` 中 `step` 字段缺失问题**
    *   **上下文事实**：调用方在组装观察选项时，显式传入了 `step: op?.step ?? op?.kind`；当 `consumer` 无 `step` 字段时，自动降级为其 `kind`（`'recovery-consumer'`）。
    *   **处理结论**：**正式撤回**。准入判断能够准确捕获消费步骤，前轮未见调用链降级逻辑产生误判。
*   **P2-2：生命周期白名单过度拦截收尾步骤问题**
    *   **上下文事实**：`VerifyStartup closeout` 的底层 step 字段沿用 `'VerifyStartup'`，已在白名单中；`natural-watchdog` 的类别为 `no-data-observation` 而非 `lifecycle`。
    *   **处理结论**：**正式撤回**。底层 AST 与枚举分类未触发白名单越界。
*   **P2-3：`validateOperation` 借用 `restore-pre` 阶段包装问题**
    *   **上下文事实**：公共 phases 数组本身支持 `switch`；此处浅拷贝临时置换 `restore-pre` 是为了在不改动旧断言函数的前提下复用其内部操作校验逻辑，而实际的阶段序和单次执行约束已由 `validateTargetedOperations` 进行了全序锁定。
    *   **处理结论**：**撤回源码漏洞定性，记为已知适配器设计（Shim Pattern）**。该处理在内部自洽且不修改运行期实体，不构成阻断缺陷。

---

### 二、已接受的系统残余成本与运行风险

经过上述纠正后，当前三模块补丁在逻辑自洽性上成立。以下成本和物理限制已由团队接受，无需修改正确代码，但须在后续操作中作为已知现实保持警惕：

1. **维护期历史大树遍历 I/O 成本完全接受**：
   - 在应用停机窗口内，`planReleaseRetention` 对候选发布的 `source-snapshot`、`dist`、`helper`、`node_modules` 进行全量大树遍历与哈希计算。
   - 团队已将操作超时显式放宽至 3,600,000ms（1小时），以容纳历史单次 Restore 曾达 706 秒及 NTFS 小文件遍历的剧烈 I/O 抖动。该成本不作短停承诺，属于已知接受的维护窗口代价。
2. **IG04 进程守卫对未知进程的常态化阻断**：
   - 现场已探明存在 194 个进程由于系统权限或跨会话限制导致 `ExecutablePath` / `CommandLine` 无法读取（包括 PID 47936 的 PowerShell 进程）。
   - 按守卫规则，解释器无命令行一律 fail-closed 返回 `unknown` 并阻止生产准入。
   - **这是设计预期的安全阻断，绝不通过削弱守卫、人工口头免除或模型同意来强行通行**。在生产准入物理条件闭环前，生产环境坚决不动，开发与构建封存正常推进。
3. **数据库无修改的精确边界**：
   - 隔离演练（55433 / E）承诺生产数据库零写入（`productionDatabaseTouched == false`），但发布前备份（`backup-pre`）必须合法连接生产 5432 读取转储。不将“业务未变与未写”泛化为“生产零读/零连接”。

---

### 三、生产批准后必要现场验收清单（非批准前强制执行项）

模型无任何 Git/生产批准权。以下事项属于**正式获得生产与发布范围批准后**，主代理与现场人员必须机械核验的具体验收点：

1. **新 Sealer 参量与 AST 机械核验**：
   - 实际核验新生成批次中的 Sealer 调用已完全移除 `-Json` 参数，传递固定 12 位十六进制 ID、隔离端口 55433 及驱动器盘符 `E`。
   - 对生成的 PowerShell 命令执行静态 AST 语法树比对，确保原 `django-postgres-maintenance.ps1` 及 PG 运维脚本保持逐字节零修改。
2. **新 Worker 的完整重构建与 SourceBinding 绑定**：
   - 确认新 Worker 由最新的 5160 源码（`0b5e0034`）重新执行原 `prepare/build` 流程，严禁套用旧 58cc 构建产物或借用 166 签名。
   - 确认 Django 侧候选仅包含已审查的 2 个运维工具（`3c18/ec525`）及 CF 缓存叶值变动。
3. **同次 Backup Receipt 的端到端血缘贯通**：
   - 在维护执行阶段，现场核验 `RestoreRehearsal` 接收的 `backupId`、`backupDirectory` 与 `ApprovedManifestSha256` 确实由本次同一个批次刚刚执行成功的 `backup-pre` 产出，拒绝任何离线或历史备份替换。
4. **失败保护与维护状态完整性**：
   - 验证在任何步骤（如消费规划或演练恢复）发生异常时，原 WAL、所有者凭据及排空维护状态保持物理锁定，不执行静默清理，不删除失败痕迹。

