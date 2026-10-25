# AB 最终就绪取证补充候选

本目录是隔离开发候选，尚未封存、批准或运行。分支 `codex/release-final-readiness-review` 从干净的 `origin/main 0587600aa0c9fc7c206be2010eacf95da15386d5` 创建。原 AB 制品、E9、E295、E442、已接受的 source-witness 及正式入口未修改。独立复审通过后才由根任务提交并准备精确范围；生产执行仍需要用户对新范围的明确批准。

当前原 WAL 必须恰好 97 条，head 为 `d60a34f1aebce3bf2629a1d2c9b7e1c7f451c40fd74e44b9ac67388ef5cfdf19`。原第 19 步 strict comparison unknown/false 和第 21 步 STATUS_NOT_READY unknown 均保持原字节；原第 20 步 receipt `fde84841af84e80f02dad80e6d1b3c6b8f3f38bab3c54a2e24755723438cbacf` 不重放，source88 `ee784dfd…`/receipt `73c0de24…` 不重复追加。新的 `diagnostic-final-readiness-supplement` 采用原第 21 步的全部 command、cwd、文件、phase、assertions 和 retry budget，单独记录状态，永不把原第 21 步改为 passed。

## 限定源码改动

四个 legacy 副本来自真实 AB f4 的 `release-readonly-retry.mjs`、`release-batch.mjs`、`release-batch-admission.mjs` 及 E9 的 `collector.mjs`。`copy-legacy.mjs` 从原字节机械生成并验证，`LEGACY_COPY_MANIFEST.json` 列原 SHA、副本 SHA 和允许变化。仅移植已审 25744508 的固定 readiness projection 和失败 process 保全；两处 Status 在原断言之前调用共享取证；imports 指向原 f4 依赖和这些副本；CLI 错误仅保存固定类型及 message SHA。原四暂态、最多四次、STATUS_NOT_READY 非 retry、成功语义、12 域与版本断言、PowerShell argv/编码/子环境均未改变。E9 wrapper 的 root、phase、cwd、Python 全闭包检查不变，唯一子入口明确指向外置 admission。新的 collector descriptor 单独封存摘要，原 batch.collectorSha256 不换绑。

共享 `status-evidence.mjs` 不使用新的环境变量。它从自己所处新 E artifact 的 authority 导出固定证据目录，拒绝 reparse/hardlink 路径，通过 create-only/open(wx)/fsync 保全实际 native exit0 响应的 process 和 UTF8 stdout bytes/SHA、固定 state/backend/worker 枚举、12 个布尔或缺项及额外项数量。组件任意键名、reason、stdout body、客户信息不保存。记录注明 `native-response-captured-before-assertions`、`not-yet-evaluated`，不能独立当成功断言。非法 JSON 也留下 parse-failed 记录；取证失败阻断流程。真实 child failure 则保全原 safe process/stdout/stderr SHA 与 observation，不混作成功响应。

## 新协议范围

`protocol.mjs`、`runtime.mjs`、`execute.mjs`、`prepare.mjs` 是新 97 专属协议。旧 E295 scope/raw approval、E442 raw `13d1204e…`/真实批准 `bcc3a26d…` 均精确绑定。原 4589、当前 4505 及 E442 4718 闭包继续完整核验，加 97 原 WAL 全字节与新源码；API、caller、runtime、helper、四副本、独立报告逐 SHA 匹配。新 human receipt 必须独立批准保留两个 unknown、仅新只读 readiness、同 owner 条件释放，任何旧批准均不授权新代码。

顺序为新批准 → 原 typed source proof 复验 → 全部冷文件检查 → 带取证的原完整动态 collector → 真实 sample/binding/owner/CAS → 新操作 started → 原严格 Status+断言 → 新 passed → readiness accepted/pending owner → 同 owner 原子释放及真实 ENOENT → distinct completion。释放前 `necessaryAcceptanceClosed=false`；只有 typed ack 和物理 ENOENT 均确认后才追加必要验收闭合。调用器采用原支持的 `TERUISI_PROCESS_DEADLINE_UNIX_MS`，只在调用期间设置并 finally 恢复；单一 55 分钟是总期限上限，包含排队、源码核验、准入和收尾，不是预计耗时。started 前须剩足原完整 observation budget。所有 full pins 在 collector 前，started 前实际 sample age <=5 秒；Status 返回后仅小 WAL/owner/CAS，记录返回至 completion/释放跨度，不声称 unlink 时之前样本仍新鲜。

只有新严格 Status 的真实 process/receipt 与取证对应，并且原全部断言通过，才能 distinct completion 和 typed owner 释放；`originalBatchEngineCompleted=false`、`originalStrictComparisonPassed=false`、`originalReadiness21Passed=false` 始终保留。WAL 写盘/CAS失败不强写 foreign head，失败封包继续保全 receipt/process/安全 observation/readiness/statusEvidence 引用，caller 使用 create-only 故障审计。重入或并发不能重复本操作。

新范围不运行原第 20 步、其他旧操作、维护、生命周期、Backup/Restore、业务写入、外部发送、安装或调度修改，不采用 C/no-data/main 的其他能力。`prepare.mjs` 仅安全读取已存在旧元数据和 source typed proof，复制提交后的本目录至新 E root；不收集生产健康、不获取旋转锁、不运行 collector/Status，不写旧 WAL 或 owner。

## 作者验证与限制

- [AUTHOR_TESTS_FIRST.log](AUTHOR_TESTS_FIRST.log)：37/37，8362.3808 ms。全部运行/锁/WAL为内存 mock，唯一文件写入是私有临时目录；实际读取仅既存小元数据。不调用生产 operator、HTTP、SQL 或 collector。
- [AUTHOR_TESTS_FIXED.log](AUTHOR_TESTS_FIXED.log)：增加固定 sibling 路径与 runtime clone/freeze 后 37/37，9547.3269 ms。
- [AUTHOR_REVIEW_FIXED.log](AUTHOR_REVIEW_FIXED.log)：非作者指出释放前不得宣称闭合、返回结果之后 metadata 失败仍须保全真实证据，最小修补后 39/39，9010.4554 ms。旧轮重复结果不累加。
- [AUTHOR_TIMING_FIXED.log](AUTHOR_TIMING_FIXED.log)：记录 typed ack + 独立 ENOENT 确认的 `ownershipAbsentObservedAtMs` 后 40/40，10291.7138 ms；`returnToOwnershipAbsenceMs` 不含其后的 WAL 写入，也不冒称 unlink 的精确时刻。
- [AUTHOR_OWNER_AUDIT_FIXED.log](AUTHOR_OWNER_AUDIT_FIXED.log)：已确认释放后 completion 和 failure 两次 WAL 持久化都失败，安全封包保留 true/观测点，41/41，9678.9865 ms。
- [AUTHOR_POST_RESULT_FIXED.log](AUTHOR_POST_RESULT_FIXED.log)：所有已返回 result 后的小元数据失败（包括 pending 写盘和 active 读取）统一保留真实 receipt/process/statusEvidence，42/42，10511.2933 ms。
- [AUTHOR_FINAL.log](AUTHOR_FINAL.log)：适配器返回后立即记录 `finalReadinessOperationReturnedAtMs`，在剩余期限/证据校验/WAL之前；最终 43/43，11756.4109 ms。它是适配器返回确认点，不能冒充原 HTTP 响应瞬间。最后计时和故障保全修补通过 [LINT_FINAL_REVIEW.log](LINT_FINAL_REVIEW.log) 的 0 error/0 warning 检查。最终源码物理摘要见 [AUTHOR_SOURCE_SNAPSHOT.json](AUTHOR_SOURCE_SNAPSHOT.json)，作者不能代签独立通过。
- 暂存差异检查仅发现 protocol.mjs 多余 EOF 空行，删除后保留一个 LF，运行语义不变；`node --check` 通过，精确格式字节的 43 项复跑记录于 [AUTHOR_FORMAT_FINAL.log](AUTHOR_FORMAT_FINAL.log)。API 物理 SHA 为 `23a390da164b26801d9f8ddb12a7bec73ba3a4242225b3561b2d3a33812ed266`，其它 8 个运行模块 SHA 不变。
- 覆盖真实 old9/295/442 metadata binding，97 链/两 unknown 保全、不重20/source88、错批准/head/receipt/closure、动态错binding/陈旧采样、迟到和共同期限、无回应 marker、缺捕获、foreignCAS、并发、release no-op、passed/admission双重写盘失败安全证据；还覆盖错版本、NotReady、缺/额外/false组件、非法JSON、捕获写盘失败、stdout SHA/bytes mismatch、私有临时 create-only/fsync、重复sanitize不泄密。
- 原系统 PS5 nlink=2 仅沿用精确 host+SHA 例外；新增代码/输出要求普通 regular nlink=1。不存在放宽整个硬链接检查的分支。
- [LINT_FIRST.log](LINT_FIRST.log) 保留首次本工作树缺 `eslint` 导入的配置失败，[LINT_FIXED.log](LINT_FIXED.log) 保留 unused duplicate freeze 警告；删除重复定义后 [LINT_FINAL.log](LINT_FINAL.log) 为 0 error/0 warning（React 版本探测提示保留）。通过固定源码既有 `eslint/lib/api.js` 和 `eslint.config.mjs`，设置 `cwd` 为本工作树、`overrideConfigFile:true`，对本目录顶层 `.mjs` 检查，不安装依赖、不改变项目文件。
- 9 个运行模块均通过 `node --check`；限定原副本机械验证通过。没有重跑已通过的 real-native source-fix 测试、没有重 hash 943 MB dump/4k 制品，没有新生产验证。

import.meta 自识别已逐项核对：原 batch/admission 只用于 CLI main guard，无副本文件路径配置指纹。相同 CLI 参数经新副本路径调用时仍命中原 main；作为 runtime import 时不触发 main。E9 wrapper 保留原 AB-v2 输入根和完整 Python inventory，显式更换子模块路径且 Python helper 仍精确导入原 E9。所有 source/config/toolchain 身份函数继续来自 f4，只有原受支持 deadline 环境变量临时继承，没有新的 capture 环境变量。

这修复的是失败瞬间诊断保全缺口，不是生产服务故障修复。17:43 Worker exit1/自动恢复与 17:50–51 原 NotReady 是两个时间窗。原失败 stdout 已失，后来的 Ready 不能覆盖此前失败；真实 NotReady 具体组件及两个现象的因果仍未知。隔离成功不证明新生产 readiness 必将通过，失败时必须停止并保留事实，不能寻找 green 或改旧 unknown。作者不签本候选的独立通过结论。
