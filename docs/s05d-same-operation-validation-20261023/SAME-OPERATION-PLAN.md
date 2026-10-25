# 同一次发布操作内的退休全验复用

2026-10-23；基线 `94dd1142`。用户已明确选择“先消除同一次操作内的重复全验，保留跨次完整核验”。本文只规划，不实施或运行现场，不修改正在只读 preflight 的冻结 artifact。原 unknown、旧两个 decision/history、no-replay、40/60 秒门禁不变。

## 选择：显式、内存内、可失效的 scope

采用显式 opaque scope，不用 AsyncLocalStorage。当前链路只有少数明确调用点，传参更容易审清边界，避免 ambient scope 被异步子任务、重入或另一次 drain 继承。scope 不是授权、持久回执或已验证布尔；由退休模块内部 WeakMap 持有，外部不能构造、序列化、恢复或修改其 proof。

`withRetirementReadScope(config, callback)` 为单次顶层调用创建 token，在 `finally` 销毁；`assertRetirementAdmission`、退休 resolution reader 的可选参数显式携带 token。无 token 完整执行当前全验；无效/已关闭 token直接拒绝，不退回旧成功。新 CLI/新进程/另一次直接 API 必须重新全读。独立 observe/freeze/read API 默认不自动复用；只有发布协调器明确传入 scope 才可复用。

**只复用最昂贵且稳定的部分：**每个 retired intent 在当前只读阶段中，首次 `validateRetirementSeal` 照原规则完整通过后，内部保留它已完整哈希并验证的全部 archive snapshot/预期绑定。后续门禁重新执行原 reader 的证据、closure 和动态核验，仅将逐件 `snapshotRetirementObject` 的字节全读替换为对这些同阶段 snapshot 的全对象 stat/member/link CAS。不缓存返回的 true、不复用旧 closure、不缓存当前身份/代际/boot/ref 检查结果。

## 实际调用图与失效点

`runLatestMainCli` 入口 → admission →（consumer）`drainLatestMainQueue` → queue `assertGeneration` →历史 resolution → `observeLatestMain` 的 fetch 前/取 target 后 admission → selected admission → queue 再次 `assertGeneration` → durable dispatch → `prepareLatestMainOnce` 冻结前 admission → source/prepare。直接 check/deploy 分支也经 observe/freeze；`--prepare-only` 的提交 CLI 与后台 consumer 是两个进程/操作，绝不共享 scope。

| 边界 | scope 行为 |
| --- | --- |
| CLI 入口及同一 drain 的连续只读检查 | 共用显式 scope；每个原门禁仍完整动态复验，第一轮 archive全读，重复点只做本阶段全对象 CAS |
| `git fetch` 前 | 清空本阶段 archive witness；fetch后首个 admission 全读并建立新阶段，取 target 后永久 ban照常检查 |
| queue 写新 dispatch前 | 利用现有 `onStage('before-dispatch')` 接清空，不删原代际/目标准入。写入后 freeze前首次 admission重新全读；不要为硬凑两次而跨持久派发边界复用 |
| `prepareLatestMainOnce` 首次 `mkdir/worktree add` 等来源/材料写入前；调用 native prepare/check/deploy前 | 清空；`already-current` 无写返回不必人为新增轮次。后续如再到准入，重新全读，不要求此刻立刻重读或重做已有作用 |
| queue释放锁、下一内层目标轮次、进入等待/另一个异步 consumer | 清空或关闭；不能将上一目标的只读阶段延续到下一目标。可用既有 stage回调/明确循环点完成，不引入新调度器 |
| 正常返回、异常、取消/中断 | finally关闭并清空；任一核验失败使本scope失效，错误按原调用者语义传播，不新增重试 |

“同一次操作”允许包含多个被写边界分开的只读阶段；每阶段首次全读。因此无变化路径应消除连续门禁的重复读取，但真实次数可能为两次、三次或更多，按入口和写边界记录，不承诺固定一/两次。当前 conservative设计宁可多一次全读，也不把变化前的 proof用于变化后。

## 每个原门禁必须重新做什么

重新读取并绑定 config、当前 adopted generation/bundle/native工具、全部 retirement registry成员、原 dispatch/terminal、INTENT/SEALED及其证据引用/原件；依旧验证原 semantic、seal/boot/unknown/no-replay/targetban。重新 `collectRetirementClosure`，检查旧地址未恢复、无原来源/工件动作、注册Git源及原生metadata/引用资格；然后执行该新closure的末CAS、全部archive目录成员/叶对象属性/链接CAS、当前boot/ref/控制/native/original尾检。保留原archive根ACL及Git保全登记要求。成功只对本次门禁有效。

scope key至少绑定规范config路径/实际内容摘要、state/runtime/档案根、当前控制安装及bundle/native摘要、retirement registry集合、每件intent/seal/原结果及档案清单摘要、进程与顶层操作身份。这些身份项不同必须清空并拒绝当前scope，不自动迁移到新代际或新seal。下一次操作重新全读仍须自行满足原门禁。

**正常新来源不能被旧closure绑死。** 首次source/metadata写入之前已丢弃witness；后续门禁从当前状态重收closure，不把新worktree/新plan成员列表与旧closure作全等比较。合法新来源按现有实际区别/引用规则通过；若新根确实可执行原target，继续拒绝。对未知外部变化，archive字节/属性/链接或身份变化直接拒绝，不捕获后重新读成“新合法版本”；registry/关键证据漂移亦拒绝。非关键metadata变化只有经当次完整collector资格核验及其尾CAS才可接受，不能用“这是我创建的”标签跳过。若实现无法可靠划定其合法输入，保守清空后做一次原完整全验，失败仍退出，禁止循环刷到通过。

## 失效、并发与资源约束

scope内部状态 `active / dirty / failed / closed`；dirty表示已跨已知写边界、无可复用witness，下个门禁走原全读。failed/closed不再可用。每scope同一时间只允许一个验证进入；重入/并发使用同token拒绝，不用共享一个pending Promise给不同调用方放行；不同scope各自完整读取，互不共享缓存。现有队列/rotation锁继续负责生产互斥。

wrapper必须await全部验证，关闭时先失效、等待内部已启动只读任务drain，迟到完成不得重新写入scope或返回成功。abort检查接入已有有界读取/CAS，发生取消仍按原unknown边界报告。scope不跨长时间等待；正常阶段内仍按原门禁预算运行，不通过scope延长40/60期限。对象数沿用已有上限，仅保留本阶段各intent的必要snapshot引用，释放时清空；不复制大Buffer、不增加磁盘cache、外部proof注入或持久“已验证”marker。

## 最少代码面与无循环导入

建议只改五个现有文件和一份定向测试：

1. `preparation-retirement.mjs`：内部WeakMap/session生命周期；从现reader抽出完整archive读取/同阶段archive CAS两分支，其它顺序和检查共用，首次全验成功尾部才填入witness。
2. `preparation-retirement-admission.mjs`：可选scope及wrapper转发，运行时lazy import退休模块；仍每次读取registry/ban，不新增顶层退休依赖。
3. `preparation-resolution.mjs`：只在退休schema分支透传可选scope；旧两decision/history路径完全不变，保留现lazy import。
4. `main-prebuild-queue.mjs`：透传opaque scope到resolution reader，并在循环/锁边界调用协调器给出的有限清空回调；不导入退休模块或理解proof，不改变dispatch/result/重试语义。
5. `publish-latest-main.mjs`：顶层wrapper、各原admission/observe/once参数传递、上述明确写边界清空；直接独立API无scope继续原全验。`controlFiles`沿用现依赖闭包，不加新服务。

实施者可调整局部命名，但不能用全局Map/ALS替代明确生命周期，也不能给公开CLI增加任意proof/root输入。测试注入仅限现私有拓扑，不以mock true跳过真实资格/CAS。

具体参数接线：`assertRetirementAdmission(config,target,{scope}={})`；`readPreparationResolution(directory,dispatch,terminal,{retirementScope}={})` 仅将token传给 `readRetiredPreparationResolution(directory,dispatch,terminal,value,{scope}={})`；后者给 `validateRetirementSeal({config,record,seal,scope})`。发布层 `observeLatestMain`、`prepareLatestMain`、`prepareLatestMainOnce`、`drainLatestMainQueue` 的既有options增加 `retirementScope`，queue options增加同名token及 `invalidateRetirementScope(reason)` 回调。`runLatestMainCli` 包住单次内部执行，显式把token传入；无token的独立API保持原全读。wrapper/清空函数通过admission模块lazy转发，不让queue顶层导入retirement。native前“清空”仅丢本次内存witness，不删证据、不撤回dispatch、不重新调用native，也不新增一次准备；随后任何新准入自然回到完整读取。

## 最小验收与限制

- **计数/等价：**同scope连续两个门禁 archive字节全读一次、完整动态/closure/statCAS各两次；跨fetch、dispatch、source写边界后的首次门禁各重新全读。无scope两调用、新scope两调用分别全读；旧两个decision/history行为不变。
- **变化：**在第一次成功后改archive叶/成员/链接、seal/intent、config/代际、恢复旧source或改变ref fence，下一门禁必须拒绝且不能返回缓存成功；失败后的token不可再用。只改合法新worktree/plan的路径通过真实生产创建边界失效后，可由新鲜collector正常资格化，不产生“旧closure永远不等”的死锁。
- **隔离：**并发同scope拒绝、不同scope不串proof、异常/取消/未await子任务退出后不能复活scope；队列下一目标及独立consumer不能复用前scope。实际parser和原消费者接线须覆盖，不能仅测session helper。

复用94dd已有校验，只补上述计数和变化边界、原Sol独审增量；不运行新的生产dispatch/准备，不重复当前只读preflight。交付明确减少的是**同阶段重复全读倍率**，各门禁的动态成本仍在，跨操作至少一次完整archive读取仍在；这不是消除常态数分钟成本或完成整个发布稳定目标的证明。
