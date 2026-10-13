**独立V2文本复审意见与事实纠正**

**一、上轮事实与措辞明确纠正**
1. **退出事件定性纠偏**：WAL 原始记录确为 `code=nonzero_exit`、`exitCode=1`、`timeoutType=null`；600033ms 仅为实际运行耗时，此前表述为“600秒超时”系用词不当，予以纠正。
2. **进程缺席判定路径纠偏**：确认当前设计不依赖 `GetExitCodeProcess/259` 机制，而是采用底层内核缺席刚性证明：固定旧 PID 14972 与 36576 必须在 CIM 中无记录，且 `OpenProcess(0x1000)` 必须失败且唯一允许 `GetLastWin32Error=87`；若句柄有效则立即在 `finally` 中 `CloseHandle` 并抛错，遇 error 5 或其他任何错误均直接拒绝。
3. **文件链接数规则收敛**：确认系统级 `powershell.exe`（固定路径与 SHA）仅允许 `nlink===2` 特例，所有普通源码、规范与证据文件均刚性断言单链接 `nlink===1`。

**二、V2 源码审查与具体发现**
1. **调和与恢复严格解耦**：`reconcile-backup-once.mjs` 准确实现了“仅追加单次 000010 passed 事件（附 5 项真实 outputs），返回 `reconciled-only-not-resumed`，不触发自动 resume”。在原 rotation lock 内对 Head `f59b6598...` 执行写入前后双重 `journalState` 与 `writeOnce` 校验，具备单次 CAS 防重入约束。
2. **明确待修正项核准**：正式确认“生成器尚未在 resume 阶段于 Node 启动前清理 `NODE_*` 环境变量”为**明确待补齐项**；经核阅当前源码确未包含该预清理逻辑，复审绝不误认其已经就绪。
3. **防线与边界清醒定位**：
   - `releaseRetention: blocked` 如实保留，原未知事件永不改写，审计事实完整无粉饰；
   - 隔离测试 35/35 通过仅证明受控沙箱逻辑闭环，绝不等同于生产环境 append 发生或 Restore 完成，亦不宣称全系统全局排他；
   - 生产 UAC 挂起属于操作系统级刚性保护，必须等待人类主权确认，严禁任何形式的越权绕过；人类委托仅限本次已批准范围内的故障补齐决策，绝不可扩充为任意 WAL 写入权限。

