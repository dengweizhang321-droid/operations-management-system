# 四项发布优化的独立反审

状态：四项交付的独立反审已完成，已复现的源码与资料缺陷均已修复并增量核验，未发现尚未闭合的代码阻断。任务1仍是限定入口的断言索引与动态缺口清单，**不能宣称所有实际运行断言已被穷尽证明**；24项历史事件主要依原任务报告，另8项collector有原始结果重核。任务1/2/4可在这些明示边界内供用户确认方案，任务3是待合并候选。反审者未参与方案或实现，不修改被审源码、报告及原证据。请求模型为用户指定的 `gpt-6-astra / xhigh`；工具未提供可独立验证的实际运行型号回执，实际模型未独立确认。

基线 `3ce73dfa87884ceea23f3b71f90b2244704b4170`；审查目录 `D:/codex-worktrees/release-optimization-20261101`。已读共享记忆启动入口、相关项目记忆及本项目必读规范、发布门禁细则。用户本轮明确指定角色优先于默认模型映射。仅执行Git/文件读取和内存反例、离线摘要算术；未运行发布器 `--check`、构建、制品准备、控制安装、维护、服务动作、业务接口或真实自动化。

## 已复现发现与修复状态

| 编号 | 触发与证据 | 实际影响 | 必要修复与状态 |
| --- | --- | --- | --- |
| R1 | 初稿 `release-scope-plan.mjs` 以 `release-*` 前缀识别发布控制。`tools/release-closeout-report.mjs` 原文件明确只产离线草稿，规则结果为known/neither，亦不在controlFiles，plan却为Worker+Django | 已确定离线工具仍触发无须的两组件准备发布，未实现用户的neither要求；strict检查与组件混同 | 已改精确控制入口/实际闭包，反例现为components=[]且保留检查；增量复核闭合 |
| R2 | 初稿 `release-copy-rules.mjs` 只数Worker copy调用。内存替换runtime copier的source赋值为 `tools/new-runtime.mjs` 后仍known=true | producer源绑定改变后无法识别新输入，后续新输入单独改动可被误判离线 | 已校验真实copier内source/target绑定；本反例现unknown；增量复核闭合 |
| R3 | 内存读取器对现有控制依赖 `tools/frozen-main-source.mjs` 返回缺失，原遍历直接continue，仍known=true | 不完整控制闭包被当作可判定清单 | 已改缺依赖失败关闭，本反例unknown；增量复核闭合 |
| R4 | builder资源数组中一项sourceRelativePath由字符串变为表达式，其余两项保留，初稿正则只抓剩余字面量，仍known=true | 动态资源遗漏并被当作neither | 已校验完整资源数组，非双字符串对象残余拒绝；原反例unknown，闭合 |
| R5 | control源码追加 `await import(process.env.CONTROL)`，初稿控制遍历只匹配字面量，仍known=true | 动态控制依赖未识别，不能宣称未知闭包失败关闭 | 已拒绝未知动态import/require，既有冻结root+固定模块另行收录；原反例unknown，闭合 |
| R6 | 任务4现役元数据保留deployedAt/adoptedAt与SHA，但初稿没有本轮observedAt；阶段求和表述不精确 | 写入时间与观察时间不应混用；阶段和可对整轮日志算残差，不能冒充整轮/停机 | 已补本轮观察时间并修正文案；增量读取确认 |
| R7 | Astra lead提出后独立核实：`install-main-prebuild.mjs:21,119,151`的固定35成员只含scope-plan，没有新增两个被import模块 | 下一控制bundle即使复制/清单验证成功，导入publisher仍缺模块，构建部署入口不完整 | 执行者最小追加两成员；按真实清单在私有目录复制并仅import publisher的加载回归通过，源码diff已核，闭合；未安装控制包 |
| R8 | 末轮T1补表D03只定位到三个候选import的首项，D09引用154–156但原文件只有145行 | 动态边不能按所报源码位置复核 | 已改D03为68–70、D09为31–40/113–116/142–143，并同步正文关联定位，闭合 |
| R9 | 执行者自查发现Worker真实npm ci启用生命周期脚本，而首稿未将root postinstall及其本地import计为构建输入；独审确认`worker-local-release.mjs:155,2032`及package.json:9调用链 | 两个实际改变node_modules构建产物的工具可能被误判neither | 已按7个npm ci生命周期入口解析静态Node工具及import闭包，未知shell/递归命令拒绝；Git输入与历史缓存key加入package.json，独立内存核验两工具均Worker/动态命令和缺依赖unknown，最终历史635/18与受影响项复核闭合 |

R2–R5是纯内存反例，没有修改生产者文件或生产状态。原始反例脚本及结果位于 `D:/codex-artifacts/release-optimization-20261101/review/probe.mjs` 和 `probe.json`；修复前后已按消息逐项留存，最终结果会随本报告冻结。未来任意代码语义无法只靠文本匹配自动证明；限定结构、未知拒绝和实际依赖闭包必须一起成立。

## 已完成核验

任务2：独立从固定提交Git blob以同一有界hex64定义重算，得69文件、695次、501值；逐file:line:value多重集与交付CSV完全一致，不仅对齐汇总。人工核对controller readiness在STARTED之前的调用、Q14函数摘要只由候选验证读取、recipe由生产binder与CI共享、历史producer/retirement值用途、raw SHA与Git对象身份/授权锚/CRLF边界。32项历史表唯一提交数32，10严格+2动态+7候选+13排除合计相符，32份原diff文件SHA全部一致；抽核原Git提交与关键原报告。严格数是保守确认提交数，不是12个独立事故或完整因果普查。未发现需阻断交付的事实错误；方案是否实施仍待用户决定。

任务4：对75个被引用原文件重算SHA，均与timings.json一致；独立读取原STARTED/SUCCESS及绑定原生日志，三次SUCCESS确为deployed_and_ready，startupVerified/readyVerified为true。原日志跨度依次1030.187、1291.307、1333.963秒；STARTED→SUCCESS依次686.608、866.743、965.655秒，与报告一致。阶段和分别1017.471、1273.814、1310.458秒，未采样残差不归因。原始apply内层耗时已包含于切换阶段，不可再加。源码确认完整tree校验超出keyFiles、排空先于marker；三方案仅列上限与代价，没有承诺净省分钟数。10-31协调承认、当前271磁盘部署元数据和合法SUCCESS分别报告，未将缺SUCCESS冒称服务故障或成功发布。

独立摘要、计时、行表核对脚本与结果：`D:/codex-artifacts/release-optimization-20261101/review/audit.py`、`audit.json`。其输出不含凭据或客户数据。以上仅证明实际读取范围；未全盘搜索已删除发布包，未执行线上或隔离原生冷启动，未把文档审阅当生产采用。

任务1：直接核了固定入口、冻结子入口、普通STARTED之前与子步骤STARTED、lease/runtime写入、check的fetch/worktree/junction/请求/指针/日志副作用、现场前置失败转警告及最终仍可检查通过。75份SOURCE-MANIFEST原Git blob raw SHA全部相等，2381项行范围有效；其中297项为直接检查族，2084项为保守依赖超集，不能将2381当作每次必经闸数。24历史报告SHA全部相符；8份collector原结果SHA和error字段精确一致。另读Sales154原STATIC-BEFORE.tap，确为2过1败；97.23分钟原文是开发闭包turn，owner六轮起止跨度为17.02分钟。没有把前述区间全部归于发布或可节省时间。见 [preflight-audit.json](preflight-audit.json)。

末轮仅增量核T1仓库可读动态/内嵌补表：44项（内嵌PowerShell 16、Python自有目标25、Linux字面量2、C#1），16条动态边界；4新增源Git blob SHA及全部新增源码/生成脚本坐标吻合。独立PS5.1 `Parser.ParseInput`对14段做纯语法解析，0错误、16个throw，与证据一致；未执行内嵌脚本。PID以合成123456替换和prepare-only archive分支均明确标注；操作系统API内部与实际WSL安装字节仍不在已证明范围。见 [embedded-audit.json](embedded-audit.json)。

任务3：最后冻结结果为635个first-parent区间、18项变化（11项none、1项Worker、6项Django），替代修复前57项及npm输入补齐前19项。独立Git枚举635个head顺序与结果完全一致；先从实际历史base/head重算5项代表区间（Django、Worker、none、重命名/合并），后仅重核受npm增量影响的`7aa3562a`：postinstall组合命令不在受审解析范围，after unknown，保留full，与最终表相等。其余未变样本证据复用。399项无tools；236项需判断，181项一端以上unknown保持full，55项有结构证据，284个来源闭包；不把历史缺证投成今天规则。13项定向测试最新原日志为0失败/0跳过，其中控制bundle私有加载及npm输入回归均已包含；源码摘要与validation.json复核。无需重复全量测试或原生冷启动来证明本次纯范围计划与安装清单加载。[scope-history.json](scope-history.json)保留中间轮19项及原样本观察，**最终数据以[hook-history.json](hook-history.json)为准**；首轮反例见 [probe.json](probe.json)。

末轮静态核T3 plan v3消费者：`publish-latest-main:320-333`封存整份plan/request；`publish-main:44-47`、`publish-main-resume:56-60`、`publish-prepared-main:72,163-175`等读取既有成员，没有plan顶层strict-key。`main-schema-release:78,96`只限制schema/recipe字段；`:124`对旧请求完整deepEqual故意拒绝改写，不能称新工具会迁移旧封存。新copyRuleEvidence进入core的JSON.stringify摘要，完整request对象的JSON.stringify序列化摘要继续绑定PREPARED/STARTED；这不是磁盘pretty JSON文件的原始字节SHA。Worker rotation plan是另一协议。`frozen-main-source:6-17`的commit/tree/clean保障保持。新增两模块随控制包复制已核，原测试复用；**以上只证明新准备意图的字段兼容，不证明升级控制后透明复用旧同slot包**。

Astra lead补充、独审证实的采用约束：新固定入口仍在`:320`重算plan，随后writeOnceOrSame，因此旧控制已为相同target/前驱slot封存请求时，即使组件相同，新copyRuleEvidence与planSHA也使其拒绝；schema路径可在`:124`更早拒绝。安全拒绝不等于使用兼容。新控制应先于该新slot请求生成而采用；已有旧slot必须保留，并按另行审定的受控协调/新意图处理，不能直接调用旧publish-main绕过新控制的retirement准入。本轮没有实现旧意图迁移、自动退役或恢复协议，此项为实际采用前必须处理的兼容风险。

R9的真实构建链另经只读源码确认：Worker先npm ci，再直接`node node_modules/vinext/dist/cli.js build`（:2041），不是`npm run build`，因此不运行根package.json的prebuild/build/postbuild；helper直接调用esbuild API（`build-worker-helper.mjs:237`），Django准备仅复制既有依赖闭包。没有为未执行脚本扩大输入清单。当前Worker清单增加到232，两个新增buildFiles及拒绝反例见 [hook-check.json](hook-check.json)。

## 仍须说明与用户决定

- 任务1未证明跨语言动态调用、实际WSL已装Runner、OS/外部程序隐含异常的完备集合。24历史事件为有定位的报告级证据，不是每次原生失败日志都重读；缺精确修复起止不能排名“累计返工分钟最多”。这是明确的证据边界，不能省略后宣布“全机所有断言全部核完”。
- 原规范 `docs/规范/验证与发布.md:195` 的“recipe/proof摘要无生产调用方”与真实binder消费者冲突。两份调查报告已经正确区分“checker入口只CI”和“被校数据共享”；建议后续修正文案，本轮未扩改规范。
- 提取器支持本次审定结构；它不是通用JS/PowerShell解释器。未来新复制辅助器、解析别名、非当前根的输入或新的snapshot消费者仍需同步审定；当前未知历史保持full造成收益范围保守，不能按首轮57项宣传。
- 三项提速的净收益、完整性保证变更与域级生命周期采用尚未实测；方案确认不等于控制采用或生产授权。现役271磁盘元数据无对应SUCCESS仍保持观察事实，不判断实际进程版本、服务故障或自动恢复。
- 四项均未获得本轮合并或发布授权；任务1/2/4仍是方案，任务3仍是源码候选。此反审不代替用户授权。
