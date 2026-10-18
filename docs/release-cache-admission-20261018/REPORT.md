# 离线依赖准入与固定 0b 协调

应用批准目标仍为 `b2ef81c7c6eecdb59894e55021b835b6a8baf0b4`，tree `81bab93e9996fa9edd3c1ab5cd8869fad48eda73`。本任务控制提交单独采用，不把后来的控制 main 当作应用目标；不改冻结 b2、原 c7、原三队列回执或原 schema。

固定入口在 observe 冻结选择之后、durable dispatch 之前，同时核实际控制 schema 能力与该选择的 package-lock/离线依赖声明。锁不符按原 failed 终态退出，没有 dispatch/native unknown。安装器仅接受显式 dependency-update，绑定旧 CONFIG CAS、普通离线成功回执、实体 node_modules/.package-lock.json；只替换 dependenciesDirectory/cacheLockSha256。已核所有权且定义相同的普通准备任务直接复用，避免无意义重注册被 ACL 拒绝。

新 `FIXED_CACHE_0B` 只协调 dispatch `0b4674f2-287d-453a-9094-a8f3245886a0`。固定 c7 完整十工具、旧 A0/CONFIG/INTENT/TRANSITION/dispatcher/hook、两个原 actor、原 ticket/dispatch/result、schema/recipe/validation 均按原字节归档；只重算纯离线锁比较，绝不调用旧 binder 或 prepare promise。terminationBasis 为 `awaited-cache-lock-rejection-before-native`，schemaBindingCompleted=true，nativePreparationStarted/prepared/publicationPerformed/retryOriginal=false。

普通 writer 沿原 queue→rotation 双锁，采用前后两份独立高权限只读见证；每次新 nonce、owner、source/closure、task 定义与 idle、原 actor 退出或严格出生身份重用、完整解码控制 census、packet 仅 source+精确 schema。普通端 fresh CIM 对 opaque、实际控制路径、受保护 actor/后代按原门禁复核；重用原 PID 还逐项匹配本次完整 witness 的 birth/parent/name/可见 hashes。缺字段由见证支撑，不能按空路径判无关。归档后第二次复核，再 create-only 写独立 resolution。原 e2/ece 块不变，ticketResult 原样保留 unknown；历史 reader 不永久依赖后来会合法改变的 packet 或当前控制代际。

## 验证与证据

- 核心私有闭环首轮 21/21；最终又补 ordinary reused-PID witness 漂移、6/7 位出生日期同瞬间拒绝。包括每个 25 原件变字节、schema 缺失/变化/额外文件、junction/request/晚到效果、旧 actor、过期/错误 nonce/opaque/task、历史 census 谎报/tree 漂移、新 unknown/pending 和实际十文件 bundle import。
- 组合定向首轮 84/86，两个失败为调用 shell PATH 没有 pwsh.exe（ENOENT）。补回固定 control-host PATH 后仅复验这两个 PS7 用例，2/2；日志 `D:/codex-artifacts/release-cache-admission-20261018/ps7-corrected-targeted.log`。这不代表实际普通 token 全机可见性演练。
- 结构摘要只读重算通过：`b95550b3aadf2c5265d8edcacb7d11250d76247e4f86a57d0bd891832722bf43`，与 b2 原 proof/recipe 一致，newPostgresExecution=false；复用原 b2 私有 PG 证明，不重复结构演练。
- 所有新增入口精确接入原 candidate verifier supported 清单；0b/旧 ece/依赖准入与更新测试纳原 preparation-queue-control 组。正式候选结果在 source 冻结后由原入口生成，不能把本段当作候选 passed。
- 原 c7/A0 25 项 create-only 快照：`D:/codex-artifacts/release-cache-admission-20261018/OLD-C7F-0B/ARCHIVE.json`，SHA `ebdc58d027bd98dc8130a988c358dde4ebcc6f2be29f5dec4a244f23b544b167`。

外置普通离线材料在 `D:/codex-artifacts/release-schema-admission-20261018/offline-dependencies-8ec00f`。v1/v2 原件和失败记录保留；v3 用真实 PS5 JavaScriptSerializer 字典精确读取空键 npm lock，只补两份已核 SHA512 本地缓存对象、创建新 prefix、复制两脚本 postinstall 闭包，再原 npm ci offline。独立 v3-attempt 保存 task 审计，create-only FATAL 保全早期失败。执行由发布负责人和独审串行负责；本实施代理未执行真实安装、控制采用、队列协调、准备或应用切换。

实施模型实际身份未独立确认。Astra High decision 与独审意见分别由独立代理提供；不能把请求模型配置写成机器实际模型证明。
