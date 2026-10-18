# 打包统一使用普通用户权限

## 当前需求与方案

用户要求后续系统每次打包均由当前登录账号的普通权限进程执行，即使调用方是管理员进程；并要求选择更合适的长期方案。本轮授权包含打包入口调整和准备，不包含应用部署、服务启停、业务导入或对外通知。

基线为 main `4b733d1aed4bdc619adccb37debd61d57f1ce6fb`，在独立 `codex/prebuild-standard-user-20261018` 工作树开发。主工作区既有改动保持。

独立方案选择固定按需 Task Scheduler 入口，避免逐次注册/删除临时任务及另一套转交状态。任务无定时或登录 trigger、不保存密码、不常驻；只执行固定准备队列 consumer。任务使用当前用户 SID、InteractiveToken、LUA，调用时核验允许的交互会话，consumer 在观察、冻结或准备前验证实际身份与普通权限。原 native publisher 的普通权限断言保留，不能以删除断言或接受高权限构建满足需求。

Task Scheduler 唤醒成功不表示制品完成；原 queue ticket、dispatch、result 与真实 `PREPARED.json` 继续承担执行和完成证明。多实例采用 Parallel，由原队列互斥串行化实际准备，并保留释放锁后的请求复查。

## 本次原始失败

上轮库存修复 main `4b733d1a` 的自动准备从管理员进程继承权限，在 `publish-main.mjs` 的普通用户断言失败，尚未调用 `publishPreparedMain`。原队列 dispatch `e2a76305-5a58-4814-8418-a35270a55efe` 保留 unknown 并阻塞后续准备。原 packet 为 `D:/codex-isolated/main-release-packages/4b733d1aed4b-c5d5bb6f-a9e3fdb9`。

闭合仅针对这个已核验的前置拒绝：继续绑定原 dispatch、ticket、目标、packet、日志、源码和真实前驱，在原队列互斥内追加精确 `closed-before-native` 记录，不改写或删除 unknown，不把旧请求标为 prepared。原源码冻结、请求和日志等文件作用保留，只能表述为“没有进入原生准备”。若原执行或相关后代未退出、存在迟到操作、出现原生准备/发布开始作用、前驱或原件变化，则拒绝。

该分支不重试旧操作、不刷新原 deadline。闭合证据验证后，由正常最新 main 入口生成新版本的准备请求，只构建包含库存功能修复及权限入口修复的最终版本一次，避免先完整构建过时的 `4b733d1a` 包。

## 验证与采用边界

必须以私有任务/目录验证真实管理员调用到同用户普通权限 consumer 和 native child；mock 或设置 RunLevel 本身不能证明降权成功。验证任务定义篡改、错误身份/会话/权限、重复唤醒、退出临界请求及结果未决边界。发布兼容性继续使用精确候选的既有验证入口及相应适配器。

已完成的私有实际验证：

- 管理员父进程 `elevated=true / integrity=12288` 经固定按需任务启动同 SID、同会话的普通子进程 `elevated=false / integrity=8192`；普通子进程自身也成功触发同一固定任务。
- Task action 使用 `ProcessStartInfo.EnvironmentVariables.Clear()`，在 Node 启动前安装固定 `publisherBaseEnvironment`；实际 Node 子进程环境逐字段一致，注入的 `NODE_OPTIONS`、`GIT_DIR`、`GIT_CONFIG_COUNT`、`PSModulePath` 均未进入。
- 私有精确闭合与 Task 定向验证 9 项通过，包括已有原生标记、前驱变化、原件篡改，以及真实多层编码命令中的迟到进程均拒绝闭合。没有进行正式构建、服务或业务操作。
- 原失败日志保留：Task Scheduler 对 UserId 的账号名规范化及 PowerShell 原生调用隐式补回 `PSModulePath` 的初次测试失败，与更正后的通过证据分开。源码/证据在 `D:/codex-artifacts/prebuild-standard-user-20261018/`，最终候选兼容结果单列。

源码、控制入口材料准备、控制入口采用、原 dispatch 续接、最终 main 制品准备与应用上线分别报告。不用控制入口安装成功代替应用已上线。

方案咨询请求 `gpt-6-astra / high`，实现与独立关键审查请求 `gpt-6.1-sol / high`；调用工具未额外返回可独立核验的底层模型。方案角色不承担编码或生产操作。

## 官方依据

- [Task Scheduler 安全上下文](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks)
- [InteractiveToken 登录类型](https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-logontype)
- [多实例策略](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-multipleinstances)
- [RunEx 唤醒行为](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-iregisteredtask-runex)
