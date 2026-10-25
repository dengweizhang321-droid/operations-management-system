# 固定诊断与 CAS 稳定性增量

基线 `e7978118`；本树 `D:/codex-worktrees/s05d-diagnostic-cleanup-20261023`。只改 fs/archive/collector/core，新增独立 diagnostic 入口；handoff、原 unknown/decision、32 个生产控制包成员不变。没有运行现场诊断、Task、准备、采用、服务或数据库动作。真实旧诊断树清理由主负责人另记，不能当本增量已通过现场准入。

## 实际变更

- 登记/固定来源及生成入口资格移到 native chain/release/staging 大扫描之前，复用原实际字节和完整 Git 成员规则；末 source-entry 和全局 CAS 保留。同 HEAD 的 extra 与 missing 分别计数，多个阻点有结构化根路径/HEAD/角色/样例；未全哈希的共同字节 `changedCount=null`，不把未找到见证写成零变化。不按诊断用途、目录或收尾回执豁免。
- 完整 snapshot CAS 使用进程共享四槽；目录、叶、junction、单文件均受同池约束，四对象按原顺序处理。原 lstat→realpath→lstat、纳秒、链接和目录成员检查保留，没有为省属性调用合并检查点。首错用独立 failed 标志，连抛出 undefined 也拒绝；取消/期限停止领取并排空已启动操作。完整 inventory 仍每对象原有四槽，诊断逐对象 await，未叠成十六槽。
- writer 的 preflight/final CAS 与只读测量共用组合顺序和计时：before adoption/original、closure、全 snapshot、ordinary/Task/boot/ref/native、尾 adoption/original。40 秒阈值不变；成功及失败均保留阶段耗时，seal proof/onStage 留末次 CAS 测量。原 observer/ACK/SEALED 60 秒检查及之后独立尾检不变。reader 仍每次全读、统一复验，没有跨调用缓存。

## 固定入口与止点

```powershell
node tools/preparation-retirement-diagnostic.mjs --config <absolute-config> --dispatch <uuid> --mode preflight
```

`closure` 模式仅做完整 closure 和末 CAS；`preflight` 再逐对象新算完整前像及组合 CAS。输出根固定为 `D:/codex-artifacts/preparation-retirement-diagnostics/<runId>`，不接受 --out/任意命令或生产参数回退。冻结原控制工具闭包加自身递归相对 import，只有 tools 文件，没有整项目、package、应用或依赖复制；parent 以 RUN SHA 启动固定冻结子入口。工具/PINS/Node hash、配置与输出隔离均核验。ATTEMPT create-only，已尝试 run 不重入；新 run 是新只读观察，不是业务 unknown 重试。

总诊断预算单列 20 分钟：19 分钟时仅向本次 owned 子进程发 IPC 取消，inventory/CAS 停领取并 drain；20 分钟硬界只终止该 spawn handle 对应的诊断 Node，WATCHDOG 保持 blocked/unknown、不再 spawn。硬止点不声称 drain 成功。该预算不是生产 40/60 秒的延长。

只读结果固定 `admissionPassed=false`。实际仍观察 ordinary/Task/boot/ref/native/adoption；不满足则列拒绝和 exclusions，且始终排除未取得的 writer locks、冻结退休 intent、关闭后的退休证明。不会因 snapshot 子项快或高权限读取成功冒充完整普通写者准入。

`--status <runId>` 读取持久状态；`--closeout <runId>` 生成有限生命周期回执，不删除任何目录/登记。绑定原 worktree/Git 管理目录、HEAD/branch、tracked 成员摘要、完整 untracked、声明粒度的 ignored 路径和 Git 保全引用。目录内 untracked 成员变化也阻断；`ready-to-remove` 无合格占用/应用归属 provider 即拒绝。已移除仅报告登记/目录均缺且原干净状态仍有可达 Git 保全的事实，不授权删除或授予 collector 排除资格。

## 必要检查与未证范围

[来源/CAS 原件](stability-checks-2.txt) **6/6**；[最后直接检查](final-direct-checks.txt) **8/8，exit 0，19,917.577 ms**。后者覆盖三个 diagnostic 边界、四个 CAS 边界和受影响的原单个私有恢复集成；来源两项未再修改，复用前批。原 handoff 正常/未知/中断证据按不变契约复用，没有重跑全仓、构建、旧全套或现场演练。

检查使用真实私有文件/Git、受限自建 Node 子进程和必要私有 ACL；boot/token/chain/CIM 的既有集成替身不能当现场证明。私有负例包含 extra≠missing 早拒、新登记末 CAS、叶/目录/junction 变化、共享峰值四、假值异常、取消/期限 drain、40 秒拒绝、仓库内输出拒绝、冻结成员缺失、完整 untracked 变化和 lifecycle 不能自行授权移除。

本轮未用十万磁盘文件凑性能数字，也没有取得真实四对象完整组合的余量证据；须由主负责人按固定 CLI 一次实际只读判断。源码/隔离通过不等于 S05d/S05b 已通过。正常队列读取旧 retired resolution 的重复成本由主负责人另项定点评估，本轮不扩大修改。最终摘要见 [stability-pins.json](stability-pins.json)，增量独审见 [REVIEW.md](REVIEW.md)。
