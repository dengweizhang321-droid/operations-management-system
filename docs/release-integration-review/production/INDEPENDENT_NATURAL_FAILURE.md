# 原自然守护观察失败：独立只读结论

2026-10-10，Asia/Shanghai。对象为AB9 `9f79a27a…` 的op15 `two-natural-watchdogs`。本轮只读原快照、sidecar/seen、原WAL、源代码及OS进程元数据；纯validator诊断不作为验收。未调用Status、UI、collector、Install、自然Run、生命周期、备份或生产续接。

**可独立证明该失败观察操作没有生产业务/数据库/生命周期/调度定义/手工发送效果，支持原协议追加failed；不得协调passed。** 在原快照和输出槽得到逐字节保全、先前在途自然观测完成且原全部准入继续通过的条件下，最多允许一次原未改观察复验；不是无限重试许可。

## 原失败事实

WAL000064 started于UTC09:10:54.031，event `d306d03e…`；000065 unknown于09:11:09.484，event `820c48ab…`。原Node14228真实exit1，stdout0、stderr50bytes/SHA `89f830ac…`。66条现存canonical WAL链通过，active仍AB9，op15仍原unknown。OS只读查询确认14228已不存在。

两份原快照各1438bytes，SHA分别 `5605d257…`、`6b54eb4d…`，sidecar和seen记录摘要一致。第一at为09:09:12.3756416、seen为09:10:54.435，原classification明确旧初始baseline/count=false。第二at为09:10:26.1329477、seen为09:11:09.468；其snapshot开始早于本次观察，原规则必须拒绝新出现的stale记录。不能把seen/mtime改成at，不得计入两新healthy。

两份release均f4对应release、fence `d01e5b5f…`、supervisor48744/worker18720，12组件和4探针全部满足原非时间断言；healthy=true、probeError=false，business.status保持unknown。纯诊断将after置0仅检查这些断言，不用于原生产新鲜度验收；本次合格的新健康观察计数为0。准确摘要和字段见 [INDEPENDENT_NATURAL_FAILURE.json](INDEPENDENT_NATURAL_FAILURE.json)。

## 时间语义和零效果范围

已核对原pin：adapter `8d5f3f1f…`、validators `7ada759a…`、handoff `a2ec59b6…`及installed watchdog `aefa5e6d…`。原watchdog第105行在probe前赋snapshot.at，第347行在完整probe/business/decision之后发布latest；at是snapshot采集起点，不能当完成时间。实际adapter.after未落盘，本记录不补造该值；第一baseline及本次WAL/native起点与两旧at的关系支持上述被拒绝控制流。

原adapter139–168分支只读取desired/latest，保存私有原字节证据、解析断言并sleep，没有调用Run/Install/Status、服务、数据库或通知。原观察的exit1和这些源/输入/证据对应，足以证明这一操作没有生产变异效果。普通文件读取和私有观察写入不称不存在；已获原op14授权的独立自然watchdog自己的运行/状态/审计，也不归因为op15效果或宣称全生产未变化。

## 一次受控复验的边界

1. 保留原unknown、两raw/side/seen、baseline分类及错误；按本独立failed-only proof追加failed，不passed、不删除active、不取消已切换批次。
2. 原saveOriginal使用wx，同名不同新bytes会拒绝。复验前仅对7个未pin自然输出槽逐字节保全、校验、记录搬移对应，再释放该私有槽位；不得动任何pinned代码、authority、WAL、服务状态或备份。保全映射属于本次协调记录，原失败不消失。
3. 等已存在的自然Run/probe真正完成，记录发布/进程终态及实际quiet观察后择时。当前只读采样仍见另一个稍后Run48368在途，不能据本报告宣称已空闲。不要停止/触发调度或再次Install。
4. 最简单使用原engine/CLI执行原op15；171+102≈273秒仅为准入预算，不能证明真实op入场时没有另一在途snapshot。实际原after/300秒观察窗/600秒命令预算及全部时间断言不变；race再次失败也必须停止。
5. 若在公开API的run前额外被动等待，不能带着等待前已过期的current执行：仍须保留原完整pin/binding/动态准入及5秒fresh规则。只能采用不弱化这些条件的具体调用方式；不能无期限反复collector/观测挑green。需要改原源码或时间规则时，另准备修复、独立审查及对应精确批准。
6. 最多一次原未改复验。任何再失败保留阻断和原日志，转具体修复/新范围，不继续尝试。新UI已经以补充passed，单次UI控制器不能再次进入；只能原engine跳过已passed操作并续接tail。后Backup/Restore和完整收尾仍未执行，不能宣称AB9已完整完成。
