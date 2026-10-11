### 一、审查立场与权限声明

作为 Antigravity 独立审查者，本审查遵循以下刚性边界：
1. **零权限与零执行**：模型无任何 Git 提交/合并、发布部署或生产切换批准权；不访问外部环境与磁盘工具，不运行任何脚本，仅依据本提示上下文进行逻辑与工程边界推演。
2. **职责定位**：本意见仅指出 Astra 设计方案中的缺口与潜在风险反例；实际方案落地由 Astra 负责，最终结论与现场判定须由主代理与操作人员现场核验。
3. **词汇与证据戒律**：不使用“完备”、“绝对安全”等绝对化词汇，不编造任何哈希摘要或伪代码，所有论证基于已知系统调用机制与运行事实。

---

### 二、最小设计范围评估与过度/遗漏切面

Astra 提出的 `teruisi-release-batch-v4`（单轮 `targeted-first-adoption` 策略）在限定范围上保留了原 10 个运行文件的修改约束，并将旧 `v2/v3` 语义进行隔离，这是合理的收敛。但在最小设计边界上存在以下失衡与遗漏：

1. **额外只读 Retention 步骤引入的停机窗口与 I/O 成本失衡**：
   - Astra 在发布主事务链（维护停机窗口内）插入了调用 [`release-payload-retention.mjs`](file:///D:/.codex/worktrees/34b4/运营管理系统/release-payload-retention.mjs) 的无参数只读入口 [`planReleaseRetention`](file:///D:/.codex/worktrees/34b4/运营管理系统/release-payload-retention.mjs)。
   - **成本缺口**：[`planReleaseRetention`](file:///D:/.codex/worktrees/34b4/运营管理系统/release-payload-retention.mjs) 的实现会遍历历史候选发布的 `source-snapshot`、`dist`、`helper`、`node_modules` 等目录，并对数十万小文件逐一调用 `hashTree`。在生产环境 Windows (NTFS) 上，此只读操作会带来剧烈磁盘 I/O 抖动与数分钟以上的停机延迟。在未经过生产配对样本测试的情况下，在关键维护期直接执行全量历史大树扫描，极易引发维护窗口超时。
2. **核心诉求与验证对象的错位**：
   - 核心风险定义为：*“新源码 Binding 字段让旧 D verifier/rotation 消费者不兼容新 W”*。
   - 然而 Astra 增加的只读 Retention 步骤仅验证了 *Retention Planner* 本身对 manifest 和文件树的静态检查，**并未实际调用 Worker 的 rotation 逻辑，也未验证 Django 对新 Worker 产生的产物的读取能力**。因此，该步骤付出了大树扫描成本，却并未直接覆盖核心风险点。

---

### 三、必要消费覆盖的真实缺口与运行假象

1. **只读 Planner 无法等同于消费者执行覆盖（Plan-only 假象）**：
   - [`planReleaseRetention`](file:///D:/.codex/worktrees/34b4/运营管理系统/release-payload-retention.mjs) 仅返回计划结构（`targets`、`retainedKeys` 等），显式排除了 `--execute` 且不执行删除操作。
   - 该执行仅能证明当前进程上下文能以只读方式解析并匹配现有 JSON 与文件哈希，不能证明真正的清理消费者、锁争用处理、权限剥夺或异常回滚路径能够正常工作。
2. **停机态静态检查掩盖了运行时消费缺陷**：
   - 按照 Astra 规划的顺序：`Worker apply → Django DeployApp → HardenAcl → 新 installed 只读验证`。此时 Worker 处于停止状态（满足 `verifyWorkerRelease` 中的 `processPolicy: "stopped-or-exact-release"`）。
   - 这种静态只读验证无法反映新旧 Binding 字段在 Worker 真正拉起、监听及与 Django 跨域并发通信时的序列化/反序列化行为。
3. **缺少对“新 D 消费新 W”这一跨组件链路的显式消费验证**：
   - 隔离演练仅涵盖 PostgreSQL 数据库恢复（由 Django 侧的 [`Invoke-MaintenanceRestoreRehearsal`](file:///D:/.codex/worktrees/34b4/运营管理系统/django-postgres-maintenance.ps1#L1687) 驱动），Worker 侧仅运行了 retention planner。两个组件各自为战，缺少一层针对“新已安装 Django 运维客户端消费新 Worker 输出”的轻量无害验证。

---

### 四、新旧同点软件兼容可能 Gap（恢复与备份版本不对称）

Astra 方案为：发布前由旧工具创建 `backup-pre`，发布后在新安装的 Django 环境下执行 `RestoreRehearsal`。这一不对称调用存在以下工程缝隙：

1. **动态 Backup Receipt 与静态 Batch 签名的编排断层**：
   - 在严格批次协议中，批次准入通常依赖预先计算好的步骤参数和散列证据。
   - `backup-pre` 是在本次批次运行中即时生成的，其产出的 `BackupDirectory` 与 `ApprovedManifestSha256` 在批次执行前属于未知量。
   - 如果批次引擎允许动态将 `backup-pre` 的输出作为参数注入后续的 `RestoreRehearsal`，则必须有强约束防止中间态参数被替换；若批次协议不支持动态收据绑定，则可能迫使实现退化为占位符或宽容检查，从而削弱门禁防护。
2. **新工具对旧备份 Manifest 的解析契约一致性**：
   - [`Invoke-MaintenanceRestoreRehearsal`](file:///D:/.codex/worktrees/34b4/运营管理系统/django-postgres-maintenance.ps1#L1687) 调用新安装的 [`Assert-MaintenanceRuntimeContext`](file:///D:/.codex/worktrees/34b4/运营管理系统/django-postgres-maintenance.ps1#L260) 并解析旧备份的 manifest（如 `$noKeys`、`version` 校验）。
   - 虽然业务与 PG 操作器未变，但新部署应用若微调了内部工具路径定位逻辑（如取消 prepared 支持后对 `$InstalledAppRoot` 的硬断言），或者对备份归档中的元数据字段校验更为严格，可能导致新安装的恢复脚本直接拒绝旧工具生成的合法备份归档。
3. **端口与进程残留排查的时序缝隙**：
   - [`Invoke-MaintenanceRestoreRehearsal`](file:///D:/.codex/worktrees/34b4/运营管理系统/django-postgres-maintenance.ps1#L1687) 要求 `RehearsalPort` 无监听进程，且要求清理旧恢复目录。
   - 在单轮快速切换场景中，如果前置步骤（如应用停止或旧工具探测）存在未完全释放的临时套接字或延迟句柄，隔离演练会直接抛出异常中断发布，且按契约将“保留维护状态与原 WAL”，导致发布直接卡在维护期。

---

### 五、现场必须核验的硬性要素清单

现场主代理核验与审批时，须逐项核验下列客观物理事实，严禁依据布尔标记或人工口头声明放行：

1. **当前基线与不可变只读 Head**：
   - 核验当前只读 head 处于 `Wf4e537/D237fbe`、release chain 处于 `219/aaf`、AB WAL 处于 `109/5289`，且无任何残留 active 进程。
   - 核验旧引擎状态（`false/unknown`）已按既定闭合约定处置，现场没有任何未经授权的状态回写。
2. **D85cf 候选复用条件精细核验**：
   - 严禁使用旧的 `166` 签名绑定新源码。
   - 现场必须逐字节对比 Django 的 2 个工具哈希精确等于 `3c18/ec525`，且其原 prepared 整体指纹与现场磁盘文件逐一匹配；任何 1 字节不匹配，必须强制重新构建绑定。
3. **同次 Backup Receipt 的实时血缘绑定**：
   - 现场核验 `RestoreRehearsal` 接收的 `BackupDirectory` 与 `ApprovedManifestSha256`，必须有可靠日志证据证明其来自于**本次维护会话中刚结束的 `backup-pre`**，不得引用历史目录或离线准备的静态备份。
4. **隔离演练的物理安全与资源裕度**：
   - 验证生产数据库（`127.0.0.1:5432`）在演练期间零连接、零数据写入（`productionDatabaseTouched == false`）。
   - 验证演练目录所在磁盘分区剩余空间严格大于 `dump.sizeBytes * 32 + 2GB`，杜绝因演练写满磁盘引发生产故障。
   - 验证演练结束后，临时端口与临时数据目录已完成物理清理（`isolated_data_removed == true`）。
5. **排空与停止凭据（Drain Proof）**：
   - 依照 [`Assert-MaintenanceOperationAdmission`](file:///D:/.codex/worktrees/34b4/运营管理系统/django-postgres-maintenance.ps1#L235)，现场验证 `maintenance.id == drain.id`，`drain.phase == 'requests'`，且 `drainedStopped == true` 与 `keepPostgres == true`，确保演练期间生产业务无流量接入。

---

### 六、重哈希篡改（Rehashed Tampering）危险反例

当系统依赖哈希链与批次清单自校验时，若校验仅关注“清单内容与其内部声明哈希的一致性”，而脱离了“外部不可变前驱与物理 Source”的强制绑定，则可能发生重哈希篡改。以下列举四个具体危险反例：

*   **反例 1：步骤删除与重哈希伪造（Step Pruning & Re-hashing）**
    *   *攻击/故障机制*：执行脚本或人为修改为了跳过耗时数分钟的 `RestoreRehearsal`，直接从 `teruisi-release-batch-v4` 的批次定义中删除了 `isolated_restore` 步骤，随后依据修改后的 JSON 结构重新计算并写入新的 `manifestSha256`。
    *   *绕过表现*：若批次校验器仅检查 `sha256(batchContent) == batch.declaredSha256`，该篡改批次将被判定为“自洽合法”。
    *   *后果*：系统在完全没有演练新工具恢复链的情况下完成上线，单轮保护实质失效。
*   **反例 2：历史备份收据替换与重哈希（Receipt Substitution & Re-hashing）**
    *   *攻击/故障机制*：若本次 `backup-pre` 在执行时因磁盘抖动或锁竞争生成了损坏的 dump，下游自动化逻辑为了“让流程通过”，读取了一个历史测试备份的目录和有效 `manifestSha256` 填入 `RestoreRehearsal` 参数，并重新计算整个批次收据哈希。
    *   *绕过表现*：演练步骤在新端口上使用旧的健康备份成功恢复，校验结果全绿。
    *   *后果*：掩盖了本次真实生产备份已失效的事实。发布继续推进，一旦后续需要回滚，现场将面临无有效备份可用的灾难。
*   **反例 3：Mock 伪造只读 Retention 证据与重哈希（Stubbed Evidence & Re-hashing）**
    *   *攻击/故障机制*：由于 [`planReleaseRetention`](file:///D:/.codex/worktrees/34b4/运营管理系统/release-payload-retention.mjs) 大树扫描耗时过长，调试残留或失控补丁将该调用指向一个返回预置空结果的 stub 脚本，并对批次清单重新哈希以满足哈希自洽。
    *   *绕过表现*：只读计划步骤瞬时返回成功，校验器通过。
    *   *后果*：实际部署环境下的真实 installed 路径解析与依赖完整性完全未被执行，破坏性语法或环境缺失被带入运行期。
*   **反例 4：策略降级与分类回退重哈希（Policy Downgrade via Re-hashing）**
    *   *攻击/故障机制*：将批次策略从 `targeted-first-adoption` 改写为 `reuse` 或 `not-required`，同时将批次中的强制演练门禁字段清除，并同步刷新批次清单哈希。
    *   *绕过表现*：批次被系统当作免演练批次接受，绕过单轮保护约束。
    *   *防范要点*：批次准入必须强制将 `v4` 策略与预先授权的审批前驱绑定，拒绝脱离物理授权依据而仅凭内部重哈希自证合法的任何批次。

