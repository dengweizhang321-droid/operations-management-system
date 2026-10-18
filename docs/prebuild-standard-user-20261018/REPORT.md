# 打包统一使用普通用户权限

## 当前需求与方案

用户要求后续系统每次打包均由当前登录账号的普通权限进程执行，即使调用方是管理员进程；并要求选择更合适的长期方案。本轮授权包含打包入口调整和准备，不包含应用部署、服务启停、业务导入或对外通知。

基线为 main `4b733d1aed4bdc619adccb37debd61d57f1ce6fb`，在独立 `codex/prebuild-standard-user-20261018` 工作树开发。主工作区既有改动保持。

独立方案选择固定按需 Task Scheduler 入口，避免逐次注册/删除临时任务及另一套转交状态。任务无定时或登录 trigger、不保存密码、不常驻；只执行固定准备队列 consumer。任务使用当前用户 SID、InteractiveToken、LUA，调用时核验允许的交互会话，consumer 在观察、冻结或准备前验证实际身份与普通权限。原 native publisher 的普通权限断言保留，不能以删除断言或接受高权限构建满足需求。

Task Scheduler 唤醒成功不表示制品完成；原 queue ticket、dispatch、result 与真实 `PREPARED.json` 继续承担执行和完成证明。固定任务采用 Queue：新唤醒等待原宿主退出后启动，避免同一任务宿主重叠；原业务队列互斥及释放锁后的请求复查保留。consumer 不等待排在自己之后的实例完成。升级还须在原桥接、进程收敛及 CAS 窗口内确认精确任务为 READY，拒绝更新仍在运行或排队的任务。

## 本次原始失败

上轮库存修复 main `4b733d1a` 的自动准备从管理员进程继承权限，在 `publish-main.mjs` 的普通用户断言失败，尚未调用 `publishPreparedMain`。原队列 dispatch `e2a76305-5a58-4814-8418-a35270a55efe` 保留 unknown 并阻塞后续准备。原 packet 为 `D:/codex-isolated/main-release-packages/4b733d1aed4b-c5d5bb6f-a9e3fdb9`。

实现期间主线已交付针对同一事件的有限归档 reader/operator。本任务复用该实现，移除自己重复的 resolution 模块、CLI 和 schema；历史八文件/v2 闭合契约保持，新 Task 控制包为九文件/v3，不放宽历史证明。

现场随后由既有流程产生历史 resolution。当前八文件 v2 控制 `e24074cc935f8f46f89ca702856d86ae92a3d607b06486a56a9cff3fb76f6b01` 来源为 `9a45d8be`；本会话仅只读调用实际安装的 `readAdoptedControl` 与 `readFixedAdminRejectionResolution`，核验返回 true，原 terminal 仍为 unknown。没有重复执行 writer 或改写原件，也不将旧目标标成 prepared。源码冻结、请求和日志等实际文件作用继续保留，历史结论仅为没有进入原生准备。

由正常最新 main 入口准备包含库存功能修复及权限入口修复的最终版本，避免先完整构建过时的 `4b733d1a` 包。历史 resolution、原队列证据及归档对象作为一个保留单元；Task v3 继续按主线 reader 校验历史 v2 证明。

## 验证与采用边界

必须以私有任务/目录验证真实管理员调用到同用户普通权限 consumer 和 native child；mock 或设置 RunLevel 本身不能证明降权成功。验证任务定义篡改、错误身份/会话/权限、重复唤醒、退出临界请求及结果未决边界。发布兼容性继续使用精确候选的既有验证入口及相应适配器。

已完成的私有实际验证：

- 管理员父进程 `elevated=true / integrity=12288` 经固定按需任务启动同 SID、同会话的普通子进程 `elevated=false / integrity=8192`；普通子进程自身也成功触发同一固定任务。
- Task action 使用 `ProcessStartInfo.EnvironmentVariables.Clear()`，在 Node 启动前安装固定 `publisherBaseEnvironment`；实际 Node 子进程环境逐字段一致，注入的 `NODE_OPTIONS`、`GIT_DIR`、`GIT_CONFIG_COUNT`、`PSModulePath` 均未进入。
- 原型阶段的私有闭合与 Task 定向验证 9 项通过，包括已有原生标记、前驱变化、原件篡改及真实多层编码迟到进程拒绝。重复闭合代码在复用主线时已移除，这组历史原型结果不冒称最终源码的证明；最终 Task 与归档 reader 组合验证另列。没有进行正式构建、服务或业务操作。
- 原失败日志保留：Task Scheduler 对 UserId 的账号名规范化及 PowerShell 原生调用隐式补回 `PSModulePath` 的初次测试失败，与更正后的通过证据分开。源码/证据在 `D:/codex-artifacts/prebuild-standard-user-20261018/`，最终候选兼容结果单列。

最终候选测试另外发现并修正两处直接边界：PowerShell 模块夹具由目录名猜测改为读取实际 Core 模块声明，仍要求原 PS5 真实失败、受控 runner 真实成功及异常退出拒绝；Task 的 `RunEx` 在传 SID 时同时设置 `TASK_RUN_USE_SESSION_ID | TASK_RUN_USER_SID`。同一受控环境对照中，旧 flags=4 重新复现普通进程二次唤醒缺失，新 flags=12 通过，但随后完整组合的 Parallel 策略仍失败，故 SID 合同修复不被当作该错误的充分原因。

Queue 策略的私有受控验证通过，记录第一宿主结束 `11:10:01.792Z`、第二宿主开始 `11:10:02.846Z`，证明排队后启动；不增加期限或自动重试。原 `0xC0000142` 失败、SID 修正和 Queue 验证分别保全，最终冻结候选兼容结果单列，不将其概括为所有同错误码的原因。

已无冲突整合主线的准备复用、发布队列 lease、维护前置与 Pi 变更；本任务验证以最终主线基准和本任务完整差异为范围，不覆盖或重写其他任务的业务验收结论。

源码、控制入口材料准备、控制入口采用、原 dispatch 续接、最终 main 制品准备与应用上线分别报告。不用控制入口安装成功代替应用已上线。

方案咨询请求 `gpt-6-astra / high`，实现与独立关键审查请求 `gpt-6.1-sol / high`；调用工具未额外返回可独立核验的底层模型。方案角色不承担编码或生产操作。

## 官方依据

- [Task Scheduler 安全上下文](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks)
- [InteractiveToken 登录类型](https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-logontype)
- [多实例策略](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-multipleinstances)
- [RunEx 唤醒行为](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-iregisteredtask-runex)
- [Task Run 标志位](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/ne-taskschd-task_run_flags)
- [SchRpcRun 的 SID / 账号名合同](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tsch/77f2250d-500a-40ee-be18-c82f7079c4f0)
