# QA2 guest namespace 诊断补点

2026-10-11。QA2（旧packet1d1b61、runId b2776…）实际失败 `Empty or oversized namespace set`。当次native/CIM阶段814行全部stable、没有unknown/ref，四OS分类完成；不能凭后来普通权限再次观察到8ns，就推断失败是无害瞬态或追认通过。

当前使用新 `ASTRA_LIVE_GUARD_CORE_HANDOFF_V5.json`。仅在wrapper解析guest JSON后、任何guest校验之前，生成并create-only保存 `runId-guest-observed.json`：namespace/进程/前后清单数量、ns identity及mountSHA/字节数、最多16个代表PID的start/flags/后ns与mountSHA、boot/PID1/osrelease/btime、错误类型/errno。无raw argv/cwd/fd或raw mount文本，不参与接受判断。原始完整guest仅在内存继续走原校验；任何失败仍blocked。

代码序列核对：采集器 `ids()`排除了os.getpid()，因此Python自身不会直接加入namespace；其他进程（包括其父或短命关联进程）仍纳入。namespace在读取该PID mountinfo后、读取其余metadata前登记；若后续失败，errors也会非空，policy应先在errors门失败，不能仅用该顺序解释本次的数量错误。没有新的现场原始guest，不能判定究竟为空、额外namespace或其来源。

新增3个受控测试：第9ns摘要可保存但仍拒绝；敏感哨兵/原mount文本不泄露；提取实际wrapper的prevalidation save代码，私有临时目录实际writeOnce后再触发原validator错误，证据仍可读。连同相关guest/wrapper回归 **55/55通过**，`ASTRA_GUEST_DIAGNOSTIC_TEST.log`。旧全量122及自有进程5例保留，未冒称重新跑过全量125。

collector、允许namespace集合、子集覆盖/FD规则、mountSHA、boot/native/HCS校验均未改变；没有新分析框架、没有再跑guest/admin现场、没有生产动作。主agent可用新精确绑定做一轮同等管理员观察，再依据真实新ns证据判断支持边界。
