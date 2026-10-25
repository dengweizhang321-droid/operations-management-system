# 旧候选残留有限分类

2026-10-23。基线 `c7f94a79`，工作树 `D:/codex-worktrees/s05d-residual-classification-20261023`。按 [限定方案](PLAN-ADDENDUM.md)只修改 history、collector 两个生产模块；没有新增生产模块、控制包成员或 CLI 参数，没有改变原两条 decision、原 unknown 或旧 target 禁重放。

## 分类与复用

独立 `retained-unconsumed-residual` 角色不伪造 consumed binding。原 `qualifyRetirementHistoricalSource` 的已消费链锚条件保留；仅将其原工具成员/keyFiles/全文 SHA/来源 policy/BAT 读取提为共用函数。新角色只接受固定 16/19 叶形状，真实工具同时匹配原 manifest 与已审 registry。没有 ID、日期、dispatch 白名单。

新角色另限本次实际出现的 **5 个既有 Worker 字节家族**，没有让 history 中其它家族自动继承新资格。有限只读 5 叶共 762,422 字节，其 source-snapshot 验证调用块与 validateTree 函数体逐字节相同，见 [consumer-family-inspection.json](consumer-family-inspection.json)。其中一版用真实函数在全私有根演示缺 snapshot 的拒绝，不能据此宣称旧 CLI 全程无作用。

全部非秘密保留叶按角色有界全读并保存摘要/身份/尺寸/链接数/时间，核 manifest、package-lock、keyFiles、audit pointers 和 activation fence 的原生绑定。`.dev.vars` 不读正文、不拆链，只核原生固定 base 与残留叶的对象和链接身份。实际 manifest schema 来自已按长度/SHA 绑定的既有成功 observation，见 [source-schema-inspection.json](source-schema-inspection.json)。未知叶、层级、工具、载荷或 Git 身份拒绝。

五域引用仅接受完整候选 ID/manifest 配对命中的 rotation plan，核固定路径、hash 文件名、版本/status、原生 payload、sidecar、candidate binding 与实际 guard receipt。该规则只资格化原位保留记录，不证明计划仍可执行，也不重写完整 rotation validator。其它位置或 prepared/publication/consumption/successor 命中拒绝。8 个真实旧计划及 sidecar 的一次必要只读投影为 **35,126 字节**，原件 SHA 与取证表一致、前后 metadata 稳定，见 [plan-schema-inspection.json](plan-schema-inspection.json)。

collector 中合格者原位保留，不扩原 target ID 集合、不生成 source/artifact move；仍参与共同外部 source 义务与 source-entry/ref fence 资格。完成 alias 固定点后再次检查所有保留 JSON 中的绝对来源地址；若旧计划另进入原 a3 引用闭包则拒绝，不能由本角色豁免。末次统一 CAS 复验每层成员、全部保留叶/缺失项/共享配置对象；五域 plan/sidecar 继续沿用原 metadata CAS。seal reader 每次仍重新分类和复验，不缓存历史通过。

## 最小检查与明确限制

新文件 `tests/preparation-retirement-residual.test.mjs` 共 4 项：[修正版原始输出](checks-2.txt) **4/4 通过，exit 0，833.039 ms**；命令见 [checks-2.json](checks-2.json)。

1. 两种有限形状及 8 份候选计划原位保留，原 consumed-history 非链成员仍拒绝。
2. 非 candidate 字段、prepared/consumption 引用、坏 sidecar 和原来源 tuple 拒绝。
3. 未知工具、载荷恢复、迟到 package/audit/fence 修改及链接变化拒绝；外部来源缺资格仍拒绝，实际不同叶可满足原有义务。
4. 精确 `0d945…c57c0d` 旧 verifier 全文 SHA 绑定。verify、validatePayloadSha/validateTree、canonical reader 与路径包含函数体取自原件；只替换之前的 npm/provenance 与后续不许到达的进程运输。真实私有文件读取确实到达 `source-snapshot` 的 ENOENT，未由其它前置失败凑结果。**结论仅为此前置满足后的候选验证仍拒绝缺载荷；不是现场旧 CLI 全流程、零副作用或退休证明。** 测试用 opaque tool policy 限于受约束私有 seam，不资格化生产新字节。

首轮 [checks-1.txt](checks-1.txt) 为 3/4：正例夹具错误地把 candidate manifest SHA 用到 predecessor，被严格引用检查发现额外 predecessor 命中。只修夹具的独立前驱，没有放宽生产判断。修正版 4 项已在根代理提出“只复跑失败项”的消息到达前完成；此后没有复跑该 4 项整组。

独审随后发现 raw source-binding envelope 的解码对象未进入最终绝对地址集合，可能漏掉随后扩展的别名。已只补已解码 binding 入原集合，没有新解析器；原第 1 项补 envelope/普通对象两种地址保留断言，单项 [checks-3.txt](checks-3.txt) **1/1，exit 0，380.331 ms**，其余 3 项有效结果复用。本段补正属于真实审查发现，未重跑旧全套。

同分支最终静态复核另将已解码 `binding.sourceRoot` 纳入现有 `requiredFixedSourceRoots`，使未登记独立 clone 同样必须通过原外部来源 finalizer；未知根自然拒绝。现有 11 项没有 binding，该一行不改变本案输出，按主负责人要求复用已有检查及未知外部来源反例，不新增测试或现场扫描。

没有运行真实 collector、旧 CLI、完整构建、旧全套或额外 bundle 检查，没有生产写、任务/服务/DB/重启、来源移动、删档、fetch 或 Git 交付。当前交付是分类资格代码与私有边界证据；实际 11 项是否全部符合、真正 source/artifact 清单、archive 预准入测量和 S05b 现场门禁由主负责人后续一次只读及原生动作判定。原位保留不等于证明历史零作用或授权删除。冻结摘要见 [pins.json](pins.json)。
