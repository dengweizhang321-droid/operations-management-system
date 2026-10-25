# 管理员只读采集启动包 V1 复审

2026-10-11；仅源码复审和非管理员受控测试。没有运行 `-Launch`、UAC、现场进程采集或生产操作。此记录审核 launcher `77ef403c5eb50c231f7e48a8b85cad7163fb6d92a89f7389b3a25afeb56b021a`、evaluator `f8614d083143670f2f7383a6536fa8c79a0e40bf1c827feed6314d904f72c8ce`；不是后续修订签名。

## 需先处理的边界

1. **已复现的额外写入。** Node 子进程仅删除 NODE_OPTIONS/NODE_PATH/NODE_COMPILE_CACHE，仍继承 NODE_V8_COVERAGE。将它指向本轮测试目录后，原 transport 实际产生一个额外 coverage 文件。NODE_REDIRECT_WARNINGS 同样不应保留。建议删去所有继承 NODE_*，必要项目显式加入；不得把当前包描述为仅写三个固定证据文件。
2. **Node 校验后按路径启动。** collector/evaluator 使用已捕获、已 hash 的字节执行，这一边界正确；Node 则 ReadPinned 后关闭读，再按路径启动，不能把相同论证直接用于二进制。可用拒绝 write/delete sharing 的只读文件句柄，在 hash 前打开并保持到子进程退出，同时核原路径祖先。还需承认依赖 Windows 安装目录权限，不能声称涵盖全部 DLL/加载器信任链。
3. **输出目录物理边界。** 三个文件均 CreateNew，不覆盖旧证据；但 source 的 reparse 检查未应用到输出父目录。固定字面路径不是物理目录证明。管理员采集前应检查固定 E 目录及祖先没有 reparse，并在写入处保持同一安全边界；不能允许重定向到目录外。此项是代码边界缺失，本轮未制造现场 junction 或改动实际证据目录。

## 已核成立的部分

- 已批准 packet SHA 在低权限层和 encoded 高权限 bootstrap 都复核，后者再核同一 Windows SID 与管理员角色；真实 packet 的生产批准字段为 false，输出固定为本轮 E 目录。launcher 自身的批准应由调用方先验核其 packet 记录的 SHA 并捕获执行，不能仅凭可变脚本路径调用。
- source 先查祖先 reparse、读取与 hash，再以捕获字节创建 collector ScriptBlock；evaluator 用 base64 data URL 导入捕获字节。没有直接高权限 `-File` 执行可变 collector。
- Node 采用绝对路径、UseShellExecute=false、固定 eval 和 base64 参数，路径参数带引号；实际 PS5.1 测试的参数与 UTF8 标准输入往返通过。原始命令仅经内存/管道交给 evaluator，原 guard predicate 返回 PID/reason；当前序列化没有输出原始 CommandLine。
- evaluator 固定结果路径，核原 guard 完整 hash 后提取函数，错误/未知都保持 blocked；completed-readonly 只表示诊断完成，不能解读为准入通过。
- timeout 会抛错且不自动终止子进程；不能宣称超时即子进程已结束。失败后不应盲重试或覆盖原证据。
- 本轮没有发现 batch/lifecycle/数据库/调度修改调用或 Debug 权限开启。读取计划任务元数据不等同于修改任务。

## 最小受控证据

脚本 `Test-AdminLoaderTransport.ps1` 提取实际 launcher 中 ProcessStartInfo 至 stdin/wait/error 的原代码，唯一运行输入改为 dummy Node evaluator 与合成字符串；完全不执行管理员 bootstrap 或 collector。

在 Windows PowerShell **5.1.26100.9168** 执行：UTF8 stdin PASS，单一带空格参数 PASS，继承 coverage 额外文件 **1**（缺口复现）。结果 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_ADMIN_LOADER_PS5_V1/result.json` SHA256 `adfea172c27c0a2f40f97dfaa3fb7a68821ae4fbb5b761ea75bfef951f9b0bfc`。测试输出仅位于新建的该专用目录；不把这个受控测试称为管理员现场验收。

上述边界修复后应重新绑定 packet/launcher/采集源 SHA，并保留 V1 与本失败复现。冻结 f0bb、guard、SourceV3/pkg21c 未改变；真实采集及任何生产操作仍依各自授权范围。
