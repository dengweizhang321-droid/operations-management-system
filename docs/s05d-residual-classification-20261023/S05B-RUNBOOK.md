# S05b 控制采用与当前准入记录

2026-10-23，准备阶段，尚无实际采用回执。用户已明确授权分类通过后进入控制采用和现场准入，具体范围见 [REPORT.md](REPORT.md)。

## 固定输入与入口

- config：`D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json`
- Node：`C:/Program Files/nodejs/node.exe`，实际调用前按原生 handoff 再核。
- 新控制源码：`D:/codex-artifacts/s05d-residual-classification-20261023/control-source`，只从本次最终提交建立干净 detached worktree，不使用正在编辑的检出。
- 新材料目录：`D:/codex-artifacts/s05d-residual-classification-20261023/control-upgrade`，原生 create-only；冲突拒绝，不覆盖旧材料。
- 入口：上述控制源码内 `tools/preparation-retirement-handoff.mjs`，固定 `control-prepare` 与 `control-adopt` 阶段。

当前 root 工具宿主不能代替普通用户 writer。按[既有 handoff 契约](../s05d-retirement-implementation-20261023/HANDOFF.md)生成精确 RUN/TASK，核对 phase、源/材料 SHA、SID、普通 token 及唯一任务定义，再 register/run/status。Task LastResult 或 shell 退出不能代替相互绑定的 STARTED/PARENT/RESULT/EXIT 和原生 direct exit。

每个 RUN、材料 SHA、安装代际与结果从原件取得，实际生成后记录，不能在此预填。采用只使用原 installer 的三锁、代际 CAS、完整 census 和任务/入口门禁；不绕过或关闭 Git hook。原位绑定同一 hooks 目录的设计仍按已审实现执行，不推进 main 触发准备。

## 当前现场止点

已有完整只读结果确认 11 残留和 8 计划原位保留，来源动作仅为本次 4 项。另行对象前像诊断未在 300 秒内完成 staging，第四对象及统一 CAS 未完成；当前不执行 source-close、重启或封存，不把 closure 的 12.937 秒当完整 archive/CAS 预算。

先完成本轮已授权控制 prepare/adopt 并据原生结果报告。后续来源操作须取得完整前像、统一 CAS 与当次原生准入；任一已知缺口不得用延长生产门禁或手工改 proof 处理。仅清理原生完成且无实例的本轮精确 handoff Task，保留全部材料及原始日志。
