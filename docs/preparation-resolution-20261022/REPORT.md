# 准备队列通用收敛与退出维护门禁候选

状态：仅候选，未合并、未推送、未升级生产 bundle、未执行生产收敛或发布。A/B/C 必须作为同一采用面交付；本轮只在 `codex/a1-prep-queue-20261022`、`D:\codex-worktrees\a1` 做本地提交。

**e786 仍为 unknown，需由后续任务收敛。** [只读原件观察](evidence/SOURCE-OBSERVATIONS.json)记录原 dispatch/result 摘要与 resolution 不存在的事实；本任务没有为 e786 生成证据目录或 resolution。

## 基线与范围

指定 worktree/分支在开始时不存在，使用本机已缓存的 `origin/main=f641685b60ca11a674da713e3b7b454f338c622c` 创建，未 fetch/pull/push/merge，也未更新远端基线。实现以该 worktree 实际源码为准。

只修改发布/准备工具、对应测试与本任务文档。Worker/Django 业务、数据库、migration、600 秒预算、AutoStartDingTalk、发布回执 schema 与 release-scope-plan 分类器均保持原样。最终源码与输出摘要见 [VALIDATION.json](evidence/VALIDATION.json)，独立结论见 [REVIEW.md](REVIEW.md)。

## A：单一 reader 与历史兼容

- `main-prebuild-queue.mjs` 不再包含事故 fixed reader/writer 或 `--native-391-*` 模式；队列统一调用 `preparation-resolution.mjs` 的 reader。同一库存轮内复用已核验结果，不为防重再扫描一遍完整历史证据。
- 新协议读取 `resolutions/<dispatchId>.json` 与 `<dispatchId>-evidence/objects/`。resolution 与协议对象必须为 canonical JSON；原始请求/源码/清单等外来对象按原始字节归档，不重写成另一种 JSON。
- dispatchId、完整 dispatch SHA、赢家 requestId、selectedTarget 与原 terminal SHA 逐字绑定。仅接受 `decision=failed-cleaned-before-plan`、`terminationBasis=confirmed-tree-cleanup-before-plan`；nativePreparationStarted/candidateArtifactsAbsent 必须为 true，prepared/publicationPerformed/retryOriginal 必须为 false。
- 校验原失败的类型化 direct-exit/tree-cleanup 凭据、实际构建前端阶段、冻结源码 HEAD/tree/clean、已审三文件 producer 字节闭包、完整候选元数据普查和两次一致静态快照。PID、耗时和失败文案不再是新协议的事故常量。
- 保留普通 writer 的 SID/session/medium token 与精确进程身份；两个独立 elevated observer、不同 nonce、20 分钟同锁 epoch、最终 60 秒动态窗口、普通权限交叉 census/ACK、空闲计划任务、完整采用 intent/transition/配置/工具闭包继续绑定。低权限不可见字段只允许从同 PID/创建时间/父进程/名称的完整高权限 witness 核对，新增 opaque 进程拒绝。
- 遍历 evidence 内全部对象，逐项重算 SHA，包括未被协议直接引用的对象；目录重定向、链接、部分/额外文件、绑定漂移与原件变化失败关闭。永不改写 terminal。
- 8 条历史记录在替换前均由原 reader 只读接受，随后封为 `preparation-resolution-history.mjs` 的不可扩展兼容数据：resolution/dispatch/terminal 原始摘要与完整 evidence 树摘要必须同时相等；所有 objects 的文件名摘要也要复验。新 dispatch 无需添加此表。原有 5 个 target 禁止重放策略和 3 个 pre-native 请求终结策略分别保留。
- 原事故实现及 observer/writer 只在 `tests/fixtures/legacy-preparation/` 保留为原字节测试材料，不进入控制包。其余旧有限 CLI 明确拒绝并指向通用 CLI，避免悬空 import 或再造事故入口。

## B：冻结包通用 CLI

`install-main-prebuild.mjs` 将通用模块、兼容数据、producer qualification、writer/observer 纳入同一个控制包 manifest。原有冻结包材料构造器用于私有构建检查；本轮不采用构建出的控制包。

从已采用的精确冻结 bundle 中运行：

```text
node <bundle>/tools/cleaned-preparation-writer.mjs --help
node <bundle>/tools/cleaned-preparation-writer.mjs --config <绝对配置路径> --inventory
node <bundle>/tools/cleaned-preparation-writer.mjs --config <绝对配置路径> --dispatch <完整UUID> --out D:/codex-artifacts/<新的私有目录>
```

普查只读；写入只允许原普通交互用户，持原队列锁和 rotation 锁。writer 完成静态取证后输出每次 observer 的精确可执行文件和 argv（含 request、SHA、out）。observer 必须从同一个已采用 bundle，在现有独立高权限交互终端中直接执行，只读普查并写请求绑定的 witness；不自动提权、不泛化豁免运输父进程。若使用持存 `powershell -Command node ...` 运输父进程，会按其他 controller 拒绝。

最后只以 create-only 方式追加一次 resolution，输出 resolution SHA、完整 evidence 树摘要和原 terminal 摘要。同一 dispatch 再次执行只返回 already-resolved；既有文件损坏或中断留下 evidence 目录时明确拒绝，不覆盖、不删目录、不借新 ID 重做。

有限准入仍有明确边界：没有原 winner unknown result、未知 producer 代码代际、非构建前端 direct-exit 清理、残留候选、非空 staging、原失败 PID 仍出现或见证不完整，都保持未知。staging 非空及 PID 复用采用保守拒绝，需要后续独立证据协议；此 CLI 不是任意 unknown 的自动成功器。

## C：退出维护改读版本事实

唯一原路径已由实际源码定位：`End-SystemMaintenance → Assert-DeployedApplication → Assert-ApplicationTreeManifest → Assert-WranglerRuntimeCli → Invoke-WranglerRuntimeProcess --version / 15s`。原生失败文件及 stderr 的原始摘要保留在只读观察索引。

`Assert-ApplicationTreeManifest` 仍先完整核验安装树指纹/文件数与启动脚本，随后改调用 `Assert-WranglerRuntimeFacts`：比较安装的 `wrangler/package.json`、依赖 manifest rootVersion 和唯一根包记录；拒绝非对象、数组字段、版本错配和重复根包。停门前不再启动 `--version` 或 CLI help 子进程。

真正 CLI version/help 与 local R2 roundtrip 仍在原 Prepare-Application staging 自检中执行，没有删除。PS AST 差异证明原函数仅修改 `Assert-ApplicationTreeManifest`、`Assert-WranglerRuntimeCli`，新增一个 facts helper；End/Begin maintenance、CompleteDrain、service mutex、PG/backup fence 等 6 个关键函数原字节不变，Worker 维护入口也未改。

## 定向验证与证据

汇总入口：`node docs/preparation-resolution-20261022/verify-candidate.mjs`。只执行工具语法、源码边界、私有冻结控制包构建及定向 Node/PS 夹具，不运行服务启停、迁移、业务验收或生产部署。不需要应用前端重新构建。

最终结果为 passed：定向 Node **246/246**、不采用控制面的原构造器材料构建 **1/1**、PS5.1/PS7.6.6 夹具均通过、22 个工具语法检查通过，绑定 53 个源码/夹具文件并核对执行前后 SHA 一致。控制包为 15 个成员；代码边界检查通过。覆盖：合法接受、逐字段绑定/枚举/事实/epoch 拒绝、重复写入、全对象篡改、nonce、进程见证、所有旧候选标识、staging/额外 failure 文件、8 条历史实读、原结果不变、队列继续与原 target 防重、冻结包 help、材料构建及 PS5/PS7 门禁前后差异。原始记录见 [VALIDATION.json](evidence/VALIDATION.json)。

初次扩展回归误选了会创建临时计划任务及采用私有控制面的旧用例，均由原夹具清理，未采用到生产控制面。该轮失败输出保留在 `evidence/initial-failures/`；第二轮旧测试接缝失败保留在 `evidence/second-failures/`，没有将其改写为通过。最终命令排除该真实任务用例，仅选择“不采用控制面”的材料构建用例。两处过期历史测试仅修正原进程创建时间和 census 摘要联动，不修改旧实现或证据。

依赖只通过本 worktree 的忽略项 `node_modules` junction 只读复用本机已有依赖；未安装 npm 包。历史实读回归依赖本机封存 evidence 仍在原路径；复制到其他机器时须一并提供原封存材料，不能把缺档当成成功。未执行完整应用构建或完整原生冷启动，不宣称生产可直接采用；本候选的工具材料构建与边界检查见最终机器报告。

## 后续采用

本地候选提交包含 A/B/C、测试、REPORT/REVIEW/证据索引。合并、对应 bundle 升级、生产收敛、任何发布/启停/迁移均等待用户新的明确指令。不得因现有队列仍 blocked 临时造桥、补写 prepared/completed 或绕开 unknown。
