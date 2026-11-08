# Pi 与 Pandas 隔离功能验证

运行源为 `4317b3255b583508be15a671dac4048f0b7f08d2`。私有 WSL 内实际运行候选的两个原 `server.main`。Pi 与 Pandas 运行文件分别重新计算源摘要，73 个文件逐件匹配先前审过的冻结材料。两套镜像均核对了本次 Git 输入及本机镜像 ID，沿用 Pi `sha256:dea9bb9e4a8a8f41865a10666981444d51ef52415c89e980af0c70e7219a5df2`、Pandas `sha256:4c5815d845a4579d5402f2f4c22c8c822701a0116df2e0fc8b28ef31e832d580`。 [源码、镜像输入和原生进程绑定](D:/codex-artifacts/ai-isolated-functional-20261108/runners/SOURCE.json) · [systemd 启动回读](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-STARTED.json)

| 小项 | 已执行与观察到的结果 | 证据入口 |
| --- | --- | --- |
| W1 Pi 容量 | 一槽专用 Runner 上，真实容器运行及已停壳但未回收两个状态均返回 `session_limit`。Docker 独立回读只见原壳，仍归原工作区。 | [容量与生命周期回执](D:/codex-artifacts/ai-isolated-functional-20261108/runners/PI-LIFECYCLE.json) · [运行壳](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-inventory-live.stdout) · [停壳](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-inventory-stopped.stdout) |
| W2 Pi 保卷停止与唤醒 | 原签名 pause 证实旧壳已停，按精确绑定回收旧壳且保留同卷。签名 wake 创建新容器，回读原卷、Pi session 标识及 thinking level。原文件写入、读出和快照下载 SHA 一致，待处理网关请求为空。签名 dispose 后只删除本用例 ledger 已明确 disposed 的卷。 | [停止](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-pause.json) · [回收](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-reclaim_stopped.json) · [唤醒](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-wake.json) · [原文件回读](D:/codex-artifacts/ai-isolated-functional-20261108/runners/pi-file_read.json) |
| W11b 受管技能和 Excel | 原签名 Django HTTP 提交精确技能引用和合成输入文件。原 PostgreSQL 队列、claim/perform、签名 Pi Runner 与真实容器执行。显式 worker 的当前技能目录为 1.2.0，已登记操作仍回执加载 1.3.0 的精确 `excel-report`。两次回环 HTTP 模型回复驱动真实 bash 运行该包脚本。四个工作表含数据、来源、口径和缺项，退款为 −120 分。原 owner 下载及 SHA 校验通过，另一账号 404。 | [操作、加载与模型回执](D:/codex-artifacts/ai-isolated-functional-20261108/runners/functional-w11-5ef89b4050f5.json) · [原工作簿](D:/codex-artifacts/ai-isolated-functional-20261108/runners/functional-w11-5ef89b4050f5.xlsx) |
| W6 Pandas 源导出与产物 | 原签名聊天入口经真实中央注册表、Django owning reader、签名 Broker 及 pandas 容器，导出三页京东商品日和一页销售品类趋势。净销售 −300 分，商品成交 31,400 分。原表格与 CSV 回读同值，另一账号 404。九品类趋势未达完整性要求返回 400，Broker nonce 计数不变。真实代码异常返回 503，Broker journal 记录执行失败和清理成功。原工具和逐页来源审计均有实际记录。 | [来源、结果、审计和 journal](D:/codex-artifacts/ai-isolated-functional-20261108/runners/functional-w6-534a0e99294e.json) · [实际 CSV](D:/codex-artifacts/ai-isolated-functional-20261108/runners/functional-w6-534a0e99294e.csv) |
| W6 Pandas 容器独立反例 | 真实签名成功和代码异常分别返回 200/503。实际容器进程仅见 `lo`，无法接通宿主 Pi 端口，采用非 root UID，可在 `/work` 使用临时文件，且容器内无 rootless Docker socket。两次均经 Docker 独立观察零容器，异常后原签名探测仍可用。 | [成功回执](D:/codex-artifacts/ai-isolated-functional-20261108/runners/PANDAS-CONTAINER-SUCCESS.json) · [失败回执](D:/codex-artifacts/ai-isolated-functional-20261108/runners/PANDAS-CONTAINER-ERROR.json) · [清理回读](D:/codex-artifacts/ai-isolated-functional-20261108/runners/PANDAS-NATIVE.json) |

## 真实层、夹具与边界

- 本轮专用 WSL UID 1000 的 rootless Docker 运行真实容器。Pi 仅在新 `pi-native-ai-functional-runners-20261108` 命名空间分配壳和卷。Pandas 使用原固定容器标签，由仅有本轮 Broker 的专用 Docker、独立 systemd 单元、账本和密钥隔离。
- WSL 本机自动回环映射实测不可用。Windows 侧用本轮专用回环 TCP 透明中继，把原始 HTTP 字节送至同发行版的 WSL 回环。原应用签名及回执验签跨过中继；这个接缝只证明当前功能运行路径。
- Windows 应用使用私有 PostgreSQL、真实签名身份、真实 owning reader、真实 Worker edge 和真实 Django writer。普通登录、生产角色资格、模型账户及真实业务数据覆盖待单独验证。W11b、W6 的模型回复来自真实回环 HTTP 合成夹具，表格内容来自合成来源。W1/W2 直接作用于 Runner 原签名 API，观察本地文件和容器边界；没有模型轮次或长对话历史恢复样本。W6 的 `complete` 指当次来源集合导完，商品日逐页读取。
- 原两次线上 Pandas 失败的内层原因仍未确定。本轮 400/503 和证据相关的 `container_execution_failed` 均来自独立的合成反例。

## 初始失败与资源收尾

首次真实启动后，Windows 观察器使用了 Windows 分隔符预计算 Linux unit SHA，和原件不同，随后修正计算。Windows 没有默认 WSL 转发，且私有发行版在无活跃 WSL 客户端时自动退出。保留首次启动、回读失败和断连事实。续接前确认两套新服务 inactive、原 ledger 无已签名请求和无业务派发、Docker 容器为空且卷清单与初始一致，随后用有界 stdin keepalive 启动同一源码和 unit 字节。 [首次启动原件](D:/codex-artifacts/ai-isolated-functional-20261108/runners/03-start.stdout) · [独立回读](D:/codex-artifacts/ai-isolated-functional-20261108/runners/03-reconcile.stdout) · [有界续接原件](D:/codex-artifacts/ai-isolated-functional-20261108/runners/03-start-existing.stdout)

功能测试收尾时容器和卷清单均为空，旧四个单元状态和字节以及 24 份意图文件的摘要逐一相符。旧失败原件、未知意图和签名账本均留存。Windows 应用停止后，原精确清理脚本已停止两套临时服务和本轮中继、移除两端临时密钥/profile/unit，确认 Docker inactive、私有 WSL Stopped。生产发行版只出现在 WSL 名称与状态列表。 [功能结束清单](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-OBSERVED.json) · [最终清理](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-CLEANUP.json) · [最终 WSL 列表](D:/codex-artifacts/ai-isolated-functional-20261108/runners/WSL-FINAL.txt)

原件 SHA-256 及取证脚本见初始 [RUNNERS-INDEX.json](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-INDEX.json) 和最终 [RUNNERS-INDEX-FINAL.json](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-INDEX-FINAL.json)。
