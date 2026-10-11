# 适用验证及原始缺口

本轮不是把未执行的检查填成“已演练”。封存数据须使用实际测试与精确候选绑定，生产验收另行执行。

| 验证 | 实际方法 | 边界 |
| --- | --- | --- |
| domain/contract/negative/concurrency | 发布影响、来源、四元组、原 WAL 与失败/unknown、动作前复验及危险反例 | 属于发布控制领域，合成 seam 不作为生产验收 |
| permissions/lifecycle | 原 PS 5/7 AST 启动 guard、真实浏览器写请求/重定向/WebSocket 拒绝、原身份/完整组件契约 | 未提前生产启停或更改权限；实际身份及真实权限验收留在最终批准范围 |
| migration-closure | v3 strict/full 限定十模块与两项工具包更新；完整 Worker 变化证明、原两份 Django manifest 与 2933 项全库存重算、原 prepared receipt、所有 backend/config/Drizzle/依赖不变 | 新类别，不冒称执行 migration-rehearsal；未经限定资格验证仍用原字面要求，旧协议不变 |
| backup-recovery | 原四阶段命令/receipt/失败绑定、恢复复用失效反例、WAL 与原备份/恢复/维护工具字节保持、实际新 verifier/resolver 消费候选的兼容性 | 测的是协议、控制及消费者；本轮尚未执行新的 PG 恢复演练，不能把未来生产四阶段算作已通过测试 |
| boundary/build | 完整原在线 Worker producer 构建/制品验证与 Django 原 PrepareApp 本地 R2 往返、最终限定模块测试 | 精确候选更新后须重新绑定；不重复未变化的大规模边界压力验证 |

## 限定迁移闭包契约

`teruisi-tools-no-migration-v1` 只用于 v3 strict/full。它要求完整变化正好是既有十个 release-control 文件，after 每个摘要等于实际执行的受审工具字节；无法通过填写布尔值或改路径标签取得资格。Django before/after manifest raw SHA 绑定批次双身份；全 path→SHA 库存按原 ordinal 算法重算 fingerprint 与 fileCount，不能遗漏文件、夹带迁移/业务/配置/依赖变化或构造相同名称不同代码。

两份更新工具须和 Worker after 字节相同。可额外包含本次已复审的生成 `Request.cf` 缓存，具体摘要/字段变更及审查证据进入封存；现场回读原/后 JSON，核对结构、类型、允许的 TLS/网络字段和全部其他值等价。不接受任意 cache 或通用 N/A。

资格只将验证名称 `migration-rehearsal` 换成 `migration-closure`，四项数据库操作、backup-recovery、权限、生命周期、全字节及其他要求全部保持。缺少资格时不默认 N/A；资格无效、混合业务变化、错误前驱、遗漏库存、手改 policy 后重算摘要等须拒绝。旧 v2 和没有该资格的旧 v3 不重解释。

## 真实观察器 WAL 缺口

旧观察器将 started/result/failure 放在 `state.dir/observations`，而 journalState 只接受连续编号 JSON，导致下一次读取失败。此前私有闭环用了替代观察器，原 139 项也未覆盖这个生产 wrapper 的保存路径；原结果保留并限定意义。修复移到 journalRoot 的独立 `_observations`，不改变旧编号记录/审计。

新增回归调用真实 runNoDataObservation 的非法输入失败路径：started/failure 真正保存，校验在访问任何生产 plan 前拒绝，后续原 journalState 与 unknown/no-replay 仍正常。不是把一个生成文件存在当完整生产验收；成功 display、权限、自然守护仍按实际后续范围执行。

## 失败保全

作者首轮新来源 fixture 22/23（缺少 package/lock）、旧 watcher 159/160及后续172/173（根因未解决，原实现/断言不改，定向和串行重验）、原 CLI 诊断文字 24/25（不必要文字变化已恢复）均保留原日志。主代理空测试文件结果已作废；过早观察空 stdout 的退出缺陷推测已撤回，正式计划正常返回，未据该误判修改代码。最初 two-file Django 假设失败后，完整第三 cache 差异单独审查并保留准确摘要，没有篡改制品来匹配旧假设。
