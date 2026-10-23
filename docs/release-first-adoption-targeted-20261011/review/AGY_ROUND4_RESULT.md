### 一、审查立场与基准重申

独立审查者继续坚守零工具、零磁盘、零测试执行、零生产变更及零 Git 批准权。前三轮审查的原始技术分歧与修正历史全部保留归档。本轮依据新提交的限定 batch 完整字节（`e0d2e1d3...`）、源码记录 `c279cfb7` 以及上下文比对记录，对最终受限源码进行严格的逐行逻辑核验。

---

### 二、V1 移植缺陷复盘与 V2 词法修复逐行核验

#### 1. V1 缺陷物理根因与假阳性反思
- **缺陷实证**：在 U0 补丁向 limited 基线移植过程中，`backupId` 校验语句被错误置于 `if (op.kind === 'restore')` 词法块外部。这导致非恢复操作或尚未声明 `backup` 局部变量的执行路径直接抛出异常，正向恢复用例真实出现 196/197 失败（1 项核心正向恢复失败）。
- **负例假阳性机制**：8 个负向测试因断言泛化的 `invalid_result` 捕获到了错误位置抛出的异常，从而产生了“测试全绿”的假阳性表象；唯有全链路正向恢复用例揭示了真实的语法与时序错位。该事实证明：**禁止采用 V1 错误包（`0b5e/39ce`，manifest `131c`），历史前三轮对开发态逻辑的认可不能作为放行错误移植包的依据**。

#### 2. V2 修复（`e0d2e1d3...`）逐行核验
在最新受限代码的 `runApprovedOperation` 中，相关逻辑调整如下：

```javascript
  if (op.kind === 'restore') {
    const backup = outputsFor(op.backupOperationId);
    if(batch.version===targetedBatchVersion&&(typeof receipt.backupId!=='string'||receipt.backupId!==backup.backupId))throw new Error('Targeted restore backup identity changed');
    if (receipt.backupManifestSha256 !== backup.manifestSha256 || receipt.dumpSha256 !== backup.dumpSha256
      || receipt.expectedContentSha256 !== backup.contentSha256 || receipt.restoredContentSha256 !== backup.contentSha256) throw new Error('Restore is not the confirmed exact backup or content changed');
  }
```

- **词法作用域自洽**：`backupId` 的强一致校验已被严格闭包在 `if (op.kind === 'restore')` 内部，且严格位于 `const backup = outputsFor(op.backupOperationId);` 赋值之后。局部变量 `backup` 稳定有效，执行上下文与对象属性生命周期完全对齐，消除了 V1 的作用域越界风险。
- **策略精准匹配与旧版本隔离**：断言显式施加于 `batch.version === targetedBatchVersion`。旧版 `v2` / `v3` 批次完全不执行此项检查，老版本语义与回退逻辑未受侵入。
- **同点母收据血缘闭环**：
  - 在 `backup` 执行阶段，`allowed` 数组包含 `backupId`，`outputsFor` 能够从前序通过的备份操作输出中准确提取该标识；
  - 在 `restore` 阶段，通过命令模板参数（`{receipt:...}`）展开目录与 manifest，同时由本断言二次锁死 `receipt.backupId === backup.backupId`，彻底阻断使用外部静态或历史备份伪造恢复成功的可能。
- **失败状态保全（Fail Unknown）**：
  - 发生任何不匹配时抛出致命异常，由最外层 `catch` 捕获并封装 `invalid_result` / `process_timeout`；
  - 变异操作配置为 `cleanup: op.mutating ? 'preserve' : 'direct'`，当 restore 判定失败时，物理清理状态保持 preserve，原所有者凭据、WAL 日志及排空锁均不会被静默重放或抹除。
- **十文件范围闭合**：
  - 确认本补丁排除了开发分支中涉及 `safeReadinessFailure` 的改动，未将 `release-readonly-retry.mjs` 作为第 11 个文件卷入，精确维持了 10 个运行工具的文件边界。

---

### 三、审查结论

基于对当前提交的 `runApprovedOperation` 完整代码及三模块受限全文的逐行核查：

> **审查结论**：在本次审查的代码与 AST 结构范围内，**未发现新的源码阻断性逻辑漏洞**。V1 中的变量作用域错位已得到语义级纠正，同点母收据的上下文传递与失败保留逻辑自洽。

*(注：此处仅代表对提供文本的静态逻辑审查通过，不代表系统达到无缺陷状态，更不构成生产执行授权)*。

---

### 四、复审范围与必须保留的批准后未测验收清单

独立审查者明确指出：**静态代码逻辑就绪绝不等于发布包构建完成，更不等于生产验收已通过**。必须在后续流程中严格区分“准备就绪”与“实际执行”：

1. **新包重新构建与签名门禁（严禁提前假设完成）**：
   - 源码目前处于 `c279cfb7`，新 Worker 正在重新执行原 `prepare/build` 流程。
   - 新 Candidate 必须重新完成全量用例回归（涵盖恢复 9 项及全部关联用例），并重新生成独立的 Scope 封存记录；严禁套用旧的 `166` 或 `131c` 签名来签署新字节。
2. **生产准入被阻断的现实依然存在**：
   - 真实环境采集到的 194 个不可读进程（包括 PID 47936 的 PowerShell）依然处于 `unknown` 状态。
   - IG04 守卫规则未被削弱，当前生产准入仍处于客观阻断状态。该状态属于设计预期的合规防御，在未获得系统级明确归因前，生产环境坚决不动。
3. **批准后必要现场验收项（严禁在获得生产批准前擅自执行）**：
   - **真实环境已安装规划器消费验证**：在获得新精确范围正式批准后，于维护窗口内验证新安装的 `release-payload-retention.mjs` 真实规划消费。
   - **隔离恢复演练端到端验证**：核验新生成的 Sealer 实际传参（移除 `-Json`、固定 12 位 ID、55433 端口、E 盘），验证同次 `backup-pre` 产出的转储在独立端口下成功恢复，且生产数据库保持未修改。

