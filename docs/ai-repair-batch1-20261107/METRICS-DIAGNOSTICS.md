# W7 指标口径与 W6a pandas 阶段诊断

2026-11-08，Asia/Shanghai。方案基线为 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`。W7 已复核提交 `740612956e325da25e2f083c95477e3c91deb3f7`。W6a 冻结范围见外置清单。本报告记录开发和隔离验证。

## W7 成交转化率

网店商品成交转化率沿用 Django 网店服务的成交客户数÷访客数，核验同平台、店铺、SKU/SPU、期间和两项字段的完整性。分母为零或字段不完整时提示不可计算。商品×日累计允许按其真实口径呈现，成交客户数与访客数均不得跨日或跨商品相加充当区间去重人数。只有同粒度的权威期间去重数据可以支持期间去重指标。

`shop-diagnosis` 默认正文增加规则。已存资源版本在新组成的方法提示中应用同一规则，历史资源配置和历史执行快照继续使用各自原版本。两条普通 AI 商品取数路径保留现有服务端值和字段完整性证据。页面数据入口只新增转化率需要的汇总和行级两项资格。商品洞察工具沿用已有 `conversion` 状态与来源。经营数据和网店权威计算均来自原服务。

固定样本 2 位客户、8 件、20 位访客得到 10%。合成测试另核对真实零值、缺客户字段、缺访客字段和零分母。Worker 58 项、Django 1 项通过，独立增量复核见 [W7 反审](REVIEW-W7.md)。[Worker 日志](D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w7-worker-tests-incremental.txt) · [Django 日志](D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w7-django-tests.txt)

## W6a 首批阶段和关联

中央工具审计保留原请求与工具调用。Worker 签入外层 `requestId` 的 SHA-256，Django 对签名请求头中的实际 `invocationId` 取 SHA-256，在 `pandas_stage` 日志记录为 `requestRef`、`invocationRef`。旧 Worker 请求缺少外层摘要时，两项引用均使用内层标识的摘要。向 Broker 发起请求前，Django 已把单次 HMAC nonce 的 SHA-256 记为 `brokerRef`，从而关联发送和回执。原 nonce 仍只在既有签名协议与防重账本中使用。Django 侧的发送记录无法证明 Broker 已接收、验签或持久登记该 nonce。

| 组件 | 诊断覆盖 |
| --- | --- |
| Django 入口 | 请求权限、配置（区分配置无效、密钥不可读和密钥长度无效）、输入契约、执行名额 |
| 数据源 | 仅记录白名单数据集 ID、来源序号和页号；分别记录目录、权限、查询结构、水位、取数、来源信封、集合、分页及字段投影；来源身份、审计、结构和执行错误使用固定代码 |
| Django 签名通道 | 发送前关联、发送、读取回执、验签和被动结果校验；签名错误回执与未验签结果可区分。验签成功也需要固定镜像与 `cleanupVerified=true` 才能释放表格 |
| 原 Broker 回执 | 可识别原 Broker 的通用签名失败；收件登记、容器执行、校验和清理的内部失败阶段留待第二批 |

每条记录包含固定阶段、成功或失败状态、单调时钟耗时和白名单错误代码。Django 沿用服务日志，仅记录这些结构化字段及上述摘要和来源标识。无响应时，具体停点和结果仍为未知。原隔离、签名、防重、清理、镜像和重试边界继续生效。

两次原始实测独立保留。`netshop_product_daily` 于 2026-11-07 19:24:19+08:00 记录 `tool_execution_failed`，在对应窗口没有已验签登记的 Broker nonce。该源固定首页出现截断时无法完成现有导出，原次调用缺精确输入与截断证据。`sales_category` 于 19:29:11+08:00 单独记录 `tool_execution_failed`，原回执没有内层停止阶段。19:29:17 的额度拒绝发生在两次失败之后。新诊断可以分辨两来源的新调用，原两次实际内层根因仍待证。 [商品日原诊断](D:/codex-artifacts/ai-live-capabilities-20261107/pandas-live-diagnostic.json) · [销售品类原调用](D:/codex-artifacts/ai-live-capabilities-20261107/chat-pandas-sales.json) · [原审计](D:/codex-artifacts/ai-live-capabilities-20261107/pandas-audit-corrected.json)

## W6a 拆包验证与采用边界

- 必需代码核对包括本次 `git diff --check`、Python 语法编译和 Worker 类型与构建的批次合并检查。后者以根交付报告的统一回执为准。
- Worker 3/3 通过。中央执行器真实生成调用标识，定向 fetch 夹具核对该标识等于 Django 请求头，外层只签入摘要。Django 25/25 通过。合成 source reader 输入分别定位商品日截断为 `source_pagination`、品类错误集合为 `source_collection`，两个用例均在派发容器前停止。[Worker 增量日志](D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w6a-split-worker-tests.txt) · [Django 增量日志](D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w6a-split-django-tests.txt)
- 真实 HTTP/HMAC 回环连接 Django 和原 Broker，Docker 命令使用合成替身。成功返回结构化表格，执行超时、结果无效、清理失败均保留 Django 侧 `signed_runner_failure`，各次请求的发送、读取、验签和结果阶段通过同一 `brokerRef` 关联。实际 WSL、rootless 容器、模型和生产整链暂无本轮证据。
- 将纯帮助模块移至 AI 域后，逐文件核对 `backend/pandas_runner` 全部 8 个非测试 Python 与精确方案基线字节一致，包摘要为 `3173042892d14e6edcf8465b8ea97e878f307e08fdb1c81d2752f82e03dcc610`。原 `/v1/status` 签名探针继续按完整 Broker 包摘要验收，同摘要接受、仅摘要不符则拒绝。旧 Worker 可调用新 Django。若 Worker 和 Django 分时切换，先部署接受可选摘要字段的 Django。[字节核验及签名探针日志](D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w6a-split-adoption-check.json)
- 原含 Broker 内层诊断的候选摘要为 `5bfb727f33095c0d3e4f9b63644fc0dda8c2b69293a38ea25acf49ca5d3913c5`，其完整补丁、字节摘要、原审查和试验日志已经外置保全，并从精确前驱应用补丁复算一致。原候选内部观测需要匹配源码的受控 WSL Broker 轮换及独立资格验证，见第二批交接设计。[拆包方案](PANDAS-ADOPTION-PLAN.md) · [原候选保全清单](D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w6a-broker-deferred/MANIFEST.json)

首批交付 Worker/Django 侧阶段诊断。第二批接续 Broker 内层诊断及受控轮换，并按两个来源的复现证据修复。商品日完整导出是单独的适配任务。
