# 管理员只读结果与剩余补查

原封存包9e906d1e…已由用户现有管理员PowerShell真实执行，2026-10-11 20:59（上海时间）completed-readonly。采集840进程、17 native补充、0捕获期间已识别实例变化；结果0已识别引用、5 unknown，状态仍blocked。PID47936工作目录可读、出生实例关联一致、refersToPrevious=false；不据此证明所有句柄/模块都无引用。

三份原结果逐字节归档，Astra核重算SHA、captureSummary一致性及6个实例FILETIME/CIM微秒关联。其[原核查](ASTRA_ADMIN_CAPTURE_REVIEW.md)与[数值复核](evidence/ASTRA_ADMIN_RECORD_CROSSCHECK_V1.json)不等于重放全量原predicate或当前现场连续证明。新结果不会令旧CIM-only guard、f0批次自动通过。

## 剩余对象与补证

5项是PID236、280、1700、6548、53880。可识别名称分别涉及安全隔离、Registry和WSL，但不能据名字豁免。实际普通权限补查五次OpenProcess(0x1000)均error5，尚未取得其extended-basic/protection-level信息。相同API仅对当前PowerShell self实测：返回0、64字节、Size64、PID一致，protection查询成功NONE；只证明本机解析布局，不替代五对象采集。

WSL已有TERUISI-Pandas运行，初次teruisi-pandas诊断33进程有权限缺口，后续root元数据诊断38进程、0metadataErrors、0识别引用。只读取/proc进程stat/argv/mountinfo及cwd/exe/root/fd链接；没有调用WSL启停或业务接口。Python默认site初始化、发行版epoch窗口、宿主别名/转义挂载/namespace及瞬时fd仍有边界，因此结果不作为完整无引用证明；不能从固定productionActions字段独立证明所有系统效果。后续入口已加-I/-S禁Python site/env/user-site，未再调用，不追认前轮已有该保护。详见[独立复核](ASTRA_RESIDUAL_METADATA_AND_WSL_REVIEW.md)。

## 新封存补充只读包，未执行管理员采集

packet：`E:/codex-artifacts/release-site-blockers-20261011/ADMIN_RESIDUAL_PACKET_V2.json`，SHA256 `bb861c8fecab8e5652029c6c509daba48b767344a0c494ea39bd281a83c4b0e0`。

手工入口：`RUN_READONLY_RESIDUAL_AUDIT_V2.cmd`，SHA256 `8583c6c834d42ef3ed68ba066d8b8c95b34e18d7dd320d911f4cc3dd4cf84789`。脚本`Probe-ResidualProcessMetadataV2.ps1` SHA `6cef0abc35f4c99300d9b36393add66191557715d14d3d4a930dc0627d0f3ff9`；原9e包/4e964f diagnostic保持不变。

新包仅五个固定出生实例，申请0x1000查询extended-basic/protection。仅两个已绑定实例实际image精确等于对应System32 LsaIso/NgcIso时，读取这两个系统文件的hash/签名，保持只读句柄并后核实例；路径/签名不符保留unproven。签名平台可遵循系统trust/revocation配置，不保证完全离线。没有Debug、远程内存读取、注入、进程终止、RunAs、服务/批次/调度操作。捕获匹配SHA脚本字节后执行，要求同Windows SID及既有管理员令牌；固定E create-only输出，父链reparse仅时点检查。结果是诊断，不产生准入许可。

原9e未包含这些系统类型和限定镜像取证接口，所以不能默认为已批准执行此新包。由用户在原管理员窗口明确选择执行；不要自动再次提权或让普通窗口尝试生产动作。

```powershell
& 'E:\codex-artifacts\release-site-blockers-20261011\RUN_READONLY_RESIDUAL_AUDIT_V2.cmd'
```

输出固定`ADMIN_RESIDUAL_METADATA_V2.json`。如已存在或报错保留原文件/消息，不能覆盖、重复求绿或关闭系统进程消除unknown。

## 首次失败、验证和真实复审

- V2 probe在真实PS5 AST及C#编译通过，nativeCalls=0；原V1/self/五次拒绝保留。
- 最终UTF8捕获源码真实ScriptBlock解析通过，全部本任务PowerShell/Node源语法检查通过；独立字节回执原SHA942d30fd…重算不变。主agent误重复调用create-only字节验证器时，在已完成所有比较后的输出处EEXIST拒绝，未覆盖原回执；此重复调用不标通过，后续只读重算实际字节。
- 补充入口首稿使用函数H，被PowerShell内建h/Get-History别名抢先解析；实际普通令牌测试在hash前拒绝，没有调用probe。原cea94364 packet/首稿源码保留为未执行准备；修正为独特函数名，另封新bb861c8f，不覆盖首稿。最终真实普通令牌执行编码bootstrap在管理员身份门拒绝，诊断输出不存在；入口编码、probe/packet/entry SHA完整比对通过。这不是管理员成功或生产门禁通过。
- AGY3真实返回非空意见，但PS5长文本native argv受控接收器实际丢16个双引号；它关于C#缺引号的判断不适用于原源码。原prompt/response/首次传输失败保留。Node argv受控接收器16引号及完整SHA一致，通过后同AGY会话发纠正与Astra答复（AGY4）；后者timeout/空response，不称完成交换或最终包认可。
- AGY建议兼容ReturnLength48和WMI1ms容差无本机实测/primary支撑，未采纳。保留64、native精确birth及微秒关联失败关闭。class7、错误不豁免和生产继续blocked的意见接受；原[Astra逐项回应](ASTRA_RESIDUAL_V2_HANDOFF_AND_AGY3.md)保留。任何模型意见不代替采集/测试。

## 生产候选状态

源码dc1/binding1168，Worker21c/6cff/plan0afd，D85cf/receipt10db，fresh入口6989、f0bb旧封存及19操作全部保持。用户指定首次采用一次前备份＋一次新已安装消费链同点隔离演练、取消发布后再次备份/演练，仍只属于待批准生产范围；当前未执行。

没有改正式包、源快照、旧批准/WAL/维护排空门、日常调度或其他任务准备目录。此轮无新的生产耗时样本。剩余具体阻断是五实例系统类型/用途及原CIM-only执行合同；补证后还须核实际当前前驱、所有权、权限/就绪和新外置准入合同。新合同若必要，独立审查另封未批准批次，不能改写f0。现场闭合后才提交精确生产范围给用户批准。
