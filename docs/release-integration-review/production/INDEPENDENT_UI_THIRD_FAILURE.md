# 第三次原UI失败：停止与只读独立证明

2026-10-10，Asia/Shanghai。唯一原批次仍为 `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15`。

**第三次原UI失败已确认；禁止第四次原脚本重试。** 可用独立零生产效果证明仅追加failed协调，不能改称passed，不能取消已切换批次或删除active。证明不授权任何再次调用原UI。

原unknown为 `07:10:54.013Z`，event `e414c03dc2c89b553529cfe5afaf973cb4860688a82e1bd6f9ebe05b67117377`；PID23412/exit1，stdout0，stderr468bytes/SHA `48e80a5a9db6e80c111fc670d9e5033f792c337024efc37cee995bad937434c6`。新failed audit SHA `c3cfdb960a342b2d01d2f3707d85024f3d37d2ced80b3cf1f3dda681689f13eb`。原记录、原stderr元数据及新audit必须保全，result未产生，不使用诊断positive或旧报告补它。

新audit全部请求为GET、危险与缺失请求均0、业务写入0，唯一失败仍为sales summary的ERR_ABORTED。固定UI/route/handoff/resource输入与原pin吻合，原批次文件SHA不变；固定AB Git源5faac815干净。全局route在continue前拒绝非GET，service worker禁用，旁路仅固定正常HTTP favicon GET；这一步没有调用生产生命周期、部署、调度定义或手工发送。普通GET观察/日志、隔离浏览器文件不声明为零IO。

08:05:16Z独立CIM/TCP/FS观察：Node23412及其direct children、该操作窗口内的owned headless Chrome均不存在；3000实际PID50704沿54540→42728→48744关联到相同AB release路径，supervisor创建时间仍06:26:26.791795Z，Worker回执manifest为f4e。Django实际owner仍237f；maintenance和automation-drain文件不存在。active保持原9，后续11–21均未开始，前9个确认passed步骤没有重放；整批未完成，C无批准。

[机器事实](INDEPENDENT_UI_THIRD_FAILURE.json) 原字节SHA：`278d136b85303cb31b85839b7ffee055f3ae6ad5cc379c80ef2403274c8d9e8e`；[failed-only proof](INDEPENDENT_UI_THIRD_FAILED_PROOF.json) 绑定该观察。进程原观察 [JSON](INDEPENDENT_UI_THIRD_PROCESS_OBSERVATION.json) SHA `c9de2a9eb1f4cf091495e33459fcdd80f1b78f0775c38c3552c6d7a84c284b5d`。审查者未运行UI、Status operator、生产变异或重型扫描。

最小后续是独立隔离修复/复审后的精确只读验收补充：绑定原9/op及第三failed事件、新源/依赖/输入/输出摘要、相同AB/f4/Django237、原四断言和全部route校验的等价加强、实时inflight与详情终态证明、独立新receipt及用户明确补充批准。新受限API须持原互斥核active/head、限定这个mutating=false任务，append-only写明验收由 `explicitly-approved-readonly-validation-supplement`闭合，保留原三次失败；不得把明确exit1说成原操作正常成功、泛化任意operation或手写WAL。仅在补充批准及其独立验证闭合后，原流程才能继续11–21，保持最早05:28:51批准计时和全部协调耗时。
