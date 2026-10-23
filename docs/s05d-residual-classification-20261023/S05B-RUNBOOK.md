# S05b 控制采用与当前准入记录

2026-10-23，准备阶段，尚无实际采用回执。用户已明确授权分类通过后进入控制采用和现场准入，具体范围见 [REPORT.md](REPORT.md)。

## 固定输入与入口

- config：`D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json`
- Node：`C:/Program Files/nodejs/node.exe`，实际调用前按原生 handoff 再核。
- 新控制源码：`D:/codex-artifacts/s05d-residual-classification-20261023/control-source-handoff-acl`，只从本次权限修复最终提交建立干净 detached worktree，不使用正在编辑的检出；首轮 `control-source` 原冻结树保留不用。
- 新材料目录：`D:/codex-artifacts/s05d-residual-classification-20261023/control-upgrade`，原生 create-only；冲突拒绝，不覆盖旧材料。
- 入口：上述控制源码内 `tools/preparation-retirement-handoff.mjs`，固定 `control-prepare` 与 `control-adopt` 阶段。

当前 root 工具宿主不能代替普通用户 writer。按[既有 handoff 契约](../s05d-retirement-implementation-20261023/HANDOFF.md)生成精确 RUN/TASK，核对 phase、源/材料 SHA、SID、普通 token 及唯一任务定义，再 register/run/status。Task LastResult 或 shell 退出不能代替相互绑定的 STARTED/PARENT/RESULT/EXIT 和原生 direct exit。

每个 RUN、材料 SHA、安装代际与结果从原件取得，实际生成后记录，不能在此预填。采用只使用原 installer 的三锁、代际 CAS、完整 census 和任务/入口门禁；不绕过或关闭 Git hook。原位绑定同一 hooks 目录的设计仍按已审实现执行，不推进 main 触发准备。

## 当前现场止点

已有完整只读结果确认 11 残留和 8 计划原位保留，来源动作仅为本次 4 项。另行对象前像诊断未在 300 秒内完成 staging，第四对象及统一 CAS 未完成；当前不执行 source-close、重启或封存，不把 closure 的 12.937 秒当完整 archive/CAS 预算。

先完成本轮已授权控制 prepare/adopt 并据原生结果报告。后续来源操作须取得完整前像、统一 CAS 与当次原生准入；任一已知缺口不得用延长生产门禁或手工改 proof 处理。仅清理原生完成且无实例的本轮精确 handoff Task，保留全部材料及原始日志。

## 首次实际调用（拒绝，禁止重放）

冻结代码提交 `86a3cf15db4e62b6345123a45ad718981804d624`。使用上述入口 `--action prepare --config <config> --phase control-prepare --materials <新材料目录>` 生成 RUN/TASK；随后 `--action register`、一次 `--action run`、`--action status` 都绑定相同 `--run <RUN.json> --run-sha b3381f4f57277171d4667e2945c9bc389c4c10531bfaf7406b90fe39f171982e`。

run 为 `c6be141b-9f7a-488a-9671-f97807c26458`，原件目录 `D:/codex-isolated/main-manual-release-20261016/retirement-handoff/runs/c6be141b-9f7a-488a-9671-f97807c26458`；Task 为 `TERUISI.Retirement.c6be141b-9f7a-488a-9671-f97807c26458`。状态 `attempted-unknown-no-replay`、nativeCompleted=false。绑定的完整 stderr 为 `Runner task instance count is ambiguous / 0 !== 1`；直接 EXIT=1、普通 parent integrity=8192。独审核定拒绝位于 native prepare 调用前，不只依据 STARTED/RESULT 缺失。见[摘要索引](handoff-first-attempt.json)及[独审](REVIEW.md)。

该 Task 已退出、无实例/触发，原任务及日志保留；没有 native 完成，不能调用仅支持成功完成的清理入口。不要重跑该 RUN、修改冻结 host 或另造成功回执。原 config/CONTROL-INSTALLATION/hook 未变，材料未生成；下一步按[最小诊断方案](HANDOFF-ISSUE-PLAN.md)定位实例可见性，新修复未经审查前不再进入 prepare。

上述诊断及单叶权限修复现已通过[增量独审](HANDOFF-FIX-REVIEW.md)。新调用必须使用新冻结 source/host 与新 run，保留前 run 的前 native 拒绝摘要及其 unknown 状态；再次遇 STARTED 后失败/未知立即按 no-replay 停止，不继承前一次的有限资格。其余原生 installer/代际/材料和普通写者门禁照常执行。这里没有授权重跑旧 run 或应用制品准备。
