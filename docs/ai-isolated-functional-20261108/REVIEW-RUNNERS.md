# W1 / W2 / W11b / W6 独立证据审查

2026-11-08，审查上下文 `/root/astra_runners`。按用户本轮逐小项 Astra 独审要求执行；请求型号为 `gpt-6-astra` / High，工具未独立回传实际底层型号，实际型号未独立确认。审查者未参与本轮实现或方案制定，没有操作服务、容器、数据库或账本，仅读取源码与已留存证据并作离线摘要/文件内容核对。

结论：**四个小项分别在下列已证明范围内通过，未发现阻断。最终临时服务收尾已由原上下文增量复核通过；本报告不构成生产验收证明。**

## 绑定与独立核对

- 冻结运行源码 `4317b3255b583508be15a671dac4048f0b7f08d2`；审查时工作树 HEAD 相同，改动为本轮未提交测试与文档。适用规范与所给依赖 `684b6b94`、当前本地 main 的相关规范差异为空。
- 逐件重算 [RUNNERS-INDEX.json](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-INDEX.json) 的 85 份证据摘要与长度、6 个测试脚本摘要，并重算 [SOURCE.json](D:/codex-artifacts/ai-isolated-functional-20261108/runners/SOURCE.json) 的 73 个 Runner 源文件摘要；均一致。
- 核对 setup/host 的 Git archive、镜像输入证明、精确镜像 ID 与 systemd 原服务启动记录；原 `pi_runner.server` / `pandas_runner.server` 没有被成功回执替身替换。测试改动仅在隔离初始化、连接限制、供应商 HTTP 夹具与显式调用驱动层。
- 独立比较 PRECHECK 与 RUNNERS-OBSERVED：24 份旧意图文件摘要、四个旧 unit 字节及 MainPID/ActiveState/SubState 不变；本轮最终工作负载清单 containers/volumes/pi 均为空。
- 实际 XLSX/CSV 字节摘要与业务回执相符；直接读取 XLSX ZIP/XML，四表名为“分析结果、来源、指标口径、缺失数据”，ZIP 完整性通过。原供应商请求日志分别出现两个匹配模型的 HTTP 调用，第二轮均有真实工具结果消息，正文摘要与小项回执一致。

## 分项结论

| 小项 | 结论及直接证据 | 证明边界 |
| --- | --- | --- |
| W1 | **通过。** 一槽专用 Runner 在原壳 running 和 stopped 两个状态分别拒绝新工作区 `session_limit`；对应 Docker inventory 均只有原容器。原 `server.py` 的容量检查按实际 managed containers 计数，与观察一致。见 [PI-LIFECYCLE](D:/codex-artifacts/ai-isolated-functional-20261108/runners/PI-LIFECYCLE.json)、[live](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-inventory-live.stdout)、[stopped](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-inventory-stopped.stdout)。 | 本轮为串行一槽容量样本，不是多槽并发、unknown/unregistered 容器全分支验收；也未据此批准处理生产保留容器。 |
| W2 | **通过。** 原签名 pause → 精确身份 reclaim_stopped 保卷 → wake 新壳，卷名一致、容器 ID 改变；文件内容及 SHA、下载字节一致；原 Pi session 标识与 thinking level 保留，网关待处理请求为空。最终 dispose 后按 disposed ledger、零 unknown 和卷标签核对，仅删除用例卷。见 [pause](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-pause.json)、[reclaim](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-reclaim_stopped.json)、[wake](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-wake.json)、[file read](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-file_read.json)。 | 无模型轮次，`nativeSessionId` 本例为 `conversation`，这个标识和文件保留不能替代长对话内容或供应商会话恢复证明；本轮只证明原生本地恢复路径。 |
| W11b | **通过。** 原签名 Django HTTP 入队、真实 PostgreSQL PiOperation、原 claim/perform、签名 Runner、真实 Pi 容器及 bash 执行受管脚本；worker 当前提供 1.2.0 时，既有操作仍加载精确 1.3.0 包及摘要。四表含合成退款 −120 分及来源/口径/缺项；原 owner 下载通过，其他 owner 为 404。见 [小项原件](D:/codex-artifacts/ai-isolated-functional-20261108/runners/functional-w11-5ef89b4050f5.json)、[工作簿](D:/codex-artifacts/ai-isolated-functional-20261108/runners/functional-w11-5ef89b4050f5.xlsx)。 | 测试显式调用原 worker 函数，不等于常驻 worker 管理命令/调度循环验收；模型规划由本地 HTTP 固定回复驱动，不证明真实模型账户能力。源码中终态判定仍要求 settled/terminalReceipt/filesCollected 及文件摘要，未因夹具绕开。 |
| W6 | **通过。** 原聊天→中央 edge/注册表→原 owning reader→三页商品日及一页销售趋势→签名 Broker→真实无网络 Pandas→原表格/CSV 资产链闭合，返回 31,400 分与 −300 分；另一 owner 404。九品类不完整趋势为 400，Broker requests 计数严格 5→6→6→7，拒绝样本未进 Broker；真实代码异常 503，journal 有失败与 cleanup ok，最后容器为空。独立原生样本证实非 root、仅 lo、宿主 Pi 端口不可达、无 Docker socket。见 [应用回执](D:/codex-artifacts/ai-isolated-functional-20261108/runners/functional-w6-534a0e99294e.json)、[成功隔离回执](D:/codex-artifacts/ai-isolated-functional-20261108/runners/PANDAS-CONTAINER-SUCCESS.json)、[失败回执](D:/codex-artifacts/ai-isolated-functional-20261108/runners/PANDAS-CONTAINER-ERROR.json)。 | `complete` 是当前来源集合导完；原回执已明确 live_per_page/live_per_source，不能称跨页跨域原子快照或全部日期覆盖。合成异常不能确定此前线上 Pandas 失败的根因。 |

## 必须随最终报告保留的限制

1. Windows→WSL 使用本轮透明 stdio/TCP 字节中继，原请求/响应 HMAC 穿过中继核验；没有证明原生 WSL localhost 自动映射可用。
2. 私有 AppUser 与私有 HMAC 证明内部权限调用链，未验证普通宿主登录、公开浏览器鉴权入口或生产 SQL 角色资格。测试数据库是非 superuser 的宽权限 development role。
3. 两套模型回复均为实际回环 HTTP 夹具，数据为合成数据；没有真实模型、生产数据、外部消息或生产容器操作证明。
4. [RUNNERS-OBSERVED](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-OBSERVED.json) 的 `fixtureServiceTeardownPending: true` 是功能结束时原始截点，原件保持。后续已按精确归属完成收尾，并通过下述增量复核；没有为收尾重跑功能。

## 最终收尾增量复核

2026-11-08 10:01 UTC，在同一独审上下文核对新增收尾原件与当前有限只读观察，结论通过：

- [RUNNERS-INDEX-FINAL.json](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-INDEX-FINAL.json) 中 95 份文件的 SHA-256/长度全部匹配，六个脚本摘要与初审索引完全相同，`teardownPending: false`。
- [Linux 收尾](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-CLEANUP-LINUX.json) 与 [最终收尾](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-CLEANUP.json) 的共同字段逐项相等。容器/卷为空，Docker inactive/MainPID 0；本轮两个 unit inactive/MainPID 0/FragmentPath 空，两份 Linux key、profile 和本轮 unit 文件按精确名单移除。旧四个 unit 的完整状态及字节摘要、24 份旧意图摘要与 PRECHECK 相同。
- [WSL-FINAL.txt](D:/codex-artifacts/ai-isolated-functional-20261108/runners/WSL-FINAL.txt) 记录私有发行版 Stopped；[relay.stdout](D:/codex-artifacts/ai-isolated-functional-20261108/runners/relay.stdout) 有原中继 PID 12324 的 bound 及 `stopped/requested:true`。最终脚本确认两个中继端口关闭。
- [Windows 应用停止](D:/codex-artifacts/ai-isolated-functional-20261108/WINDOWS-FINAL-STOP.json) 的四个 PID/创建时间与 launch 记录对应，停止脚本在操作前核创建时间、命令和允许的子进程身份。审查者于 `2026-11-08T10:01:40.3380395Z` 独立只读查询 PID 12324、26588、33916、24564、13732 均不存在；55488、28444、28445、28446、28447、28121、28123、28112 均无监听。工具会话 `Unknown process id` 没有被用作进程退出证据。
- [PG-STOP.json](D:/codex-artifacts/ai-isolated-functional-20261108/PG-STOP.json) 记录私有 pg_ctl 正常退出 0、数据库保留；实际 `postmaster.pid` 不存在。按 [Windows 凭据清理](D:/codex-artifacts/ai-isolated-functional-20261108/WINDOWS-CREDENTIAL-CLEANUP.json) 和 Runner 收尾清单，独立确认私有应用 DPAPI、Runner 两份 DPAPI 及 Windows profile 文件均不存在。测试库与审计材料留存，重新启动需新凭据。
- 另读 [FINAL-CLEANUP.json](D:/codex-artifacts/ai-isolated-functional-20261108/FINAL-CLEANUP.json)，其零私有监听/进程、五个精确路径不存在的较早观察，与上述独立观察一致。

这次增量核查只闭合本轮隔离资源收尾，不新增生产状态比较结论，也不覆盖前述功能限制。

本报告没有授予合并、生产制品准备、上线或生产维护权限。共享记忆由主负责人结合本阶段最终状态统一落盘，避免将当前待收尾截点记录为已完成。
