# S05d 固定 GUI 薄启动器：私有验证未通过，已停止

2026-10-23。**新启动方案尚未证实可行；唯一私有候选运行一次后未满足证据要求，按用户边界停止。** 没有进入正式实现或普通权限计划任务验证，也未执行任何真实控制准备/采用。S05d 完整启动链未通过，S05b 整体恢复未完成。

## 1. 可行性结论与实际依据

唯一候选为固定用途的 x64 GUI 子系统 PE，拒绝外部参数，只允许固定私有路径、系统 PowerShell 5.1 和无业务 stub。系统编译器签名为 Valid，编译器、源码、编译参数、实际 PE 和运行输入的摘要均已保存。原 runner 逐字节复制，未替换 token 检查。

GUI 实际调用公开 `CreateProcessW`，使用 `DETACHED_PROCESS | EXTENDED_STARTUPINFO_PRESENT`（`0x00080008`）、`STARTF_USESTDHANDLES` 和只含 NUL 输入/匿名双输出管道的 HANDLE_LIST。没有把 CreateNoWindow、windowsHide 或 WindowStyle Hidden 当成无 console 的证明；没有 AttachConsole/FreeConsole 干预目标。

当前工具调用者是 High，故在运行前核同用户、同 session 的真实桌面 Explorer，再经其公开 COM 接口只启动固定 GUI 一次。**实际 GUI 为 medium 8192、非提升**，没有模拟普通令牌或注册 Task。原始请求与实际观察分别记录，不能将 GUI 的权限直接冒充 PS/Node 全链已核权限。

| 层级 | 实际证据 | 结论 |
| --- | --- | --- |
| GUI 启动 | PID 28384，创建 `2026-10-23T14:49:14.6866691Z`；实际同用户/session、medium、路径/命令/创建身份与外持有 handle 绑定 | 固定 GUI 普通权限启动已观察 |
| GUI console | 自身 API 返回 window=0、count=0、error=6 | 仅证明该次 GUI 自身观察，不证明 PS 生命周期 |
| PS 创建/退出 | 固定系统 PS 请求返回 PID 27416；真实 handle signaled、GetExitCodeProcess=0，约 476 ms | 有直接进程退出，不能据此证明脚本执行 |
| GUI→PS 输出 | 双管道真实 EOF 完成，stdout/stderr 均 0 B | 空流已结束，未证明预期内容传输 |
| GUI 退出 | 外 observer 持精确 Process.Handle 核同创建身份，真实 exit0 | GUI 自身正常退出已记录；不等于下游验证成功 |
| PS/runner/Node | entry 最前端 ps-version/自观察标记、原 runner ATTEMPT/PARENT、Node 输出均不存在 | 未取得脚本开始、runner 执行或 Node 启动证据 |
| 全过程观察 | topology 只有退出附近一条空 children 样本；WMI events=[]、overflow=false | 连已知创建也未覆盖，不能证明无短命额外进程或完整时序 |

**PS 与 GUI 的两个 exit0 都不作为方案成功。** 目前只知道候选未满足最小私有可行性要求；为何没有脚本标记、为何事件为空仍未知。本轮不追加根因实验、重编后再试、延长等待或结束进程，也不据此断言 DETACHED_PROCESS 这个方向必然不可行。

## 2. 修改范围与验证覆盖

- 正式源码基线完整复用 `4a13ae7831b989ba3fc5e5b170c1390c3ec936a1`，保留代码提交 `c7b88eaaee625d61101f79c77b34aa5e255a01a9`。**仓库程序代码零修改**；本次提交只含报告、证据索引与导航。
- 私有候选、编译产物和观察脚本仅在 `D:/codex-artifacts/s05d-gui-launcher-20261023/private/`。原 runner SHA 为 `7454869466ff050758be0c0b6239632289fce396191a01949d22b14f5fc2b1e9`；最终实际 GUI SHA 为 `b6292471e566b05da6286b6896d45a7f2158985e056cad6021326697135cb116`。
- 私有 RUN 仅指向无业务 stub：不导入正式 handoff/native/installer、不联网、不执行队列或业务调用。真正的完整 `readVerifiedHandoffParent` 没有运行；诊断也没有产生 native 成功回执。
- 运行前独审核了固定用途、实际普通权限路径、创建标志、标准句柄限定、双管道 drain、真实退出、one-shot 与硬断开。源/PE 的一致性不替代实际 PS/Node 全链成功。
- 既有 Hidden=false 实例可见性、档案/前像和其他有效检查没有重跑。没有全仓测试或档案扫描。历史 PID31928 保持未知，不追认其身份；撤回的 FreeConsole 候选没有再试。

首次外层 driver 在候选启动前遇到 PowerShell hashtable 经 JavaScriptSerializer 的循环序列化错误。独审通过既有控制流位置与错误核明其先于 Trace、消费标记和唯一 ShellExecute；原空 preflight 和错误原文保留。只修私有纯 JSON 传输、使用新名 preflight-v2 并重绑定输入后，才发生本次唯一实际候选运行。失败前 driver 未事前字节快照的缺口明确保留，事后重建不当原件；这次外层准备失败不计作候选运行，也不改写成成功。

## 3. 尚未覆盖或未通过

未取得 PS 实际版本/完整创建身份/token/console 自观察、原 runner 执行、Node 身份/唯一 writer、标准句柄与 canary 在子进程中的实测继承结果、预期输出内容、完整进程事件或真实完整验证器的成功。正式 Task 定义/ACL、新三层祖先绑定、冻结宿主协议及诊断完成尾链均没有实施和现场验证。

因此没有使用最后的普通权限无业务 Task 额度：**新 Task 注册 0 次、运行 0 次，亦无诊断任务可清理。** 所有旧失败及 `8a9f0261-13ad-4ff3-9b1a-94357e97e450` 的 Task、日志、冻结材料与 unknown 保留；本轮私有失败材料也全部保留。

## 4. 原始证据与独立审查

- [私有实际结果](D:/codex-artifacts/s05d-gui-launcher-20261023/private/PRIVATE-RESULT.md)：完整事实、准确限制及 Microsoft primary 文档链接。
- [私有原件索引](D:/codex-artifacts/s05d-gui-launcher-20261023/private/private-evidence-index.json)：编译输入、实际二进制和原始运行材料。
- [独立增量审查](D:/codex-artifacts/s05d-gui-launcher-20261023/REVIEW.md)及[独立原件核对](D:/codex-artifacts/s05d-gui-launcher-20261023/PRIVATE-FAILURE-INDEPENDENT-REVIEW.md)：隔离和止步事实通过，候选可行性/完整前置链未通过。执行与独审分别请求 `gpt-6.1-sol/high`，工具未独立回显实际模型。
- [本次交付索引](evidence-index.json)：冻结基线、全部原件摘要、旧材料不变检查与 Git 边界。

## 5. 下一次真实控制准备条件及交付

**目前不具备进入下一次真实 control-prepare 的技术条件。** 后续须在新的明确研究范围内先核清本次 PS 未出现脚本开始证据和观察缺口，形成可行的私有证据，再完成最小实现、必要独审及真实完整验证器的普通权限无业务全链验证。不能使用本轮未用 Task 额度越过该前置，不能把 exit0、GUI 普通权限或编译成功当成准备许可。

独立工作树 `D:/codex-worktrees/s05d-gui-launcher-20261023` 从 ls-remote 核实且本地已存在的 main366 建立，仅在任务分支受控快进完整 4a13 基线。报告提交推送 `codex/s05d-gui-launcher-20261023`，不合 main；未 fetch、更新 main/origin/main 或触发自动准备。原指定工作树和用户改动保持，当前任务树因未合并和证据依赖保留。

本次未执行真实 control-prepare/adopt、退休 plan/intent、来源关闭/移动、重启、seal、队列恢复、应用准备或上线。交付后停止，不自动进入生产阶段。
