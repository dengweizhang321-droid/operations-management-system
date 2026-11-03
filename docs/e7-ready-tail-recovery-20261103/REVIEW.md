# e7 精确记账收尾独立反审

2026-11-03。请求角色`critical-review / gpt-6.1-sol / high`，独立上下文`review_ordinary_publication`未参与实现；工具未提供底层实际型号的独立证明。审查者只读，无生产probe/apply或文件修改。

## 原发布事实

- 原管理员调用在`publishPreparedMain`调用前被普通令牌断言拒绝，无该轮生产切换。普通任务后来以Limited令牌调用同一固定入口，两个阶段的失败分别保留。
- 普通任务的七个已完成步骤均有completed/exit0/timeoutType=null及原始stdout/stderr摘要。WorkerApply、当前verified head和Django manifest均匹配本次PREPARED；原VerifyStartup为true，维护与排空均退出。
- 原FAILED仍是11:48:12Z末端ready503，没有SUCCESS；独立11:52:48Z观察ready200、ok=true、unavailableServices=[]。PUBLISHED仍指向旧eab，不能追认原自动发布成功。
- 通用status强制PiRunner准备字段，本次无Pi；旧eab适配器固定旧提交，均不能直接套用。现行规范要求受控修正发布记账单独授权。

## 候选审查

实现提交`199f927a61796ce3cd494ce6b616630616e0a2e9`仅新增本目录10文件。相较已审eab版本，writer/observer/witness只替换目标、路径、恢复身份、version和见证根；测试私有路径同步，新增加固定绑定回归。旧eab、原冻结包、安装控制包及通用恢复入口未改。

独立重新核对25项原件pin、44项代码pin及CHECKS中8项制品摘要，均与实际字节一致；inspectOriginal通过。程序SHA `7e34b14b5852d958a8096caa4595f868e69fdab08888f8072c54caa16d32a78d`，配方SHA `4f8a3f466af1b0f889d74348bee1cecf4895becd74f1606b05b30a74495d0ff6`。

原queue→rotation锁序、普通用户与Node身份、固定控制代际、原件和完整来源绑定、原publisher退役、跨token只读见证、active batch、维护/排空/lease缺席、ready、CAS、unknown/第三值/中断拒绝均保持。原FAILED和旧catalog保全，不补原SUCCESS，不重做应用动作。

复用已完成的52项继承隔离检查和1项精确e7绑定检查；不因纯文档提交重复运行。没有生产probe或恢复完成回执。最终REPORT包含独立恢复目录、PUBLISHED旁CAS临时文件、固定见证根REQUEST/OBSERVATION/ACK及诊断日志的完整写集合。

**结论：无剩余审查阻断，可将精确候选交用户批准实际记账写入。** 执行前还须通过现行动态门禁；候选审查不承诺当时身份/代际/ready/CAS仍未变化。发布记录与本审查提交后工作树须干净，最终operator commit按实际提交记录。
