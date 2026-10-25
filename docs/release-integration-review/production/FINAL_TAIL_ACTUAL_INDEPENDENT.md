# 442b 实际续接：独立复核

**本次调用失败，AB必要验收和完整交付仍未闭合。** 唯一caller PID21924于2026-10-10 17:51:04.840Z以exit1结束，执行489.461秒；scope442b及真人批准原SHA bcc3a26d…吻合。本复核仅只读小元数据，没有新的Status/HTTP/SQL/锁或大dump校验。

原89与E295/ACTUAL-89-20261011/journal逐字节相同，97件canonical+LF/event/previous全链有效，当前head `d60a34f1aebce3bf2629a1d2c9b7e1c7f451c40fd74e44b9ac67388ef5cfdf19`。accepted88没有重复，原19仍unknown/exit1及strictEquality=false；1–19没有重放，manifest原f4e/同releaseId保持。

原20仅一次started，实际passed：PID13144、direct-exit-files、cleanup=direct、exit0，stdout42919字节SHA2968d925…、receipt `fde84841af84e80f02dad80e6d1b3c6b8f3f38bab3c54a2e24755723438cbacf`；17:47:05.272Z→17:47:09.356Z，操作包络3838.613ms。这是原冻结operator执行完整历史审计断言的真实结果，不能用它豁免原备份清理或恢复比较。

原21仅一次started（17:50:08.713Z），第一观察于17:51:04.511Z报 **STATUS_NOT_READY / retryable=false**，17:51:04.664Z记unknown。**没有成功receipt或保全的processEvidence/实际PID/退出记录/原Status正文**。原采用重试器在得到Status后执行完整就绪断言；保留记录不足以指出具体未就绪组件，也不能凭源码把本次子进程标为成功。精确阻断位置为原 `tools/release-readonly-retry.mjs:67–70` 的full readiness检查。

无typed completion；active仍为原批次9f79/idintegration-ab-v2-20261010-c22d8dd69a，原字节SHA7c5af7f4…，没有释放。保留原未知/失败及本次新head，不将晚来的Ready当原21通过，不重放21，不提出新的生产执行方案。

原批准05:28:51Z到本次caller终态 **742.2307分钟**；新批准17:40:35Z到终态 **10.4973分钟**，新批准到启动140.378秒是前置间隔，不是互斥排队。批准到必要闭合、完整交付均为null。

本轮记录：proof12.089秒、互斥获得2.745ms、原20准入220.617秒/操作3.839秒、原21准入178.826秒/操作55.674秒。21的Status attempt46.494秒是该操作子集，不能另加。已记录包络合计471.048秒，其余18.414秒为此分类尚未分配的caller时间。共同期限为18:37:55.459Z；intent与WAL一致，原20实际子进程没有扩展。原21使用同一冻结继承机制，但实际子进程期限记录缺失，不能宣称取得了它的直接计时证明。

新入口观察221样本，8个失败：17:43:12.357Z一次HTTP500，其后7次ECONNREFUSED至17:43:29.885Z。失败采样跨度17.528秒，相邻健康样本17:43:09.844Z/17:43:32.389Z给出22.545秒边界，**不是精确连续停服，也没有证明原因**。与旧16:12:27.525Z段之间缺口90分17.278秒。样本只含状态/header，后来HTTP200不能证明backend/full12就绪。

wrapper stdout0字节、stderr789字节SHA `ee3194c779ce384aa23ae1c3d267457a533fbdf655b79eb74afdb1dd3290628f`；原文件字节SHA与finished元数据一致。报告时真实失败、未覆盖与证据缺失保留。后续只读定位具体原因，不用重复采样猎取green来关闭原失败。机器报告见 [FINAL_TAIL_ACTUAL_INDEPENDENT.json](FINAL_TAIL_ACTUAL_INDEPENDENT.json)，校验日志SHA `3b282c95a5f70391473b2f12ff01a4df7a364a1519d8b4503313a9f4f759bcc0`。
