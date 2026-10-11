# 本轮回退与原状态保全

本候选全业务源码仍等于实际AB前驱，运行差异只十发布工具，Django只两兼容消费者及原Prepare生成的已审核CF传输缓存。没有新的业务迁移、回填、导入或调度。本轮回退重点是发布工具兼容和未知状态核对，不把数据库自动恢复作为普通应用回退。

- 原AB Worker release `20261010T014638Z-97833d2f2b7e7bc9`／manifest f4e537eb／完整5157源码92c2656c及Django app清单237fbe0d保持。全业务字节由每次完整before→after库存比较保全，不能按目录或摘要省略。
- 旧app.previous的121d805f清单／3468文件fa434f8e原目录及完整私有副本 `D:/codex-isolated/release-no-data-adoption-20261011/app-previous-preserved`均保留；原DeployApp会替换原目录，必须先重新核原目录、保全副本完整字节和实际引用。复制过不授予删除仍被引用目录的许可。
- 新sourceBinding历史不能由旧AB verifier／rotation解析。禁止直接装旧控制工具、重置或删除chain/WAL、借旧plan或原65fc／872批准重放。本轮两个兼容消费者3c18a864／ec5254ee、最终v4 reader及完整SourceBinding材料保持，用于精确核对与向前兼容回退准备。

## 失败位置决定处理范围

W apply之前失败：保留原owner、审计及已生成恢复点，确认应用／Worker仍实际AB或已明确原维护状态。只读原Status／字节／WAL复核不能当动作完成；任何开始但未知的写操作不得重放，不自动清active或维护／排空。

W apply或D Deploy之后失败：维护及唯一owner/WAL保持，核精确已安装W/D与每个started/passed/unknown回执。使用支持新历史的控制工具做原步骤独立状态协调；不能直接复装旧解析器。若确需应用向前回退，准备保留AB业务字节、SourceBinding/v4读取兼容性的精确新successor，针对实际已形成的head/chain重新生成信封／制品／CAS计划并独立审查、另获批准。

回退方案、兼容源码、原业务完整源及旧包保全已准备；实际回退的前驱取决于失败时真实生效状态，现在不能预先伪造未知的新head或封存一个可重放旧计划。当前没有执行真实回退演练，不宣称即刻原子恢复；必要的重新准备／核对成本明确计入异常处理。

数据库生产恢复永远另批精确点、目标和维护窗口。本次唯一Restore仅对本批原前Backup做独立55433/E环境演练，保持productionDatabaseTouched=false，不回写生产业务库。配置、权限、重解析／硬链接、排空、ready、原迁移检查和资源就绪门禁仍保留。
