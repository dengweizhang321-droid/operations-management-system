# TERUISI 发布规则与源溯源绑定（v3 source-binding）第 8 轮独立架构设计审查

> **审查方**：Antigravity 独立审查席  
> **审计对象**：原生产者精确来源契约（`source-binding` Envelope）最小设计提案、9→10 模块运行闭包演进方案、基线及生产前驱绑定策略  
> **审查基线**：最新有效基线 `origin/main`（`ba656`）+ 实际 AB 生产完成态（`20261010T014638Z`，manifest `f4e537eb`，source `92c2656c`，Django `237fbe0d`，链高度 219 `5289afac`，无残留活跃批次）  
> **审查约束**：纯自包含文本设计审查，**未访问物理代码文件，未执行任何命令，未尝试任何受限资源**。本轮为设计前瞻性审计（代码尚未编写，严禁宣称已实跑）。恪守工程边界，不自批、不放行生产、不承诺时间收益。

---

## 一、 事实基线核定与范围演进裁决（Fact Baseline & Scope Evolution）

1. **真实 AB 终态与有效前驱确认**：
   - 确认 2026-10-11 root 实测验证结论：AB `FINAL_AB_DELIVERY`（raw `790313b4`，109 条规范链 `5289afac`）已正式归档，生产 `active` 批次确已完全出清；
   - 历史第 19/21 步状态保持原真实 `unknown` 记录，未被非法篡改或粉饰；
   - 当前生产生效基线（Effective Baseline）确认为 AB `20261010T014638Z`，其关键实体哈希严格锚定：
     - Manifest: `f4e537eb`
     - Source: `92c2656c`
     - Django: `237fbe0d`
     - 链指纹: `219` 及 `aaf62994`。
2. **运行模块范围演进（9 → 10 模块闭包）**：
   - 上一轮经 137 项测试通过的 9 文件源（`37fea79a` / 冻结 `745995`）作为中间事实保留；
   - 由于原正式生产 preparer 强校验并锁死固定路径 `D:/运营管理系统-sales-django-release`，且既有收据库中不存在 9 文件闭包可复用的计划，直接以工作树为源会导致收集器与构建器发生**源读取分裂（Split-Brain）**；
   - 为最小补齐真实原生产者的来源契约，设计引入 `source-binding`，预计改动触及：
     1. `tools/worker-local-release-rotation.mjs`（**新增纳入**）
     2. `tools/worker-local-release.mjs`（已有）
     3. `tools/release-batch.mjs`（已有）
     4. `tools/release-batch-admission.mjs`（已有）
   - **闭包认定**：运行闭包由 9 文件正式扩展至 **10 文件闭包**。候选制品必须严格基于实际 AB 完整 `source-snapshot` + 10 文件精确补丁组合，**严禁夹带 `main` 分支上未采用的 healthdiag/control/readonly 等无关变更**。

---

## 二、 核心设计缺陷与漏洞隐患对抗性分析（Adversarial Risk Analysis）

针对提案中的 `source-binding envelope` 机制，本席位推演出以下 6 项关键设计漏洞与架构陷阱：

```
                    ┌────────────────────────────────────────────────────────┐
                    │       source-binding 设计缺陷与穿透风险拓扑            │
                    └────────────────────────────────────────────────────────┘
                                                 │
          ┌──────────────────────┬───────────────┴──────────────┬──────────────────────┐
          ▼                      ▼                              ▼                      ▼
  【缺陷 1：循环哈希陷阱】 【缺陷 2：Windows路径穿透】    【缺陷 3：收集器裂脑】  【缺陷 4：宿主Schema冲突】
  Envelope 若引用计划/   大小写/8.3短路径/软链接        Batch/Plan/Manifest/    Django/Supervisor 严格
  收据哈希, 导致 DAG     使得父子路径判断失效,          Receipt 来源不一致,     校验 manifest.source,
  依赖成环, 无法封存     越界逃逸至运行时根             收集器读旧树/apply换新  注入未知字段导致拒绝
```

### 1. 循环哈希依赖陷阱（Circular Hashing Traps）
- **风险推演**：
  提案定义 `raw canonical JSON v1` 包含 `{ version, sourceRoot, sourceRootPathSha256, predecessor, predecessorChainStateSha256, identity }`，并计划将 envelope 嵌入 `manifest.source`、`typed plan` 和 `prepared receipt`。
  **致命隐患**：如果 `source-binding` 在生成时试图去绑定 `workerPlanSha256` 或 `artifactSha256`，而这些对象的哈希又反向依赖 `sourceBindingSha256`，将造成不可解的密码学循环依赖（Circular Digest Dependency）。
- **硬性约束**：
  必须维持单向严格的有向无环图（DAG）：
  $$\text{sourceRoot 磁盘内容} \to \text{identity} \to \text{raw source-binding envelope} \to \text{sourceBindingSha256}$$
  $$\to \text{worker-release-rotation-plan} \to \text{prepared build receipt} \to \text{batch.binding.sourceBindingSha256}$$
  Envelope 内部**绝对禁止包含任何待生成的 Plan SHA、Manifest SHA 或 Receipt SHA**，其前驱字段只能单向绑定既有已采纳链的 Head 状态。

### 2. Windows 路径规范化与祖先/子孙判定穿透（Path Traversal & Aliasing）
- **风险推演**：
  提案要求 `sourceRoot` 绝不能等于、嵌入或作为祖先包含 `protected/runtime/persist/devvars/legacy/fixedprepare` 生产根。
  在 Windows NTFS 环境下，单纯依靠字符串前缀（`.startsWith()`）进行路径包含判定存在严重安全漏洞：
  1. **大小写别名（Case Aliasing）**：`D:\teruisi-runtime` 与 `d:\TERUISI-RUNTIME` 字符不匹配但物理指向同一目录；
  2. **同名伪造（Prefix Bleed）**：`D:\teruisi-runtime-fake` 会被愚蠢的 `path.startsWith("D:\\teruisi-runtime")` 误判为子目录；
  3. **8.3 短路径（Short Path Name）**：如 `D:\RUNTIM~1` 可绕过包含长路径关键字的黑名单匹配；
  4. **Reparse Points / Junctions（目录挂接点）**：通过建立 NTFS Junction，将看似独立的 `D:\my-source` 链接到 `D:\teruisi-runtime`。
- **硬性防御设计**：
  - 必须首先通过 Win32 `GetFinalPathNameByHandle` 或 Node.js `fs.realpathSync.native` 解析真实物理路径；
  - 路径统一转为全小写（或严格大写），并以尾随分隔符 `\` 进行规范化；
  - 包含判定必须是双向的：
    $$\forall R \in \text{ProtectedRoots}: \quad \neg (\text{isSubpath}(S, R) \lor \text{isSubpath}(R, S) \lor S == R)$$
  - 严格拒绝任何含有 Junction / Symlink 的 `sourceRoot` 目录本身。

### 3. 收集器与执行器源路径分裂（Split-Brain Source Inconsistency）
- **风险推演**：
  在既有体系中，`release-batch.mjs` 的标准收集器（`collector`）、计划生成器（`planWorkerReleaseRotation`）与实际部署动作（`applyApprovedRotationPlan`）各自持有路径解析逻辑。
  如果仅在 `--prepare-online` 时通过 CLI 读取了 `--source-binding`，而后续 `batch` 封存或 `collector` 执行时未强制读取同一 envelope，收集器极可能回退到默认的 `FixedSourceRoot` 读取旧代码，导致：
  **批次凭据验证的是 Worktree A 的代码，但现场部署与验收比对的却是 Fixed B 的旧产物**。
- **硬性防御设计**：
  必须建立全局唯一的源决策契约：
  1. `batch.binding` 强制包含 `sourceBindingSha256`；
  2. `manifest.source`、`workerPlan`、`preparedReceipt` 必须逐字节强断言该哈希一致；
  3. 收集器与准备引擎必须且仅能从**已验证解封的同一 envelope 中提取 `sourceRoot`**，若存在任何不一致或回退，立即抛错中断。

### 4. 移动工作树对非源码环境身份（Non-Source Identity）的意外污染
- **风险推演**：
  `identity` 包含 `runtimeConfigurationSha256`、`environmentSha256`、`externalNpmConfiguration`。
  当开发者从不同 worktree 构建时，某些构建工具（如 npm、Next.js、Vinext）可能会自动捕获当前绝对路径并写入环境缓存或配置文件中。
  如果构建收据中的非源码环境哈希由于 `sourceRoot` 物理路径不同而发生变化，`bindDeploymentImpact` 中的前驱与候选比对：
  `canonical(inputs(receipts.before)) !== canonical(inputs(receipts.after))`
  将会直接判定非源码环境发生漂移，**导致本来合法的无数据发布被意外强制降级为 full 甚至验证失败**。
- **规避要求**：
  环境变量与配置哈希收集器必须剔除当前工作树临时路径等噪声项，仅保留受版本控制的固定参数与全局工具链版本，确保非源码环境身份的确定性。

### 5. 宿主 Django 与 Supervisor 既有验证器的 Schema 兼容性盲区
- **代码连接核查预警**：
  在生产部署中，Django 或 Supervisor 可能会读取 `deployment-manifest.json` 或 `worker-prepared-builds` 收据以执行自检。
  如果新增的 `source-binding envelope` 字段被直接平铺进既有 JSON，而未安装的生产端旧代码使用了 `exactKeys` 或严格类型校验，可能会引发生产服务启动时的反序列化崩溃（Schema Violation）。
- **兼容性设计**：
  Envelope 在 `manifest` 中应封装在专有的保留命名空间字段下（例如 `sourceBinding: { raw, sha256 }`），禁止破坏既有顶层根字段布局，避免触发既有未知键拒绝逻辑。

---

## 三、 最小确定性契约方案建议（Minimal Deterministic Contract）

坚决拒绝引入通用的重型注册表（Registry）或全局状态账本，坚持**单批次不可变自包含凭据**原则。

```
              ┌─────────────────────────────────────────────────────────────┐
              │          source-binding envelope v1 规范化物理结构           │
              └─────────────────────────────────────────────────────────────┘
                                             │
      ┌──────────────────────────────────────┴──────────────────────────────────────┐
      ▼                                                                             ▼
【envelope.raw (Canonical JSON)】                                          【envelope.sha256】
 - version: "teruisi-source-binding-v1"                                     - 64位十六进制哈希
 - sourceRoot: 规范化物理绝对路径 (无尾随斜杠)                              - hash(raw) 强一致校验
 - sourceRootPathSha256: hash(sourceRoot)
 - predecessorChainStateSha256: 当前生效链 Head 的 approvedPlanSha256
 - predecessor: 完整既有 Head 绑定快照
 - identity: 原生 workerPreparationIdentity (源码树/库存/Node/npm/环境哈希)
```

### 1. CLI 调用与参数锁死
仅允许唯一的参数成对传入模式，且**仅限 `prepare-online` 阶段使用**：
```bash
--source-binding <绝对路径至 JSON 文件> --source-binding-sha256 <64位十六进制哈希>
```
- 禁止任何裸传 `--source-root`、禁止任何 `--allow-test-runtime-root` 等测试逃逸开关；
- 参数在解析的第一时间，通过 `requireHash` 校验格式，并立即对读取的文件字节执行 `hash(raw) === cliSha` 校验。

### 2. 判定源路径合法性的最小确定性算法
```javascript
function assertSafeSourceRoot(candidatePath, protectedRoots) {
  // 1. 获取 Win32 物理绝对路径并消除链接
  const realCandidate = fs.realpathSync.native(candidatePath).toLowerCase();
  for (const root of protectedRoots) {
    const realRoot = fs.realpathSync.native(root).toLowerCase();
    // 2. 确保以分隔符结尾比对，防止前缀误伤
    const normCandidate = realCandidate.endsWith('\\') ? realCandidate : realCandidate + '\\';
    const normRoot = realRoot.endsWith('\\') ? realRoot : realRoot + '\\';
    if (normCandidate === normRoot || normCandidate.startsWith(normRoot) || normRoot.startsWith(normCandidate)) {
      throw new Error(`Unsafe sourceRoot: conflicts with protected root ${root}`);
    }
  }
}
```

---

## 四、 负例矩阵与实操验证建议（Negative Test Matrix）

在 Astra 交付具体实现后，必须包含以下 **10 组针对性负例测试**，并提供物理控制流执行证据：

| 负例测试用例 | 构造手段与输入 | 预期拦截点与安全表现 |
| :--- | :--- | :--- |
| **N1. 参数孤立注入** | 仅传 `--source-binding` 或仅传 `--source-binding-sha256` | 参数解析立即报错，严禁进入准备流程 |
| **N2. 字节摘要失配** | 篡改 envelope 文件中任意一个字节但保持 CLI SHA 不变 | 动作前读取立即抛出 `Source binding bytes corrupted` |
| **N3. 路径伪造别名** | `sourceRoot` 传入大写驱动器或带 `..` 相对路径 | 规范化比对失败，抛出路径格式非规范错误 |
| **N4. 逃逸至运行时根** | `sourceRoot` 设为 `D:\teruisi-runtime\teruisi-worker-sales` | 祖先/子孙安全校验立即阻断，严禁污染生产根 |
| **N5. 逃逸至临时前缀** | `sourceRoot` 设为 `D:\teruisi-runtime-fake` | 验证路径前缀匹配算法不会误伤同前缀合法独立目录 |
| **N6. 软链接/挂接点穿越**| `sourceRoot` 本身是一个指向生产受保护目录的 Junction | 经过 `realpathSync.native` 解析后触碰受保护黑名单阻断 |
| **N7. 裂脑源选择** | Batch 声明了新 envelope，但 Plan 被恶意篡改为 Fixed 根 | 跨阶段一致性校验阻断，拒绝应用部署 |
| **N8. 前驱链状态漂移** | Envelope 中的 `predecessorChainStateSha256` 与现场 Head 不符 | 现场重算前驱校验立即阻断，防止基于旧前驱重放 |
| **N9. 未知键污染** | 在 Envelope JSON 中注入未定义的扩展字段 `{ maliciousKey: true }` | 严格 Schema 解析立即抛错，杜绝隐式参数注入 |
| **N10. 旧版无缝回退** | 完全不传 `--source-binding` 参数 | 行为 100% 保持既有 legacy / fixed 根处理逻辑，无破坏性中断 |

---

## 二、 首次自举与生产隔离边界（Bootstrap Invariants）

1. **机制自身自举的严格性（Strict Bootstrap Invariant）**：
   - 本次引入 `source-binding` 来源契约的修改本身（10 文件闭包），直接改动了核心轮转引擎（`rotation`）、发布执行器（`worker-local-release`）与批次准入模块；
   - 依据体系最高原则：**包含本机制变更的首次自举发布批次，绝对必须作为 `strict / full` 批次执行**，强制完成 4 个完整数据库阶段（前置备份与恢复 + 后置备份与恢复）的演练；
   - **绝对禁止自我减免**：绝不允许使用尚未正式被生产采纳的新来源证明机制，来自行豁免自身的发布验证。
2. **生产环境绝对隔离与授权边界**：
   - 生产环境目前稳定运行于 AB 基线，本轮设计审查**不包含、亦未赋予任何生产环境维护切换、备份恢复或业务写入授权**；
   - 严禁在未经用户独立批复的情况下，在生产环境生成或调度包含新逻辑的执行批次；
   - 坚决杜绝任何轻率的“净省时间承诺”，所有性能数据以真实生产隔离测试基准为准。

---

## 六、 审查结论与后续行动建议

1. **设计方向裁决**：
   Astra 提出的基于不可变规范 JSON Envelope 的 `source-binding` 机制方向正确，切实抓住了“非固定工作树与生产环境受保护根隔离”的核心安全矛盾，比单纯依赖环境变量或宽泛路径覆盖更加确定和安全。
2. **阻断与修正项**：
   - 必须严格遵守本文指出的单向 DAG 依赖，杜绝 Envelope 与 Plan 之间的循环哈希设计；
   - 必须采用 Win32 原生物理真实路径与双向子路径判定，彻底封死 Windows 大小写及 Junction 穿透漏洞；
   - 必须在 Batch、Plan、Manifest、Receipt 四重生命周期中建立对 `sourceBindingSha256` 的强一致引用，杜绝收集器读取裂脑。
3. **后续行动**：
   本设计审查意见正式提交给主 Agent 与 Astra 进行对照交叉回应。在 Astra 完成具体代码实现后，本席位将针对其最终输出的物理 Git Diff、具体源码字节及 10 组负例测试实跑日志进行最终的字节级复审。

