# 哈希钉子与重复资格化调查

状态：只读调查方案，等待用户确认后才可实施。源码基线为 `main` 的 `3ce73dfa87884ceea23f3b71f90b2244704b4170`。本轮没有修改现有代码、配置、`.gitattributes`、封存证据或已安装包，没有合并、准备制品、采用控制包、发布、维护或服务调用。

## 结论

“tools 下 61 个文件、394 个不同 SHA-256”不是当前基线的可复现统计。按有界 64 位十六进制文本枚举，当前是 **69 个文件、695 次出现、501 个去重值**。这些值包括源码文件摘要、规范化函数/数据库目录摘要、OCI 镜像摘要、历史证据与业务身份，不能统称为 695 个 raw 文件 SHA-256 钉子。分类也不能按文件“一刀切”。

最先值得做的是**冻结最终 Git 输入字节后再生成证据，并把重复的期望值收进有独立授权锚的版本清单**。这能减少手工同步和 LF/CRLF 误签；不会把未经审阅的新代码自动变成已资格化代码。直接用待验源码的实时计算值作为期望值，会取消原有白名单保障，不建议采用。

历史严格确认表有 **10 个源码/资格/guard 失配修复提交**，另有 **2 个已安装 watchdog 动态来源绑定失配修复提交**；共 12 个不同 main 可达非合并提交。另列 7 个候选和 13 个明确排除项。该数是有 diff/原报告支撑的保守确认数，不能把筛选命中总数当根因数，也不是对所有业务哈希事故的完备承诺。完整依据、文件清单、观测失败与静态必拒的区别见 [history-reviewed.json](history-reviewed.json)。

## 固定口径与交付明细

枚举读取固定提交的 Git blob，不读取并行任务正在变化的工作区。模式为 `(?<![a-fA-F0-9])[a-fA-F0-9]{64}(?![a-fA-F0-9])`，大小写归一后去重；每一个匹配算一个 occurrence，同值重复出现分别保留。行号以 UTF-8/BOM 解码后换行计算，column 为文本字符位置；raw 摘要始终计算解码前的 blob 字节。跳过含 NUL 的二进制和不能按 UTF-8 解码的文件，未把二进制中偶然的 32 字节解释为字面量。

| 范围 | 文件数 | occurrence | unique value | 含义 |
| --- | ---: | ---: | ---: | --- |
| tools 的固定 Git blob | 69 | 695 | 501 | 本报告逐文件、逐出现分类的主体 |
| 其中完整引号包围的 hex64 | — | 680 | — | lexical literal，不等于已证明是 raw 文件 hash |
| 嵌在镜像、路径或派生身份里的 hex64 | — | 15 | — | 例如 `sha256:…`、D1 文件名、`direct:…` |
| 全仓可解码文本普查 | 1,872 | 38,998 | 10,394 | 包含文档引用、合成测试值、fixture；不能当生产 pin 数 |

以下结果共同构成明细，不能只拿汇总数替代它们：

- [tools-classified-occurrences.csv](tools-classified-occurrences.csv)：695 行，含文件/行/列/值、原文上下文、blob OID/raw SHA、所钉字段或对象路径、分类、真实读取者、阶段和变更边界。历史 JSON/策略与 Python 常量可解析时给完整对象路径；重复值保留其所有对象路径，避免猜测唯一归属。
- [tools-reviewed-files.csv](tools-reviewed-files.csv)：69 个文件的逐文件角色、读取者与边界。文件有多个用途时以逐出现表为准。
- [all-hex64-occurrences.csv.gz](all-hex64-occurrences.csv.gz)：全仓逐出现普查，可解压为 UTF-8 CSV；它提供全量检索面，不表示已把每个业务常量都判断为发布 pin。
- [dynamic-sha-sites.csv](dynamic-sha-sites.csv)：动态 SHA/Git 摘要调用站点，独立于静态 literal 计数。是显式 API 模式站点列表，不声称覆盖别名、间接包装或所有语言实现。
- [blob-bytes.json](blob-bytes.json)、[enumeration-summary.json](enumeration-summary.json)、[classification-rules.json](classification-rules.json)：输入字节、汇总及可审阅分类规则。
- [shared-recipe-bindings.csv](shared-recipe-bindings.csv)：tools 外、生产与 CI 共享的九份 recipe 及所引用 proof 字段。它们不能因 checker 仅由 CI 调用就被误判为仅 CI 数据。

这里的全仓文本普查与 tools 的完整语义分类是两个不同交付口径；应用签名协议、业务 scope、迁移历史和合成 fixture 中的每个 64hex 值没有被冒称为本轮发布优化对象。

## 真实读取链分类

| 分类 | tools occurrence | 读取边界与处置 |
| --- | ---: | --- |
| a：普通发布/准备真闸，多阶段值保留说明 | 66 | `maintenanceReadiness`、有限迁移目录、可信 Helper builder、Pi 镜像资格；不能自动跟随源码 |
| b：只合并前候选检查或 CI | 15 | 14 个候选窄资格/复用证明值，1 个 n8n 元数据源码边界值；无生产发布调用方 |
| c：历史/封存/精确恢复或业务恢复 | 519 | 包括活跃控制链读取的封存历史；“历史”不意味着可以删，也不意味着所有值要求等于当前源码 |
| d：不能硬塞三分法的实际用途 | 90 | 收敛生产者 15、退休资格 59、控制采用 8、依赖 5、数据库目录 2、实际启动依赖 1 |
| x：不是文件 byte pin | 5 | D1 文件标识 2、固定 scope key 2、SHA256(empty body) 1 |

**a 的关键调用链。** `publish-prepared-main.mjs:258` 调用 `maintenanceReadiness`，`:288` 才写发布 `STARTED.json`。`manual-maintenance-continuation.mjs:171-181` 按 controller 名称维护受审候选列表；`:294-296` 的 same-AI/Q14 路径会核验候选 controller。源代码字节不在列表，确实会在维护之前拒绝。它被 CI 覆盖，并不会改变它是发布真闸的事实。旧前驱 release/manifest/transport pins 又同时参与失败后的精确 continuation，因此逐项保留多用途说明。

`maintenanceReadiness` 现算的 `sourcePins` 是**本次读取防漂移绑定**，不是新控制器的授权凭证。不能把它交给原白名单比较就声称审阅保证仍在。

**同文件也有 b。** `manual-maintenance-continuation.mjs:206-208` 的 Q14 `assertProfileBeforeSha256`、`assertProfileAfterSha256`、`appContainerAceSha256` 只被 `verify-release-candidate.mjs:272-281` 消费，属于合并前函数块比较。Q14 的 installed/candidate AI 全文件对仍被运行时使用，属 a。整文件统一标 a 或 b 都会错误。

**checker 的入口与数据分开。** `check_schema_code_digest.py` 本身由 `.github/workflows/ci.yml:62` 调用，无生产调用方。但 `main-schema-release.mjs:94-115` 也读取相同 recipe 并运行真实 `*_candidate.py`；`sales_preflight_candidate.py:24-61`、`pi_native_candidate.py:26-61` 现算 `gate.code_digest`，比较 recipe/proof 的 codeSha，失败即拒绝绑定。因此 recipe/proof 的这些字段是 a/CI 共享数据，不能归 b。`check_schema_code_digest.py` 没有自己的 64hex 常量，所以它不在 69 个 literal 文件内；不代表这个门禁消失。

**d 保持真实用途。** `preparation-producer-qualification.mjs` 的 15 次值主要由 `preparation-resolution.mjs:151,280` 在原准备开始、失败后的清理/收敛证明中使用，也被 retirement 消费。`preparation-retirement-entry.mjs` 的源入口策略、`*-qualification` 和 `*-native` 也属于控制采用/退休/取证闭包；不是普通应用发布前置 controller 白名单。`worker-local-runtime-supervisor.mjs:138-142` 的 Miniflare 摘要是实际启动前依赖闸，发布已 STARTED 后仍会执行；更不能误记为仅 CI。三个依赖补丁工具的 SHA 校验第三方输入/输出，并非本仓源码审阅值。

**c 中存在活跃读取者。** `preparation-resolution-history.mjs` 的八条原始 resolution/terminal/evidence 树，仍由 `preparation-resolution.mjs:62` 验证后用于队列判断。`preparation-retirement-history.mjs` 由 collector 读取，防止未知历史代码套用有限角色。不能把这些原件换成当前源码摘要、批量改签或删除。业务 recovery 工具的旧批次/内容 hash 同理，不是本轮提速候选。

## Git 摘要方案的安全边界

本仓 `git rev-parse --show-object-format` 返回 `sha1`。Git blob OID 是 `SHA1("blob " + 十进制长度 + NUL + 存储内容)`；它不是 raw 文件 `SHA256(bytes)`。未来 SHA-256 Git 仓库的 OID 也含 Git 对象类型/长度前缀，仍不等于 raw SHA256。任何清单都须带 `algorithm`、对象类型与协议版本，不能把两个同长度字符串当相同算法。

`git ls-tree <approvedCommit> -- <path>` 返回该授权树里的 blob 身份；`git hash-object --no-filters <file>` 计算现有物理文件的 Git 对象身份。后者只是待验值，不会凭空产生受信期望。默认 hash-object 还可能依据 path/filter 进行转换，必须明确 `--no-filters`、`--path` 或其他模式的合同；不能混用。`git show <commit>:<path>` 得到存储字节，而 checkout 可能应用 EOL/filter；执行文件的 BOM、LF/CRLF 和实际编码必须单独绑定。

现有 `.gitattributes` 对部分 `.ps1/.py` 使用 `-text`，保留已批准 CRLF。本轮**绝不改为 `eol=lf`**。`b8ac6738` 的问题发生在新 workflow Python 文件：worktree 是 CRLF，Git `core.autocrlf=input` 后存储 LF，证据按工作区旧字节生成。它不能用来论证把所有受保护 CRLF 文件改 LF。

| 可选方案 | 是否减少刷新/重复资格 | 必须保留的授权锚与输入闭包 | 保证变化/风险 |
| --- | --- | --- | --- |
| 先冻结最终 index/commit，导出实际要交付的字节，再生成证据 | 优先；可避免 EOL 假失配与错误重签 | 精确提交、完整路径集合、属性/filter/BOM策略、真实导出字节、同轮工具版本 | 不削弱审阅或 raw 完整性；仍需对真正代码变更重新审查 |
| 运行期从**独立批准的固定提交**计算预期 raw SHA，再与执行文件比较 | 可减少散落SHA常量，但新授权仍须发生 | 安装记录固定的 approvedCommit/tree、白名单路径、Git算法/对象类型、checkout协议；实际原始字节读取及TOCTOU/ACL不变 | 若批准锚只是可变 HEAD/origin/main，变成自动授信；Git对象库损坏/缺失也须fail-closed；本仓 SHA1 的对象身份安全属性不能冒称SHA256强度 |
| 单一受信版本清单＋上级 raw SHA256/Merkle 根 | 可明显减少同值多处转抄，仍按变化失效 | 根由已采用不可变控制包/明确审阅批准记录绑定；清单含相对路径、raw SHA256、长度、算法、角色、依赖集合和基线/候选方向 | 只从待验树现建清单再算根没有授权价值；漏掉动态导入/脚本调用/配置即缩小保障；根变化必须重新批准 |
| 仅对审阅资格采用 LF 视图/函数级规范化摘要，同时制品仍校验 raw 字节 | 可能减少行尾/部分非作用文本引起的审阅返工 | 新的、已审 normalizer；明确输入语言/范围；函数外代码、调用点及参数、依赖仍在闭包；原字节仍进入制品清单 | 它改变原“完整字节受审”的保证，不能顺手忽略注释/空白/字符串；PowerShell换行/continuation可能有语义，默认不建议直接采用 |
| `hash-object(candidate)` 同自己现算的 hash 对比，或把当前tree当已批准上级根 | 只是取消拒绝 | 没有独立授权锚 | 会接受未知控制器/弱化builder/任意依赖，不可用 |

新上级清单至少绑定：完整成员集合及无额外文件约束、每个成员字节、可执行 mode/链接/路径规范、所有本地 imports/动态 dispatch 和跨进程脚本、影响解释/构建的依赖与配置、生产者及验证器版本。证明中明确父代、候选方向、资格用途、允许的非作用变化和撤销方式。任意成员/集合/算法/normalizer/解释器/锁文件/角色/前驱变化都按该协议失效；不能仅凭“顶层 root 相同”跨不同 protocol 复用。

## 收益/风险排序与实施建议

| 顺序 | 可改项 | 预期收益 | 风险和需触及的材料 |
| --- | --- | --- | --- |
| 1 | 最终 Git 字节冻结后统一生成 proof/recipe/source map，并比对导出与blob字节 | 直接针对 b8ac 的可避免返工；无须调整CRLF属性 | 生成工作流/新证据，不改旧封存；当前仅方案 |
| 2 | b 的候选窄资格、a 的新 controller 资格采用同一**新**受审清单，保留两类读取边界 | 少手抄、少漏登记，降低a修复又触发codeSha重签的协调成本 | 新工具/测试/协议，a需控制器审阅；若运行期读新清单则需准备并采用新控制包，不能只改仓库 |
| 3 | 按闭包角色拆开资格数据与代码执行证明，避免纯资格表/注释漂移无差别使整组检查证据失效 | 针对0e4/edaa的跨层重签链；收益大于单纯缩短hash字符串数量 | 必须保持原运行代码、依赖和证据真实性；需独立证明剥离部分无副作用，属于高风险协议调整，不能直接缩减CODE_FILES |
| 4 | d-retirement/new producer仅对今后版本使用有根锚的manifest，旧数据通过只读兼容层保留 | 减少新增版本的重复常量维护 | 涉及已安装控制包、native ABI及恢复范围；历史值/原包仍不可改；控制采用需另授权 |
| 5 | 研究资格normalizer或函数级摘要 | 只有评估后才知道能免多少无作用变更 | 削弱完整字节资格范围，需独立安全论证；本轮不建议直接实施 |
| 保持 | c 全部、OCI镜像/第三方依赖/原始guard与manifest | 没有安全依据时不刷新 | 不触碰封存材料和现役包；正常应用更新走原准备/授权链 |

没有配对测量能把这些收益换成发布“节省几分钟”或“减少多少百分比”；本报告只排序可避免的重复人工工作与失配类别。真正代码/依赖/控制代际变化触发重新资格化是原保障的一部分，不能都算成浪费。

## 历史窗口、去重与证据限制

窗口是上海时间 **2026-09-02 00:35:14 至 2026-11-01 00:35:14** 的滚动 60×24 小时；截止由本轮时钟固定，源码截止为更早的基线提交（2026-11-01 00:13:28+08:00）。以 committer timestamp 过滤 main 祖先，排除 merge commit，同一修复的多次 merge 不另计。当前本地 heads/remotes 另作辅助候选检索，不 fetch、不把未入 main 的分支当主线事实。

| 严格确认提交 | 原因 | 类型 |
| --- | --- | --- |
| `1f8ee3c4` | PiNative local-service 字节变更漏候选登记 | 静态必拒 |
| `63aa1f32` | A1 helper提取后Django资格漏登记；S04维护前拒绝 | 已观测拒绝 |
| `4892a258` | B1 worker变更无法由原Django单一例外覆盖 | 静态必拒 |
| `b56a6799` | n8n元数据reader完整源码变了，边界pin仍旧 | parent blob与旧/new pin实算确认必拒 |
| `d28c666d` | Sales154 controller未登记，原静态检查2过1败 | 原报告＋前后原输出 |
| `0e4e851a` | 资格常量/注释进入86项CODE_FILES，使旧Sales proof失配 | 逐项diff与原报告 |
| `2b6c247d` | package新增npm script违反现役guard，重启后不能启动 | 提交根因记录与还原diff |
| `edaa97ac` | batched-status controller漏登记；代码/补充绑定/迁移清单漂移 | 原基线失败与修后对照 |
| `0ee3ef50` | adopt-live后latest入口current pin漏资格 | 仅pin diff，原绊线由红转绿 |
| `b8ac6738` | workflow CRLF工作区摘要与Git LF存储不同 | 提交明确原报错与修复链 |
| `26154a8e` | 已安装watchdog来源pin漂移，健康门禁阻止重新安装 | 动态清单绑定，单列 |
| `a0e5b8e8` | 重新资格入口阶段/路径不适配实际失配，修复仍无法安装 | 同类动态绑定的第二个修复提交，非第二个独立事故承诺 |

严格表按提交计 12，不把同一事故下两次必要修复冒称 12 次独立生产事故。其中真正工具源码字面量/资格/原guard相关为10，另2不是新增硬编码SHA，而是已安装driver清单的动态绑定失配。

候选为 `b72bbacb`、`8411456e`、`70efdd18`、`3904325e`、`f44d224c`、`7c3b2d0e`、`c0e7f9ca`：能看见证据重绑、行尾保全或信任根保护，但不全有足够资料证明是一次已发生的 hash mismatch 触发，故不并入严格数。`3347a5df`、S16/第二阶段计时/A/B功能的资格同步、`90bec5d9`新增代际、`368a88a7`真实主键排序修复、硬链接身份修复等属于正常功能交付或别的根因，均排除。逐文件范围已在 JSON 中保留，既不只列关键词，也不把普通功能更新附带的重签都算失配修复。

[history-screening.json](history-screening.json) 保留筛选候选及纳入原因；`not-counted-screening` 明确不计数。[history-other-branches.json](history-other-branches.json) 独立保留非 main 候选。例如 `2976a1e2` 也是 fbb62792 漏资格的分支修复，main已有 `edaa97ac`处理同一漂移，不能把该未入main的替代补丁叠加主线数。没有扫描 reflog/已删除refs，也未尝试复现旧生产事故；历史证据事实与本轮新执行分别标注。

## 当前安装态与复现

2026-11-01 本轮只读取必要字段：固定配置 `D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json` 的 nativeToolsSource 为 `native-tools/d08a3c4de4bd04325bd8e63811775934e97a9f63f757e40b6afec4a3166ddf31`。已 adopted 控制 bundle 为 `3e01612a935319715ef082f3d9b73a9789401316c136e3e68a2712c5fab6dc6a`，MANIFEST实算SHA为 `5914ece2e40879a04629780003efd6bf66b585835325891d7ad4ee35feb0694e`，绑定 sourceCommit `271ab794fd487e5f943f83d8c83fb81542aa9c27`、35叶、`preparationTriggerMode=manual-only`。CONTROL-INSTALLATION原始SHA为 `f281631c0b516c9a436a1fc4e926213fc37e6b60cc84f842bd2f5b395a7b144b`。它与本轮main源码不是同一层，报告建议不会热改它；未dump全配置或读取凭据。

离线取证脚本按本轮约定放在仓库外 `D:/codex-artifacts/release-optimization-20261101/hash/`，不提交可执行脚本到docs。复现必须在本仓、输出到新的私有目录；脚本只调用 Git/读取文本，不导入应用或控制工具、不连接数据库。

```powershell
python -B D:/codex-artifacts/release-optimization-20261101/hash/enumerate-hashes.py --out D:/codex-artifacts/release-optimization-20261101/hash/reproduce
python -B D:/codex-artifacts/release-optimization-20261101/hash/classify-hashes.py --out D:/codex-artifacts/release-optimization-20261101/hash/reproduce
python -B D:/codex-artifacts/release-optimization-20261101/hash/audit-history.py --out D:/codex-artifacts/release-optimization-20261101/hash/reproduce --artifacts D:/codex-artifacts/release-optimization-20261101/hash/reproduce/history-diffs
python -B D:/codex-artifacts/release-optimization-20261101/hash/supporting-evidence.py --out D:/codex-artifacts/release-optimization-20261101/hash/reproduce
```

本轮验证仅核对生成表行数、汇总交叉合计、固定blob摘要、静态n8n parent失配证据、引用路径与本次文档差异；未运行功能测试或发布器。独立Astra已复核核心枚举、分类依据和安装边界，结论见[本轮独立审查](../release-optimization-review-20261101/REPORT.md)；历史严格下界及未遍历范围的限制保留。后续任何hash实际改动、normalizer、属性变化、控制包采用或应用发布均须用户确认相应具体方案与授权范围。
