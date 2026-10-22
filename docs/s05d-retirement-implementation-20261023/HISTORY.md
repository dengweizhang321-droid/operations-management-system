# 已消费且缺少 payload 的 Worker 历史布局资格

本页记录隔离实现与有限只读事实，不是退休、封存、零效果或现场恢复结论。当前原 unknown 保留；本叶不执行历史工具/API、不移动历史链、不写生产。

## 原生角色和读取范围

现行 `release-payload-retention.mjs` 的 `payloadNames` 仅含 `dist/helper/source-snapshot/node_modules`；计划按已经验证的 bootstrap/successor 链排序，并保留全部非 payload 元数据。配套 PS 在删除前核精确路径/manifest/实际引用，删除后核保留材料和链 SHA。因此“已消费链仍保留 manifest/audit/tools，snapshot 已不在”是原生可出现的布局；本轮不据此追认某次 cleanup 已发生，也不执行该 planner/清理器。

root 的 [protected-history-shapes.json](protected-history-shapes.json) 绑定原 dispatch 前驱 head/chain SHA：262 个已消费 release，221 个 snapshot 缺失。本叶先只枚举直接成员及文件大小，再按预算读取这221个 manifest（总1,518,228字节）与1,872个 top tools（总94,730,448字节）。每个工具实际 SHA 均等于其 manifest `artifacts.keyFiles` 相同路径的 pin。未进入 `dist/helper/source-snapshot/node_modules/.runtime/.wrangler/tmp` 内容，未读取 `.dev.vars` 内容。`.runtime/.wrangler/tmp` 只记录直接成员类型。

完整非敏感投影见 [history-top-tools.json](history-top-tools.json)：19个工具名、104个全文 SHA、16个 Worker builder、10个 rotation。原始代表位置为 `byName[name][sha].firstPath`，其大小/使用次数与221个实际 release 对应关系一并保存。helper 内只接受这些已核全文 SHA 与3个已核 launcher SHA；未知名字、未知字节、额外 top 成员、manifest缺 pin 或字节不匹配一律拒绝。另一次metadata-only投影核过1,872工具与219个launcher全部nlink=1（history-link-shapes.json），资格入口对manifest/工具/launcher保留单链接要求；.dev.vars只核名字/类型，不读取内容。它不使用源码字符串正则来授予任意代码资格。

top 的 `运行项目.bat` 有219份、3种完整字节，均仅调用同目录 `worker-local-service.ps1 -Action Start` 或 `operations-system-control.ps1 -Action Start -Open`。实际字节/角色见 [history-launchers-native.json](history-launchers-native.json)。首次通过 PowerShell stdin 嵌入中文字面量的试采得到0份，保存在 `history-launchers.json` 并明确无效；随后用 ASCII Unicode转义/原生目录名字重采219份，未用前次空结果建立资格。

## 来源与消费政策的有限事实

| 已核角色 | 本案相关入口与边界 |
| --- | --- |
| 16个 `worker-local-release.mjs` | CLI deploy 的 `--source-root` 必填；4个版本默认常量为 legacy combined，12个为 sales-release。独审逐版核过实际全文 SHA、相同 `assertNoReparsePoint` 与 `listGitSourceFiles`：实际 source 实体/祖先检查先于 `ensureRuntimeMarker`，Git只使用 `git -C <source>` 的文件清单，无其它源或 snapshot fallback。较新 bound 家族还先核绑定及根相等。`--allow-test-runtime-root` 能略过固定根限制，**不能略过实际 source 实体检查**；显式已关闭原址仍在 runtime/artifact持久写之前拒绝。此处不声称全部支持参数都只能用combined。
| 10个 `worker-local-release-rotation.mjs` | 旧7版 plan 从导入的 `workerSourceRoot` 构建；后3版增加 fixed `worker-prepared-builds` 的自动/显式复用，最后一版还支持精确source-binding。实际来源采样在自动复用选择之前；bound来源先通过原绑定/实体核验。全部 apply 保留固定生产 runtime，production apply 拒绝 test runtime 覆盖。没有 worktree/checkout/clone/fetch 来重建366来源。
| 23个 `worker-local-service.ps1` | Deploy 的 SourceRoot为显式参数或对应版本固定根，并传给同一已核 Worker deploy；test flag不改变该callee的实体前置。Start/Stop/Status及已有rotation委托操作既有受控runtime；它们不是缺失source的重建器。
| 20个 `operations-system-control.ps1`、2个start、7个supervisor、5个guard | 为既有runtime选择/启动/验证路径；不存在构建Git source/worktree的入口。保留这些代码可继续控制其它合法当前版本，本资格不把此能力误称a3继续，也不批准无关生命周期动作。
| 3个 `release-batch.mjs` 与3个admission | batch把worker plan/apply委托同一rotation的精确plan SHA；admission读取固定state plan，并读fixed/bound来源、prepared receipt与candidate binding。较新bound分支核 `worker-prepared-builds/<plan>.json` 与candidate manifest。batch中的source参数只用于原输入/影响盘点及绑定，不从Git提交造新工作树。Django候选继续委托原生id路径；本案旧id的禁消费仍由完整原生工件闭包完成。
| 3个impact、1个preparation-evidence、1个no-data-observation | 读source/plan/receipt或记录输入变化，不是source恢复器；preparation-evidence监控传入根并重新盘点，未从manifest指纹合成source。
| 2个daily-backup、3个lifecycle-step、1个process-deadline、1个readonly-retry、1个admission-timing、D1 proof两角色 | 分别为已有受控backup/lifecycle/进程/只读观察的委托或证据角色；本案prepare-only、无migration/Pi范围未把它们列为原a3可能的新作用。保留代码不证明其全部其它业务语义或任意自写调用安全。

可复核的原始行锚点（均在投影 `firstPath` 对应实际字节）：bootstrap Worker `bf0c9267…9550e` 第27行固定根、603–624 Git清单、1436–1468源前置、2528–2573 CLI；最早 rotation `493105e9…f493c` 第236–250行固定release manifest、第734–742行plan/sidecar、第967–989行fixed源构建、第1214–1236行生产apply；最后历史rotation `ec5254ee…b1f3a` 第1105–1153行绑定/身份/自动复用、813–819行plan/sidecar、1424–1439行生产apply及candidate snapshot。16个Worker来源/前置已由独立review逐版核对；本叶读取10个rotation对应入口和消费常量并按完整SHA归类，不用一个版本推断未知字节。

## 旧工件寻址不能漏掉

全部10个rotation的固定域相同：`state/worker-release-rotation-plans`、`worker-release-rotation-consumptions`、`worker-release-successors`、`worker-release-publication-staging`；后3版自动复用还读 `state/worker-prepared-builds`。plan必须存在精确 `<sha>.json` 与其 `.sha256` sidecar；candidate始终从 `releases/<releaseId>/deployment-manifest.json` 定位并核其原绑定。构建临时物来自同runtime `.staging`。自动选择只扫描上述prepared域，随后仍读原plan、receipt/sidecar和candidate manifest；没有不同历史版本的alternate工件目录或从manifest重建source的fallback。

因此 helper 返回的 `artifactDomains/artifactReleaseRoot/artifactStagingRoot` 是必须由collector完整盘点/封存的义务。它不凭source已关闭便宣称旧plan/receipt/id不能消费。batch spec本身的指纹/id不包含可重建的source或完整candidate；受支持worker调用最终仍进入上述实际原件寻址，Django委托仍须原native receipt/deploy-id存在。本案工件集合及boot后重盘点由core/collector继续完成。

## 接口和集成要求

`qualifyRetirementHistoricalSource({context,chain,manifestFile,manifestSha256,original})` 只能用于：受原dispatch已验证前驱链覆盖的已消费历史成员、早于/等于原前驱、不是当前head、snapshot/payload/Git source实际缺失、且manifest不声明原source元组的分支。它重算原前驱chain prefix与当前chain SHA，核实际manifest绑定/完整字段、top布局和全部工具字节。不同manifest或缺snapshot本身不能通过。

返回值无时间漂移字段，包含实际pin、链锚点、external source依赖和工件域；`originalOutcome=unknown`，不重试不发布。保留历史根原位，不产生sourceAction。`qualifyRetirementHistoricalSourceForTest` 只接受全部在私有Temp根内的测试拓扑/合成policy，生产入口没有policy/root override或外部proof布尔。

collector完成全部固定根、注册Git源、sourceActions与closedSources的判定后，必须一次调用 `assertRetirementHistorySourceClosure` 并保存结果。参数还包括 `sourceInventory/originalGitTree/registrations/distinctions/mode`。原源/各版本固定根及注册源必须为实际缺失、实际不同字节、复核的完整干净Git成员差异，或在planning/closing阶段同对象身份的确定关闭动作；after-close禁止仍开放。closed源重新出现、difference叶变化或Git身份变化均拒绝。

Git移动后仍有archive registration是合法保全角色，只能按冻结closedSources的**确切destination**匹配：kind/role、原registration/source、固定state/ra父域、原址缺失、archive对象dev/ino/type以及HEAD/branch全部相符。不会按archive前缀跳过其它注册源，也不会把archive路径返回旧consumer或再次移动。

此helper每次collection重新读取当前实际字节；最终boot后collector及两轮独立observer仍须再次调用/复验。新boot必须覆盖source-close，原址/旧id恢复、来源生成器或未覆盖alias仍阻断。不同Git/仍有snapshot的 `publish-latest-main/publish-main` 生成器资格由implement的独立source-entry叶处理，本helper不以“来源不同”替它排除，也不扩大到全机代码执行封禁。

## 必要检查与当前状态

私有6项检查通过，涵盖原前驱prefix、稳定closure、未知码/原元组/缺身份字段、snapshot/Git/payload/未知布局、实际source差异/同identity关闭/after-close重现，以及真实私有 `git worktree add → move → exact archive registration` 的重收与反例。随后仅新增有界读取增量：先metadata预算再hash，oversize工具/launcher定向1/1通过。原6项结果复用，不宣称为了这一个预读取门禁重跑全部7项。没有生产Task、旧工具/API执行、服务/数据库写、历史移动或提交/推送。

模块需纳入最终 `controlFiles`；collector集成、完整source-entry/reader和实际包隔离加载尚待完成。代码/私有检查通过不等于221个现场history已取得最终资格或S05d/S05b已通过。

同锁轻CAS交付：每个实际读取的top工具与launcher均把同次完整SHA读取返回的dev/ino/size/nlink/mtimeNs/ctimeNs放入proof；manifestSignature同样来自本次完整读取并在资格末尾复核稳定。collector/core可在最终ACK之后只做这些逐叶签名与成员集合CAS，不重读94.7MB；这些签名不跨collection缓存，不代替各轮完整SHA重采。新增单链接/先预算/签名稳定增量定向2/2通过，原6项独审结果继续按未受影响范围复用。
