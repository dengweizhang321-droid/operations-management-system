# PiAgent 一期独立关键审查

状态：**独立源码审查通过，当前候选可进入合并交付；没有遗留的本任务功能、权限或有限迁移材料缺陷**。固定 BAT 本机 control 入口的必要同步另见文末，须随交付完成。2026-10-17，工作树 `codex/piagent-phase1`，起点 `cdf1c5eb`。此结论不是已上线或正式 Runner 已启用的证明。请求角色为 Sol XHigh 的局部 `deep-review`；工具没有单独返回底层实际型号证明。审查者未参与被审实现，不修改被审源码、不转派、不操作生产。

已完整读取共享 vault 启动入口、相关偏好/工作流/AI 项目记忆，项目 AGENTS、README、开发与交付、任务模型分工、系统架构、前端与性能、安全与 AI 工具、数据存储与迁移及验证与发布。已核对本任务 tracked diff、相关 untracked 源码及直接依赖，覆盖 Pi Django、Runner、容器、Skills、前端、中央工具、有限迁移与实际发布消费者；对修复增量逐项复核。后续若改变相关执行字节，仅复审实际受影响范围。

## 已报告并跟进的实际问题

| 编号 | 优先级 | 原问题与复现路径 | 当前核对状态 |
| --- | --- | --- | --- |
| R1 | P1 | 新 Session 为 `creating`；首次选择空技能、单技能或新版时，`create()` 调用只允许 idle 的 `update_skills()`，必拒绝。原真实 Pi 测试仅创建全部三个旧版技能。 | 已修；真实空选/单选/新版创建通过。 |
| R2 | P1 | Runner 先发 `agent_settled`，后在线程中采集文件；Django 原 `complete()` 对 `settling` 也标 succeeded，清 active，丢掉未采完文件。 | 已要求终态、`filesCollected`、绑定 operation/status/eventSeq/SHA 的 receipt、完整事件消费及 `hasMore=false`。独立拒绝探针及最终真实文件整链通过。 |
| R3 | P1 | Runner 网关队列固定等待 120 秒；外部模型允许更长配置，已发付费 POST 会被本地提前撤销，随后变 unknown。Django 原 15 秒 Runner transport 又短于合法冷启动预算。 | 已改配置的持久 operation deadline、短 capability 续期和控制命令分预算；直接 deadline/取消/冷启反例及真实整链通过。未把短合成测试称作百万秒实跑。 |
| R4 | P1 | 模型能改同 UID 工作区 `skill-selection.json`；idle restart 读取该文件，原核验只比技能名，可能实际运行 1.1.0、对外却证明 1.0.0。 | 已修；可信 stdin 初始化并核实际发现版本路径，真实篡改重启负例通过。 |
| R5 | P2 | 单店 B 操作能用同账号其他会话单店 A 的 exportId 读取 A 的 manifest/query/行数；原状态 consumer 只核 owner、principal scope 和源会话 generation，没有绑定当前操作。 | 已在 gateway 增加 exact operation 归属检查，实际反例拒绝；文件字节入口亦核 operation。 |
| R6 | P1 | `pi_agent_candidate.py` 的真实 CLI 残留 inventory-0017 recipe 白名单和 evidence 路径，固定 main 准备传 ai-0084 时必失败；Node 的 `run` 替身掩盖此处。 | 已改 Pi 精确路径，实际 CLI 进程测试通过；审查者实际调用最终 readSchemaRecipe，149→150 与摘要校验通过。 |
| R7 | P1 | 新生命周期同一 `keySha256` 在 PS 被解释为 DPAPI 文件 SHA，在 Python 被解释为解密 channel key SHA，无法同时满足。 | 已拆两个摘要；真实 DPAPI、PS5/7 实际 Read-PiConfig→已签名私有 Runner probe 通过。 |
| R8 | P1 | Broker 重启仅把账本变 unknown，却丢弃容器引用；原 state/dispose 都返回 session_unavailable，旧容器不计 maxSessions、也不再受 monitor 约束。 | 已重建引用和 full ID/标签/卷绑定，精确停止旧容器、保 unknown/卷与容量限制；真实后台 bash 增长→重启精确停止→state/dispose→同代旧卷拒重放通过。 |
| R9 | P1 | 异步导出 schema 要求模型提供 Django sessionId，而容器首轮上下文没有可发现的该 UUID；Runner 在容器外补 identity，Pi 自身 session-id 仅为 conversation。模型无法构造合法导出调用。 | 已从模型 schema 移除身份字段，可信 handler 注入 operationId；真实 Pi 整链首轮导出不暗传身份，已通过。 |
| R10 | P1 | 用户网页 Stop 只设置 cancel_requested；worker 主线程同步阻塞在 bridge→model POST，原取消回调仅看生命周期停止事件，长模型期间无法及时处理用户 Stop。 | `_model` 已增加 DB cancel/status 探针并接既有 socket cancellation；冷启取消原子禁止首次 prompt，已知未派发安全 canceled，付费未知保围栏。 |
| R11 | P1 | 同环境下一轮允许切换供应商协议，但原 thinking providerFrame 不带可核对的协议/模型版本归属，旧 Anthropic 帧会原样送入 OpenAI，反向亦然。 | 已按 protocol/modelConfigId/modelVersion 匹配才复用；独立实际调用验证同供应商保留，换协议/版本不带旧签名且普通文本保留。 |
| R12 | P1 | 新增 deadline 的 `claim()` 在未处理异常的队列领取路径解析当前模型；排队期间模型被停用/删除会抛错、回滚回 queued 并使 worker 主循环退出，重启再次命中同一毒项，堵住所有后续 Pi 会话。极大 timeout 的 datetime 加法也可同样抛错。 | 已修；停用模型后继续领下一项、极大合法 deadline 不溢出直接反例均通过。 |
| R13 | P1 | 固定 main 发布消费者在 schema Install 后仅对 Tmall 调用库存 ProvisionRoles；Pi 的新表没有迁移内 grant，Finalize 却核验 reader/writer ACL，因而 BAT 会停在 Finalize。PG rehearsal 中另行 provision 不能证明该真实消费链。 | 已接现有 AI ProvisionRoles，publisher 进入有限源码闭包；顺序/未知失败不重放测试及最终 proof/code SHA 一致性均通过。 |
| R14 | P2 | 通用文件被固定 MIME 清单限制，`.js/.svg/.xls/.tar` 等合法输出及 outputs 子目录文件会在保存阶段使整轮 unknown。 | 已修；合法未知 MIME 被动 octet-stream，来源相对路径与摘要前缀文件名分离，直接反例通过。 |
| R15 | P1 | 原完整 Runner snapshot 被 Django dispatch cache 和 Runner SQLite command cache 原样持久化，可包含 pending gateway 的明文 capability 和 Pi 原始 thinking。 | Django AES 缓存与 Runner 安全回执均修复；新旧 SQLite/WAL 物理扫描及真实 Pi 思考/能力标记扫描通过，公开文本/序号保留，原生 Pi 私有历史不当作审计。 |
| R16 | P1 | `wsl_control.stop` 拒绝所有 unresolvedCount，即使重启 unknown 已核验精确容器停止；保留 unknown 的正常冻结策略反而阻断 Stop-AiStack 与后续受控发布，不能靠清账本或重放 dispose 绕过。 | 已修；实时 full ID/名称/标签/镜像/卷/Running 检查，unknown=1 且确停时允许 Stop，再人为启动该容器即拒绝，账本仍 unknown；真实与独立负例通过。 |
| R17 | P2 | 权限冻结时旧 scope/shop 草稿仍保留且输入框已禁用，新建环境却继续携带这些越界参数，反复 403，用户无法在当前页创建干净环境。 | 已清旧参数，冻结时新建直接省略旧 scope/shop；实际 Chrome 组件恢复断言通过。 |
| R18 | P2 | 恢复不可用旧模型后，刷新 catalog 原会静默选中默认模型，绕过明确重新选择的交互。 | 已在恢复后仅清失效值、不自动换默认；实际浏览器恢复 retired-model 后刷新仍不可发送，要求显式选择。 |

## 审查者独立探针

- `.codex-tmp/review-probe.log`：使用独立临时 SQLite、实际 selection/consumer，两环境同 owner 分别固定 shop A/B，重现 B 读取 A 的合成 manifest。该轮另一个 settling 用例因夹具仓库 scope 与单店范围不相容而提前拒绝，因此整轮 exit 1；不把它算作实现失败，也不冒称整轮通过。
- `.codex-tmp/review-terminal-gates.log`：在无业务数据库连接的临时开发配置中实际调用新 `complete()`，`settling`、缺 receipt 的 `settled`、`hasMore=true` 的终态均返回 False；exit 0。
- `.codex-tmp/review-protocol-frames.log`：实际调用当前 `transcript()`，同协议/模型/version 保留 frame，跨协议或模型 version 变化则保留普通历史并移除旧签名；exit 0。
- `.codex-tmp/review-protocol-tests.log`：审查者运行真实协议/账本/Skills manifest 单测及 Windows CurrentUser DPAPI 测试，9/9 通过。DPAPI 测试只替换传输边界，没有连接真实 WSL 服务，不把它当作 PS/WSL 生命周期已采用证明。
- `.codex-tmp/review-final-audit-stop-tests.log`：仅针对新增 R15/R16 运行三个单测，3/3 通过；核对新命令缓存、旧缓存清理后 SQLite/WAL 物理字节不含合成 capability/thinking 标记，公开文本保留，以及 unknown 停止门禁的负例。
- 最终执行 `git diff --check` 通过；实际调用 `readSchemaRecipe()` 成功，独立计算并核对下列最终绑定。

以上只证明对应局部边界。未连接主代理 55531 的隔离 PostgreSQL，也未连接生产、启动/停止生产服务、真实供应商调用或外部发送。

## 最终证据与绑定

- [Runner 验证](runner-validation.md)：固定 Pi 1.3.0 / rootless 镜像真实执行，完整 21 项加受影响增量的 2、15、1 项定向验证；不把分次复用冒称整套重新执行。覆盖跨轮/重启历史、空/单选/升级技能、22 轮/42 工具、真实三个技能脚本、未知精确停止及可安全停服务、缓存物理扫描。
- [后端验证](backend-validation.md)、[最终直接回归日志](django-final-tests.log)：最终直接相关与旧路径回归 94/94。原 Chat/Agent/DAG/pandas 限制及执行入口没有被 Pi 替换。
- [真实 PostgreSQL 整链](postgres-real-stack.json)及[原始日志](postgres-real-stack.log)：三轮真实 Django 队列/PG 锁约束→HMAC Runner→真实 Pi→异步导出/文件桥→真实 excel-report 脚本→四表 XLSX，1/1、23.120 秒、进程 exit 0、测试库销毁成功。模型和中央 edge 仅在 HTTP 边界使用合成响应，未调用真实供应商或正式业务读取。
- [结构证明](schema-validation.json)：独立 PostgreSQL 的精确 149→150、权限、旧数据/队列、回滚和 unknown 负例通过；最终 runtime 29 项通过。无全库备份/恢复。审查者实算 installer/backend 闭包 SHA=`8e887aa0cc8c99162b2376cf451bbbd5643446d7b864a5e000fc9d13e17acaed`，与 proof/[recipe](../../config/main-schema-releases/ai-0084.json)一致；迁移集合摘要一致，validation SHA 一致。实际 Node recipe reader 返回 recipe SHA=`8aa2515bb9051c3508b239841a06761143226c89227b18ff6c86cfee8666631b`。
- [发布消费者日志](release-validation.log)：52/52，包括 Pi Install→AI ProvisionRoles→Finalize 顺序与不确定结果保留。当前完成的是候选验证及材料准入，不是执行正式发布。
- [原生签名探针](native-signed-probe.json)：真实 PS5/7 Read-PiConfig、CurrentUser DPAPI、已签名私有 Runner 状态通过；[首次准备证明](prepare-validation.json)覆盖实际 Linux installer、真实 Docker inspect、独立 DPAPI、create-only、重复/wrong runtime/source/image 拒绝。systemd hook 是受控夹具，正式 unit 未安装或启停。
- [浏览器日志](browser-validation.log)及[前端验证](frontend-validation.md)：实际 React/Chrome 恢复、丢响应仅 GET、停止回执、范围/代次/附件隔离、冻结后新建、不可用旧模型恢复后刷新不换默认均通过；[后端边界](boundary-validation.json)无违规。

最终 Runner source SHA=`90812210898b7b69269a977a02828a6943adc15651e6ae0c07c664f89fe92407`，镜像=`sha256:c393a84818c0c7f941803da2db11b1cd94395b8188b69af7294490468a48e26d`。审查者独立实算 source SHA 与 Runner、原生探针、准备证明及 PG 整链证据一致。

首次准备入口源码亦已核对：`PreparePi` 经已部署/受保护 app、AI 端口和 owned reader/writer 停止门禁、真实现有 authority 及服务 mutex；helper 绑定固定 runtime、显式 execute、源码/镜像/技能，独立 32-byte channel key 由 CurrentUser DPAPI 保存且仅经 WSL stdin 传递，fresh root/unit/intent 拒覆盖，先安装和 daemon-reload 再发布配置及回执，不 Start/enable。helper、AI controller 与实际发布消费者已进入交付闭包。

## 结论的边界

本结论支持当前候选合并和对应制品准备，不是生产已采用声明。正式 Pi 仍默认未配置/未启用；生产结构迁移、首次 PreparePi、正式 unit 启停与应用发布均未由本任务执行，继续由用户按已交付原生入口操作。真实供应商未调用，合成整链不能证明实际模型分析质量、费用或生产数据新鲜度。

总工作区磁盘/文件数为软扫描，CPU/内存/PID/tmpfs 为硬边界。Skills 选择控制活动发现/命令集，可信镜像中其他预置只读源码仍可读，不宣称按勾选隐藏文件，更不据此扩张中央权限。网页终端、公开联网、业务写入及多 Pi DAG 不在一期。既有失败、连接清理失败及其定位记录保留，不以后续成功追认原失败。

## 固定 BAT 本机 control 入口采用

交付收尾补核到实际入口 `D:/codex-isolated/main-manual-release-20261016/发布main.bat`：它加载同目录 `control/tools/publish-latest-main.mjs`，在进入冻结来源的 publisher 之前，先静态调用 control 自身的 `main-schema-release.mjs`。旧 `CONTROL-TOOLS.json` 绑定 `cdf1c5eb`，其有限列表不含 Pi。只推送业务 main 不更新这个 caller，会在准备新 0084 时被旧有限列表拒绝。用户主工作区 `D:/运营管理系统` 没有这些入口文件，不能以更新主工作区或整体 checkout 处理。

已审现有 `tools/install-main-prebuild.mjs`，适合本次必要同步：从已提交冻结候选，使用固定 BAT 相同的 Node 和精确 config 路径，更新六个 control helpers、原受管 preparation-only hook、原受限环境及准备/观察入口；不部署应用、不迁移、不启停服务。它不是全仓更新或新发布系统。采用前先核对并保全旧六文件、CONTROL/config/hook/BAT、确认没有在途准备/发布；尤其该 installer 写 helper 后才校验旧 hook 标记，必须先在外层证明 hook 为原受管内容。采用后回读六文件 SHA 和 CONTROL，核对仅 main-schema 的有限列表变化、其他五文件及 config/环境保持预期，保留原历史 nativeToolsSource 和原 unknown/成功批次。

该同步属于用户已要求的合并与发布入口交付范围，无需据此取得生产切换权限；本报告不把尚未回读的本机同步当成已执行。交付负责人应将实际采用与回读证据随任务报告保全，之后再由原 hook 准备最终 main，生产仍由用户点击 BAT。
