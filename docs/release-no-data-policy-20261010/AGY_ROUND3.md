# TERUISI 发布规则调整（v3 not-required）真实代码与字节差异独立审查意见

> **审查方**：Antigravity 独立审查席
> **审计对象**：`tools/release-batch.mjs` 与 `tools/release-impact.mjs` 实际 Git Diff（基于工作树 `release-no-data-policy`，基线 `cb007f05`）
> **交互输入**：主 Agent 提供的物理源码补丁、Astra 交叉审查意见
> **执行约束**：只读/无工具调用。未直接访问底层文件系统，未执行任何生产命令或状态篡改。上轮原生 `view_file` 拒绝记录作为客观事实保留。以下意见为纯代码逻辑与形式化门禁的对抗性独立审查。

---

## 一、 审查声明与交叉意见裁决（Audit Scope & Fact Ruling）

本审查完全基于主 Agent 本轮提供的真实 Git Diff 文本及 Astra 交叉意见开展，坚决拒绝无原则附和，以事实与代码逻辑为唯一裁判标准。

### 1. 采纳并纠正的事实共识
对 Astra 在交叉意见中指出的事实更正，本审查经形式化核对后予以**全面确认与采纳**：
1. **无数据影响（`not-required`）的准确内涵**：证明的是**本次发布变更及其封存部署操作不引入持久数据变更副作用**。绝非整个应用运行时“零读写”，更不要求 PostgreSQL 自然业务流水在发布窗口期内静止不变。
2. **数据库四阶段的真实次序**：原 strict 流程包含的 4 个 DB 阶段严格为：`前 Backup → 前 Restore → 后 Backup → 后 Restore`（而非口误的“双备份+双恢复”）。
3. **运行组件切换协议**：坚决沿用原有的 Worker 生命周期轮转机制：`BeginWorkerDrain → StopWorker → apply → StartWorker → EndWorkerDrain → acceptance/closeout`，绝对禁止任何绕过生命周期的静态文件直换。
4. **异常处理边界**：检测到环境漂移、哈希失配或状态异常时，系统职责是**阻断流程并持久化 `unknown / gate` 状态**，严禁在未授权情况下自动触发不可控的回滚或外部告警。
5. **构建与依赖安全**：既有受保护的构建脚本与 `postinstall` 必须在完整路径中正常执行。若依赖项或构建钩子发生变更，应直接使无数据证明失效并降级为 `full`，绝不能为了迎合“安全”而在正式构建中强行注入 `--ignore-scripts`。
6. **成本与收益口径**：不存在“净省 50-55 分钟”或“秒级停机”的确定性保证；所有性能与时间口径必须拆解为独立子项并以生产配对实测为准。首次采用新规则自身必须走 `strict / full`，不得自我减免。

---

## 二、 致命架构缺陷与可执行复现（Fatal Architectural Flaw）

在对 `release-batch.mjs` 和 `release-impact.mjs` 的代码级交叉比对中，本审查发现了一个**导致 `v3 not-required` 批次 100% 无法创建的致命设计断裂**。

### 1. 漏洞定位：`makeBatch` 与 `verifyBatch` 证明链断裂
- **问题代码**：
  在 `tools/release-impact.mjs` 中：
  ```javascript
  export function classifyImpactV3(input) {
    const legacy = classifyImpact(input), { before, after, witness } = input;
    ...
    for (const name of legacy.changed) {
      const left = sourceEntry(before, name), right = sourceEntry(after, name);
      ...
      else if (/^(app|components)\/.+\.tsx$/.test(name) &&
               intrinsicDisplaySkeleton(left, name) === intrinsicDisplaySkeleton(right, name))
  ```
  在 `tools/release-batch.mjs` 中：
  ```javascript
  export function makeBatch({ ... }) {
    ...
    const impact = (version === batchVersion ? classifyImpactV3 : classifyImpact)({ before, after, witness });
    const recovery = recoveryDecision({ impact, ... });
    ...
    const core = { ... impactProof: makeImpactProof(before, after, witness) };
    const sealed = { ...core, batchSha256: hash(core) };
    verifyBatch(sealed, sealed.batchSha256); // <--- 自验必崩
    return sealed;
  }
  ```
  以及在 `verifyBatch` 中：
  ```javascript
  export function verifyImpactProof(proof, binding, version = policyVersion) {
    ...
    return (version === noDataPolicyVersion ? classifyImpactV3 : classifyImpact)({ ...proof, inventory: proof.inventory });
  }
  ```

### 2. 致命机理与执行复现推演
1. **`makeBatch` 阶段**：调用方传入了包含完整文件源码的 `before` 和 `after` 树对象。`classifyImpactV3` 顺利读取源码字符串，执行 `intrinsicDisplaySkeleton`，验证通过，判定 `impact.axes.persistentData.effect = 'none'`，产出 `recovery.mode = 'not-required'`。
2. **`impactProof` 封存阶段**：`makeImpactProof` 仅保存了 `inventory: { before: { [path]: sha256 }, after: { [path]: sha256 } }`，**它根本没有、也不可能把全部源码完整塞入 `impactProof`**。
3. **`verifyBatch` 自验阶段**：`makeBatch` 在返回前强制执行 `verifyBatch(sealed)`。`verifyBatch` 内部调用 `verifyImpactProof(batch.impactProof, ...)`。
4. **参数坍缩**：`verifyImpactProof` 将 `{ ...proof, inventory: proof.inventory }` 传给 `classifyImpactV3(input)`。此时 `input.before` 与 `input.after` **全部为 `undefined`**！
5. **异常爆发**：`classifyImpactV3` 在遍历 `legacy.changed` 时：
   ```javascript
   const left = sourceEntry(before, name); // left 为 undefined
   if (left == null || right == null) throw new Error('addition-or-removal');
   ```
   所有变更文件全部被捕获为 `addition-or-removal` 异常并推入 `gaps`！
6. **自验失败崩溃**：
   - `gaps` 不为空导致 `noData = false`，`impact.axes.persistentData.effect` 变为 `'unproven'`；
   - `recoveryDecision` 在自验中重算得出 `mode: 'full'`；
   - `verifyBatch` 执行一致性检查：
     ```javascript
     if (canonical(impact) !== canonical(batch.impact) || canonical(recovery) !== canonical(batch.recovery))
       throw new Error('Impact/recovery requirements were altered');
     ```
   - **结果**：抛出 `'Impact/recovery requirements were altered'`，批次创建直接 Crash！

> **可执行复现结论**：任何试图将变更判定为 `not-required` 的批次，在调用 `makeBatch` 时必然在内部 `verifyBatch` 处抛出异常。**当前代码在数学与逻辑上无法完成任何一次正常的 `v3 not-required` 批次封存**。

### 3. 必须修复方案
`classifyImpactV3` 绝不能在需要自验的无状态 `verifyImpactProof` 中直接索取原始源码文本。必须采取以下两种架构之一：
- **方案 A（证明固化法 - 推荐）**：`makeImpactProof` 在初次计算时，将通过 AST 规约的 `proofs: [{ path, rule, skeletonSha256 }]` 计算摘要固化进 `proof`；`verifyImpactProof` 校验该证明是由合法的已签名 Witness 和确定性规则直接支持，而不必重新拉起 TypeScript 编译器解析原始文本。
- **方案 B（受控快照绑定法）**：`verifyBatch` 必须显式接收受 `binding.sourceSha256` 与 `binding.predecessorSourceSha256` 锁定的解压源码树引用，供 `verifyImpactProof` 再次调用 `sourceEntry` 读取。

---

## 三、 门禁穿透与安全反例矩阵（Bypass & Exploit Matrix）

除上述致命逻辑断裂外，代码在安全防护和约束完整性上还存在多处严重漏洞：

```
                    ┌────────────────────────────────────────────────────────┐
                    │               v3 门禁反例与攻击路径分析               │
                    └────────────────────────────────────────────────────────┘
                                                 │
          ┌──────────────────────┬───────────────┴──────────────┬──────────────────────┐
          ▼                      ▼                              ▼                      ▼
  【反例 1：哈希脱缰】    【反例 2：收集器逃逸】         【反例 3：探针相位悬空】    【反例 4：平台硬编码】
  StartWorker 引入       validateNoDataCollector        display 探针未被强制        PowerShell 路径锁死
  djangoCandidateSha256  未限制 files 最大集合,         约束必须在 EndDrain 之后,   C:\...\v1.0\powershell
  但未在 requireHash 中   且严格 === 比对路径,           若在 prepare 阶段执行       无法在 pwsh / 非 C 盘
  执行必填与格式校验     Windows 容易误杀或夹带         将验证旧版产生假通过        环境下执行
```

### 反例 1：`StartWorker` 引入的 `djangoCandidateSha256` 脱缰未绑定
- **代码线索**：
  在 `tools/release-batch.mjs` 的 `validateNoDataOperations` 中：
  ```javascript
  if(op.step==='StartWorker')args.push('-ExpectedWorkerManifestSha256',batch.binding.artifactSha256,
    '-ExpectedDjangoManifestSha256',batch.binding.djangoCandidateSha256,'-ExpectedDrainId',batch.binding.maintenanceId);
  ```
- **漏洞分析**：
  在 `makeBatch` 与 `verifyBatch` 的开头，针对 `batch.binding` 的哈希校验列表为：
  `['sourceSha256','predecessorSourceSha256','sourceInventorySha256','predecessorInventorySha256','dependencySha256','configurationSha256','toolchainSha256','artifactSha256','testsSha256','predecessorSha256','workerPlanSha256']`。
  **列表中唯独遗漏了 `djangoCandidateSha256`！**
- **攻击危害**：
  若批次构造者故意传入 `djangoCandidateSha256: undefined` 或格式非法的哈希，`requireHash` 完全不报错，导致最终组装出的 PowerShell 参数中 `-ExpectedDjangoManifestSha256` 传入空值，使底层守护进程的 Django 制品防篡改校验瞬间失效。

### 反例 2：收集器（Collector）校验的集合未封闭与路径脆弱性
- **代码线索**：
  在 `validateNoDataCollector` 中：
  ```javascript
  for(const target of noDataCollectorFiles) {
    if(!collector.files?.some(f=>f.path===target&&f.sha256===hash(readFileSync(target))))
      throw new Error('No-data collector implementation differs from trusted bytes');
  }
  ```
- **漏洞分析**：
  1. **缺少上限封闭（Open Set）**：代码仅验证了 `noDataCollectorFiles` 中的文件都在 `collector.files` 中，**但没有检查 `collector.files.length === noDataCollectorFiles.length`**！收集器中可以合法夹带任意数量的未审查外来脚本或木马文件。
  2. **参数未封死**：`collector.args?.length !== 4 || collector.args[0] !== entry || collector.args[1] !== 'collect'`，仅检查了前两项，`args[2]` 和 `args[3]` 完全未做任何白名单约束，可注入任意 CLI 标志。
  3. **Windows 路径大小写阻断**：使用严格相等 `f.path === target`，在 Windows 驱动器盘符大小写（`d:\` vs `D:\`）或路径分隔符不一致时，会发生误拦截。

### 反例 3：`no-data-observation` 执行相位悬空（Phase Floating）
- **代码线索**：
  ```javascript
  for(const action of ['display','permissions','natural-watchdog'])
    if(!batch.operations.some(op=>op.kind==='no-data-observation'&&op.observation.action===action))
      throw new Error('Missing executable no-data acceptance');
  ```
- **漏洞分析**：
  代码强制要求 `batch.operations` 中包含 `display`、`permissions`、`natural-watchdog` 三个观测动作，**但没有任何一处校验约束它们必须位于哪个 phase，也没有校验它们与生命周期步骤的相对先后顺序！**
- **攻击复现**：
  构造一个恶意批次，将 `display` 观测操作置于 `prepare` 或 `drain` 阶段（此时新代码尚未 apply，旧 Worker 依然在线或处于断开过渡期）。观测探针在旧版本页面上执行断言并返回 `passed`，掩盖了新代码上线后界面彻底损坏的严重事故。
- **整改要求**：必须强制增加拓扑约束：所有 `no-data-observation` 必须位于 `phase === 'acceptance'`，且其执行位置必须在 `EndWorkerDrain` 之后。

### 反例 4：平台环境与执行器硬编码冲突
- **代码线索**：
  ```javascript
  op.command.executable !== 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  ```
- **漏洞分析**：
  当前宿主操作系统工作在 PowerShell 7（`pwsh`）环境下，且无法保证所有部署节点的系统目录都位于 `C:` 盘。将执行器强行锁死为 WindowsPowerShell 5.1 绝对路径，直接剥夺了在现代 PowerShell 运行时下的兼容性，且路径大小写一旦被自动化工具格式化即引发崩溃。

---

## 四、 AST 与 CSS 展示规约骨架审查（`intrinsicDisplaySkeleton`）

针对 `tools/release-impact.mjs` 中新增的 JSX 静态骨架提取逻辑，进行对抗性语法审查：

### 1. JsxText 的空白字符处理陷阱（Trivia Fragility）
- **实现机理**：
  ```javascript
  if (ts.isJsxText(node) && ts.isJsxElement(node.parent) && intrinsic(node.parent.openingElement))
    spans.push([node.pos, node.end, '<display-text>']);
  ```
- **缺陷分析**：
  在 TypeScript Compiler API 中，`JsxText` 的 `node.pos` 包含了前面的所有前导琐碎内容（空白、换行符）。
  当开发者写出如下标准 JSX 时：
  ```tsx
  <div>
    <span>Item 1</span>
    <span>Item 2</span>
  </div>
  ```
  `<div>` 与 `<span>` 之间的换行缩进（`\n  `）在 AST 中**同样被视为 `JsxText`**，且其父节点就是 `div`（命中 `intrinsic`）。
  它会被直接替换为 `<display-text>`！
  如果开发者在 PR 中仅仅对代码进行了 Prettier 格式化（例如将多行合并为单行 `<div><span>Item 1</span><span>Item 2</span></div>`），在单行模式下不存在该空白 `JsxText`，导致两侧骨架文本严重失配，**合法的纯格式化改动被错误拦截**。

### 2. React Fragment（`<>...</>`）支持缺失
- **实现机理**：`ts.isJsxElement(node.parent)`
- **缺陷分析**：
  在 TypeScript AST 中，`JsxFragment`（`<>...</>`）的类型是 `ts.isJsxFragment`，它**不属于** `ts.isJsxElement`。
  如果组件返回的是根 Fragment：
  ```tsx
  export default function MyNotice() {
    return (
      <>
        <div>消息文本</div>
      </>
    );
  }
  ```
  如果将文本直接挂在 Fragment 下（`<>文本</>`），其父节点不是 `JsxElement`，AST 遍历直接跳过替换，原样保留源码文本，导致骨架比对判定存在非展示差异，降级为 `full`。

### 3. Tailwind 样式类变更的“界面劫持”盲区
- **正则范围**：`/^[a-z0-9_\s:-]*$/i.test(node.initializer.text) && !/url|content-|font-face/i.test(...)`
- **安全隐患**：
  该正则虽然成功排除了 `url()` 和伪元素 `content-` 的注入，但允许任意常规 Tailwind 类的任意替换。
  **反例场景**：
  攻击者将核心确认按钮由 `<button className="flex items-center">` 改为 `<button className="hidden pointer-events-none opacity-0">`。
  由于修改前后的类名均匹配白名单，它们都被归一化为 `"<display-class>"`，因此 AST 判定骨架完全一致，放行进入 `not-required`。这虽不破坏持久数据库，但构成了严重的客户端拒绝服务（UI Denial-of-Service）。针对关键动作标签（如 `button`、`a`），必须限制关键布局破坏性类名的突变。

---

## 五、 未提供上下文与明确缺口（Missing Context Gaps）

根据严格审计准则，由于本轮审查未包含以下依赖项的物理实现，将其正式列为**未证明的上下文缺口（Unverified Gaps）**：

1. **`release-no-data-observation.mjs` 完整实现未知**：
   - 补丁引入了 `validateNoDataObservation` 和 `runNoDataObservation`，并在运行时直接调用。其内部是否对浏览器执行上下文进行了沙箱隔离？是否禁止了 `--remote-debugging-port` 或 `--disable-web-security`？是否对探测 URL 进行了本地回环（`127.0.0.1`）严格限制以防止 SSRF？**由于源码未随 Diff 提供，该探针的安全可信度当前处于 UNKNOWN 状态**。
2. **`cssDisplaySkeleton` 实现未在本轮展示**：
   - 虽然补丁调用了 `cssDisplaySkeleton(left) === cssDisplaySkeleton(right)`，但该函数在 v2 中的物理实现未在本轮提供。无法独立核实其是否已完全阻断 `@import` 外部外部样式表注入或 CSS 注入攻击。

---

## 六、 首次采用机制与旧批次隔离裁决

1. **自举发布安全性（Bootstrap Invariance）**：
   - 本次引入 `v3 not-required` 的改动本身（包含 `tools/release-batch.mjs` 与 `tools/release-impact.mjs`），属于发布机制与门禁基础设施自身的变更。
   - 依据首次采用防护原则，**包含本补丁的发布批次本身必须作为 `strict / full` 批次提交**，强制执行完整的四阶段数据库演练。严禁在尚未正式通过验收前，使用自身逻辑为自身签发 `not-required` 豁免。
2. **旧批次 `active 9f79` 物理隔离**：
   - 生产环境中现存的 `active 9f79`（第 19 步状态未知）必须完全保留其原始 WAL 与审计日志。
   - 新批次引擎不得对其执行接管、修复或重写操作。新方案只能在原执行者将旧批次归档闭环后，方可申请新的批次所有权。

---

## 七、 审查结论与修改指示（Actionable Checklist）

当前 Diff 展现了将展示层变更与数据库重操作解耦的良好架构意图，**但在目前代码状态下，严禁合并进入候选基线**。必须由执行方在当前分支立即完成以下修复：

- [ ] **修复证明自验断裂**：重构 `verifyImpactProof` 与 `classifyImpactV3` 的调用契约，使得自验阶段无需原始源码文本即可对骨架证明进行合规校验（消除 `addition-or-removal` 假阳性崩溃）。
- [ ] **补齐哈希锁定**：在 `makeBatch` 与 `verifyBatch` 的 `requireHash` 检查清单中补上 `djangoCandidateSha256`。
- [ ] **封闭收集器清单**：在 `validateNoDataCollector` 中校验 `collector.files` 的集合封闭性（禁止夹带额外文件），并对 Windows 盘符大小写进行 `path.resolve` 归一化。
- [ ] **锁定探针相位拓扑**：在 `validateNoDataOperations` 中硬性断言所有 `no-data-observation` 的 `phase` 必须为 `acceptance`，且在执行序列中必须排在 `EndWorkerDrain` 之后。
- [ ] **解除执行器硬编码**：允许使用受信任且已哈希锁定的当前 PowerShell 宿主运行时，避免锁死在固定绝对路径。
- [ ] **补充提供探针源码**：提供 `release-no-data-observation.mjs` 供安全席位复验其浏览器调用沙箱与网络边界。
