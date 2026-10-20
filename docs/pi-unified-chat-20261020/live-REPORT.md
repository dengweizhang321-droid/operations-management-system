# 真实模型与本人单聊投递验收

2026-10-20启动，跨至2026-10-21继续执行。当前任务明确授权真实模型、合成正文与PDF/XLSX附件实际投递，且禁止合并main、生产发布及服务启停。只使用当前账号唯一已绑定的钉钉单聊，不发群，不查询或外发经营/客户原始数据。

## 正式入口观察

通过正式 `localhost:3000` 的当前真实principal，新建标记 `LIVE-ACCEPTANCE-20261020` 的独立会话。未修改、解冻或重试用户原unknown会话。

- 首轮纯文本：OpenCode Go配置v4，实际登记模型 `deepseek-v4.1-flash`，`succeeded`，真实`agent_settled`和中文正文已返回。
- 第二轮合成文件任务：模型HTTP已完成，第一次本地`read`准入后`pi_gateway_unknown`，原会话保留unknown，不重新派发。
- 第二轮命令管道把中文提示词转成问号；英文文件名与本地工具目标仍可见，但该轮不用于评价模型中文理解/选参质量。后续私有验收提示词使用UTF-8源文件中的ASCII正文，避免沿用该编码问题。
- 正式installed `_local()` 仍在事务外调用`pi_native.authorize(..., lock=True)`；候选已有`docs/pi-gateway-admission-fix-20261020/REPORT.md`对应短authority事务修复。这里是同一路径的新鲜实测，不声称取得历史异常栈。
- 正式Django原生deployment绑定来源`20eea975b7e2`，appFingerprint为`b0a16a6ad5c055d601c362471e4075ade1a9ecbbf96f8570a125ce11521b2397`，deployedAt为`2026-10-20T18:07:02.7983079+08:00`；本次候选与该已部署字节不同。
- 正式这两轮已知usage：input 16981，output 598，reasoning 334；没有配置人民币费用，费用保持null，不声称免费。

脱敏证据：[formal-new-session.json](live-evidence/formal-new-session.json)。该文件记录新会话公开事件、usage及installed/candidate源码SHA；不保存私有thinking、供应商frame或capability。

## 候选隔离验收边界

复用既有真实验收脚本的私有PostgreSQL55541、独立Runner18123、随机`pi-test-live-*`命名空间和当前已部署精确镜像。数据库从当前migration创建，不复制正式数据库。正式模型及机器人凭据仅通过现行CurrentUser DPAPI接口在进程内读取；密钥不写入代码、证据或测试数据库。每次机器人配置检查重新读取正式有效策略及账号绑定；正式连接只执行强制只读事务。

中央工具schema取自当前候选真实注册表，仅开放本次三个报告业务工具；业务准备、确认、领取、正文与附件发送使用实际产品实现。私有principal背景准入通过当前正式`/api/auth/me`动态核验；此处是显式测试接缝，不能冒称正式Worker到私有数据库的完整HTTP路由验证。

钉钉effective policyVersion为5，机器人“志高助手”，当前账号恰有一条匹配角色/scope的direct binding。原始组织/员工身份、密钥和token不写证据。平台受理回执只保留产品原生哈希，不冒称终端送达或已读。

候选结果在[results.json](live-evidence/results.json)，完整原日志和合成文件保全于[D:/codex-artifacts/pi-unified-chat-20261020/live](D:/codex-artifacts/pi-unified-chat-20261020/live)。实际完成状态以这些原生结果为准。

首个私有attempt完成真实模型生成（8次供应商调用）和XLSX具体业务预览，但验收脚本误按`preview.recipient`读取实际`preview.details.recipient`，在调用确认之前停止，没有正文/附件派发。该夹具错误已修正，原日志及结果保存在`live-evidence/attempt-1-preconfirm-fixture-error/`。后续新隔离attempt复用这些已校验的模型生成字节，经原上传、真实模型本地工具复制及收集后成为当前环境产物，再执行新预览/确认；不重放旧unknown，不把首次失败覆盖为成功。

可复用脚本`tests/pi-live-acceptance-run.py`为显式opt-in，后续只有当前用户重新授权同类实际调用与本人单聊发送时，才可传`--authorized-live-acceptance`运行；`--reuse-generated`只复用本任务已验证的合成文件。普通检查不应执行该脚本。

## 技能目录缺陷修复

`pi_service.skills()`当前1.3.0审核manifest含`native-planning`，原prompt的七项硬编码目录却拒绝它。删除第二份名单，按同一authority事务内当前审核manifest校验完整选择；缺失或未审核名称直接拒绝，不静默忽略。类型、数量及去重门禁保留。

三项隔离测试通过：1.3.0可选、1.2.0仍拒绝新技能、未知/非字符串输入不创建operation。原日志：[skills-admission.log](D:/codex-artifacts/pi-unified-chat-20261020/live/skills-admission.log)。独立Sol High审查者只读增量核对源码、旧包兼容及幂等快照，未发现本增量阻断。

## 用户要求停止后的实际结论

用户最新明确要求停止新增或重启隔离验证，结束后不再启动，以留出约五分钟的恢复观察稳定窗口。没有继续PDF/XLSX后续用例，没有为验证修复重跑脚本。

- 已完成：正式新会话纯文本模型调用；正式本地工具准入失败的新鲜复现；候选真实模型生成合成XLSX/PDF（8次模型派发）；候选真实模型查询目录并创建XLSX具体预览；第二attempt经真实Pi复制与收集原合成文件成功。
- 取消时第二attempt第1轮复制刚成功，脚本已自动进入第2轮；通过原`service.abort`对当时当前seq2进行树取消，原生终态`canceled`。没有把取消改成通过，没有重放该操作。
- **实际外发尚未验收完成。** 停止受理时没有业务action，正文/附件dispatch账本计数均为0。XLSX及PDF的真实正文/附件平台受理回执均未取得，不能写成发送成功或“仅差已读”。
- 原finally已受控停止私有PG55541和Runner18123。随后只读核验这两个端口关闭，精确`pi-test-live-bebf0e560091` Runner进程、容器、卷均为空；[cleanup.json](live-evidence/cleanup.json)为`cleanupComplete:true`。[user-stop.json](live-evidence/user-stop.json)保留原取消回执与零派发计数。
- 原材料保全30个文件并逐文件复核SHA/字节。仓库只留脱敏结果、明确失败/取消及清理证据；本次磁盘检查未发现原始绑定员工ID、私有供应商frame/thinking字段或明文模型密钥格式，见[privacy-inspection.json](live-evidence/privacy-inspection.json)。该检查只读磁盘，没有连接正式数据库或调用模型。

全部私有运行资源已收尾，暂不再启动。后续实际投递只有用户重新授权继续后才可另行安排，不能把旧授权覆盖本次明确停止指令。

没有修改生产文件、正式结构、模型配置、机器人策略或既有unknown记录；没有执行合main、发布或生产服务启停。源码、候选隔离通过和正式采用分别判断。
