# G02 兼容适配独立审查

2026-11-08。审查上下文未参与本适配规划或实现；按用户本任务要求请求 Astra High，工具未独立回传实际底层型号。仅审查新增适配、直接依赖和原始证据，不重新全面审查六个已通过小包，不运行生产操作、正式打包或合并。共享记忆由根负责人统一维护。

## 当前结论

**源码、已有原件及最终固定入口报告增量审查通过，未发现阻断项。本批精确 profile 的 G02 兼容检查闭合。** 被检查提交为 `5d9090b7ef54a2937efe9cfe8556262ccb835294`，完整 Windows 栈冷启动仍未执行；本结论不授予合并、正式制品或上线，也不替代将来合并时对最新 main 的冲突/字节增量核对。

绑定基线 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`、已审应用提交 `eee39f9d315eaf9dd71f8390181879cdb6ba2c82`、应用 tree `18ce84ef8fe69ebd9128dc2b540ee5c67dc977ed`。此次适配五文件以外置 `G02-ADAPTER-SOURCE.json` 为冻结来源，原件 SHA-256 为 `d4898ba9172c0c5d87da766fe03c26f5b754eb6a0a98cd7b6576a48b58682938`。此结论只覆盖该原件中的实际字节。

## 核验结果

- [验证器](../../tools/verify-release-candidate.mjs) 专用 profile 要求固定基线、46 个完整已审非文档路径及其 A/M 状态、四个指定适配路径；删除、改名两端、缺项和未知运行路径不能取得该资格。实际干净候选再验证已审提交祖先关系、tree、46 路径原始字节汇总，以及 full、Worker+Django、无迁移计划。独立重算摘要为 `ba7fbd961afa817b4f8991a04bd902eea00a429e55bbb6380c3b8b97f1a2d12b`，与固定资格一致。没有扩大原控制器字节资格或改变既有 profile 的检查清单。
- [离线核对器](../../tests/ai-repair-batch1-compatibility.test.mjs) 固定 17 份原件摘要，不接受调用者任意 supplied passed。独立核对冻结清单 5 个源码文件和 7 个证据文件全部匹配；复用原件未记录的提交、工具摘要或退出码没有被补造成已知值。TypeScript 使用最终 16 文件绑定，167→167 仍表示既有诊断未消失；Python 旧原件无字节绑定，适配明确在冻结来源补 25 文件 AST 解析。
- 两发布入口的递归模块集合、直接依赖、启动与维护控制器，以及 63 个镜像输入均由固定入口内的核对器重新绑定。新增镜像选择 export 仍从既有模块导入。旧 installed inventory 缺 `publish-latest-main.mjs` 是已披露的独立基线缺口，当前冻结来源闭包通过不能替它宣称 installed 全闭包通过；没有修改旧测试或在通用分支吞掉其失败。旧 n8n 摘要和全仓 TS 红未被全局放宽。
- [原生 Pi 夹具](../../tests/ai-repair-batch1-pi-native-start.py) 从固定 Git archive 复制 Runner，直接执行 `python3 -B -m pi_runner.server`，没有手工替代 Broker、Handler 或停止 monitor。私有配置/合成密钥为 0600，使用独立 namespace、空账本和确认空闲的端口，health 通过原签名客户端；没有实际模型请求或生产凭据。
- `g02-pi-native-v3/NATIVE.json` 与 stdout 原件逐字段一致，夹具摘要、Git archive 摘要及进程退出原件匹配。两次启动 PID 为 57313、57446，均在 UID、argv、procStartTicks 核对后精确 SIGTERM 并 exit 0；同 ledger 路径/device/inode，nonce 由 1 增至 2。原件记录命名空间无容器/卷、进程退出、端口释放和私有目录清理。旧失败原件保留，v2 精确私有目录另有清理回执。该证据只证明空私有账本的 Pi Runner 原入口启动与就绪，不能替代 retained 业务恢复或完整 Windows 栈冷启动。
- 新专用分支显式选择两项 profile 反例、一项离线绑定检查、既有 PS5/PS7 参数入口及真实私有 Django 包复制/部署/hash/ACL/Wrangler 夹具。固定入口仍要求候选干净、完整载荷绑定、前后源码/工具/依赖漂移检查及 worktree 清理，失败会保留 failed。包夹具的 stopped/schema 替身和 PS 参数首副作用边界都已明确披露；完整 `nativeColdStart` 保持 false，Pi scope 单列且必须有真实 passed 原件。
- 已核 [package.json](../../package.json)、[CI](../../.github/workflows/ci.yml) 及其 curated allowlist：新 `.mjs` 离线原件检查没有被 npm test、test:unit 或 CI 自动选入，固定 profile 是其唯一代码调用方，缺原件会直接失败。旧 profile 中全文运行 `verify-release-candidate.test.mjs` 的入口会新增运行两项纯 Git/source 反例，不会加载本机外置原件；该测试文件原已依赖多组历史 Git 对象。因此无需新增通用 skip 或放宽 G02 原件要求。

## 首次审查证据与当时待完成项

外置证据根：`D:/codex-artifacts/ai-repair-batch1-20261107`。

- `G02-REVIEW-BINDINGS.json`：本审查独立摘要核验原件；46 路径、5 源码、7 清单证据、17 固定原件均匹配。
- `g02-profile-tests-v2.log` 与 `g02-compatibility-fixture-v2.log`：实施者定向 2+1 项通过原件已核，不冒称本审查重复执行，也不当作最终 G02 passed。
- 最初 `candidate-compatibility/REPORT.json` 仍为 failed，37 unsupported、checks 为空；未覆盖或改写。源码差异空白检查通过，适用 AGENTS/模型/发布规范与固定基线无差异。

首次审查要求根负责人提交干净候选后执行原固定命令，在全新工作树外目录生成 REPORT，再返回本上下文核对新增结果；该要求已由下节增量闭合，没有重复业务套件。

本轮无发现需要返修，`findings=[]`。未合并 main、未准备正式制品、未上线；审查通过不是这些操作的授权。

## 最终固定入口增量复核

根负责人从干净 `5d9090b7ef54a2937efe9cfe8556262ccb835294` 执行原计划固定入口，tree 为 `40bc87ada55e8fff9fae8628a3add38619280107`。原始 `candidate-compatibility-g02-v1/REPORT.json` 的 SHA-256 为 `182ff5ac263d820f4d84410ddd484d09d65ebe08db93bdcef82ac27a658149c0`，状态为 passed。基线仍为本次资格限定的 `0c7d0feb`；应用与五个已审适配文件原始字节未变。

| 实际新执行项 | 原件结果 | 证据范围 |
| --- | --- | --- |
| ai-repair-batch1-profile | exit 0，2/2 | 精确路径/状态与字节反例 |
| ai-repair-batch1-compatibility | exit 0，1/1 | 冻结来源、复用原件、闭包及补充 AST 解析 |
| powershell-entry | exit 0，unittest 1/1 | 未改的检查器实际逐一运行 PS5/PS7 参数与跨文件路由，在首副作用前停止 |
| actual-django-package | exit 0，原生 PASS 输出 | 私有 Prepare/Deploy/hash/ACL/本地 Wrangler，生产 stopped/schema 准入观察为替身 |

本次增量独立核验四项状态/命令、八份 stdout/stderr 摘要、全部 8,482 个载荷文件及总摘要、五个执行工具摘要、17 份复用原件和既审五源码摘要。报告中的 `reusedEvidence`、`scopedNativeEvidence`、控制器与 publisher 闭包和镜像输入与本次检查生成的 `ai-repair-batch1-verified-evidence.json` 相等；该文件摘要 `8917369c3c143b52f840b7f7e894fb3ed23e3f090971e54d568265657337e393`，与先前有效开发原件一致。没有补造旧原件缺失字段，也没有把复用项列成本次新跑业务测试。

依赖与 PowerShell 模块由固定入口按原 `sha256-ordinal-path-length-content-v1` 在执行前后核对，报告分别绑定 31,418 文件与 116 文件；本增量不重复扫描这些未变依赖。执行包/PS检查后固定入口进入原始载荷、工具、依赖、模块漂移断言，之后才写 passed。

`candidateWorktreeRemoved=true`，无 cleanupError；本增量另外核实本次 candidate 目录不存在、Git worktree 登记不存在。私有包夹具成功路径在 finally 清理精确私有根，清理异常会使进程非零；本次 exit 0。Pi 原生证据保持前轮已审实际清理结果，没有重复启动或改变生产。初次 37 unsupported、checks 为空的 failed REPORT 仍保留。

最终证据为 `packageIntegrity=true`、`nativeEntryBoundary=true`、`nativeColdStart=false`；`requiresNativeColdStart=true`、`requiredNativeScopes=["piRunner"]`，唯一要求的 Pi scope 有已审原入口真实启动/签名就绪/精确退出及清理原件，未借字段改名隐藏缺口。`publicationPerformed=false`，没有正式 Worker release、生产迁移或上线。

增量机器核验：外置 `G02-FINAL-REVIEW-BINDINGS.json`；总审查回执 `G02-REVIEW.json`。本轮只更新审查文档/回执，未改受审源码、重跑有效检查或重审六小包。后续仅任务文档提交可复用此结果，须保留真实被检查提交与文档提交的关系。
