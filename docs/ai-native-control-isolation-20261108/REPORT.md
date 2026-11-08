# AI 原生 Windows 控制链隔离证明

2026-11-08。**本阶段已补齐完整原生控制链证明：两轮正常 Start → Stop、23 项真实就绪及固定 G02 通过。当前是未合并开发候选，可建议进入 main 合并；正式制品与上线尚未执行。**

[可直接打开的 HTML](REPORT.html) · [最终提交与远端绑定](D:/codex-artifacts/ai-native-control-isolation-20261108/DELIVERY.json)

## 来源与最终边界

本树 `D:/.codex/worktrees/2949/运营管理系统`、分支 `codex/ai-native-control-isolation-20261108`，从执行时最新 main `0c7d0feb33f45cfc6ae1f283b81d401c873c5768` 建立，经 `0baec367d6bc5058213856eec373e18024c54d9a` 显式合入已审整合候选 `915b94cd2db1f128f8984824a81f70af53ef09a9`。三批原提交与审查保留，没有重复 cherry-pick或新增合并冲突。

| 绑定 | 精确来源 |
| --- | --- |
| 实际原生应用冻结 | `b7280770fa5ff81e3939d6516f021c9f50b496a3`，tree `0428e06fd80a20b808bb3ee5be0ce65f06b131dd` |
| 完整应用来源 | 8,553 文件，指纹 `518371bdd9f3a1be0650ac1abb7114a26dbd25cba4be36a1fc68e4bbd78e72a3` |
| 私有 effective release | `20261108T055224Z-debc0d5c66d99ef2`，manifest SHA `9ba8d1edde3efa6a0f4abe521b019042a97e772d65eac7749194132d1683c1df` |
| 固定 G02 受检提交 | `1921ccceb9fed314e0d5d2ba8fbef082992fa2f1` |
| 最终候选尾部 | 精确维护资格、未调用凭据动作的提前拒绝、证据读取器及文档；最终 Git 回读见 DELIVERY |

**冷启动实际运行的是 b728 包。** 随后只从隔离白名单删除了一个本轮未调用的 `ConfigureCredentials` 动作，防止它读取生产 `.dev.vars`。该修复与 b728 helper 原始字节仅有一次精确删项，已由真实 PS5/PS7 入口验证提前拒绝，并验证 Start/Stop 映射与无 profile 默认行为保持。新 helper SHA 为 `a5499003d2e269b8a3d6cdb6bce70fcd2f02434c541620ccdaa151f0c7f52343`。未热改封存包，不把旧包称作已包含此修复。

17 个已验证 Windows 源文件采用精确 `-text` 属性保全原始字节，避免 `core.autocrlf=input` 在新树物化时改变摘要。独立物化与 1,655 个 Django 部署源文件逐字节匹配。[字节绑定](D:/codex-artifacts/ai-native-control-isolation-20261108/FROZEN-BYTE-BINDING.json)

## 最小适配与资源

原 `operations-system-service → operations-system-control → worker-local-service` 路由保留；唯一 Worker 引擎先启动并核验 Django/PostgreSQL及 Pi/Pandas，再启动原 immutable supervisor、workerd 和 helper。没有复制另一套启动控制器，没有使用 `AllowTestRuntimeRoot` 的合成 ready。

显式隔离配置绑定文件 SHA、固定私有目录及端口映射，传到各域子入口、数据库 URL、健康 Host、状态/停止查询、WSL 单元和签名客户端；缺配置、错摘要、混入生产 runtime 或不支持的动作均拒绝。生产无 profile 时的默认路径与端口保留。版本、来源、ACL、进程身份、互斥、排空、原 unknown 和恢复约束保留。

| 资源 | 本次隔离绑定 |
| --- | --- |
| Windows 根 | `D:/codex-isolated/native-control-ai-20261108`，现已停止并删除临时凭据/profile |
| Worker / helper / PostgreSQL | 回环 `23000 / 25791 / 25432` |
| Django | 原端口固定加 20000，共 23 个 reader/writer/BI 端点；AI 为 `28111/28112` |
| Pi / Pandas | 回环 `28123 / 28121`；原 `main`、真实签名和实际 systemd 生命周期 |
| WSL | `Codex-AI-Batch2-20261108`；新私有单元 `codex-native-ai-20261108-{pi,pandas}.service`，未 enable |
| 控制状态 | 同一隔离 ID 派生系统锁、Worker锁、rotation pipe、回执和意图；COM shortcut 仅在私有目录真实安装/回读，收尾已移除 |

新安装沿原 `Deploy → write-authority / verify-authority → adoption plan / apply` 完成。原生生成的 authority、successor、consumption 和 startup binding 均回读成功。早先 plan02 保留未消费；字节物化固定后，最终 plan03 SHA 为 `d3cf3b3b850aa6a12217488a6228cc988d9be1c653b097b4dbdc99dd507447f3`。不改旧 manifest 填入成功。

## 实证结果

| 正常轮次 | 原 Start | 原 Stop | 独立观察 |
| --- | --- | --- | --- |
| 1 | exit 0，Running，262.434 秒 | exit 0，worker stopped、backendStopped=true，164.862 秒 | 23/23 ready；Worker live/ready/helper 均 200；Pi/Pandas 原签名探测退出 0；原 Windows 身份消失、端口为空、Linux 单元 inactive |
| 2 | exit 0，Running，259.340 秒 | exit 0，worker stopped、backendStopped=true，165.006 秒 | 同上；Windows 创建身份及 Linux InvocationID 均为新一轮，沿用同一私有库和账本 |

两轮均观察到 26 个 Windows 私有回环监听及对应真实进程树；Windows与 Linux 停止分别核验。这里只证明本机原生应用栈的启动契约，不是 Windows 重启/登录自启动或业务功能验收。[75 份原件索引](D:/codex-artifacts/ai-native-control-isolation-20261108/NATIVE-LIFECYCLE-EVIDENCE.json) · [原内层回执](D:/codex-artifacts/ai-native-control-isolation-20261108/NATIVE-CONTROL-RECEIPTS.json)

实际版本：Node 24.18.0、PostgreSQL 17.11、Python 3.12.10、Django 5.2.17、Waitress 3.0.2、psycopg 3.3.4、workerd 2026-05-15。[二进制与版本摘要](D:/codex-artifacts/ai-native-control-isolation-20261108/RUNTIME-VERSIONS.json)

Pi 镜像 `sha256:dea9bb9e4a8a8f41865a10666981444d51ef52415c89e980af0c70e7219a5df2`，Pandas 镜像 `sha256:4c5815d845a4579d5402f2f4c22c8c822701a0116df2e0fc8b28ef31e832d580`。镜像输入逐项相同而复用；本轮 Runner 73 文件实际源码重新绑定，Pi source digest `675a56203a573bd02fd372554b851dae9eb66a1cb09871871ea2a9806ba7bc36`，Pandas package digest `2c8147c570e0cb6113837bafc045adfa6d70c8bcb1d4248583f6b65c6a367188`。[Runner 安装绑定](D:/codex-artifacts/ai-native-control-isolation-20261108/WSL-INSTALL.json)

## 合成前置与保留失败

私有空库真实执行既有结构迁移，只有启动所需合成控制状态及一条明确的 ERP 测试货品，没有导入生产业务库。历史迁移/清理前置记录明确为 synthetic；原 attestation 生成器、ERP 实际行摘要、私有 D1 tombstone/guard 检查及真实 23 域 ready 均执行。该前置状态不能称作历史业务迁移/删除已经执行。私有 lineage 使用独立版本与 `historicalCutoverExecuted=false`，不伪造生产 forward-recovery completed。[合成前置](D:/codex-artifacts/ai-native-control-isolation-20261108/SYNTHETIC-PRECONDITIONS.json) · [实际 terminal 检查](D:/codex-artifacts/ai-native-control-isolation-20261108/D1-TERMINAL-OBSERVED.json)

初始化中的角色/权限所有者、authority 标识及客服 marker 缺漏均按原门禁定向修正，失败保留。初始后端 Start 成功只覆盖当时21个已启用端点，客服 marker 修正后才由原收集器逐一验证23项。首次完整 Start 因 helper 空注册表缺失和本地健康模式配置错误失败；私有配置修正后，原 Stop 在 PID 身份不一致处保留 unknown。独立原 Status/CIM 确认旧进程消失后，沿原 stale-receipt 分支只完成剩余回执清理与后端停止；未直接 kill 模糊身份、未删除旧失败。该失败轮不计入正常两轮。

第一次正常 Stop 后，旧 PID 38076 被 WmiPrvSE 复用；观察器只以不同创建时间证明旧身份消失，没有操作新进程。原生 Stop 保护没有放宽。

## G02、复用与独审

固定入口 G02 v3 实际退出 0，`packageIntegrity=true`、`nativeEntryBoundary=true`、`nativeColdStart=true`。7/7 入口/资格检查、51/51 完整性检查及原件读取器均通过；两个临时工作树已移除。读取器重算原件摘要、完整 Git 来源、部署源、两轮内外回执、23 ready、不同进程身份及停止事实，不读取一个手填 passed 就放行。[G02 原件](D:/codex-artifacts/ai-native-control-isolation-20261108/g02-native-v3/REPORT.json)

新的维护资格只接受精确四控制器方向 tuple 和两 helper pins，原双锁内再核。9 个有限尾部文件同时固定 Git blob 与实际 SHA256，同路径漂移拒绝。TypeScript 5.9.3 的 132 文件单包与原生包及固定摘要绑定；没有重新遍历整个依赖缓存。

G02 v1 的夹具缺 helper、v2 的 TypeScript 依赖遗漏及初审 P1 均保留；定向修复后由原审查上下文关闭。旧整合 G02 的 `native-cold-start-pending` 原件没有改写。本轮没有重跑全仓测试、修复历史 167 条 TypeScript 诊断或扩修无关 Tmall/Jackyun 功能。

请求审查模型均为 `gpt-6-astra/high`，实际底层型号未独立确认。审查者未实施被审改动，返修回原上下文增量复核：

- [方案审查](REVIEW-PLAN.md)
- [精确维护资格](REVIEW-QUALIFICATION.md)
- [凭据配置入口拒绝](REVIEW-CREDENTIAL-GATE.md)
- [真实原生链与 G02](REVIEW-NATIVE-G02.md)
- [最终交付复核](REVIEW-FINAL.md)

## 清理与交付

两轮正常停止后原进程身份、端口、Linux单元均闭合；独立检查测试容器和本 namespace 卷为空。移除13份 Windows临时DPAPI凭据、两份Linux Runner key、7个 `.dev.vars` 硬链接、两端profile及私有shortcut，旧测试安装因此停用。生成输出的有界秘密扫描为0匹配；源代码、合成库、账本和证据停止留存。[清理回执](D:/codex-artifacts/ai-native-control-isolation-20261108/FINAL-CLEANUP.json)

旧四个 WSL 单元和24份意图摘要保持，Docker恢复inactive，私有发行版恢复Stopped。生产发行版仍Running；五个已观测生产端口的PID/创建时间与阶段起点一致，远端main仍为 `0c7d0feb`。这是限定身份核对，没有生产业务探测。[生产只读收尾](D:/codex-artifacts/ai-native-control-isolation-20261108/PRODUCTION-FINAL.json)

完整变更范围为 Worker + Django，并涉及 Pi/Pandas运行源码与控制接线；没有新增 migration。三批已审证据按不变输入复用，测试载荷不是正式main制品。后续正式准备仍需给变化后的Runner源码绑定对应受控轮换，不能只更新Django。

**建议：取得新的明确 main 合并授权后，一次合入本开发分支并从最终 main 准备对应正式制品；上线另授。** 本阶段未合main、未准备正式制品、未安装生产控制包、未上线、未操作生产容器，也未进行真实模型/图片/Schema账户验证、钉钉外发或长期调度启用。后续这些能力的实际验收边界继续保留。
