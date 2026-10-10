# 健康探针预算与失败证据：隔离源码交付

本分支从最新main `3ea0271dc6ba711a5484e27eb9bd2bd33ddfa84f` 创建，工作树独立。当前正式控制器与AB source5fa控制器SHA均仍 `0e87b26637e4aac807580432025d6291bcf87ac26752eef96b784e420ac7a810`，未改用户dirty、运行包或旧4771输入。实际AB仍停在102条新unknown，不能用本报告认定故障修好/验收完成。

源码确认Worker ready内层总预算4000ms、监督外层5000ms，而原control默认HTTP3000ms。只将ready探针设5000ms，live/helper保持3000ms，均限于同一继承deadline剩余时间，完整body结束和健康函数返回前复核；缓存也拒绝已过期的继承deadline。健康状态及缓存trace绑定同一checkedAt，没有允许迟到Running。

三个探针分别记录固定called/requested、HTTP状态、对象/布尔/精确marker条件、pass/degraded、deadline、名义/实际预算、耗时、固定errorKind；不输出原body、URI、任意error/reason或客户值。保持HTTP200/ok=true/live或ready、helper成功及精确Django503降级条件，并加强对象/布尔/字符串类型；单元素JSON数组在PS5函数返回时会被枚举为标量，解析前必须拒绝非对象容器，不能仅靠事后-is类型。503的status/code数组也不能伪称合法BackendDegraded。

`release-readonly-retry.mjs`按固定三个probe和白名单字段保全这些事实，缺失/非法值保持null，未知字段/正文/探针名丢弃，重过滤幂等。旧状态无trace时原快照shape不变。原4暂态/最多4次、NotReady非retry、全部12域/版本断言保持。

实际源码SHA：control `37d329c1a9e5a06f5d04ffd2d73be415d327f1e9c5d66957197a189bd9c09529`，retry `1139287b2f9633dce57d7ea0b525e082c66382f521577c594817119f3f234ef6`。control保留UTF8 BOM、源码LF；两个源码在最后作者回归前后字节相同。

最终作者 **23/23，31962.3476ms**：17真实随机loopback/Windows PS5私有叶子与6纯投影；源健康函数经AST抽取，未执行正式ControlMain、不使用正式端口/服务/数据库。相同3.5秒ready响应旧3秒拒绝、新5秒正确接受；坏对象/数组/字符串布尔、marker、HTTP、503、超时、共同期限、缓存期限及隐私负例通过。原FIRST12/13数组失败事实摘录与所有重复轮次保留，不累加数量；[最终原生捕获](AUTHOR_SOURCE_COMPLETE_FINAL.json) / [原字节日志](AUTHOR_SOURCE_COMPLETE_FINAL.log)。

非作者 **10/10，11127.4399ms**：7私有native/AST及3投影，8自身PID真实退出；独立9/10首失败为fixture对新正确抛截止异常仍期望状态返回，修fixture后严格保留caught/trace/no lateRunning。实际测试SHA为dadd5，最终37d3仅增加原JSON catch的healthEvidence字段，独立逐字节static增量核准；最后作者23精确最终字节通过。见 [独立报告](INDEPENDENT_SOURCE_REVIEW.md)，JSON `edc7a380f00948fc9733fa262b3cb468e2aa35f512e351c7d5bbf362be514758`。

源码lint0错误/0警告（React包缺少的依赖探测提示单列），语法及差异检查通过，未安装/移动依赖，没有生产构建、维护、启停、部署、SQL、备份恢复或外发。没有新生产HTTP/Status请求。

这是稳定预算衔接和可追溯诊断修补，不证明原1cae具体子探针/3vs4因果。背景网店投影statement timeout已在原运行审查确认，未因此修改业务查询或调度。正式源码未采用；进一步外置只读候选须绑定102/head及三unknown，保持原完整动态准入，完整复审/封存后另获新精确批准。

正常Status/NotReady输出带trace，JSON异常catch也保留已有限定trace；旧非零exit传输只保native及stdoutSHA，不保证解析那个JSON。新的外置候选必须通过实际producer-side限定trace或安全传输证明端到端失败证据，不声称本源码测试已经覆盖未实现的链路。被期限清理且未产生有效证据时保缺口，不能补造。
