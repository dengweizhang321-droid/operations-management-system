# 精确收尾调用器与候选封存器独立复审

2026-10-10 15:23:21 UTC，最终候选源码及隔离回调夹具通过，没有剩余阻断发现。此报告只接受caller/sealer候选；**没有生产执行批准，没有执行真实main、封存、API、collector、tail或ownership释放**。新API另由独立审查者复审，实际封存scope仍须另核。

| 对象 | 最终SHA256 |
| --- | --- |
| execute-exact-closeout.mjs | `465ad68a9f6c9b8494e969aac61b2299214860ea896e62067e836e359cca1c04` |
| seal-exact-scope.mjs | `055f66d0fb025dd0b9be4aae8160487096b12e9a0ee245dfea85f3b1361b66a5` |
| EXACT_ENTRYPOINTS_INDEPENDENT_TESTS_FINAL.log | `cf138252725673d18a259f41c360b4fbbb8600f3ba03a23c96ba856f83fcb521` |

23项独立夹具全部通过，0失败/0跳过，exit0，164.6411ms。其范围为caller隐私7、caller ownership CAS9、sealer隐私7；不会把这23项说成完整真实执行测试。夹具从候选源码提取实际main.catch尾部及ownership函数，分别使用合成拒绝Promise和内存IO/journal/unlink spy，不调用真实main/API或生产函数。首轮未锚定frame的2/6通过、4失败日志仍保留；修复后的6/6第二轮也保留。

调用器固定原AB9 authority原字节SHA、已采用release模块路径、当前完整collector及尾部闭包，并要求新scope、caller self、目录、批准时点和新user item；旧AB/UI/7389标识在动态导入前拒绝。先核原impact和TypeScript bootstrap字节，再核canonical scope及全部pin。API固定路径/mandatory pin/实际SHA、原E9 validator固定路径及7ada SHA、proof pin及本次两传递模块均在其动态import之前核验，原“先导入后验API/validator”缺口已修。

collectCurrent调用原operator.runProcess，保留原collector executable/cwd/args、phase、direct-exit-files、preserve及timeout，拒绝C transport。runtime取原engine/rotation/operator及原真实validator，未注入noop执行或另换主线入口。C及新main无数据策略均未在该生产入口引入。原动态门禁、runApprovedOperation和互斥整体属于API的独立复审；本报告没有替它宣称完整ABI或真实采集通过。

ownership回调先核精确active内容、final head、新合同completed-with-approved-exact-transitions及原comparison仍unknown/原event，再核dev/ino/size/mtimeNs/ctimeNs/nlink和原字节。只unlink精确active文件，后lstat必须ENOENT才return released:true。独立负例覆盖错owner/head/终态、原comparison改passed或换event、文件身份/字节漂移，以及unlink没有删除的情况；全部拒绝而不产生错误released确认。API持有原互斥及再次验证typed ack/active缺失，是另一个审查边界，不能由本回调测试替代。

两入口的catch原来会把含`.mjs:line:col`的私密message/diff当sourceLocation；独立合成负例复现后修复为只接受真实at/file frame、输出allowlisted basename和1–6位数字，绝不输出整行或绝对路径。message只SHA，errorType固定enum，未知类型/非字符串/null有固定回退。实际保密负例没有读私密key或客户数据；所有敏感标记均为合成值。

封存器只准备新的外置候选目录：先核原authority与现阶段完整闭包、87条/316f原head、原1–18及未启动20/21；两次journalState前都要求已存在000000.json，缺旧目录/事件先拒绝，避免ensure创建生产目录。独立before/source/API/caller报告及实际源码SHA必须齐备；API导入前还验证本地rule/parser与sourceReview/proof codePins。随后验证精确source evidence，绑定v2输入、proof、witness、manifest/restore/dump和现有元数据；只在新E目录create-only复制/输出，最终重核pin/head/active，再分别记录scope canonical及文件digest。

本次没有跑封存器的4k扫描或dump扫描。封存文件使用wx writeFile；报告不冒称这些候选写入执行了fsync。实际封存后必须核全部文件、canonical/raw SHA、所有producer/module/review pin和scope生产动作字段，且不能有新批准或执行产物被混入。缺/部分文件仍由调用器字节门禁拒绝。

原19 unknown、strictEquality=false与old engine completed=false继续保留。只有另获最终精确新scope批准并通过真实原20/21及新协议的全部门禁，才可执行明确的新合同终结和owner释放；source evidence、旧批准及本复审不是授权替代。机器结果见 [EXACT_CALLER_INDEPENDENT_REVIEW.json](EXACT_CALLER_INDEPENDENT_REVIEW.json)。
