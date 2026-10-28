# `release-payload-retention.mjs` 的安装路径：只读查清与方案（2026-10-29）

本文件为**只读调查**产出。未执行任何准备、部署、维护或发布动作，未改动 `D:/teruisi-runtime/`。

## 0. 结论

**不存在"不生成生产应用包就能装上这个文件"的受支持路径。** 该文件只能随 Django 应用树整体安装，即 `PrepareApp` → `DeployApp`。

这与我上一轮引用 `验证与发布.md:129`（"测试或无应用载荷的离线工具…不生成生产应用包"）得出的"本次不该准备制品"**冲突**。冲突是真实的，不是我前一轮判断有误、也不是规范有误，而是**本次改动恰好落在规范分类的缝隙里**：它在文本上是"离线工具"，但在安装机制上被绑进了 Django 应用载荷。这个取舍必须由用户定，不能由我单方面选一边。

## 1. 查到的机制

### 1.1 该文件在 `Prepare-Application` 的复制清单里

`tools/django-local-service.ps1:2089` 定义 `Prepare-Application`（对应动作 `PrepareApp`，见 `:3-4` 的 `ValidateSet`）。它在 `$staging` 下建 `backend/ config/ tools/ drizzle/ runtime-tools/`，再逐项复制一份**写死的工具清单**，其中包含（`:2163-2164`）：

```
"tools\release-payload-retention.ps1",
"tools\release-payload-retention.mjs",
```

所以这两个文件**是** Django 准备包的一部分。`:2163` 之前还有 `django-postgres-maintenance.ps1`、`postgres-backup-retention.ps1` 等同类运维脚本——整条运维工具链都走这条路。

### 1.2 `DeployApp` 是整树换入，不是单文件覆盖

`tools/django-local-service.ps1:2401` 的 `Deploy-Application`：

1. 拒绝从已安装 app 自我覆盖（`:2402-2404`）；
2. `Assert-ProductionMaintenance "DeployApp"`；
3. `Assert-ApplicationDeploymentStopped "DeployApp"`；
4. 把现 `app/` **整体 Move 成 `app.previous`**，再把 staging **整体 Move 成 `app/`**（`:2417-2423`）；
5. 失败时自动回滚（`:2424-2428`）；
6. 结束时提示"安装自启动前还必须执行 `HardenAcl`"。

即：**没有"只替换 tools 下一个文件"的入口**。回滚入口是 `Rollback-Application`（`:2434`），同样是整树。

### 1.3 前置条件很硬（这是方案取舍的关键）

`Assert-ProductionMaintenance`（`:4873`）在 runtime root 恰为 `D:\teruisi-runtime\django-sales` 时要求：

- 必须已通过 Worker 生命周期控制器 `EnterMaintenance`（`:4877`）；
- `Assert-SalesRetirementWorkerStopped`（`:4878`）；
- `state\worker-process.json` **必须已被受控 Stop 清除**（`:4881-4883`）——注释说明端口空闲不算，supervisor 可能正在换子进程。

`Assert-ApplicationDeploymentStopped`（`:3049`）按维护模式是否保留 PG 分两路：保留则要求应用进程停止且 PG 仍 ready；否则要求连 PG 一起停（`:3057-3061`）。

**含义**：装这个修复要**停 Worker**。当前生效头 `20261028T125857Z-7f8e70a23ee72777` 的 supervisor（PID 2500）必须经受控 Stop 清掉收据。这是一次有停机的生产维护，不是一次轻量文件更新。

### 1.4 另一条机制（native-tools）不覆盖本文件 —— 已排除

`tools/install-main-prebuild.mjs` 有 `--native-tools-update`，这正是 installer-0038 当初把 `maximumSuccessors` 256→512 装上去的路子，看起来像"不建应用包就换工具字节"的通道。但它的两个闭包按字节只钉**三个文件**（`:39-50`）：

```
tools/worker-local-release.mjs
tools/worker-local-release-rotation.mjs
tools/d1-retirement-proof.mjs
```

`release-payload-retention.mjs` **不在其中**，且 `validateNativeToolsUpdate`（`:51-58`）用 `assert.deepEqual` 对清单做精确比对、`successor512` 版本还钉死 publisher 配置摘要（`:55`）。往里加文件等于定义第三代闭包，属改发布工具本身——范围远超本需求，且触及被钉死的文件。**此路不通。**

## 2. 为什么会有这个冲突

`验证与发布.md:7` 要求按差异定范围："共享运行库、依赖、配置、**发布工具**或未知变化保持完整组件流程"。
同文件 `:129` 又说："测试或无应用载荷的离线工具…不生成生产应用包"。

本次改动同时命中两条：`release-payload-retention.mjs` 是**运维/发布工具**（指向 `:7` 的"完整组件流程"），但不是 Django 业务应用代码（指向 `:129` 的"不建包"）。规范没有为"被绑进应用包的离线工具"这一类单独写规则。

`:87` 还有一句旁证支持走完整流程："共享/未知变化按既有完整流程，**不用拆文件、改路径或声明"离线"绕过范围计划**"——这正好否掉了"手工拷一个文件进去"的做法。

## 3. 三个候选方案

### 方案 A：按完整组件流程走 `PrepareApp` → `DeployApp`（推荐）

依 `:7` 与 `:87` 把它当"发布工具变化"处理，走标准两步。

**优点**
- 唯一受支持、有收据、有自动回滚（`app.previous`）的路径；
- 字节由 `Assert-ApplicationTreeManifest` 校验，装完 `release-batch.mjs` 的 `verifyInstalled()` 仍自洽；
- 不碰任何被钉死的文件，不需要新闭包。

**代价**
- 需要 `EnterMaintenance` + 受控 Stop Worker（停机），再 `DeployApp` + `HardenAcl` + Start；
- 整树换入原则上会把自上次 Django 部署以来的全部改动一并装上。**本次已核清，无此风险**（见第 3.1 节）：已安装制品的源码提交正是 `1b02c937`，与我的合并基一致，净差异只有我这一个提交；
- 与 `:129` 的字面表述不一致，需用户明确采纳 `:7`/`:87` 的解释。

### 方案 B：暂不安装，等下一次 Django 发布顺带装上

把修复留在 `main`，等任何一次因业务需要而发生的 Django 发布自然带上。

**优点**：零额外停机、零额外风险。
**代价**：生效时间不可控；在此之前清理持续自锁。但注意——**备份线自 10-19 起失败，清理本来就不会被触发**（`django-postgres-maintenance.ps1:2418` 只在 Backup 成功后调用），所以"等下一次发布"的实际损失可能为零。空间仍有 56 GB，不紧迫。

### 方案 C：手工拷文件到 `app/tools/`

**不推荐，建议直接排除。** `:87` 明文禁止"拆文件…绕过范围计划"。且会使已安装树的 `Assert-ApplicationTreeManifest` 指纹与 `deployment.json` 不符，破坏部署身份与回滚锚点，并可能让 `release-batch.mjs` 的 `verifyInstalled()` 抛 "Installed recovery consumer bytes changed"。属无收据的生产写入。

### 3.1 方案 A 的"顺带上线"风险已排除（实测）

已安装 Django 制品 `D:/teruisi-runtime/django-sales/app/deployment.json`（部署于 2026-10-28T21:34:15+08:00）：

```
sourceRoot      D:/codex-isolated/main-release-packages/1b02c93791bb-d349107e-99df9f68/source
appFingerprint  6defc323b2ef086781a17e4f4a1048f97e454c2fb1375bf4f1204e599e863171
fileCount       3142
```

`sourceRoot` 的包名含 `1b02c93791bb`，即源码提交 **`1b02c937`**——恰为我这次的合并基。

`1b02c937..c0d3c894` 中会进 Django 包的文件只有两个：

```
tools/release-payload-retention.mjs     ← 本次修复
tools/storage-retention-policy.mjs      ← 本次同源对齐（不在 Prepare 清单内，实际不入包）
```

`backend/` 零改动，`tests/` 不入包，其余全是文档。**所以方案 A 的整树换入本次只会带上我这一个修复，不存在顺带上线未预期内容的风险。** 这消除了方案 A 原本最大的顾虑。

注：`storage-retention-policy.mjs` 不在 `Prepare-Application` 的复制清单里（清单只有 `release-payload-retention.{ps1,mjs}`），所以它那处对齐属纯源码一致性修复，不随本次安装生效，也无需生效。

### 3.2 当前运行状态（决定方案 A 的停机成本）

- `state/worker-process.json` **仍存在**（supervisor PID 2500，10-28 22:02），即 Worker 正常运行中；
- `django-sales/run/` 下未见维护标记，系统**不在**维护模式。

所以方案 A 需要完整一轮：`EnterMaintenance` → 受控 Stop Worker（清除收据）→ `DeployApp` → `HardenAcl` → Start。这是一次真实停机。

## 4. 建议

**倾向方案 B（暂不安装），理由是时序而非风险。**

方案 A 的技术顾虑已排除：净差异只有我这一个提交（3.1 节），整树换入很干净，而且有 `app.previous` 自动回滚。

但**现在装上也收不回空间**：清理只在 PG 备份成功后触发（`django-postgres-maintenance.ps1:2418`），而备份自 10-19 起失败、仍在另一条线上查。所以方案 A 现在要付一次真实停机（3.2 节：停 Worker、清 supervisor 收据），换来的是一个**暂时不会被触发**的修复。D 盘仍有 56 GB，不紧迫。

更划算的时序：等备份线修好、确实要跑清理时再装。那时若已有别的 Django 改动同行，停机成本可摊薄；若没有，也只是把同样一次停机往后挪，不增加成本。

**何时该改选方案 A**：备份线即将修好、或 D 盘可用继续下探（我给的参考线是跌破 30 GB）、或用户不愿让修复在 `main` 上长期未生效。那时直接走 A，不需要补做任何核查——3.1 节已经核完。

## 5. 待用户决定

1. 选 A（尽快生效、需一次停机；技术顾虑已排除）还是 B（等备份修好/下次 Django 发布顺带）。C 建议直接排除；
2. 规范层面是否要为"被绑进应用包的离线工具"补一条分类，避免下次再撞同一个缝隙（属文档任务，可另开）。

---

## 6. 决定：采用方案 B（2026-10-29，用户确认）

用户选定**方案 B：暂不安装**，等备份线修好或下次 Django 发布顺带装上。本任务到此结束。

### 当前确切状态

| 项 | 状态 |
| --- | --- |
| 修复代码 | 已在 `origin/main`，最终提交 `c0d3c894` |
| 生产已安装字节 | **仍是 257 的旧版**（`release-payload-retention.mjs` sha256 前缀 `d339fb1eaac5`） |
| Django app 指纹 | `7948e85c0bea844c`，未变；源码提交仍为 `1b02c937` |
| Worker | 正常运行（supervisor 收据在位），未进维护 |
| release 目录 | 343 个，未动；D 盘 56 GB 可用 |

**即 `main` 与生产在这个文件上是有意不一致的，不是漏装。** 见本文件第 3 节与第 4 节的理由。

### 遗留事项（本任务不做）

1. **安装该修复**：待备份线修好、或任何一次 Django 发布顺带。走方案 A 的 `PrepareApp` → `DeployApp`，差异范围已核完（3.1 节），无需补查。
2. **PG 备份自 2026-10-19 起失败**：另一条线在查。**清理的触发前提**，不修好则清理不会被调用。
3. **链外 71 个目录 / 49.96 GB**：按策略永不自动清理，处置建议暂不处理，见 REPORT.md 第 6 节「补充」。
4. **链根保护缺口**：`current-deployment.json` 指向的 bootstrap release 不受 pinned/last-3/窗口任何保护；当前已瘦身故无害，建议择机写入 `state/release-retention-protection.json`（属生产写入，需单独授权）。
5. **规范缝隙**：`验证与发布.md` 未为「被绑进应用包的离线工具」分类，`:7` 与 `:129` 对本类改动给出相反指引。建议另开文档任务补一条，避免下次重复这轮讨论。

### 改选方案 A 的触发条件

备份线即将修好、D 盘可用跌破 30 GB、或不愿让修复长期停在 `main` 未生效。
