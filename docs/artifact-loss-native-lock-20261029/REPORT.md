# 制品损失核销的原生锁适配修复

本次只在 `D:/codex-worktrees/artifact-loss-native-lock-20261029` 开发，分支 `codex/artifact-loss-native-lock-20261029`，起点 `aec1ae888385913ecb5b63a271bbdf6d76036b82`。没有采用新控制包、执行真实核销、准备应用制品或改动生产队列。

候选已完成：协议全套 **171/171，0失败、0跳过**；CI白名单 **66/66**；完整ESLint **56 errors /132 warnings**；后端边界 **violations: []**。独立复审通过，见 [REVIEW.md](REVIEW.md)。六个冻结源码/测试的摘要见 [CODE-FREEZE.json](CODE-FREEZE.json)。

## 根因与设计选择

上轮新增适配器错误地假定 `config.nativeToolsSource` 与开发仓库导出相同。仓库的轮转工具有 `acquirePreparationRotationLock`，实际固定 D08 原生工具没有；实际导出为单参 `withRotationLock(operation)`，内部固定轮转管道。此前协议测试注入 acquire/release 假锁，没有执行这段实际接线，所以161项通过未能证明实际适配可用。

选择路线 a：writer 接受回调式 `withRotationLock(operation)`，全部读取、核销追加、最终校验和返回均在回调内完成。调用方直接使用固定原生版本的单参签名，不传 pipe、不添加原生导出，也不桥接成悬挂 promise 的 acquire/release 对。

锁序仍为 queue → submission → native rotation。writer 使用 `return await withRotationLock(...)`，因此外层 finally 不会提前释放队列/提交锁；原生工具自身的 finally 删除 lease 并释放 rotation，随后外层嵌套 finally 释放 submission 和 queue。导入失败、原生锁忙、回调抛错都沿这些释放路径退出。回调内的代际/退役检查只读，不再申请相同轮转锁。

## 基线与保护

只读确认当前控制包为 `a61da76ba222dc0adf94901948a8f442fac2db8f6724165e223cc84effabe701`，installId `447e97c5-f5ad-471c-a91f-b62e5715a6ac`；新开发树开始时所有控制叶均与它逐字节一致，没有退回804a或上轮未合并状态。配置摘要仍为 `a461db4d0d57175d712c01d7707cc36c38b8f1d43e0ee5c1d4a5f482ca5ac9c8`。

`package.json`、`tools/worker-local-release-rotation.mjs`、`tools/publish-prepared-main.mjs`、`tools/worker-local-release.mjs` 和既有损失清单均禁止修改，基线摘要见 [BASELINE.json](BASELINE.json)。原生验证快照只读复制以下实际固定闭包到本树 `.runtime/pinned-native`；测试不以仓库新版替代它：

| 文件 | 固定原生 SHA-256 |
| --- | --- |
| worker-local-release-rotation.mjs | 778c136602cf1ebb44fd2fbed1ee67a3cf24fbd78a2cc52b8541db5be114b556 |
| worker-local-release.mjs | aa1be03ebde6fc5b5f9a50fc986a12756ba8eda69e0549ef111f23d5b9439bd2 |
| d1-retirement-proof.mjs | 87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76 |

## 文件范围

- `tools/prepared-artifact-loss.mjs`：改成回调锁接口，保留所有既有清单、原记录、完整组、文件校验和核销语义。
- `tools/publish-latest-main.mjs`：CLI 损失分支调用共享 `retireLostMainArtifacts`；该 handler 真正导入 `config.nativeToolsSource` 并调用 `rotation.withRotationLock(operation)`，检查导出存在。
- `tools/preparation-retirement-entry.mjs`：更新新 publisher 精确摘要，保留已采用前代资格；不放宽通配。
- 原 `tests/prepared-artifact-loss.test.mjs`：适配回调接口，保留原20项语义断言。
- 新原生适配 suite/私有子进程 driver：执行真实 D08 适配与原生锁，只重定向底层管道传输；包含旧错误调用的失败反例。

## 同分支原生调用核查

逐项导出名、真实签名、调用形态与验证范围见 [NATIVE-CALL-AUDIT.md](NATIVE-CALL-AUDIT.md)。新测试真实执行与其他只做静态核对的部分明确区分，没有把导出存在冒称生产函数执行通过。

| 调用位置 | 核查结果与边界 |
| --- | --- |
| 损失分支锁适配 | 原错误 acquire 导出不存在；改为 D08 真实单参 withRotationLock。 |
| 退役 scope/admission → R1b seal reader → loadRetirementNativeTools | 固定三文件摘要与 D08 副本一致。使用的源绑定校验、文件摘要、Windows 路径摘要、树算法/根常量及 resolveEffectiveReleaseChain/djangoRoot 均有相应导出；只读 seal 检查不申请 rotation 锁。 |
| assertControlGeneration / readAdoptedControl / controlExecution | 使用 bundle 内模块，未发现第二处把仓库新版 native 导出当成固定旧版导出的调用。 |
| assertOrdinaryPreparationContext | 保留系统 PS5 绝对路径和固定 publisherEnvironment 的普通权限探针，不改身份门禁；本次不冒称 handler 的隔离 admit 等价于完整生产 CLI 身份场景验收。 |

真实 CLI 在到达核销分支前原本会写 `control-executions` 审计。因此用户本次失败的“零写入”应准确理解为未进入核销/队列追加；不能据此宣称整个 CLI 对所有目录都完全只读。本轮没有运行该生产 CLI。

## 采用与清单

修复必须重新准备并采用新控制包：publisher 和 writer 属于 bundle 按哈希绑定的控制代码，不能热改已采用 a61 文件。R1b 的精确 publisher pin 同步更新，原生工具和配置不变。

新采用材料必须继续携带并绑定**同一份原始清单**：`e44dac82794da312e3cbaade260b853806e9e9f067eee86197e6b4789a7e32ab`。现有安装器在不提供新清单参数时自动继承已采用清单，并将相同摘要写入新 bundle MANIFEST 与 INTENT；显式提供清单也必须是同字节，不重新生成映射、不改变清单、不清除旧绑定。

本轮没有生成真实采用材料或执行采用。仍须先由用户审核候选，再分别授权后续动作；旧包和历史原生/安装器直达不受新控制入口保证的既有范围限制不变。

## 验证

| 检查 | 实际结果 | 原始证据 |
| --- | --- | --- |
| 原15文件协议全套＋真实适配器新suite，共16文件 | exit0，171/171，0失败、0跳过；原161项保留，新增10项 | [PROTOCOL-FINAL.tap](PROTOCOL-FINAL.tap) |
| 真实D08适配器9种执行模式 | 生产管道转发全部0，原记录/pending不变，三个锁全部可重获 | [NATIVE-ADAPTER-RESULTS.json](NATIVE-ADAPTER-RESULTS.json) |
| CI白名单，--test-timeout=30000 | exit0，66/66 | [ci-allowlist.log](ci-allowlist.log) |
| npx eslint . --ignore-pattern ".claude/**"，完整扫描 | exit1，56 errors/132 warnings；只规范化诊断消息内的开发树根路径后，56条错误指纹与先前基线完全一致 | [ESLINT-RESULT.json](ESLINT-RESULT.json) |
| npm run check:backend-boundary | exit0，violations: [] | [backend-boundary.log](backend-boundary.log) |

Node为v24.18.0，npm为11.16.0。开发树独立 `npm ci --ignore-scripts --no-audit --no-fund` 后，仅对本树依赖运行仓库原有XLSX精确补丁；未修改package/package-lock。完整ESLint原始JSON位于本树 `.runtime/native-lock-tests/eslint-final.json`，摘要在ESLINT-RESULT中。

本轮代码对应的新测试没有替换锁函数或整个适配器：专用子进程导入三份真实D08原字节，执行CLI分支共用handler，仅将精确管道监听地址映射到私有管道；未知传输地址拒绝。外层 generation/admit 使用私有夹具回调，故不宣称已经运行完整生产CLI身份场景，也没有调用真实生产队列。既有八份历史兼容测试从上一轮私有副本复制到本开发树，原断言保留，无生产reader调用。

检查后六个冻结源码/测试无变化；四禁改文件、e44清单、实际D08三文件、生产控制状态/配置/INTENT/manifest等五个锚点均保持原字节；292份队列记录名称及字节未变，两核销目录仍不存在，见 [PRESERVATION-CHECK.json](PRESERVATION-CHECK.json)。
