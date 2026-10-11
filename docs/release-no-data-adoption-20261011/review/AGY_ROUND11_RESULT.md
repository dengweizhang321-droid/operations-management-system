# TERUISI 首次采用具体范围与任务专用门禁独立对抗性审查报告（第 10 轮）

> **审查方**：Antigravity 独立审查席  
> **审计对象**：任务专用只读门禁（`adoption-scope-guard.mjs` / `GUARD`）、封存生成器（`SEAL GENERATOR`）、首批自举 SEALED 批次（`5e5e8e0c66c8c4a24f74cbefe247778d8d05a624c541bdd00b408bd6131eac0f` / 20 操作表）及关联候选输入  
> **审查基线**：真实已闭环 AB 前驱（W chain 219 `aaf62994`，W `f4e537`，D `237fbe`，WAL 109 `5289`，旧引擎 `strictfalse / unknown` 保留，owner absent）；新 Worker 清单 `58cc236e...`（源码 `ef5cc058...` 5160 文件，SourceBinding `dc45c01f...`）；新 Django 候选 `85cf0699...`（PrepareApp `1e1138...`，前后各 2933 文件）  
> **审查约束**：纯文本阅读审查，无本地文件/Shell/生产工具调用，不重新访问未授权资源；**不宣称已实跑测试，不宣称生产已通过；本席位绝对没有生产批准权力**。恪守有限文本审查边界，杜绝泛化背书。

---

## 一、 授权红线与基线事实裁决（Authority & Invariants）

1. **授权状态与生产红线维持**：
   - 用户已明确授权：代码开发、隔离环境验证、Git 分支合并推送，以及精确候选制品的在线准备；
   - **生产红线绝对维持**：生产服务切换、维护窗口开启、真实 Backup/Restore 执行、调度任务外发及生产业务数据库写入**均处于未批准状态，必须等待后续精确明确批复**；
2. **首次自举 4 阶段数据库操作保全**：
   - 封存批次 `5e5e8e0c...` 明确声明 `batch.recovery.mode === 'full'`，且 `databaseOperations.operationIds.length === 4`；
   - 4 个物理数据库阶段（`backup-pre`、`restore-pre`、`backup-post`、`restore-post`）**完整编排于 20 项操作中，绝无任何减免或绕过**；
3. **真实环境与测试局限性明示**：
   - 开发测试 187 项、包内 166 项 PASS（38.573s）及 6 项独立 C VM 断言重跑均发生于**受控测试环境，并非生产配对实测**；21 项离线测试未在包内；
   - 既有 PG 测试属于协议/Consumer/失败断言，不代表生产真实 PG 恢复已在生产完成；历史 50-55 分钟耗时仅为毛成本池，不作任何净省时间承诺。

---

## 二、 两消费者过渡顺序与原引擎调用闭环审查（Consumer Transition & Order）

本轮实现精准解决了第 9 轮指出的“已安装生产 Django 旧验证器排异”断层，核定其执行拓扑如下：

```
                    ┌────────────────────────────────────────────────────────┐
                    │      20 操作 Switch 阶段双消费者原子过渡拓扑           │
                    └────────────────────────────────────────────────────────┘
                                                 │
  [1] op-entermaintenance-drain (进入维护, Drain 确认)
  [2] op-stopworker-switch (停止 Worker)
  [3] op-apply (应用 Worker 候选文件 -> 磁盘就绪)
  [4] previous-reference-guard (前置门禁: 校验 Worker 已应用, 审计无进程/任务引用旧 app.previous)
  [5] op-deployapp-switch (DeployApp: 原子替换 Django app -> 新工具就绪)
  [6] op-hardenacl-switch (HardenAcl: 锁死 Windows 权限)
  [7] op-exitmaintenance-switch (退出维护)
  [8] op-startworker-switch (StartWorker: 注入双清单 SHA, 启动 Worker)
```

1. **时序与过渡协调严密性**：
   - `worker-apply`（操作 6）严格排在 `django-deploy`（操作 8）之前；
   - **零间隙保护**：生成器强断言 `!operations.slice(index('worker-apply')+1, deploy).some(v => ['backup','restore'].includes(v.kind))`，在 Worker 应用与 Django 部署之间**绝不运行任何备份或 retention 任务**；
   - **版本断层消除**：前置备份/恢复（`backup-pre` / `restore-pre`）运行于全量旧代码环境；后置备份/恢复（`backup-post` / `restore-post`）运行于 Worker 与 Django 工具均已双双升级至新版之后；线上绝不存在“新 Worker + 旧 Django 工具互跑”的排异窗口；
2. **启动治理保留**：
   `StartWorker` 仍保留原生产 `EnsureReady` 治理逻辑，包含了启动期必要的权限/接收器治理，真实且诚实地声明可能存在的启动伴随动作，不虚妄宣称“绝对零写”。

---

## 三、 任务专用只读门禁（`adoption-scope-guard.mjs`）对抗性审查

针对新增的独立门禁脚本进行全路径漏洞推演：

### 1. 引用审计完备性与 Unicode / 本机路径处理
- **审计深度**：
  脚本递归扫描了 `runtime/state`、`django-sales/run` 以及所有 `app.(prepare|deploy)-*.json` 凭据文件，强制断言无符号链接（`assert.ok(!info.isSymbolicLink())`）且单个文件不超过 32MB；
- **动态进程与计划任务审计**：
  通过原生 PowerShell 调用 `Get-CimInstance Win32_Process` 与 `Get-ScheduledTask`，导出所有进程的 `CommandLine`、`ExecutablePath` 及计划任务的 `Execute`、`Arguments`、`WorkingDirectory`；
- **Unicode 与换行符健壮性**：
  PowerShell 输出显式指定 `[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)`，避免 Windows 默认 GBK 编码截断含中文路径（如 `运营管理系统`）；
- **双向路径匹配（`isReference` 与 `mentionsTarget`）**：
  针对目标路径 `target`（`path.resolve(record.source).toLowerCase()`），通过 `v.replaceAll('/','\\').toLowerCase().includes(target)` 统一正反斜杠，能准确捕获带引号、参数混用或子目录调用的引用；
- **安全拦截效果**：
  一旦发现有任何运行中的进程或计划任务仍以待删除的 `app.previous` 为目标，`references` 立即非空，门禁强行中断发布，**阻止 `DeployApp` 物理删除正在被调用的文件**。

### 2. 跨阶段文件 Pins 的精确性与防误杀核定
- 在 `DeployApp` 执行前（`pre-deploy`），`app` 目录依然持有旧代码；门禁中 `applicationToolPins(!['EnterMaintenance','StopWorker','DeployApp'].includes(step))` 针对 `DeployApp` 设置 `post === false`，**精确比对旧 Django 工具哈希**，不会因为预判新代码而发生动作前校验误杀；
- 在 `DeployApp` 执行后（`HardenAcl`、`StartWorker` 及后续步骤），`post === true`，**精确比对新 Django 工具哈希**；
- 解决了跨阶段状态跳变导致 Pre-action Collector 校验必然失败的顽疾。

### 3. WAL 与状态不可变性防线
- 门禁在扫描首尾强断言：
  `assert.equal((await journalState(...)).previous, state.previous, 'WAL changed during previous-package guard');`
  确保只读门禁自身的扫描和查询行为**绝对未向批次日志注入任何虚假事件**。

---

## 四、 验收与回滚诚实性复核（Rollback & Acceptance Honesty）

1. **ID 重复缺陷已修复**：
   针对第一版因双 `VerifyStartup` 导致 `id` 重复被 `makeBatch` 拒绝的历史，本版已严格区分为 `op-verifystartup-acceptance` 与 `op-verifystartup-closeout`，原失败日志保留，新版通过；
2. **回滚契约的诚实性**：
   - 明确指出：**旧 AB 解析器无法读取包含 `sourceBinding` 的历史记录**；
   - 严禁在失败时盲目强制重新安装旧版 AB 控制工具（这会导致历史日志无法解析而崩溃）；
   - 发生异常时，系统保持当前的 Gate、Owner 与 WAL 状态，不执行自动静默回滚；必须通过新审查的兼容 Successor 进行前向修复；
   - 真实数据库恢复独立留待授权，**绝不轻率承诺“即时自动无感回滚”**；
3. **未知结果不重放**：
   维持原引擎语义，若出现未知超时或断言异常，批次停留在当前栅栏，严禁无状态重放。

---

## 五、 现存局限性与未证明缺口（Retained Limitations）

1. **8.3 短文件名（SFN）进程参数未独立实测**：
   若某些罕见遗留进程以 `D:\TERUIS~1\...` 形式启动，字符串 `mentionsTarget` 无法直接通过包含判定捕获（但目前已知生产服务均由规范长路径脚本拉起）；
2. **生产环境物理执行依然挂起**：
   批次生成器产出的 `ADOPTION_BATCH_SEALED_V2.json` 明确标注 `productionApproved: false, productionActions: 0`；生产现场尚未发生任何实际配置变更。

---

## 六、 最终复审裁决

基于对任务专用只读门禁（`adoption-scope-guard.mjs`）、封存生成器及 20 操作 SEALED 批次的对抗性分析：

- **漏洞与阻断判定**：**无**（双消费者过渡顺序合理、前置引用审计完备、跨阶段 File Pins 准确对应物理状态、4 DB 阶段完整封存，未发现可导致执行失败或安全穿透的可执行反例）；
- **候选准备裁决**：**【准予进入候选准备阶段（CLEARED FOR CANDIDATE PREPARATION）】**。代码和批次封存规范已具备完备性，允许生成并封存最终正式候选材料；
- **生产控制令**：**生产维护、切换及 4 阶段数据库操作坚决保持阻断**，严格等待最终正式生产审批。
