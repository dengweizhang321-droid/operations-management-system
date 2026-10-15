# 轻进度正式 reader 边界修复

2026-10-15发布后的必要确认发现：目标Worker和Django已启动、首页200，但首个progress_light返回503，错误为“市场写入所有权与当前进程不一致”。原Recovery1失败回执保留，没有重放发布、重启或手工恢复识别任务。

根因是新增轻读事务内调用assert_write_authority，将写进程epoch/cutover身份要求用于reader；正式django-market-service启动reader时明确给两项传空值。原普通progress没有此写身份要求，原测试虽验证了SQL reader角色，却统一设置了writer身份，遗漏了进程配置边界。

生产修复只删除轻读中的这一行校验。原签名、角色/scope、revision、REPEATABLE READ READ ONLY快照、事务与查询界限保持；写commands和控制回执所需writer guard保留，不给reader补writer配置或扩权。

先让回归测试在原坏实现上运行：两项确实失败，分别为身份不符503和无authority表SELECT导致500。修复后13项定向PostgreSQL用例通过，包括完整轻读模块、原writer authority拒绝与旧progress只读。测试端口55447、独立随机凭据/cluster，结束正常停止；生产写入和真实模型调用为0。测试同时覆盖空writer设置、最小SELECT角色、不读authority表、READ ONLY/RR、拒写/跨域拒绝及签名/scope。

证据保全：D:/codex-artifacts/market-progress-production-20261015/reader-regression-{before-fix,after-fix}*.log；源码交付不等于后端修正已上线，生产采用及实际制品以PRODUCTION记录为准。原测试与发布原件不改写成成功。
