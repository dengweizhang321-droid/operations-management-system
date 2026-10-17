# execution 9851 登录前失败闭合工具独立审查

结论：**PASS（源码与方案）**。可以进入官方 UI 短暂停用及只读 inspect 阶段。该结论不声称已经闭合、恢复调度或重跑；apply 和重新启用仍须完成相应现场核验。

日期：2026-10-17。审查基线 `origin/main 0efb8541`；目录 `D:/.codex/worktrees/jd-logistics-rerun-9851-20261017/运营管理系统`。角色沿用映射 `2026-10-15-v3 deep-review / gpt-6.1-sol / xhigh` 的请求；工具未独立返回实际型号。审查者未参与实现或恢复方案制定，未转派。

范围：新 `tools/close-jd-logistics-login-9851.ts`、`tools/jd-logistics-login-9851-target.ts`、`tests/jd-logistics-login-9851-closure.test.ts`，以及旧 preexport IO、pipeline/Chromium 锁、原流水线入口、历史 exporter、BASELINE-v2/TARGET-v2 的直接依赖。旧 9542/9556 源文件保持未修改。

## 已发现并关闭的问题

**[P1，已修复] 历史 helper 完整成员集合漏验。**

初轮 `originalCode()` 只遍历 current/helper 的四个成员并比较各自字节，未枚举 original/helper。独立隔离反例在历史 helper 增加第五个 `node_modules` 目录，不改原四个文件、receipt 或 target hash，工具仍返回 `eligible_intent`。这无法证明所要求的两棵树完全一致；额外依赖目录还会影响 external packages 的解析边界。

实现者已增加 original/current 排序后的完整成员集合精确相等检查，再复用普通文件/完整字节校验。新增额外文件与依赖目录负例。独立相同反例复验为 `ORIGINAL_HELPER_MEMBERS_CHANGED`，`eligibilityAccepted=false`。这是合成准入反例；只读现场枚举的原 8a54/helper 正好四个普通文件，未发现实际额外成员。

保留的独立证据：
- `independent-extra-helper.test.ts`：修复前反例，输出 actualEntries=5、pinned=4、accepted=true。
- `independent-extra-helper-fixed.test.ts`：同一反例在最终代码拒绝，1/1 通过。

命令行反斜杠疑点已排除：初轮源码的双反斜杠只是正确字符串转义，真实 CIM 含单反斜杠；最终 `path.win32.join` 构造与该真实路径等价，不是现场进程身份异常。

## 核心证据链与恢复边界

1. 固定 CLI 只接受 inspect/apply，固定 9851、原 run、原 active/manifest/data SHA、workflow/version、部门/来源/店铺、当前 release/进程和历史 activation；测试 seam 不经 CLI 暴露。目标对象只有原语字段并冻结。
2. 以既有 pipeline → 全局 Chromium 顺序持有双锁，关键阶段复核 owner。只对下载前失败进行资格判断；空下载、首 flow exporting、其余 planned、无 export/receipt/hash/rowCount 以及原失败字节都必须成立。
3. SQLite 只读事务核 workflow inactive、activeVersionId=null、原 version 与 history/图形/时区一致、9851 为 trigger error、未删除/未重试、无同 workflow 在途 execution，并核精确 A/B/release/最终错误顺序和原 data SHA。
4. 不以“历史数据应为空”作为资格。完整分页列表及逐批 currentSelection 细节绑定 BASELINE-v2；每源已有两批及非零 scope revision 通过冻结摘要和重新选择核对。来源/设置/registry/计划、批次列表或精确选择变化均拒绝；本次不是业务数据清理。
5. 历史 8a54 manifest/receipt、完整 helper 树及原 exporter SHA 单独验证。已直接读取原 exporter：唯一 LOGIN_REQUIRED 位于 businessSurface；首次 navigate → identity → flow export，失败点在任何本轮 export intent/点击前。seq241/242 的冻结 activation 记录及其 sidecar/payload/前后关系须夹住原 execution 时段。
6. 既有 installedEvidence 只用于固定的当前 1cb。当前 helper PID、出生时间、父 supervisor 和完整命令行另核，不能把当前安装证据冒充 08:00 历史进程证据。本审查只读确认 PID40640/父40856/出生时间与 target 相符。
7. apply 只 create-only 备存 active/manifest 和 intent；原 manifest、不成功的原 execution 及历史批次保持。无覆盖同卷 move 后再从 archive 复核原字节及全部资格，最终再核 workflow/批次/进程/owner，才 create-only 写 committed。
8. 任一 recovery 目录存在即禁止重复执行。intent 前后、move 后、commit 前中断保留已有证据；不能删除目录重新运行、以 archive 存在代替 committed，或直接重试 9851。工具不执行登录、导出、导入、通知、发布或调度操作。

## 操作前提

- 执行者通过官方 UI 仅停用精确 `JdLogisticsDaily2026`，保留原 `196ba27b-2207-4ad1-ad5c-af7d0f597048` 与原 08:00/Asia-Shanghai 图形。备份仅作为原图保全，不代表将直接回写 n8n 数据库。
- inactive 不禁用 manual。闭合期间必须由本任务独占手动入口；没有其他执行/恢复/发布者改变所核状态。双锁覆盖正常 A/B 流程，不能替代对人工入口的约束。
- 停用后在固定 target 下 inspect 必须重新通过且无 drift；在实际 apply 前由执行者据此核对现场。任何新版本、helper PID/出生时间、批次、scope、目录或原证据变化都须停止，不临时重绑 target 绕过。
- 未获得合法完整 committed 与独立现场复核之前，workflow 保持 inactive。尤其 post-archive unknown 可能已经没有 active.json，不能仅凭该文件消失恢复调度。
- committed 后核对原 active/manifest 保全、原9851继续error、历史批次/当前选择不变、双锁释放和 helper/浏览器无在途，再恢复原版本及日程。仅随后从 A 创建一次新的完整 n8n execution，不重放9851/B。
- 当前已安装1cb继续运行；本轮不借恢复部署尚未采用的登录优化。新完整流程如遇登录或挑战仍按当时原门禁停止。

## 验证

独立执行：
```powershell
node --import tsx --test tests/jd-logistics-login-9851-closure.test.ts tests/jd-logistics-preexport-closure.test.ts
node --import tsx --test D:/codex-artifacts/jd-logistics-rerun-9851-20261017/independent-extra-helper-fixed.test.ts
git diff --check
```

最终结果：**40/40 定向通过，0 跳过**（含新12项及旧入口细分子用例）；独立额外目录反例 **1/1通过**；diff检查通过。新工具测试包含历史非零批次/修订、发布中/错版本/错模式/活动execution、文件/清单变动、批次截断/精确选择缺失、helper忙/PID更换/浏览器占用、历史activation错误、额外helper成员、intent/归档后unknown、move前并发manual和commit前原字节变化。没有运行生产闭合命令；测试写入仅在自动清理的临时目录。

| 首次通过文件（后续增量绑定见末节） | SHA-256 |
| --- | --- |
| tools/close-jd-logistics-login-9851.ts | abe16d2ac03f3d92df979c610a0cd59ac15960d2df289e8565fc68f46d053e7f |
| tools/jd-logistics-login-9851-target.ts | 6cf4bc0da8b3802d0fee5149e65550b366950eca9dc6e806fd15f99ec7c99782 |
| tests/jd-logistics-login-9851-closure.test.ts | 49730da47dfbf7ba6314b2bfeb684e2cbc3d3030259ff70645e5987daf6672d6 |
| tools/close-jd-logistics-preexport.ts（未改依赖） | 3dff17523b1093561cbafddb65eed73ae598ae869c83ec3198d052c526d3d206 |

原始要求、共享 Home、相关记忆及 AGENTS/README/开发交付/模型分工已核对；架构、安全、导入自动化等专题与前轮所读版本无差异，复用对应上下文。使用京东多店铺链路审查技能。所有读取仅为本机受授权恢复的只读替代来源，不涉及原始客户数据或秘密。

截至本报告，审查者未操作 n8n UI、真实 Profile、生产写入、调度、导出/导入/外发，也未暂存、提交或修改被审文件。现场闭合完成与新 execution 业务结果须另行核实。

## 根级全库存 revision 摘要范围修正

结论：**PASS（必要范围修正）**。执行者通过官方 UI 停用后，首次 inspect 在 `SETTINGS_CHANGED` 停止，未 apply、未归档且原 active 保持；随后只修正设置摘要的投影，不重采纳新业务状态。本节不声称已经重新 inspect 或闭合。

已独立读取 `backend/inventory/jd_logistics.py:138` 的 `_base()` 和 `backend/inventory/revisions.py`：所有库存响应的根 `revision` 来自 `InventoryDataRevision(domain="inventory")`，其他库存流程也会推进。JD 的选择和 policy hash 则使用部门 `revision` 与 `scopeRevisions[].revision`，原数据和选中批次有独立证据。把根级全域 revision 变化视为 JD 业务状态变化，会在无物流变化时误阻断。

新增 `closureSettingsHash()` 只通过浅层对象解构排除根 `revision`，保留其他全部原始字段和所有嵌套修订；不是递归删除同名字段。实际选择重算及全部8个历史精确 currentSelection 核对保持原逻辑。

独立 `independent-settings-projection.test.ts` 从保留的 `BASELINE-v2.json` 与 `settings-after-pause.json` 直接比对：原完整摘要仍等于 `TARGET-v2.json` 原 settingsHash；删除唯一根 revision 后，其余对象深等价，新 target 摘要精确由旧 baseline 导出。旧根 `545:aa3942955e87` 与停用后根 `576:6e94f54d5fdd` 的差异未被当成重新冻结业务状态的理由。新 settingsHash 为 `5927857b52cee84c88a79049e55d5c2f8b5f4298f624086577e8ca362ddec052`。

独立2项通过：冻结基线投影和真实 closure 调用路径的根漂移接受/历史选择漂移拒绝；其中另验证部门 revision、scope revision、notification、warehouses 和未知字段共5种变更仍改变摘要。独立定向重跑作者的部门/全域修订及 scope 修订测试2项均通过；diff检查通过。本增量未重复运行此前字节未变的其他40项或声称新一轮全套通过。

| 本增量最终绑定 | SHA-256 |
| --- | --- |
| tools/close-jd-logistics-login-9851.ts | 4d75a18afc367e4b21ff60be24f742a00d74d7003886dbb9049c9f47cb000bcf |
| tools/jd-logistics-login-9851-target.ts | 9c6e45682908d3819b0b306f3a809ca4c85de14f471a48338eef50717bb7760c |
| tests/jd-logistics-login-9851-closure.test.ts | 803603356fecb79f9c607bc046b86ab08ee4ee3aa0c42f09f0432e839ba78e06 |

可保持 workflow inactive 后重新 inspect；原手动入口独占、固定 target、未知不重试、合法 committed 及独立现场复核后才恢复原版本并新A的前提全部保留。本审查未运行生产 inspect/apply、UI操作或任何业务写入。

## 固定部门修订 2/4 的旧 selection 重建与 apply 前独立现场核验

源码增量：**PASS**。当下 apply：**WAIT，不允许开始**，共享 helper 已进入原天猫工作。

本增量固定 `originalDepartmentRevision=2`、`currentDepartmentRevision=4` 和原四个 policyHash 的集合摘要；实际设置仍须与原 BASELINE-v2（部门当时已经4）一致，只有根级全库存 revision 维持上一节的排除规则。代码没有忽略 policyHash：只对 structuredClone 的目标部门4→2，以原 anchor 重新计算四个完整 selection，并与原SHA固定计划中除 stage 外的全部字段深等价比较；另复制还原4后与实际 settings 全等。当前实际设置、原计划与正式 assertPolicy 都不修改，新A使用当前4。

独立 `independent-pre-apply.mts` 已直接读取原 active/manifest、原基线、INSPECT-v3、当前只读设置与所有8个精确批次，完成以下证伪核验后才在 helper 动态条件处停止：

- INSPECT-v3 target 与最终源 target 精确相同；原 active/manifest SHA 与 target 相符，原四 policyHash 摘要相符。
- 原基线目标部门已经4，当前仍4，raw settings 除根级全库存 revision 外与原基线相同。
- 仅副本目标部门改2即精确重建四 selection 的全部字段，包含 policyHash、storeIdentityHash、日期、来源、scopeRevision；副本恢复4后与实际设置深等价。当前4重新算出的 policyHash集合确实不等于旧集合，没有把新策略冒充旧策略。
- 原8a54的 `lib/jd/logistics-policy.ts` 与当前工作树逐字节相同，SHA为 `170f4ed57da9da25c09d5b3a5c52b901d27d4169f2cb8cfe7f41eb0b33e4b146`，且该摘要列在原helper receipt输入中。
- 所有8个历史批次列表、精确 currentSelection 全部与原 BASELINE-v2 深等价，集合摘要与固定target相符；9851仍error且workflow inactive、原196ba版本及历史图形通过 `read9851Execution()` 的只读核验；真实helper PID/出生/父进程/命令行与target相符。

不能据此推断历史2→4的原因只是展示设置；这不是把当前状态写回旧计划，而是原无效果计划的固定证据重建。相关4项测试由审查者独立重跑通过，覆盖apply后实际settings仍4、固定原2/当前4限制、全域/部门修订和scope漂移；diff检查通过。

**动态阻断**：独立脚本在 helper 健康检查读到 `stage=running` 而非 `ready`，未生成通过收据。03:00:39.4107191Z 的后续只读健康确认：`ok=true, stage=running, busy=true, activeWorkflow=tmall, storeExecutionCount=1, drain=null`。INSPECT-v3 的02:59:02旧ready观察已经失效。尚未验证此轮最终端口关闭、锁释放及恢复目录不存在，不把前面通过项拼成现场PASS。

证据为 `INDEPENDENT-PRE-APPLY-WAIT.json`。保持京东工作流 inactive 和手动入口独占；不干预或中断天猫。待原共享工作自然结束后，在同一固定target和已冻结工具字节上重新核验完整apply前条件；若helper PID/出生等改变，停止并另行核实，不静默更新target。本结论不授权复用过期INSPECT、跳过动态门槛或恢复调度。

| 本增量受审字节 | SHA-256 |
| --- | --- |
| tools/close-jd-logistics-login-9851.ts | c6e8f52d706bda7dd0631fa96ba63de0eae5c9ef73b9c4e0dd0d4f62a8348a04 |
| tools/jd-logistics-login-9851-target.ts | 6305d3cbb968651c5252d97ddb8369ae834f5a92473c37a67d55993771b0b3e8 |
| tests/jd-logistics-login-9851-closure.test.ts | 1d0ac1976015563ee5222a4f9089c660bad0b076541cbb75ba3d259ac7a1ecfb |

## 实际闭合与分阶段后置复核

**POSTCHECK PASS**，独立最终观察时间 `2026-10-17T03:15:23.188Z`。此前 WAIT 是当时共享资源准入，不表示已提交闭合未知；各原始观察保留，没有回填。

- `03:08:25.177Z`，`INDEPENDENT-PRE-APPLY.json`：同固定target的独立完整预检通过，原196停用、9851 error/原件摘要、2/4证明及8精确批次、进程/健康/端口、双锁释放、无旧恢复目录均通过。
- `03:09:17.924Z`，执行者原operator单次apply完成committed。审查者没有apply。独立逐字节核对 active.archived/active.original/manifest.original 与固定SHA；intent/committed为合法完整原写入格式、摘要和target相符，operator stdout结果与committed深等价，归档目录成员精确五件。intent SHA为 `531c04591291d7d10bf6955f5503dc120d386d48a67b92a6d7c6fc7018c9f593`，committed SHA为 `8e677ad3d0cac1e2832c893e92b088b20acb2f9abb7d24a6bdfec65704ed75a0`。
- `03:11:10.014Z`，`POSTCHECK-WAIT.json`：闭合、原件、8批、设置、进程、端口、双锁通过；原196仍inactive、9851仍error。仅共享helper正在天猫任务，正确记录closureEvidencePass=true而resource未空闲。
- `03:12:08.757Z`，执行者官方UI恢复原196；`RESTORE-RESULT.json`绑定原version/activeVersion、原shapeHash、Asia/Shanghai和`0 8 * * *`，当时无JD非终态。随后只创建一次manual 9896（03:12:52.715）。
- `03:15:23.188Z`，独立 `POSTCHECK.json`：实际只读DB确认workflow已active且versionId/activeVersionId仍原196，完整图形和history匹配；9851仍trigger error、未删除/未重试、原data SHA保持。唯一JD非终态为manual9896 waiting。已直接解码其runData，仅manual→claim→IF→Wait，尚无A/B；不能再把当前状态当作恢复前inactive，也不能创建第二条新execution。

已独立核定原图：manual只连claim，claim只连IF，只有coordinationStatus精确为granted才进A，false进Wait并回claim；执行头使用本execution ID、workflow=jd-logistics及runIndex。Wait节点为1.1、unit=minutes，已读本机安装的n8n Wait.node.js确认该版本默认amount=5，回环是5分钟。9896首次claim为waiting/legacy_workflow_active；实际1cb bundle的SlotManager在legacy请求遇现有store slot时使用该reason，响应中的activeWorkflow=jd-logistics不能当作JD已获资源或自锁，先前实际health占用为tmall。

最终postcheck仍逐项核对8个列表及精确currentSelection、原设置投影/部门4与旧副本2的全selection证明、当前1cb installedEvidence、原helper PID/出生/父进程/命令行、9224端口关闭、双锁释放、原active缺失、源operator/target SHA与独审绑定保持。最新health已自然ready/idle，因此最终 `resourceAdmission=ready`；旧WAIT不改为成功。新9896仍在原Wait期限内等待重新领取，不应补click或直接调A。

具体安全路径无剩余阻断：保留原196，并只跟随既有9896从原claim回环自然获得granted后推进完整A/B/C/D/release；禁止重放9851、第二次闭合、重复新execution或直调A/B。审查者未操作UI、生产写入或业务步骤。该后置PASS只证明闭合及恢复/排队阶段，**不代表9896下载、导入或业务终态已经完成**。

字段解释附注：POSTCHECK原回执SHA为 `91a5c956bc9662037cadb4aafc7de0ec87793893cd7b293fc164d65983a11cd4`，保持原字节。其 `resourceAdmission=ready` 命名不够精确，应解读为该时刻 **resourceAvailability=ready**（helper健康快照）；9896自己的 **executionAdmission=WAITING**，直到原claim实际返回granted才成立。此附注澄清字段含义，没有回填或修改原观察，也不允许通过health跳过既有Wait。

## 9896 实际失败结果独立取证

`RERUN-REVIEW.json` 在 `03:23:03.217Z` 独立生成，**verdict=PASS 仅表示失败取证可信；workflowStatus=error，工作流没有成功**。9896按原Wait后再次claim取得granted，进入A/B，新run为 `jdl-794e9ecf-03e1-4189-bd88-8f3af6f95cc2`，于 `03:18:46.970Z` 终止为error。

独立重新解析三份原文件：flow 352、shop_products 906、realtime_inventory 427行；文件字节SHA、规范内容指纹、大小、export-manifest的任务/来源/行数及downloaded结果均与当前failed plan一致，采用的parser与当前1cb源快照逐字节相同。三源为validated；snapshot为exporting且目录为空、无export-manifest/export/rowCount。原1cb源码证明其稳定门槛在snapshot导出manifest和导出点击之前。四源全文件屏障未通过，因此全部receipt缺失、未开始本轮导入；API全8个历史列表及精确currentSelection与原BASELINE-v2深等价，批次摘要保持。

n8n实际runData核对了最后claim granted、A planned、B原runID及500错误 `JD_LOGISTICS_SOURCE_COUNT_UNSTABLE`、失败release返回released以及最终明确error的顺序；C/D均未执行。原9851继续trigger error，原dataSHA、manifest与committed归档保持。原196版本/activeVersion和完整shape、Asia/Shanghai每天08:00调度保持active。

9896当前active精确绑定此新failed run并保留，没有要求它为空或将其归档。无JD非终态execution，9224端口关闭，pipeline及全局JD Chromium锁均已释放，当前1cb/helper进程身份仍匹配。03:23:03的共享helper busy/running属于tmall，不能当成9896仍运行或京东清理失败。

原因边界仅到原 `stableSourceRows()`：最多30次采样、每次等待200ms，要求count等于已观察查询总数且scopeHash匹配连续两次；名义轮询等待6秒，不包括每次DOM/范围采样耗时。原现场未保留具体count/scope采样日志，无法区分行数解析、行数不匹配或scopeHash未稳定，不断言平台慢。

独审没有修复、重放、另起execution、闭合9896、部署或写入业务。必须保留新active、三份原文件和manifest及原失败；不能套用9851零业务效果闭合，因为本轮已经完成三个真实下载。后续处理不在本次只读审查范围。

