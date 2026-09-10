# 志高助手：钉钉只读问数

2026-09-10 已按用户“合并后一起发布并清理分支”的授权在本机生产采用：应用迁移 AI 0007、安装可选依赖、启用受保护配置及 Stream 监听。用户在本人单聊和测试群 @ 验收请求后确认“已经收到私聊回复”。此确认不等于销售、库存、网店三类真实模型分析均已验收。

## 使用范围

- 使用现有“志高助手”企业内部应用机器人，Stream 接收消息，复用系统现有模型、中央只读工具、用户权限及 AI 审计。
- 首批只支持销售、库存和网店；单聊直接提问，“测试群聊”内需 @ 机器人。仅显式绑定的钉钉用户可以触发。
- 首版结果和“正在查询”回执均私聊给提问者。群内 @ 只是提问入口，不把个人账号权限扩大为全群数据披露权限。没有群内经营结果广播。
- 单聊、群聊、群内各用户各自保留上下文；发送“新话题”清空后续上下文，历史仍用于审计。网页可以查看本人对应 AI 会话，但不能向钉钉会话追加消息或删除其投递审计。
- 首批只处理文本，不接图片/语音/文件。较长答案明确截断；图片、外链和 @ 指令不会外发。不自动读取个人记忆、知识库或其他网页会话。

示例：“帮我看一下志高昨天的销售”“广东仓有哪些缺货风险”“京东某店昨天的商品表现”。网店仍须使用实际平台、店铺和 SKU/SPU 口径；访客数不是店铺去重 UV。

## 数据与身份

销售品牌由 ERP **当前**主数据的品牌字段精确筛选，以货品编码关联已发布销售事实，保留退款负数和原数据范围。空品牌或未映射货品不计入品牌结果；不是历史成交时品牌归属，也不是名称关键词匹配。API 响应披露品牌来源和排除规则，缓存继续采用销售/ERP 组合 revision。

每个正常分析请求先执行数据水位查询，成功后才调用模型；水位检查消耗既有查询预算。相对日期按钉钉消息创建时间和 Asia/Shanghai 解释，队列跨日不改变“昨天”的基准。销售、库存水位不冒充网店完整覆盖，网店仍检查自己的查询结果。

配置中的 senderId 是钉钉企业内部 staffId；与系统账号、角色和 scope 快照显式绑定，不能依据昵称、模型输出或消息正文推断身份。所有接收、执行及发送阶段重新核验权限；配置变化使旧请求失效。范围受限账号仍可能没有库存总览等工具，禁止借用管理员绕过。

可复用经本机原门禁验证的 local-admin 绑定，但仅限明确绑定的本人；禁用本机直连身份后机器人同步失效。首批不自动绑定新成员。

## 接收与投递

入口是 Django 管理命令 `dingtalk_ask`，使用现有 AI writer 权限及 authority。没有新增公共回调接口、数据库业务写权限、D1 路径或新的模型执行器。Stream 主动出站连接，不需要开放入站公网端口。

新增 `dingtalk_chat` 工具 surface，在唯一中央注册表逐项开放七个工具：数据水位、销售汇总、销售品类/品牌分析、库存健康、库存子页、网店表现、网店子页。其他工具（通用数据集、个人记忆、知识库、财务、客服、写入、脚本、浏览器）不获得此 surface。网页请求体不能自行选择该内部入口。

新增 `ai_dingtalk_sessions` 和 `ai_dingtalk_receipts` 两张 AI 表，由迁移 `0007_dingtalk_readonly` 创建，AI 总表数从 46 增至 48。表有 authority fencing、不可变身份和状态/大小约束，读写授权和备份清单同步更新。两表不进入通用系统数据集或历史 D1 迁移摘要。

消息按企业、机器人、平台 msgId 防重；同一 ID 不同内容拒绝。待处理上限 24 条、单用户每分钟最多 6 条，原 AI 日额度、调用次数和总时长上限继续生效。

接收回调只做身份检查与持久入队，模型在独立工作线程运行。单实例 PostgreSQL advisory lock 持有到所有线程结束。发送前先持久化 sending；回执不明不重发。重启后 running/sending 变为 unknown，关联未完成 AI 回执也置为 unknown，不重复付费分析；已完成 ready 结果可继续受控发送。unknown 状态需操作员检查，用户可另发新问题。这里采用“至多一次发送尝试”，不承诺分布式网络上的恰好一次送达。

DWS 管理平台授权和机器人发送；应用凭据仅在内存中取得。每次核验机器人前调用当前用户只读接口，使 DWS 可以用既有 refresh grant 自动续期；refresh grant 本身失效时仍失败关闭，不扩大授权。发送必须收到 `success=true`、有效 `processQueryKey` 且无无效/限流接收者才记为平台接受；这不是用户已读证明。消息中的 sessionWebhook、access token、Stream ticket 和原始外部回执不写入业务表或日志。Stream 建联失败最多连续五次后退出，保留脱敏错误码，不无限重试认证。

## 配置与本机发布

模板是 `config/dingtalk-ask.example.json`。复制到受保护 runtime 的 `config/dingtalk-ask.json` 后，填入通过 DWS 查询得到的精确组织/profile、统一应用 ID、robotCode、群 ID 和本人账号绑定；不要把 AppKey/AppSecret/token 放进该 JSON。初始 `enabled=false`。

受控发布需要：

1. 完成隔离候选检查，核验最新 main 和变更范围，按项目合并流程处理；用户明确授权生产发布。
2. 制作并独立恢复验证正式 PostgreSQL 备份；受控停止相关本机服务并 DeployApp，在受控 runtime 安装 `backend/requirements-dingtalk.txt` 中的可选依赖。
3. 应用 AI 0007，执行 AI ProvisionRoles，重新核验 AI reader/writer readiness 和全部域状态。按现有 Worker successor 流程发布包含新工具 surface、品牌筛选适配的版本并重绑启动入口。销售 Django 读取代码也需采用。
4. 在 runtime 受保护配置目录放入精确配置，并使用既有 ACL 工具保护文件。先保持 disabled 执行只读核验，再启用配置并显式启动接收器。
5. 用本人单聊和测试群 @ 各发一条真实问题，确认原消息、AI 工具审计、回复及投递回执一致；这一步是上线验收，隔离夹具不能替代。
6. 发布后再次备份并独立恢复验证。

命令必须从已采用的受保护 runtime app 控制器执行：

```powershell
& "D:\teruisi-runtime\django-sales\app\tools\django-ai.ps1" -Action DingTalkCheck
& "D:\teruisi-runtime\django-sales\app\tools\django-ai.ps1" -Action StartDingTalk
& "D:\teruisi-runtime\django-sales\app\tools\django-ai.ps1" -Action StopDingTalk
```

StartDingTalk 使用现有 DPAPI AI writer 凭据与精确进程回执，后台启动接收器；不调用 Codex、DWS 的任意 agent 命令或个人账号自动回复。日志出现 `connected` 才代表已建立 Stream 连接，进程启动本身不代表端到端可用。停止 AI 栈会先停止接收器。

首版不自动加入登录启动或外层 supervisor 的常驻监控；机器重启或接收器连续建联失败退出后，需要显式 StartDingTalk。当前用户 DWS refresh 授权也需要保持有效。

回退优先关闭问数配置并 StopDingTalk，网页 AI 与销售事实不受影响。保留两张新表、迁移、权限和投递审计；使用兼容修复或 PostgreSQL 前向恢复，禁止删除表后恢复旧 D1。恢复旧 45/46 表备份时，先在隔离环境按迁移版本验证，再前向补齐迁移；备份校验不能按最新表数错误拒绝合法旧备份。

## 验证入口与限制

- `python backend/manage.py test ai_assistant system_datasets sales.tests.test_api --noinput`
- `python tools/dingtalk-postgres-rehearsal.py`：独立 55457 端口，合成数据，验证 0006→0007、旧会话保留、真实最小权限角色、AI readiness、错误 epoch/身份/状态拒绝和 48 表 dump/restore 一致；结束停止独立 cluster。
- `npm run build`、`npm run test:unit`、`npm run lint`、`npm run check:backend-boundary`。

库存 GuangdongMonitorItem 的六个已有 override 字段原先漏记于通用清单，本次明确列为 excludedFields，保持不对通用数据集开放并补齐覆盖检查。部分原数据集测试使用简化 authority 夹具，缺少正式 PostgreSQL 要求的字段；这些测试在 SQLite 通过，PostgreSQL 本次采用相关聊天/问数/品牌测试和真实角色门禁，未放宽生产约束。

初始候选验证见 [候选验证记录](evidence/dingtalk-readonly-candidate-20260909.json)。统一候选进一步通过 Django 145 项（144 通过、1 跳过）、Node 2073 项（2053 通过、20 跳过）、构建及 20 项构建产物测试，lint 无错误（9 条已有警告）；最后的 DWS 续期/回执修复通过 50 项针对性测试（49 通过、1 跳过），新增京东修复及 AI 控制器测试全部通过。最终部署与备份恢复摘要见 [统一发布记录](evidence/unified-release-20260910.json)。

官方参考：[应用机器人](https://open-dingtalk.github.io/developerpedia/docs/learn/bot/overview/)、[Stream 模式](https://open-dingtalk.github.io/developerpedia/docs/learn/stream/overview/)、[Python SDK](https://github.com/open-dingtalk/dingtalk-stream-sdk-python)。
