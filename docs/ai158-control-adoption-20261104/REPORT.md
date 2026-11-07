# AI158 控制包采用与应用制品准备

执行来源：main `ece8c7ec46ac7bd7dc0a5a3e3eed8fcf065d3b65`。本次授权为准备/采用控制包、采用后核验、应用制品准备与冻结树复测。**没有上线授权，未执行应用部署、生产迁移或业务数据写入。**

用户暂停带电脑回家后，已按指令停止测试执行器并落盘续接记录；用户随后明确“继续工作”，先核验原绑定，再续测。没有重复采用或重新打包。

## 控制包材料与采用

| 项目 | 实际值 |
| --- | --- |
| 材料目录 | `D:/codex-artifacts/ai158-control-adoption-20261104/materials` |
| installId | `da1c53d3-e8d7-46dd-be10-aa584c707906` |
| 旧 bundleSha256 | `fe4e34dcea03ad77c47c288bd572841ae69428bb05147893f69c452102d45aa6` |
| 新 bundleSha256 | `9cfa94a96ab064910422df3b8c7d7b999622122eb83822f14ed1b4387b91ad8f` |
| 新 bundleManifestSha256 | `e987f3b6302e6dce98bfc47898b1c08999acb6fa11593b0061d9aef7884500c7` |
| intentSha256 | `352efcd015acf012695fa967c9c7fcb43be5875957968672f0ad50c9f6a07264` |
| 实际成员数 | 旧37，新38；逐个原始字节SHA及canonical映射SHA均核验 |
| 原生采用结果 | `status=adopted`，exit0，`productionDeploymentPerformed=false` |

从干净的独立detached worktree执行 `install-main-prebuild.mjs --config ... --out ...`，返回bundle-prepared、`adoptionPerformed=false`。采用调用同一安装器公开 `adoptControlUpgrade` 实现，显式 `timeoutMs=600000` 并记录S0—S7；未修改安装器、锁、身份门禁或连续空闲判据。原CLI把预算固定为30000ms，因此未为满足时间而跳过任何门禁。

原生TRANSITION核验：锁顺序为v1 queue→v2 queue→native rotation，`privateTestTopology=false`，连续三轮related为空，`legacyWindowConverged=true`，最终安装记录adopted。没有中断采用，没有执行resume或回退。临时控制源worktree在确认干净后精确移除；主仓库既有未跟踪文件、旧控制包和历史pin均保留。

### 对提示词中事实的纠正

1. 当前 `controlFiles` 是基础35项再追加3项，最终38项，不是35。相对旧包实际变动的成员为 `main-schema-release.mjs`、`publish-latest-main.mjs`、`release-scope-plan.mjs`，以及新增的 `publication-readiness.mjs`。`publish-prepared-main.mjs`、`manual-maintenance-continuation.mjs` 不在这个控制bundle成员表中，不能据它们的变化计算bundle摘要。
2. 准备材料布局为 `materials/bundle/tools/`；采用后的不可变包布局为 `control-bundles/<sha>/tools/`。canonical只对成员hash映射计算，含最终换行，未把整个MANIFEST计入。
3. `hookSha256` 按代码设计应随新bundle路径变化。`install-main-prebuild.mjs:134—135` 使用新 `bundleRoot/tools/main-prebuild-hook.mjs` 生成HOOK；现役hook、封存HOOK及INTENT的摘要三者完全一致。提示词将此项列为“应不变”不符合实际代码。
4. 采用CLI默认预算30秒；本次仅通过同一公开API设置较长预算，实际仍走原有限实现，未换工具绕过审批拒绝。

### 采用后核验表

| 字段 | 实际变化 | 核验 |
| --- | --- | --- |
| dispatcherSha256 | 不变 | 与旧记录及现役字节一致 |
| hookSha256 | 改变 | 与本次封存HOOK/INTENT一致，绑定新bundle路径 |
| preparationTask.hostSha256/nodeSha256 | 不变 | 前后字段及恢复时实际可执行文件hash一致 |
| configSha256 | 不变 | `a461db4d0d57175d712c01d7707cc36c38b8f1d43e0ee5c1d4a5f482ca5ac9c8` |
| bundleSha256/bundleManifestSha256/intentSha256 | 改变 | 与本次封存材料及现役安装记录一致 |
| schema adapter | 新包已包含158 | 双steps、kind和ai-0088-0089 recipe路径均存在 |

只读 `--control-status` 返回本次adopted/installId。其本身只读状态；完整成员与材料绑定另行核验，且后续真实shim执行成功证明新包确已加载。

## 新shim检查与制品

固定入口始终为 `D:/codex-isolated/main-manual-release-20261016/control/tools/publish-latest-main.mjs`，配置使用无后缀 `main-publisher-config.json`。

`--check` exit0：目标ece8c7ec、现役来源ba78ceff、`scope=database-migration`、components为worker/django、`migrate=true`，schema为AiTaskFeedbackCandidates 156→158，不再报缺少结构发布包。此时的request-frozen/preparation-not-ready不算应用包就绪。

随后 `--prepare-only` exit0，队列请求 `5daa0449-68f1-410f-ae56-743256551342`、dispatch `47cc3465-411b-487d-8ed8-45e281a7d43e` 返回prepared、原生prepared-only，`publicationPerformed=false`。

| 制品绑定 | 值 |
| --- | --- |
| 包目录 | `D:/codex-isolated/main-release-packages/ece8c7ec46ac-7094807e-2c9a9ad3` |
| 冻结来源 | 上述包内 `source`，HEAD=ece8c7ec |
| Git tree | `cd27517414ddcef1e441f9e2504e7b45a1fe83fa` |
| 原生PREPARED | `publish-ece8c7ec46ac/preparation/PREPARED.json` |
| PREPARED SHA256 | `3a8684e5c63129335c6d7f770b888db27533ecfd2e45bef2fb2aaeea2c138020` |
| Worker候选 | `20261104T135815Z-28278a3e8f6ac4fb` |
| Worker manifest | `1ccf5583bb1b52200dc075cee546331eb2df61cd29d454abd70b7a8d383c0a74` |
| Worker plan | `0014aeaf306977063f29d29bd0810bb85fd148824f85b01050d9ea56af0b91b0` |
| Django prepared ID | `b46a7bb33d0c46b191277c19770ce38f` |
| Django prepared receipt | `3b175c238b476411f286c6bb228f09c6cd04aca042ff6a5417a7aa338814d3e9` |
| Django manifest | `04a31bc0a281df1360ffc7675d7b98194388417bf117672310520e0fe8099fd7` |

前端原生构建652秒，后台PrepareApp 151秒。原生PREPARED于UTC `2026-11-04T14:11:43.564Z`生成，均为原操作日志时间，不是停机窗口或用户总等待测量。

## 冻结树复测与暂停续接

从**实际包内source**执行，显式清理业务连接环境，保留Windows必需变量；日志和结果输出到包外。每个子命令检查真实退出码，并再核框架用例数/结果文件；运行前后核105项代码原始字节及冻结树Git状态，不以verified或JSON字段代替运行结果。

首轮PS5真实exit1：临时测试驱动遗漏PATHEXT，使 `Get-Command git`失败。只读before/after探针证实无PATHEXT exit1、有PATHEXT exit0。仅修包外驱动环境，冻结源码未改；原失败日志和RESULT保留。

第二轮完成下列测试后用户要求暂停；停止的仅为私有测试执行器，应用未被停止。PS7虽然写出33项通过的JSON，但暂停时未捕获其原生退出码，因此恢复后重新执行PS7，未把旧JSON直接当成功。

恢复前重新验证：控制采用身份/38成员、实际host/node、PREPARED SHA、105项codeSha、冻结HEAD及Git状态均未变化。复用已经捕获exit0的同输入测试，不重复采用/打包。第二轮已完成结果与本次补测共同构成本包复测，暂停不回写旧失败或旧记录。

| 测试 | 来源与结果 |
| --- | --- |
| Node定向测试 | 第二轮实际冻结树149项，exit0、fail0、skip0 |
| 控制/范围/就绪入口 | 第二轮实际冻结树78项，exit0、fail0、skip0 |
| A层文件gate | 第二轮10项，exit0 |
| 静态recipe绑定器 | 第二轮30项，exit0 |
| OWNER基线 | 第二轮6项，exit0 |
| 无数据库ACL/guard契约 | 第二轮48项，exit0 |
| PS5真参数/类型边界 | 第二轮33项，捕获exit0 |
| PS7真参数/类型边界 | 恢复后33项，捕获exit0 |
| B层独立PG17 | 恢复后824反例通过，exit0；私有PG、密码及数据目录清理成功 |
| 运行guard突变 | 恢复后60/60 guard被检测到，runner exit0，逐项有明确断言失败 |
| 最终schema静态绑定 | 恢复后exit0，105项源码与recipe/checks/execution一致 |

B使用冻结脚本的真实实现，只把 `RESULT_FOLDER` 指向包外；数据和合成凭据仍由原脚本在私有忽略目录创建。没有放宽生产runtime/身份硬编码，没有连接生产库。A层154以下父证明为合成接缝、完整原生冷启动及AI业务效果不在本次验证结论内。

## 证据与交付边界

完整原始材料、stdout/stderr和独立阶段结果留在本机 `D:/codex-artifacts/ai158-control-adoption-20261104/`；本目录保存脱敏后的关键回执、核验表与摘要索引，不提交机器任务完整定义、SID或编码环境。准备目录原始材料不删，旧控制包、历史绑定、currentInstaller/previousCurrentInstaller均未修改。

本报告与证据仅在独立文档分支交付，不合并main，也不再生成应用制品。本次最终状态为控制已采用、制品已准备、冻结树复测通过，详见[DELIVERY](DELIVERY.json)与[冻结测试汇总](FROZEN-TEST-SUMMARY.json)。历史PAUSED快照保留，包外CURRENT-STATE已更新为完成。未来上线仍须另有明确授权并通过原生动态门禁。
