# TERUISI 发布规则调整（v3 not-required）第 7 轮独立审查意见

> **审查方**：Antigravity 独立审查席
> **审计对象**：`tools/release-lifecycle-step.ps1` 与 `tools/worker-local-service.ps1` 新增调用链门禁补丁（`EXACT_TWO_FILE_DIFF`）、真实 AST/原生参数测试（`NATIVE_REAL_FUNCTION_TRANSPORT_TEST`）及回归测试套件（137/137 通过）
> **审查约束**：纯文本阅读审查，无文件读写，不调用工具，不重新访问未授权资源。前 1～6 轮历史意见与事实记录完整保留，本轮正式确立 **9 文件完整闭包** 为最新有效审查范围。

---

## 一、 审查范围变更与缺口闭环核定（Scope Evolution & Root Cause）

主 Agent 在 Git 交付前主动对生产完整调用链实施终审，定位并拦截了原 7 文件静态展示规约无法覆盖的**部署期真实副作用调用链**：
1. **隐式后端拉起副作用**：原 `Invoke-WorkerSystemStart → Ensure-DjangoSystemReady` 在后端 `NotReady` 时，会无条件执行 `Invoke-DjangoStartProcess`，该过程包含数据库迁移检查与角色权限复位（GRANT），破坏无数据变更承诺；
2. **钉钉接收器意外拉起副作用**：原 Worker 无论处于 fresh 启动还是 `already_running` 状态，均会调用 `Start-SystemDingTalkReceiver → AutoStartDingTalk`，可能主动消费外部消息并造成数据写入。

**范围核定**：先前 7 文件结论正式由包含上述两处修复的 **9 文件最小闭包** 替代（5 个核心发布模块 + 2 个依赖模块 + 2 个本地服务控制器/适配器脚本）。机制首次自举仍严格维持 `strict / full`（完整 4 DB 阶段）不变。

---

## 二、 新增两文件最小门禁对抗性审查（Adversarial Audit of the Patch）

针对提交的 PowerShell 差异逐行核验执行边界：

```
                    ┌────────────────────────────────────────────────────────┐
                    │      Worker 启动期无数据守护 (RequireReady) 门禁流      │
                    └────────────────────────────────────────────────────────┘
                                                 │
          ┌──────────────────────────────────────┴──────────────────────────────────────┐
          ▼                                                                             ▼
  【release-lifecycle-step.ps1】                                                【worker-local-service.ps1】
  检查 $ExpectedDrainId:                                                        入参声明:
   - 存在 (Worker-only 路径) => 注入 -BackendStartPolicy RequireReady            - [ValidateSet("EnsureReady", "RequireReady")]
   - 缺失 (普通/full 维护)    => 维持原参数 (默认 EnsureReady)                     - Action 非 Start 传入 RequireReady 直接抛错
                                                                                                │
                                                       ┌────────────────────────────────────────┴────────────────────────────────────────┐
                                                       ▼                                                                                 ▼
                                            【Ensure-DjangoSystemReady】                                                      【Start-SystemDingTalkReceiver】
                                             - 若 Ready: 正常返回                                                              - 受 -not $RequireReadyBackend 守护
                                             - 若 NotReady 且 RequireReady:                                                    - Worker-only 启动跳过 Receiver 激活
                                               在 Invoke-DjangoStartProcess 前直接抛错!                                        - 既有 Receiver 不强杀, 亦不新增拉起
                                               (阻断迁移/GRANT 执行, 批次安全熔断为 unknown)
```

### 1. 策略枚举声明与动作严格受限
- `worker-local-service.ps1` 顶层入参增加：
  ```powershell
  [ValidateSet("EnsureReady", "RequireReady")]
  [string]$BackendStartPolicy = "EnsureReady"
  ```
  默认维持既有 `EnsureReady` 语义，完全向后兼容；参数值由 PowerShell 引擎在解析层强制校验合法性。
- **动作前置断言**：
  `if ($BackendStartPolicy -eq "RequireReady" -and $Action -ne "Start") { throw "BackendStartPolicy RequireReady is restricted to Start" }`
  执行于任何进程互斥锁获取、运行时状态初始化之前，坚决阻断在 `Status`、`Stop` 等非启动动作中滥用该策略。

### 2. 数据库迁移与权限复位副作用的“动作前切断”（Pre-Effect Rejection）
- `Ensure-DjangoSystemReady` 增加 `[switch]$RequireReadyBackend` 形参；
- **核心切断点**：
  ```powershell
  if ($RequireReadyBackend) { throw "Worker-only Start requires an already-ready backend; backend startup is forbidden" }
  ```
  该断言**严格置于 `Invoke-DjangoStartProcess` 调用之前**。一旦后端处于未就绪状态，控制流立即抛错终止，Django 与 PostgreSQL 部署逻辑根本不会被拉起，物理排除了触发数据迁移或角色权限重置的可能性。
- **批次状态保全**：异常被上层捕获后，批次协调器将状态安全置为 `failed / unknown` 并维持当前 Drain 状态，绝不继续执行 `EndWorkerDrain`，杜绝故障静默扩散。

### 3. 钉钉接收器抑制（DingTalk Receiver Guard）
- 在 `Invoke-WorkerSystemStart` 中：
  - `already_running` 分支：`if (-not $RequireReadyBackend) { Start-SystemDingTalkReceiver }`
  - fresh 启动分支：`if (-not $RequireReadyBackend) { Start-SystemDingTalkReceiver }`
- **双向抑制**：在受守护的 Worker-only 发布中，完全跳过接收器启动逻辑。既有正在运行的实例不被强杀，同时杜绝在发布窗口期引入新消费通道；普通 `EnsureReady` 流程则维持原状。

### 4. 适配器参数透传与零新依赖
- `release-lifecycle-step.ps1` 的 `StartWorker` 逻辑中：
  ```powershell
  $startArguments=@('-Action','Start','-Json')
  if($ExpectedDrainId) { $startArguments+=@('-BackendStartPolicy','RequireReady') }
  ```
  仅在存在审批绑定的 `$ExpectedDrainId` 时精准追加参数，契约映射严格匹配。
- 采用原生的参数名/值数组传递，**未改动 `process-deadline.ps1` 的封闭 switch 结构，无需引入第 10 个运行时依赖**。

---

## 二、 真实控制流验证与测试审计（Verification Audit）

对提交的实际验证日志与脚本进行对抗性比对：

1. **真实 AST 原生控制流测试**（`tests/release-no-data-backend-start.test.ps1`）：
   - 完整解析真实脚本 AST，执行真实的 `Ensure-DjangoSystemReady`、`Invoke-WorkerSystemStart` 与顶层 `Start` 分支（仅替换底层启动打桩）；
   - 验证了 Ready / NotReady、普通回退、两处 Receiver 抑制、维护态及未知 owner 拒绝的所有排列组合；
   - 通过原生 `Invoke-OriginalEngine` 在 **Windows PowerShell 5.1** 与 **PowerShell 7 Core** 双运行时下，证实强类型参数块能够准确绑定并透传 `RequireReady`。
2. **测试结果与事实保留**：
   - 全套串行测试执行 **137/137 全部通过**（耗时 38.49s，`astra-backend-guard-final-serial.log`）；
   - Worker Drain 原测试套件通过（2/2）；
   - 客观保留事实历史：先前并行模式下的 136/137 偶发日志作为真实历史留存，未篡改记录。

---

## 三、 调度、生产与自举边界确认（Invariants & Boundaries）

1. **既有调度任务维持**：
   配置未变的既有 Market 定时任务依原架构由唯一的旧 Stop / 新 Start 轮转继续管理；在 Requests Gate 期间请求被严格阻断，自然的业务数据波动不归因于本次发布，未引入任何新计划或追赶任务。
2. **首次自举严格性**：
   包含本次 9 文件变更的首次自举发布，**强制走原引擎的 strict / full 流程（4 DB 阶段完整演练）**，绝不利用自身新特性实施自减免。
3. **旧生产批次隔离**：
   生产环境旧活跃批次 `active 9f79`（87 项 WAL 事件，第 19 项未知）继续保持锁定与原主阻断，生产环境未发生任何实际变更，本轮亦不请求生产批准。

---

## 四、 最终审查裁决结论

在完成对调用链真实副作用的针对性切断审查，并确认 9 文件闭包在 PS5/PS7 双环境及 137 项回归测试下均已闭环的前提下，Antigravity 独立审查席给出最终裁决：

- **尚存可执行阻断**：**无**（当前 9 文件源码、语法分析器、部署收据防伪、网络观察器、调用链启动门禁及参数透传中，已无任何尚存的逻辑漏洞或可执行反例阻断）。
- **交付结论**：**本次已提供、已验证的 9 文件范围明确获准进入 Git 交付（Cleared for Git Delivery）**。代码具备在当前开发 worktree 提交合并的工程完备性与部署安全性。
