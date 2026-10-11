作为 TERUISI AB 收尾的**非作者第二审查者**，本审查严格遵守只读核验原则，未执行任何终端命令、Status 探测、HTTP/SQL 请求、进程管理、文件写入、锁获取、外部通信或工作区外凭据访问。所有核验均通过 `view_file` 工具读取工作区内受限证据文件完成。

---

### 一、 核验文件清单与证据状态

| 文件路径 | 类型 / 作用 | 关键标识 / 状态 |
| :--- | :--- | :--- |
| `docs/release-integration-review/production/AGY_AB_ACTUAL_INPUT.md` | AB 本轮实际验收输入指令 | 规定核验范围、约束条件与计时规则 |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_INDEPENDENT.json` | 独立物理证据复核记录（机器 JSON） | SHA-256: `f821899972154ab9a9eb5dcb27631a84a32a7181d4e683cc38cafd5abff46dae` |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_INDEPENDENT.md` | 独立物理证据复核报告（Markdown） | 与 JSON 逐项对应 |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_PUBLIC/ACTUAL_SUMMARY.json` | 实际验收公共摘要 | 确认必要验收时间点与全交付未闭合状态 |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_PUBLIC/MANIFEST.json` | 公共受限证据清单与自校验 | 记录了复制阶段的 `initialAdministrativeCopyError`（不影响生产证据） |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_PUBLIC/human-approval.json` | 真人批准记录 | 批准时间 `2026-10-11T00:54:49.000Z`，唯一绑定 Scope SHA `12c48446...` |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_PUBLIC/execution-finished.json` | 调用器退出证据 | PID 61812，耗时 334458.5763ms，exitCode 0，stderr 为空 |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_PUBLIC/actual-result.json` | 实际执行与事件映射结果 | 必要验收闭合，全交付未闭合，历史失败保留 |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_PUBLIC/status-evidence/61812-aa850507-5cd3-4615-be79-36a4b282062b.json` | 最终 Status 原生证据 | 捕获 PID 20340、Running/Ready/exact_release 及 12 域组件全部 true |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_PUBLIC/health-probe-evidence/20340-0161d95d38fa41f48c06261338115853.json` | 最终 Native PS 生产者踪迹 | 绑定 PID 20340、Scope SHA、Authority 原 SHA 及三探针实测数据 |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_PUBLIC/status-evidence/42380-a43fdce3-d5ab-4d5f-a35a-a9fd14894d4a.json` | 准入 Status 原生证据 | 捕获准入 PID 69812 及 12 域完整状态 |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_PUBLIC/events/000107.json` | 事件 107（Pending） | `necessaryAcceptanceClosed = false`，等待 owner 释放 |
| `docs/release-integration-review/production/HEALTH_PROBE_ACTUAL_PUBLIC/events/000108.json` | 事件 108（Completion） | `necessaryAcceptanceClosed = true`，`fullDeliveryClosed = false` |
| `docs/release-integration-review/production/HEALTH_PROBE_APPROVAL_PLAN.md` | 历史批准方案快照 | 规定 12c48446 范围与多阶约束 |
| `docs/release-integration-review/production/HEALTH_PROBE_SEALED_REVIEW.md` | 历史封存候选物理复核快照 | 记录执行前 102 条原链及 4829 文件物理校验 |
| `docs/release-integration-review/production/HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.json` | 窄窗运行异常专项独立复核 | 确认 00:59:19 真实 Worker 52084 exit 1 及自动恢复事件 |
| *(注：证据限制说明)* | `HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.md` | **文件不存在**（读取失败已如实记录，未尝试绕过，以已读到的 `.json` 为准） |

---

### 二、 证据支持与不支持的结论

#### 1. 证据【充分支持】的结论

1. **必要验收与完整交付严格分离**：
   - 证据明确记录：事件 108 与结果文件中 `necessaryAcceptanceClosed: true`（时间点 `2026-10-11T01:03:03.646Z`），而 `fullDeliveryClosed: false`。
   - 证明必要验收已满足合同要求，但整个 AB 交付仍在行政与文档归档收尾阶段，当前快照绝不能表述为“全交付已完成”。
2. **历史三个 unknown 与原严格比较 false 严格保留**：
   - `original19StrictComparisonPassed = false`、`original21Passed = false`、`prior1caePassed = false`、`originalBatchEngineCompleted = false`；
   - 事件 108 保留了原三个 unknown 事件的 SHA 引用，没有篡改历史记录，没有重放旧生命周期。
3. **真实 Native / Producer / PID / 预算支撑最终健康结论**：
   - 准入（PID 69812，耗时 38962ms）与最终（PID 20340，耗时 36052ms）均 exit 0；
   - 最终三个探针实测耗时：live `58.188ms`、helper `11.728ms`、ready `1990.236ms`，均在指定预算（3000ms / 3000ms / 5000ms）之内；
   - 12 域组件全部为 `true`，无缺失无额外项；
   - Producer trace（PID 20340）强绑定了 Scope SHA（`12c48446...`）、Producer SHA（`c33d9848...`）与 Raw Authority SHA（`e31038cb...`），调用时间窗口一致。
4. **所有权释放经过真实物理不存在（ENOENT）核验**：
   - 事件 107 准入后记录 `readiness-accepted-pending-owner-release`，此时 `necessaryAcceptanceClosed = false`；
   - 在独立物理观察点 `1791680583477`（01:03:03.477Z）确认 owner 物理缺失（`ownershipAbsentObservedAtMs`）后，才追加事件 108 将必要验收置为 `true`。
5. **未将首页观测或模型隔离测试冒充生产健康结果**：
   - 首页 147 样本采用 consume-and-discard 机制，明确标记 `provesBackendReadiness: false`、`threeHealthEndpointsNotObservedByHomepage: true`；
   - 隔离模型测试（21/21 等）严格限定在准备阶段说明中，生产健康完全来自 Native Status 与 PS 真实探测。

#### 2. 证据【不支持】（禁止引申）的结论

1. **不支持“旧 1cae 失败必然是预算不足导致”**：
   - 最终实测 ready 耗时仅 `1990.236ms`，该耗时甚至完全落在旧合同的 3000ms 预算之内。因此本次通过不能反向证明历史 1cae 失败是由于旧预算过小引起的，历史失败原因依然未证。
2. **不支持“系统全程稳定无异常”**：
   - 在 00:59:19–00:59:44 之间发生了真实的 Worker 异常退出与 11 个入口请求失败，不能因 01:03 最终检查全绿而抹杀该故障事实。
3. **不支持宣称“本审查者执行了生产动态实物核验”**：
   - 本次第二审查仅只读复核了受限目录内的静态 JSON/MD 证据切片与哈希链，未直接连接生产环境执行探测。

---

### 三、 精确提醒：阻断 vs 非阻断界定

#### 1. 【非阻断提醒】00:59 窄窗运行异常对当前合同的定性
- **事实依据**：`HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.json` 证实，在 `2026-10-11T00:59:19.129Z` 至 `00:59:44.204Z` 期间（跨度 25075ms），入口 147 样本中出现连续 11 个不可用样本（首个 500，后 10 个为网络中断）。同 Supervisor（PID 48744）下的旧 Worker（PID 52084）以 exitCode 1 异常退出，Wrangler 报 `Error inside ProxyWorker: Network connection lost`。Supervisor 按 16000ms 延迟于 `00:59:39.749Z` 派生新 Worker（PID 51028）自行恢复。
- **合同判断**：
  - 该异常**早于**后续准入（01:01:51Z）与最终就绪探测（01:03:00Z）。
  - 用户已批准的 `12c48446` 合同为**独立时点健康探针补充验收合同（Point-in-time readiness contract）**，该合同的通过条件为单次准入与最终探针全绿、组件完备及所有权释放，不包含连续不间断服务（Continuous uptime）断言。
  - **结论：该异常不阻断本次 12c48446 必要验收的闭合。**

#### 2. 【阻断提醒】生产稳定性与收尾表述的严格禁令
- **禁止宣布全交付完成**：当前记录中 `fullDeliveryClosed: false`，在后续 Git 提交、公共归档及最终报告完成前，**严格阻断任何声称“AB 已经完整全交付”的表述**。
- **禁止掩盖生产稳定性遗留事项**：Worker 52084 exitCode 1 的触发请求和根因未明（背景 netshop statement timeout 虽被记录但未证明因果），16s 的恢复延迟带来了约 25~30s 的服务不可用窗口。该问题属于待定位的生产稳定性事项，**严格阻断将其归因于观察器或降级忽略**。
- **禁止回写历史操作状态**：**严格阻断将历史 19、21 或 1cae 操作篡改为 passed**。

---

### 四、 计时核实与更正

在对证据中各阶段计时字段进行交叉比对后，确认以下计时规则与纠偏要求：

1. **宏观经历时钟不重置**：
   - 原 AB 批准（`2026-10-10T05:28:51.000Z`）到必要验收闭合（`2026-10-11T01:03:03.646Z`）：总经历时间为 **70,452,646 ms**（约 19 小时 34 分 12.646 秒），包含历史 140.2 分钟暂停下限、故障排查与准备时间，不得清零。
   - 本轮新批准（`2026-10-11T00:54:49.000Z`）到必要验收闭合：为 **494,646 ms**（约 8 分 14.646 秒）。
   - 新批准到 Caller 启动（`00:57:29.395Z`）：历时 **160,395 ms**，属于前置调度与准备等待，**不得记入互斥锁排队（mutex queue）**。
2. **Caller 内部互不重叠阶段**：
   - 调用器 PID 61812 总耗时 **334,458.5763 ms**，其中包含：
     - `sourceProofDurationMs`: 15,012.0687 ms
     - `mutexQueueWaitMs`: 2.2693 ms
     - `admissionMs`: 245,420.8977 ms
     - `validationMs`: 54,193.1767 ms
     - 合计 314,628.4124 ms；剩余 19,830.1639 ms 为调用器框架其他处理时间。
3. **子区间与父区间禁止重复累加**：
   - 最终 Native PS 进程耗时 **36,052 ms** 以及探针实测串行耗时 **2,060.152 ms**，均严格属于 `validationMs`（54,193.1767 ms）的**内部子区间**，**绝对不能与父阶段相加作为优化或节省耗时**。
4. **事件 Completion 计时字段口径更正**：
   - 最终就绪返回时间点为 `1791680582638`（01:03:02.638Z），owner 物理缺失采样点为 `1791680583477`（01:03:03.477Z），返回到缺失间隔为 **839 ms**。
   - 事件 108 中的字段 `finalReadinessReturnToCompletionMs: 839` 是在事件 append 之前采样的点，实际就绪返回到 WAL 逻辑完成点 `01:03:03.646Z` 间隔为 **1,008 ms**。**更正提醒：不得将该 839ms 误称或表述为 WAL 物理写完并 fsync 的最终耗时**。

---

### 五、 审查结论总结

作为第二审查者，基于当前读取到的受限公共证据确认：
- **方案与执行符合 12c48446 批准合同**：必要验收逻辑已经闭合（`necessaryAcceptanceClosed = true`），历史未知与严格 false 均得到如实保留。
- **全交付未闭合**：当前快照确立 `fullDeliveryClosed = false`，不扩张交付结论。
- **生产异常被真实封存且不影响本时点验收**：00:59 窄窗 Worker 重启异常已被保留，不阻断合同验收，但作为独立的生产稳定性缺陷予以记录，不降低标准。
