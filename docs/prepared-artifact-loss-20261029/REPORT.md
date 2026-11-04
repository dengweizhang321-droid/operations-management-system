# Prepared 制品丢失协议修复（已完成候选，待用户审核）

本任务仅开发与隔离验证。没有采用控制包，没有执行真实损失核销，没有改写生产队列，没有应用制品准备、发布、服务操作或 origin/main 推送。实施授权来源是用户 2026-10-29 对方案 b 的明确指令；后续采用与核销须另行授权。

最终结果：隔离协议 **161/161，0 失败、0 跳过**；CI 白名单 **66/66，0 失败**；完整 ESLint **56 errors / 132 warnings**，56 条错误的文件、位置、规则和消息均与承接基线一致；后端边界 **violations: []**。独立代码审查通过。源码与测试冻结摘要见 [CODE-FREEZE.json](CODE-FREEZE.json)，交付过程中 58 项冻结文件无字节漂移。

文件级说明见 [FILE-CHANGES.md](FILE-CHANGES.md)；防滥用表逐项实际证据见 [PROTOCOL-CHECKS.md](PROTOCOL-CHECKS.md)；独立审查见 [REVIEW.md](REVIEW.md)。

## 基线与承接

开发树：`D:/codex-worktrees/prepared-artifact-loss-20261029`；分支：`codex/prepared-artifact-loss-20261029`。Git 起点为远端 main `1164aed2e197d90ac9d06d5a69121b3cbc1ca318`，但是控制实现基线明确来自已采用的 `D:/codex-isolated/main-manual-release-20261016/control-bundles/804a1331b88adcbeca9542bfcc7f1b8ec0f56e892dfd301154363d8b79177b02/`。

逐字节承接该 bundle MANIFEST 的 34 个控制文件，并从 manifest 指定源码提交 `1456b9ef2abb6bc3301aa0850fd100e98db1b303` 取得对应安装器与相关协议测试。复制前逐项验证 SHA-256；原 manifest 见 [ADOPTED-MANIFEST.json](ADOPTED-MANIFEST.json)，完整文件来源和受保护文件基线见 [BASELINE.json](BASELINE.json)。没有从 main 的旧 214 行 queue 实现开始修补。

必须保留的已采用能力包括 S05d 准备失败与 unknown abandonment、publication-retired、退休 packet 及 `-rN` 选包、manual-only 触发、单次 abandon-only 核销、旧 preparation resolution 与 R1b 退役保护。新增机制保留原结果，并另记当前制品不可用；不把制品丢失解释为原准备失败、未执行或过去没有发布作用。

最终 34 个控制叶中，28 个保持已采用原字节，6 个包含本次增量或保留的主线兼容内容；对应安装器独立承接并扩展，另新增损失协议模块。逐文件 SHA 与 Git 原对象重现检查见 [DELIVERY-SUMMARY.json](DELIVERY-SUMMARY.json)。主线已有的 apply timing 导出及完整测试、154 代 schema 声明和三代 producer 资格均保留；producer 资格为已采用三组与主线三组的精确并集五组，没有通配或新造资格。

## 供用户逐行核对的清单

- [MISSING-PREPARED.json](MISSING-PREPARED.json)：35 条 prepared dispatch 平表，含用户要求的 dispatchId、requestId、selectedTarget、原 packet 字符串和 preparationSha256，另含原文件绑定摘要。
- [MISSING-PREPARED.md](MISSING-PREPARED.md)：上述五列的人类可读表。
- [artifact-loss-manifest.json](artifact-loss-manifest.json)：拟绑定采用材料的 canonical 清单；这不是已采用材料或核销记录。
- [LOSS-INVENTORY.json](LOSS-INVENTORY.json)：完整只读统计、分组、排除范围、pending 与队列原字节摘要。
- [collect-loss-inventory.py](collect-loss-inventory.py)：只读采集器；输出目录不得在生产状态根下。采集结束重复读取已枚举记录核对摘要，未写生产文件。

统计与用户的独立统计一致：缺失包关联 dispatch 53 条，其中 prepared 35、unknown 14、non-production 4；存活 prepared 3 条；缺失回执与包各 26 个。核销候选 35 条 dispatch 各有一张 prepared ticket，共 35 张。26 包中，7 包各关联两条 dispatch，1 包关联三条，其余各一条；全部关联项整组纳入。

独立审查已核对清单 canonical 字节、原 ticket/dispatch/result SHA 和完整覆盖关系：没有纳入 unknown、non-production、存活包或 pending。两存活包 `1b02c93791bb-d349107e-99df9f68`、`18c25a3a153e-4a9cb3f5-b05895d2` 不属于核销候选。

清单 SHA-256：`e44dac82794da312e3cbaade260b853806e9e9f067eee86197e6b4789a7e32ab`。26 个同包组的 selection 均一致，证据见 [SELECTION-CONSISTENCY.json](SELECTION-CONSISTENCY.json)。这份清单尚未绑定真实新控制包，也未写入任何生产损失旁记录。

## 实现行为

`readPreparationQueueStructure()` 仅验证 canonical JSON、schema 及 ticket→dispatch→result 绑定。正常 inventory 在结构层之后验证损失清单与旁记录，再验证外部原生文件。原 prepared 结果不改写；新增退休集合控制当前可消费性。

清单在控制材料中保存为 `PREPARED-ARTIFACT-LOSS.json`；摘要同时绑定 bundle MANIFEST 与 INTENT，沿现有安装状态摘要链校验。后继新安装器默认继承，拒绝替换或遗漏清单与协议能力。缺旁记录、缺整批完成结果、绑定变化或降级均继续阻断正常消费。

独立 `--retire-lost-artifacts` 模式在旧 reconciliation/drain 之前直接进入新 writer，持 queue→submission→rotation 三锁，仅 create-only 追加 `artifact-losses/<packet键摘要>.json` 与 `artifact-loss-results/<清单摘要>.json` 后返回；不 fetch、不冻结源码、不准备、不调用 Task 注册或唤醒。已有 pending 可以保留，不使用旧 abandon-only 的 pending=0 条件。

只有父目录路径完整可信且精确 packet 整体 ENOENT 才具有本次资格。包存在、部分残缺、EACCES、重定向、错误文件类型/硬链接或绑定错误均拒绝。包重现后恢复原生回执 SHA 和请求绑定检查；即使完整正确也保持退休。旧包不能进入 completed 复用，固定准备/检查/发布入口不能消费，同目标后续只能沿原规则选新 `-rN`。

## 保证范围和不覆盖事项

新禁用状态约束已采用的固定准备、检查、发布入口。`package.json`、`tools/worker-local-release-rotation.mjs`、`tools/publish-prepared-main.mjs`、`tools/worker-local-release.mjs` 均不得修改，交付须以逐字节摘要核实。

三份字节锁定的原生脚本不会读取新旁记录。因此绕开固定入口、手工直接调用这些旧原生脚本，不受新禁用状态约束；不能宣称本候选实现了全机器任意入口的永久禁用。原生脚本已有的制品完整性与生产准入检查继续存在。

同样，新安装器及新固定控制读取器会强制继承协议，但历史安装器源码不认识新旁记录。手工直接运行历史安装器绕开新受控路径，不在新协议的防降级保证内；本候选没有改写历史安装器或操作系统权限来封禁任意旧代码。

核销 writer 本身只验证结构、清单和目标损失包，不替清单外存活包做原生制品验收；那些包的字节错误仍由正常 inventory/消费/发布准入拒绝。EACCES 的隔离证明采用窄 lstat 故障注入，不是生产 ACL 演练。完整追加后的中断可按同一清单对账；半写或非 canonical 记录继续失败关闭，不提供覆盖修复。

本机制不能恢复丢失的 PREPARED.json，不能重新证明其中的执行期内容，也不能解除其他 unknown 或未知发布作用。原 prepared 历史、原 results/dispatches 字节与原有恢复门禁保持。后续新准备仍须取得相应授权，通过原协议冻结新目标和前驱，使用合法新 packet。

两张旧票 `7e120033-5d96-4172-84a7-bf37872daef6`、`e7c042e7-54f7-455a-8312-576baa0e7b2f` 本轮不处理。新核销入口允许它们保留但不消费；未来控制升级后，正常消费者沿既有代际拒绝规则追加 `incompatible-generation-before-dispatch-v1` blocked 结果，不能跨代自动续跑。

## 隔离环境准备与已执行门禁

开发树使用自己的 node_modules；执行 `npm ci --ignore-scripts --no-audit --no-fund`，没有关联生产依赖目录。CI 首轮为 63/66，三个失败均来自新依赖尚无仓库已有的 XLSX 0.18.5 精确补丁；运行本树原 `tools/install-xlsx-prototype-patch.mjs` 后，按同一白名单及 30000ms 超时复跑为 66/66、0 失败。未修改补丁源码或 package.json。原失败输出 [ci-allowlist.log](ci-allowlist.log) 保留；依赖准备记录见 [xlsx-dependency-preparation.log](xlsx-dependency-preparation.log)，成功结果见 [ci-allowlist-final.log](ci-allowlist-final.log)。

冻结源码后的实际结果如下；Node 为 v24.18.0，npm 为 11.16.0，Windows 本机隔离目录执行，不冒称 GitHub Ubuntu/Node22 环境的运行结果。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 15 个相关协议测试文件 | exit 0；161/161，0 fail，0 skipped | [QUEUE-PROTOCOL-FINAL.tap](QUEUE-PROTOCOL-FINAL.tap) |
| CI 白名单，--test-timeout=30000 | exit 0；66/66，0 fail | [ci-allowlist-frozen.log](ci-allowlist-frozen.log) |
| npx eslint . --ignore-pattern ".claude/**"，完整 JSON 统计 | exit 1；56 errors、132 warnings；错误指纹与基线完全相同，满足用户的56口径 | [ESLINT-COMPARISON.json](ESLINT-COMPARISON.json) |
| npm run check:backend-boundary | exit 0；violations: [] | [backend-boundary-frozen.log](backend-boundary-frozen.log) |

完整命令与私有环境见 [VALIDATION-COMMANDS.md](VALIDATION-COMMANDS.md)。ESLint 原始 JSON 保存在本树 `.runtime/artifact-loss-tests/eslint-frozen.json`，其 SHA 在比较产物中；不把重复的大量源码正文加入 Git 文档。历史8条测试只读取 `.runtime/historical-queue-fixture` 中复制的原始字节，不在生产队列上运行 reader。副本源为已封存历史，不是本次丢失回执的恢复尝试。

收尾只读比较 292 份生产队列记录的名称与原字节摘要，全部与任务开始审计相同；生产 `artifact-losses` / `artifact-loss-results` 均未创建。四个禁改文件仍与起点摘要完全一致，见 [PRESERVATION-CHECK.json](PRESERVATION-CHECK.json)。
