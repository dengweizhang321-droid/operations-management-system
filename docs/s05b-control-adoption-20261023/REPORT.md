# S05b 新控制包准备与采用：失败停止

2026-10-23。**本次 control-prepare 未成功，control-adopt 未调用；实际控制包仍为旧 `83e4158f…`。** 新调用在普通权限父子链门禁拒绝后，按用户边界立即停止，没有重试、现场修复或后续退休动作。S05b 整体恢复未完成。

## 本次原生结果

| 项目 | 真实结果 |
| --- | --- |
| 新 handoff run | `1d5123a6-ce79-4196-bc1d-ebe4e79b7637` |
| RUN SHA256 | `d88cc369c8a593cb9510605a6e9936147aeab15c47feb04674551eff45ddd656` |
| 调用次数 | control-prepare 阶段注册、唤醒各一次；control-adopt 零次 |
| 实际身份 | 同一交互用户普通权限，integrity RID `8192`，`elevated=false` |
| STARTED / 直接退出 | `2026-10-23T09:59:14.543Z` / `2026-10-23T09:59:22.1817725Z` |
| RESULT | `failed-or-unknown-no-replay`，exitCode `1` |
| 真实 EXIT | exitCode `1`，`outputComplete=true`；stdout/stderr 均 0 B，错误保存在 RESULT |
| 原 status 入口 | `nativeCompleted=false`，任务 Ready、instances `0`，LastResult `1` 仅作旁证 |
| 控制材料 | 目标目录未创建，无原生 INTENT/PREPARED 成功回执 |

错误原文：`Handoff parent has another child`。该次门禁取得的父进程子 PID 集合为 `[31928, 6392]`，预期为仅当前 writer `[6392]`。冻结 host 的 `executeHandoff` 先调用 `readVerifiedHandoffParent`，通过后才导入 installer 并调用 `prepareControlUpgrade`；本次在该检查处捕获异常并保存失败 RESULT，没有进入 native prepare。**此调用边界不改写原 unknown，也不授予重试资格。** 额外 PID 的身份、创建时间以及当时为何进入父子集合未由这份错误证明，本轮不扩展诊断或修改规则。

原件目录：[本次 handoff run](D:/codex-isolated/main-manual-release-20261016/retirement-handoff/runs/1d5123a6-ce79-4196-bc1d-ebe4e79b7637/)。关键证据：[RESULT.json](D:/codex-isolated/main-manual-release-20261016/retirement-handoff/runs/1d5123a6-ce79-4196-bc1d-ebe4e79b7637/RESULT.json)、[EXIT.json](D:/codex-isolated/main-manual-release-20261016/retirement-handoff/runs/1d5123a6-ce79-4196-bc1d-ebe4e79b7637/EXIT.json)。其摘要分别为 `b74559cf2b1fb596150d3af92c1171158a32623441f6a2e11a865670a7cd5a5a`、`7180b69b9485082ac3af52d8e6fd9e357ffbb31f59f4bd80d324f1859ccd7082`。

原 status 的 `outputComplete=null` 是失败分支的展示字段；本报告的输出完整结论取自原 EXIT，并已核其 RESULT/PARENT/STARTED/RUN 与 stdout/stderr 的 SHA、长度及 PID/创建时间绑定，未把 status 的空值改写为成功。

## 源码与旧代际

- 按用户指定使用 `D:/codex-worktrees/s05d-diagnostic-cleanup-20261023`，精确提交 `a1750fd2d2395ab5f7e31789ee1b9566ceaa1697`。动作前和失败后均干净；10 项 pins 的长度与 SHA 全部匹配，38 件 source/frozen installer 工具闭包相符。没有复制旧 RUNBOOK 的源码路径。
- 本次 host 根为 `retirement-handoff/hosts/71b4a448664bfca46b9be99277f02f9a7a39f10f2990f7419d4ae4b9240ca1ec`；handoff SHA `4a9384bfc6ba10300139c769b2f796ff3ffa0baa2be6d256b9eff1bf7dd5e5ac`，runner SHA `7ad4e67e94fcdf5996dc2a962045e6f1d10ba6a1a0337058b211dea5312b531c`。新 Task 为 Hidden=false、InteractiveToken/RunLevel=0、无触发器或自动重启；原身份、唯一实例及父子链门禁保留。
- 新材料路径固定为 `D:/codex-artifacts/s05b-control-adoption-20261023/control-upgrade`。预计 32 件新控制包摘要为 `b810d75106c3019267a4480641bcb2c0f02f4de5854538d3b649fcdb826e4a88`；这是冻结源码计算值，**不是已准备或已采用的制品**。
- 失败后再用原 `readAdoptedControl` 核对，实际仍为 `83e4158f785cf5506997f485879520e8a0e4db8b427e1438aefe364282976ee8`，installation `ade68625-9378-4358-b31f-e2139c5953e2`。`CONTROL-INSTALLATION.json` SHA `74724dfae400f312e1907ee1f565faf28d46c3842f29916c0f8f2d9f143e4b0e`；config `a90c9b80…7642` 与 hook `582301cd…f987` 保持原字节。

完整冻结摘要和最终原件索引见 [evidence-index.json](evidence-index.json)。现场证据保存在仓库外 [本次 artifacts](D:/codex-artifacts/s05b-control-adoption-20261023/)，不把配置/完整环境复制进 Git。

## 已复用检查与旧 unknown

复用 [已审交付](../s05d-diagnostic-cleanup-20261023/REPORT.md)、[原独审](../s05d-diagnostic-cleanup-20261023/REVIEW.md)及[同次复用增量独审](../s05d-same-operation-validation-20261023/REVIEW.md)：普通权限 Hidden=false 同链现场正例、44 个诊断文件保全清理、新鲜全局范围与四对象完整前像/统一复验、同次重复全验优化均未重跑。

既往 37.170 秒仍只是 `diagnostic-partial/admissionPassed=false`，不是完整 40 秒生产准入通过。既有清理与来源范围闭合不再列为未解决，但不能代替本次原生成功回执。

按规范对继续操作前的未知边界补一项独立只读事实审查，见 [REVIEW.md](REVIEW.md)：c6be141b-9f7a-488a-9671-f97807c26458、28a038c6-34ae-482b-9855-965cf0adc307 的完整绑定退出/日志与各自冻结代码顺序证明原 native prepare 前拒绝；包含隐藏项的当前实例枚举、精确进程和再入门禁核对无阻断。请求模型为 `gpt-6.1-sol/high`，工具没有单独提供实际模型确认。该结论只适用于两个旧调用，不自动延伸至本次新失败。

两次旧任务、日志、冻结材料和 unknown 全部保留。本次新任务、ATTEMPT/STARTED/RESULT/EXIT、installer 冻结闭包和 host 同样保留；未调用 cleanup、协调或重放入口。

## 真实阻塞、后续条件及交付边界

当前阻塞是新 handoff 父子链检查发现额外子进程。后续若另行推进，须先定向核该次父进程、writer 与额外 PID 的身份/创建时间、原拒绝边界、退出及迟到作用资格；不能删除实例门禁、按裸 PID 清理或换 run ID 再试。若需代码修复，另行完成受影响检查与增量独审，再按实际冻结输入和原生门禁执行。完整 prepare 成功、真实 exit 及材料绑定一致仍是 adopt 的硬前提。

本次未执行 adopt、应用准备/上线、新生产 dispatch、退休 plan/intent、来源关闭/移动、重启、seal 或队列恢复。没有可信新 native 完成可供外层协调，因此没有进行协调闭合。控制包未采用，S05b 整体恢复未完成；即使未来完成控制采用，普通写者完整动态准入、退休/封存及队列恢复仍须分别满足原协议和对应授权。

只新增报告和证据索引，未改程序代码、未运行功能测试或整套诊断。为保持指定源码树精确干净，报告单独在 `codex/s05b-control-adoption-20261023` 分支及同名 worktree 交付，基于用户指定 a175 已审提交（包含现存 origin/main 366）。没有 fetch、更新 origin/main、合并或推送 main；本地 `main=2f55c396…` 与 `origin/main=36668589…` 分别记录，未将两者混称同一引用。报告树和源码树均因尚未合并/仍有追溯依赖而保留。交付后停止。
