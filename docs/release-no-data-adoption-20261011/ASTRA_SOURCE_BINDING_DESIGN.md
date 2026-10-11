# 精确来源绑定：四模块实现与交接

2026-10-11，从 `origin/main ba656eabbb93d17d6e2f57d51ea3d13b27d1f50d` 的独立工作树实现。原九文件来源及745995载荷、其他任务固定准备树、生产控制入口保持不动。本实现未调用正式plan/build/apply或准备Django包；后续候选准备由主代理统一协调，生产切换另按精确范围批准。

## 契约及单向依赖

原入口新增成对参数，只有在线后继准备可以使用：

```text
node tools/worker-local-release-rotation.mjs plan --prepare-online --source-binding <绝对JSON路径> --source-binding-sha256 <原字节SHA256> --json
```

绑定文件为规范JSON加一个换行，版本 `teruisi-worker-source-binding-v1`，严格只含：

- version、规范绝对sourceRoot、sourceRootPathSha256；
- predecessor（既有完整release binding）、predecessorChainStateSha256（原生效successor链状态，不是WAL head或plan SHA）；
- identity（原workerPreparationIdentity全部字段）：sourceTree、完整sourceInventorySha256、Node字节、runtime配置、external npm配置、完整toolchain和继承environment摘要及原version。

文件不在自己的sourceRoot内部，不包含新候选manifest/plan/receipt摘要，避免循环。Envelope为 `{raw,sha256}`，原字节及摘要嵌入新manifest.source.sourceBinding、typed plan.sourceBinding、prepared receipt.sourceBinding与batch.sourceBinding，batch.binding同时锁sourceBindingSha256。候选manifest摘要再由原plan/receipt/batch绑定，保持有向无环依赖。没有注册表、路径推断、临时成功缓存或调用者noData布尔开关。

任何身份字段缺失、额外键、非规范字节、原摘要变化或不同来源组合都拒绝。所有原环境变量、配置、npmrc/工具链输入保持；不剔除工作树或环境所谓噪声以换取资格。Source binding只证明精确输入，不证明行为无副作用、不授予上线或not-required资格。

## 路径与准备

sourceRoot必须实际存在，不能与固定Worker运行根、主保护根/persist、旧legacy来源、现fixed准备来源及Django运行根双向重叠。判定复用Windows大小写无关、带分隔符的规范路径；再逐级lstat/realpath核真实位置、拒绝reparse/junction。不存在的保留根从最近存在祖先解析后继续保护，不因不存在而忽略。源文件、绑定输入和完整snapshot库存拒绝共享硬链接；输入文件有1MiB上限。

原producer在原锁与真实前驱验证后读取绑定，完整采样指定源和全部原identity；构建前后重读、复验源/环境/配置/工具链及实际前驱。新构建仍用原staging、npm ci/postinstall、Worker/helper/contract/guard构建与完整校验；runtime/protected/.dev.vars/persist/sourceD1权威没有新覆盖参数。既有原typed plan重用时只从该精确批准plan及原receipt取得同一绑定，再核完整当前源，不回退fixedRoot。

manifest来源验证检查绑定的规范schema、源root SHA、完整snapshot tree/inventory及构建toolchain。原snapshot/dist/dependency/helper/key-file/ACL/进程/authority验证继续执行。普通启动不需要重读可变开发来源；现场批次准入才重采其来源身份。旧无sourceBinding的manifest/plan/receipt/batch继续原固定来源与原schema；未知键仍拒绝。

## 批次与现场准入

makeBatch/verifyBatch把envelope绑定同批源tree/inventory、精确前驱、配置和toolchain。标准collector先验证原plan、候选manifest、原prepared receipt/sidecar及batch四者相同，之后才使用该sourceRoot采样。in-process evidence session也由同一批次契约选根；每次动态collector仍重新检查原tuple，session未获得单独路径/权限豁免。没有envelope却出现绑定摘要，或者plan/manifest有envelope而batch没有时，立即失败。

现有no-data分类、独立副作用复审、Django RequireReady/接收器抑制、原mutex/drain/unknown行为不变。此次机制增量自身仍strict/full，不因来源文件是自有目录获得数据库减免。

## 与旧消费者的真实兼容性

见[来源/消费者矩阵](SOURCE_REQUIRED_MATRIX.md)。并非把字段放入source命名空间就能与旧exactKeys自动兼容：候选必须携带新verifier/resolver，原guard installer与startup绑定负责保护根的升级；installed Django保留工具的旧colocated verifier/resolver另有真实消费路径，必须在首次范围中用原PrepareApp/DeployApp精确刷新工具包，不能假称原237 manifest不变或忽略Backup后的release retention失败。

## 验证与失败保留

新契约23/23；原相关160项最终串行160/160（37.422秒）。首轮159/160为既有watcher Inputs changed，未改断言/实现，定向与同套串行复验通过，根因未知。新fixture首轮22/23先被原package.json/lock必需检查拒绝；补齐合成fixture后触达并通过hardlink拒绝，不改实现门禁。

原rotation完整25项跑出24/25，包括129后继边界完整验证通过（242.176秒）；唯一失败是旧源码断言要求原CLI拒绝文本，新增“裸”字不必要，已恢复原文本并精确重跑该case通过。保留原失败，不再重演未受影响的四分钟边界测试。新契约再次23/23、四模块ESLint/语法/diff检查通过。

本轮没有制造正式候选、没有实跑生产collector/Windows维护、没有新备份恢复。单元/fixture不替代主代理随后对精确限定十文件源的同套测试、完整构建和原producer正式准备。

## 源码组合与字节

开发工作树base ba656的batch/admission含未采用的健康诊断改动，因此只交本次四模块delta。普通三行上下文patch会因这些无关邻接import不同而失败；该原失败保留。最终 `source-binding-final-zero-context.patch`（SHA `47d73bc4c1eaa24199eaa248bef48f18755e6e3ac88da3994c3e8c11d7af7e89`）已机械应用至原九文件源的私有副本，四文件语法通过，限定batch/admission没有safeReadinessFailure泄入。

精确开发及限定候选SHA见 `E:/codex-artifacts/release-no-data-adoption-20261011/ASTRA_SOURCE_BINDING_HANDOFF.json`。worker verifier/rotation的两份SHA只因CRLF/LF不同；完整字节门禁不会豁免此差异。生产准备必须运行精确候选来源的工具字节，不能用开发版verifier去验证另一个换行版本。主代理须独立核机械应用语义并在完整限定来源上重验。原九文件源及旧载荷未覆盖。
