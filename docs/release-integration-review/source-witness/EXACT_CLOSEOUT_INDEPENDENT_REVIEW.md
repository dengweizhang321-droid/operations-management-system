# 精确变化补充协议独立复审

非作者复审通过当前协议候选；没有剩余源码阻断。**这份报告不批准生产执行，也不表示原 AB 完整验收已经完成。** 原第19步严格比较仍为 `unknown`、真实严格相等仍为 false；新协议只可在另获最终精确 scope 批准后追加独立合同、运行原只读20/21，并按同一所有权协议释放 active。

复审时间：2026-10-10 15:21:37Z。API `exact-closeout.mjs` 16597字节，SHA256 `b4d5c0876086712dfa63b8f6192a6827ae5730dfab920bb22d6bc7c17b1343f9`。调用器当时 SHA `465ad68a9f6c9b8494e969aac61b2299214860ea896e62067e836e359cca1c04`，封存器 `055f66d0fb025dd0b9be4aae8160487096b12e9a0ee245dfea85f3b1361b66a5`；其独立入口结论须另读相应报告。本报告的机器字段见 [EXACT_CLOSEOUT_INDEPENDENT_REVIEW.json](EXACT_CLOSEOUT_INDEPENDENT_REVIEW.json)。

## 实际覆盖与旧结果保护

协议固定原批次 `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15`、authority `896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347`、87条原 WAL 与 head `316f341eafafe08c3366fc79ca2c36b96258d2b00fcd9767a82a32cd62f7ce7d`。检查原1–18相应终态、唯一第19步非零 unknown、20/21未启动；原批准起点05:28:51Z不改变。固定只读尾操作的对象摘要与原 collector 合同摘要，执行复用原 `runApprovedOperation` 的完整断言、输出解析及期限规则，不调用旧 `executeBatch` 或将第19步协调为 passed。

证据合同复验实际前后完整 manifest，296张 profile 表必须恰有6张变化、290张不变；见证列表恰好覆盖6张，4张追加表的旧前缀完整根与独立审查原摘要绑定，295项 evidence 库存无额外变动。程序读取私有v2输入，重新计算90事项与1版本控制行的前后完整根，并运行未修改的精确 typed 转换规则。实际 daily093506 的 dump 路径及原摘要同时绑定，不能用另一份已 pin 文件代替它。本轮未重哈希 dump。

这项源码一致性证据已由 [前像独立报告](BEFORE_IMAGE_INDEPENDENT_REVIEW.json) 和 [转换独立报告](EXACT_TRANSITION_REVIEW.json) 分别审查；不能由本 API 把它解释成恢复了历史签名信封、原人授权意图或完整 pre 数据库包。旧 release retention cleanup 的 blocked 状态亦不改写。

入口先深拷贝并冻结 spec/scope/approval，所有输入按初始不可变 pins Map在锁内、每个准入边界及末尾复验。原 rotation 互斥、exact active、fresh动态 binding仍在。日志追加前核前驱、追加后核条数恰增一、head及最后完整 canonical 事件恰为本事件。外来追加不能被协议接纳为自己的前驱。

只运行原20历史审计和21最终就绪。`status:passed` 标签不够：需64位 receipt SHA、直接完成的 exit0、signal null、无超时、无 pending清树、有效PID/耗时、stdout/stderr字节与摘要。否则追加 unknown并停止。新完成事件明确原引擎 completed=false、原严格比较passed=false、完整交付closed=false；释放回调必须返回 `released:true`，随后独立读取 active只能得到 ENOENT。

## 非作者负例与修复证据

独立 fixture没有导入作者 fixture，全部锁、collector、operator、日志写入及unlink用内存替身；程序仅消费已捕获私有输入，不打印业务值或key，不执行生产 API。

最终16项全部通过、失败0、跳过0、exit0，4975.8076ms。覆盖4张追加见证分别缺失、额外见证、collector变动、空passed/缺receipt、准入中 owner改变、追加前和追加后外来head、纯物理摘要漂移、声明与provider一起漂移、并发两次调用以及no-op所有权释放。独立日志 [EXACT_CLOSEOUT_INDEPENDENT_FIXED.log](EXACT_CLOSEOUT_INDEPENDENT_FIXED.log) SHA `e69e0cacdcfbe02ead4346e7b256d1cb7f2e862c0587746a50471750134ecce4`；独立测试文件 SHA `dae94cb370d7a67f3f097da6e4a4e07bc9aec68443e52cbd24771dc6191bc87a`。

首轮12/14、次轮13/16的失败原日志均保留；此前接受可变 expected pin、忽略 no-op release、append 后接纳 foreign head 的缺陷已逐一修复并原负例复验通过。另三项静态阻断——不完整见证库存、未绑定 collector合同、标签式passed——也保留相应拒绝负例。作者15/15日志另列，**不把重叠检查相加宣称31项独立覆盖**。

## 实际执行前与异常边界

仍需对最终封存 scope的新明确批准、物理完整输入复核、每一步实际动态准入与真实20/21结果进行独立观察。本报告没有运行 caller/sealer、获取真实锁、进行SQL/HTTP/Status、调用Backup/Restore或生命周期动作。

该协议单次绑定原head；发生失败、追加中断或尾部unknown后不得直接重复调用寻找成功。需保留新增事件与owner，先核实际效果，再形成新的精确续接方案。若最后完成事件写入后 owner物理释放失败，应保留“合同验收已记账、所有权释放未确认”的异常，不能仅看 completion事件宣布交付成功。

应用、原工具及OS仍属于已有信任边界；互斥和CAS不等于抵御任意特权进程写入的OS沙箱。测试耗时只表示隔离协议验证耗时。批准到必要验收闭合、完整交付、暂停/失败/协调耗时及入口不可用区间，仍须按真实最终证据记录。
