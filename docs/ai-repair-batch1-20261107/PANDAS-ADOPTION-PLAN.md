# W6a Pandas 采用阻断与最小拆包方案

2026-11-08，Asia/Shanghai。定向规划咨询，请求角色 Astra High；调用工具未另回传实际底层型号。本规划者不承担原 W6a 或后续轮换包的最终独立审查。

**本批采用窄拆包：保留 Django/Worker 阶段诊断，把 Broker 内部诊断完整保全到后续候选。恢复 `backend/pandas_runner/` 全部非测试 Python 的精确原基线，严格摘要探针保持。** 负责人已确认这一实施选择；这不是 W6 全阶段完成，也不是合并、制品准备或上线授权。执行者完成拆包与必要增量验证后，交回原 W6a Astra 上下文独立复核。

## 1. 已核事实和判断

- [原 W6a 反审](REVIEW-W6A.md)的 W6A-01 是确定的启动依赖阻断。`protocol.package_digest()` 哈希包内所有非 `test_` 的 `*.py` 原始字节；新增帮助模块同样改变摘要。`probe.probe()` 对已签名 `/v1/status` 的 `runnerSha256` 与部署目录本地摘要严格比较。
- `tools/django-ai.ps1` 的 `Start-AiStack` 先调用 `Start-PandasSandbox`，之后才启动 AI reader/writer；总控 `AggregateStatus` 同样依赖签名探针。协议 v1 兼容不能替代该启动条件。
- `install_linux.install()` 是首次、create-only 安装器。原路径为 root 所有的 `/opt/teruisi-pandas/releases/<digest>` 与 `/etc/systemd/user/teruisi-pandas.service`，现有安装返回 `existing_install_requires_reviewed_rotation`。不能重跑安装器、覆盖旧 release 或单独修改 unit 来交付本包。
- Pandas 的状态与密钥在 `/home/teruisi-pandas/.config/teruisi-pandas/`，其中 `state/requests.sqlite3` 是持久防重账本；`broker.lock` 是单进程文件锁。与 release 分离意味着未来只换代码可以原位保留账本，无需 Pi 式状态复制。
- 现有 Pi 轮换可借鉴编排，不可直接复用其执行器：`pi_agent_upgrade_runtime.py`、`pi_runner.runtime_upgrade` 固定 Pi namespace、8123 端口、UID1000 用户 unit/release、Pi 配置和复制状态协议。Pandas 使用 root 管理的另一 unit/release、8121 端口与固定外置状态，不能改参数冒充 Pi。
- `publish-prepared-main.mjs` 已有 `PrepareApp → PreparePiUpgrade → PREPARED` 与维护后 `DeployApp/HardenAcl → UpgradePi → finishMainPublication`，没有 Pandas 切换阶段；维护材料中的 `pandasConfigSha256` 只是前驱绑定。`publish-main-resume.mjs` 亦是 Pi 限定续接，不是通用恢复入口。
- 原方案第一批只要求 W6 诊断，并明确先交独立可用部分，后续扩展不阻塞首批。为完整 Broker 诊断增加 root 跨权限轮换、持久意图、回执、发布接线及真实隔离生命周期验证，虽技术可行，但已明显超出“添加阶段诊断”的窄包；本批不展开。

本规划只读工作树/规范/任务资料，未读取生产目录或调用 WSL。检查时任务 HEAD 为 `e268b28761ae4ada958455344c0dfbb37d2ae4f8`；其 `backend/pandas_runner/` 与已获取的 `origin/main` `0c7d0feb33f45cfc6ae1f283b81d401c873c5768` 无提交差异。相关模型、开发、架构、验证发布、运行及安全规范与该远端引用无差异。没有据此声称动态生产源码已核验。

## 2. 本批执行清单

按以下顺序执行，不对整个工作树做 restore/reset，不碰其他小包的在途改动。

1. **先保全原候选，再移出运行源码。** 使用当前 W6a 冻结清单核对 `server.py`、`diagnostics.py` 和测试原件；在外置任务证据目录下 create-only 保存原始文件、完整补丁、逐文件 SHA-256、基线提交、原候选 package digest、原审查及测试证据入口。建议目录 `D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w6a-broker-deferred/`。保全后从副本复算摘要并证明可还原；原审查结论继续指向原候选，不篡改旧报告为拆包已通过。不能把候选 `.py` 换个子目录留在 `backend` 内，`Prepare-Application` 会复制 backend 树。
2. **帮助模块归 Django。** 将纯 `reference`、`no_stage`、`stage` 实现移为 `backend/ai_assistant/pandas_diagnostics.py`，保持函数语义和脱敏字段不变。`datasets.py` 改为 `.pandas_diagnostics` 导入 `no_stage`；`pandas_sandbox.py` 改为同域导入三函数；测试内相应 import 同步修改。无需改 `protocol.py`、`probe.py`、包摘要算法或复制排除清单。
3. **完整恢复 Broker 基线。** 仅恢复 W6a 对 `backend/pandas_runner/server.py` 的修改，并从该目录移出新增 `diagnostics.py`。按完整目录清单验证全部非测试 `*.py` 与精确原基线逐文件字节相同，不能只看 tracked diff 或只复核 server。也不能把 helper 改名为 `test_*.py` 留在运行依赖中来绕摘要。
4. **保留独立诊断调用。** 保留 `lib/ai/analysis-sandbox.ts` 的外层请求摘要、Django 可选 `parentRequestRef`、来源诊断、发送前 `brokerRef` 及回执验签/被动验证；旧 Broker 的 v1 请求正文不含新增诊断字段，继续发送原 `code/frames`。不改变权限、分页、行数、超时、取消和未知结果处理。
5. **测试按实际交付范围拆分。** 保留来源 fixture 和 Worker 关联测试；将 `test_diagnostics_link_loopback_broker_and_distinguish_execution_validation_and_cleanup` 改名并限定为“旧 Broker 的真实 HTTP/HMAC 回环与 Django 通道诊断”。使用恢复后的真实 `Handler` 和现有 Docker 命令替身，保留成功、执行失败、结果无效、清理失败输入，但只断言 Django 的发送、读取、验签、结果阶段及统一 `signed_runner_failure`；删除对新 Broker sink、`broker_receive` 和容器内部阶段事件的本批断言。原跨组件细分断言随候选保全，不能删掉证据后称原全链验证继续有效。
6. **刷新文档与独审输入。** 更新 `METRICS-DIAGNOSTICS.md`、`STATUS.md`、`REPORT.md`、`HANDOFF.md` 中 W6 范围、计数和缺口；增加拆包后的冻结清单。原 `REVIEW-W6A.md` 的历史发现和原证据保持，由原审查者追加增量结论。交付用语为“W6a Django/Worker 诊断完成，Broker 内部诊断后置”，不能写“W6 全阶段通过”。

### 文件范围

| 文件 | 本批动作 |
| --- | --- |
| `backend/ai_assistant/pandas_diagnostics.py` | 新增：原纯帮助模块迁入 AI 域 |
| `backend/ai_assistant/datasets.py`、`pandas_sandbox.py` | 只调整帮助模块 import，保留已审诊断增量 |
| `backend/ai_assistant/test_pandas_sandbox.py` | 调整 import 及旧 Broker 兼容断言，保全原细分测试 |
| `backend/pandas_runner/server.py`、`diagnostics.py` | 原候选先保全；恢复前者精确基线，后者退出运行源码树 |
| `lib/ai/analysis-sandbox.ts`、`tests/pandas-sandbox.test.ts` | 原 W6a 增量保留；无新增协议要求 |
| 本任务报告/冻结清单 | 列明缩小后的交付、原候选入口及增量检查 |

`backend/pandas_runner/` 的其他文件、安装器、生命周期、发布工具和生产配置均不因这次拆包变更。本表只描述 W6a，批次其他小包仍按自身范围处理。

## 3. 覆盖保留与损失

| 保留的观测 | 明确无法据此断言的事项 |
| --- | --- |
| 请求/权限/配置/密钥可读性/执行名额、逐来源目录/权限/查询/水位/返回结构/集合/分页/投影 | 旧失败的历史内层根因；本批仍不能回填历史事件 |
| Worker request 摘要、Django invocation 摘要、发送前 nonce 摘要 `brokerRef` | Broker 已接收或持久登记该 nonce；发送成功不证明远端执行 |
| 请求发送、响应读取、HMAC 验签、镜像及清理声明、被动结果结构 | 无响应时是请求未达、进程退出、容器执行还是回信丢失 |
| 已签名错误与未验签响应可区分；缺清理证明仍抑制结果 | 旧 Broker 通用错误中的防重/解码/预检/创建/隔离/运行/输出/清理具体失败阶段 |
| 来源 `source_pagination` 与 `source_collection` fixture 可独立定位 | 真实容器内部阶段耗时、Linux journal 入库或端到端阶段关联 |

这些损失影响诊断精度，不取消原容器隔离、持久防重、清理后置、poisoned、签名探针或 unknown 不重放。两条已知来源的下一次失败仍可由 Django 证据先判断是否停在导出端；Broker 内部问题需后续包闭合，不猜测为数据源问题。

## 4. 本批最小增量验证与完成条件

- 比较恢复后的全部非测试 Python 文件集合、逐文件原始字节与 `package_digest()`。既验证“无 tracked 差异”，也验证“无未跟踪运行文件”；当前 `core.autocrlf=input` 且相关文件无显式 eol 属性，仍按真实材料字节计算，不用换行规范化伪造相等。
- 用最终候选目录执行 Python 导入/语法检查，证明没有任何 `pandas_runner.diagnostics` 残留引用。新 helper 必须随 AI 后端复制，不能只靠开发机路径偶然导入。
- 复测直接受影响的 W6a Django SimpleTestCase、旧 Broker HTTP/HMAC 回环及 Worker 标识测试。沿用合成密钥、随机本机端口、Docker 命令替身；不在宿主执行模型代码，不访问真实 WSL、生产服务或业务数据。不为拆包新增无关全量测试。
- 最小签名 probe 夹具调用原 `probe()`：从最终候选目录复算匹配摘要的旧 Broker status 接受；仅摘要不匹配仍拒绝。不得替换 probe 的比较函数或把响应 hardcode 为接受任意摘要。
- 冻结清单与原件绑定，记录拆包后的实际计数。原 15 项 Broker 测试、原跨组件细分测试不是新包的新增验证；跳过的真实容器测试保持未测，不冒充通过。
- 把以上增量交原 W6a Astra 独审，重点复核 helper 迁出、旧 Broker 兼容、摘要字节、导入闭包与报告边界。未变诊断实现复用原结论，不重做整套源码审查。

以上闭合即可解决 W6A-01 对本次增量引入的阻断。未来正常准备/上线仍由原动态门禁核实际生产前驱及摘要；本次不读取生产或预先生成应用制品，不声称整批其它项目已就绪。

## 5. 后续 Pandas 专用轮换的最小设计约束

以下是第二批新聊天可采用的有限实施起点，**不是现有工具已支持的动作，也不是本批执行任务**。无需新沙箱、新调度、新模型层、镜像升级或 Pi 平台改写；只允许同一 Pandas 服务的精确代码前向轮换。若现役身份或前驱不符合，停止并保留事实，不扩成通用升级器。

### 5.1 可复用接口与必需新增面

| 现有接口/位置 | 后续窄扩展 |
| --- | --- |
| `django-local-service.ps1`: `Prepare-Application`、`Get-PreparedApplication`、`Assert-DeployedApplication`、`Invoke-BoundedNativeProcess`；`django-ai.ps1`: `Get-PiUpgradePreparedExecutionRoot` 的准备来源核验模式 | 复用精确 prepared app/receipt/来源核验；新增 Pandas 专用准备/只读检查/切换/结果观察 action，不能用源树任意脚本控制现场。新增工具必须进入现有 PrepareApp 显式复制清单 |
| `django-ai.ps1`: `Read-PandasConfig`、`Assert-AiPortsFree`、`Stop-PandasSandbox`、`Start-PandasSandbox`、`Invoke-PandasProbe` | 配置/DPAPI 密钥/镜像均沿用；停止与启动继续走原入口，保留 PID/创建时间/命令行/fingerprint、严格签名 status 与原合成计算门禁 |
| `backend/pandas_runner/install_linux.py` 的固定路径及普通文件规则 | 首次安装器保持 create-only；新增 Pandas 专用 root operator（建议 `tools/pandas_broker_rotation_linux.py`）只准备不可变 release 与对一个精确 unit 做 CAS；不嵌入可任意执行命令/路径的远程接口 |
| `tools/pi_agent_upgrade_runtime.py` 的有界 WSL 传输/固定错误码模式 | 新 `tools/pandas_broker_rotation.py` 复用原则而不 import Pi 的路径/状态动作；root 仅写 root 所有的代码/unit/轮换控制证据，Docker/systemd 用户调用必须降到原 UID1000、原环境 |
| `publish-prepared-main.mjs`、`publish-main-tail.mjs` | 依据完整 Git 差异识别 Pandas 非测试 Python 变更及配置存在性；准备回执加入 `pandasBrokerRotation`；正式维护期才切换，最终 SUCCESS 绑定轮换结果 |
| `publish-main-resume.mjs` 与 `publish-main-pi-reconciliation.mjs` | 不能自动套用 Pi reconcile。Pandas intent 未完成时既有续接必须明确拒绝跳过；仅新增本域精确只读观察/补回执分支，不做通用重试或改写 Pi 协议 |

新增 operator 放在 `tools`，不无故增加 Broker 自身 digest 输入。准备的 successor 仍包含真正修改的 `server.py`、Broker helper 与所有既有非测试 Python 字节；不能把需要在 Broker 运行的文件排除出摘要。

### 5.2 准备、切换、完成的顺序

1. **获合并授权后的准备阶段：** 原发布器冻结最终 main 来源并完成 Django PrepareApp；准备工具只读核原 unit 的文件和 systemd 有效定义、无额外 drop-in/别名遮蔽、原 release 完整字节/owner/mode、配置/key/image 指纹、固定发行版和 UID/socket/state 路径。在线账本会变化，准备不能把其内容摘要当切换时固定 CAS，也不复制/清空它。核 root 通道权限与工具身份失败必须在维护前暴露。
2. 通过固定、白名单环境的 WSL 通道向受审 root operator 传递有界来源归档。拒绝路径逃逸、链接、额外文件和文件数/字节超限；按真实原始字节重算 successor 摘要。只 create-only 写新 root-owned release、精确 successor unit 材料和不可变 plan，现役 unit/config/key/state、服务和 Docker 对象均不修改、不启动。既存残片或未完成旧 intent 阻断；只有完整同计划后置已证的准备结果允许复用。
3. plan 必须绑定最终提交/冻结来源、Django prepared ID 和收据、Windows 配置/密钥文件指纹、Linux 配置/key 身份、同一 image、前驱/后继源码与完整清单、前驱/后继 unit 字节、发行版、固定账户/socket/state 及 operator 字节。状态内容不写公开回执，密钥原文不跨日志。准备失败保留残片，现役不受切换影响，不能因此另建 operation 绕过未知。
4. **单独获上线授权后：** `publish-prepared-main` 在 STARTED 前复验计划、所有静态前驱和 root 权限；通过原维护入口排空停止 AI 与旧 Broker。原 `Stop-PandasSandbox` 的零 `teruisi.pandas-broker=v1` 容器检查保留；apply 在本域锁内重新核 unit inactive/MainPID=0、无精确旧进程/端口占用、旧 broker 文件锁可独占、同标签及同命名空间容器为零。不能只看 `systemctl stop` 退出0，不删除残留容器。
5. 在原 `DeployApp/HardenAcl` 完成后、`finishMainPublication` 启动阶段前，调用安装包内受保护的 Pandas action。以原发布 owner/maintenance ID、计划 SHA、已停止证据及当前前驱 unit SHA 为准写 create-only intent，再原子替换**一个**精确 unit 的绑定并 fsync/daemon-reload；不改配置、key、镜像、nonce ledger，不产生另一套 current 指针。
6. 单纯 CAS 完成记为 `switched_stopped`，不是 ready。让原生命周期 `Start-PandasSandbox` 启动匹配的 successor，由原严格 status/镜像/清理和合成检查给出资格；将精确 unit/source/原启动回执绑定进最终轮换结果，再由原 `VerifyStartup`、ready 和发布 SUCCESS 收尾。需要在原启动接缝输出可绑定证据，不能用端口开放或 unit active 代替签名探针。若未闭合轮换结果，禁止最终 SUCCESS 与恢复入口跳过此条件。

Pandas 与 Pi 仍是独立的固定域，零容器检查仅限 Pandas；不能把 Pi 保留环境当垃圾清理。两个动作共处一次发布时使用原串行发布锁，不增加全域 Docker 清理或停止发行版。

### 5.3 状态和失败边界

| 原状态/失败位置 | 允许的后续与可用性保护 |
| --- | --- |
| 准备/检查失败，尚未维护 | 旧 unit 与服务保持原样；报告制品未就绪。保留新 release 残片及原错误，不自动重做 |
| 已维护但未写切换 intent | 根据原发布失败协议处理；重新开放前须确认原应用/单元仍匹配且无迟到操作。不能仅因 unit 旧就宣称整轮零效果 |
| intent 已写，CAS 是否执行未知 | 保留原 owner、intent、两套 release/精确 unit 原件；不换 operation ID、不再次 apply、不重发模型或工具请求 |
| unit 已切但启动失败/结果未知 | 保持现场并报告未完成；不自动启动旧 Broker。新 Django 与旧 Broker 的 digest 不匹配，单独恢复 unit 无法恢复整栈可用性 |
| 原切换及签名就绪已持久证明、返回丢失 | 同一 intent 的只读观察可以复用完整证据并补最终回执；不再换 unit、启动或执行合成/业务请求。证据不足仍 unknown |
| 明确 candidate 从未启动且所有前驱未变化 | 只可在另行审定的原发布恢复路径内恢复精确原 unit；不把这变成一般自动回滚。已部署新 Django 时还须处理应用匹配，不能只恢复 Broker |

可用性保护来自在线准备不碰现役、维护前暴露材料/权限问题、原排空停止及保留可核验原件；不能承诺任何维护期失败均零停机恢复。nonce ledger 始终原位保留，旧 unknown 不重放；不得以备份副本覆盖实时防重账本。

### 5.4 后续最小隔离证据

- 专用非生产 Linux/WSL 环境、独立 unit/端口/配置/key/state，先验证 root-owned release/unit 与 UID1000 rootless Docker 的真实权限关系；不能借正式 `TERUISI-Pandas` 做试运行。测试根由独立入口硬约束，生产入口不接受任意路径 override。
- 实际 prepare 不改变运行中的旧 unit/config/key/state；篡改 source/归档/链接/owner/unit/drop-in/准备收据即拒绝。Pandas 非测试文件增删/重命名都必须触发发布依赖，未配置 Pandas 的场景必须按现有禁用语义显式核定，不能静默忽略已配置实例。
- 实际旧 AI/WSL stop、root CAS、daemon-reload、原 Start 和严格签名 probe 接缝跑通；同镜像、同 key、同 nonce ledger，预置 nonce 切换后仍拒绝；签名错误/摘要错误/镜像错误仍失败关闭。使用合成数据，Docker 隔离与精确清理沿原测试，不调用业务模型或真实数据。
- 注入旧进程未停、保活回执异常、同域遗留容器、CAS 冲突、写 intent 后中断、unit 替换后中断、daemon-reload 失败、启动后回执丢失，证明不清容器、不重放、不丢账本，不把 apply exit0 当整轮成功。
- Node 发布 fixture 覆盖准备模式零切换、缺计划在 STARTED 前拒绝、`DeployApp → Pandas CAS → 原 Start/VerifyStartup → SUCCESS` 顺序、Pandas 失败时 tail/resume 不绕过、同发布 Pi 分支保持原协议；真实 PS 参数入口及应用复制清单检查不可只靠函数 mock 替代。

上述是具体的发布/启动依赖验证，不新增业务验收平台。若独立 root WSL 权限或环境不可得，该轮换包保持候选，不能拿 mocked systemctl 或原 v1 协议兼容替代实际资格。

## 6. 交接和授权

本批无需为窄拆包重复请求开发许可；它解决已确认采用阻断并保留独立可用诊断。下一批必须在用户要求的新聊天推进，接收外置候选、原 W6a 审查及本设计，重新核最新 main、实际前驱和可用隔离环境。若要把 Broker 完整诊断提前放回本批，应先明确展示上述跨权限新增面、失败边界和隔离证据缺口，取得范围取舍；不能把“原 W6a 源码已审”当轮换实现已获审查。

本规划仅新增本文件，未修改应用、工具、生产、配置、记忆库或 Git 提交。长期项目状态由唯一负责人在收尾时统一写入共享记忆，避免子代理并发写同一笔记。后续就绪、提交、合并、制品与上线事实分别报告。
