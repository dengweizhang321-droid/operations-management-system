基于用户明确授权与父任务规范，严格仅通过 `view_file` 读取了 [INPUT.md](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-c-preparation/agy/INPUT.md) 及其指定工作区文件：
- [HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.md](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-integration-review/production/HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.md) / [HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.json](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-integration-review/production/HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.json)
- [HANDOFF_D.md](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-fastpath-evidence/HANDOFF_D.md)
- [INDEPENDENT_REVIEW.md](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-fastpath-evidence/INDEPENDENT_REVIEW.md)
- [REPORT.md](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-fastpath-evidence/REPORT.md)
- [release-batch-admission.mjs](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/tools/release-batch-admission.mjs)
- [FORENSIC.md](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-c-preparation/stability/FORENSIC.md)
- [REVIEW.md](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-c-preparation/source/REVIEW.md)

本轮**未执行**任何 shell、Status 探测、HTTP、SQL、文件修改/创建、生产操作或外部发送。以下提供中文独立审查意见、证据缺口说明、精确阻断条件与最小测试/交接要求：

---

### 一、跨会话 Worker 退出证据分析与假设反驳

#### 1. 现存技术事实与框架表面
在 [FORENSIC.md](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-c-preparation/stability/FORENSIC.md) 与 [HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.json](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-integration-review/production/HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.json) 中已证实的共同事实包括：
- **三个退出窗口均伴随真实进程退出与自动恢复**：
  1. **10日 06:05～06:08 (D5)**：supervisor PID 2924 下，Worker PID 64644 于 06:06:07.683 退出（exit 1，signal null），经 1000ms 安排重启，由 PID 15520 替代。
  2. **10日 17:42～17:45 (AB)**：supervisor PID 48744 下，Worker PID 66676 于 17:43:12.744 退出（exit 1，signal null），经 8000ms 安排重启，由 PID 52084 替代。
  3. **11日 00:58～01:01 (AB/12c)**：supervisor PID 48744 下，Worker PID 52084 于 00:59:19.502 退出（exit 1，signal null），经 16000ms 安排重启，由 PID 51028 替代。
- **固定错误表面**：三个窗口的 Wrangler 日志均在退出前 0.1～0.4 秒出现 `Error inside ProxyWorker` 伴随嵌套 `Network connection lost`（Wrangler `cli.js:65574/311747/311631/311359` 与 Miniflare `index.js:88266/88500`）。该堆栈的底层语义是 **ProxyController 通过 Miniflare loopback 连接收到 Worker 异常断开**，属于连接断开后的被动报错，**无法凭此确认发起断开的一方、具体请求正文或退出的根本因果链**。

#### 2. 对“其他对话/任务操作导致退出”假设的核心反例
用户提出“其他对话执行任务可能导致 Worker 退出”属于合理的待查线索，但**现有会话记录并未证实此因果关系**，反而存在以下明确反例：
1. **API Turn 执行时间窗口不匹配**：
   - “高收益任务”在 10日 09:53～10:18Z 结束；
   - “NoData 任务”在 10日 15:47Z 结束，直到 11日 03:06Z 才启动后续 turn；
   - “前端 AGY 任务”在 9日已结束；
   - “记录群工作任务”在 11日 01:02:42Z 启动（晚于 00:59:19 的退出事件）；
   - 上述任何会话在真实活动的 API turn 时间上，**均未覆盖 17:43 或 00:59 两个故障窗口**。
2. **唯一找到的进程终止命令对象完全不同**：
   - 历史 turn 中唯一排查到的显式 `Stop-Process` 发生在 10日 11:18Z 的暂停 turn 中；
   - 该命令具有明确的进程创建时间与命令行参数鉴权，**仅终止其私有的 `freeze-bootstrap-payload` 脚本 Node 进程**，未指向正式 `workerd`。
3. **不能以 UI 侧边栏的 `updatedAt` 代替后端执行事实**：侧边栏更新时间可能因前端刷新、用户查看或后台元数据同步改变，不能作为其他任务正在执行 shell 的证据。

#### 3. 关键审计盲区（为什么不能彻底排除外部命令）
在现行 D5 与 AB 的 `worker-local-service.ps1` 实现中：
- 热重启分支 [`Restart-ExactWorkerChild`](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-c-preparation/stability/FORENSIC.md#L17-L19) 直接调用 `Stop-Process -Force`，**该路径不会调用 `Write-WorkerStopDiagnostic`**！
- 受控停止诊断文件 `worker-last-controlled-stop.json` 仅在停止整个 supervisor 的 `Stop-ExactWorkerSnapshot` 路径写入，且属于覆盖写，并非 append-only 命令日志。
- **结论**：日志中“缺少 controlled-stop 审计记录”**无法证明**没有外部或未留痕的任务执行了 child 终止；反之，“supervisor 自动拉起”**也无法反推**该退出一定是内部偶发崩溃。**因果关系定案前，不能把模型共识或推测当作已经验证的结论。**

#### 4. 证明跨会话干扰的严格证据标准与隔离复现建议
- **证据要求**：若要主张特定会话导致崩溃，必须提供该会话的**原子执行日志**，包括：精确的命令行、UTC 开始/结束时间、目标 PID 及进程创建时间，并证明其直接作用于正式 `workerd`（而非独立子进程）或独占占用了正式 3000 端口。
- **最小隔离复现方案**：
  - 在纯私有临时目录、随机端口下，使用受控版本的固定三件套（Wrangler 4.92.0、Miniflare 4.20260515.0、workerd 1.20260515.1）与空白测试 Worker；
  - 分别隔离测试单变量：(1) 仅终止 Wrangler 父进程；(2) 仅终止 workerd 子进程；(3) 仅物理关闭 socket；(4) 客户端请求提前 abort / 取消 response stream；(5) server dispose；(6) 独立与共享构建缓存对比；
  - 严禁在生产或正式端口探测，仅对比哪种诱发路径产生与现场完全一致的 `Error inside ProxyWorker` + `exit 1 / signal null` 组合。

---

### 二、Collector 真实状态年龄缺陷与时序漏洞 (TOCTOU)

#### 1. 源码缺陷定位 ([release-batch-admission.mjs](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/tools/release-batch-admission.mjs#L170-L191))
在现有实现 [`collectBatchAdmission`](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/tools/release-batch-admission.mjs#L110-L191) 中存在严重的时序倒挂漏洞：
1. **采样发生在慢核验之前**：
   - 在 L170-185 行，`complete-status` 阶段调用 `operations-system-control.ps1 -Action Status -Json` 并判定系统就绪；
   - 随后在 L186-188 行，执行 `collectBatchRecovery(batch)`（归档与日备份检查）以及 `session.recheck()` / `workerPreparationIdentity(workerSourceRoot)`（完整磁盘文件树全量内容重读与指纹比对）。
2. **末尾随意重置观测时间**：
   - 在 L189 行：`return {batchSha256: batch.batchSha256, observedAtMs: Date.now(), ...};`
   - **真实危害**：Status 采样发生在 $T_0$，随后的磁盘/归档全量慢核验耗时数秒至几十秒（$\Delta T$）。返回的 `observedAtMs` 却标记为 $T_0 + \Delta T$。上层判定模块据此误认为状态是在当前时刻刚采样的最新状态，**实质上掩盖了实际状态年龄 $\Delta T$**。若 Worker 在慢核验期间崩溃退出（正如 00:59:19 事故所示），外部调用方将依据带有虚假新鲜时间戳的凭据做出错误决策，产生严重的 TOCTOU 漏洞。

#### 2. 重构设计与精确阻断规则
1. **时序前置**：所有静态、慢速内容核验（源文件指纹、工具链哈希、制品匹配、备份与恢复资格归档）**必须全部安排在动态状态采样之前执行**；
2. **真实时间戳穿透**：`statusObservation` 必须直接承载 Status 进程实际返回的精确时刻 `statusObservedAtMs`；
3. **末尾禁止时间伪造**：`observedAtMs` 必须如实绑定动态状态的真实采样时间，不得以 collector 退出时刻覆盖；
4. **硬性时效断言**：在收集器最终返回前，断言 `Date.now() - statusObservedAtMs <= MAX_STATUS_AGE_LIMIT`（如 5000ms），一旦慢检查超时或动态采样后发生意外延迟，立即抛出过期异常拒绝采纳。

#### 3. 最小测试与测试注入要求
测试套件必须显式包含负例注入，绝不能只做平路测试：
- **注入慢核验/采样后延迟**：在 Status 采样与最终凭据产出之间人为注入超过阈值的延时，断言收集器准确抛出状态过期拒绝；
- **保留原 deadline 联动**：确保 Status 超时预算受进程期限 `TERUISI_PROCESS_DEADLINE_UNIX_MS` 严格截断；
- **保持权限与排空门禁**：在注入状态重试时，确保原有的排空状态、身份匹配与维护互斥逻辑不被绕过。

---

### 三、C-only 首次严格采用范围与阻断边界

#### 1. 采用范围严格限定：六运行增量文件
- **严禁全树采用 `2b10f602` 或当前 `main`**：
  - 交付提交 `2b10f602` 是在旧基线上开发的，包含大量历史客服、测试用例删除和未审计的性能修改，不能直接覆盖当前生产 AB 树；
  - 当前主线 `main` 包含尚未生产采用的 v3/NoData 改动，直接混入将打破现有隔离。
- **允许且必需的范围仅限于以下 6 个运行增量文件**：
  1. [`tools/release-admission-timing.mjs`](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/tools/release-admission-timing.mjs)：新增受限子阶段计时器；
  2. `tools/release-preparation-evidence.mjs`：新增同批私有内存准备身份派生复用（10分钟/24次，每轮仍重读源全量字节）；
  3. `tools/release-batch.mjs`：v2 编排、in-process 收集模式、数据库动作封存；
  4. [`tools/release-batch-admission.mjs`](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/tools/release-batch-admission.mjs)：计时与 session 接缝处理；
  5. `tools/release-impact.mjs`：前驱分类器、受限 UI 展示证明、8并发有界 IO；
  6. `tools/worker-local-release.mjs`：仅在打包清单中登记新增的两个 helper 模块。

#### 2. 必须显式纳入与保留的关键修补
不能盲目恢复旧版 C 代码，必须显式合入并锁定以下关键修复：
- **日备份未覆盖守卫 (C-DAILY-02)**：
  - C 早期代码自读 latest wrapper；
  - 必须保留 AB 中 `release-daily-backup.mjs` 的修正：对未证明覆盖最新 native 调度的尝试统一返回 `lastResult: unknown`，杜绝旧成功结果的虚假穿透。
- **257 诊断证据补丁 (`25744508...`)**：
  - 当 Status 解析或就绪断言失败时，必须在异常中保留原始 `processEvidence` 与脱敏 `readinessEvidence`，避免吞噬故障诊断信息。
- **fc84 健康预算补丁 (`fc84d723...`)**：
  - control/retry 源码中将 ready 外层超时设为 5 秒（以匹配内部最大 4 秒），live/helper 保持 3 秒，并强化类型与共同期限守卫。

#### 3. 边界划分：坚决隔离另一会话（NoData v3）
- 另一会话“拆分发布验证与备份门禁”引入的 `recovery.mode === 'not-required'` **尚未生产采用**；
- C 的发布批次必须严格绑定现行标准，**不得以该会话未经验证的 v3 规则来免除自身的备份与恢复资格检查**。

#### 4. 首次严格采用的绝对阻断条件
- **日备份调度阻断**：日备份唯一原生计划任务 `e` 依然处于 **PAUSED** 状态。在 26 小时恢复点、7 天同点完整演练、连续日备份证明完备之前，**快路径（reuse 模式）必须绝对阻断**；
- **机制自身首次采用必须走 strict/full**：C 机制自身的首次上线必须执行严格的前后完整冷备与隔离演练，禁止使用自身的快路径进行自举；
- **前驱重绑**：旧 D5 的 ABC 批次前驱已失效，C 的生产批次必须重新精确绑定当前实际运行的前驱（AB `5faac815...`，Worker `f4e537eb...`，Django `237fbe0d...`）。

#### 5. 耗时收益核准：拒绝夸大生产收益
- 在 [REPORT.md](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-fastpath-evidence/REPORT.md) 与 [INDEPENDENT_REVIEW.md](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/docs/release-fastpath-evidence/INDEPENDENT_REVIEW.md) 的实测中，冻结源配对测试**仅证实了准备身份三阶段净节省 21.6～24.2 秒**；
- “重复检查额外省 10～20 分钟”与“Worker-only 省 3～6 分钟”属于**未经生产规模实测的估算预算**；
- 禁止把小进程切换的毫秒级提升直接外推宣称为生产分钟级收益。

---

### 四、文件暂缺与客观证据缺口说明

按照事实边界与规范要求，必须指出以下证据缺口：
1. **系统底层进程审计日志暂缺**：工作区仅有应用级与框架日志，缺少包含命令行与父子进程树的 Windows 安全审计事件（Event ID 4688/4689）。因此，在 17:43 与 00:59 这两个时点，系统层是否存在第三方软件、计划任务或未知外部命令 kill 了子进程，**属于客观存在的不可考证缺口**；
2. **Status 采样与慢核验时序负例暂缺**：现有测试套件通过了 206 项与 166 项回归，但此前**从未执行过针对“慢核验后 Status 过期使用”的专门负例测试**；
3. **真实环境日备份最新恢复演练证明暂缺**：由于调度 PAUSED，满足 26h/7d 同点且未被轮换覆盖的最新真实日恢复演练收据在当前生产运行环境中缺失。

---

### 五、交接与最小验证检查清单

交接给统一发布准备方时，必须满足以下最小闭合条件方可解除阻断：

| 检查项 | 验证内容与判定标准 | 状态/要求 |
| --- | --- | --- |
| **时序修复** | 在 [`tools/release-batch-admission.mjs`](file:///D:/.codex/worktrees/release-c-stability-preparation/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/tools/release-batch-admission.mjs) 中将全量源/工具链/归档慢核验调整到 Status 之前，`observedAtMs` 绑定真实状态采样时刻，增加过期断言。 | 待实现与单测闭合 |
| **测试注入** | 编写隔离测试：注入 6 秒慢核验延迟，验证收集器立即抛出过期异常拒绝采纳。 | 待补齐独立负例 |
| **补丁锁定** | 确认限定 6 文件中已严格合入 257 诊断保留与 fc84 超时预算，排除无关主线代码与 NoData v3 逻辑。 | 必须按 SHA 逐文件核验 |
| **前驱绑定** | 批次规范绑定 AB `5faac815`、Worker `f4e537eb`、Django `237fbe0d`，拒绝旧 D5 计划。 | 封存时严格断言 |
| **采用模式** | 首次采用标记为 `mode: 'full'`，执行完整前后冷备与隔离恢复，拒绝在日备份 PAUSED 状态下自举 reuse。 | 严格执行门禁 |
