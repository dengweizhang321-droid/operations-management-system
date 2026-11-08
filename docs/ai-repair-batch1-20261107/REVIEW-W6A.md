# W6a 首批外层诊断增量反审

2026-11-08，Asia/Shanghai。沿用原独立审查上下文；请求 Astra High，底层实际型号仍未独立确认。

**当前结论：首批 Worker/Django 外层诊断通过，W6A-01 对本次窄拆包的阻断已解除。Broker 内层诊断和受控轮换留待第二批；不能称全 W6 完成。** 本结论只关闭本增量引入的摘要兼容问题，不代替整批构建、最终来源/制品绑定、动态生产前驱门禁或合并/上线授权。

## 增量范围与结果

依据负责人选定的 [PANDAS-ADOPTION-PLAN.md](PANDAS-ADOPTION-PLAN.md)，核对外置 `metrics/W6A-SPLIT-FREEZE.json` 的 7 文件 blob 全部一致。共享 transport 实际 blob 为 `3b3e0a788f67b8d0b3b8bed8e5ff22fbcaba8688`，与本轮测试绑定相同；其新增 provider-send callback 默认无行为，仅用于非 internal 的模型 POST。pandas 直接 HTTP 及数据源 internal 工具桥未新增调用该回调。

- **源码拆分：** datasets.py、pandas_sandbox.py 相对上轮仅改变 helper 导入位置；新 `ai_assistant/pandas_diagnostics.py` 与归档原 helper 原始字节完全一致。运行源码中没有 `pandas_runner.diagnostics` 引用。帮助模块随原 backend 复制闭包进入 Django 包，Broker 不再依赖它。未变脱敏、权限、分页、失败和 unknown 语义复用原通过结论。
- **Broker 摘要：** 独立比较完整非测试 Python 文件集合及逐文件原始字节，8 文件全部等于 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`；无新增未跟踪运行 Python。独立复算 `3173042892d14e6edcf8465b8ea97e878f307e08fdb1c81d2752f82e03dcc610`，与冻结清单一致。protocol/probe/安装器/启动门禁未改，因此本批不再要求 Broker 轮换。
- **旧 Broker 兼容：** 已逐行核对改后测试及其 25/25 日志。恢复后的真实 Handler/HTTP/HMAC 配合 Docker 替身，成功返回表格；执行超时、结果无效、清理失败均在 Django 留下 signed_runner_failure。只断言 Django 通道阶段，没有伪造 Broker 内部事件。Worker 3/3 日志与源码仍绑定。原 probe 的真实回环 HTTP/HMAC 夹具从最终目录计算摘要，同摘要接受、不同摘要拒绝，未替换比较函数。测试脚本、结果和日志 5 项证据 SHA-256 全部匹配。
- **归档完整性：** 独立核验 MANIFEST 中 15 个源码原件 SHA-256、补丁摘要与 6 份原审查/日志字节。另建外置隔离重建目录，从精确基线应用原完整补丁，8 个原冻结文件逐字节等于归档副本，并复算原 Broker 候选摘要 `5bfb727f33095c0d3e4f9b63644fc0dda8c2b69293a38ea25acf49ca5d3913c5`。原阻断和原试验没有被改写为成功。
- **报告边界：** METRICS-DIAGNOSTICS.md 已明确发送事件不证明远端收到、验签或登记；旧 Broker 的通用错误不能进一步区分运行/校验/清理阶段。两个历史失败根因仍未定，真实 WSL、rootless 容器、模型和生产整链未测。原 12 个 Broker 测试通过与 3 个真实容器跳过属于后置候选历史，不充作新包资格。

独立校验结果：[W6A-SPLIT-REVIEW-CHECK.json](D:/codex-artifacts/ai-repair-batch1-20261107/metrics/W6A-SPLIT-REVIEW-CHECK.json)。当前结构化结论：[W6A-REVIEW.json](D:/codex-artifacts/ai-repair-batch1-20261107/metrics/W6A-REVIEW.json)。原件仍在 [归档清单](D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w6a-broker-deferred/MANIFEST.json)。本次没有新增阻断发现，没有改被审源码、提交、访问生产或运行 WSL；未重复未变测试。整批 REPORT/HANDOFF 由负责人同步上述窄范围结论。

---

以下完整保留上一轮针对含 Broker 内层诊断候选的历史审查，不作为当前窄拆包仍被阻断的声明。

# W6a 脱敏阶段诊断独立反审

2026-11-08，Asia/Shanghai。请求角色为 Astra High，工具没有独立返回底层实际型号，故只确认请求选型。审查者未参与 W6a 实现，没有修改被审源码、提交、生产访问、服务操作或转派。

**结论：诊断源码审查通过；本批按现有发布链直接采用阻断。** 本结论不等于整批合并或发布就绪。需要负责人闭合下述 W6A-01，或将 W6a 从本次可发布范围移出；不能凭 v1 协议兼容忽略源码摘要启动门禁。

## 范围与来源

- 依据原 PLAN.md 的 W6 首批诊断范围，仅审配置、导出、权限/分页、签名传输、容器、被动结果校验和精确清理的脱敏阶段证据。没有扩展完整导出、真实业务补跑或历史 unknown 重放。
- 基线 `e268b28761ae4ada958455344c0dfbb37d2ae4f8`。外置 `metrics/W6A-FREEZE.json` 的 8 个文件逐一 `git hash-object` 比对全部一致，包含新建未跟踪的 `backend/pandas_runner/diagnostics.py`，不能仅凭普通 git diff 忽略此文件。
- 已完整核对这 8 文件的增量/新文件，并读直接调用、协议、配置、日志、中央调用标识及发布启动依赖。共享 transport 的其他任务修改不纳入 W6a 结论；W6a 没有改变它的调用契约。
- 已读共享记忆入口和相关偏好/工作流/项目记忆、根 AGENTS.md，并从已获取的 origin/main 读取模型、开发、架构、安全 AI 和验证发布适用规范。当前任务明确 Astra High 优先于一般 Sol 审查映射。

## 阻断发现 W6A-01（P1，发布兼容）

**触发：** 已配置 pandas 的部署采用本次 Django 包，同时 WSL 仍运行旧的不可变 Broker release。

**位置与证据：**

1. `backend/pandas_runner/protocol.py:18` 的 `package_digest()` 覆盖目录内除 test_ 外全部 Python 原始字节。W6a 新增 diagnostics.py、修改 server.py，当前实际摘要已独立复算为 `5bfb727f33095c0d3e4f9b63644fc0dda8c2b69293a38ea25acf49ca5d3913c5`。
2. `tools/django-local-service.ps1:2206` 将 backend 树复制到应用包。`backend/pandas_runner/probe.py:37` 把 Broker 已签名的 runnerSha256 与当前部署目录 `package_digest()` 严格比较。
3. `tools/django-ai.ps1:678` 在启动 AI reader/writer 之前调用 Start-PandasSandbox；其第 342、351 行执行该严格 probe。`tools/django-local-service.ps1:4974` 的 AggregateStatus 同样调用 probe，失败后第 4979 行将 AI WriterReadiness 置为 not_ready。
4. `tools/publish-prepared-main.mjs:278` 对 pandas 只保存维护配置指纹。现有主发布链具有 Pi Runner 升级阶段，但没有 pandas Broker 轮换阶段。`backend/pandas_runner/install_linux.py:28` 在配置、unit 或 release 已存在时拒绝安装；首次安装器不能直接作为本次轮换入口。
5. 独立合成检查调用原 `probe.probe()`，用固定测试密钥签名的 HTTP 替身响应：匹配摘要接受；仅摘要不同、其余 ready/image/cleanup/signature 全正确仍拒绝。未接触真实端口、密钥、WSL 或生产。

**影响：** 这是 AI 服务启动/全栈发布就绪阻断，不仅是新日志暂时缺失。普通 Worker/Django 制品准备完成也不能证明可启动。先只升级 Django、事后再轮换 Broker 的说法不满足该启动依赖；报告中“旧 Worker 可调用新 Django”仅指请求解析兼容，不代表此部署顺序已可行。

**建议：** 由交付负责人决定本批范围：要么在独立授权的实现/验证范围内补齐匹配精确源码的受控 Broker 准备及维护期切换，保留原防重账本、既有镜像/权限/清理/unknown 边界，并在 AI 启动前完成；要么暂缓该增量且去除整个运行依赖，不能只漏打 diagnostics.py。不得删除严格摘要校验、覆写不可变旧 release 或单独调用底层生产动作绕过发布记账。本审查不实施该扩展。

## 诊断源码核对结果

- Worker 取外层 requestId 的 SHA-256，内层 invocationId 继续作为签名请求 ID。Django 记录内层摘要及可选外层摘要；旧 Worker 缺字段时退回内层摘要。新字段仍属于服务端生成并签名的正文，未改工具模型 schema。
- 来源事件使用固定 stage、单调耗时、固定 code、白名单 dataset/sourceIndex/page。代码、查询参数、列名、集合路径、店铺/身份、结果、异常文本、凭据及原 nonce 未进入新增日志。SourceResultError 对错误信封的防御性解析保持失败；不把畸形来源变为空成功。
- Django 的 runner_prepare 事件在发送前记录 nonce 摘要；Broker 仅在验签后沿同一 brokerRef 记录登记、解码、容器和回信。未验签响应、已签名错误响应、镜像不符、清理未证和结果结构错误分开。stage=ok 只代表该阶段完成，不代表业务成功；broker_reply=ok 可以是已成功发送失败回执。
- Broker 原 finally 清理、精确容器名、poisoned、deadline、持久防重、固定隔离参数保持。清理失败仍覆盖并抑制成功，执行失败也不会变为成功空表。新的 stage 记录原异常后重新抛出。实际 Linux journal sink 使用非阻塞写入，OSError 被吞掉，不改变清理和返回；没有新日志账本或自动重试。
- v1 请求/回执结构及 HMAC 没有变化，旧 Broker 的错误回执仍可验签；源码摘要 readiness 则严格不兼容，已作为 W6A-01 单列。

## 验证及证据限制

复核外置日志与测试源码：Worker 3/3；Django 指定三个 SimpleTestCase 类 25/25；Broker unittest 15 项中 12 通过、3 个真实容器用例跳过。没有将未执行的 PandasDispatchTests 数据库集成用例列为本轮已通过。首轮 Windows AF_UNIX 失败摘录保留，最终服务只在显式配置 sink 时使用 journal。

新增来源测试是真实 export_frames/datasets.query 配合合成来源响应，分别证明商品日截断落在 source_pagination、品类错误集合落在 source_collection；它们不能证明两次历史失败的实际根因。Django→Broker 测试用真实回环 HTTP/HMAC，Docker 命令为替身；真实 WSL journal、rootless 容器与生产整链均没有本轮证据。METRICS-DIAGNOSTICS.md 对这些边界及后来的额度拒绝写法准确。

独立最小检查还确认：当前 package digest 与冻结清单一致；未知异常文本映射为固定 invalid_structure 并原样重新抛出；journal OSError 不外溢。证据为本次工具 chunk `f33f5f`，结构化摘要另存 `D:/codex-artifacts/ai-repair-batch1-20261107/metrics/W6A-REVIEW.json`。没有重跑全仓测试，没有生产包生成或采用。

## 交付交接

根任务 HANDOFF 必须保留“W6a 诊断源码通过，当前发布链采用阻断 W6A-01”，不能概括为“W6a 已通过、只待上线授权”。若另行补齐轮换接线，仅审其增量及上述启动依赖，无须重复本次未变的诊断源码审查。
