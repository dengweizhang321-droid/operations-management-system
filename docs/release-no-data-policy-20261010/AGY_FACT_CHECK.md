# 真实Antigravity复审、分歧与纠正

实际入口 `C:/Users/86137/AppData/Local/agy/bin/agy.exe`，同一conversation `77746d92-0c01-4277-93d3-b17e494b3ae2`。GPT-6 Astra/high实际负责设计、代码与回归；主agent提供物理源码原字节、实跑及生产只读核验，逐项核查结论。

第一轮native view_file读取旧34b4路径被权限检查拒绝，原STREAM保留，SUCCESS但response为空，**不算完成审查**。没有改工具绕过或重试被拒资源；后续仅把已授权的本任务隔离源码/完整上下文原文作为CLI输入，自包含只读评审，不再请求该路径。AGY没有实际运行测试或亲自读取最终工作树，不能表述成独立实跑。

| 轮次 | 原文与实际范围 |
| --- | --- |
| 1 | 空响应/原native拒绝；E盘原始STREAM/call/输入 |
| 2 | [独立设计](AGY_ROUND2.md)，自包含需求；Astra[交叉回应](ASTRA_ROUND1.md) |
| 3 | [实际diff对抗审查](AGY_ROUND3.md)；Astra[逐项实证裁决](ASTRA_ROUND2.md) |
| 4 | [完整proof/observer/固定词汇](AGY_ROUND4.md)，撤回错误阻断；Astra[事实校正](ASTRA_ROUND3.md) |
| 5 | [最终分类/部署输入/受保护来源/真实样本与七文件自举](AGY_ROUND5.md)；保留过强修辞并明确纠正 |
| 6 | [新增WebSocket最终字节与真实负例](AGY_ROUND6.md)；有限已提供范围可Git交付，无生产授权 |
| 7 | [隐式后端/接收器启动门禁](AGY_ROUND7.md)；原七文件意见被九文件范围替代，PS5/PS7原控制流及参数传输实跑另见[纠正](ASTRA_BACKEND_START_CORRECTION.md) |

原输入、CLI单次call UTC区间、stdout/stderr、STREAM、result及源清单全部在 `E:/codex-artifacts/release-no-data-policy-20261010/`。result中的duration/usage可能累计conversation，不能当各轮独立时长或工时相加；单次时长以call文件为准。没有把两个模型一致视为验证。

仓库AGY正文副本仅规范行尾空白和EOF，以通过差异检查；原文字内容/分歧不改。E盘原始stdout/响应/输入及其SHA保持原字节，原件是字节追溯依据。

| 原主张/实际发现 | 核查及处理 |
| --- | --- |
| not-required是零读取；reuse可兜未排除的数据风险 | 更正为本次持久效果；旧reuse只限原合格display，正常业务读取/自然写入不是本次DB要求 |
| 四DB阶段“双前备份/后恢复”、静态直换、hash异常自动rollback | 更正为前Backup/Restore+后Backup/Restore，原完整Worker排空/切换/启动；异常保存/阻断，不擅自rollback或外发 |
| makeImpactProof没有before/after，所以v3封存100%必崩 | diff缺未变上下文导致错误推断；完整函数一直保留变化原字节，JSON roundtrip及真实make/verify/WAL通过，AGY正式撤回；不采用削弱为skeleton SHA的建议 |
| Django hash空值能绕过、探针可提前到prepare | 原assertStartBinding/phase与排序已拒绝；新增负例实跑；v3额外显式hash诊断，原失败32/33保留，不称原保护失效 |
| collector额外pin文件等于执行木马 | pin清单只是字节读取，不是执行清单；封闭/去重和绝对JSON路径为防御加强，不是已复现RCE修复 |
| 应放宽PS5、路径别名、同机时钟+1000ms | 保留原平台/精确路径和保守拒绝；同机进程共用系统时钟，不因进程不同产生时钟偏差；真实时钟异常失败关闭 |
| 普通class和事件文本可能触发写入 | 范围收窄为有限布局类及整个被动静态组件；已有textContent writer负例拒绝；CSS完整布局观察器审查不能仅凭语法代替 |
| 只比源码漏运行配置、环境/npmrc/toolchain | Astra/主agent发现并加入原前后准备收据完整比较，现场受保护来源再验证；缺证据full |
| HTTP route足以全网络“物理隔离” | 主agent找到WebSocket缺口，Astra修复，服务端upgrade=0；AGY第6轮再审。仍不宣称全部浏览器网络通道形式证明 |
| “绝对被动”“不存在任何漏洞”“数学闭合”、测试等于类型检查 | 收敛为窄支持/测试范围。报告字符串长度下限不证明语义真实；主机/原准备引擎的信任边界保留；无独立typechecker |
| 69.5秒、七文件、strict/full | 69.527/64.074秒是旧私有样本；最终私有72.494秒仍非生产SLA。七文件是旧源码差异不是全部runtime，现被九文件范围替代。strict/full是待首次采用约束，本任务没有执行四DB步骤 |
| 七文件所有已知启动副作用都已覆盖 | 主agent再次实际沿原Start查到NotReady后端启动/迁移/权限复位与两处AutoStartDingTalk；Astra补两PS门禁，九文件严格首次范围替代七文件；AGY7逐字节复审。旧意见不倒写成已覆盖新发现 |

最终137项、原服务/生命周期6项、drain2项、packer3项、实际应用权限/请求12项、构建/helper/边界及最终完整字节分别提供工程证据，重复验证不相加为独有用例。原136/137并行watcher失败、rendered-html四个基线失败、真实UI示例两次失败及路径/EOL纠正都保留。首次生产与旧owner仍待其明确条件，不被审查者“许可”替代人类批准。
