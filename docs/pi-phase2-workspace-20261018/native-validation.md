# 有限 151 发布入口原生验证

使用独立任务验证器 [pi-workspace-schema-native.test.ps1](../../tests/pi-workspace-schema-native.test.ps1)，未修改旧验证器或旧 150 门禁。

| 原生进程 | 结果 | 回执 |
| --- | --- | --- |
| Windows PowerShell 5.1.26100.9444 | 21/21 | [PS5](native-evidence/ps5.json) |
| PowerShell 7.6.5 | 21/21 | [PS7](native-evidence/ps7.json) |

以 `0be03eca` 的实际 Git blob 为前驱，通过 PowerShell 原生 Parser AST 定位并仅移除新增 151 的两条变量赋值、单个有限分支和五个 CopyApp 数组成员。余下全文件 token 指纹与前驱相同，覆盖原参数、全部函数及顶层语句；统一行尾、忽略注释/空白后指纹为 `00318b0df5b5010279a06a40c4e6e97b0261853925efc70e8a20561917765502`。该比较不声称原文件的行尾字节完全未变。

实际调用库中的 `Assert-NoUnapprovedProtectedAiMigration`，只替换外部路径观察、JSON 读取和原生子进程边界，验证 PrepareApp admission/successor、DeployApp deployment/successor、Django migrate release。新 151 验证器成功只调用一次；数组根、数组 status、布尔 status、拒绝状态、多份 JSON、无 JSON、非零退出、启动失败、输出截断、缺少验证器，以及字符串冒充退出码或布尔字段均拒绝，且不会回落旧 150 分支。旧 150 successor 仍使用原验证器。

新 151 分支增加局部类型核验：完整未截断的原生结果、实际 int ExitCode、bool LaunchFailed、单个原始 JSON 对象与实际 string status=verified。没有更改旧 150 的解析或准入语义。

`bi-app-adopt.ps1` 使用真实原生进程、真实参数绑定及 SchemaOnly/Execute 前置策略。断点位于第 14 行、读取正式 runtime 之前，固定 `[Environment]::Exit(0)` 结束私有子进程；未执行维护、迁移、应用替换或任何正式路径观察。所有 mock 仅存在测试进程，不写入运行包。

`nativeColdStart=false`：本材料只证明有限代际准入、原参数入口及未改生命周期主体；没有把它称为 Start/Stop 冷启动验证。完整结构安装与实际包复制、部署、ACL 边界由主任务的独立材料记录。

新增的第五个复制成员为独立 Runner 升级安装器。源码 Runner 的隔离 user-unit 冷切换已实际运行；该证明与这里的有限 schema 准入分开，未声称全 Django 栈冷启动。
