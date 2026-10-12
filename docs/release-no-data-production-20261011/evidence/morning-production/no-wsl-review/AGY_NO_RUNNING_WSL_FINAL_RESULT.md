**最终冻结源码复审与更正核定**

**一、前轮事实纠正确认**
1. **服务常驻属性**：确认 `wslservice` 属正常 Windows 基础服务，无 VM 时允许运行；其安全性由全量 Windows 进程引用扫描完全覆盖，不设豁免。
2. **HCS 内存解串事实**：确认 HCS 经 `PtrToStringUni` 直接转为托管 Unicode 字符串，不存在 UTF-8 BOM 干扰；`^[ \t\r\n]*\[[ \t\r\n]*\][ \t\r\n]*$` 严格断言 ASCII 空数组，词法排他性成立。
3. **基线口径更正**：确认 2933 与 3468 分别为 Django 与 previous 树文件比对基数，非进程数。

**二、冻结源码审查结论：限定边界内无新增阻断**
核验 `no-running-wsl-policy.mjs`（`9e86...`）、`Collect-NoRunningWsl.ps1`（`eda0...`）及 `live-reference-no-wsl-audit.mjs`（`da58...`）：
1. **资源与句柄严密释放**：`LocalFree`、`HcsCloseOperation` 与 `CloseHandle` 均在 `finally` 块中刚性归还，杜绝句柄泄漏与内核对象驻留。
2. **时钟窗口抗伪造**：以 HCS 前完成的 `nativeCompletedAt` 为基准强校验 5 秒窗口，杜绝调用后刷新 `Date.now` 绕过时效。
3. **受控态与消亡态双闭环**：PID 47936 兼顾“0x0410 + 出生时间微秒级强校验”与“双端 87 + 全普查无记录”双路径，任何异常均直接阻断。

**三、合规与验收边界重申**
43/43 fixture 仅为离线环境逻辑闭环，实机 Admin 尚未执行，绝不等同于实机通过；通过原 `reconcileOperation` 追加第 29 步仅调和当次只读后置状态，保留原 unknown 真实记录，不宣称全 OS 绝对锁，后续 19 步与恢复验证要求不降低。

