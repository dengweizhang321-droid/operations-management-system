# 普通用户准入与固定 e2 准备协调

本增量基于已验证并合入的 `aaca18485021b6f98107fe168b69c8f57d55ee46`。其完整机器报告 SHA-256 为 `f4d7678e3c34d91c30aa44b05628521efbdfa55fb16d0ac0a2e3f5dc743ee33c`；App/Pi/19db 维护桥字节不变，复用该证明，不重跑这些功能。本次仅改变准备队列、固定 main consumer 的只读普通用户准入及相应验证适配。

## 已见问题与修正

旧 bundle `0397f12e…896b3` 在管理员上下文中为 `4b733d1a…ce6fb` 创建 dispatch `e2a76305-5a58-4814-8418-a35270a55efe`，source 发布入口随后在普通用户门禁拒绝。原 ticket `d4dbd5aa-56b0-4705-834b-d6ee7dff1c79` 因 DISPATCH 后子进程失败保守记 unknown。原生准备未开始，但 worktree、请求、junction 和日志等控制面作用已经发生，不能称整轮零效果。

未来 consumer 在 pending 与代际检查后、observe/fetch 和 DISPATCH 前执行原固定 PS5 `IsInRole(Administrator)` 只读探测。管理员、探测失败或不明确输出保存 `ordinary-user-before-dispatch-v1` 的 blocked 终态，无 dispatch、无原生准备；后续普通用户新请求可继续。读取时明确拒绝把已有 dispatch 的 ticket 降成该终态。source 原普通用户门禁保留。

新代际 ticket 的 blocked 结果仍与自己的 config/bundle 严格绑定。其 blocking prior dispatch 独立按 ID/SHA 绑定，避免 adopted 后引用旧 e2 时被错误要求同代。这个修正不解除任何 unknown，也不创建新的 dispatch。

## 固定历史协调

reader 只接受上述精确 e2/d4、旧 config/bundle、原 unknown/dispatch/ticket SHA 的限定 resolution。它只闭合“这一次原生准备未开始、旧请求已终止”，保持原 unknown、blocked 和全部原件；不标 prepared，不重跑旧请求，不约束或追认任何未来另行手动调用 4b packet 的结果。其它 unknown、缺失或篡改继续失败关闭。

外部 operator 材料位于 `D:/codex-artifacts/release-readiness-fixes-20261018/queue-admin-resolution-v1`。writer 在相应新八文件 bundle 已正常 adopted、普通用户及 queue→rotation 锁内验证后工作。复制有限证据后再次执行独立 observer，复核原件、packet 未进入原生阶段、原 actor 退出及无迟到控制进程；复用的 34284 PID 不终止。存在 pending 或其它未解 dispatch 时拒绝。archive 部分失败或最后 observer 失败均不发布 resolution。

必要原字节 copy-only 封存到 e2 专用证据对象目录：gate 前十四个第一方 source 工具、旧 bundle 八文件、请求/范围/日志/actor 证据及本次 adopted 的有限安装证明、配置/shim/hook/八文件。ticket/dispatch/unknown/blocked 继续绑定队列原件。无需永久保整个旧源树或 node_modules；历史 reader 核封存依赖，不绑定后来的 current pointer/最新 bundle，也不把当时 freshness 变成永久时效要求。删除封存依赖仍拒绝。

## 验证与证据

- 实际 inline reader 的 writer 形状→读取测试、旧 packet 清理/后来控制代际、原件/档案篡改、假 prepared/replay、错误 observer/transition、其它 unknown 与 pending、PS5/PS7 observer 纯校验均通过；随后新增固定跨代 blocked 及 prior SHA/当前 ticket 代际反例通过。原 unknown/blocked 保留。
- 普通用户准入四项通过：管理员/探测异常在 fetch/dispatch 前 blocked、后来普通新 ticket 成功、零原生准备，以及拒绝已 dispatch 的伪降级。
- 原 queue 快速检查、精确逆投影正负例及一次真实八文件私有安装/导入边界通过。正式窄机器验证由交付负责人在冻结提交上执行并把结果保存在仓库外，不为结果文字再改源码树。
- 外部 writer 五项私有编排全部通过：成功的最后 observer 在复制之后；pending/其它 unknown 拒绝；最后 observer 或档案部分写入失败时无 resolution、原 unknown 不变；queue→rotation 获取并反序释放，锁可重获。该层在私有源码副本中替代 source identity、角色、adopted 与 observer 接口，不冒称实际生产采用/CIM。原始输出与输入 SHA：`queue-admin-resolution-v1/private-verification-final/REPORT.json`，SHA `72da5370c806f096fc760d2a330dae01c1a5ceff3038d2244782e4490834f0b0`。

窄 profile 只在精确 aaca 基线、原报告 SHA、queue helper/准入终态/依赖关联/dispatch 接缝以及 consumer 只读 probe/回调均严格逆投影相等时启用；同时比较原五个执行工具、依赖 physicalRoot/tree 和 PS 模块 root/tree，漂移拒绝复用。任何其它 source 变化不获得减免。

执行者未运行真实 writer、控制采用或应用部署。材料交付后由发布负责人在已授权的本机控制维护与 prepare-only 范围执行；业务版本仍是 19db，应用上线、停启及迁移不在本增量操作范围。
