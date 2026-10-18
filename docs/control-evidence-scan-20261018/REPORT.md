# Control 操作证据扫描阻断修复候选

2026-10-18。本报告保存修复候选阶段的事实；编写时尚未恢复真实 control，也未发布应用。最终源码、独立审查、候选验证及生产回执在外部证据目录记录，不为补记实时状态再改本报告。

原基线为 `2b022c16b36ec0415a85db81b92502f5c2ab81eb`。实际 control 采用在 S4 后因 `Release operation evidence redirected` 失败，保留同 intent 的 installing 状态。原因是 `nativeOperationBindings` 泛递归 releaseDirectory，将成熟 packet 的正常 `source/node_modules` junction 当成操作证据重定向。此次不删除 junction，不改原材料、安装状态或已冻结来源。

修复只改变 installer 的证据发现投影：packet 下 `publish-*` 的根层 started 记录、`preparation`、其直接 `verify-*`，以及 `publish-main-known-resume.mjs` 明确绑定的历史 resume 目录。source 只核根目录为原物理普通目录及其身份，绝不枚举源码、依赖或构建产物子树。真正证据及父路径继续拒绝重定向、多硬链接、读取中替换与目录漂移；JSON 和 operation SHA 使用同一次受控文件读取。既有成员预算、script/action/at 契约及 WorkerApply 非脚本记录语义保留。

进程分类、File/EncodedCommand 解码、PID 创建身份、旧窗口收敛、锁顺序、同 intent resume/CAS 和唯一 adopted 边界均未修改。8 文件 control bundle 不含 installer，故经审新工具可以消费原 intent 和原 bundle；此处没有执行实际恢复，也不把旧应用包改绑到新 main。

私有验证入口为 `node --test --test-concurrency=1 tests/main-control-upgrade.test.mjs`；冻结候选另由 `tools/verify-release-candidate.mjs --base 2b022c16b36ec0415a85db81b92502f5c2ab81eb` 选择实际受影响组。新增夹具覆盖 27 个成熟 packet 的真实 Windows 依赖 junction，断言未枚举 source，发现四类 producer 位置的 30 条 native 记录，并核原函数在 S4 失败后同一份私有材料原字节 resume。原函数比较是从基线提取的精确 scanner 子函数，经 installer 的私有阶段回调在 S4 调用，不冒充完整旧 installer 整轮。

该定向安装组于 07:57:24.039–07:59:00.808 UTC 通过 33/33，原始退出码为 0，耗时 96.77 秒；见外部 `control-private-3.json` 及对应原日志。固定候选校验的独立结果以外部回执为准。

redirect/身份负例覆盖 releaseRoot 及父链、packet、publish、preparation、verify、source 根、started 候选 junction、文件硬链接、非普通文件、不完整身份、文件替换、目录替换/增员及既有预算。原有真实 File 与嵌套 Base64/JSON EncodedCommand 孤儿子进程、已 link 旧 hook、同 intent resume、外来指针及逐阶段硬退出回归继续使用私有 queue/rotation pipe。普通用户实际文件 symlink 创建尝试返回 EPERM，原失败日志保留；没有提权，该文件 symlink 类型不冒称实测通过。

外部证据索引：

- [本次修复候选证据目录](D:/codex-artifacts/control-evidence-scan-20261018)：原始退出码、stdout/stderr、固定候选 verifier 和交接清单。
- [原失败独审](D:/codex-artifacts/release-three-optimizations-20261018/CONTROL-ADOPT-FAILURE-REVIEW.md)。
- [同意图恢复方案](D:/codex-artifacts/release-three-optimizations-20261018/CONTROL-RECOVERY-PLAN.md)。

本次修复验证不取得生产锁，不写真实 hook/config/state，不调用生产服务或数据库。新的最终 main 制品仍须由根负责人按正常固定入口准备；control adopted、main PREPARED 与应用上线分别以各自原生回执判定。
