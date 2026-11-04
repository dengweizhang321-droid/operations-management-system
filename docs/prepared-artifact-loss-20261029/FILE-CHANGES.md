# 文件级变更说明

Git 基线为 main 1164aed2，控制实现基线为已采用 804a。下表区分本次增量与原样承接；不是把 main 的旧实现当成控制基底。

| 文件 | 变更及判断依据 |
| --- | --- |
| `.gitattributes` | 给原样承接的 collector、四份 S05d 入口夹具和本任务 JSON/TAP/log 证据设置窄范围 -text，防止 Git 行尾转换破坏精确字节；原始 TAP/log 按证据禁文本 diff，不修改其内容来消除空白。 |
| `tests/fixtures/s05d-old-source-entry/frozen-main-source-sequential.mjs` | 从 1456 精确承接 R1b 历史入口测试直接依赖的静态夹具；只复制到私有目录测试，不作为实际原生发布入口。 |
| `tests/fixtures/s05d-old-source-entry/publish-latest-main.mjs` | 从 1456 精确承接 R1b 历史入口测试直接依赖的静态夹具；只复制到私有目录测试，不作为实际原生发布入口。 |
| `tests/fixtures/s05d-old-source-entry/publish-main-progress.mjs` | 从 1456 精确承接 R1b 历史入口测试直接依赖的静态夹具；只复制到私有目录测试，不作为实际原生发布入口。 |
| `tests/fixtures/s05d-old-source-entry/release-scope-plan.mjs` | 从 1456 精确承接 R1b 历史入口测试直接依赖的静态夹具；只复制到私有目录测试，不作为实际原生发布入口。 |
| `tests/main-prebuild-queue-abandonment.test.mjs` | 原样承接已采用 S05d 的 14 项队列回归，覆盖宽限、发布标记、身份/锁、结构化失败及 plain failure→unknown。 |
| `tests/manual-preparation-recovery.test.mjs` | 原样承接 manual-only/abandon-only 回归，验证旧核销仍要求 pending=0、独立新损失核销不改变旧行为。 |
| `tests/preparation-resolution.test.mjs` | 保留原有断言；八份封存历史读取改成必需私有副本路径，无生产默认、无跳过；producer 断言核精确五项并集并继续拒绝未知或混配。 |
| `tests/preparation-retirement-entry.test.mjs` | 承接已采用 R1b 资格测试；负例使用独立空 Git 仓库隔绝 worktree 祖先发现，仍保留原精确拒绝断言；另用原 804a guard 字节复现此前隔离夹具问题。 |
| `tests/preparation-retirement-ref.test.mjs` | 原样承接已采用 R1b ref fence 的私有 Git 测试，证明禁止目标引用机制不丢失。 |
| `tests/prepared-artifact-loss.test.mjs` | 新增 20 项实际隔离协议用例，覆盖防滥用表、所有固定入口、整组/中断/并发/代际、材料绑定及旧 publication-retired。 |
| `tools/install-main-prebuild.mjs` | 承接 1456 安装器，增加 --artifact-loss-manifest 材料输入；清单摘要绑定 bundle manifest/intent，后继材料继承并拒替换或遗漏；新增纯材料读取导出供隔离门禁测试，不增加采用自动执行。 |
| `tools/main-control-dispatch.mjs` | 在已采用控制完整性检查中验证新协议能力及清单外锚；新固定入口不能忽略既有损失绑定。 |
| `tools/main-prebuild-hook.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/main-prebuild-queue.mjs` | 以 804a 的 427 行队列为基底，拆结构绑定与原生文件校验；损失记录并入退休集合并排除复用；保留 unknown/failed/blocked、abandoned、publication-retired 和原代际拒绝；本轮已验证快照复用避免重复全盘读取。 |
| `tools/main-prebuild-task.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/main-preparation-reconcile.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-producer-qualification.mjs` | 804a 三组与 main 三组做精确并集，共五组；既保留已采用 S05d，又保留 main 的准备/切换计时两代；不生成新原生闭包资格、不改原生三文件。 |
| `tools/preparation-resolution.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-admission.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-archive.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-boot.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-collector.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-console.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-entry.mjs` | 保留历史精确 pins 及 804a 前驱 current pins，更新本候选 latest/installer 精确摘要；没有通配放行。 |
| `tools/preparation-retirement-evidence.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-fs.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-handoff-runner.ps1` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-handoff.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-history.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-native.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-observer.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-qualification.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-ref.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-source.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement-witness.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/preparation-retirement.mjs` | 原样承接 804a 的同名控制文件，保留其已安装能力和依赖闭包；本次不改变内部实现。字节证明见 BASELINE.json 与 DELIVERY-SUMMARY.json。 |
| `tools/prepared-artifact-loss.mjs` | 新增清单 schema/完整组绑定、采用材料外锚读取、损失旁记录及整批完成结果；只允许整包 ENOENT；重现后校验原回执和请求；持 queue→submission→rotation 锁，仅核销后退出。 |
| `tools/publish-latest-main.mjs` | 承接 804a 固定入口后新增互斥 --retire-lost-artifacts 模式；正常准备/检查/发布沿退休集合拒旧包；堵住 dispatches 整目录缺失的 legacy empty-set 旁路；精确保留 main 的 parseApplyTimingLines 兼容块。 |

main-schema-release.mjs 最终与 main 无差异，但相对 804a 额外保留 main 已有的 SalesPreflightIndex154 三行；它因此列在六个非逐字相同控制叶中。tests/publish-latest-main.test.mjs 最终与 main 无差异，完整 455 行保留。

文档与产物：REPORT.md 说明行为和边界；MISSING-PREPARED.json/md 是用户核对平表；artifact-loss-manifest.json 为待审核清单；LOSS-INVENTORY.json、SELECTION-CONSISTENCY.json 保存只读映射证据；BASELINE/ADOPTED-MANIFEST/CODE-FREEZE/DELIVERY-SUMMARY 保存字节来源；PROTOCOL-CHECKS.md 和实际 TAP/门禁输出保存验证证据。collect-loss-inventory.py、snapshot-history-fixture.py、summarize-delivery.py 分别只负责只读清单采集、私有历史副本准备和候选摘要生成。
