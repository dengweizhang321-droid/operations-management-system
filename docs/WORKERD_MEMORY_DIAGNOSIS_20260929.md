# 第 3 项：workerd 内存增长诊断（独立交付）

日期：2026-09-29（上海）。基线：`e00d4a82`，分支 `codex/workerd-memory`。

续工更新：用户随后批准的负载拆分与堆分析第 1、2 步已完成，见 [归因报告](WORKERD_MEMORY_ATTRIBUTION_20260929.md)。已取得完整快照和阳性保留对照；原“缺少回收后存活集”的状态由该报告限定更新。历史生产根因与修复验收仍未闭合，本文件保留首轮观察记录。

再次续工：完整启动链已定位并形成 [Wrangler 调试代理保留修复候选](WORKERD_INSPECTOR_RETENTION_FIX_20260929.md)。该修复与本篇首轮 JSON 取消补丁分开评价，真实 Wrangler 前后对照通过；生产仍未采用。

## 状态和范围

**历史长期内存增长尚未闭合，不申请将本补丁作为“泄漏修复成功”上线。**

| 状态 | 结论 |
| --- | --- |
| 历史问题是否复现 | 隔离复现了短时阶梯增长；历史长期失控/OOM 尚未复现，不能据有限窗口断言无界 |
| 源码是否修复 | 修复一个可由负向测试证明的响应取消缺口；不是已经确认的历史根因 |
| 是否受控采用 | 否，生产文件、进程、调度、内存上限均未修改 |
| 长期运行验收 | 未完成，缺少跨实际业务周期的负载关联数据 |

按本轮并行约束，本文件先独立保存进度与证据；总评估 `SYSTEM_OPTIMIZATION_ASSESSMENT_20260928.md` 由用户指定的统一收尾会话更新。暂不合并 main，不改 README/AGENTS 的公共状态段。

## 当前版本及保护

只读核验 `state/worker-process.json` 与实际父子进程，release 为 `20260928T112356Z-eeac7bbc96a8c51a`，manifest SHA-256 为 `3cd3766cbe39071b2a19c6348d062388c6cdaeb433152c84b73ea2a2bd295b0b`。根目录历史 `current-deployment.json` 仍是旧起点，不将它误当 effective head。

正式安装的 Miniflare 文件 SHA-256 为 `2b2a89fb96a270e678b4aa87e65aa1282049b18d28a1e30ff7fe7f2736b648c7`，与固定适配一致。安装代码继续固定 V8 old-space 为 3072 MiB；liveness 连续 14 次失败才恢复，10 分钟最多 5 次。未修改堆上限、未对生产强制 GC、未附加生产调试器或获取生产堆快照。

这里的 old-space 不是总进程内存上限。Windows Working Set、Private Bytes 与 JavaScript live heap 不同；workerd 占位堆统计不能用来作验收。两个 workerd、Wrangler 引导进程/主进程与 helper 分开观测，不相加冒充一个进程。

## 正式只读观察

有效采样 25 次、约 490.789 秒（00:18:46—00:26:57 左右），每次间隔约 20 秒加采样开销。开始时进程已存活约 82 分钟，未观察启动预热。helper 的 25 次 busy 均为 false。采样只读取进程计数和既有 helper health；没有执行导入、业务查询或调度。

| 角色 / PID | 首个 Private MiB | 最后 Private MiB | 样本内峰值 Private MiB | 样本内峰值 Working Set MiB |
| --- | ---: | ---: | ---: | ---: |
| workerd / 52044 | 238.54 | 219.97 | 240.04 | 231.55 |
| workerd / 19232 | 253.91 | 254.18 | 254.30 | 268.26 |
| Wrangler / 36036 | 192.93 | 199.54 | 199.54 | 201.48 |
| Wrangler launcher / 27796 | 19.74 | 19.74 | 19.74 | 55.64 |
| helper / 53952 | 133.36 | 135.21 | 135.21 | 140.06 |

这些变化不足以判断泄漏、正常缓存或请求高峰。当前这次启动的 stdout/stderr 文件为零字节，现有可用证据不能提供逐进程业务请求计数；CPU 增量与 busy=false 不能冒充零请求。也不能用进程生命周期历史峰值认定峰值发生在本次窗口。

第一版采样把 CIM 与 Get-Process 的微秒/百纳秒精度直接比较，误标部分仍存活的进程；该轮不用于结论。正式证据采用修正后的第二轮：发现时容忍 1 毫秒的来源精度差，持续采样用同一 Get-Process 精确创建时间拒绝 PID 复用。最终工具另加 supervisor receipt 创建时间预检。

## 检查与最小补丁

检查 Worker 入口、动态 no-store 策略、Django readiness/传输、AI 流、请求取消、Vinext 缓存及 fetch 去重实现。发现 `lib/ai/bounded-fetch.ts` 在重定向和超大 Content-Length 的头部拒绝路径，只清除超时与外部信号监听，没有显式 cancel 未读响应或 abort 传输。

新增测试在原版上明确出现 **2 项失败 / 2 项通过**：两个拒绝分支的 cancel 计数为 0。补丁记录响应体是否已消费，未消费时在 finally 主动 cancel，并 abort 此请求自己的 controller；不等待不可信的 cancel promise，不让清理失败覆盖原公开错误。成功读取、非法 JSON 的原返回规则、错误码、容量与超时限制保持。

这是资源生命周期缺口的证据，**不是长期内存泄漏的因果证据**。真实 workerd 的首轮 120 次拒绝请求实验中，未读连接在请求结束后已由运行时释放，峰值采样 Private 约 45.45 MiB，未见连接累计。因此不能从单元测试的取消缺口推断历史堆耗尽由它导致。

Cloudflare 也建议取消不用的响应体以释放资源，见[官方内存说明](https://developers.cloudflare.com/workers/platform/limits/)、[ReadableStream cancel](https://developers.cloudflare.com/workers/runtime-apis/streams/readablestream/)。这是修补的依据之一，不是本机根因证明；云端 128 MB 限制不套用到本机 3072 MiB 配置。

## 隔离曲线与回归

独立 worktree 内安装锁定依赖，Miniflare `4.20260515.0` / workerd `1.20260515.1`，固定相同 3072 MiB 适配。每轮全新进程、无生产环境变量文件、数据库、R2、业务凭据、浏览器或定时任务；只开放随机分配的 loopback 临时端口。没有启动另一套正式 Wrangler/helper，也不声称合成 Node fixture 是正式 helper。

相同合成序列：每轮 3 个循环 × 40 个请求，共 120；每循环按相同顺序交替超限、重定向、JSON 查询、上传和流式下载，各类别总计 24 次。JSON 固定 4096 行、每行 220 字符 padding；上传 1 MiB；下载及被拒绝声明体积 8 MiB。并发 1，每次间隔 75 ms，每循环后 3 次间隔 1 秒的 idle 采样，PowerShell 采样也计入墙钟时长。

下载逐字节核对，查询/上传响应检查 4096 行，拒绝检查固定错误码。它验证传输函数及流式转发，不替代真实业务导入事务、大规模生产数据、完整 Vinext 页面或 PostgreSQL 权限验收。无数据库写入，因此无需恢复生产副本。

首轮 mixed 与其他会话单元测试重叠，只作探索，不用于性能结论。随后在其他测试结束后串行运行 controlled 前/后两轮；每次采样记录可用内存与竞争测试/构建进程数。即使竞争计数为零，Windows 其他进程和正常生产业务仍可能带来噪声，短曲线不能推导长期稳定性。

| 同条件 mixed 对照 | 原版 | 最小补丁 |
| --- | ---: | ---: |
| 请求数 | 120 | 120 |
| 墙钟时长 | 103.678 秒 | 105.609 秒 |
| 采样 Private 峰值 | 104.73 MiB | 104.93 MiB |
| 进程 Working Set 历史峰值（本轮新进程） | 113.90 MiB | 114.72 MiB |
| 三次 idle 末 Private | 72.91 / 88.75 / 104.73 MiB | 73.99 / 88.47 / 104.93 MiB |
| 采样时竞争测试/构建进程 | 全部 0 | 全部 0 |
| 上游请求/响应收尾计数（不是 TCP 连接数） | 120 / 120 | 120 / 120 |

这两条短曲线仍有阶梯增长，补丁并未消除它。不能据此宣称平台化或修复成功，需要继续区分 GC/预热/对象保留。最小补丁的验收只限显式取消语义。

原始样本、请求时序及可用内存见 [measurements.json](evidence/workerd-memory-20260929/measurements.json)，逐进程曲线数据见 [curves.csv](evidence/workerd-memory-20260929/curves.csv)，图见 [curves.html](evidence/workerd-memory-20260929/curves.html)。本次不以降低峰值作为预设结论。

### 扩展隔离诊断

用户追加预留约 5 分钟窗口后，原版执行 6 轮/240 次同序列请求，211.388 秒完成并关闭本次实例；Private 峰值 150.31 MiB。43 次采样中 32 次仍检测到其他会话测试进程，不干预它们；本轮只作分层诊断，**不是无干扰性能验收，也不与未开 Inspector 的曲线直接比较峰值**。

| 每轮 idle 结束 | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| user isolate used heap（MiB） | 18.42 | 29.24 | 40.07 | 50.92 | 61.71 | 72.56 |
| user backing storage（MiB） | 4.80 | 4.80 | 4.80 | 4.79 | 4.79 | 4.80 |
| 进程 Private（MiB） | 76.17 | 91.61 | 107.13 | 121.16 | 136.00 | 150.31 |

Miniflare core:entry 的 used heap 约 1.4–2.0 MiB、backing storage 约 0.33 MiB，没有同幅度增长。**该合成路径的增长主要出现在 user isolate 的堆占用，而不是外部 backing storage 单独累计。**used heap 仍包含尚未 GC 的可回收对象，尚无 major GC 后存活集/保留路径证据，不能进一步认定为业务对象强引用泄漏。

额外小探针只有 32 次内存内合成 JSON 读取、耗时 6.525 秒，不连接真实网络/业务：user heap 从约 3.03→9.91 MiB。发出隔离 `HeapProfiler.collectGarbage` 后 5 秒未收到确认，后读仍约 9.91 MiB；只记录“未确认、未观察到回收”，不声称 GC 成功或方法不受支持。证据为 [gc-probe.json](evidence/workerd-memory-20260929/gc-probe.json)，明确 `acceptance=false`。

上游有一份 [workerd #6824](https://github.com/cloudflare/workerd/issues/6824) 报告 steady load 下 major/unified GC 延后，亦提到 CDP 确认可能延迟。它来自不同版本及 macOS/Linux/container，**只作为 GC 调度假设，不作为本机 Windows 历史崩溃的根因结论**。后续需隔离快照/保留路径与实际负载关联共同验证，不能用强制 GC、修改上限或自动重启代替修复。

## 并行协作与依赖

- 本项唯一生产逻辑修改：`lib/ai/bounded-fetch.ts`。它被多域 Django adapter 调用；其他项目若修改公共传输层，统一收尾须复核该文件及调用方。无需改数据库或依赖锁文件。
- 第 2 项建议负责 `tools/worker-local-runtime-supervisor.mjs` 的退出证据；第 6 项负责 Wrangler 自检，第 7 项负责启动协调。本项只读这些文件，不修改，也不把同时间退出归因为内存。
- 新的观察/实验/报告工具均用 `workerd-memory-*` 独立命名；进度文件和 evidence 子目录不与总评估争写。
- 本项实验/单测/构建串行，不停止其他任务进程，不动其他 worktree、数据库、端口、产物或资源。正式环境保持不变。

## 测试记录

- 原版资源清理负向测试：2 失败、2 通过；缺口由测试直接证明。
- 修补后相关回归：83 通过，包含失败取消、成功/非法 JSON、互不干扰的并发请求、取消 promise 不完成、Django 库存/商品/销售传输、AI 流及 Worker 存活/调度保护。
- 全量 Node 单测（独立 worktree，`--test-concurrency=2`）：2660 通过、23 跳过、4 失败，耗时 556 秒。4 个失败均因新检出尚无 `.runtime/test-venv/Scripts/python.exe`，不是错误码或内存断言失败；建立本 worktree 专用虚拟环境后，受影响的 4 个测试文件共 46 项全部通过。未把第一次全量执行改记为全部通过，也未为消除失败修改无关业务源码。
- 后端边界检查：544 模块，0 违规。
- 全库 lint：0 错误，13 警告；其中本项诊断工具的 1 条表达式警告已修正，后续定向复验记录见交付末节。其他 12 条为本项未修改文件的原有警告。
- 最终只读采样器增加 supervisor receipt 身份检查后，2 次真实只读 smoke 通过；首次精度问题轮次未纳入结论。

## 复现命令

以下命令只在本项 worktree 内运行。不可复制生产 `.dev.vars`，实验不开生产连接。先核验其他构建/测试/恢复已让出测量窗口；输出标签必须为新值，避免覆盖旧证据。

```powershell
# 普通三轮对照，每轮 120 次请求；baseline 精确绑定提交
node tools/workerd-memory-lab.mjs before-controlled e00d4a82
node tools/workerd-memory-lab.mjs after-controlled
# 原版扩展诊断，只连接此脚本新建的隔离 Inspector
node tools/workerd-memory-lab.mjs before-profile e00d4a82 6 inspect
# 默认输入路径生成本次 JSON、CSV 与离线 HTML
node tools/workerd-memory-report.mjs
# 只读正式进程采样（不执行业务动作）
powershell -NoProfile -File tools/workerd-memory-observe.ps1 -OutputPath tmp/workerd-memory/new-observation.jsonl
```

Inspector 的 `Runtime.getHeapUsage` 在隔离实例能返回非零真实统计，和 workerd `node:v8` 占位值区别对待。一次极小隔离能力探针的 `HeapProfiler.collectGarbage` 请求未在 5 秒内回包，未把它当作成功 GC；正式对照/扩展实验不发送强制 GC，不通过 GC 或重启制造验收下降曲线。

## 后续生产诊断方案（待确认，尚未执行）

现有观察无法关联实际业务请求。要关闭长期根因，需要批准后续诊断版本与至少一个完整业务周期，而不是继续对当前闲时曲线做推断。

1. 候选仅在 Worker 边界增加固定有限分类计数：health、ordinary-read、write/import、transfer、scheduled、page/asset；记录开始、handler 返回、失败、当前在途数。明确 handler 返回不等于流式 body 已传完。首版不包装/tee 业务流、不记录正文、完整 URL、用户/店铺 ID、凭据或动态标签，避免诊断本身扩大内存或改变背压。
2. 复用既有 loopback health 的访问约束读取计数快照；独立只读采样器每 30 秒关联精确 PID/创建时间、release、Private/Working Set/CPU、helper busy。落盘按大小和时长双重有界，24 小时至少覆盖一次自然下载导入、普通查询及其后的空闲。进程更换分段，计数缺失明确标 unknown。
3. **实施前**在本 worktree 完成固定标签、权限拒绝、计数并发/失败、流不被复制、计数容器有界的测试，并与第 2 项确认日志/采样归属；不得先原地修改正式包。经确认后按项目发布入口准备不可变候选、备份与回滚材料，再按获批窗口切换 Worker/helper；不改 Django、PostgreSQL、n8n 或调度。
4. 回滚为受控采用原批准的 Worker/helper 前驱，诊断计数不写业务事实，无数据库迁移。若监控影响延迟或出现异常，保存脱敏证据后走原受控回滚，不能直接杀生产进程或扩大内存上限。
5. 对持续增长的路由/负载建立合成隔离复现；仅在隔离 workerd 做堆/对象保留分析，区分 live heap、外部缓冲区与运行时保留页。旧/新同序列至少多轮负载—空闲周期，对比增长斜率、回落、峰值和请求量。只有原已复现的保留机制消失且业务回归通过，才申请修复上线。

上述是具体下一阶段方案，不是已经完成的诊断实现或生产授权。当前候选只解决显式清理缺口；根因、生产负载规模、长期缓存行为与跨业务周期趋势仍未解决。

## 提交与交付状态

- 源码、测试及隔离工具提交：`aef2241a67e6d0879d91994bc3b5e17d2e117119`，已推送 `origin/codex/workerd-memory`。本报告/证据为同一分支后续文档提交，最终分支头另在交付消息中核验。
- 生产逻辑变更仅 `lib/ai/bounded-fetch.ts`；新增 `tests/bounded-fetch-cleanup.test.ts`，以及 `tools/workerd-memory-{observe,lab,inspector,gc-probe,report}` 对应 PS1/MJS 文件。本报告与 `docs/evidence/workerd-memory-20260929/` 保存证据。
- 最终修改文件定向 lint 为 0 错误、0 警告，`git diff --check` 通过；完整单测初次结果及环境修正后的定向复验按上文分别保留。
- 没有整站生产构建或发布候选准备；这仍是统一收尾会话合并/发布前须补做的门禁，不能将本次单模块 esbuild/真实 workerd 运行称作整站构建通过。
- 无数据库迁移、依赖升级、内存限额变更；无正式服务停启、部署、诊断端点安装、调度修改或业务补跑。最终只读回查 release/manifest/supervisor PID 与开始一致，本任务隔离 workerd/实验进程已结束。
- 不依赖其他优化分支；统一合并时需检查公共传输函数与调用方，保留第 2/6/7 项的文件分工。分支/worktree 保留，未合并 main，未修改总评估文档。
- **第 3 项总体仍未完成**：缺少历史问题的因果闭合、major GC 后存活集/对象保留路径、真实负载计数及完整业务周期前后验收。下一步先补充隔离对象保留证据；若需正式计数/诊断版本，则按上文方案完成候选验证并取得本轮明确上线确认后才能操作生产。
