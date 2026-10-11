# C 源码与首次采用准备独立审查

结论：准备审查完成；可按实际 AB 前驱形成限定组合，尚未审定新源码候选或批准生产。直接采用 C 完整树、当前 main 或旧 D5 的 ABC 计划均不可行。本轮只读 Git 对象、规范、已有日志及小型收据；没有改实现、运行测试、构建、安装、生产准备、数据库请求、生命周期或调度。

精确事实、原 Git 字节 SHA 与待验证项见 [REVIEW.json](REVIEW.json)。开发 worktree 基线为 `ba656eabbb93d17d6e2f57d51ea3d13b27d1f50d`。实际应用是 AB `5faac8151f59d66de72c3caead8cad916ea547da`，Worker manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113`，Django manifest `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`。独立读取 AB 最终收据的原字节 SHA 为 `790313b4ab938a87bf5a32e09e2e2b2962ae834293c9e57c0c44b1a54a2f2792`：109 条、head `5289afac…`、必要和完整交付已闭合，原三项 unknown、旧严格比较 false 保持，C/NoData 未采用。这份事实不是本轮新鲜生产身份采集。

## 限定运行路径

从实际 AB 到旧限定 ABC `9d41ce4fa2c7ee4d47ba1bfda0f0967d7727be9c`，只有以下六个运行文件变化。C 交付 `2b10f6021a0b5bda1f52424604bf697b17218e3c` 的完整树还包含其他客服、性能源与测试删除，不能整体覆盖 AB。

| 完整仓库相对路径 | 必要变化 |
| --- | --- |
| `tools/release-admission-timing.mjs` | 新增受限子阶段计时 |
| `tools/release-preparation-evidence.mjs` | 新增同批、有界准备身份派生复用；每轮仍完整读内容 |
| `tools/release-batch.mjs` | v2 编排、in-process 收集、完整数据库动作及边界恢复资格 |
| `tools/release-batch-admission.mjs` | 计时/session 接缝，并保留 AB 日备份读取修复 |
| `tools/release-impact.mjs` | 完整前驱分类、窄展示证明、有界 IO |
| `tools/worker-local-release.mjs` | 相对 AB 仅把两个新增模块加入 bundledSource/keyFiles 数组 |

六份 Git 原字节已独立复算。C 与旧限定 ABC 的六文件仅 admission 不同：旧 ABC 将 C `dailyStatus` 自选 latest wrapper 的实现改为 `readScheduledBackupStatus()`。该差异必须保留。完整执行闭包还包括原 daily/retry/process-deadline/lifecycle/control/rotation/service、D1 proof 两模块、TypeScript 两文件以及原 spec 的实际 Node/npm、operator/helper/Python/validator/watchdog；六文件增量不是完整可执行依赖清单。

## 必须保留与必须明确选择的修补

1. **日备份（C-DAILY-02）**：C `admission:46–61` 自读最新 wrapper；旧限定 ABC `:44–46` 委托 AB 修复。AB `release-daily-backup.mjs:103–125` 对未证明最新 native 调度尝试覆盖返回 `lastResult:unknown`，即使 wrapper 旧成功也拒绝复用。保留其 attempt-v2、真实 PS5 传输、共同期限、late failure/owner 和所有旧记录；不启用调度。
2. **完整盘点**：AB 的 `.env.example/.env.sample` 与 Git 选择后 ENOENT 失败关闭必须保持。C `2b10` 的 impact 本身已包含相同两项守卫，不需要重复补丁；最终组合须负例确认，而不是按文件名声称保留。
3. **诊断证据**：`257445088d6477613802c6c2be68aabc4f4cc5a5` 的 batch/admission/retry 补丁在原 parse/assert 失败时保留实际 process 和受限状态，保持原断言与四类暂态重试；直接恢复旧 C 文件会丢失这层证据。建议将精确补丁移植到 v2 限定组合，单列选定范围并重审。
4. **健康预算**：`fc84d723a8aca3b822f45ad3a7229cce8c58e112` 的 control/retry 源码将 ready 外层设为 5 秒匹配内部最大 4 秒，live/helper 仍 3 秒，强化类型、共同期限与最终返回守卫。建议明确纳入新候选，不以 main 合并替代实际采用。旧 AB 最终 `12c` 使用的是精确外置只读影子与 producer；不能把它的批准或协议移作 C 批准。旧非零传输仍不保证解析错误 JSON，若声称端到端失败摘要，须有明确捕获/producer 闭包。

修补的隔离源码报告可复用为来历证据，不能免除新接缝验证，也不能声称 Worker 意外退出的根因已修复。

## 具体准备阻断与新验证

| 编号 | 触发条件和位置 | 修复/验证要求 |
| --- | --- | --- |
| C-SCOPE-01 | 整体用 `2b10` 或 current main | 实际 AB 基础＋上述六路径＋显式选定修补；排除业务/性能、v3/NoData 与历史测试删除；核完整原字节变化集 |
| C-FRESH-03 | `2b10 admission:160–179` 在 Status 后做 recovery/session 完整内容重读，最后才 `observedAtMs=Date.now()` | 该时间是 collector 返回点，不能当 Status 采样时间。慢核验先于最终动态采样或之后安全重采，并以真实年龄做边界断言及慢 IO 负例；本轮未测实际过期 |
| C-ADOPT-04 | 旧 D5 ABC 计划/恢复点/批准移作本次 | 重绑实际 f4e/237、当前生效链、完整来源、制品、spec 与新批准；C 机制首次自身 strict/full |

新的最小充分联合验证必须覆盖：真实隔离 Node/PS5 子进程的输出、非零与 deadline、仅清理自身 PID；原四类暂态与 NotReady 不重试；12 组件、错版本、权限、process/producer 关联；完整实际前驱的混合 API/写入/配置/依赖/改名删除严格分类；26h/7d、缺点、旋转点、PAUSED/unknown/最新失败等恢复拒绝；session 全字节、same-mtime、Git index、配置父目录、10min/24次、并发/失效/WAL 前及调用前检查；动态权限/维护/排空与真实样本年龄。历史 unknown/失败和业务并发转换不能白洗成旧操作正常成功。

重型构建、完整测试和隔离数据库演练须错峰串行。严格/full 保留前后新备份及对应隔离演练；生产数据恢复另批。当前日备份/恢复资格本轮未新采，未知或不可用就拒绝 reuse，不以旧演练或改 ACTIVE 补资格。

## 可复用证据与重叠工作

C 已有作者最终 206/206、独立 166/166、额外 12 probes 的原日志；早期 3517 全量发生在最终 A/B 合入前，不是本次全量。AB 盘点修复有 61 项相关回归；257 有 21 项独立 synthetic；fc84 作者 23 项跑在最终精确字节，独立 10 项跑在先前字节＋一个 JSON 字段的最终静态增量。各套件不直接相加，也不冒称本轮重跑。

现存 C 的 21.6～24.2 秒只属于旧 C＋B 准备身份子阶段，早于最终 A；不能证明新组合或生产发布分钟收益。前后比较要同源码、制品、数据规模与验收范围，父总时与子计时去重；准备、排队、失败/协调/续接、必要闭合与完整交付各列，HTTP 200 和切换跨度不能充作完整就绪或精确停服。

只读找到另一 active 会话 **“拆分发布验证与备份门禁”**，没有向其发送消息。其 `74ea55ef859d2115af5db80ac28d9b4cf5b1d76c`／交付 `4b11776…` 已合主线但未生产采用；v3/not-required 修改 batch/admission/impact/worker，并共用 C 两个未变 helper，另修改 lifecycle/service、增加 no-data-observation。它与 C 的四个改动路径直接重叠，当前不顺带九文件 payload、RequireReady 或取消备份政策。其历史 head87 阻断描述已被实际 AB109 超越；未来任何合并方案仍须另绑真实前驱。

根在本轮转达最新用户安排：C 当前只准备与复审，统一安排以后发布；另一任务正在补精确来源契约及旧 Django 验证器兼容。本任务不重复开发 source-binding，也不独立封存生产 batch。根拟仅修共用 collector 的慢检查后动态采样顺序并做隔离负例；本报告供统一准备方引用，最终组合候选须由其完成集成审查后创建。另一任务 03:06Z 才恢复 active turn，先前 00:59 的 Worker 退出不在其活动 turn 内，不能据重叠源码归因该事故。

当前四状态：C 原源码有交付和历史隔离证据；新的限定组合未冻结/验证；新的生产候选与精确 batch 未形成；C 未实际采用。此次审查不补任何生产结果。
