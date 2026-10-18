# Pi 一期两项闭合的独立审查

2026-10-18；基线 `aaca18485021b6f98107fe168b69c8f57d55ee46` 加本任务差异。请求角色 `gpt-6.1-sol / xhigh`，只升级取消并发关键部分；工具没有独立底层型号回执。审查者未参与方案或产品实现，未转派、提交、操作生产或付费供应商；仓库只写本文及主负责人随后明确要求的最小审查证据副本。

**结论：本轮停止修复与应用整链证据两项通过，无剩余产品验收阻断。** 结论限于本报告明确的隔离与合成边界，可继续合并和准备对应制品；不等于本轮修复已上线，也不代替正式发布即时准入。最终核验时四个产品文件、三个整链测试入口和既有UI/路由的SHA与最终通过整链绑定逐一相同，未出现待审产品增量。

## 审查依据与范围

按共享记忆启动协议读取相关Pi记忆，并完整读取当前AGENTS、README、开发与交付、任务模型分工、系统架构、前端与性能、安全与AI工具和验证与发布规范。工作树基于当前origin/main；本地main为旧祖先，未采用其旧规范。独立核对[取消方案](cancellation-plan.md)、前轮原始后端反例、完整Git差异，以及 `pi_service.py`、`pi_gateway.py`、`pi_exports.py`、`pi_worker.py`、模型/事务授权接缝、原始回归及整链测试代码和Runner协议。

本次应用载荷仅四个Django Pi服务文件。没有migration、models、依赖、配置、Runner协议/源码、Pi版本/镜像、权限清单或Windows生命周期/发布入口变化。新增测试与任务材料不改变运行入口。因此本任务不需要结构迁移或重建Runner镜像；仍须由负责人按真实生产前驱至最终组合main的完整差异确定正式组件范围，不能把本任务范围套给其他在途任务。

## 取消与迟到结果

- `principal_for_work` 在原控制授权之外检查最新取消状态；普通取消保持控制及终态观察可达，不因停止本身误走权限冻结。权限或代际失效仍保留原保护。
- 网关每个model/tool/file与导出每页分别在既有AI权威行锁内检查并登记sent。停止事务先提交时没有新准入；准入先提交的精确单次工作可能已在途。准备接缝之后再次查取消，不能把整批pending或整份导出预先算作在途。这里证明的是事务准入顺序，不承诺数据库提交与物理HTTP发送原子化。
- 实际模型/业务调用及导出query位于准入事务外；已知工具返回可保存completed。模型进入执行器后发生取消仍使用原普通AiError并保unknown/freeze，不降为确定未发。停止中的精确completed回执可观察，sent/unknown不自动重放，换模型requestId仍受原围栏。
- abort在同一事务结束queued/running导出。终稿检查、文件保存与succeeded同锁提交，取消先提交时没有新完整文件。迟到来源错误仅条件更新queued/running，不能替换取消原因。旧页在下一轮开始后返回，不冻结新操作。
- worker先处理取消，再桥接；桥接中确定未发取消只退出本批列表。仍等待真实settled、filesCollected和精确terminalReceipt后收尾，ack与业务终态分离。取消不发布新输出，旧文件和同代际工作卷可继续使用。

审查中发现首版已知取消model回执存固定错误对象，却在重读时无条件解密正常模型私有响应。实施者已在解密前按错误码与精确固定对象分类，并补同request重读回归。审查者的独立内存探针在修复后实际得到两次 `PiWorkCanceled`、provider调用0、dispatch completed、operation canceling；未冒称该探针在旧字节上运行。

## 实际验证与独立复验

| 证据 | 实际结果与证明边界 |
| --- | --- |
| [后端回归](backend-validation.md)及原始 `pi-memory-tests-reviewed.log` | 46/46，包含12项新增取消负例；独立读代码及日志。该集为SQLite内存，不声称证明PG行锁。 |
| 独立私有PG探针 `review/pg-concurrency-probe.py` | 本审查者实际运行5种并发交错全部通过，端口55547，独立最小schema、真实mutation/row-lock，HTTP与Runner均未使用。 |
| [最终整链](e2e-validation.md)及[e2e原始日志](e2e-evidence/real-stack.log) | 1/1，31.894秒；逐项读测试代码、HTTP调用、数据库快照、Runner健康、下载字节与清理原件。最终attempt为 `20261018T182435`。 |

私有PG探针覆盖：

1. stop持权威锁先提交，等待准入线程醒来后得到取消，新增dispatch及实际tool调用均0。
2. 工具已准入且慢读在途，stop能先返回；迟到已知结果保存completed，实际调用仅1。
3. 终稿先持锁提交，stop后仍保succeeded及既有文件；相反顺序得到failed/cancel且文件0。
4. 旧导出第一页在途，stop并完成取消终态后开启同generation下一轮；释放旧页后未来页0、旧export取消原因保持、新轮running且不freeze。

原始探针、运行结果与最终源码摘要位于 `D:/codex-artifacts/pi-phase1-closeout-20261018/review/`；最小副本见[PG五交错结果](review-evidence/pg-concurrency-evidence.json)、[最终源码摘要](review-evidence/source-binding.json)、[独立下载与SHA核验](review-evidence/independent-verification.json)，原件与副本SHA见[清单](review-evidence/manifest.json)。该探针用独立测试终态对象验证backend迟到逻辑；真实Pi停止协议由整链补齐，二者不混称同一执行。

整链的五轮seq为1–5，始终同session/epoch=1/generation=1，终态依次succeeded、succeeded、canceled、succeeded、unknown。首轮Django受理后HTTP响应正文实际断开，浏览器刷新期间只有GET；原请求同键同正文显式再次POST复用同operation、同runner:prompt且模型接缝计数保持4。unknown刷新后总计数保持10且UI禁发。原回归另覆盖未知模型/Runner回执、原请求和新标识不能绕过围栏，不据UI按钮禁用单独证明后端防重。

独立读取实际下载的2469字节XLSX：SHA-256 `9f6a68dd3489cdb0cdc59cd16620351577c5ba856690a239912a37e727f0fdf8`，与后端文件相同；ZIP完整，四张表为分析结果、来源、指标口径、缺失数据，三条合成结果为库存12、推广300、销售10000。两个后续操作的真实Pi本地工具输出均包含相同文件SHA与持久marker，其中一次在确定停止之后；来源业务查询只发生在第一轮。

## 结论边界与收尾

真实层为Chrome操作产品Pi React组件、实际薄Worker路由源码/HTTP/HMAC、Django WSGI、私有PG、队列、签名Runner、Pi1.3.0 rootless容器、Python/Excel技能及下载字节。Worker代码由Node HTTP测试宿主承载，未验workerd或全系统主导航/登录。入口principal、模型HTTP及中央业务HTTP为合成夹具；不是供应商推理质量或正式店铺准确性/新鲜度验收，新增付费调用0。报告对此界限描述准确。

最终E2E的四个历史operation尽力dispose返回原 `pi_runner_unknown`，报告保留而未冒称全部dispose成功；随后精确namespace独立观察证明零容器/零卷、Runner退出、PG停止、四端口关闭，清理通过。独立PG探针的三次私有启动目录也均核实停止，55547无监听。前期夹具启动/编码失败未运行或未通过主体，未计入通过数。

独立PG的停止数据目录尚保留：递归清理及随后更窄的单文件shell清理被自动审批拒绝，唯一理由为 `blocked by policy`。临时测试口令已通过精确文件patch安全移除；未改解析器绕过拒绝。命令原文与精确三目录保存在外置 `review/cleanup-rejections.md`。此为真实未完成的材料清理，不是功能阻断；共享记忆和最终交付由主负责人统一完成。

最终 `git diff --check` 通过。审查未发现需要扩大本轮范围的其他使用阻断；没有执行生产切换、迁移、业务补跑或历史unknown重放。
