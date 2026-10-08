# PS5 子进程及中文参数修复独立复审

结论：当前隔离修复复审通过，无剩余阻断。范围是新源码准备；本复审没有生产Backup/Restore、Stop/Start、数据写入、运行包修改或生产切换。旧9a7已按原工具在零效果与未切换证明下取消，不能在原tuple上恢复。

## 改动及安全边界

49行修复只针对精确固定Windows系统PowerShell5子进程。clone父env，使用该host的系统Modules，大小写无关地清除重复PSModulePath及两项已知Django library-only flags；不改变Node父进程完整env与build identity，非该host的命令仍用原env/argv。

实际调用前仍核对原批准script/executable/全部file SHA、原argv/Action/phase与精确已确认receipt引用。PS5必须原-NoProfile/-NonInteractive/-File前缀与绝对File，File还须在绑定清单。已批准参数经UTF8 JSON/base64作为数据传输，通过固定EncodedCommand bootstrap设置Console/Input/Output UTF8并构造named hashtable；没有把路径、中文、引号、$()或反引号插入可执行脚本文本。重复参数（含大小写重复）、位置参数、未支持switch语法拒绝。原Execute、确认、Json和KeepPostgres为真实Boolean switch；目录/SourceRoot/ID为普通字符串。不增加权限、不跳过ACL、角色、任务排空、PG/维护/CAS/回滚门禁。

## 真实独立验证

独立运行当前最新测试文件5/5通过：实际PS7模块污染父env→原PS5 Get-Acl确实失败；经过真实runApprovedOperation后ACL、中文返回、空格/单引号File路径、中文'$() ` literal'参数及Execute.IsPresent=true往返成功。原nested lifecycle adapter仅替换TEMP fixture目标，真实双层PS5输出UTF8成功。先输出status passed再throw的脚本仍被原runner非零退出拒绝，不误认部分输出为成功。

另用4项实际/小型负例验证：包含恶意$()和反引号的参数只回显，不创建marker；合法passed JSON后exit17仍被拒绝（Encoded host可能折为exit1，但非零语义保留）；未绑定File拒绝；无值unknown switch拒绝。额外结果见independent-native-transport-check.json。原batch抛错后started/unknown仍保留，不重放。

fileHashes记录在INDEPENDENT_FIX_REVIEW.json，当前release-batch源码SHA为899e16338b4e1e1b086125b37806e6c2c752bec21136a76675eff9f66cb4d7b4，最新测试SHA为33eb3a4ab959496194f44fbf3e54e5b8bfb80bb098607a995fce057bef24a69b。git diff --check通过。env-only初稿中文失败和含糊参数失败保留，不改成历史成功。

后续必须按新源码完成精确candidate/source/test/config/toolchain绑定与新批次。现已授权组合上线的业务范围保持，但真实数据导入、补数、调度变更及数据恢复没有被此修复授权；生产动作由主代理沿原协议执行。不得为节省重新准备而手改旧收据或放宽门禁。

## 同类只读collector入口收口

后续对tools/release-batch-admission.mjs的两处直接PS5调用补齐相同已审查transport/env：原maintenance Verify/Status/ReleaseEvidence与acceptance/closeout的原完整SystemStatus。新增runReadOnlyPowerShell仅组原固定File/args并委托相同helper；没有修改Node manifest验证、现有12组件/readiness条件或collector策略，也没有引入新的生产命令。

独立只运行新增第6项原生只读TEMP fixture（没有生产Status调用）：真实PS5 Get-Acl与中文Status JSON返回通过，parent PSModulePath保持。已有5项实际验证仍按上节相同runApproved/native嵌套路径证明；测试文件现在含6项。原旧neg+新测试合计58项由主执行串行验证记录，未为复审重复全部运行。

最终fileHashes已刷新：release-batch-admission源码SHA为aca3c4aa594f9375afe345dee48b05c79cbb370bf73a7fcee79c3c84c5b2fdbc；当前6项测试文件SHA为f8e7431ac00f0074740e2dae4a8e136018ad65d5130b222914106e7c0a2cc131。原release-batch 899e1633…d7b4保持。本追加修复复审通过，无新增阻断；仍须新source/candidate/批次绑定后才恢复授权上线流程，不得复用旧9a7。
