# 第二轮独立关键逻辑审查

2026-10-15，Asia/Shanghai。结论：本轮冻结源码与必要验证通过，已发现的直接范围阻断均关闭，可继续已授权的合并、制品准备和发布。此结论不表示制品已生成或生产已采用；实际交付仍以 [PRODUCTION.md](PRODUCTION.md) 为准。正式分类候选、模型切换、历史批量入库和业务准确率未获本审查通过。

审查者未参与方案或实现，按共享记忆启动协议和当前项目规范读取原任务、P0设计、Prompt候选、完整相关差异、直接依赖与原始证据。请求角色为 `critical-review / gpt-6.1-sol / xhigh`；宿主未返回可独立核实的实际底层模型字段。只编辑本报告及 `evidence/review-*`，未转派、修改产品源码、读取生产凭据、连接生产库、调用真实模型或执行生产操作。

## 冻结范围和判定

基线为 `cabf97f1a29b097334cf91dcb1f1f8a55d385116`。已独立核对 P0和P1源码清单的文件SHA、`_create_job/_update_review/_select_filtered` 集成函数摘要，以及诊断和直接影响的原priority测试差异；全部匹配。最终源码绑定见 [review-freeze-result.json](evidence/review-freeze-result.json)。范围包含恢复命令与只读回执、SDK/公开路由、实际React控制和读取、可信来源及批量计划、固定视觉校验码，不扩为全仓审查。

交付格式增量复审仍通过：九个应用文件SHA均未变化；恢复测试工作树文件改为CRLF并移除一个EOF空行，将其归一LF、补回该空行能精确重建已测试的 `9faffd50…` 字节，完整AST相同。新测试SHA为 `f72e379c…`，冻结清单已同步，不重复业务验证。任务evidence局部 `.gitattributes` 仅把 `*.log/*.patch` 设为 `-text -diff`；独立逐个确认15份原捕获文件的Git index与worktree字节完全相同，保留Windows原换行而非改写日志。证据见 [review-format-only-result.json](evidence/review-format-only-result.json)，未引入应用、权限、状态或发布行为变化。

- P0：单次浏览器意图在发送前保存；内部请求绑定原operationId/actor/方法/路径/命令摘要。成功业务修改、审计、版本和receipt原子提交。缺失、processing、读取失败、查询403及坏结构不被当成原写失败；仅持久已回滚拒绝可报告rejected。只读查询使用原writer的READ ONLY事务，未扩大reader权限。CAS在job/run锁内复验，原终态检查、未知封顶、退避和租约保护保留。普通心跳保留token，控制变更推进token，旧token不因null或坏容器重生。
- 前端：原操作确认与当前进度分别读取。取消、换job、同账号scope变化、卸载及旧finally受generation和提交时scope保护；旧receipt不供应当前运行状态。未知原意图阻止替代任务，存储坏结构、失败和容量满失败关闭，刷新或权限变化不自动POST。兼容任务按钮的文字与仅切换行为一致。
- P1：有效人工审计绑定精确身份/hash、Prompt、字段摘要和版本；AI置信度、自动复制和入库操作人不冒充确认。明确无价三项价格均null，策略不兼容、换图、较新人工修订、失效非committed来源均失效；新候选仍未选中且待复核。旧unknown/capped身份只能接受无需新模型的已解决结果，不重建为新queued。
- P2：每批最多256候选，精确tuple分组、窗口最新源和关联查询均有界；原候选排序持续扫描，不以首批截断冒充完整集合。Prompt锁、原工作键、事务与回滚、SKU/类目/scope/图片边界保留，没有扩大无界IN或加载整段历史。
- 诊断：新增validation_code为固定有限枚举；TS真实适配器模拟和后端持久化边界不记录错误字段值、凭据、图像/base64或思维。A单调用分类+价格、B固定分类只价格、无A可领取时B补位、原共享12并发保持，没有新增供应商调用。

## 发现及增量闭合

以下前三项为独审实际复现缺陷，修复前保持阻断；现在全部关闭。反例使用真实领域函数、实际归档命令和私有SQLite `:memory:`，没有生产或外部调用。

| 触发与实际影响 | 最小修复及复审证据 |
| --- | --- |
| 较新主数据人工分类B/清价，或较新approved人工B/unknown，被旧committed A/无价覆盖；新计划错误进入review_pending旧结果。原位置 `annotation_planning.py::_bounded_context/build_job_items`。 | 按正式标注实际修改时钟及有效新人工复核优先；当前版本审计资格覆盖未入库人工来源。原 [反例](evidence/review-newer-human-result.json)，[修订后](evidence/review-newer-human-revision-check.json)。 |
| 同hash旧failed/attempt3/unknown，较新人工unknown使失败栅栏失效；新计划生成attempt0 queued并再次推理受保护身份。原位置 `build_job_items` 的failed判断。 | 较新未解决结果不解封；仅无需新模型的完整复用结果可通过。原 [组合反例](evidence/review-newer-human-unknown-combination.json)，[闭合](evidence/review-newer-human-unknown-fence-recheck.json)。 |
| 当前正式A，更新人工approved B/unknown后实际归档其未入库任务，新计划仍固定B只补价格；来源已失效但继续覆盖正式分类。原位置 `_trusted_review/build_job_items`。 | 统一非committed来源有效性：deleted/cancelled草稿不供分类或无价，正式committed事实仍可使用。原 [归档反例](evidence/review-newer-human-archived-source.json)，最终helper `294ab5ab…` [复审](evidence/review-newer-human-archive-fence-recheck.json)返回queued/A。 |

P0初读还发现未知后创建替代、scope变化不取消迟到、已有null版本回退初始token及兼容任务恢复文字不一致的源码缺口。实施者修正后，源码、实际React六项及对应后端/Node负例证明关闭；这些初读结论未冒称已完成生产复现。最后的layout effect、有限存储、严格UUID/终态与畸形审计处理增量已结合冻结差异和最终证据核验。

## 验证证据和复用范围

独审自行在专用PostgreSQL `55460` 运行P0与诊断14项：14/14通过，受测五文件before/after SHA相同，集群停止确认。[结果](evidence/review-pg-result.json)、[原日志](evidence/review-p0-tests.log)。这轮随后的小型P0终态/UUID防御增量已静态复核，并核对实施者最终字节上的14项及实际reader/writer签名只读探针；不把早期字节结果冒称覆盖后续新增字节。独审首轮因TransactionTestCase flush后缺少控制seed而失败，原 [日志](evidence/review-p0-initial-tests.log)保留，修正夹具后通过，不追认原失败。

已逐项读取并核实以下最终原件：

- [实际React六项](evidence/browser-result.json)及 [受控HTTP脚本](evidence/browser-rehearsal.mjs)：503后精确原回执、live paused保留、unknown后改model/job不建替代、取消后迟到、同账号scope变化、换job及迟到进度；生产写入0、真实模型0、consoleErrors0。这是实际组件模拟传输验证，未当作生产浏览器操作。
- [P0最终PG/物理角色](evidence/resume-final-pg.json)、[同任务模拟阶段](evidence/resume-final-lifecycle.json)、[TS原日志](evidence/resume-ts-tests.log)。阶段含真实签名启动/领取/回写/reader回读，但计划创建用ORM夹具、取图和模型模拟；没有真实供应商吞吐或完整P1创建链路性能证明。
- [Worker104项](evidence/worker-targeted-tests.log)、[范围lint](evidence/affected-lint.log)及总控记录的后端边界通过。覆盖控制/read/review、SDK、调度/退避、图像/缓存和真实视觉适配器模拟；不据此声称全仓测试通过。
- [PG组合原日志](evidence/integration-pg-initial-label-error.log)为66项中的65实际成功及1个不存在标签的loader错误；修正标签的 [blockers14项](evidence/integration-blocker-tests.log)单独通过。原错误不回填为原命令通过。原priority/queue/blockers中的A/B、共享容量、连续补位和封顶保护与本轮差异相关，结果可复用。
- P1规则/权限/事务/并发、真实reader/writer正反权限及最终归档来源7项见 [规划报告](PLANNING_REUSE.md)、[原增量日志](evidence/planning-archived-source-tests.log)。既有priority测试原本把模型置信度当人工无价资格，本轮按需求改为queued并单独验证真人工审计；不是放宽断言迁就实现。

冻结200/1000/5000候选全部业务内容逐项相等，三个配对candidateDigest相同；SQL分别1141→21、5658→59、28259→255，创建约1.420→0.157秒、5.174→0.515秒、26.462→2.410秒。已核对实际Git旧函数提取、真实新集成调用、完整execute_wrapper计数和回读后事务回滚。[原基准](evidence/planning-benchmark.json)。初版5000计数因日志deque截断出现负值，不用于结论，原件保留。

有效基准绑定helper `6b9accf3…`；最终helper `294ab5ab…`增加归档来源的P1分支门槛，不新增SQL，原冻结集合均为committed来源，分支行为相同。最终7项与独立归档反例验证增量；不重复完整基准，也不把该早期测量伪称最终新增分支的重新实测。P2纯批量等价与P1有意行为变化分别判断。单轮合成配对不能外推生产P95、持续吞吐或模型提速。

## 仍待业务确认及发布边界

当前11枚举与Prompt segments/字典一致，但25正文规则、占位符、截断JSON、字段和原价规则存在实质冲突。候选提供具体分支而未擅定映射或激活。11与26分类取舍、交叉命中优先级、烧水商品和底座范围、人工金标及候选真实对照仍需业务确认，仅挂起这些依赖步骤。没有人工金标，不把模型无价样本说成已确认事实或准确率。

旧无可证明人工来源的无价、已有gold被更新但缺少新确认时钟的情形保守不复用；这是报告已明确的兼容限制。市场现有身份没有独立shop_name字段，本轮没有猜映射或扩展跨店来源；复用仍限同一市场SKU、类目、scope、维度和hash。

本轮真实隔离模型调用为0，原48/50账本未被本审查消费或重置。源码审查通过不授权额外Prompt/模型采用、人工批量入库或旧unknown重放。发布由总控串行负责，使用既有普通权限入口、最终合并提交与精确制品绑定；后续相关源码/输入变化须按真实增量复审，不能借本报告直接覆盖未审新内容。
