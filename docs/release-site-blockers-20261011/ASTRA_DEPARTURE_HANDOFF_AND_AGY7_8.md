# 短命进程补证交接与 AGY7/8 回应

2026-10-11。当前精确冻结清单为 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_LIVE_GUARD_CORE_HANDOFF_V4.json`，SHA256 `905e62daa30dbaf0d161636678895f798d8e1be53992c1cd5b338f18afb1df3c`。不再编辑核心代码，交主 agent 实际只读资格复验。旧764 collector、35777 QA包、所有原记录和运行包均未改。

## 首次真实失败的完整事实

7c6b889d首次audit并不只有btime阻断。原failure record还含50356/48348/38708/59360四个unknown，reasonSHA都是 `dfbefe69cf8a7e5c1ad84d1c27de396590c7efd3873338911b6411f7220adb05`。本轮用原assert语句重算，精确对应 `CIM instance changed` / `false !== true`。

主 agent 后来的内核87/CIM缺失只是后续时点补证，不能追认7c6时点通过。btime修复和departure新逻辑分别解决不同问题；原changedDuringCapture计数仍保留。

## 最小补证合同

另建 `Collect-LiveProcessIdentity.ps1`（SHA `280fa1cd5b4c22b73743736e1b2c6d4b50f0a106e36e8fd8b139682666903c12`），只对CIM不稳行追加0x1000查询。两条可证明departure：

1. OpenProcess失败且错误87，随后该PID的CIM仍不存在。
2. 已有原native birth；同句柄先查birth精确相等并与原CIM微秒对齐，再成功查GetExitCodeProcess且退出码非259，再核同句柄birth与最终CIM不存在或仍为原实例。

权限拒绝、API错误、无原native birth、birth不符、新PID实例、259（包括真正以259退出）都保持未知。句柄在finally关闭。后一个CIM清单新出现的行也被纳入，做有界逐PID复核；不能默默漏掉现存writer。若PID复用/当前行不稳，保留当前可见字段且仍unknown，不按名字处理。

wrapper只在这两种严格proof通过时将旧不稳行记入 `departed`；未证现存行仍走引用检查与unknown拒绝。不是跳过全系统不稳行，更不是新owner框架。原owner/readiness/目录保全/当前其他进程引用检查不变。

## 验证及首次测试失败

- 实际PS5从新源提取原函数/PInvoke，用两个自有、stdin受控自然退出的Windows子进程，**5/5通过**：活进程259拒；不同birth在exit查询前拒；同birth exit0证明；释放后仍须有内核departure证明；实际终止exit259仍unknown。没有kill、提权或修改已有应用进程。
- 证据 `ASTRA_OWNED_PROCESS_DEPARTURE_V1.json`。首次测试误以为Dispose后必须立即返回87，失败已保留 `ASTRA_OWNED_PROCESS_DEPARTURE_FIRST_FAILURE.txt`；没有保存当次返回proof，故不编造其具体原因。修正测试为接受合同本来允许的same-instance-exit0或87，后次实际返回前者；没有循环等待87或放宽生产判断。
- Node **122/122通过**，含原106例及16个departure正负例。日志 `ASTRA_LIVE_DEPARTURE_FINAL_TEST.log`。87 DTO例明确为受控结构测试；不冒称本轮自有子进程已覆盖真实87路径。主 agent 的另份真实四PID87证据独立保留。

当前guard SHA `0ec06c038b1e3926452148cee92dce981f62e0a5e301831880954c1fd7cdb1a0`；wrapper `15075e88734c80e92106197fc6932dc0f033fb3aa5c6b4b72004bee3f0e6aeb6`；native policy `ab2aaf2fbd51f480dc69ece07bd739bce26a6bd2873299f6eb0df28c73738b36`。

## AGY7/8 分歧

实际原文分别为 `SITE_AGY7_STREAM.ndjson` 与 `SITE_AGY8_STREAM.ndjson`，同conversation `d154e0e3-9d9b-4439-a580-49b627cb5670`，均为非空实际结果。

- AGY7要求把WaitForSingleObject(signaled)当绝对前置，不采纳。Microsoft明确：GetExitCodeProcess成功且未终止时返回259，0x1000权限足够；WaitForSingleObject另要求SYNCHRONIZE。当前保守拒绝259，因此不为模型建议扩大权限。[GetExitCodeProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess)、[WaitForSingleObject](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject)
- 接受AGY7的finally关闭句柄、birth先于exit查询、87仅证明查询瞬时缺失、保留非原子采样事实等要求；以上均落实。原生birth完全不增加容差。
- AGY8在收到官方依据后明确撤回mandatoryWait主张。这是原始实质更正，不是由Astra代写模型同意。
- 不采用AGY8“彻底”“设计完备安全”等过强措辞。这里只闭合有限退出判定与最小权限合同，不能证明未来进程、全局排他或所有目录/句柄引用。

生产仍未批准。新的完整管理员readonly wrapper尚需主 agent 以V4字节绑定实测；122例与5个真实私有子进程测试不替代该实际资格验证。
