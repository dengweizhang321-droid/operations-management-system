# release 保留清理被自锁：调查与方案（2026-10-29）

本报告为**只读调查**产出。未删除、移动或修改 `D:/teruisi-runtime/` 下任何文件，未改动任何代码，未合并、未准备制品、未发布。所有数字为本轮实测。

## 0. 结论速览

| 项 | 交接前提 | 实测结果 |
| --- | --- | --- |
| 阻断原因 | 343/344 个目录超过 257 上限 | **错**：被判断的是 successor **链长 272**，目录数从不进入该判断 |
| 257 的性质 | 疑似经过审阅的硬上限 | **是失配的派生常量** = 1 + 旧 `maximumSuccessors`(256)；2026-10-20 上限提到 512 时漏改 |
| 未瘦身数量 | 约 32 个 ≈ 25 GB | **111 个**；链内候选可回收 **33.77 GB**，全树未瘦身共 **93.15 GB** |
| 堆积起点 | 10-19 备份失败之后 | 更早：最老未瘦身链内版本为 **10-13**，全树最老为 **09-23**（链外） |
| 改 retention 代码 | 需追加第四代闭包 | **不需要**，该文件不在三代闭包内；但必须走 Django 发布才能生效 |

一句话：**这不是一个自锁，是两个独立缺陷叠加**——(a) 257 失配挡住链内清理；(b) 链外 71 个目录按策略本就永不自动清理，占 49.96 GB。只修 (a) 收不回 (b)。

## 1. 现状实测

### 1.1 磁盘与目录

- D 盘：437 GB 总、**56 GB 可用、88% 已用**（`df -h /d`）。
- `D:/teruisi-runtime/teruisi-worker-sales/releases/`：**343** 个目录（交接写 344，实测 343）。
- successor 记录：`state/worker-release-successors/` 542 文件 = **271** record + 271 sidecar。
- 链长 = 1 bootstrap + 271 successor = **272**，sequence 覆盖 1..271，无环、无分叉、无缺目录。
- `state/release-retention-protection.json`：**不存在**（ENOENT）→ 显式保护集为空。

### 1.2 两套机制的实际关系（删任何目录前必须理解）

- **生效头（successor 链尾）**：`20261028T125857Z-7f8e70a23ee72777`，与 `state/worker-process.json` 的 `releaseId` 一致，supervisorPid 2500。
- **前驱**：`20261027T131435Z-b1714d1611033bc6`。
- **`current-deployment.json`**（位于 `teruisi-worker-sales/` **顶层**，不在 `state/` 下）指向 `20260829T194525Z-9a33f178481e6c8e`。

实测结论：该 releaseId **正是 successor 链的 bootstrap（链根）**，且与 `state/sales-postgresql-authority.json` 的 `workerReleaseId` 一致。所以两套机制不是互相冲突，而是**一个指链根、一个指链尾**。

> **风险点**：链根已被瘦身（四个 payload 目录均不存在），且按现行保留算法它既不在 pinned、也不在 last-3、也不在 7 天窗口内——即**它是算法眼中的 candidate，却同时是活指针与回滚锚点**。目前它恰好已无 payload 可删，所以无害；但该保护缺口是真实的，任何方案都必须显式把它钉住。

### 1.3 链内 / 链外划分

| 分区 | 目录数 | 未瘦身 | 已瘦身 |
| --- | --- | --- | --- |
| 链内（in-chain） | 272 | 51 | 221 |
| 链外（out-of-chain） | 71 | 60 | 11 |
| **合计** | **343** | **111** | **232** |

无"半瘦身"目录：343 个目录要么四个 payload 齐全，要么全无（0 例不一致）。

### 1.4 空间账（Python 递归字节求和，非 du 估算）

| 分区 | dist | helper | source-snapshot | node_modules | 小计 |
| --- | --- | --- | --- | --- | --- |
| 链内 51 个未瘦身 | 0.74 | 0.09 | 7.22 | 35.14 | **43.19 GB** |
| 链外 60 个未瘦身 | 0.85 | 0.10 | 7.73 | 41.29 | **49.96 GB** |
| 合计 | 1.60 | 0.19 | 14.95 | 76.42 | **93.15 GB** |

**按现行策略真正可被工具回收的只有 33.77 GB**（链内 261 个 candidate 中 40 个尚带 payload：node_modules 27.52 + source-snapshot 5.61 + dist 0.57 + helper 0.07）。该数字由两条独立计算路径分别得出并一致。

单个未瘦身版本约 807 MB，文件数：node_modules 31418、source-snapshot 9268、dist 183、helper 4；非 payload 文件 29 个。

## 2. 257 的由来：失配的派生常量（已查实，非推测）

### 2.1 算术关系

`tools/release-payload-retention.mjs:17` 的被判断对象，由同文件第 57 行构造：

```js
const bindings = [chain.bootstrap.binding, ...chain.records.map((record) => record.value.successor)];
```

即 `releases.length === 1 + successorCount`，恒等。而 `tools/worker-local-release-rotation.mjs:66` 的 `maximumSuccessors` 决定 successorCount 上限。

- 两个 retention 文件写入时 `maximumSuccessors = 256` → `1 + 256 = 257`。
- 提交 **`20eea975`（2026-10-20，"extend the reviewed successor capacity to 512"）** 把上限提到 512，**未改动** `release-payload-retention.mjs` 或 `storage-retention-policy.mjs`。
- 与 512 一致的值应为 **513**。257 自 10-20 起即为僵值。

现场正好落在失配区间：链长 272 > 257，但 272 < 513。

### 2.2 它不是"经过审阅的上限"

- `tools/release-payload-retention.mjs` 由 `73e605598`（2026-09-28）引入，`storage-retention-policy.mjs` 由 `4ce99770a`（2026-09-13）引入，两者**落地时 `> 257` 即已存在**，两份随附文档（现 `docs/运维/备份与存储/backup-retention.md`、`storage-retention.md`）**均未提及** 257、256 或 `maximumSuccessors`。无任何评审记录把"bootstrap + N successors"与 257 这个字面值关联。
- 容易被误读为"审阅过"的来源是 `docs/历史记录/性能与发布/worker-successor-capacity.md`，其正文写"**257**、非法序号、分叉…继续拒绝"。但那里的 257 指 **rotation 自己的 successor 序号边界**（第 257 号必须被拒），与 retention 的数组长度守卫是**文本相同、语义不同**的两个数。该正文仍是 256 时代文本，`20eea975` 只在顶部加了更新说明，正文未改写——这正是误读的根源。
- 真正经过审阅的是 512：`docs/worker-successor-capacity-512-20261020/REPORT.md` 记载起因为生产链打满 256/256、JD 客服发布无法追加 sequence 257，决策明确"只解决容量检查点，不改变前驱/后继语义"——**范围限定在 rotation 模块**，这解释了为何两个 retention 文件被漏掉。

### 2.3 测试覆盖缺口（修复时必须补）

现有测试**没有任何一条**断言这两个文件的长度边界：

- `tests/release-payload-retention.test.mjs`：只用 1–7 元素数组。
- `tests/storage-retention-policy.test.mjs`：只用 1–10 元素数组。
- `tests/release-retention-scope.test.ps1`、`storage-dependency-cleanup.test.ps1`、`storage-retention.test.ts`：无长度逻辑。

**把 257 改大、改小甚至删掉，现有测试全部静默通过。** 对照：rotation 自己的序号边界测试已在 `20eea975` 同步更新为接受 256/257/512、拒绝 513。缺的正是 retention 侧的同类覆盖。

### 2.4 同源缺陷

`tools/storage-retention-policy.mjs:32` 有同一个 `> 257`。该文件**未安装到生产**（`D:/teruisi-runtime/django-sales/app/tools/` 下不存在），不在本次失败路径上，但属同源僵值。

## 3. 保留策略语义核对

`backup-retention.md` 第 9 条与代码逐项比对：

| 文档表述 | 代码实现 | 一致性 |
| --- | --- | --- |
| 保留最近七个完整 24 小时 | `:27` `createdAt >= clock - 7*86400000` | 一致 |
| 当前版本 + 最近两个前驱保留完整包 | `:26` `releases.slice(-3)` | 一致 |
| `release-retention-protection.json` 显式保护 | `:67-74` 读取，缺失按 ENOENT 容忍 | 一致（当前文件不存在 → 保护集空） |
| 只清理 dist/helper/source-snapshot/node_modules | `:7` `payloadNames` | 一致 |
| 其他清单/工具/guard/authority/successor/审计材料保留 | `:41` metadata() 跳过 payload 名并逐一哈希留证 | 一致 |
| **链外目录不自动清理** | 见下 | **一致，且这是关键** |

### 3.1 链外目录对该工具是不可见的

全文件只有一处 `readdir`（`:40`），位于 `metadata()` 内部，只walk**某个 candidate 版本自身**的非 payload 文件。`releases/` 目录**从未被枚举**：清单完全来自 `state/` 的 successor 记录。

因此链外 71 个目录（含 60 个未瘦身、**49.96 GB**）**在任何 257 取值下都不会被这个工具回收**——这不是 bug，是文档明文规定的设计（"链外目录不自动清理"）。它们是历史上准备后未激活的候选版本，最老可追到 2026-09-23。

### 3.2 对交接"堆积起点"判断的修正

- 最新已瘦身版本 `20261011T090355Z-21c2645a63247749`：**确认**。
- "最旧未瘦身是 `20261019T104309Z`"：**不成立**。该版本确为链内未瘦身，但不是最旧。链内最旧未瘦身是 **`20261013T034151Z-1513c2b267930390`**（10-13），10-13 至 10-19 之间另有 35 个链内未瘦身版本。全树最旧未瘦身是 **`20260923T014457Z-8622abbe3d7796f2`**（09-23，链外）。
- 含义：清理失效**早于** 10-19 备份失效。备份失败只是最后一段的原因，不是全部原因。瘦身呈交错而非干净切点，与"工具只按链序走、链外从未被任何瘦身轮次触及"吻合。

## 4. 触发链与阻断点

```
每日 PG 备份（10-19 起失败，另一条线）
  └─ django-postgres-maintenance.ps1:2418  if Action -ceq 'Backup' 且策略存在
       └─ release-payload-retention.ps1 -Execute
            ├─ :22-23  要求必须是已安装 operator（D:/teruisi-runtime/django-sales/app/tools/）
            ├─ :53     抢占 Local\TERUISI.Worker.LocalService.v1 互斥（WaitOne(0)，不等待）
            ├─ :56     node release-payload-retention.mjs   ← 此处失败
            │            selectReleaseRetention: 272 > 257 → "Invalid retention inventory"
            └─ :57     throw "Release retention preflight failed"
```

**两个故障各自独立**：备份修好后，257 失配仍会让清理在 preflight 阶段失败。反之修好 257，清理仍需等备份成功才会被触发。

### 4.1 规划阶段成本（实测，影响方案选择）

planner 对每个 candidate 的每个 payload 做全树哈希比对（`:94-97`，`hashTree` 对不上即 `Old payload changed; cleanup refused`）。在本机实测（Node 内进程、并发 8）：

- node_modules：31418 文件 / 709 MB → **约 65 秒**
- source-snapshot：9268 文件 / 147 MB → 约 5 秒
- dist：183 文件 / 16 MB → 约 1.3 秒

合计**每个未瘦身版本约 72 秒**。40 个带 payload 的 candidate → **约 48 分钟**，且 `:53` 抢到的互斥**全程持有**到 `:103`。这期间 Worker 生命周期操作（发布、启停、维护）会被拒（"Worker lifecycle is busy"）。该脚本调用处无超时限制（已查 `django-postgres-maintenance.ps1` 与计划任务 `ExecutionTimeLimit`）。

这是方案一的真实代价：一次约 48 分钟的生命周期锁窗口，需安排在非发布时段。

## 5. 改动可行性（与交接假设不同，已逐项核实）

| 约束 | 核实结果 |
| --- | --- |
| 三代闭包（`preparation-producer-qualification.mjs`） | 只含 `publish-prepared-main.mjs`、`worker-local-release-rotation.mjs`、`worker-local-release.mjs`。**两个 retention 文件均不在内 → 改它们不需要追加第四代闭包。** |
| `workerGuardEntrypointPaths` | 含 rotation 与 `d1-retirement-proof.mjs`，**不含** retention 文件。 |
| Django 部署 keyFiles（`django-local-service.ps1:2163-2164`） | **含** `release-payload-retention.ps1` 与 `.mjs` → 改动必须走 **Django 发布**才能装到 `D:/teruisi-runtime/django-sales/app/tools/` 并生效。 |
| `release-batch.mjs:122` targetedConsumerFiles | **含** `release-payload-retention.mjs`。比对对象是该 batch 自身 `scopeValidation.after.inventory` 记录的哈希（非源码里的历史冻结值），但该 inventory 在 batch 构建时取自**当时已安装文件**，`verifyInstalled()`（`:155`）会重新哈希并在不符时抛 "Installed recovery consumer bytes changed"。即：**按 batch 重新生成，但在单个 batch 生命周期内仍表现为钉死**——不得在某 batch 的 inventory 已采集、而其 targeted-recovery consumer 尚未运行的窗口内改这个文件。 |
| `package.json` | 本次方案**完全不需要触碰**。 |
| 仓库 vs 已安装副本 | `release-payload-retention.{ps1,mjs}`、`worker-local-release{,-rotation}.mjs` 当前字节**完全一致**，无漂移。 |

## 6. 三个候选方案

### 方案一：把 257 对齐为 513（推荐）

**改动**：`tools/release-payload-retention.mjs:17` 的 `257` → `513`；同步 `tools/storage-retention-policy.mjs:32`；补边界测试（512/513 接受、514 拒绝）；改写 `worker-successor-capacity.md` 过时正文。

**为何安全**
- 513 = 1 + 512，与 `maximumSuccessors = 512` 严格一致，不是"随意调大"，而是**恢复本应有的派生关系**；512 本身已于 10-20 经评审采用。
- 守卫的作用是"拒绝无界输入"，上界仍为源码级固定值，不引入环境变量或 CLI 覆盖，符合 10-20 决策"上限仍是源码级固定有界值"。
- 不触碰任何选择逻辑：pinned、last-3、7 天窗口、哈希校验、互斥、审计全部原样。
- 已在隔离脚本中用合成链验证：链长 272 在 bound=257 时抛 `Invalid retention inventory`，bound=513 时正常返回（retained 30 / candidates 242）；514 仍被拒。该验证在 scratch 副本进行，未改动仓库或生产文件。

**代价与风险**
- 必须走一次 Django 发布（keyFiles 约束），需用户按 AGENTS.md 第 4 条分三步各自授权。
- 首次成功运行将有约 48 分钟的生命周期锁窗口（见 4.1），须排在非发布时段。
- 只解决链内 33.77 GB，**链外 49.96 GB 不受影响**。
- 链长逼近 513 时同一问题会再现——但这次带了边界测试，且文档会写明派生关系。

**回收**：33.77 GB → D 盘可用约 56 → 90 GB。

### 方案二：先手工清理降到 257 以下，再让工具接管

**不推荐，且存在一个硬障碍。**

要把链长 272 降到 ≤257，需要削掉 15 个**successor 记录**——不是删目录。删目录完全不改变链长（目录数不进入该判断），所以"分批手工清理把数量降到 257 以下"这个思路**对 257 失配无效**：它针对的是一个不存在的因果。

若改为"手工删 payload 腾空间、不碰链"，则：
- 可行，但绕过了工具的全部安全机制：哈希比对（确认 payload 未被篡改）、活引用扫描（进程/服务/计划任务/启动项命令行）、reparse point 拒绝、逐条持久审计、前后 chainStateSha256 比对。
- 与 `backup-retention.md`"所有删除绑定精确目录和清单摘要，并写入持久审计"直接冲突。
- 需要人工保证不碰链尾三个与链根，而链根恰好是最容易被漏掉的那个（见 1.2）。
- 属 AGENTS.md 第 6 条"生产维护、数据写入"，需单独授权，且无回执可查。

唯一值得保留的变体：**只手工处理链外目录**（见方案三的补充部分），因为那部分工具在任何情况下都不会碰。

### 方案三：改清理脚本支持分页/分批处理超量库存

**改动范围最大，当前不必要。**

把 planner 改成对 candidate 分批（如每批 20 个）产出计划并分次执行。

**优点**：规避单次 48 分钟锁窗口；对将来链长超 513 也有效。

**缺点**
- 改的是产出计划与执行回执的结构，牵动 `release-payload-retention.ps1` 的 `Assert-RetentionTarget`、审计 schema、以及 `release-batch.mjs` 的 targeted consumer 契约——属"改变语义"，远超 10-20 决策所划的"只改容量检查点"。
- 分批执行意味着多次 chainStateSha256 比对窗口，中途若链变化需定义回滚语义，新增失败模式。
- 当前链长 272 远低于 513，分页解决的是尚未发生的问题，违反 AGENTS.md 第 3 条"只做本需求所需的修复或扩展"。

**建议**：不在本任务做。若 4.1 的 48 分钟锁窗口被判定不可接受，优先考虑的不是分页，而是把首次执行安排在维护窗口。

### 补充：链外 49.96 GB 如何处置（独立决策）

71 个链外目录、60 个未瘦身、49.96 GB，按策略永不自动清理。这是比 257 更大的一块空间，但**性质不同**：它们是未激活候选，不在任何回滚路径上，也无工具覆盖。处置选项：

1. **暂不处理**（最保守）。修好方案一后可用空间约 90 GB，不紧迫。
2. 为链外目录**另立**一个受控清理工具，复用现有安全机制（哈希、活引用扫描、审计）——是一次独立的开发任务，需单独评审与授权。
3. 人工清理——同方案二的全部缺点。

建议选 1，待方案一落地、空间缓解后，再按独立任务评估 2。

## 7. 安全边界清单（任何执行前必须逐条确认）

**绝对不可删的目录**

| releaseId | 身份 | 当前 payload |
| --- | --- | --- |
| `20261028T125857Z-7f8e70a23ee72777` | 生效头（链尾）；`worker-process.json` 指向，supervisorPid 2500 | 完整 |
| `20261027T131435Z-b1714d1611033bc6` | 前驱 1（last-3） | 完整 |
| `20261027T061221Z-298f565cfaaad6f6` | 前驱 2（last-3） | 完整 |
| `20260829T194525Z-9a33f178481e6c8e` | **链根 + `current-deployment.json` 指向 + `sales-postgresql-authority.json` 的 workerReleaseId** | 已瘦身 |

加上 7 天窗口内共 **11 个**受保护版本（完整列表见 `chain-partition.txt` 与 `runtime-inventory-20261029.md`）。

**其他边界**

- `current-deployment.json` 在 `teruisi-worker-sales/` **顶层**，不在 `state/` 下；它指向链根而非生效头，两者是"链根 vs 链尾"两套指针，不可混淆。
- 链根在现行算法下**不受 pinned/last-3/窗口任何一条保护**。虽然它已无 payload 可删（当前无害），建议在方案一落地时**同时**把它写入 `state/release-retention-protection.json`，消除这个保护缺口。该文件目前不存在，需按 `teruisi-release-protection-v1` schema 新建（`:72` 要求键恰为 `releaseIds,version`）——属生产数据写入，需单独授权。
- `backup-retention.md` 第 11 条"磁盘空间不足、E 盘不可用、校验失败、保护项丢失或身份冲突时，不提前删除旧备份"同等适用于 release 目录：**执行前确认 D 盘仍有余量、11 个保护项全部在位、chainStateSha256 前后一致**。
- 执行期间工具会持有 `Local\TERUISI.Worker.LocalService.v1` 互斥约 48 分钟，期间不得发起发布或启停。
- `worker-release-publication-staging` 当前为空（无在飞发布），是执行的有利条件；执行前应重新确认。
- 不得在某 `release-batch` 的 inventory 已采集而其 targeted consumer 未运行的窗口内改动 `release-payload-retention.mjs`（见第 5 节）。

## 8. 建议

**采用方案一**，分三步，每步单独授权：

1. 在本 worktree 改两处 `257 → 513`、补 retention 侧边界测试、改写 `worker-successor-capacity.md` 过时正文；跑 `node --test tests/release-payload-retention.test.mjs`、`tests/storage-retention-policy.test.mjs` 与 lint。
2. 合并到 `main`（单独授权）。
3. 准备 Django 制品（单独授权）→ 发布（单独授权）。发布后清理仍需等一次成功的 PG 备份才会自动触发；若备份线未修复，可按 `backup-retention.md` 受控采用步骤的方式用已安装 operator 独立执行一次（2026-09-28 验收中已有此先例：自动回执 blocked、随后用同一工具独立执行成功）。

理由：根因是一行失配的派生常量，修复即一个字符，且是**恢复**已评审关系而非新增放宽；方案二对 257 失配根本无效，方案三解决的是尚未发生的问题。链外 49.96 GB 作为独立议题待定。

**待用户决定**
1. 是否采用方案一；
2. 是否同时新建 `release-retention-protection.json` 把链根钉住（需生产写入授权）；
3. 链外 49.96 GB 选 1/2/3 哪条；
4. 首次清理的维护窗口（约需 1 小时生命周期锁）。

---

## 附：方法与证据

- 链重建：直接读 `state/worker-release-successors/*.json` 的 predecessor→successor 链，未运行任何生产工具。
- 空间统计：Python `os.walk` 字节求和（`du` 在本机因磁盘争用过慢）。
- 候选与回收量由两条独立计算路径分别得出并一致（33.77 GB / 40 个候选 / keep 11）。
- 边界算术在 scratch 目录的隔离副本中用合成链验证，未改动仓库或生产文件。
- 逐版本明细：`chain-partition.txt`（链内/链外划分）、会话共享笔记目录下的 `runtime-inventory-20261029.md`（343 行）。

---

## 9. 施工记录（2026-10-29，方案一已实施，未 commit）

用户授权按方案一施工。并线分组执行，改动六个文件：

| 文件 | 改动 |
| --- | --- |
| `tools/release-payload-retention.mjs` | `releases.length > 257` → `> 513`；函数上方加两行注释说明该值为 `1 + maximumSuccessors`、须与 rotation 联动 |
| `tools/storage-retention-policy.mjs` | 同上（该文件未安装到生产，属同源僵值一并对齐）；扩充既有注释一行 |
| `tests/release-payload-retention.test.mjs` | 新增边界测试：513 接受、514 拒绝 |
| `tests/storage-retention-policy.test.mjs` | 新增边界测试：513 接受、514 拒绝 |
| `docs/历史记录/性能与发布/worker-successor-capacity.md` | **正文未改**（历史评审原件，AGENTS.md 第 7 条）；只在顶部更新说明追加一段，点明正文的 256/257 已被取代，并澄清那个 257 是序号边界、与数组长度守卫语义不同 |
| `docs/worker-successor-capacity-512-20261020/REPORT.md` | 「边界」节追加事后补记：本次漏改两个派生文件，今后调 `maximumSuccessors` 必须同步 |

未触碰 `package.json`、`worker-local-release*.mjs`、`publish-prepared-main.mjs`，未追加闭包（不需要），未动 `D:/teruisi-runtime/`。

### 审核时发现并修正的问题

两个边界测试初版把全部 513 个版本的 `createdAt` 设为同一时刻且等于 `now`，实测 `retained=513 / candidates=0`——全部落入 7 天窗口，**长度守卫没抛错即通过，真正的选择逻辑从未被执行**。这样的测试在 513 再次被改坏时仍可能通过，等于没补上 2.3 节指出的缺口。

已改为按每小时一个版本铺开、跨越 7 天窗口，并断言精确划分：

- `release-payload-retention`：513 条链 → `retained=169`、`candidates=344`；514 条抛 `/Invalid retention inventory/`。
- `storage-retention-policy`：513 条链 → `retainedReleaseIds=3`（keepLatest 默认）、`candidates=510`；514 条抛 `/Invalid retention input/`。

断言改为匹配精确错误信息，避免被无关异常冒充通过。

### 检查结果（必需代码检查，非业务功能验收）

| 检查 | 结果 |
| --- | --- |
| `node --test tests/release-payload-retention.test.mjs tests/storage-retention-policy.test.mjs` | **12/12 通过** |
| `npx tsx --test tests/storage-retention.test.ts` | **12/12 通过** |
| `node --test tests/release-first-adoption-targeted.test.mjs`（targeted-recovery consumer 契约） | **31/31 通过** |
| `powershell -File tests/release-retention-scope.test.ps1 -Scratch <空目录>` | **PASS** |
| `npx eslint` 四个改动文件 | **0 error / 0 warning** |

`node_modules` 以目录联结指向主工作区（链接非复制）。

### 仍待用户决定/授权

1. 合并到 `main`（AGENTS.md 第 4 条，单独授权）；
2. 准备 Django 制品（单独授权）→ 发布（单独授权）。本改动在 Django 部署 keyFiles 内，**不发布则不生效**；
3. 发布后清理仍需一次成功 PG 备份才自动触发；备份线未修复时可按 2026-09-28 先例用已安装 operator 独立执行一次（需维护授权）；
4. 首次执行约 48 分钟生命周期锁窗口，需排非发布时段；
5. 是否新建 `state/release-retention-protection.json` 钉住链根（生产写入，单独授权）；
6. 链外 71 个目录 / 49.96 GB 处置（建议暂不处理）。
