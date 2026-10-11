# IG04 修补与 targeted19 步安装链独立复审

**本次范围源码通过：IG04 已修，19 步安装／消费／回退静态契约未发现新增阻断。** 现场未知引用仍阻断生产，新批次尚未批准；完整 C 准备验收还需主任务闭合实际 in-process session 路径。结论只绑定 `f8a207b7f01c640f67801b4788317557c488a8e4`、W `20261011T075658Z-aed7ddc1be340f5c`／manifest306e92da、plan7e94dbb4／receipt9c3d2b5a、batch `872d7e411d16ac974b0abd1404b7d41ed4c4707d99c2a01750ae182a73206df3`、guard `eb01db494d47d8e376af8d4a5fc69e823bbcf72672bdfbaf7f80a1cc914882bd`，不授予生产操作。

[7项独立私有VM](ig04-independent.test.mjs)全部通过，130.8712ms，[原日志](ig04-independent.log) SHA `fea138ecfc28afe66232cf5d9673353429e998b7ee39ec5d24afb71e5dc23440`。同一个旧CommandLine=null反例在04655仍零引用，在新guard成为process-unknown，末references[]拒绝；相关宿主缺字段／类型矛盾、物理受管重定向、不可读exe、native名称冒用均阻断。精确Idle/System、物理System32 native窄例外和字段完整无关native通过。原IG04失败与报告保留，不反推旧guard曾合格。

新guard增加Name／SessionId并使用真实inspectProcessReference循环；原cross-drive／8.3／ancestor物理路径函数逐段相同（仅换行统一后比较），作者34源／日志SHA已核，16路径＋18进程／218.4237ms不再重复运行，也不与本次7项相加。支持边界仍不包括UNC、relative/env/encoded、任意脚本／registry／DLL间接引用或全系统handles。

| 事实 | 核对结果 |
| --- | --- |
| 批次与制品 | 外部raw SHA b7555bd9，纯canonical batch／collector／SourceBinding、真实plan／manifest／prepared receipt一致。实际batch源码e0d2e1d、impact197f570c、admissione877cbf8均匹配W keyFiles。25个小文件及完整SHA见[有界审计](INSTALLATION_TARGETED_AUDIT.json)。 |
| 唯一顺序 | Backup2 → 维护3／Stop4 → W apply5 → 旧previous guard6 → D Deploy7／Harden8 → fixed installed consumer9 → same-point Restore10 → Exit11／Start12 → 验收13–18／收尾19。无restore-pre或发布后Backup／Restore，消费者和演练均在新D installed之后、Exit／Start之前。 |
| Backup消费 | Backup仅用旧installed固定维护脚本和旧tools pins。确认passed receipt输出才可展开Restore的backupDirectory／manifest，不允许标签替代真实点。 |
| 新消费者 | batch132–169核apply／deploy／ACL passed、新D manifest／四tool hashes及新W head／plan；只执行固定Node＋installed release-payload-retention.mjs一个路径，无参数／Execute。结果必须绑定同head／链，随后再核工具／链／期限；证明是只读规划消费，不能宣称删除retention已执行。 |
| 同点新Restore | targeted validation拒绝prepared或旧外置operator；固定新installed维护脚本，receipt tokens精确绑定backup-pre。605行backupId断言已在603–607 restore块内、backup定义之后；manifest／dump／expected/restored content和原profile／sequence／cleanup／零生产DB触碰断言保持。这里只审真实代码，未执行PG恢复。 |
| 安装与回退 | 两D库存各2933、差异恰两个resolver工具＋限定CF缓存，阶段app工具pins正确；D新resolver与W对应字节匹配。失败保持门／owner／WAL，unknown不重放，回退只通过另批兼容新历史的新successor及配套工具；不直接装旧resolver／删历史／自动DB恢复。 |

**生产与总体验收仍有明确门槛。** Root交接当前现场unknown引用仍在，正确fail-close不构成源码未验，也没有在本轮被消除。实际spec使用in-process-content-evidence-v1；首次source-session拒绝后的无session完整通过不能替代该路径，主任务另核。原197/197是当前306e/c279包的作者证据，不重复全量，不等同现场通过；旧移植失败日志和修正履历保留。

机器结论与精确字节见[IG04_AND_INSTALLATION_REVIEW.json](IG04_AND_INSTALLATION_REVIEW.json)。未执行生产CLI／Status／HTTP／SQL、任务／进程枚举、锁、备份／恢复、维护／启停、删除或修改源码／封存对象。没有将未执行的安装、消费规划或恢复演练写成已完成；后续新字节必须重新绑定审查。
