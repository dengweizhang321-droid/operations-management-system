# 按应用复制清单决定工具发布范围（2026-11-01）

本次修改离线范围计划，保留生产发布器、应用准备器和原生控制器原字节。`tools/`不再仅凭目录名要求两组件发布：实际Worker运行载荷/构建输入对应Worker，Django显式复制清单对应Django，两者都有则两者；两者均不收录的工具只保留必需检查，不生成应用包。未知复制结构、缺失或动态依赖仍按两组件full。发布控制入口及可静态追踪的控制依赖另保留strict/full，不借“应用包不收录”减免当前发布工具变更。

实现为 [release-copy-rules.mjs](../../tools/release-copy-rules.mjs)、[release-copy-git-sources.mjs](../../tools/release-copy-git-sources.mjs) 和原 [release-scope-plan.mjs](../../tools/release-scope-plan.mjs)。[install-main-prebuild.mjs](../../tools/install-main-prebuild.mjs)只追加这两个新增模块到以后新准备控制包的复制清单，避免孤立复制planner后加载缺依赖；没有生成、替换或采用任何控制包。`copiedComponents(path,rules)`是纯函数；提取器只分析传入源码/源码读取器，不执行或导入被分析的生产模块。Git适配器只调用ls-tree/cat-file读取明确base/head对象，按128 MB总输出、16 MB单文件界限拒绝超范围内容；任何读取失败降为unknown/full。

## 复制规则与边界

| 来源 | 源码定位与决定规则 | 实现处理 |
| --- | --- | --- |
| Django backend树 | `django-local-service.ps1:2141` Prepare-Application；`:2161` Copy-ApplicationTree，`:1590`函数递归并排除cache/tests/pyc | 后端已有Django-only规则保持，不将全仓归档扩成Worker影响 |
| Django tools/config/drizzle/automation | `:2162-2167`两个配置及控制脚本自身；`:2168-2338`字面量数组，`:2341`按ExecutionRoot/relative复制 | 解析数组、三个直接源绑定，并核当前受审复制命令形态；新增动态表达式/未知Copy命令拒绝。安装代政策覆盖只从旧runtime替换两个已列config，不新增未知源码成员 |
| Django runtime-tools依赖 | `:2166` Copy-WranglerRuntimeClosure | 其输入为Node/npm包依赖，继续沿用package/lock/shared配置strict规则；不是任意tools目录递归复制 |
| Worker guard/keyFiles/运行文件 | `worker-local-release.mjs:225-279` guard/key/bundled数组；`:1904`逐项哈希；`:1914-1920`逐项复制 | 只接受字符串、已解析常量、数组spread表达式；未知表达式full。将guard、keyFiles与bundled列表并入输入集合，不能只看keyFiles |
| Worker dist/node_modules/helper | `:2114-2116`三个固定cp源/目的；`:1626`helper构建 | 严格识别已审cp形态；构建配置、依赖和前端原有规则保留；helper按下一行闭包补齐tools输入 |
| helper编译与资源闭包 | `build-worker-helper.mjs:9`入口，`:54`资源列表，`:186`@/解析，`:218`受控loader，`:239`entryPoints，`:245`packages external | 递归相对及@/字面量import/export/require/import()，同既有扩展名候选解析，收录三个PS资源。缺失依赖/资源、越界、动态import拒绝。保守包含类型/注释中的额外字面量；这可能扩大范围，不会因此减免 |
| npm生命周期构建输入 | `worker-local-release.mjs:155` npmCiArguments有`--ignore-scripts=false`，`:2032`实际npm ci；根`package.json:10` postinstall | 解析preinstall/install/postinstall/prepublish/preprepare/prepare/postprepare七个根hook，仅支持静态`node tools/path.mjs/js`及其模块闭包；shell组合、env、递归npmrun或缺失依赖full。当前workerd patch及其inspector patch都必须Worker，不能当归档旁路；历史缓存同时绑定根package.json blob OID |
| Worker全仓source-snapshot | `worker-local-release.mjs:926`源文件盘点、`:2011-2019`全仓快照，`:3020`完整树自洽校验 | **仅归档出现不等于运行载荷变化**。否则纯文档也必须重发，与当前明确约定冲突。它的明确语义消费者另行收录，不能一概视为旁路 |
| snapshot语义消费者 | `:2847`builder、`:2878`helper证据；`:3099/:3104/:3114`retirement代码/SQL/代码证据；`worker-local-release-rotation.mjs:1507-1509`fresh collectD1RetirementProof；`collect-d1-retirement-proof.mjs:90`迁移清单 | 收录producer中的明确tools/lib/app/drizzle源码字面量、collector的retirementMigrations数组及helper闭包。为防漏项，producer中的相关源码字面量保守全纳，部分仅用于检查也可能被扩大计入 |
| 发布控制影响 | publish-latest/prepared/main三个入口的本地模块闭包，含已审冻结root+字面量模块加载；现行复制producer与原生控制器精确集合 | 与应用复制集合独立，仍strict两组件。未知动态模块、缺失控制依赖full；不按release等宽文件名前缀替代真实调用关系。当前改动的三个release工具在本控制闭包中，因此保持full |

提取器是对**当前受审复制规则**的限定结构分析，不能声称自动解释任意未来函数的副作用。直接新增copy、源/目的动态化、未知数组、helper未解依赖都有fail-closed用例；以后若新增复制辅助器、变更别名解析、生产入口或snapshot语义消费者，必须同步评审提取器与测试，producer本身变更继续strict/full。未知不靠静态grep次数当证明。未修改`.gitattributes`、封存证据或已安装控制包；源码提取没有新增生产SHA pin。

npm七个hook的范围来自实际调用边界：`worker-local-release.mjs:2041`直接运行Node+Vinext CLI的`build`参数，未执行`npm run build`，因此当前不运行根scripts的prebuild/build/postbuild；`:2055`调用helper builder，后者`build-worker-helper.mjs:237`直接用esbuild API。Django PrepareApp只复制Wrangler依赖，不运行npm scripts。若以后改成npm run或新增脚本入口，须扩大受审构建输入闭包，不能据当前七项声明自动覆盖未来构建入口。

基线`3ce73dfa87884ceea23f3b71f90b2244704b4170`的完整集合见 [current-inventory.json](current-inventory.json)：Worker输入232项（其中helper175项、npm生命周期buildFiles两项）、Django168项、发布入口控制依赖51项。集合有交集，不能相加当文件总数。当前可核例子：`tools/jackyun-api-export.ts`仅Worker，`tools/sqlite-consistent-backup.py`仅Django，`tools/sales-d1-retirement.ts`两者，`tools/check_schema_code_digest.py`两者均无。后者仍受CI约束；不需要因此重启应用。`tools/release-closeout-report.mjs`与候选验证工具也按真实neither处理，不因release前缀重发应用。宿主watchdog/安装/诊断工具被判不需要应用包，不等于它们无需检查、已经安装或可无授权更改宿主；宿主采用仍是独立操作。

## 完整差异、路径与保守策略

`makeReleasePlan`保持Git完整name-status差异、50%rename检测及before/path双端判断，base/head双方规则取并集，故删除与重命名不会按新位置抹掉旧组件。已删除的工具只要旧源收录便仍纳入。Windows分隔符统一，复制成员比较不区分大小写；越界、绝对/盘符、空段及dot路径full。测试覆盖Worker-only、Django-only、both、neither、unknown、大小写、删除、重命名、动态copy、helper缺失和当前控制工具strict。

纯前端仍仅Worker，纯后端仍仅Django，migration行为保持原规则。`full`验证强度与`components`分别处理，因此一个确定的Django-only工具仍可以是strict/full验证范围，而无需Worker包。非生产工具保留原必需检查字段，不生成应用发布动作。未修改旧`validation/deployment`中已有业务验收动作标签的语义，本轮没有扩大自动执行测试或验收；它们是计划输出，实际分工继续服从现行规范和本次明确授权。

## 2026年10月以来真实main比较

可复现脚本 [compare-history.mjs](compare-history.mjs)，命令：

```powershell
node docs/release-scope-copy-lists-20261101/compare-history.mjs
```

冻结结束提交`3ce73dfa87884ceea23f3b71f90b2244704b4170`；按committer时间2026-10-01T00:00:00+08:00起，main first-parent共635个提交。每项比较该提交与其第一父提交的完整净差异，merge纳入整条分支最终净变化，不再另算其非first-parent成员，避免重复计数。这里比较“现行旧分类器”和“本次新分类器”对同一真实差异的决策；旧分类器从冻结结束提交读取，只导出离线函数，不执行历史生产工具。

新分类器读取每个历史base/head各自的producer、helper输入与资源闭包，按tools/lib/config/app完整tree OID及根package.json blob OID缓存，不能仅按producer文件版本缓存，否则helper或npm hook依赖变更会漏判。无需tools判断的提交不读取无关复制源码。不能识别的旧producer版本明确unknown/full；没有拿今天232/168清单套历史。

完整635项输入差异、前后结果、逐项理由及复制来源证据在 [history-comparison.json](history-comparison.json)。全部18项判断变化提交及其每条新理由在 [changed-judgments.csv](changed-judgments.csv)。判“变化”比较components、scope、databaseProtection，忽略必然变化的计划摘要/解释元数据；这样不会把所有新计划都虚报为改范围。最终实现重跑：635项中18项变化，11项两组件→non-production，1项→Worker，6项→Django，284个来源闭包版本。首轮未补齐控制闭包/动态拒绝时曾得57项，补npm输入前中间轮曾得19项；两者均已废止，不能引用为最终收益。最终较少的缩小范围来自对历史缺失控制模块、旧动态控制加载、未知npm hook等保守保持full，不拿当前代码回填缺证历史。具体`7aa3562aae53`在新一端出现当前解析范围不支持的postinstall命令，因此由中间轮Worker缩小判断恢复full，完整理由保留在机器表。

399项无tools变化，原分类结果保持；236项需要tools复制判断，其中181项至少一端复制/控制/构建闭包未知，保留full。其余有充分结构证据的55项中18项实际改变范围。未知分布及具体缺失/动态原因逐项保留在JSON，不宣称所有历史发布都能被新规则精确缩小。

## 检查与交付状态

13项定向测试通过（0失败、0跳过）；工具`node --check`和`git diff --check`通过。测试包含实际Git合并提交净差异、planSha256重新计算，以及按安装器真实controlFiles清单复制到私有临时目录后仅import publisher的加载检查；不调用prepare/adopt，不把合成用例当生产发布。新增五组独审反例（离线宽前缀、复制源重绑、缺失控制依赖、动态资源、动态control import）均有回归。原始测试结果保留于`D:/codex-artifacts/release-optimization-20261101/scope-tests.txt`；[validation.json](validation.json)绑定最终受测工具/测试/历史脚本与原始测试输出SHA。历史比较及结构提取仅读Git对象，不调用发布器`--check`、PrepareApp、构建、服务或业务接口。

本次仅开发分支候选，尚未合main、未生产制品准备、未安装控制工具或部署；计划格式仍v3，新增copyRuleEvidence包含base/head可解析状态与完整清单，纳入planSha256。实际使用新计划能力需合并后按本次授权更新对应发布控制闭包；本报告不宣称当前固定安装包已经具备此分类器。

## v3计划消费者与冻结兼容

已按`makeReleasePlan`导入点、`releasePlan`成员读取及`release-scope-plan.json`文件名检索并追读真实消费者。`publish-latest-main.mjs:320-332`核base/head并按components/migrate分支，把新计划完整封存到请求和独立文件；`:716-720`只转schema支持检查。`verify-release-candidate.mjs:414-415`只消费changes，`pi150-forward-recovery.mjs:103-106`核components/migrate/databaseProtection并保存完整plan。下游`publish-main.mjs:44-47`、`publish-main-resume.mjs:58-60`核base/head/components/migrate；`publish-prepared-main.mjs:72`和`preparation-retirement-collector.mjs:94,122`读取changes。上述没有对releasePlan顶层作strict-key检查，也没有断言固定旧planSha256；新增字段不改变旧成员的类型。

`main-schema-release.mjs:78,96`的strict keys约束schema/recipe，不是scope plan；`:124`对已存在请求的previous.releasePlan作完整deepEqual。`publish-latest-main.mjs:26`的writeOnceOrSame同样保护既有封存文件：新字段会改变新计划及新请求摘要，**不得拿新工具重新生成旧请求、覆写旧包或换绑历史prepared回执**。新固定入口每次`:320`重算plan并在`:332-333`写once，因此已有同target/前驱旧PREPARED即使components相同，也会因新元数据不同而拒绝透明消费；结构请求还可能在schema`:124`更早拒绝。旧原件保留有效，不表示新固定入口可以透明续接。采用顺序应为新控制先于新slot请求生成；已有旧slot需另审受控协调或新意图，不直接调用旧publish-main绕过retirement，不实现自动迁移或覆盖。此为具体采用兼容风险，不把保守拒绝当成功复用。

scope plan摘要仍是整个core的JSON SHA-256，现将copyRuleEvidence作为core新成员；`publish-prepared-main.mjs:163`与`publish-main-resume.mjs:56`继续绑定完整请求对象按`JSON.stringify`序列化后的摘要（非磁盘pretty JSON请求文件原始字节SHA），算法未改。Worker rotation的planSha256属于另一种轮换计划，不与scope plan摘要混用。`frozen-main-source.mjs:6-17`绑定Git HEAD、tree、批准commit及clean状态，新模块仍属于该完整源码树；新增字段不绕过freeze。安装器新增两模块和私有控制包import检查闭合了控制根的实际加载依赖，而不是以Git clean或单个plan摘要自测替代它。
