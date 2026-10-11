## 独立对抗审查报告（CLI 第 13 轮）

**审查对象**：
1. 修正版只读门禁脚本：`adoption-scope-guard-v4.mjs`（SHA-256：`04655a323af97453b7ae38670a6470e495226e85c337fb9b0a72684726a54edd`）
2. 封存批次定义：`ADOPTION_BATCH_V4.json`（SHA-256：`65fc5338321efc2d79168764f7b2227002333199d038409dc6dd7277acaed8d2`）
3. 关联候选与前驱链：Worker 候选（Manifest `58cc236e...`、Plan `3fb9b0fe...`、Receipt `6accd380...`、Source `ef5cc058...`、SourceBinding `dc45c01f...`）；Django 候选（Manifest `85cf0699...`、PrepareApp `1e1138...`、Receipt `10db2364...`）；生产基线 AB 链 219（`aaf62994`）、WAL 109（`5289afac`）。

**审查约束与立场声明**：
- **无生产授权**：本独立审查席位不具备生产环境授权、切换、服务启停、备份/恢复或数据写入权限。生产维护窗口执行仍处于绝对阻断状态。
- **纯文本静态审查**：本轮审查完全基于提供的源代码与文本凭证，不调用任何本地文件、Shell 或执行工具；所有测试（包内 166 PASS、collector 276.680s 跨阶段测试、合成 resolver 注入测试）均为初级代理与 Astra 在受控/隔离测试环境（VM）中的执行记录，非本座亲自执行，不得视同生产物理环境已完成验收。
- **纠正历史过强陈述**：撤回并纠正第 12 轮“异驱 8.3 短路径在数学上绝不可能解析至 D 盘”的错误论断。NTFS Junction、符号链接及挂载卷允许跨驱动器重定向，且未加引号的长路径因空格截断可导致解析目标变形。本系统不存在“绝对形式闭环”或“两组件跨系统瞬时原子事务”，维护期内客观存在新 Worker 与旧 Django 的受控并存阶段，依赖 CAS 锁、Owner 状态与排他维护窗口保证不发生并发修改与无效保留。

---

### 一、第 12 轮 4 项泄漏反例在 V4 中的对抗复核与闭合判定

在第 12 轮中，Astra 通过合成 resolver 复现了原 V3 门禁的 4 类绕过风险。以下为对 V4 实现的逐项对抗审查：

| 漏洞反例类型 | 原 V3 泄漏根因 | V4 修复机理代码实现 | 对抗审查结果 |
| :--- | :--- | :--- | :--- |
| **1. 跨盘 8.3 短路径绕过**<br>（如 `C:\PROGRA~1\...\JUNCT~1` 指向 `D:\...`） | V3 存在 `token[0] !== target[0]` 的早退短路，非 D 盘驱动器字符直接跳过解析。 | V4 彻底移除了首字符驱动器过滤短路，所有绝对路径 Token 统一进入 `physicalReference(token)` 解析。 | **已闭合**。跨盘短别名必须解析其实体目标，不再被前置驱动器检查漏放。 |
| **2. 跨盘长路径 Junction 绕过**<br>（如 `C:\mount\release_point` 链接至 D 盘） | V3 对非目标驱动器的长路径完全未调用底层 `realpath`。 | V4 对所有绝对路径均执行 `actualRealpathSync`；若命中 Junction，底层的真实文件系统实体路径将被完整还原为目标盘符并进行前缀比对。 | **已闭合**。所有跨卷 Junction 的真实规范路径均在解析阶段被捕获。 |
| **3. 同盘长路径 Junction 绕过**<br>（如 `D:\alt_alias\app` 符号链接至被禁目录） | V3 若未触发逐级递归规范化，存在中间目录符号链接未彻底解开的边界。 | V4 的 `physicalReference` 强制执行物理 `realpathSync`，无论别名形式如何，均展开为规范真实物理链条。 | **已闭合**。只要底层由 NTFS 重分析点实现，`realpathSync` 均会展开至规范物理节点。 |
| **4. 带空格单一工作目录截断**<br>（如 `D:\运营管理系统-sales-django-release\foo bar`） | V3 对包括 `WorkingDirectory` 在内的字段盲目按空格做 Token 切分，导致含有空格的长路径被破坏为两个无效碎片。 | V4 严格区分上下文：仅对 `CommandLine` 和 `Arguments` 设置 `commandLine: true` 执行引号/空格分词；对 `Execute`、`ExecutablePath`、`WorkingDirectory` 及 JSON 状态元数据，保持单个完整路径字符串解析，禁止空格切分。 | **已闭合**。避免了带空格路径因切词截断导致的前缀失配或无法解析。 |

---

### 二、Guard V4（`adoption-scope-guard-v4.mjs`）代码逻辑对抗审查

#### 1. 未就绪/不存在子路径重构机制（Missing Long Child Reconstruction）
在发布执行过程中，某些进程参数可能引用了尚未生成或刚被清理的下级文件（例如 `app.previous\deleted_child.py`）。
- **V4 算法**：
  ```javascript
  const missingParts = [];
  let current = resolved;
  while (current && !fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (!parent || parent === current) {
      throw new Error(`Path root does not exist: ${resolved}`);
    }
    missingParts.unshift(path.basename(current));
    current = parent;
  }
  const realAncestor = actualRealpathSync(current);
  const physical = path.join(realAncestor, ...missingParts);
  ```
- **对抗评估**：
  - **安全性**：若祖先路径存在真实 Junction，回溯至最近真实祖先节点调用 `realpathSync` 能正确重构出目标物理前缀，防止因叶子节点不存在而直接退化为“未引用”。
  - **Fail-Closed 闭环**：若重构链条中的任何 `missingParts` 包含 8.3 短别名字符（匹配 `/(?:~[0-9]+)/i`），或者真实祖先节点无法定位（到达根目录仍不存在），代码直接执行 `throw new Error(...)`，拒绝通过并标记为 Hard Error。
  - **权限与底层异常处理**：若 `realpathSync` 抛出 `EACCES` 或除 `ENOENT` 外的任何系统异常，V4 不做降级吞异常处理，直接向外抛出阻断，杜绝了静默误放。

#### 2. 无自动清理与纯只读约束
- 审查确认：V4 仅包含 `inspectReferences`、`fs.readFileSync`、`fs.realpathSync` 等只读操作及断言探测逻辑，不存在任何 `child_process.exec`、`taskkill`、`schtasks /delete` 或文件写/删/改操作。
- 门禁发现违规引用时，执行纯粹的拒绝退出（Exit Code 1 / Error Throw），不进行不可控的现场“自我修复”。

---

### 三、Batch V4（`ADOPTION_BATCH_V4.json`）一致性与四阶段 DB 闭包复核

#### 1. 签名与操作序列闭包
- **批次哈希**：`65fc5338321efc2d79168764f7b2227002333199d038409dc6dd7277acaed8d2`
- **操作项总数**：严格封存 20 项操作，与前驱链及生命周期状态机一一对应。
- **首次采用严格性（First Adoption Strictness）**：
  - `impact.level = 'strict'`，`recovery.mode = 'full'`。
  - `databaseOperations.required = true`，严格保留完整的 4 阶段数据库动作：
    1. `backup-pre`
    2. `restore-pre`
    3. `backup-post`
    4. `restore-post`
  - 确认规则：`tools-no-migration-v1` 仅将验证类目从 `migration-rehearsal` 置换为基于完整文件清单闭包证明的 `migration-closure`，**绝未给予 `not-required` 豁免权，绝未跳过任何真实的四阶段 DB 验证**。

#### 2. 组件双向绑定与安装物定位
- **Worker 侧**：
  - Manifest：`58cc236e09f097f2c7aec054af9699fc7c0aca3bda1cd79d1c47cbf06efd1a8f`
  - Plan：`3fb9b0fe083862da5a1a426b444a91365b2ec4fdecb0c4191c2c18f0a12ccb5b`
  - Receipt：`6accd3807b1e8d47b52ea7493a38a3d4f40f0c05763cb28185c074be2e7a1772`
  - Source：`ef5cc058...`（5160 文件，SourceBinding `dc45c01f...`）
- **Django 侧**：
  - Manifest：`85cf06990d1fa7d82531da19c00aa16c68e1a1e05d01867c4ec83ebc2e74e4c2`
  - PreparedApp：`1e1138763ae37d1cf43ff99d0e19dd40049f578768a3fb70c3ba9a8d9a2ba188`
  - Receipt：`10db2364...`（前后各 2933 文件，严格限定仅 2 个 tools 脚本与 1 处 CF 缓存 6 个标量叶子变更）
- **物理路径锁定**：发布目标仍严格锁定于物理路径 `D:\运营管理系统-sales-django-release`，杜绝任何动态目录漂移。

---

### 四、剩余边界与本质未证明项（Boundary & Invariants）

在进入交付准备前，必须对以下物理与逻辑边界保持清醒，不得向用户作超越技术边界的承诺：

1. **真实 OS Junction / 重分析点的物理行为依赖**：
   Astra 的注入测试采用的是“合成 resolver”。在 Windows 真实环境下，底层调用的是 Node.js 封装的 Windows API（`GetFinalPathNameByHandleW`）。如果遇到极罕见的深度挂载点循环、RPC 挂载网络卷或安全软件拦截返回的异常错误码，系统将直接触发 Hard Block（Fail-Closed）。这保证了安全性，但在生产环境中遇到异常卷配置时会直接拒绝发布。
2. **两消费端在维护窗口内的受控并存期**：
   在 `op-apply` 完成至 `DeployApp` 生效的维护时间窗内，文件系统中存在“新 Worker 产物与旧 Django 运行时并存”的短暂物理事实。该事实**并非通过分布式事务保证**，而是通过“运维期间严禁执行备份、保留操作及外部业务写入”、“CAS 排他文件锁”以及“Owner 状态严格检查”共同维持的受控过渡。
3. **WAL 校验的有限观察语义**：
   批次末尾的 WAL 状态校验（109 条记录 / Head `5289afac`）仅能证实**在探测执行区间内，未发生被批准操作之外的并发写冲突**，并不能在逻辑上反向证明系统对未监控渠道具有全局全知能力。

---

### 五、独立终审裁定

基于对 V4 门禁代码逻辑、批次一致性以及 4 项漏洞闭合情况的对抗审查，本座给出明确区分的双重裁定：

```
[VERDICT]
1. 候选准备与打包交付：CLEARED FOR CANDIDATE PREPARATION
   - 确认 V4 只读门禁（04655a32...）已闭合第 12 轮指出的 4 项引用泄漏风险，具备 Fail-Closed 特性。
   - 确认 Batch V4（65fc5338...）严格封存 20 项操作，Worker 与 Django 候选双向签名绑定一致，保留严格四阶段 DB 约束。
   - 允许将上述 10 项控制文件、门禁脚本及封存批次定义纳入 Git 交付分支、执行准备打包与离线证据归档。

2. 生产环境执行权限：PRODUCTION BLOCKED (STRICTLY RESERVED)
   - 任何生产主机切换、服务重启、维护窗口开启、真实数据库 Backup/Restore 操作以及生产业务写入，均未获得授权，严禁执行。
```
