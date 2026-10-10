# 两个时间窗的原运行故障独立复核

**17:43入口中断对应真实Worker退出和自动恢复；17:50–17:51的原21未就绪是另一个时间窗，具体失败域仍未知。** 两者不能合并为同根因。非作者原运行代码复核与证据SHA见 [机器报告](FINAL_TAIL_RUNTIME_FAILURE_REVIEW.json)。本报告不审查我自己写的尾部protocol，没有新的Status/HTTP/SQL/锁/生产工具调用，也没有改原代码、日志、服务或调度。

## 17:43：真实退出、错误表面与自动恢复

原221个入口样本中的8个失败在17:43:12.357–17:43:29.885Z；前后健康样本17:43:09.844/17:43:32.389，失败样本跨度17528ms、相邻健康边界22545ms。它们不是严格连续停服测量。

现存原supervisor journal记载：同一supervisor48744在17:43:12.744收到managed Worker66676的exit1/signal null；12.751安排8000ms重启，20.757重验启动，24.475生成新managed Worker52084，随后入口恢复。Worker66676原生成于10:02:15.422；supervisor保持06:26:26.791795Z创建回执和连续心跳。同窗没有 `liveness_termination`，符合子进程退出后的原自动恢复路径，不能说是“整个服务树被重启”或由诊断重启恢复。

旧Worker的Wrangler日志 `wrangler-2026-10-10_10-02-16_024.log:21796` 在17:43:12.374记录固定框架原因 **Error inside ProxyWorker**，21807/21808内层cause为 **Network connection lost**。栈是Wrangler ProxyController和Miniflare loopback custom service；原Wrangler `cli.js:311631`处理ProxyWorker error消息，311747包装cause，Miniflare `index.js:88266/88500`处于loopback service调用。库版本原物理包为Wrangler4.92.0/Miniflare4.20260515.0。

这些事实定位了错误表面及退出/恢复链，尚不能确定断开的原始连接、请求、workerd原生终止来源或退出触发机制。没有证明CPU争用、OOM、观察器取消body或A的期限杀树；也没有完整OS终止轨迹可排除一切外部误杀。日志中任意用户payload、URL/正文和任意异常文本未复制到本报告。

旧D5的06:06前Restore异常也曾出现Error inside ProxyWorker/Network connection lost，旧supervisor2924/Worker64644 exit1并自动生成15520。此相同错误表面横跨旧D5与AB，支持它并非只在本轮可见；不能据此推定相同根因或声称A保护已经全部生产证明。原恢复成功和后来的Ready都不覆盖入口异常。

## 17:50–17:51：真实未就绪，未见同期Worker退出

原21状态查询17:50:18.017开始，46494.0048ms后记录 `STATUS_NOT_READY`、retryable=false；17:51:04.664保持unknown，head `d60a34f1…`。原20已有真实passed/receipt `fde84841…`，97条链和active9保持；本轮未就绪不能由原20成功覆盖。

原已pin `release-readonly-retry.mjs:67`先断言releaseId和workerState exact_release，随后68–70检查state Running、backend Ready及12个实际组件。当前错误是NotReady而非identity mismatch，因此依据原代码可推定identity检查通过，至少一个就绪字段不满足；这不是重建原stdout。失败完整Status body未保存，无法确定具体域或哪个probe。

控制层 `operations-system-control.ps1:451–520`在exact release时仍可能因后端NotReady返回BackendUnavailable，聚合错误返回StatusError，或因live/helper/ready探针返回Unresponsive/BackendDegraded。即使网页200，也不能覆盖这些失败。17:50–17:52现存supervisor仅同PID心跳，没有worker child_exit/child_spawn/liveness_termination；原入口采样在这次查询中没有新失败，不能将它解释成17:43的同一次崩溃。

只读现存core reader24800/writer62136及Django supervisor36244回执仍指向06:23–06:36创建时间；未找到此两窗口新的launcher生命周期记录。这里仅是既存元数据和日志，不是新的进程/端口探测或永久健康证明。

执行者后来唯一独立诊断17:54:35.468–17:55:10.623由PID28888 direct exit0回读Running/Ready/exact f4/12true，原518字节stdout SHA `32118a1e…`。该诊断明确不是原21，不更改原unknown，也不代表失败瞬间已被覆盖。

## 可隔离验证的修复需求

1. 原B取证接缝在不可变 `release-batch.mjs:428–430`：成功Status结果解析后直接断言，NotReady异常没有携带失败瞬间完整投影。应在断言前保存固定state/backend/worker、12个bool/缺项、实际process和stdout SHA；保持原CLI/全部断言及NotReady非retry。覆盖假healthy页面、缺组件、错误身份、解析失败、超时及取证写入失败负例，禁止制造本次已丢失原stdout。
2. 使用上述精确Wrangler/Miniflare组合，在独立Worker/proxy服务中分别注入连接丢失、普通请求、abort、body cancel和dispose，记录真正child exit/错误/health。先闭合因果接缝，再修该接缝；不能吞所有错误、返回200或降低就绪断言。本轮未运行该复现或修复。
3. 原supervisor `:383/:460–469`的10分钟5次保护仍在，但delay所用restartCount按整个supervisor生命周期累计，长时间健康后不重置；本次因此等待8000ms，后续可升至30000ms。这是独立恢复时延行为，不是网络故障原因。若优化，须隔离验证健康窗口重置与快速flap，保留原rate guard、精确所有权/端口/制品/权限重验。

本报告只交故障事实和隔离需求，没有重复生产审批/重试方案。原19与21unknown、旧清理blocked、入口异常及原因不确定均保持；必要验收和完整交付尚未闭合。
