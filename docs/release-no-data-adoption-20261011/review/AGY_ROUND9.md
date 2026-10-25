# TERUISI 发布规则与源溯源绑定（v3 source-binding）第 9 轮独立对抗性审查报告

> **审查方**：Antigravity 独立审查席  
> **审计对象**：最终冻结的 4 模块补丁（`47d73bc4c1eaa24199eaa248bef48f18755e6e3ac88da3994c3e8c11d7af7e89`）、完整 5160 文件 Worker 组合（最终源码 `ad21d50df4cbdc91450c25caf369af0f615f555dac0023d6365d0e412e7d0111`，库存 `fd53437a7a05bf779d40d580fdc385914c9db23f00208022b454c59068ed3bcf`）、首批自举消费者兼容性方案及 `831c104c` 在线准备凭据  
> **审查基线**：真实已闭环 AB（109 WAL / Head `5289afac`，发布链高 219 `aaf62994`，Worker `f4e537eb`，源码 `92c2656c`，Django `237fbe0d`，保留历史 3 项未知状态，active 确已 ENOENT）  
> **审查约束**：仅依据所提供的精确代码文本与测试事实记录进行静态攻击与逻辑推演；**未使用任何原生文件、Shell 或生产执行工具；不宣称已实跑测试，不宣称生产已通过**。坚决避免泛化背书，直击阻断点与未证明盲区。

---

## 一、 授权边界与生产前置事实确认（Authority & Invariants）

1. **当前明确授权范围**：
   - 用户已明确授权：开发修改、隔离环境回归测试、Git 提交/推送合并，以及精确候选制品的准备；
   - **绝对未授权**：生产服务切换、维护窗口开启、备份恢复操作、外部计划调度启用，以及生产业务数据库写入。
2. **首次规则自举采用铁律（Strict Bootstrap Invariant）**：
   - 包含本次 10 模块运行闭包的新机制首次采用，**必须作为原已采纳引擎的 `strict / full` 批次执行**，强制完成 4 个原生物理数据库阶段（前置备份 → 前置恢复 → 后置备份 → 后置恢复）；
   - 新增的 `not-required` 规则仅供后续具备完整证明的无数据发布使用，**机制自身上线绝不自我豁免**。
3. **实体指纹隔离**：
   - 严禁将底层 WAL 事件指纹与发布链指纹（`219 / aaf62994`）或 `approvedPlanSha` 混淆；
   - 历史权威 Django `237fbe0d` 仅作为前驱基线，严禁在未重新显式绑定清单哈希的情况下假定其自动兼容。

---

## 二、 核心攻击分析：致命阻断点与关键设计脆弱性

```
                    ┌────────────────────────────────────────────────────────┐
                    │      第 9 轮核心漏洞推演与消费者兼容性断层拓扑         │
                    └────────────────────────────────────────────────────────┘
                                                 │
          ┌──────────────────────────────────────┴──────────────────────────────────────┐
          ▼                                                                             ▼
  【致命阻断：已安装 Django 验证器排异】                                        【实现脆弱点：CRLF 侧车字节敏感】
  已安装 Django (237fbe0d) 内部验证器                                           release-batch-admission.mjs 中
  执行 assertExactKeys(manifest.source, ...)                                    sidecar.equals(Buffer.from(hash+'\n'))
  不包含 sourceBinding 字段，读取新清单                                          若 Windows 环境侧车含 \r\n，直接抛出
  将直接抛出未知键异常，导致备份与 retention 崩溃                                'preparation receipt changed' 误杀
```

### 1. 致命工程阻断：已安装生产 Django 的“旧验证器排异”断层（Consumer Gap Blocker）
- **漏洞机理**：
  在既有生产拓扑中，固定受保护的 `Start / Status / guard` 以及快捷方式/守护进程在执行完受保护的单文件安装后，会使用候选目录同构的验证器/解析器。同时，已安装的生产 Django（`D:\teruisi-runtime\django-sales`）在执行备份与清理任务时，会直接调用已安装的 `release-payload-retention`，其底层 JS 会 import 同构的旧版 `worker-local-release-rotation.mjs` 与 `worker-local-release.mjs`，PowerShell postflight 亦会解析旧版 rotation。
- **崩溃推演**：
  在旧版（AB `20261010T014638Z`）验证器中：
  ```javascript
  // 旧版 worker-local-release.mjs:
  assertExactKeys(manifest.source, ["rootPathSha256", "packageLockSha256", "sourceFingerprint", "snapshotRoot", "tree"], "manifest source");
  ```
  旧版验证器**完全没有定义 `sourceBinding` 键名**！
  若仅将 Worker 候选升级为包含 `sourceBinding` 的清单，而已安装的 Django 仍停留在旧版代码：
  当 Django 的备份或 retention 流程扫描到新的轮转计划或清单时，旧版 `assertExactKeys` 会立即抛出 `Unknown key in manifest source: sourceBinding` 严重异常，导致生产守护与备份任务大面积溃决。
- **必须执行的修复与操作顺序约束**：
  1. **必须准备“仅更新工具”的同构 Django 候选**：使用既有的原版 `PrepareApp / DeployApp`，制作专用于工具升级的 Django 候选版本；
  2. **字节级静态保持**：该 Django 候选必须**100% 逐字节保持后端代码、业务配置、Drizzle 迁移、运行时依赖完全不变**，仅更新其中的 `worker-local-release.mjs` 与 `worker-local-release-rotation.mjs` 两个工具模块（由原版 `PrepareApp` 自带的静态依赖复制机制完成，不增加新复制清单，不免除保留策略）；
  3. **双制品联合绑定**：首次自举批次中，必须同时将 Worker 候选清单与这一新制作的 Django 清单哈希显式绑定在 `ExpectedWorkerManifestSha256` 与 `ExpectedDjangoManifestSha256` 中，随 4 DB 阶段一次性原子生效，彻底消除新旧验证器版本断层。

### 2. 脆弱性缺陷：Admission 阶段 `.sha256` 侧车文件的严格换行符陷阱（CRLF Fragility）
- **代码位置**：
  `tools/release-batch-admission.mjs` 第 149 行：
  ```javascript
  if(!sidecar.equals(Buffer.from(hash(raw)+'\n'))||receipt.version!=='teruisi-worker-prepared-build-v1'
    ||receipt.planSha256!==batch.binding.workerPlanSha256||receipt.candidateManifestSha256!==batch.binding.artifactSha256)
    throw new Error('Bound source original preparation receipt changed');
  ```
- **安全与稳定性风险**：
  代码使用了底层的 `sidecar.equals(Buffer.from(hash(raw) + '\n'))` 强二进制字节比对。
  在 Windows 操作系统中，若该 `.sha256` 侧车文件曾被任何外部 Windows 脚本、PowerShell 命令（默认追加 `\r\n`）或格式化工具写入，`sidecar` 将以 `0x0D 0x0A` 结尾，导致 `equals` 直接判定为 `false`，抛出 `'Bound source original preparation receipt changed'` 误报阻断！
- **修正建议**：
  在保持哈希校验绝对严格的前提下，消除行尾符平台的脆弱性：
  ```javascript
  if (sidecar.toString('ascii').trim() !== hash(raw) || ...)
  ```
  （既往验证中采用过 `trim()` 方式，不仅严格防篡改，而且对 Windows 换行符具有天然韧性）。

### 3. 脆弱性缺陷：8.3 短文件名（SFN）在纯函数隔离校验时的盲区
- **代码分析**：
  在 `tools/worker-local-release.mjs` 的 `validateWorkerSourceBinding` 中：
  ```javascript
  for (const protectedRoot of sourceExcludedRoots) {
    if (isWithinWindowsPath(protectedRoot, value.sourceRoot) || isWithinWindowsPath(value.sourceRoot, protectedRoot))
      fail("Bound source overlaps an existing protected/runtime/source authority");
  }
  ```
- **风险分析**：
  该函数在纯内存校验阶段，仅对 `value.sourceRoot` 执行了字符串层面的大小写规范化与前缀包含判断，**此时尚未调用 `realpath`**。
  若攻击者或配置错误地传入了 Windows 8.3 短路径别名（例如 `D:\RUNTIM~1` 代替 `D:\teruisi-runtime`）：
  纯内存函数 `isWithinWindowsPath` 将完全无法识别其与 `sourceExcludedRoots` 的重叠！
  虽然后续在执行 `assertBoundWorkerSourceLocation` 时通过物理 `realpath` 成功拦截了此行为，但**该纯函数在脱离物理环境的独立断言场景下存在理论穿透盲区**。
- **修正建议**：
  在 `validateWorkerSourceBinding` 中补充对 Windows 短文件名特征字符 `~` 的静态拒绝断言：
  ```javascript
  if (value.sourceRoot.includes("~")) fail("Source binding path must not use 8.3 short name aliases");
  ```

---

## 三、 四元组一致性与 DAG 有向无环依赖核定

针对新增补丁的密码学与数据结构设计，核定其形式化逻辑：

1. **严格的四元组（Tuple）强一致性**：
   `assertWorkerSourceBindingTuple` 强制校验：
   $$\text{batch.sourceBinding} \equiv \text{manifest.source.sourceBinding} \equiv \text{plan.sourceBinding} \equiv \text{receipt.sourceBinding}$$
   且强断言 `manifest.source.rootPathSha256` 与 `tree` 必须与 Envelope 内的 `identity` 逐字节匹配。四项凭据中只要有一项被独立篡改或解绑，立即全面抛错拒绝。
2. **收集器与批次源路径的唯一确定性**：
   `workerSourceRootForBatch(batch)` 强制重算并比对：
   - `sourceBindingSha256`
   - `sourceSha256`
   - `sourceInventorySha256`
   - `predecessorSha256`
   - `toolchainSha256`
   - `configurationSha256`
   只有在全部一致时才提取 `sourceRoot`，并在收集器会话初始化（`createPreparationEvidenceSession`）时传入该确定路径，**彻底清除了第 8 轮指出的“收集器读旧树、apply 换新树”的裂脑风险**。
3. **DAG 依赖严格无环**：
   Envelope 内部仅包含前驱头快照与自身源树/工具链身份，不包含待生成的 Plan SHA 或 Manifest SHA，构建流程满足单向依赖：
   $$\text{Envelope} \to \text{Plan} \to \text{Receipt} \to \text{Manifest} \to \text{Batch}$$
   不存在任何循环哈希死锁。
4. **源码树防篡改闭环**：
   在准备阶段（`sampleSource`）、构建前（`buildWorkerReleaseInternal`）、构建后，以及准入收集（`collectBatchAdmission`）的生命周期首尾，均强制调用 `verifyBoundWorkerSource`，对全量 Git 跟踪文件核查 `nlink === 1`（禁止硬链接）并重算 SHA。源文件一旦在过程中发生删除、篡改或时间戳漂移，流程立即熔断。

---

## 四、 受支持类别与明确未证明缺口（Scope & Gaps）

### 1. 本次实现明确支持的类别（Supported Categories）
- [x] **在线候选准备来源绑定**：支持在 `prepare-online` 模式下通过成对参数 `--source-binding <file> --source-binding-sha256 <sha>` 指定合法的非固定源工作树；
- [x] **受保护根物理隔离**：可靠阻止候选源目录与运行时目录、持久化根、既有生产源目录发生等于、包含或被包含的物理重叠；
- [x] **不可变四元组绑定**：在批次、计划、清单与准备收据之间建立密码学强关联；
- [x] **向后兼容性保全**：在缺省 `--source-binding` 参数时，代码无缝回退至既有的 `workerSourceRoot` 固定根模式，未破坏旧批次校验；
- [x] **工具链与环境哈希冻结**：继承既有的全部非源码环境与工具链参数，未发生环境信息丢失。

### 2. 明确未证明与现存缺口（Unproved Gaps & Limitations）
- ⚠️ **未进行真实生产配对实测**：所有现有 160 项串行测试与 23 项契约测试均运行于合成 Seam 与测试夹具中，**尚未在实际生产环境中验证真实角色矩阵与 Windows 真实权限**；
- ⚠️ **8.3 短别名路径未经全面对抗实测**：虽然依赖 `realpath` 提供兜底保护，但 8.3 别名在复杂 Windows 挂载点下的边界尚未独立穷尽测试；
- ⚠️ **D1 退役机制暂未覆盖**：代码明确限制 `sourceBinding` 不能与 `adoptD1ControlRetirement` 共存，D1 控制退役机制不在本次支持范围内；
- ⚠️ **候选准备仍在进行中**：基于 `831c104ce32daac6c3257b949f62a53998f1414cef4aa1a89132271d54a4cd1f` Envelope 的在线 Worker 准备仍在校验前驱状态，终态的 Typed 候选制品与计划尚未就绪；
- ⚠️ **生产 Django 候选尚未制作**：尚未完成上述“仅更新 2 个工具模块”的同构 Django 候选制品的制作与哈希固化。

---

## 五、 最终审查裁决与建议操作次序

### 1. 最终审查裁决
- **逻辑与安全性裁决**：本次提交的 4 模块补丁（`47d73bc4...`）在实现源溯源绑定契约、防范路径逃逸与杜绝裂脑收集方面**在代码逻辑上严密完备**；
- **交付准许**：**本次已提供、已验证的 10 运行模块（完整 5160 文件）代码范围准予进行 Git 提交合并与隔离测试候选准备（Cleared for Git Delivery & Preparation）**；
- **生产控制令**：**坚决保留生产阻断**。严禁在未准备好同构 Django 候选前单独向生产推送 Worker 变更。

### 2. 必须遵循的首次采用操作次序（Mandatory Action Order）
为确保生产平稳自举，后续执行必须严格遵循以下步骤：
1. **源码锁定**：保持当前 5160 文件源码（`ad21d50d...`）与 10 模块补丁不变，推送到开发分支；
2. **制作同构 Django 候选**：在隔离环境使用原版 `PrepareApp`，仅更新 2 个工具文件制作 Django 候选，保留全部业务字节，记录其清单哈希 `newDjangoManifestSha256`；
3. **完成在线 Worker 准备**：使用 `831c104c...` Envelope 生成正式的 `workerPlanSha256` 与 `artifactSha256`；
4. **组装 Strict/Full 首批自举批次**：批次中同时绑定新的 Worker 清单与新的 Django 清单，强制配置 4 DB 阶段；
5. **提交最终独立复审**：在一切制品就绪后，提交本会话进行生产执行前的最终字节复核，获取正式生产维护授权。

