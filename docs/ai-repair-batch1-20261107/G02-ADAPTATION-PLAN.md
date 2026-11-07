# 第一批 G02 最小兼容适配方案

日期：2026-11-08。性质：定向方案与规则适用判断，尚未实施、不是独立最终审查或合并就绪结论。请求角色为 Astra High decision；实施和最终独审须由其他上下文完成。

## 结论与边界

本批需要补一个**仅适用于已审第一批字节的候选兼容 profile**。不能整体豁免固定入口，不能把 37 个路径无条件加入 `supported`，也不需要为此建设一般应用验证平台或修完全仓红测。

依据为现行 [G02](../运维/部署与启动/发布门禁执行细则.md#g02)：发布入口和完整性工具使用固定 `verify-release-candidate.mjs`；同时明确“当前适配器仅用于发布控制和字节完整性所需检查”，新业务、迁移和未知运行工具“只补实际构建、部署和启动必需的代码及工具兼容材料”。本批修改 `publish-prepared-main.mjs` 与 `publish-main-resume.mjs`，因此不能以一般业务不在旧 profile 内为由宣布固定入口不适用。

[验证与发布](../规范/验证与发布.md#ci门禁不进入发布链路)明确：该验证器没有生产调用方，不被发布器调用；CI、候选兼容验证、真正发布准入必须分别记账。其拒绝不是一次生产发布失败，但没有解决该拒绝前也不能说 G02 已完成。

当前授权只允许本批开发、必要检查、对应专项验证、独审和任务分支提交推送。本方案不授权 main 合并、正式制品、控制采用、生产服务或生产对象操作。测试用私有复制包、私有镜像原件和最终 main 的正式 `PREPARED` 分开。

## 已核事实

- 基线 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`；已审应用候选 `eee39f9d315eaf9dd71f8390181879cdb6ba2c82`，tree `18ce84ef8fe69ebd9128dc2b540ee5c67dc977ed`。工作树规范与 `origin/main` 对应文件没有差异。
- 原件 `D:/codex-artifacts/ai-repair-batch1-20261107/candidate-compatibility/REPORT.json`：`failed`、37 个 unsupported、`checks=[]`、三类 evidence 全 false、`publicationPerformed=false`。失败发生在创建验证 worktree 前的范围断言；它没有证明任何包、入口或冷启动失败。
- 完整差异计划为 `full`、Worker+Django、无 migration。旧 profile 却给 `worker=false,django=false,publication=true`：它按控制工具路径触发，不能被误读为应用没有 Worker/Django 载荷。
- 过滤 docs/tests 根目录后有 38 个路径：37 个拒绝项加已支持的 `tools/publish-prepared-main.mjs`。其中 `backend/**/test_*.py` 和 `backend/ai_assistant/tests.py` 没被旧过滤器排除；不能据文件名断言它们不进入 Django 复制包。
- 两个发布文件只新增同模块镜像选择/证明能力及原续接对该证明的检查；没有新增外部 import 模块。实际准备仍调用既有 `build_image.py`，原 `PreparePiUpgrade` / `PiUpgradeCheck` 及后续原生升级路径保持。PS 控制器与维护字节资格未改。
- W2 的 118 项是编排夹具；真实镜像、Windows Django→签名 HTTP→私有 WSL Broker 重建/升级/唤醒有另行原件。两种证据不能互换，也不等于完整 Windows 栈冷启动。详见 [PI](PI.md)、[W2 独审](REVIEW-W2.md)、[检查分层](CHECKS.md)。

## 最小修改范围

1. `tools/verify-release-candidate.mjs`：增加 `aiRepairBatch1Only` 一条专用分支及对应证据绑定；保留现有通用分支、所有旧资格与拒绝行为。
2. `tests/verify-release-candidate.test.mjs`：只补 profile 的范围/漂移反例。
3. 一个小型离线检查器，例如 `tests/ai-repair-batch1-compatibility.test.mjs`：核本批输入、执行位置、包闭包及已有原件绑定；复用现有哈希、Git、`run()` 和报告结构，不建立通用规则引擎。
4. 若已有原件不覆盖下述 Pi 原生启动缺口，再增加一个私有原生入口夹具，例如 `tests/ai-repair-batch1-pi-native-start.py`；直接复用本批已有 WSL/rootless Docker 环境和启动/清理方法。不能改生产 `install_linux` 或另建服务/调度系统。
5. 本任务报告更新实际结果、原件索引和独审。不得为通过而改 `AGENTS.md`、G02、PS 控制器、维护资格、旧 inventory 测试或 n8n 批准摘要。

以上是最大必要文件类别，不要求机械拆成多个文件；复用现有测试承载同样能力时可减少文件。

## 精确 profile 条件

- 固定基线与已审应用候选，不按分支名或日期推导资格。38 个路径从失败 REPORT 完整列举，连同 rename/delete 的路径两端逐项分类；不得使用 `app/**`、`backend/**`、`lib/**`、`containers/**` 通配放行。
- 本 profile 只接受上述已审应用/发布工具的精确字节，加本次 verifier、指定测试和任务文档增量。由执行者在干净候选上生成已审字节清单，独审者核对 `eee39f9d`、已有 SOURCE 原件及实际冻结检出；清单作为有限资格绑定，不把任意调用者提供的清单当批准。
- 已审运行字节任一变化、新增/删除其他运行路径、迁移、锁文件、依赖/构建配置、控制器或权限工具变化，均拒绝本 profile；返回原 unsupported 或清楚的新范围错误。不能以本 profile 自动套 Q05/Q06/Q14，不能借已有六小包独审认可后续任意同路径修改。
- 精确核对 Worker/Django 原启动控制器、supervisor、`django-ai.ps1`、`manual-maintenance-continuation.mjs` 与基线原字节不变；不重算或放宽 `piNativeCandidateControllerSha256`。实际 byte hashing 沿原工具读取候选文件，不发明换行归一化摘要。
- 此 profile 的组件范围采用完整 release plan，保持 full/Worker+Django/无迁移；只把“本次必要检查集合”收窄，不改发布范围分类。
- 分支不能先调用 generic `publication` 全套再忽略失败；必须显式选择本批受审检查集合。其他 profile 的测试清单、执行条件和失败状态全部原样保留。

## 检查与复用清单

| 项目 | 最小动作 | 能证明什么 / 不能证明什么 |
| --- | --- | --- |
| 候选及输入完整性 | 复用验证器原有干净 HEAD、完整 Git 计划、私有 detached tree、源码全清单、依赖/工具/PS 模块摘要、运行前后漂移及清理检查 | 绑定本次实际字节；不产生正式制品或动态发布准入 |
| 应用语法/类型 | 机器核对本批 Python 语法原件和 TypeScript 精确基线/候选比较；仅校验新增 verifier/夹具本身 | 167→167 的旧诊断仍存在；不能写全仓类型通过。源字节未变不重跑业务套件 |
| 镜像闭包 | 重算现有 `build_image.py` 的输入摘要，核 63 文件及实际 Dockerfile COPY、runtime/package 锁、bundled skills；核 `W2-isolated-image-proof.json` 的镜像 ID、三标签及原构建日志 | 复用已构建隔离镜像。该 proof 的 sourceCommit/tree 为 null，不能改填最终提交，也不能作为正式 PI-IMAGE/PREPARED |
| 发布编排 | 复用 `W2-publisher.log` 的 118 项及冻结 SOURCE/独审原件；核两发布文件及直接依赖相对当时未变。新增适配自己的正反例另跑 | 不把旧测试放进本次新执行 checks 冒充重跑；无新的受影响编排逻辑便不重复 118 项 |
| 实际包复制/依赖/ACL | 从新干净验证树执行既有 `tests/release-candidate-package.test.ps1`，除非存在同输入有效原件可直接复用 | 真正私有 Prepare/Deploy/hash/ACL/本地 Wrangler 闭包；其脚本替换 stopped/schema 观察，不证明生产准入或冷启动 |
| 真实 PS 参数入口 | 执行既有 `test_pi150_recovery_entry.py`，或复用明确同控制器/环境的有效原件 | PS5/PS7 原参数块及 Worker→Django 路由在首副作用前停止；不证明完整生命周期完成 |
| Pi 业务专项 | 复用 W1/W2 真实镜像、真实 Docker、签名 HTTP、重建/升级/唤醒及旧 unknown 保留证据 | 不重复容量、历史、模型等已通过业务场景，不据真实 Docker 就宣称整个 Windows 发布完成 |
| Pi 原生启动 | 按下一节补缺或复用真正覆盖它的同字节原件 | 仅补本批确有生命周期变化的原生启动与就绪，不扩成全栈验收 |

复用必须由代码读取原件、校验原件摘要和相关源码绑定，并在 `reusedEvidence` 中记录来源、命令/环境可确认范围、原始状态和限制。不能根据 REVIEW 文本造一个 `passed` JSON。原件当时没有记录的退出码、工具摘要或字段保留“未记录”；若这些缺失确实妨碍所需结论，只补该直接步骤，不能为填齐字段重做全部已有验证。旧失败原件不可覆盖。

固定入口本次运行的最少新增命令如下，均由原 `run()` 在私有候选内调用并自动留 stdout/stderr、退出码和摘要：

```text
node --test --test-name-pattern="ai repair batch1" tests/verify-release-candidate.test.mjs
node --test tests/ai-repair-batch1-compatibility.test.mjs
<pwsh.exe> -NoProfile -NonInteractive -File tests/release-candidate-package.test.ps1
<python.exe> -m unittest discover -s tests -p test_pi150_recovery_entry.py
```

后两项按实际同字节有效原件决定复用，不能只凭“控制器没改”手填执行成功。不要运行 `npm test`，也不为了此适配提前生成正式 Worker/Django release。Worker 构建链没有变化，本批既有类型/导入证据和冻结来源闭包检查满足开发期所需；未来正式构建仍在明确合并授权后进行。

## Pi 原生启动缺口必须单独处理

G02 要求真实生命周期语义变化完成原生冷启动及必要就绪，不能因为 PS 文件不变就把整包 `requiresNativeColdStart` 判 false。W1/W2 改了实际 Pi 容器/Broker 生命周期；但不据此要求重建一套完整 Windows/PostgreSQL/Worker 验收环境。

已读 `W2-R1-real-django.py`：其私有 WSL 段真实构造 Broker，却主动停止 monitor，并手工创建 `ThreadingHTTPServer`；这是有价值的真实业务链证据，不是 `pi_runner.server.main` 原生启动完成。现有摘要/WAL 证明也不能自动替代新 Runner 字节的原生启动。

执行者先核已有原件；若没有同字节的原入口启动，使用**现有私有环境和现有候选镜像**补一次：

```text
python3 -B -m pi_runner.server --config <本轮私有0600配置> --port <确认空闲的私有端口>
```

必须走未替换的 `main()`、Broker、monitor、Handler 和实际 rootless Docker，使用合成独立通道密钥，通过原协议签名 health 验证当前 image/sourceSha256/namespace 和就绪；仅对本轮精确进程 SIGTERM，取得真实退出，保留同私有账本再次从原入口启动并检查就绪，再停止/清理本轮对象。不重复升级/历史业务场景，不连接真实模型供应商，不修改生产配置、旧 unknown 或现役对象；已有 retained 恢复证据单独复用，空账本原生启动不得改称 retained 恢复证明。

机器原件至少记录：冻结候选 commit/tree 与实际复制到 WSL 的 Runner 完整 `source_digest`、启动命令和 Python 路径、已存在候选镜像 `sha256:7975d9cae783f1b33fb21063d6be40a2fdbb1a7d718550fd13a54ed64961097d`（先核绑定及实际可用）、本轮独占 namespace、配置及 ledger 的精确私有路径、空闲端口与两次启动的 PID/创建身份、两份签名 health 的可核对字段、每次 SIGTERM 对应进程及真实退出码、最终命名空间/端口/进程清理结果。源码复制摘要必须等于已审当前 Runner 来源；不把旧镜像标签或旧 Broker 进程当本次启动。签名密钥不写入原件。账本重启必须保持同一路径和数据库成员；仅在精确进程已退出后记录私有 SQLite/WAL 文件存在及所需摘要，不复制正在写入的数据库来制造一致性证据，也不删账本后称同账本重启。

这只补 Pi 原生启动，**不宣称完整 Windows 栈 native cold start**。若原入口运行能力实际缺失，保留明确缺口和候选未合并；不降低 monitor/health/源码摘要断言来通过。

## 旧 inventory 红的精确处置

`tests/pi-main-resume-profile.test.mjs` 的 installed inventory 用例递归追踪 publisher 的 imports，要求每个模块出现在 Django 显式复制清单，当前缺 `tools/publish-latest-main.mjs`。它在精确基线同红，必须保留原件和事实，不能改测试期待为通过。

本批不新增该导入边；`publish-main.mjs` 实际从冻结来源 import publisher，原 `publish-main-status` 续接也使用原冻结包。G02 适配应只核：

1. 基线和候选的两入口递归模块路径集合一致；`verifyPreparedPiImageSelection` 仅从已存在的 `publish-prepared-main.mjs` 导入。
2. 从当前冻结候选导入这两个可安全 import 的模块能解析新 export；不要 import 有无条件执行入口的 `publish-main.mjs`。
3. 新 builder 及其 Dockerfile/锁/技能文件位于冻结来源实际取用路径；原 PrepareApp/VerifyPreparedApp 复制闭包没有因本批新增缺项，私有包 fixture 仍真实执行。
4. 保留独立“installed inventory 基线缺口”说明，不能据冻结来源闭包通过宣称 installed publisher 全闭包通过。若检查发现本批新增依赖必须从 installed app 加载且缺失，立即变为本批阻断；此时不能用基线同红免责。

据此，专用 profile 不选择该旧 inventory 测试作为本批入口通过条件，也不改它；它仍约束原 `piMainResumeOnly` profile。该选择须由新增反例与独审核验，不能静默 catch 失败或全局 skip。

另外，n8n `tmall-sycm-cookie-pipeline.ts → n8n-preflight-evidence.ts` source hash mismatch 和原 167 条 TypeScript 诊断均已精确基线复现。其运行代码/资格/调用在本批不变，不属于本次适配整改项。只有本批引入的新增必需代码问题才进入返修。

## 报告语义与关闭条件

- `packageIntegrity` 只据实际成功的私有包检查/有效复用赋值，附 `scope`：私有 Django 复制与依赖/ACL、Pi 镜像输入。不得暗示已经生成并核验正式 Worker release。
- `nativeEntryBoundary` 只据真实 PS 参数边界及本批冻结入口闭包赋值，明确首副作用前停止和替身范围。118 编排夹具本身不等于真实入口完成。
- `nativeColdStart` 保持表示完整原生冷启动；本批没有完整 Windows 栈证明时仍为 false。新增 `scopedNativeEvidence.piRunner` 记录实际原入口启动/就绪/停止及复用范围，并明确 `requiredNativeScopes`。不能通过把布尔字段改名来豁免真实缺口；只有本批要求的 Pi scope 实际闭合，且 PS/service 路由不变已核，才能判本 profile 所需检查通过。
- 必须保留原 failed REPORT，在新的工作树外目录生成新的 REPORT；记录本 profile 仅覆盖本批字节和检查范围，`publicationPerformed=false`。passed 表示本次 G02 兼容材料闭合，不表示完整业务/Windows 冷启动/CI 全绿/正式制品/可直接上线。
- 若任何直接必要检查失败、复用失配、原入口无法运行、清理失败或新增未知路径，报告 failed 并只修该缺口；不得手填 passed 或继续扩大无关修复。

实施者完成后交**新的独立 Astra 上下文**审查本方案采用及新增 verifier/测试、精确字节范围、实际原件和证据分类；本方案作者不得最终自审。旧六小包不重新全面审查，只有被适配发现的新直接问题按原审查上下文增量处理。

建议执行顺序：最小适配与私有夹具 → 新适配正反例 → 独审源码及原件绑定 → 提交冻结 → 从该干净提交执行固定入口 → 仅对最终报告/新增事实增量核验 → 更新 REPORT/CHECKS/HANDOFF 并提交推送任务分支。最终文档提交不改变运行字节时按原规则复用实际检查，不为 commit 元数据循环重测；报告保留真实被检查提交与最终文档提交的关系。

最终固定命令沿原入口，输出目录必须全新：

```text
node tools/verify-release-candidate.mjs --source D:/codex-worktrees/ai-repair-batch1-20261107 --base 0c7d0feb33f45cfc6ae1f283b81d401c873c5768 --out D:/codex-artifacts/ai-repair-batch1-20261107/candidate-compatibility-g02-v1 --dependencies D:/codex-worktrees/ai-repair-batch1-20261107/node_modules --python D:/codex-artifacts/ai-repair-batch1-20261107/metrics/venv/Scripts/python.exe
```

当前仍未满足：有限 profile/新增夹具未实施及独审；固定入口尚无通过原件；Pi 原生 main 启动材料尚需上述核实/补齐。六小包源码已审这一事实保持，但本方案不能将整包标为合并就绪。无论后续兼容结果如何，main 合并/正式制品/上线仍各按当前授权边界办理。共享记忆由根负责人随最终实际结果统一维护，本方案不把尚未采用的建议写成永久规则。
