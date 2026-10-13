# 五 PID 元数据探针与 WSL 诊断复核

2026-10-11。新增只读探针遵主 agent 授权，未提权或改变任何旧包/guard。

## 实际五 PID 结果

`Probe-ResidualProcessMetadata.ps1` SHA256 `c6ee15d835d7a23418e8ec3ad1b0b0bdcbe7434e5dc88b4ea9a47de41da9e9b4` 固定只查 236/280/1700/6548/53880，只申请 0x1000。原 diagnostic 完整 SHA `4e964f0e…` 静态绑定；预期 birth 从该已绑定原字节读取，成功时要求 native FILETIME 精确匹配。

实际 Windows PowerShell 5.1.26100.9168、isAdministrator=false，**五项均 OpenProcess error=5**。没有进入 Nt/Protection 查询，不能将 null flags/PEB/level 解释成未隔离或不受保护。没有 Debug、ReadProcessMemory、注入或进程终止调用。

证据 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_RESIDUAL_METADATA_V1.json` SHA256 `c6ce5d9d86a2f79a58169a48e3f5ede3401403999d09ba9bc465ba6088f9e465`。

## 当前进程布局校验

`Test-SelfProcessMetadata.ps1` 提取上述实际 P/Invoke 与解析代码，仅打开自己的 PID63636。结果：NtStatus=0、returnedLength=64、structureSize=64、BasicPID=63636、layoutValid=true、PEB 非 null、Flags=0，Protection 成功且 level=`0xfffffffe`。这验证当前 x64/PS5 的成功响应布局，不等于五个目标取得类型证据。

证据 `ASTRA_SELF_METADATA_V1.json` SHA256 `8703060900074b92ec1ce65a5cdd89800f70a1d634ccc83b983ce2568fc81e7f`。x64 extended structure 的 Size 在0、BasicInfo在8、PID在40、PEB在16、Flags在56；只在返回状态/长度/Size/PID匹配后解码。只解释微软文档已给位，未知位保持原数值；保护级别与 secure-process 标志不互相替代。[Microsoft IUM/WDK 结构](https://learn.microsoft.com/en-us/windows/win32/procthread/isolated-user-mode--ium--processes)、[保护级别接口](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocessinformation)

如后续管理员包使用此探针，必须新包绑定及相应只读授权；不能把9e旧包批准延伸为新源。若额外采集 LsaIso/NgcIso 系统二进制，应先取同实例 native image、核物理路径精确为预期系统文件，再对该文件 hash/签名，不能用按名字猜出的磁盘文件代替实际运行镜像。

## WSL 已保存结果与代码边界

已读取主 agent 的 `RUNNING_WSL_REFERENCE_DIAGNOSTIC_ROOT_V1.json`（SHA256 `0c6b76b4dff08ab4ddc1f7f89e2e5e4d6c530afd8a0d2fd515a1c0e9b4d11918`）：13:06:16.250673Z，root 身份，38 个观察进程、0 refs、0 metadataErrors，前后运行列表均为同一 TERUISI-Pandas 名称。其 Python 源 SHA `6558f31afb36788f2693eae33e156a402fe65fca2adb39c377eed7899559fac0` 与现存文件一致；Node wrapper SHA `3f36ad68a82927bda946bc4c5ba97586bd83305934d7795c1cf1d068c8705927`。

只读代码只打开 `/proc` 的 stat/cmdline/mountinfo 与读取 cwd/exe/root/fd 链接，业务文件没有被此 Python 主体打开。范围仍有限：

- 前后 running list 相同不是 VM/发行版实例 epoch；list 后到 `--exec` 前存在退出并隐式重新启动的窗口。不能称预检机械保证了“绝不会启动”。当前记录没有证明发生这种重启，也没有证明不可能发生。
- `--exec /usr/bin/python3 -` 不经 shell profile，但默认 Python site 初始化仍可能加载 sitecustomize/usercustomize。今后精确只读入口建议 `-I -S -`；此次不能倒推已执行了额外 hook，须如实保留范围限制，不回写旧结果。
- literal/proc-link 字符串检查未解析完整宿主别名、bind mount 与 mountinfo 转义；从另一 mount namespace 读出的路径也不能直接当 Windows 物理路径。
- 单轮 PID 清单及 stat starttime 前后核对不是全系统连续快照；新进程、瞬时关闭 fd、进程中途变化仍可能未被覆盖。未来计划任务不在该 `/proc` 扫描中。
- 超时杀掉 wsl.exe transport 不能据此宣称 guest Python 已结束。此次结果正常完成，未发生该超时。

因此该 guest 结果提供补充的“当次未识别引用”，不使宿主五个未知自动豁免，不进入冻结 guard，也不是无引用的完整证明。本轮未重复 guest 查询、启动停止 WSL、修改服务/权限或读取业务内容。
