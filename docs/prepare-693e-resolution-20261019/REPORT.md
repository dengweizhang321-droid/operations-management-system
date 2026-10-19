# 原 prepare 693e 的有限终止

本次仅处理阻断后续 main 准备的历史 dispatch `693e15d4-3390-49b1-9b7c-48fa4f737d48`，不重放旧准备，不执行应用发布或服务操作。原 ticket 为 `863e1fac-fe1c-4136-986e-c26ef30e4a7f`，目标为 `c36ea9964ea0e57b73f0173b27d6991b4d5e19a7`；原 ticket、dispatch、unknown result 和已 blocked 的后续 ticket 保持原件。

旧操作已经进入 native。packet 中保留 PREPARING 和 source-binding，没有 PREPARED；Worker 候选已移动到 `D:/teruisi-runtime/teruisi-worker-sales/releases/20261019T005631Z-9641179b90868db0`，manifest SHA 为 `9dfe7ac04b0431d8092efc8fdde46962063f023190590d609b95273dfd010853`。因此采用 `abandoned-after-native-start` / `quiescent-no-publication`，明确 `nativePreparationStarted:true`、`partialArtifactsRetained:true`、`prepared:false`、`publicationPerformed:false`、`retryOriginal:false`。它不声称 native 零效果、候选可发布或旧失败变成成功。

## 实现与边界

`tools/main-prebuild-queue.mjs` 追加固定 693e reader/operator。原 e2/ece/0b 三段保持原字节；原 drain 的 unresolved 判定增加此唯一 reader，在选目标后、DISPATCH 前增加固定旧目标禁止重放断言。有效 resolution 只终止此历史依赖。新目标继续使用原普通身份准入、持久 ticket、原 DISPATCH、代际检查与 native 准备；原 blocked 不自动重开。

writer 只接受新的私有 `--out`，固定原 state、packet、dispatch/ticket/target 和原始 SHA；先核当前同用户普通身份，再按 queue → native rotation 顺序持原锁。它要求已 adopted 的新控制 bundle 与自身干净冻结 source commit/tree/工具字节一致、原配置与 Limited preparation task 不变。两次独立观察分别绑定 nonce、phase、同一个 writer epoch、库存摘要、归档目录和精确 observer 代码；普通 writer 再核新鲜完整进程投影、原 PID 创建身份及后代，确认无迟到 native actor。高权限 observer 仅作只读见证，不执行控制。

collector 固定读取以下范围，任何物理路径重定向、无法读取、格式未知或集合变化均拒绝：

- 原候选 release 全部文件的相对路径、长度与内容 SHA；候选全目录前后成员一致。仅 manifest 中精确两条 `.dev.vars` 叶可保留原受管硬链接，必须匹配固定主仓库目标的 dev/ino/size；不保存密钥字节。
- Worker `releases` 全部 manifest，排除另一个与原 packet/sourceBinding/source fingerprint 关联的候选。
- Worker state 六域 `release-batches`、`worker-prepared-builds`、`worker-release-publication-staging`、`worker-release-rotation-consumptions`、`worker-release-rotation-plans`、`worker-release-successors` 的所有递归 JSON 和原 SHA sidecar，以及 current-deployment；按原 dispatch/ticket、candidate、manifest、sourceRoot/sourceBinding/fingerprint、规范化 packet 路径逐内容匹配。有匹配即拒绝。
- Django 所有原 `app.prepare-*`、`app.deploy-*/deployment.json` 和当前 `app/deployment.json`。原固定 `publish-prepared-main.mjs`、rotation、worker 完整字节及调用顺序证明：原 awaited Worker plan 完成并写 worker-plan.json 之后才进入 PrepareApp。无原计划且完整执行闭包消失时，该原 await 不会迟到进入 Django。未借用其他发布的审计当作本次完成。
- 原 packet 仅允许原 PREPARING/source-binding，invocations 必须仍为空；原 `.staging/deploy-2bad88cd-83fb-4530-a445-fb5e2644bf16` 全部残留内容也进入库存。保留全部部分产物，不执行清理或重命名。
- 原 `resolveEffectiveReleaseChain({verifyInstalledHead:true})` 的原 head、chain state 和固定 Django 前驱 SHA。

文件读取、目录枚举和最终目录成员复核在每个固定域内最多 16 并发，仍逐文件核 realpath、前后实体身份和完整内容。没有持久缓存、跨进程复用或省略文件。每个候选、staging 和 state 域输出枚举/读取/成员复核耗时及文件/目录数，head/fence 路径单独计时。

### 静态完整性与动态新鲜度

首版 `9c37062f` 的真实只读 collector 16 并发文件读取样本为 **123.968 秒**；该版目录阶段仍串行，且 writer/observer 内部重复全树读取，使两次 observation 都须在最终写入前 60 秒内的旧写法无法使用。该版未实际采用，不能把隔离测试通过当现场时效通过。原始样本在 `D:/codex-artifacts/workflow-wait-diagnosis-20261019/deployment/initial-native-state-concurrent.json`；首轮逐叶串行 probe 在 347.857 秒仍未完成，仅精确停止自建只读 probe，证据原件保留。

修订采用固定 v2 证据协议，双锁从开始到 append 连续持有，单个 writer epoch 总期限为 20 分钟。实际顺序固定为：S0 完整库存一次及归档 → 初轮独立观察和普通 ACK → S1 完整库存一次且与 S0 全等 → 最终独立观察 → 普通身份/代际/固定原件复核 → 末轮普通 fresh CIM 交叉 → 小型 ACK、证据追加及 create-only resolution。两轮完整库存的 canonical 记录及所有状态对象均归档；每次请求必须晚于它引用的库存完成。observer 独立验证固定原件、当前链身份/guard 入口/fence、归档对象 SHA、S0/S1 相等、任务和完整进程身份，不再重读全部未采用候选载荷。

60 秒没有放宽：每轮独立动态采样的**最早开始**到对应普通 ACK 必须小于 60 秒，最终独立采样和末轮普通 CIM 到 resolution append 也都必须小于 60 秒。静态库存和初轮观察可以早于最终 60 秒，但必须在同 epoch/双锁/固定 writer/不同 nonce 内，且 S0=S1；整体期限或任一动态窗口超时均不写 resolution。所有可能耗时的源码/原件/归档检查都在最后 fresh CIM 前完成，之后不再调用完整 collector。实际两轮 full 的耗时由正式 writer 原输出记录，不追加 standalone 全量 probe。

resolution 以 create-only 原子语义追加，内容寻址归档保存原输入、安装绑定、所有 reader/operator 依赖、两次观察及 native 状态 JSON。历史 reader 重核原队列 SHA、全部依赖 SHA、两次观察的 nonce/时序/actor claims、相同完整库存和无候选发布关联。它不要求永久保留旧 source worktree，也不把后来的控制升级或其他合法发布追溯为原 693e 的作用。

## 验证与采用状态

定向测试包含真实有限 writer 的两次观察/归档、历史 reader、原 unknown 原件、后续新目标一次派发、禁止旧目标重放、其他 unknown 阻断、旧三段字节保持、输入逐字节漂移、过期/nonce/身份/任务状态/库存变化，以及 Windows JSON 路径、失去原父进程的 npm/Vinext 后代和无关 n8n 边界。fixture 仅保存原发布元数据与工具代码，不保存 `.dev.vars` 或业务数据。

`verify-release-candidate.mjs` 增加有限 profile：逆投影必须证明只有追加固定 693e 段及两个明确 queue 接缝；运行相应定向测试与私有十文件控制包导入。私有采用测试虽不运行 npm 或应用 builder，顶层仍经 release-batch/release-impact 导入 TypeScript，因此保留原显式 dependencies 合同并完整绑定实际依赖；曾尝试省略依赖的 `compat-dd584f41` 中 37 项通过、私有包因真实缺 TypeScript 失败，原回执保留，不能称未消费依赖或据此跳过验证。不以此资格豁免发布/生命周期源码的其他修改，也不重建未变应用包。

真实 collector、ordinary writer、控制安装采用和新目标准备由发布负责人按[操作说明](OPERATOR.md)串行执行。本实现交接时没有调用生产 writer、安装控制、提交新准备或执行应用切换；现场真实观察和采用结果须另附原始证据，不用隔离测试冒充。
