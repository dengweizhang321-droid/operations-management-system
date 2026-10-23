# 102 外置健康探针只读收尾候选

本段记录源码冻结时的准备状态：本目录仅隔离源码候选，当时未提交、prepare、封存或生产执行。作者只修改本目录；`tools/operations-system-control.ps1`/`release-readonly-retry.mjs` 是根任务已独立复审的标准源码，SHA37d329c1…/1139287b…，提交fc84d723…，保持原字节。冻结时尚待 preparation_review 非作者整体复审；生产必须另有用户对新精确 scope 的批准。最终物理方案由根任务另交付于 `../production/HEALTH_PROBE_APPROVAL_PLAN.md`，不将本目录源码准备态冒称实际完成。

## 基线与范围

必须精确102条、head `ceb8ee2a73a3140ae427adc06ebf373eee785360b36a7a3b27f6d7da0a384e7c`。原19 strict unknown/false、原21 unknown、1cae diagnostic unknown三项原字节均保留。source88/295已接受合同只复验，不重复追加；20已passed不重放。新操作仅 `health-probe-contract-readiness-supplement`，新独立receipt/completion不写原21或1cae passed，不冒称原engine completed，不采用Main v3/C/noData。旧1cae实际4771闭包、全部102原raw WAL、原9/295/442/1cae精确批准与必要源码证据继续绑定；旧批准不授权新代码。

新 readonly-control.ps1 从37d3已审标准源码机械派生。仅新增mandatory `-SourceScriptRoot D:/运营管理系统/tools`、拒绝除Action Status+Json外的Panel/Start/Open/Stop/Check、将两PSScriptRoot依赖绑定回原tools、唯一重命名健康函数并加finally写固定DTO、Status dispatch前核自身artifact context。所有原Worker/Django/权限/状态/恢复/身份门禁、cwd和服务入口保持。其原标准健康函数完整本体未变；中文PS5文件保留UTF8 BOM。没有覆盖正式D0e87/原f4/E9/旧pin，也不修改启动/部署/调度。

四legacy来自原f4/E9，由copy-legacy.mjs机械限定变换：仅37/1139已审固定health/readiness安全投影，原f4依赖绝对导入，body断言前create-only捕获、每次实际native invoke前/返回后的固定数值window、非零catch同window、消息SHA隐私封包。原7argv recognizer保留；新增唯一新id+自身artifact readonly-control路径+精确9argv+固定SourceScriptRoot的分支，不能泛化脚本白名单。admission也改为同shadow Status，其他原源/恢复/配置/工具链/权限/维护/排空/进程/动态核验不变；Python闭包原E9 wrapper/cwd/phase不变。新collector/command descriptor单独scope hash，原batch.collectorSha256不换绑。

## 真实证据与成功合同

原runProcess非零时只有真实processEvidence/stdoutBytes/SHA，临时stdout已销毁。本候选不改transport、不重建或解析该正文。shadow的健康函数finally在自身artifact `production/health-probe-evidence` 以CreateNew+WriteThrough+Flush(true)输出限定DTO：scope、自身SHA、authority原raw SHA、实际PS PID、UTC、functionReturned/observedState/固定healthEvidence，rawBody/rawReason=false。Context先核health-scope原raw SHA和sidecar、自身SHA/根身份；路径拒reparse。Node reader要求regular nlink1、固定raw keys及两raw flags确false，再归一化UTC7位到3位用于比较，原文件SHA仍基于原字节；不能丢未知raw字段然后宣称原档案无raw。

exit0 Status仍在原断言前wx/fsync保全实际UTF8 stdoutBytes/SHA、原process、固定state/版本/12域、health与本次实测invoke window。原Status observation-attempt可能仅因原断言而passed；这不等于新合同接受。snapshot producer缺失会标缺口；runtime和protocol准入边界都要求唯一匹配实际Status PID、scope、自身SHA、authority、health facts的producer。丢/错/重记录拒绝admission和started；最终也须相同真实匹配才能passed。失败时只能报告native和已验证producer/Status引用，没有文件或被杀未完成finally明确缺证。

新成功合同保持全部旧版本/Running/Ready/12域/各assertions，并另外要求三个实际probe均called/requested/parsedObject/ok/marker/passed/beforeDeadline、HTTP200、errorKind none，live/helper nominal3000、ready5000，effective为1..nominal。实际整个probe Stopwatch（含setup/正文）必须 <=effective；超过即新合同拒绝，不能由nominal推断实测成功。三probe串行elapsed之和与health checkedAt→producer记录interval均不得超过该实际native elapsed；checkedAt/producer at须落在本次invoke边界窗口中。仅5ms允许UTC floor/时钟分辨率，不是额外probe预算或5秒正向宽限；这些窗口是invoke边界实测，不能冒称OS进程创建/HTTP瞬间。标准37函数可能把稍过effective的setup+request组合标passed，新补充合同会严格拒绝；此限制不修改标准源码。

只有新严格Status/完整producer合同passed后才写pending，necessaryAcceptanceClosed=false；typed exactowner释放与独立ENOENT/共同期限确认后才distinct completion。所有post-return及pending/owner/WAL/CAS错误继续保真实receipt/process/nativeWindow/attempt/status/producer引用与ownership三态，不能强写foreign链。新总55分钟为同一继承上限；所有fullhash在collector前、started实际sampleAge<=5s；查询后只小CAS/owner metadata，不插dump扫描。

prepare.mjs是builtin-only bootstrap：先硬raw绑定旧1cae scope/批准/原9authority及新独立源报告，stream完整4771旧pins和新可执行闭包（普通nlink1，原精确PS5 host+SHA允许nlink2），然后dynamic import协议/runtime/派生器。后续同一个55分钟deadline，不重置；只读取旧元数据/typed源合同、create-only外置候选，不运行collector/Status/锁/生命周期。caller也在完整pre-import核验后才进入API；新human明确三个失败保留和新只读范围。

## 作者证据和限制

- AUTHOR_MODEL_FIRST.log：旧模板prior文件名导致夹具加载ENOENT，未执行模型，原失败保留。
- AUTHOR_MODEL_SECOND.log：16项15pass，唯一失败是夹具把URL编码路径和E虚拟根错误拼接；修正夹具，未放宽recognizer。
- AUTHOR_MODEL_FIXED.log：16/16，5365.7362ms。
- AUTHOR_MODEL_FINAL.log：增加bootstrap before-import、admission元数据失败/双WAL、非零安全保全后20/20，7049.1094ms。
- AUTHOR_MODEL_RETENTION.log：runtime已返回actual result后producer读取异常保receipt/native事实，21/21，6905.8568ms。各轮不累加，旧标准23/10和旧候选测试不算本候选新覆盖。
- AUTHOR_MODEL_FROZEN.log：冻结运行字节最终21/21，7489.4174ms；当前最终模型轮不与此前轮次相加。
- AUTHOR_NATIVE_FIRST.log：两个真实私有PS叶子1pass1fail，发现作者PS日期投影用DateTimeOffset产生+00:00、被Z-only标准投影丢checkedAt。改为UtcDateTime Z，标准源码不改。
- AUTHOR_NATIVE_FIXED.log：2/2，9038.9747ms。真实healthyPID65696 exit0，随机ready延迟3505.344ms；injected-final-remaining拒绝PID43096 exit7，functionReturned=false。两个PID均独立ESRCH确认退出，只三个随机loopback GET，无正式URL/SQL/服务/锁。失败stdout属性不存在，仅用真实producer原SHA，不虚构解析。异常是有界fixture在原末remaining调用注入拒绝，不声称实际父22秒wall deadline已经耗尽。
- 私有leaf使用derived中精确AST函数和producer函数，未执行main/aggregate/worker/lifecycle。首次native日期缺口、首次模型夹具失败及首次lint unused提示原样保留。全部写入仅本目录和经绝对根/前缀核验的私有临时目录。

本候选补的是健康预算/分类正确性和失效瞬间证据闭合，不证明此前Unresponsive就是3vs4预算导致。背景netshop查询statement timeout与失败同时已保全，仍不能证明live/helper/ready哪项失败或SQL与健康失败的因果。本目录无独立通过自签、无新生产作用、无分钟提速承诺；真实采用结果必须另经批准后按新scope实际验证。
