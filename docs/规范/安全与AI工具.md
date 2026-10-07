# 鉴权、敏感数据与AI工具

路径约定：反引号中的代码、配置和工具路径均相对仓库根目录；Markdown 链接相对本文件。

- 吉客云后台 PowerShell 凭据/进程核验使用显式 UTF-8 标准流，禁止依赖控制台编码设置；Node 按流解码多字节字符。凭据状态验收必须包含无控制台子进程和隔离 DPAPI 夹具，不能仅用交互终端的 ready 判断后台可用。原 ACL、CurrentUser、身份绑定及凭据类失败停止规则保持不变；详见 `docs/吉客云DPAPI登录配置.md`。

- 应用角色固定为 `viewer`、`analyst`、`operator`、`admin`。所有权限和数据 scope 均使用服务端 `requireAppPrincipal()` 得到的真实身份；客户端、模型参数和请求正文中的身份/角色声明不可信。
- 读取也要应用 principal scope；写入、配置、导入、发布、回滚、删除等操作按现有角色契约收紧，不能为了修复页面流程绕过鉴权。
- `.dev.vars`、API Key、Token、Webhook、AES Key、浏览器登录状态和原始客户聊天不得提交、打印到日志、写进审计摘要或持久记忆。列表接口只返回掩码。
- AI 模型域名若被代理 DNS 返回为 `198.18.0.0/15` 虚拟地址，只能对已有精确 HTTPS origin 白名单中的域名，通过固定公网 HTTPS DNS 取得并校验真实公网单播 IP 后固定连接；保持原域名 TLS 校验、总超时、响应上限、禁止重定向和模型 POST 不自动重发。不得放行虚拟地址段、私网或关闭证书验证；DNS 查询不得携带模型密钥和对话正文，内部回环工具桥不走该恢复路径。说明见 `docs/AI_ASSISTANT_SETUP.md`。
- 本地免登录管理员仅在 `TERUISI_LOCAL_DIRECT_ACCESS=true`、`TERUISI_RUNTIME_ENV=development` 与真实开发/受控本地构建标记同时满足时可用，并必须在 Worker 入口和身份解析两层把请求限制到精确回环地址；Host 不能作为开发证明，LAN 地址、任意域名和 DNS rebinding 必须失败关闭。所有非 Webhook AI 写请求还必须提供精确同源 `Origin` 或明确的 `Sec-Fetch-Site: same-origin`；生产环境必须保持拒绝匿名直连。
- 外部回调必须验签、解密、校验接收方并防重。聊天平台消息不能绕过后台权限直接修改运营数据。

## 中央 AI 工具注册表

- AI 面向用户的自我介绍、系统称呼和连接测试文案使用中文名称，不添加 TERUISI 英文品牌前缀。保留既有内部标识、协议字段、数据库角色、环境变量及路径；不得以清理显示文案为由改动这些运行契约。

- 钉钉无响应排障必须区分 Stream 建联、callback 接收/拒绝、持久入队、模型处理与外部投递。进程 running、历史 connected 或定时任务 sent 不能替代新聊天验收；使用 `callback_received/accepted/rejected/unavailable` 固定标签及账本状态定位，不输出原始消息、身份 ID、凭据、Webhook 或 ticket，不自动重放旧消息和未知结果。诊断日志上线不等于聊天故障已修复，说明见 `docs/DINGTALK_READONLY_ASK.md`。

- `run_pandas_analysis` 的 Python 代码只能在独立 Linux/rootless 容器执行；Worker 与 Django 仅做权限内数据集导出、签名传输和被动结果验证，不得使用宿主 Python 或 AST/eval 过滤模拟隔离。容器必须无网络、无宿主挂载/业务凭据、固定镜像与资源配额，成功或失败都须核验精确清理；源分页/字段截断、权限变化、未知执行或清理失败均失败关闭。源码接入不代表独立运行环境已部署，采用门禁见 `docs/AI_PANDAS_SANDBOX.md`。

- 钉钉“志高助手”问数使用独立 `dingtalk_chat` surface，在中央注册表逐项开放跨系统领域的只读工具，嵌套数据集查询必须保留此 surface；不得把未来新增工具自动开放给机器人。AI 群设置独立于周报，由 AI 0008 的 `ai_dingtalk_settings` 保存，仅无范围限制的管理员可改；受控接收器首次启动采用 runtime 中已有应用身份和群，后续启动不得覆盖管理员设置。组织/应用/staffId 与系统 principal 仍显式绑定，接收、执行、发送前重查；群名、精确 ID 和机器人入群关系在外发前动态核验。群内 @ 的回执和结果回复原群，私聊回复原提问者；禁止失败后改投私聊或其他群。群、用户和单聊历史隔离，配置版本变化撤销旧请求，不附加个人记忆或知识库，不开放凭据、原始客户聊天或其他用户私有内容。接收/投递账本属于 Django AI 域，使用既有 authority，外发未知结果不重试。新增表进入角色、readiness、备份和恢复清单；旧 45/46/48 表备份按其迁移版本继续验证。此增强须经受控发布后才改变首版生产行为，未经授权不得启动真实监听。销售品牌仍按 ERP 当前品牌精确关联。详见 `docs/DINGTALK_READONLY_ASK.md`。

- 所有供模型调用的系统能力必须且只能在 `lib/ai/tool-registry.ts` 声明一次。不得从数据库表、任意 SQL、API 路由或 handler 自动暴露工具。
- 每个条目必须包含稳定名称、标题、精确描述、`additionalProperties: false` 的对象 JSON Schema、允许角色、`scopePolicy`、`risk`、annotations、有界执行策略和可调用 handler。
- 执行策略必须明确入口 surface、超时、响应字符上限和单请求调用上限。内联直调只允许只读工具；写入或危险工具必须走人工确认或持久化后台任务，不能伪装成只读。
- 工具执行使用真实 principal 做角色和 scope 校验，输入和输出均有界且可取消。审计必须记录真实 actor、surface、request/invocation ID、脱敏参数摘要、状态、行数、耗时、响应摘要和错误码；审计不可用时应失败关闭。
- 每次注册表变更都要测试：名称唯一且条目完整、OpenAI/Anthropic schema 一致、handler 存在、角色与 scope 过滤、surface 和风险限制、参数/结果/调用次数边界，以及 registry/catalog/execution 同步。新增可检索业务数据却没有注册有界只读工具，或只有 schema 没有 handler，均视为失败。
