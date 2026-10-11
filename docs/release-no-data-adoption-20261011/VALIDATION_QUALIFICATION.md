# 工具采用批次的迁移闭包资格与观察证据修复

本补充只适用于新 v3 strict/full 批次。它把特定工具采用范围的验证名称从 `migration-rehearsal` 改为 `migration-closure`；不授予 `not-required`，不改变 full 恢复模式、前后四个 Backup/Restore 阶段、`backup-recovery` 或其他验证要求。无资格字段的 v2、旧 v3 保持原规则；字段无效时拒绝，不能退回一个无证据的 N/A。

## 精确资格

`tests.scopeValidation.version` 为 `teruisi-tools-no-migration-v1`。`before` 和 `after` 各包含原始 `manifestRaw` 与完整 `inventory`（相对路径到 SHA-256）。复算原 Django v2 `relative-path-file-sha256-ordinal-v2` 指纹、文件数和原始清单 SHA，并与批次 Django 前驱／候选绑定比较。路径集合必须一致；backend、config、drizzle、runtime-tools/node_modules 以及原生命周期／PG 备份工具都在完整清单中。

Django 只能改变 `tools/worker-local-release.mjs` 和 `tools/worker-local-release-rotation.mjs`，以及存在具体审查的生成文件 `.wrangler/cache/cf.json`。两个工具的候选哈希必须等于 Worker 候选源码哈希。Worker 的完整 impactProof 必须恰好包含已审查的十个发布控制文件；其 after 哈希必须与执行当前验证器的实际十个文件相同。仅用允许的文件名替换恶意代码再重算摘要不能获得资格。

可选 `cfCacheReview` 使用 `teruisi-generated-request-cf-v1`，保存 beforeSha256、afterSha256、changedPaths 和 reviewEvidenceSha256。原始缓存值不进入报告。声明必须绑定封存清单；现场读取进一步比较完整结构、类型及全部值，只允许声明的 TLS 握手元数据和 edgeL4.deliveryRate 六个已知叶子变化。其他键、类型、增加／删除、错误 JSON 均拒绝。证据摘要绑定具体人工审查，算法不把它解释为模型自动作出的业务无影响审批。

生成批次、verifyBatch 和现场采集复用同一资格验证函数。静态完整性不能证明调用者构造的清单就是实际部署包，因此现场采集不可省略：原准备收据 ID、runtime、前驱／候选清单和原始收据 SHA 均绑定；部署前读取 `app` 与 `app.deploy-<id>`，确认 DeployApp 已通过后读取 `app.previous` 与 `app`。逐文件读取保持既有重解析点、硬链接、路径和字节检查。app.previous 必须保留到验收结束。

原规范要求“根据改动范围运行最小充分验证”。这里的 migration-closure 证明本次完整包中迁移、模型、业务实现、配置和依赖未变，不声称执行了 PostgreSQL 镜像迁移或恢复演练。backup-recovery 的本轮开发证据是实际契约失败／WAL／原始收据与消费者兼容性验证，并结合原 PG 操作器完整字节未变；它不是“已恢复生产数据库”的记录。首次采用的四个真实阶段仍在明确生产批准后由原流程执行。

## 观察证据与 WAL

原 `runNoDataObservation` 把证据子目录写入批次数字 WAL 目录，下一次 journalState 会按既有严格枚举拒绝它。这是原先 139 项候选验证未覆盖的实际封装层缺口。现在成功／失败都在批次目录的兄弟 `_observations/<batch>-<op>-<uuid>` 写入，保留原 create-only 写入和安全路径检查。

新增回归调用真实观察函数，故意提供非法观察动作，在任何生产读取前失败；started 和 failure 证据仍持久存在，随后真实 journalState 可读。通过原 executeBatch 的私有测试环境还验证 unknown／owner 保留与禁止重放。未增加生产执行回调或门禁绕过。

## 本轮结果与冻结

- 新资格及真实观察 WAL 回归 13/13；源码绑定 23/23。
- 最终八文件串行相关回归 173/173，36.773 秒；ESLint 与 git diff --check 通过。
- 首轮相关回归 172/173：既有 missing-config watcher 报 Inputs changed；相同单项、串行重跑与最终回归均通过，原因未确定，原日志保留。
- 173 项含 21 个离线 composition 工具用例，该工具不在受限生产源码中；不可把全部 173 项都称为原始候选制品验证。候选可重绑定其余 152 项到不可变工具字节。
- 原始真实 Django 两套 2933 项完整清单已由新指纹函数只读复算，均吻合原清单；本轮未执行实际 PG 恢复或生产切换。

交接清单位于 `E:/codex-artifacts/release-no-data-adoption-20261011/ASTRA_VALIDATION_HANDOFF.json`，SHA-256 `45ed4beee3d471c6f0f0a8cae8a86657588325383909d7943a6a416842aca13f`。合并六文件零上下文补丁 SHA-256 `21765944ddae6143748a2c88c8e809b07205031c34e782c18fe13a8de54274cd`；只机械应用该增量到原九文件范围，最终共十个运行时文件，避免带入 latest main 未采用的其他健康诊断改动。

两份 Django 消费工具字节未变，已有 Django 85cf 候选是否复用由原准备收据和现场验证决定。旧 Worker 20855 及其源绑定／计划／回执保持原样；新 Worker 必须重新准备、绑定和审核。运行时代码已冻结，本文不构成生产执行授权。
