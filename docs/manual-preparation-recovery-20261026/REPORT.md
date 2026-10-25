# 手动准备通道与单次中断核销

## 本地交付状态

本报告记录代码候选与必要程序代码检查，不表示控制入口已采用、旧请求已核销、应用已打包或已上线。真实采用与唯一现场核销由任务负责人串行执行，再按原生回执补记。

工作树为 `D:/codex-worktrees/manual-preparation-recovery-20261026`，分支为 `codex/manual-preparation-recovery-20261026`。从 main `3cda84efb3c2f5693b2f4f035b892d9e1cf39445` 开始，未执行 fetch、推送、合并 main、真实 Task 注册/启用/唤醒、控制包材料准备/采用、应用准备、部署、迁移或服务操作。

用户当前要求由本人分别双击固定 `准备main.bat` 和 `发布main.bat`，覆盖此前合入后自动打包及 AI 默认代发布的约定。本次只恢复通道与处理一个旧 prepare-only unknown，不新建应用包、不上线。

## 已采用闭包的承接

实际安装控制包 `d679ce9e68dd3529b7b14f74bfc92c1e1b33377744d64c1fcdd0452c619f60de` 来自 `4d74590105f366d137b141a66ca18646001eb31c`，其工具比本次 main 新。因此只承接该包 MANIFEST 指定的 33 个 controlFiles、对应安装器及必要检查/直接夹具；没有用 main 的整包覆盖已采用工具，也未承接无关应用代码。

原 manifest 见 [ADOPTED-CONTROL-MANIFEST.json](ADOPTED-CONTROL-MANIFEST.json)。承接提交 `52d45855`、`5193fca6`、`70efdd18`；独审增量起点为 `70efdd18`。该起点的 33 个 Git HEAD blob 均与原 manifest 的 SHA-256 相同。collector 原 CRLF 字节以精确文件的 `-text` 属性保留。

代码变更提交 `86578f2a7e8b1f93c5524da97ba4f14e79b39ee7`。相对已采用闭包，只修改 hook、queue、task、latest-main 和 R1b entry pins 五个控制叶，新增 `main-preparation-reconcile.mjs`；其余 28 个控制叶原字节保持。安装器随此次边界修改。R1b 历史精确 pins 保留，旧 current installer 仍归为 retirement-preserving 入口；新 current pins 绑定新源码，未引入 wildcard。

## 结果行为

- `manual-only` 固定在控制源码/manifest 内，publisher 配置字节保持。Git prepared 阶段继续执行原 retired-ref fence；committed main 事件在 binding、controlExecution、升级延后记录、写票和唤醒之前返回。升级 bridge 同样使用新手动策略入口。
- 安装器通过显式 `--restore-disabled-preparation-task` 接受仅 `enabled=false` 的精确 owned predecessor；材料保存原 installation 字节、原任务定义及 Disabled/0 前像。原 queue/rotation 锁内重核 CAS、任务定义与实例，bridge、installing 及 final hook 就位后才在原 TASK 阶段注册 enabled=true。普通 adopted reader 仍要求 enabled=true，恢复前驱没有伪装成已启用。
- `abandon-only` 只提交独立 reconciliation request，以原 dispatchId create-only 命名，绑定当前 adopted installId/state SHA/bundle/config 及原 dispatch/result SHA、目标与 packet。普通 Task 使用原 `--consume-preparation`，在 queue 锁内优先处理唯一请求并立即退出；成功、拒绝或异常均不继续准备。
- 原 S05d gate 与 writer 由旧队列及新入口共用：普通身份、全关联 unknown、deadline 加宽限、无发布标记及 rotation 空闲均保留。旧 unknown 不改写，另写原 `abandoned`、`consumePermitted=false`；只退休旧 packet，同目标未来可分配新 packet，不使用 R1b TARGET-BAN。
- 独立短 submission 锁避免 manual submit 穿过最后 pending=0 与 abandoned 写入。固定锁序 queue → submission；submit 只短持 submission，创建完成即释放，随后才允许调用方 wake 或等待。
- 请求/结果损坏、多待核销请求、代际变化、pending 准备票据、未到期、发布标记、锁忙或不完整原结果均拒绝并退出。已完成精确请求直接返回原结果且不 wake；failed/unknown/refused 不自动重试。崩溃若已落完整精确 abandoned，仅验证并补独立结果。

## 必要检查

定向 29/29 通过，覆盖单请求核销及原件保全、崩溃后补结果、拒绝分支、不进入准备、submission 竞态、committed 无配置即零作用返回、PS5 注册前 Disabled/0 与 Ready 边界、S05d 原门禁及 R1b 私有 Git ref fence。PS5 检查仅对注册前 guard 使用私有对象，不创建、修改或运行计划任务。没有业务功能验收。

34 个 JavaScript 文件通过语法检查，安装器依赖闭包可导入；35 个控制/安装器 Git HEAD blob 与实际检查文件 SHA 相同。原生 handoff runner 未改。

外部证据目录 `D:/codex-artifacts/manual-preparation-recovery-20261026/`：

- `CODE-CHECKS.log`：29 项实际输出。
- `SYNTAX-CHECKS.json`：34 项语法检查。
- `CANDIDATE-CONTROL-HASHES.json`：控制/安装器字节摘要及 28 个继承叶不变声明。
- `BASELINE.json`、`READONLY-PREFLIGHT.json`：负责人先前只读基线。配置 SHA `a461db4d0d57175d712c01d7707cc36c38b8f1d43e0ee5c1d4a5f482ca5ac9c8`，旧 unknown SHA `f1524256442c3459ddd0429ff5ae56a44d1bf58f034020b7a0563286913dc70f`；当时任务仅 enabled true→false、State=1、instances=0，线上来源 a0b0bc18。

## 负责人现场入口（本实施未执行）

先完成代码独审并确保来源干净。控制材料目录必须尚不存在；下述操作只准备控制入口材料，不准备应用包：

```powershell
node "D:/codex-worktrees/manual-preparation-recovery-20261026/tools/install-main-prebuild.mjs" --config "D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json" --out "D:/codex-artifacts/manual-preparation-recovery-20261026/control-materials" --restore-disabled-preparation-task
```

核对原材料与实际 predecessor 后，采用仍通过同一安装器原入口：

```powershell
node "D:/codex-worktrees/manual-preparation-recovery-20261026/tools/install-main-prebuild.mjs" --adopt "D:/codex-artifacts/manual-preparation-recovery-20261026/control-materials"
```

采用成功并核对配置、原件及新 adopted 代际后，仅调用一次以下高侧请求入口；当前代际由固定 dispatcher 读取并自动写入请求，不由调用者手填：

```powershell
node "D:/codex-isolated/main-manual-release-20261016/control/tools/publish-latest-main.mjs" --config "D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json" --abandon-dispatch "caa9d222-03ab-4e9f-a1d8-39ae3ed1c974" --dispatch-sha256 "6929a9edece3053c3ca395a53b91701c544155357a10be9787ef0247e65ba159" --result-sha256 "f1524256442c3459ddd0429ff5ae56a44d1bf58f034020b7a0563286913dc70f" --target "3cda84efb3c2f5693b2f4f035b892d9e1cf39445" --packet "D:/codex-isolated/main-release-packages/3cda84efb3c2-8a03d8fb-9ea443c1"
```

独立普通 consumer 回执位于 `D:/codex-isolated/main-manual-release-20261016/prebuild-queue-v2/reconciliation-results/caa9d222-03ab-4e9f-a1d8-39ae3ed1c974.json`；同名请求在 `reconciliation-requests/`，S05d 弃置在 `abandoned/`。高侧返回 submitted/woken 本身不证明核销完成。若拒绝或结果缺失，保留原请求、结果与现场证据，不另换 dispatch 或重试。

本阶段没有声明真实采用或核销完成；文档提交不改变上述已检查工具字节，最终实际采用与 main 交付由负责人按原生结果报告。
