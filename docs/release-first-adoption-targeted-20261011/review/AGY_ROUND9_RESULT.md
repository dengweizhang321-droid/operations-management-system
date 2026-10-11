### 一、独立复审立场与权限界定

独立审查者坚守零工具、零文件、零测试执行、零生产变更及零 Git 批准权。本轮为针对“第 9 号调用：新冻结自举入口（`fresh-adoption-entry-v2.mjs`，SHA `69898b1b...`）及受控交接元组”的严格源码与控制流复审。

**前轮设计审查的认可不自动背书当前实现的具体字节；本复审不提供任何“绝对安全”或“完备性”断言，亦不构成生产授权或 Git 签入批准**。

---

### 二、具体源码行、条件与控制流核验

对 `fresh-adoption-entry-v2.mjs`（`69898b1b...`）进行的逐行核验结论如下：

#### 1. 根路径字面量与 TAB 字符转义缺陷消除
- **源码位置**：第 8–9 行、第 34 行
- **核验事实**：
  ```javascript
  const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749';
  const self=fileURLToPath(import.meta.url),mode='fresh-no-reuse-v1',workerRuntimeRoot=path.resolve('D:/teruisi-runtime/teruisi-worker-sales');
  ...
  assert.equal(path.resolve(spec.journalRoot),path.join(workerRuntimeRoot,'state','release-batches'));
  ```
- **技术定性**：彻底移除了旧 8bf 版本中导致单反斜杠转义为 ASCII TAB（`0x09`）的字面量写法，改用明确的标准正斜杠字面量并通过 `path.resolve` 规范化为宿主系统原生路径。比较双方均经过 `path.resolve` 与 `path.join` 统一处理，消除了导致旧规范直接拒绝的物理路径不匹配缺陷。
- **物理路径防逃逸（`physical()`，第 13–17 行）**：从盘符根节点向下分解遍历，对每个路径分段通过 `lstat(cursor)` 强断言 `isSymbolicLink() === false`，并最终通过 `realpath(absolute)` 验证未发生目录逃逸或 Junction 重定向。

#### 2. 纯内置模块自举与 Import 前置完整门禁
- **源码位置**：第 2–7 行（顶层导入）、第 31–49 行（自举验证链）
- **核验事实**：
  - 脚本文件顶层仅导入 Node 纯内置模块（`node:assert/strict`、`node:path`、`node:url`、`node:crypto`、`node:fs`、`node:fs/promises`），完全杜绝了在自举验证完成前加载任何候选包代码（彻底阻断了草稿版本中的 `imports-before-bootstrap` 漏洞）。
  - 在第 48 行执行 `await import(...)` 之前，必须在纯内置环境下顺序跑通以下物理断言：
    1. 自身单向 DAG 闭环：`entry.path` 指向当前文件，且 `(await checkedFile(self)).sha256 === entry.sha256`；
    2. 批次哈希自洽：`hash(core) === approved` 且 `batch.binding.artifactSha256 === expectedManifest`（`6cff8886...`）；
    3. 候选核心文件封存检查：遍历 `manifest.artifacts.keyFiles`，逐一比对磁盘文件的 SHA-256 与 `nlink === 1n`；
    4. 依赖树全量比对：递归扫描 `candidate/node_modules`，生成的树摘要与 `manifest.build.nodeModulesTree` 严格相等；
    5. TypeScript 模块配置校验：读取并解析 `typescript/package.json`，确保未篡改导出映射。
- **技术定性**：自举阶段实现了严格的静态不可变闭环，任何磁盘代码漂移均在动态导入前被直接截断。

#### 3. 运行器操作预算硬上限逐步核验
- **源码位置**：第 55 行
- **核验事实**：
  ```javascript
  for(const op of batch.operations)processDeadline(op.readOnlyRetry?.totalTimeoutMs??op.command?.timeoutMs);
  ```
- **技术定性**：在进入任何实质性收集或执行前，遍历批次中声明的所有操作，调用原生 `processDeadline` 函数。若有任何操作超时配置超出 1,800,000ms（30分钟）的硬上限，直接抛出异常终止，与前轮核定的 30 分钟硬约束严格对齐。

#### 4. 5 秒动态时效性门禁与错误上下文保全
- **源码位置**：第 57–65 行（`assertFresh`）
- **核验事实**：
  - 严格计算 `age = Date.now() - current.observedAtMs`，要求处于 `[0, 5000]` 毫秒区间内。
  - 当检测到过期（`STALE_ADMISSION_SNAPSHOT`）时，错误对象完整保留了 `admissionStages`、`observationAttempts` 及 `statusObservation`。
  - 在尝试写入 `freshness-${randomUUID()}.json` 失败时，捕获保存错误并附加至 `error.evidenceSaveFailure`，**绝不吞没原始的超时错误**，确保上层调度器能够准确识别失败原因。

#### 5. `beforeOperation` 边界防护与 WAL 状态保全
- **源码位置**：第 74 行
- **核验事实**：
  ```javascript
  beforeOperation:async()=>{await verifyInputs();await assertFresh(lastAdmission,lastAttemptRoot);}
  ```
- **技术定性**：在原引擎即将触发底层操作前，仅执行轻量级的 `verifyInputs()`（核验 3 个小文件的哈希）及 `assertFresh()`（纳秒级时间差运算），总耗时远低于 5000ms，不会污染新鲜度窗口；同时，原 `executeBatch` 引擎在此钩子触发前已将当前操作写入 WAL，因此此处触发的任何拒绝均能完整保留现场排空与事务状态，不存在状态丢失。

---

### 三、危险反例与理论边界客观披露

根据独立审查要求，不作绝对化安全假设，披露以下客观工程边界与反例风险：

1. **瞬时修改竞态（Transient Changed-and-Reverted Race）**：
   - *理论反例*：若外部特权进程在两次全量采样之间、或在 `assertFresh()` 通过到底层子进程真正拉起的微秒级间隙内修改了文件，并在随后毫秒内纳秒级还原内容与所有时间戳，用户态采样无法从数学上绝对排除该极端竞态。
   - *安全口径*：本设计提供的是“在每一个离散操作边界，输入状态与不可变制品严格相符”的离散强证明，而非操作系统层面的全时连续硬件独占证明。
2. **底层 I/O 抖动导致的 fail-closed 误拒**：
   - *运行反例*：若宿主机遭遇极端磁盘 I/O 阻塞或杀毒软件深度扫描，导致 `collectBatchAdmission` 完成到 `beforeOperation` 执行之间的微小耗时超过 5000ms，系统将坚决拒绝执行并判定为 `STALE_ADMISSION_SNAPSHOT`。
   - *运维定性*：此表现符合 fail-closed 的安全设计初衷，属于已知接受的可用性代价，不得视为代码缺陷而盲目放宽 5 秒窗口。

---

### 四、测试诚实性与现场物理阻断现状

1. **测试覆盖范围明确披露（拒绝虚构全绿）**：
   - 本自举入口自身的独立套件实现 26/26 通过（10 项自举、13 项引擎接线、3 项字面量核验）。
   - 全系统 215 项回归测试维持 **214 项通过、1 项失败**（失败项为针对已弃用缓存监视器的 `missing-config-parent` 用例）。该用例在当前无缓存入口下不被触发，但必须在测试记录中**如实报告 214/215，严禁虚报 215 全绿**。
2. **生产环境准入依然客观处于阻断状态**：
   - 现场已探明的 197 个未知/不可读引用进程（包括 PID 47936 的 PowerShell）依然客观存在；
   - IG04 守卫规则保持严格 fail-closed，**生产 actions 严格为 0**；本入口代码审查通过不代表生产准入已解除阻断，更不代表可以提前执行备份或演练。

---

### 五、独立复审结论

> **复审结论**：在当前冻结代码（SHA `69898b1b...`）及受控范围之内，**未发现新的源码阻断性逻辑漏洞或规范违背**。

1. **字面量修复确认有效**：旧 8bf 版本的 TAB 字符解码缺陷已在源码级别彻底纠正，路径解析与系统契约一致。
2. **自举门禁严密**：纯内置模块前置验证机制有效阻断了未受信任代码在环境核验前的执行路径。
3. **交付状态界定**：本结论仅作为阶段性代码逻辑合规依据，不构成本批次发布或生产环境切换的授权，生产操作仍必须等待外部未知进程解除阻断及正式人工批准。

