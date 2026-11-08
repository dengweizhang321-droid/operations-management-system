# W5、W7、W9 与 W12 隔离功能验证

应用源码 `4317b3255b583508be15a671dac4048f0b7f08d2`。私有 PostgreSQL `127.0.0.1:55488/functional_ai` 使用非超级用户 `functional_app` 执行业务验证。真实 Django WSGI reader/writer 分别监听 28444/28447，Worker 工具入口监听 28445，OpenAI 兼容 HTTP 夹具监听 28446。脚本写入合成来源，报告请求使用持久化合成账号和原内部 HMAC 签名。身份范围限于内部签名、Django 权限与工具政策。宿主用户登录、供应商真实能力和生产钉钉交付待证。

| 工作项 | 本次观察 | 证据 |
| --- | --- | --- |
| W5 报告模型与幂等 | 京东周报固定显式模型 A 和版本 1。活动期新请求号复用原报告，同一别名改选模型 B 返回 409，原任务已完成后同一别名同体仍返回原报告。三类空跑均保留所选模型 B，跳过全部 Agent。另一个 B 任务遇版本漂移，在 `admission` 失败且无派发记录。429 原请求在 `provider_http` 失败，站内映射 503，保留原派发并阻止同请求重发。 | [周报账本](D:/codex-artifacts/ai-isolated-functional-20261108/reports/isofunc-report-r1.json) · [选择及诊断](D:/codex-artifacts/ai-isolated-functional-20261108/reports/isofunc-report-r1-supplement.json) · [HTTP 请求摘要](D:/codex-artifacts/ai-isolated-functional-20261108/reports/HTTP-WIRE.json) |
| W7 转化口径 | 真实 PostgreSQL 网店查询经签名 Worker 注册工具，依次入账覆盖检查、业务取数，再进入周报正文。精确京东店铺和日期匹配三条 SPU；跨平台同名店、跨店、区间外金额均排除。字段完整的单个 SPU `iso-report-rate` 行有成交客户 2、访客 20、成交 8 件，商品×日累计转化率为 10%。三条合计为 30 访客、2 个已知成交客户、15 件，但其中客户字段缺失，汇总转化率不可计算，不能采用响应中未获字段可用性支持的原始数值。零访客保留不可计算；缺成交客户字段标注 `missing_field`。单独通过实际 `get_netshop_page_data` 核对行与汇总字段可用性，以及延长日期后 `incomplete_coverage`。 | [周报和原取数摘要](D:/codex-artifacts/ai-isolated-functional-20261108/reports/isofunc-report-r1.json) · [页面工具投影](D:/codex-artifacts/ai-isolated-functional-20261108/reports/isofunc-report-r1-supplement.json) |
| W9 DAG 与诊断 | collect 子任务完成后，单次 `workflow_tick` 同时观测完成和创建 report Agent，且该 tick 没有派发模型。report 子任务完成后同轮进入人工待审。待审时人工耗时为空，正式下载返回 409，显式批准后完成并取得 HTML。已完成窗口有界且不可直接相加；HTTP429 所留未知派发的 provider 窗口为空。实际夹具收到 A 的 3 个不同请求和 1 个 429 请求，B 为 0。 | [节点时间和工具回执](D:/codex-artifacts/ai-isolated-functional-20261108/reports/isofunc-report-r1.json) · [已审核周报 HTML](D:/codex-artifacts/ai-isolated-functional-20261108/reports/isofunc-report-r1-weekly.html) · [请求摘要](D:/codex-artifacts/ai-isolated-functional-20261108/reports/HTTP-WIRE.json) |
| W12 日报源层及准入 | 对真实 PostgreSQL 调用日报原 ERP 和库存拥有方读取函数。正确范围得到净销售额 17,000 分、净销量 4 件、计入仓可用库存 55 件。错平台、错店、错渠道混合、仅错渠道、错批次、库存错日和缺发布指纹均返回不可用。测试事务回滚合成事实。共享开发环境实际收到 `task_executor_not_adopted` 409。 | [来源与门禁原件](D:/codex-artifacts/ai-isolated-functional-20261108/reports/W12-sources.json) · [原两组私有 PG 证据绑定](D:/codex-artifacts/ai-repair-batch3-20261108/w12/R1-SOURCE-AND-CHECKS.json) |

报告创建、详情、批准与下载使用实际签名 HTTP。DAG 和 Agent 推进调用原 `workflow_tick` / `agent_tick`，以单步检查账本状态和捕获关联诊断。真实 Worker handler 的工具发现、审计和查询通过网络运行，合成模型根据实际工具回执返回确定性正文。三个场景均验证了空跑选择，真实取数及文件生成覆盖网店经营周报。

W12 本次结果限于源层与关闭的执行器门禁。原两组私有 PostgreSQL 各 12 项及独立反审仅作为既有协议/状态机单周期证据复用：模型、工具目录与钉钉使用合成响应，测试提交函数直接调用 gateway，Pi Runner 终态亦由测试注入；它们不是当前真实 Runner 日报整链。已核对原绑定的五个应用/测试 Git blob 与本树一致，也核对了两组日志与回执摘要。当前日报 adapter 的专用准入只允许 `test` 环境、`development` 角色和 `test_teruisi_ai_rehearsal`；回环 HTTP 模型只允许 `development` 环境且显式启用。本轮共享开发环境没有可同时满足两者的配置，因而没有执行新的 W12 Pi 生成、预览或投递。

首次周报 seed 先因 PostgreSQL `inet` 的文本形式误判身份，改用 `host(inet_server_addr())` 后通过身份核验。随后写入事务因少了网店源 revision 前移而回滚，改用既有 revision 更新方法后成功提交。第一轮周报正例已完成，脚本随后将空跑的选择字段与执行模型混同而停止。修正断言后，用同一合成账号补跑三类空跑、模型失败和页面投影，没有重新调用已完成的周报。应用源码、门禁和数据库触发器均未编辑。

复现入口见 [周报运行脚本](../../tests/ai-functional-reports-run.py)、[供应商协议夹具](../../tests/ai-functional-reports-fixture.py) 和 [日报源层脚本](../../tests/ai-functional-reports-source.py)。本轮脚本、回执和原 W12 证据摘要见 [源码与原件绑定](D:/codex-artifacts/ai-isolated-functional-20261108/reports/SOURCE-AND-EVIDENCE.json)。
