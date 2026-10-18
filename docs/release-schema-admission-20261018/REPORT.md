# 结构准备准入与原 ece 请求终止资格

基线为 `a7041338462acb766a50df376777c619557ea4eb`，独立工作树 `codex/release-schema-admission-20261018`。上轮源码已包含 PiWorkspace 0085，实际固定控制仍是 f533/6dc 代际，未支持该结构步骤。自动 hook 选中 a704 后，已创建冻结 source；旧 `prepareMainSchemaRelease → readSchemaRecipe → planSpec` 同步拒绝，尚未创建 schema/request/invocations/publish，也未调用 binder/native。原队列写为 unknown，不能据错误文案直接重跑。

## 源码

- 在 observe 冻结选择后、DISPATCH 之前，用实际控制模块的 `assertMainSchemaPlanSupported(plan)` 检查相同提交的只读 Git 差异。该纯 export 复用原有限 planSpec，不复制迁移映射，不创建工作树或运行 binder。已知不支持记录原 failed，无 dispatch；普通身份准入仍在 fetch/observe 之前。
- 旧 e2 资格正文逐字节保持。新 ece 资格只认 ticket `7964788d-da95-49ec-bb08-2ef409faf711`、dispatch `ece64080-a14c-4314-9e91-c7a8c48171fb`、原三回执摘要、旧九文件控制闭包、配置和 a704 冻结差异。重新计算的原 plan 必须触发旧控制的同一拒绝；新控制必须支持它。
- 普通 writer 在 queue→native rotation 双锁中复核原件、冻结 source 与 packet 仅有 source、现 adopted 控制及原固定打包任务定义。独立只读 observer 在归档前/后各提供一次 nonce、owner、完整执行依赖和 HEAD/tree/clean 绑定的观察。普通 writer 再取当前 CIM：当前 opaque 逐项匹配 witness 的 PID、parent、名称、创建时间及可见命令/路径摘要；新增/漂移 opaque、实际控制路径或受保护 actor 后代拒绝。当前完整可读且无控制路径的普通 PS/Node，以及无关浏览器的自然更替不阻断；writer/observer 自身保持精确身份直到 ACK。
- observer 只读系统状态，输出只进入实体路径经核验的私有 artifact 目录，create-only；进程证明只存身份字段和命令/路径摘要。observer 保活等待普通 writer ACK，避免观察进程及调用 transport 自然结束造成误判。任务 Ready/零实例仅为辅助，不替代控制进程及 packet 观察。
- 写入 create-only 历史 resolution 前保留归档、第二次观察和新鲜度检查。原 ticket/dispatch/result、unknown 与旧 source 均保持。明确记录 `historicalActorIdentityUnavailable:true`、`terminationBasis:awaited-preparation-rejection-before-native`；不补造不存在的历史 PID 谱系，不声称源码准备没有文件系统作用，不把本资格泛化给其他 unknown。
- reader/writer 放在既有 queue 模块，实际固定控制包仍为十文件；两个 operator driver 由冻结 source 单独绑定，不能把它们遗漏成控制工具的隐藏依赖。

## 验证

私有测试覆盖实际 writer→两次观察→archive→实际 reader、queue 消费该终止事实后新目标只执行一次、其他新 unknown 继续阻断、历史原件保持、旧 e2 逐字节不变及既有 reader 回归、真实控制包 import、nonce/freshness/task/source/closure/phase/PID 漂移、嵌套编码、Node `-e`、普通 opaque 和 reparse 输出拒绝。测试使用私有目录、独立 queue pipe 和替代 rotation 接缝；不写真队列、采用控制、启动固定任务或调用生产生命周期。

`main-schema-release.mjs` 属于 PiWorkspace CODE_FILES，所以稳定后用原轻量 `pi_workspace_rehearsal.py` 生成一次新的真实私有 PG 证明。150→151、结构/权限/事务回滚/既有数据保持、有限安装器负例和 46 项私有 Pi 状态测试通过；PG 停止、口令文件删除。新证明 [schema-validation.json](schema-validation.json) 的 codeSha 为 `f951898713de24ae9fc2e5cd5d60372e3cb7fc5cc774369c5da291c245462c1b`，recipe 指向它；前两轮的证明原件不改。

正式窄候选验证引用前轮 `candidate-final-2/REPORT.json` 的固定 SHA `94251c24d5ecd43b535b975fb2de7ea023c3930522ce07f3a4cd5274f1cafdbb`。要求相同执行工具、依赖、PowerShell 模块及所有未改应用字节；结构模块只允许纯 export 逆投影，旧 queue core 只允许两个已审接缝，保旧 e2 正文。只执行本轮必要控制/队列/固定资格测试，复用前轮真实应用包/CIM/Pi/route 证据，不重复整套应用包、WSL、浏览器或业务 E2E；完整冷启动仍未执行。

原始证据位于 `D:/codex-artifacts/release-schema-admission-20261018/`。最终 `candidate-final-2/REPORT.json` 为 passed，受测 commit `cc17fe0b1b436af235be980a7caf7d2bef773f97`、tree `1157c849fe87c3b4e0eac9e1a66084e92f0c7441`；当前证明绑定和控制增量两组 exit0，86/86 通过，临时候选工作树已清理。`packageIntegrity/nativeEntryBoundary=true`，完整冷启动 false，前轮应用/Pi 证据单列复用。首轮 478dfcf3 的窄报告通过后，独审要求允许完全可读无关 PS 自然更替；本轮最小 queue/test 修复后另跑最终报告，保首轮原件，CODE_FILES 仍为 f951，未重复 PG。后续本报告纯文档增量不改变受测运行源码、recipe 或证明。本报告不把源码通过当作操作材料或控制采用通过。

## 操作交接

精确接口、普通 operator 与只读 witness 边界见 [OPERATOR.md](OPERATOR.md)。root 负责独立审查冻结操作材料、采用新固定控制、有限终止原请求、再由原固定普通任务准备最终 main。开发代理没有执行这些操作，也没有应用上线授权。

请求执行模型为 `gpt-6.1-sol/high`；实际底层型号未由工具独立确认。独立审查事实由 root 收尾记录。
