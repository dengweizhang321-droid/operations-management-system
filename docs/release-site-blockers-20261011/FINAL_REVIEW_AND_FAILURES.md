# 最终复审、失败与纠正

原始证据在本目录 evidence 和 `E:/codex-artifacts/release-site-blockers-20261011/`；旧失败不改写。模型认可、fixture 或当前元数据成功都不等于生产验收。

## 最终源码与真实现场

Astra 最终 V6 handoff SHA `41074be9c8a26b48fac1ea6fe25948b2ea0096d8200acfbd8d77b8f4c551cd7a`，11 个 helper。Astra 与主任务分别跑最终 128 项定向回归，均 128/128；不加总成 256。包括固定出生实例边界、原引用优先、伪造证据/错误 HCS 关联、空 argv/FD/漏 namespace、挂载/源码/制品漂移、硬链接角色与签名/owner反例。另有 Astra 真正自有 Windows 子进程 5 例原生退出证明，不是生产进程操作。

QA4 `161ece1e-2edc-4012-9778-20008611583f` 实际管理员采集，23:09:13.701–23:09:29.946（上海时间），16.245 秒。830 个 Windows 进程，17 次受限补充，1 个变动对象经内核 error87 与末 CIM 不存在证明退出，1 个晚到对象继续纳入；0 已识别引用、0 unknown。四个限定系统对象及第五个 WSL 实例全部用精确出生/类型/镜像/宿主关联核实；37 guest process 和 9 mount namespaces 前后完整对应，boot_id/PID1/kernel、原完整 mountSHA、FD/路径/argv、HCS 前后同唯一 VM/父实例成立。

这次 standalone qualification 调用了最终实际 `runLiveReferenceAudit` 和原固定引用谓词；它没有伪造 Worker apply 的 WAL 来提前调用整个 pre-deploy guard。整个 guard 的 D 库存、previous 保全与状态 JSON 扫描、WAL 检查仍将在正式批准后的真实执行位置运行。当前成功是有限已审接口的时点证明，不是任意句柄/内存、恶意竞态或全 OS 连续排他证明。原互斥、所有权、就绪和动作前复验继续阻断异常。

## 实际失败保留

| 记录 | 原失败 | 纠正及限制 |
| --- | --- | --- |
| QA1 7c6…，16.202秒 | 4 个 CIM 变动项未知；guest btime 与历史不同 | 内核离开证明单独加入；`btime` 是墙钟派生诊断，身份改用原精确 boot_id/PID1/kernel。未扩大权限或容忍身份/hash漂移；原失败不追认为通过。 |
| QA2 b277…，13.113秒 | guest namespace 集合超出原8项 | 原记录没有落盘细分，追加验证前脱敏 shape 观察；不据后续普通权限8项推断旧失败。 |
| QA3 a002…，15.103秒 | 实际出现第9个 namespace | 独立管理员挂载观察显示33项来源多重集与已审集合一致，只增加 `2299 → 9745…` 精确 pair。任意第10/新ID或同ID新字节继续拒绝，未猜测其IPC用途。 |
| 自有进程退出测试首轮 | Dispose 后仍可查询已退出内核对象，测试错误要求必须87 | 保留原日志；按正式API允许同实例已退出码或87，不改变259/访问失败/重用拒绝。 |
| 主任务最终回归首个包装器 | 128项已通过，包装器按TAP解析默认spec输出失败 | 显式选TAP重新运行，128/128；两原日志保留，不算功能失败或累加数量。 |
| 新spec生成首个本地解析 | 非async map里出现await，未开始任何读取或封存 | 将test文件摘要先await后同步map，原错误另存；最终封存成功。 |
| fresh qualification包装器首次 | `/`与Windows路径分隔符导致argv断言失败，未启动entry | 使用封存声明原argv，路径仅normalize核同一目标；不改封存spec或运行断言。 |
| 主任务全文件“立即相等”辅助检查 | 21处后续installed绑定尚为前驱字节 | 属已封存的分阶段安装预期，不是当前漂移：原plan保护入口CAS及完整D前后库存/准备包核清，904处当前相等、21处未来绑定精确对应。保留原辅助记录和阶段核对，不放宽真实执行点hash拒绝。 |

核心包历史完整 214/215 的缓存 missing-parent 原生监听缺口仍未闭合；当前批次明确 `fresh-no-reuse-v1`，保留相同严格输入/字节/现场门禁，未启用或签署 C 缓存现场方案。最终新批次的完整 fresh collector 资格证据另见 `FRESH_LIVE_ACTUAL_QUALIFICATION.json`；不可用旧 f0 的通过替代。

新f15d06a批次的声明入口实际CLI完整qualification已完成，568.653秒、15阶段全部passed：分类、D身份/迁移闭包、WAL、effective链、部署输入、source/toolchain前后、前驱源、test evidence、完整artifact/head、末chain/D/WAL及helper进程身份。原 `statusObservation=null` 不当作新installed服务就绪；生产维护/切换/备份/恢复动作0。这是本批新证据，不沿用旧f0资格，不用同字节重复重跑求绿。外置live引用guard单独由QA4核实，并在正式执行位置重新采集。

## 真正 Antigravity 与实际分歧

实际入口 `C:/Users/86137/AppData/Local/agy/bin/agy.exe`。AGY5、7、8、9、10均有真实非空文本；早期空response/timeout及PS5 argv失真保留，不算完成。AGY7要求额外Wait权限，主任务查微软正式GetExit契约并回送，AGY8撤回mandatoryWait；详情见[交叉事实核对](AGY_LIVE_GUARD_FACT_CHECK.md)。

AGY9读取最终system verifier完整代码及第9pair事实，给出无具体新缺陷意见，但错误称QA4离线、每次固定9项、`assertSystemWslUnchanged`覆盖native五元组、WAL全程零漂移和“充分且安全闭环”。主任务逐条回送真实事实，AGY10明确接受并撤回绝对措辞：QA4是实际live截点，支持已审非空子集，函数只核wsl.exe，新WAL正常append，原启动/业务自然写合同保留；有限当前无可识别引用不等于全OS证明。

Astra 独立重读原AGY9和主任务纠正；新spec生成器静态复审发现遗漏三个原诊断JSON及缺少最终测试闭包绑定，主任务补入并重新复核后才封存。最终新规格严格绑定11helper、4诊断records及最终验证记录；不存在通过重新hash新代码就继承旧QA资格的路径。AGY9/10原prompt/stream/stderr/call及Astra回应完整归档。

## 收益与未测

历史“两 Backup＋两 Restore 约50～55分钟”仅毛成本池。本轮首次采用去掉发布后两个DB操作；未来机器支持的普通无数据功能封存0个DB操作。没有生产配对样本，不承诺批准到验收/全部交付分钟数。

批准前准备含此前候选构建、独立完整盘点、失败/修正及本轮128回归、各次实际只读QA、最终完整fresh核查，均属于工程和机器工作，不等于停机或发布后用户等待。批准到必要验收、全部交付、用户等待及真实不可用采样窗口均未测；本轮未运行生产切换。日常备份/演练后台成本另计，建议月度和重大PG/存储/恢复工具变化触发独立演练，暂预算60分钟机器＋30分钟人工只是规划假设。本任务未启用调度或改三份保留/保护。
