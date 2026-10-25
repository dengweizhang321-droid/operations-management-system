# 接续检查点

2026-10-13，当前聊天接续；此文件随工作更新，不是发布批准。

- 工作树：`D:/codex-isolated/jackyun-unified-recovery-20261013`。
- 分支：`codex/jackyun-unified-recovery-20261013`；本轮起点 HEAD `62e57b0b6fb6e04001c963d5f871b14e04f5374c`，53 个 tracked 修改及新增文件保持。
- 原成果和日志未覆盖；之前的保全及复现位于 `D:/codex-artifacts/jackyun-unified-recovery-continuation-20261013`。
- 本轮独立证据：`D:/codex-artifacts/jackyun-unified-recovery-resume-20261013`，`source-start.json` 逐文件绑定现有修改。原 CONTINUATION 的“待补”已有部分实现，不能据该旧清单重复开发。
- 已核对已有五模块逐点响应丢失的完整管线测试、库存/库龄/销售真实事务负例、publication baseline v2 规则绑定和自动派发单消费者代码。
- 上述三个文件已完整串行结束，13/13 通过，0 取消，退出码 0；五表各一个提交响应丢失断点、随后跨日迟到复验均通过，原批次提交次数保持 1。
- 当前 HEAD `f2ec557a0f5fd097d4811f72b17536174f98d8ba`。另一接续聊天在收到暂停时于 10:57 同步了 main；现已核实其 idle。本任务文件按起点摘要比较没有该聊天的新增变化。主目录用户修改保持。
- 本轮补充：ERP/销售 writer readiness 纳入新增审计/发布基线字段。真实旧结构拒绝、新迁移结构通过已加入迁移演练；`postgres-final.log` 57 项通过、退出码 0、独立集群停止及临时密码文件删除。
- 真实 n8n 首次复验启动超时、第二次 REST 请求超时保留。已把合成数据库 CLI 导入/元数据写入移至服务器启动前，第三次进入 C 后被真实规则摘要门禁正确拒绝：夹具在 A 前写紧凑 policy、B 又改为 pretty JSON。现保留同一夹具规则字节，不放宽生产摘要校验。
- 已完成真实 n8n：`real-n8n-bound-human.log` 退出 0，人工授权派发/Webhook/真实 helper/A—E 全部成功，五模块各合成提交一次，旧 8548 不改且逻辑目标 completed。修复了带 query 的恢复目标路由未匹配；真实正例和非法/重复 query 负例均覆盖。
- `final-regression.receipt.json`：524 项，523 pass/1 fail/0 cancelled，源码前后摘要相同。唯一未改动 watcher case 已原断言、原 timeout 单独复验通过；保留首次失败，不称全量全绿。`final-lint` 0 errors/112 warnings，`final-boundary` 通过。
- `final-types` 退出 2，188 条；与独立旧基线按诊断位置归一化后 188/188 完全一致，新增 0。`types-comparison.json` 为对照。
- 当前源码和独立采用源码生产构建都已退出 0。采用源码另一次 PostgreSQL 57 项通过、集群及密码文件清理；helper SHA 与真实 n8n 成功样本一致，原构建证据验证器通过。最后历史 Windows 身份/独立 EOF 复验 6/6 通过。没有本聊天留下的在途验证命令。
- 离线候选 `D:/codex-isolated/jackyun-unified-adoption-20261013/source` 已从实际前驱组装，5199 文件/94 差异，其他前驱字节未变；源码、dist ZIP 逐成员 SHA 回验完毕，`CANDIDATE.json` 已封存，inventory SHA `40ea5e7088074cd1345c7245bd494d252ea0734c3aa92bef7409b67941dcc76b`。node_modules 仅为隔离开发依赖 junction，正式准备须原工具独立 npm ci。
- 已只读读取正式 n8n 两条流程发布版本、节点摘要、调度一致、空 pinData、无在途；`formal-n8n-diff.json`。进程 3000/5791 的路径和命令行仍不可读，在线 plan/PrepareApp 无有效回执，不能声称采用包已达到可封存执行状态。
- Git 已交付：源码 `e511a5a8`，合并 `11235a61` 已推 main 并回读包含源码；随后仅文档收尾。运行验证与失败边界见 REPORT。原树和所有旧日志继续保留，不从头开发或重跑已完成检查。
- 下一步仅为生产准备阻断的解除：取得合法管理员身份预检能力，重核正式前驱/两个 n8n 发布版本，再用原在线 plan/PrepareApp 封存精确批次。完整采用包达到可执行状态后，按用户要求一次性确认对应生产范围；未获该授权不启停、不更新、不补跑。权限缺口不通过反复普通权限调用解决，不绕过保护。
- 禁止提前生产部署、启停、正式 n8n 更新、调度变更或真实补跑。既有源码构建、合成网关五表和生产验收分别记录。

## 12:00 后 Windows 权限接续

- 用户要求由当前会话处理实际 Windows 权限。正常 `Start-Process -Verb RunAs` 只读检查已成功：管理员进程可读 3000/5791 路径及命令行；见外部 `admin-identity-probe-1f5764f907d3496fac5c1cf753ef7896.json`。这是一次临时提权，未改 UAC/ACL/服务，未授予部署或补跑。
- 文档接续分支 `codex/jackyun-online-preparation-20261013` 从最新 main `5acd61af` 建立，复用原工作树并保留 59 个日志。
- 候选源码字节不变，新增独立 Git 索引以符合原工具源清单要求；只移除原 node_modules junction，目标依赖未删。候选内独立 `npm ci` 成功，原 postinstall 补丁执行；首次离线源/dist ZIP 保持原字节。
- 临时管理员进程 PID 48180、Node 37940 已结束；只运行已核 SHA 并持打开句柄的外部 `prepare-online-admin.mjs`。同一 Node 顺序执行原 Worker 在线准备和原 Django PrepareApp，没有 apply/DeployApp/Start/Stop/工作流写入/补跑。
- Worker 成功：plan `305a355a…ee3654b`，候选 `20261013T040853Z-8517af2a5fa7310f`，manifest `f6c589d7…acdd9ec`，42 原合约通过。完整值见 ONLINE_PREPARATION.md，不重复 Worker 准备。
- 整体退出 1：Django PrepareApp 被 `bi_app_addition.py successor` 拒绝。只读重现为 `BI append changes another migration or the reviewed step`；对照已部署 app，仅新增 ERP 0003、sales 0011，无旧迁移变更/删除。
- 当前剩余是迁移治理兼容性缺口，不是 Windows 权限：既有 BI gate 只接受原 140 目录，须为两个新审计迁移补严格准入/安装/恢复/后继协议，再做隔离验证和重新准备。不得修改计数、删 active、伪造原证据或跳过 guard。独立 PG 57 项不代替生产迁移谱系证明。
- 证据仍在 `D:/codex-artifacts/jackyun-unified-recovery-resume-20261013/online-admin-20261013-v1*`，及 `bi-successor-readonly.json`、`migration-preparation-gap.json`。无在途进程；旧候选/日志保留。任何新源变化须绑定新的准备身份。

## 当前步骤 1–3 检查点（2026-10-13 18:20）

- 复用同一隔离目录；当前分支 `codex/jackyun-migration-adoption-20261013`，起点 `72da6acb`。远端 main 已前进到 `07d32e24`，尚未合入当前未提交工作。
- 原统一恢复源码 `e511a5a8` 已合并；目前补 140→142 两个审计迁移的有限准入、原父谱系核验、原子安装/不确定结果回查及备份消费兼容。当前工作未提交，不能当作生产可采用。
- 本阶段证据 `D:/codex-artifacts/jackyun-migration-adoption-20261013`：unit-first 8/8；postgres-first 首次失败保留，因 SQL JSONB 返回字符串而测试预期类型不符，修正为数据库布尔比较；postgres-second 62/62、退出 0，独立 140/142 原 profile dump/restore 成功，集群停止、密码删除。测试根 `.codex-tmp/jackyun-recovery-postgres-f0tql2v9`。没有在途测试进程。
- 仍需完成发布步骤顺序/动态备份回执绑定测试、门禁中断负例、最终验证清单、审查和 Git 交付。
- 17:26 只读现场：Worker `20261013T034151Z-1513c2b267930390`；Django manifest `2f4115e6ad55f08a6fde4cacd24f68636e27e1214909485663e860a5d840e885`。此前 `21c2645a` 前驱的旧候选/plan 保留作证据，不再可直接采用。新包必须重核实际前驱并保护已部署其他修复；不得把尚未采用的全部 main 混入。
- 下一步：定向完成迁移采用适配与验证，冻结源码，再构建新候选并执行原在线 plan/PrepareApp；只做步骤 1–3。尚未进行任何生产部署、维护启停、迁移、n8n 修改或真实补跑。

## 18:35 接续

- 源码提交 `cacfa78c` 已推 `origin/codex/jackyun-migration-adoption-20261013`；已快进包含 `07d32e24`。尚未合并 main，等待实际候选构建/准备。
- 最终 PostgreSQL 62/62 及 140/142 独立恢复退出 0，目录 `.codex-tmp/jackyun-recovery-postgres-eh5g6oph`，有绑定当前源码的 `audit-validation.json`。所有隔离 PG 已停、密码已删。
- 发布回归 `release-final.log` 109/109；`fastpath-private-final.log` 23/23；新增 Python gate 10/10；旧 139 冻结源码测试 10/10；lint 0 错误/112 警告；backend boundary 通过。
- 原 watcher 的失败经真实监听事件证明为全局 npm 目录发生变更事件；保存 `watcher-diagnostic.log`。原断言在复制 Node + 两文件合成 npm 的私有运行目录通过，不修改生产监听门禁。首次 PostgreSQL JSON 类型断言失败、提取执行器夹具漏绑定常量等失败证据均保留。
- 新候选工作目录 `D:/codex-isolated/jackyun-audit-adoption-20261013/source`，历史表示仓库同父目录 `history`。基于实际 `87896631` 快照，108 个任务文件（测试脚本在生产不存在是预期新增），其他修改前源码均匹配；构建程序 `D:/codex-artifacts/jackyun-migration-adoption-20261013/compose-candidate.py` 正在完成逐字节校验与 Git 封存。首次独立仓库缺作者身份失败已保留，复制项目现有 Codex 作者设置后在同目录无覆盖续接。不要再次从头复制。
- 新有限采用批次保持 strict/full：维护和停稳→140 备份/恢复→Plan→Worker apply→DeployApp/HardenAcl→Install→142 备份/恢复→Finalize→ExitMaintenance/Start→验收。旧批次不换绑或重解释。详见 MIGRATION_ADOPTION.md。
- 下一步在封存完成后，以新外部 `prepare-online-admin.mjs` 和 `prepare-admission.py` 的精确 SHA、正常 RunAs 临时管理员、固定日志执行原在线 plan/PrepareApp；尚未启动本轮提权准备。禁止执行任何 switch、生产迁移、正式 n8n 更新和真实补跑。

## 用户暂停条件（2026-10-13 19:15 后）

用户明确要求：待“OpenCode Go 添加请求头”发布完成，再继续本任务。停止当前开发与准备，不接管另一维护窗口。

- 关联聊天实际标题 `为 OpenCode Go 添加请求头`，ID `01a1348d-c304-7e12-8139-6bb3cc854836`。最新 wait cursor `5a51e67e-857a-4993-9749-cebe9bd648d6:2`；对方正在处理管理员进程缺 PowerShell 7 路径后的同一维护续接。不得据聊天 idle 判定发布成功，须核实其采用结果、维护退出和实际正式状态。
- 外部维护 ID `db9caa954a6b412f83074d6b9a40bce0`，19:07 仍存在；Worker receipt 暂时不存在。不是本聊天创建或执行的维护。
- 本任务源码 `cacfa78c` 已推开发分支，未合并 main。origin/main 已到 `a7423963`；新 AI chat/provider/workflows 变化尚未合入本开发分支。主目录仍须保护。
- 冻结组合源码 `D:/codex-isolated/jackyun-audit-adoption-20261013/source`，Git 表示基线 `63c78c19725efa851dd753928e2dfbc06e2adf31`、候选 `b59f2ff31b27820c33e68954e978e410a370d0b3`，8265 文件、107 实际差异；scope plan SHA `035294878b69b8c2ef28ee3e5ed599acab8caa578e1531173f8205181f487ce0`。
- Worker 在线准备已成功：candidate `20261013T103744Z-8aeaf22fa1596826`，manifest `e036d923788a5c645fcbb52beb577ef7c268873ac79af045d3ca01599ec227bf`，plan `2e53458196da8d9f7b16132a7bc128dddf117339163e7807fb21578439585500`。helper 与既有真实隔离 n8n 证据完全相同 `16acb5a0...`；75 个恢复运行文件逐字节相同，见 recovery-evidence-reuse.json。
- Django 18:58 首次 PrepareApp 通过新有限审计准入，因候选源缺 Wrangler CLI 而失败。已从同一已验证 Worker 制品复用 34 个包/1573 文件的精确 Wrangler 闭包至候选 node_modules，无 junction、不重装或重建 Worker；wrangler-dependency-reuse.json 记录逐文件摘要。
- Django 19:03 第二次准备在 driver 的 Worker 前驱回执检查处失败（外部维护已移除 receipt），尚未调用 PrepareApp。两个管理员 launcher PID 46872/43972 均退出 1；无本聊天在途进程。不要盲目重跑整套 Worker 准备。
- 正式父谱系准入 evidence `admission.json` SHA `b12483473c02b0e3b5971c6d385a86511b04ba57a0685c0d6a95cc9e988703d7` 绑定当时 Django manifest `52f0d18a6f0f9c5b9bf78f98fd8bc55747eb83f6f86e6bfd599d0a105db8de12`；外部 Django-only 发布后必须重核，不换绑旧证据。Worker source-snapshot 与实际 Django app 可能形成混合前驱，须保留对方新发布 backend 内容，不能用旧 Worker 快照回退 AI 修复。
- 当前额外未提交文件：任务 HANDOFF 追加、`docs/jackyun-unified-recovery-20261013/adoption-checks.mjs`、`tests/jackyun-adoption-checks.test.mjs`。只读验收和 n8n 已发布版本观察器已做 3 项负向测试及定向 lint（均通过）。尚未生成完整可批准 batch，不请求抽象上线批准。
- 观察器 n8n-publication 只读轮询正式 SQLite；需要获批操作者通过原 n8n 编辑器发布精确两流程。保存草稿不足以通过；已发布前驱/图/设置/在途异常保留失败并停；观察器本身不发布、不写 SQLite。
- 恢复后先重新核查维护和完整生产前驱，再决定现有 Worker plan 是否仍有效。若实际 backend 已更新，需重新组合并绑定新候选，不能把旧 plan 冒充同一制品有效。完成必要审查、提交合并推送和完整采用包；本任务生产部署、迁移、正式 n8n 更新、调度及真实补跑仍需完整包后的一次明确批准。

- 已创建当前聊天条件检查 heartbeat：ID opencode，每 5 分钟只读检查上述发布状态；未满足时安静等待，满足后先暂停该自动检查再恢复步骤 1–3。

## 明确暂停（2026-10-13）
用户最新明确要求‘暂停’。当前任务和条件检查 automation opencode 均已暂停（工具确认 PAUSED）。原‘等待 OpenCode 发布后自动恢复’规则已被本次暂停覆盖；即使 OpenCode 发布完成，也必须等用户明确恢复后才继续。全部源码、候选和未提交内容保持。

## 用户恢复后检查点（2026-10-13 21:45）

- 用户明确“继续工作”，覆盖此前暂停。OpenCode 聊天 completed；原实际普通用户 Status/Core 全部 ready、维护与排空不存在。条件检查 automation opencode 保持 PAUSED，不再重复接续。
- 本分支已保存未提交验收脚本为 75d30618，并合入最新 origin/main 71997465，无冲突；尚待本轮最终审查和推 main。主目录保持保护。
- 新冻结组合 ea3508e4/source-after-opencode 保留实际 OpenCode 四个 AI 文件，8265 文件、111 差异，scope plan 9fb96436，旧候选和 plan 不改写。
- 新准入 admission SHA 9c0b19fe5a0578a0095032a3443ef0a0540d01c967f19a449bac1a361495bee7，绑定实际 Django 08695d0d。原普通上下文 PrepareApp 成功：8f80516fc95c47be9705b10586f021d8 / receipt 40f053ae31a5c6d43b0f5e652e9324a2c7b80bda9dfe22635d89f364ee923810 / manifest 7a332281c7f566bf45a0ace437b1f5579d6b71d7fa91140dd57229f61c662f06。生产切换、迁移、启停仍为 0。
- Worker 原在线准备通过 exec session 63877 进行，外部 prepare-worker.mjs，仅普通上下文原 plan/构建；进度 worker-progress.json，尚无完成回执。不要重跑或同时重建。
- E 盘两个 138 代旧保护项占满 pins；本次采用方案拟在新 140 前点 Verify/Restore 成功后替换较早 9/28 保护，保护新 140 点，以保留 9/29、新 140、新 142 共三点。须在最终批准包明确该保护变化，当前没有改设置/备份。
- 下一步：完成封存 batch、真实原参数/依赖/普通启动上下文检查和隔离未知结果演练；复用源码未变的业务/PG/真实隔离 n8n 证据，不把只读生产验收当真实五表导入。

## 当前用户指令：直接发布，不新增备份或演练

- 用户明确“不需要备份、不需要演练、直接发布上线”，随后明确“只需要检查修改的代码没问题后，直接发布即可”。此为本次生产发布授权，覆盖之前要求等待批准及新备份/演练的任务方案；不自动授权真实业务补跑或消息发送。
- Worker f9120341 的在线准备已完成，原 Django 8f80516f 也完成；均未切换。旧封包保留。本轮有限采用路径调整改变四个工具，须准备新的来源与制品，不能换绑旧计划。
- 新限定协议如实记录没有新备份/演练；旧 v1 和 BI/139 历史证明语义保持。两迁移源码、数据库事务/锁、原表摘要、身份/目录/互斥及未知结果回查保持；新增路径先静态审查、语法检查，复用此前与未改函数绑定的隔离证据，不再运行发布演练。
- 原两次私有 n8n 发布演练失败证据及脚本保留。静态读取安装版发现 Wait webhookId 自动生成会改变发布图，正式提案须显式固定这些字段，保留原节点已有 ID；不放宽发布后精确图比对。
- 本聊天截至该记录没有生产维护、服务启停、迁移、工作流写入或补跑。在途验证/演练均已结束；后续按用户授权执行发布。

## 最终静态修正与候选（22:49 后）

- 远端 main / 开发分支已为 `4807ac54b5fecde767ff61500fcbd51dfd132a7f`，包含原有限采用 `cacfa78c`、验收观察器、OpenCode 后端修复及本次显式省略新备份/演练协议。
- 静态复核补齐原参数封包 `withoutnewbackup` 布尔开关。只停止本聊天未切换的准备 Node 32780；原失败/取消及 `direct-publication` 候选保留，没有停生产或清理旧锁。
- 最终源 `D:/codex-isolated/jackyun-audit-adoption-20261013/source-user-directed-final`，表示提交 `178df20ec32298fe84ec503654b1380d0c36f1f4`，8265 文件；原 `ea3508e4` 只改变四个采用工具。准入 `f90210dec25031b9a144cb2667fd3d9039a0d7efd8e80d50cb4fbf8f6874b38e`。原数据库/锁/事务等七函数 AST 和两迁移保持，旧 PG 隔离证明绑定静态代码差异，不宣称新演练。
- 当前 exec session `55854`：普通用户原 PrepareApp 后顺序原 Worker plan；输出 `D:/codex-artifacts/jackyun-migration-adoption-20261013/direct-publication-final/`。不要同时重建。读取该目录 django-result / worker-plan / preparation-result 后运行该目录 `seal.mjs`（仅封包），再按当前用户已授权执行原 release-batch。
- 正式 n8n `http://localhost:5678` 的现有 Chrome 会话可用；工具 tab ID `1879263037`，当前在吉客云原 ID，Actions 菜单已只读查看，未导入/保存/发布。`127.0.0.1` 是另一未登录 cookie 来源，不需用户凭据。恢复 CUA 先 rewriteDocumentation，再取得该 tab。
- n8n 提案与两个文件在 `direct-publication`，保留原已有 webhookId，为新 Wait 节点固定 ID；当前两发布前驱仍 `0821abae…` / `b3f1527f…`，调度/时区原样、无在途。正式更新须在新 helper/后端就绪后经原界面导入原 ID 并发布；观察器只读核验实际 activeVersion/history 图，不是保存草稿即通过。
- 待生成 batch 仍调用原轮换锁/WAL、维护/停稳、Plan/apply/Deploy/ACL/Install/Finalize/Exit/普通 Start。不执行 Backup、RestoreRehearsal、保护点轮换、真实业务补跑或手工外发。

## 当前在途正式批次（23:28 检查点，必须复用）

- 最终候选已完成：Worker `20261013T145450Z-fe391dce49a258cf`，manifest `51aefd56a68ae84df34e606db2c508092511b1ae24d118fd50cca33333016c6d`，plan `f8a48e36c452044e6676d63a8c48caa2be5c751ad9cc6453bd5b0388a08042b0`；helper 仍是 `16acb5a0…`。Django prepare `dceea1ea35c541a586c3163afac08047` / receipt `85eccac64a47ef6956389b49ea951d1cb86829d483bfea70bb4d5e0728a5e21f` / manifest `4fb134f17cd22018045b87a2852ea874d5d9f3e3c36900a3e8750dc0e572e321`。
- `direct-publication-final/approved-batch.json` 已封存 19 原操作，batch ID `jackyun-direct-d3c0172c6400`，SHA `639f410937aae7aa05d6a2418bf4050f6ee21a7a91ca03df806860916efa6d7f`；maintenance `cde028eac067f6d17536710c21e5940f`，audit operation `59c901fae2b94400b197578e7bac7638`。严禁新建第二批、重建候选、修改封包或接管 active。
- 用户批准原文与实际人类消息 UUIDv7 时间在 authorization-source.json：明确无备份/演练为 14:24:16.721Z；最后“代码检查后直接发布” 14:28:20.232Z。原 CLI 使用这个实际 approvedAt，未再问批准。
- 第一个外部 execute.mjs 在 spawn 前因自填 1 小时超过原 runProcess 时限而失败；没有原 WAL/生产动作，failure 保留。随后直接原 CLI 启动，exec session `65905`；`execution-direct.log` 和 `execution-direct-exit.json` 保存原退出。现在原 fixed WAL 已 active，首次 admission 完成，最后阶段 prepare/started（复用精确 plan），维护尚未创建。不要重跑调用器或删除 active。
- 原 WAL 路径 `D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/jackyun-direct-d3c0172c6400`。观察最新事件和实际状态；未知须按原精确效果回查/协调，不能盲目重放。所有生产操作仍归本批原引擎，普通用户/固定 PS5 modules/PS7 路径；三个 PS1 的 UTF8 BOM已静态核验。
- 接下来当 StartWorker 和迁移通过、batch 等待 check-n8n-publication 时，在已登录 localhost:5678 Chrome 原 tab 1879263037，经 Actions → Import from file 导入 direct-publication 下 J8kY2mQ5vR7sT4pN.workflow.json，保持原 ID/名字，Save/Publish；再对 TeruisiHourlyRetry2026 同样发布。不点击 Execute。同目录 n8n-proposal.json 的 Wait webhookId 已固定，调度/时区不改；原只读观察器会核实际已发布历史全图，不以草稿或 UI按钮状态冒充。
- 自然看门狗只观察两轮，既有 task/bundle/通知政策不变。正式业务未补跑；候选和源码成功不代表真实五表恢复。完成后更新生产报告、交接和共享项目记忆，按规范仅提交本任务文档/必要修复，远端再次回读。主目录 Git HEAD/其他改动继续保护。

## 当前正式采用中（2026-10-14 00:23，优先本段）

- 原 in-process 可选长持有输入缓存监听失败，停止在维护前。两次完整 workerPreparationIdentity 与封存身份一致；input-diagnosis.json 实录 npm 目录 change、旧 mtime/ctime 和新 atime（记录上限 500，不声称覆盖每个事件），原错误保留。
- 没有改源码、封包、批准 SHA、制品、身份或断言。改用原公开 executeBatch + 原标准 collectBatchAdmission **默认逐次完整 initial/final 读取路径**（不传可选 session）续接同批；同 transport、原 collector 代码/argv/file SHA 校验。外部调用器 `direct-publication-final/resume-with-fresh-observation.mjs`，exec session **78490** 在途。第一个调用器路径分隔符字面断言失败发生在调用引擎前并保留；corrected.log 是当前 stdout，不要重跑源码准备/已通过操作。
- maintenance `cde028eac067f6d17536710c21e5940f` 于 00:02:39 正式创建，KeepPostgres=true；EnterMaintenance、StopWorker、audit-plan、apply-exact-worker、DeployApp 已 passed。Worker 当前 fe391dce，Django 当前 4fb134f1；剩余 HardenAcl、Install/Finalize、Exit/Start 和验收。查看原固定 WAL 最新事件，不据本段推定后续成功。
- Chrome 文件 chooser API 超时并重置；两次恢复请求头策略失败。未发生浏览器导入或保存。之后使用**安装版本官方 CLI import:workflow/publish:workflow**，原 TERUISI-n8n-Service 普通任务 Stop/Start，未改 task/action/schedule/权限。n8n CLI exec **49873** 已完成，结果 published_and_original_service_restarted / healthz200。
- 两原 ID 已严格匹配全部 nodes/connections/settings：J8kY2mQ5vR7sT4pN activeVersion **80ea7e87-679f-42b6-a9ab-c990c92ecf5d**，图 SHA a9f37ecb…；TeruisiHourlyRetry2026 activeVersion **6c6482e0-2937-4117-9fbc-e31a716354e7**，图 SHA 9151a99f…。其他 20 流程定义、调度/时区、空 pinData 保持；旧 history 保留。逐条回执 n8n-published-*.json 及总结果 n8n-cli-publication-result.json。
- 00:10 的原自然执行 **8841** 在维护中等待领取，已读原 flatted runData 证明仅 cron/anchor/claim/if/wait 五节点，未进入 A—E。scheduled-wait-8841.json。此执行及旧 pinned history 保留，没有手工停止/取消/重跑。n8n 重启会正常恢复其等待；业务不算本任务手工补跑。后续只读更新其实际状态，不宣称成功。
- check-n8n-publication 原验收仍要求两流程无 running/waiting/new；可能需等 8841 自然终态。不能删除此断言、篡改执行或把已发布当无在途。后续若观察失败保留原失败，只按实际结果观察协调，不重装已采用组件。
- 本次没有 Backup/RestoreRehearsal/新发布演练/真实人工补跑/手工外发。正式维护已在途，必须持续推进到恢复正常与收尾；不要停在“准备完成”或另开维护。

## 最新用户范围与上线事实（2026-10-14，优先本段）

- 用户最新明确“无需验收收尾，直接发布上线”，覆盖上文继续验收收尾的计划。Worker fe391dce、Django 4fb134f1、两项审计迁移及两条原 n8n 流程均已正式采用；完整 Start 与 VerifyStartup passed，维护已退出。详见 [PRODUCTION.md](PRODUCTION.md)。
- 资源原失败保留，经全部 76 个公开资源、两个部署控制文件及缓存规则独立核对后，原 reconcile API 记录资源目标 passed。不要声称旧脚本全部通过，也不要修改原封包或失败证据。
- exec 4040 / Node 2556 的后续只读验收于 01:18:39 按指令停止，未启停正式服务。停止时 VerifyStartup 已 passed；AggregateStatus 与自然看门狗两帧没有执行。无本任务在途进程，不要重跑验收、重装或真实补跑。
- 原固定 WAL 尚无 completed，release-batches/active.json 保留；它不是业务 active，也不是仍在维护。今后发布必须明确处理本次取消的剩余收尾范围，不允许删除标识、伪造 passed 或直接重放已安装动作。此次没有新增绕过原协调器的代码。
- 自然旧版本执行 8841 失败于 A 的旧登录/身份障碍，未到 B/C/D/E。生产上线不等于五表业务恢复；需处理障碍后走新完整重试入口，不需额外人工闭合旧任务。未获人工真实补跑授权。
- 主目录 HEAD 与无关改动、59 份旧测试日志、未提交 rehearse-publication.mjs 均保留。仅提交本任务上线记录/交接；新 main 的无关改动不换绑已采用候选。条件检查 automation opencode 保持 PAUSED。
