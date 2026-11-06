# 冻结迁移策略的两个监控条件

新增 CI 步骤读取仓内 Git 跟踪的脚本、工作流及 package.json scripts。它核对冻结策略参数（含可识别的 argparse 字面缩写）、已知 Python 演练包装器，并在合成路径上执行实际 installer 的 context、install 和 finalize 函数的来源检查。检查覆盖基线、不同 delta 身份、另一次操作的同名 source 及 runtime/app。本机 CI 脚本通过。负例包含新增 npm/UTF-16 PowerShell 调用、弱化目录判断、改绑 ROOT、删除入口守卫及传错操作 ID。

此检查只在仓库 CI 入口执行，不进入制品准备或发布器。动态构造的参数、未跟踪或仓外脚本、已安装进程的实时行为不在这项静态监控的可见范围。仓内分支提交后需经项目使用的 CI 触发条件才会持续起效。Astra 对最终 `bdfb02df` 增量通过。
