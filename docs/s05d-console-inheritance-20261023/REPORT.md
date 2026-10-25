# S05d 受控 console 继承：D1 私有可行性通过，唯一 D2 真实 Task 失败

2026-10-23 至 10-24。**D1（固定 GUI→系统 PS→原 runner→无业务 Node 的私有启动/输出/退出可行性）通过；唯一一次 D2 真实 Task 失败，完整 `readVerifiedHandoffParent` 与诊断退出尾链未通过。** 失败根因已定位为路径字符串比较缺陷，已有未经现场验证的候选修复。没有执行真实 control-prepare/adopt、退休 plan/close/seal/witness、队列恢复、服务操作或上线；S05d 的"提供可执行的受控入口"这一要求**仍未达成**，S05b 整体恢复仍不能进入。

本报告补记 `5a5351f0`（console-inheritance 代码本体）与 `a1c7e73b`（编译器路径归一化小修）两个提交，它们之前只有代码和测试，没有配套 REPORT/REVIEW，是链条证据链的断点；本报告基于提交后在本机 `D:/codex-artifacts/s05d-console-inheritance-20261023/` 留存的现场材料补齐。

## 背景：为什么要试这个方案

前序三轮尝试（`4a13ae78` 父子链修复、`5f261a00` GUI 薄启动器、`21f28313` D1/D2 最小入口）均未能证明"固定受控入口"可行，卡在同一个问题：固定 GUI 子进程启动系统 PowerShell 时，无法在不破坏既有父子链/唯一 writer 断言的前提下，让 PowerShell 继承一个干净的 console。`console-inheritance` 方案改变思路：不再让 GUI 用 `DETACHED_PROCESS`/`CREATE_NO_WINDOW` 规避 console，而是让固定 GUI 自己 `AllocConsole` 并持有这个 console，再让 PS 以默认方式继承它。

## D1：私有可行性，四层冻结实验，已通过

基线为完整 `21f283136906f6a8d89ef98bed1ceff0d7c8c472`，程序承接 `4a13ae78`/`c7b88eaa`。四次新运行各在独立冻结目录，互不重放：

| 目录 | 验证问题 | 实际进程链 | 核心结果 |
| --- | --- | --- | --- |
| d1-01-console-canary | GUI 先 AllocConsole 持有，PS 默认继承 | GUI 18776→PS 63112 | START/END、双流各32B、PS/GUI 均真实 exit23、双 EOF；GUI 支路 56816 自然 exit0 |
| d1-02-console-assembly | 加入固定 PE LoadFile 前后标记、PS 自身身份观察 | GUI 58120→PS 44920 | LoadFile 标记齐全，PS 真实 Desktop 5.1.26100.9444，console 客户端含 PS+GUI |
| d1-03-console-runner | 换成 `c7` 原 runner 逐字节 + 无业务 Node stub | GUI 57692→PS 30584→Node 34188 | 原 runner 真实身份/one-shot/日志/EXIT 齐全；Node 真实 exit23，双流 131485/65587B EOF |
| d1-04-node-branches | 补 03 遗漏的 Node 直接子进程观测 | GUI 17748→PS 50460→Node 51340→支路 62100 | Node 子进程 62100 完整身份、held handle 自然 exit0；GUI 支路 53336 同样自然 exit0 |

预算起 `15:35:15Z`，证据关闭 `15:51:13.1258766Z`，墙钟 **15分58.126秒**，在 30 分钟预算内。结果明确标注 `strictRoleProven=false`、`samplingCompleteLifecycle=false`——即支路身份和完整生命周期**不是**公开 API 证明的，是按本次创建时序和固定用途建立的窄资格，不能泛化为 conhost 白名单。原 runner 复制 SHA 始终为 `7454869466ff050758be0c0b6239632289fce396191a01949d22b14f5fc2b1e9`，与基线一致，无 token 接缝。

D1 没有运行正式 `readVerifiedHandoffParent`、正式 `executeHandoff`/Task 或完整 native 前诊断尾链；stub 是明确的无业务替身，不是正式验证器成功。

## D2：唯一一次真实 Task，失败

### 事前源码独审（CODE-REVIEW.md / CODE-REVIEW-ADDENDUM.md）

HEAD `5a5351f0043205bec6866566e1fd0e0b1d51966c`，tree `219537950e2072321b37c0c4b669fb1fcbc875ec`。冻结五个文件 SHA：

| 文件 | SHA256 |
| --- | --- |
| tools/preparation-retirement-console.mjs | `882c58d90272e714f82ea70aa83f8c352a6e315f31b3c996d8fbfd9ab80e5f4f` |
| tools/preparation-retirement-handoff.mjs | `057aa8f84a5d95c3296fb7ac71d56b00e52d3b690d99ea4b10d2675745d58ff5` |
| tools/preparation-retirement-handoff-runner.ps1 | `91c8ccb610e1f1bca3e4e6d69569a1a84c5c8742ae7d85935118c9ca61afa68b` |
| tools/install-main-prebuild.mjs | `95424f4472856b4ff2aee5fdc357075ba6c3a011226560dcb953b995b4b5293a` |
| tests/preparation-retirement-console.test.mjs | `a1f06860d85c317c826c2a04a41adae56321e696742e1d863698492ea6f30ad3` |

审查结论："源码层无未决阻断，可冻结最终来源"。这是**静态审查通过**，不是现场运行通过。

### 唯一一次 Task：失败

RUN `a0adc2a0-6fdb-4eef-b7c8-3c3140f5ba37`，SHA `f5ceaa49aa59f2fa6a195705357f2dc6cc66206e514a0b079bf6afa845751df8`。实际新 PE SHA `d4fae107c61ca4e28380b39530d3f6e31b42b58cd1e7df5c66cb84955671bdb6`。

GUI-FAILURE 于 `2026-10-23T16:32:17.7604342Z` 记录：

```
error: "Compiler bytes changed"
nativeInvoked: null
nativeOutcome: "unknown"
status: "diagnostic-unfinished-or-refused"
```

**根因已定位，不是编译器真的变了。** 独立复核 `field-failure-observation.json` 确认实际 compiler SHA 仍为 `46809206887326d2d24db1eff1f3064de972c3451abe766b49111450a5e08e00`，与预期一致。真实问题是路径表示比较：RUN 里 `compiler.path` 用正斜杠 `C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe`，冻结 C# 代码用裸 `OrdinalIgnoreCase` 比较反斜杠绝对路径，两字符串字面不等，复合校验在 console 分配、PS 创建**之前**就直接拒绝。初次实现和事前的独立源码审查都没有发现这处路径表示不等价。

外部 observer 在原定 120 秒 READY 预算内未取得 GUI-READY，于 `16:33:38.1283280Z` 判定失败，GUI/支路观测均为 null；observer 工具以 exit1 收尾。没有取得 GUI-ATTEMPT/READY、PS/Node STARTED、DIAGNOSTIC 或原生 EXIT；没有本次 GUI/PS/Node 普通令牌、完整祖先链的现场通过证据。Task 本身状态 `state=3`、`instances=0`、`lastResult=91`，是静止/辅助观察，不构成 kernel 退出或诊断完成的证明。

**本轮一次 Task 额度已用完，没有重放、换 ID 或当场改后重试。**

## 候选修复：已写出，未经现场验证

获新授权后，对 `FixedCompilerPath` 增加 `Path.GetFullPath` 规范化再做 `OrdinalIgnoreCase` 比较，取代原来的裸字符串比较；`CompilerSha`、哈希、签名及引用检查不变。实际改动模块 SHA `559abd1818ce17690edc23e7eb3b5e245dc75a18c93f6f8322fe9b15354de568`。独立编译验证（`private/d2-compiler-path-correction-01`，源 SHA `120a3f77d8183a32a0d772324cb2da2b1b93b7528727f4f8dc9377915962ec16`，PE SHA `af8844017738aa0b962cef86efe05ea84bbcff6db3b6cddc791a38d94f7d4e0a`）用纯函数反射检查确认：原裸斜杠比较返回 `false`，两种固定绝对斜杠路径格式均被接受，`cmd.exe`/`Framework32`/drive-relative/relative 四类非法路径仍被拒绝。

**这个修复只验证了路径比较函数本身，没有重新跑一次完整 Task 现场验证。** D2 仍然是失败状态，候选代码不等于已修复。

## 本次提交的实际代码改动

相对 `21f283136906f6a8d89ef98bed1ceff0d7c8c472`，本次 `5a5351f0` + `a1c7e73b` 两个提交共改动：

- `tools/preparation-retirement-console.mjs`（新增，132行）：固定 GUI console owner 的 C# 源码生成与编译封装，`a1c7e73b` 在此文件内做了编译器路径归一化的小修（3行改动，2增1改）。
- `tools/preparation-retirement-handoff.mjs`（+50/-若干）：接入新 console owner 的 handoff 流程。
- `tools/preparation-retirement-handoff-runner.ps1`（+28）：runner 侧配合改动。
- `tests/preparation-retirement-console.test.mjs`（新增，13行引用）：对应单测，**全部基于手造 fixture（SHA 用占位值），不是现场运行产物**，不能作为"已验证通过"的证据。

仓库里没有 `install-main-prebuild.mjs` 的 2 行改动之外的生产入口变化；没有触碰 `tools/preparation-resolution.mjs` 的既有 FAILED 判定逻辑。

## 结论对照 S05d.md 任务范围

- 第4项"提供可执行的受控入口及必要构建/部署/启动代码检查证据"——**仍未达成**。D1 证明了"GUI 持有 console、PS 默认继承"这条路径在私有 stub 场景下可行，但唯一一次对接真实 handoff 代码的 Task 执行失败，失败原因已查清但修复未经验证。
- 其余各项状态与此前链条报告一致，未受本次改动影响。

## 边界

未执行真实 control-prepare/adopt、退休 plan/close/seal/witness、队列恢复、来源移动、服务启停或上线。旧全部 unknown、历史 Task/ACL、原始失败材料保持不变，没有重放或补造成功。本次没有扩大到 S05b 退休恢复或旧 plan/close/seal/witness 契约。

## 证据来源

本次材料未提交进 Git（属于补记），原件在 `D:/codex-artifacts/s05d-console-inheritance-20261023/`：`D1-RESULT.md`/`D1-RESULT.json`/`D1-evidence-index.json`（D1 四层实验）、`CODE-REVIEW.md`/`CODE-REVIEW-ADDENDUM.md`/`PRE-TASK-REVIEW.md`（D2 事前源码独审）、`D1-REVIEW.md`/`REVIEW.md`（独立增量审查，`REVIEW.md` 为最终结论"D1 通过，D2 失败"）、`d2/field-run.json`/`d2/field-failure-observation.json`（唯一一次真实 Task 的失败原件）。worktree 位于 `D:/codex-worktrees/s05d-console-inheritance-20261023`，HEAD 为 `a1c7e73bba38cdf661a09b933623a768f8eeb0e5`，工作区干净。
