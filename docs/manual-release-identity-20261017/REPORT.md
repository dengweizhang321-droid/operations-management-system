# 手动发布与自动准备的实际子进程环境一致性

## 现场与证据边界

2026-10-17 13:34–13:37（上海时间），目标 `6fbbb526270e6fc678db83df2586401ccb90d9ff` 已有原生PREPARED，在 `verifyBoundWorkerSource` 以 `Bound source/configuration/toolchain identity changed` 停止。原准备失败记录为 `maintenanceStarted:false`，没有部署STARTED/SUCCESS，未进入维护或切换。

13:42起只读重采同一冻结源码的原生 `workerPreparationIdentity`，与原source-binding的源码、inventory、Node/npm闭包、运行配置和环境摘要全部一致。原失败进程已经退出，旧日志没有分项环境摘要，不能声称已回读其具体变化字段或证明历史失败时其他输入从未短暂变化。

本次复现了入口的确定性缺陷：`publisherEnvironment` 省略LOGONSERVER，但Windows libuv会把缺失的required variable从父进程补入，显式env对象并不保证实际子进程完全相同。两个父进程分别设置 `fixture-auto` / `fixture-manual` 后，旧函数输出的对象都没有LOGONSERVER，实际子进程却分别包含不同值。此机制足以触发原完整环境指纹拒绝；原测试只比较对象，遗漏了OS启动层。上游实现见 [libuv process.c required_vars](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c)。

## 修复

- 安装器首次保存有限白名单Windows基底 `publisherBaseEnvironment`，升级沿用原基底。仅包含发布所需Windows基础变量，不复制整个shell环境、Git选项、NODE_OPTIONS、数据库或渠道密钥。
- Git事件→后台runner→准备协调器→原生准备、人工协调器→原生发布均使用该基底。LOGONSERVER显式传递，包括空值，阻止libuv从不同父窗口补入其他值；其余libuv必需变量必须齐全。
- 配置拒绝额外变量、大小写歧义、NUL、数组或缺少必需项。PATH仍由实际Node/系统/Git绝对位置构造。
- 原生完整环境SHA、源码/配置/工具链、权限、前驱、互斥、未知保护和实际发布顺序保持。修改的是实际启动输入，不从原生指纹中排除LOGONSERVER或忽略绑定错误；旧失败和不可变包不改写。

## 验证与采用

- 定向入口、队列、原生组件和进度共69个不同测试通过。包括真实父→子→孙Windows进程完整环境对照、不同父LOGONSERVER/TEMP/TMP/USERDOMAIN、空LOGONSERVER不回填、额外NODE_OPTIONS/密钥拒绝、安装升级保留基底及原未知/失败不重试分支。
- 对失败包的原始 `source-binding.json` 使用原封存的 `readWorkerSourceBinding` / `verifyBoundWorkerSource`，故意改变父进程LOGONSERVER/TEMP而子进程使用固定基底，13:47:28原生源码绑定复验通过，完整环境摘要仍为原 `35c53e10…8414b`，8918文件源码树仍为原 `9c7ac8b5…d6f6f`。仅只读核验源码绑定，不调用plan/apply/维护/迁移/服务入口；不冒称整个旧发布包已完成所有原生制品复验。结果保存于本机 `VERIFY-ORIGINAL-BOUND-SOURCE.json`。
- 独立审查按当前映射请求Sol High，只读检查当前差异，独立69项测试及libuv隐式继承反例均通过，无阻断；并核对本机Node v24.18.0 / uv1.52.1及[对应源码](https://raw.githubusercontent.com/nodejs/node/v24.18.0/deps/uv/src/win/process.c)的11个required variables。实际底层型号未独立确认。控制入口安装、实际BAT检查及制品状态记录在本机交付证据。
- 本次用户授权修复后继续手动发布，没有代用户执行上线。原固定BAT路径保持，main新目标须有自己的精确准备结果，旧6fbbb包完成记录不代替新目标。

诊断与验证证据：`D:/codex-artifacts/manual-release-identity-20261017/`。不保存全量环境变量或秘密值，不把隔离复现等同于失败进程的历史取证。
