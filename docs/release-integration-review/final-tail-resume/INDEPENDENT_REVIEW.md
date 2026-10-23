# 原 AB 只读尾部续接：非作者独立复审

**源码候选通过，阻断项为空；productionExecutionApproved=false。** 本报告只接受下表四份冻结代码进入封存准备。最终物理 scope、真人新批准和实际执行仍须分别核验。

| 文件 | SHA-256 |
| --- | --- |
| protocol.mjs | 2a8dded52b2cbeb1a3943ccbadf91d8b626340638835650e5f633d2c622826b0 |
| execute.mjs | 646f52ebc2203a55d379e7764fb733b0f60418e74ee61fe7ec45649dd8b177cf |
| runtime.mjs | cf8bebab7b6b2592095ff25dde672883ef0cb9d04fc6001b2b2254900f65b6c8 |
| prepare.mjs | fb7b5f878c01b70b0bfaa08e5f59260b8611b7afd73dd5a4c7d8ac5cea7961dd |

独立完整回归 **28/28**，17,435.5044ms，四模块运行前后摘要相同。覆盖原89/head/active、accepted88及295真人回执、原18个passed、只允许原20/21、完整4589与4505闭包、导入前拒绝、深冻结/CAS、原重试state更新、NotReady不重试、失写后的完成/失败证据保全、两层脱敏摘要、原B14与内层Status进程、期限和精确owner释放。临时目录实际验证了原create-only WAL、原retry/append接缝与真实active文件unlink后ENOENT；没有生产写入。

独立真实 Node leaf **2/2**，745.1845ms，使用原runProcess、独立临时cwd、无业务env、无后代、cleanup=direct；正常与超时绑定PID68736/59200均经signal0只读探测得到ESRCH后记录退出。作者另外5/5真实leaf（exit0/exit7/继承期限/过期拒spawn/真实迟到exit0拒绝）已读取源码和日志，未加入独立测试计数。作者最终内存测试33/33仅作作者证据。上述耗时都是测试时间，不能当发布时间。

首轮缺口已闭合：passed、unknown及admission日志追加失败仍保留真实receipt/process/attempt/原因，且不强写foreign head；假stack frame与长行号拒绝，未知标签只留SHA并保持两次sanitization不丢摘要，原B14和内层Status PID保持；完整scope校验移到每次collector之前，started前记录并复查sample age≤5秒，原21返回后不插大dump扫描。返回到completion/release间隔另记，不宣称先前采样在unlink时仍5秒内fresh。

首失败日志保留。首轮两个夹具问题也明确保留：历史observation-attempt误纳入新计数，以及临时owner函数遗漏assert注入；最终分别只计原89之后事件、只接受真正deadline拒绝。未通过日志没有被重写成通过。

范围仍为原只读20/21及新合同允许的精确所有权释放；原19 unknown/strictEquality=false、已accepted88、原NotReady与cleanup blocked等历史不改写，不追加第二个source acceptance，不采用C或新无数据策略，不重放生命周期/备份/恢复/业务动作。新批准不能复用旧9f79/0bca/7389/295d。

本复审没有运行生产caller/API、collector/Status、HTTP、SQL、服务、备份/恢复或生产锁，也没有读取private key/客户行或重复943MB校验。原20/21尚未实际执行，必要验收与完整交付仍待真实闭合。机器结论与日志摘要见 [INDEPENDENT_REVIEW.json](INDEPENDENT_REVIEW.json)。
