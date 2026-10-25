# S05d 受控 console 继承：补记独立审查

2026-10-25。审查者未参与方案设计或实现，未修改被审代码，未运行实验/测试/Task，未进行子委派。本次是对 `5a5351f0`/`a1c7e73b` 两个此前缺失报告的提交的补记审查：核对 [REPORT.md](REPORT.md) 内容与仓库代码、以及本机 `D:/codex-artifacts/s05d-console-inheritance-20261023/` 留存原件是否一致，不重新验证现场结论。

**结论：补记的 REPORT.md 内容与原件一致，可以采信；但其反映的技术状态是"D1 通过、D2 唯一一次真实 Task 失败、候选修复未经现场验证"，不构成 S05d 任务范围第4项（可执行的受控入口）已完成的证据。本审查不批准将 S05d 标记为"通过"。**

## 核对范围

1. **代码改动范围**：核对 `git diff --stat 21f283136906f6a8d89ef98bed1ceff0d7c8c472..a1c7e73bba38cdf661a09b933623a768f8eeb0e5 -- tools/ tests/` 与 REPORT.md"本次提交的实际代码改动"一节一致：`tools/preparation-retirement-console.mjs`（新增132行）、`tools/preparation-retirement-handoff.mjs`（+50）、`tools/preparation-retirement-handoff-runner.ps1`（+28）、`tests/preparation-retirement-console.test.mjs`（新增）、`tools/install-main-prebuild.mjs`（2行）。没有发现未披露的改动。

2. **私有材料真实性**：直接读取 `D:/codex-artifacts/s05d-console-inheritance-20261023/` 下 `D1-RESULT.md`、`D1-REVIEW.md`、`CODE-REVIEW.md`、`CODE-REVIEW-ADDENDUM.md`、`PRE-TASK-REVIEW.md`、`REVIEW.md`、`d2/field-run.json`、`d2/field-failure-observation.json` 原文，确认 REPORT.md 引用的所有 SHA、时间戳、错误信息（`"error": "Compiler bytes changed"`、`nativeInvoked: null`、`nativeOutcome: "unknown"`）均逐字取自原件，没有在补记时被弱化或夸大。worktree `D:/codex-worktrees/s05d-console-inheritance-20261023` 的 `git status` 为空、HEAD 与链条提交一致，不是正式代码被修改后再声称通过。

3. **D1 通过判定的边界**：原件 `D1-RESULT.md`/`D1-REVIEW.md` 明确标注 `strictRoleProven=false`、`samplingCompleteLifecycle=false`，REPORT.md 如实保留了这个限定，没有把"私有 stub 场景下可行"扩大成"正式场景已证明安全"。这点符合[执行约定](../施工/执行约定.md)"恢复与长任务"一节对资格判定不得泛化的要求。

4. **D2 失败判定与候选修复的边界**：原件 `REVIEW.md`（私有，最终结论）写明"唯一 D2 真实 Task 失败"，候选修复"仅为未现场验证候选"。REPORT.md 对此如实转述，没有把"路径比较 bug 已定位且有修复代码"包装成"D2 已通过"或"受控入口已验证可用"。单测 `tests/preparation-retirement-console.test.mjs` 核实确为手造 fixture（SHA 用占位值如 `'a'.repeat(64)`），REPORT.md 已明确指出这点不能作为现场验证证据，判断准确。

## 遗留问题

- D2 本轮一次 Task 额度已用尽，要验证候选修复是否真的解决问题，需要新的授权和新的一次 Task，这超出本次补记审查范围，留给后续执行单处理。
- 私有材料目前只存在于本机 `D:/codex-artifacts/` 和 `D:/codex-worktrees/`，没有纳入版本控制；本次审查未判断是否需要迁移保存，这属于文档管理范畴，不在本审查职责内。
- 本审查只核对 `5a5351f0`/`a1c7e73b` 两个提交，不重新核对链条更早的 `retirement-feasibility` 到 `real-entry-d12` 各环节，那些环节已有各自的 REPORT/REVIEW，本次不重复。

## 对 BOARD.md 状态的意见

[看板](../施工/BOARD.md) 第38行当前写"S05d：通过（代码/方案）"，这个判定是在链条更早的提交（`a1750fd2`）写下的，在它之后的四个提交（`c7b88eaa`/`4a13ae78`/`5f261a00`/`21f28313`，以及本次补记的 `5a5351f0`/`a1c7e73b`）都明确报告"未通过"。按[执行约定](../施工/执行约定.md)"若已有批准的关键目标未实现，须明确报告未达，而非用'不适用'掩盖失败"的要求，这一行状态不能维持"通过"，应改为能反映"受控入口仍未验证可用，根因已定位但修复未经现场验证"的状态，同时不应把这次补记写成"失败"——因为 D1 的私有可行性确实是实际通过的，根因定位也是实的，不是空转。本审查认为合适的状态描述是"阻塞：D1 通过，D2 唯一一次现场失败，候选修复未验证"，具体文字由看板维护者按统一体例拟定。

本审查不授予任何控制采用、队列协调、生产准备或上线动作。S05d 任务范围第4项（受控入口）仍未完成；S05b 仍不能进入。
