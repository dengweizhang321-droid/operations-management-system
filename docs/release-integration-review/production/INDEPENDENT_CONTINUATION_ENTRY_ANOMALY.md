# AB 续接期间入口异常独立追溯

2026-10-10 09:13 UTC。**已证实 AB Worker exit1 并由同一原监督进程自动恢复，底层断连原因仍未知。** [机器记录](INDEPENDENT_CONTINUATION_ENTRY_ANOMALY.json) SHA `f4e992e41727107962bbb6afc4ae40db8a6f0a0d7142d4eb8649c94911f7e649`。旧06:06记录没有修改；不得将两段故障合并、删去或推定为恢复CPU争用。

新观察器原五个失败样本为 `09:06:15.749–09:06:25.798Z`，包含HTTP500、连接拒绝及TimeoutError。前后正常样本为 `09:06:13.248/09:06:28.309Z`，故失败采样跨度10.049秒、相邻200边界15.061秒；这不是精确停服时间。抓取时的完整观察器字节前缀另存 [INDEPENDENT_CONTINUATION_OBSERVER_CAPTURE.jsonl](INDEPENDENT_CONTINUATION_OBSERVER_CAPTURE.jsonl)，与实际仍追加的源文件相同前缀精确相等，SHA/字节数及最后采样时间见机器记录。不能把活动日志捕获摘要当未来最终文件摘要。

原 `supervisor-lifecycle-0.jsonl:1429` 在 `09:06:16.858Z` 记录AB Worker根42728 exit1；监督进程48744的身份/启动时间保持，6毫秒后安排1000ms受控重启，1432行于 `09:06:21.363Z` 生成新根44348。独立CIM窄查询及3000监听记录闭合当前链 `48744→44348→26892→18720(workerd)`，监督进程创建UTC仍 `06:26:26.7917950Z`。旧Wrangler实例的原日志在 `09:06:15.759Z` 报 `Error inside ProxyWorker` / `Network connection lost.`，调用栈同为ProxyController及Miniflare loopback；新实例 `09:06:23` 启动。它与06:06的错误表面相同，但不足以确定 native workerd、内存、连接或外部终止的因果链。

实际WAL显示第12步在 `09:05:06.688Z` 已completed/exit0，timeoutType=null、treeCleanupPending=false；第13步VerifyStartup直到 `09:06:49.019Z` 才started。五个失败采样时间窗内没有业务/生命周期/Restore的operation事件；当时处于原只读collector边界准入，原记录的Status观察始于 `09:06:02.116Z`、历时34.020秒且最终passed。没有记录A timeout或树清理，不能从相邻时间认定它误杀正式服务；准入WAL没有所有嵌套进程终止轨迹，故也不能把缺少记录外推为排除一切外部/OS终止。

当前实际candidate deployment-manifest原字节SHA为AB/f4，manifest的 `artifacts.keyFiles` 中监督脚本pin与物理SHA `cb34aec172c4f96d54043b12273e8dca8ac7f70fe8102212ccc7ba35aa18e3a8` 相等；其processIdentity入口与CIM命令一致。source交接commit仍 `5faac8151f59d66de72c3caead8cad916ea547da`，正式Django deployment原字节仍237f。原watchdog稍后快照显示AB、48744、3000监听18720及healthy/Running/Ready；独立只读Windows Application1000/1001窄窗09:05–09:08未找到匹配事件。当前恢复健康不改写先前五个失败。

与06:06约三小时的墙钟间隔只作时间巧合；旧D5和AB进程已运行的时长不同，不能据此宣称固定周期或定时任务根因。故障发生时没有Restore，更不能将两个故障都解释为恢复负载。后续整批报告须分别保留这段额外不可用、原监督自动恢复及根因不确定；不以最终页面200或strict receipt覆盖异常。

本次只读核验元数据、小回执、原日志和一份观察器前缀，不运行Status operator、新GET/UI、恢复、启停、Install、外发、重型测试或制品/数据库全扫描。审查只确认目标监督脚本及manifest/owner身份，未重做全候选校验；当前engine仍继续原批准后续步骤，本记录不宣称AB整批完成。
