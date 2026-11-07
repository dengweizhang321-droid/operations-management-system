# 第一批 W3 聊天停止交付记录

日期为 2026-11-08（上海）。W3 以 W4 已通过独立复核的提交 `e268b287` 为基线。原 Astra 增量反审通过，两项 P1 已闭合，无剩余源码阻断。补丁包含 Worker 与 Django，不新增结构迁移。W4 的普通问数和明确推广流程随 W3 直接影响范围复测。

## 处理契约

- 页面点击“停止生成”会经同源 POST 向 Django 保存请求。该调用独立于正在读取的流。浏览器断流仅释放连接及本地等待，保留真实请求回执，刷新或换页不发送停止写入。
- 早到停止即使尚无会话也可查询。按真实账号、板块及原请求号绑定，内部键位于签名请求 ID 不可用的命名空间。墓碑复用已有 AI 写入回执表。先登记的请求继续使用原聊天回执。已有结果未被取消覆盖。
- 早到停止只接受新网页格式的 ID。客户端时间只用作首次接收的过期检查，允许最多五分钟的未来时差，首次发送窗口为 24 小时。服务端墓碑可在三天后按每次最多 20 条回收，最多保留每账号 80 条及全局 4096 条。旧 ID 的已登记回执继续可读，已知结果未知的原请求仍被拒绝重发。
- 按请求号读取状态的精确 GET 走 Django writer 的只读分支，因为 reader 无请求回执表权限。对话正文等原 GET 仍走 reader。普通 Chat 回执和追加式派发账本的数据库权限沿用现行契约。
- 登记、停止、网络准备及 HTTP 发送许可使用原 AI mutation 顺序。网络准备先记录 `provider_started_at`。在实际 HTTP POST 前，经原事务再校验授权、模型版本、调用预算和停止状态，追加不可变派发记录。派发记录代表站内已给出发送许可，无法证明供应商收到或结束。
- 停止先于首次许可时，页面显示未向模型发送。许可已落盘时，先显示停止请求已保存并等待核对。若供应商回复已完整返回，停止余下轮次并保留已有调用记录。若发送或回复无法确认，则保留 unknown，重复原请求不会再次调用。已写入的回复优先保留。普通断流的已发送未知不会写成用户主动停止。
- 钉钉渠道保留原派发记录语义。模型选择、生成参数、超时和现有工具上限沿用原配置。公共传输回调默认未安装，网页 Chat 在模型 POST 范围内单独安装。

## 隔离证据

证据目录为 `D:/codex-artifacts/ai-repair-batch1-20261107/chat`。初审源码快照 `W3-v1-reviewed.patch` 的 SHA-256 为 `f1bf5980e9c24693fcb8321304b150e90eccddc116307bf292f8543fd3cf8194`，逐文件摘要见 `W3-v1-reviewed-source.json`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 差异及必要语法 | 16 个源码或测试文件的冻结补丁可逆向检查，Git 差异与 Python 语法通过。 | `W3.patch`、`W3-source.json` |
| 私有 PostgreSQL | 9 项通过。原迁移和触发器下验证早到、重复、账号及板块隔离、过期不可再派发、预留前后交错、许可与实际 POST 间的未知、供应商回复后停止、完成后停止和普通断流。 | `W3-pg-launcher.log`、`W3-pg-tests.log` |
| 私有 PostgreSQL 角色 | 同一轮中用现有 provision 与 `SET ROLE teruisi_ai_writer` 执行签名接口，验证墓碑创建、只读回查和过期回收。正常 Chat 回执仍无 DELETE，reader 仍无写入回执 SELECT。 | `W3-pg-tests.log` 中 `test_production_role_contract_allows_scoped_read_and_expiry_without_chat_delete` |
| 定向 Django | 36 项通过。SQLite 加模拟模型、工具和预算，含原流式回执、Unknown 禁止重发、调用预算及 W4 实际 answer 分支的直接影响。 | `W3-django.log` |
| 定向 Node | 34 项通过。覆盖公开停止路由同源/角色验证、writer 状态路由与 reader 普通正文分路、断流不触发停止及可刷新状态。 | `W3-node.log` |
| TypeScript | ACL 路由修改前的八个相关路径无诊断，使用同一仓库配置。最终共享变动由整包统一类型检查。 | `W3-type-scope.log` |

首次 PG 缺少测试角色，使用仓库启动器原有 `--preprovision-ai-runtime-roles` 补齐。角色用例首次被真实 authority 触发器拒绝，补齐夹具的验收标识和激活时间后通过。两份失败原件为 `W3-pg-first-failure.log` 和 `W3-pg-acl-first-failure.log`。原定向 SQLite 的预算假件失败原件为 `W3-django-first-failure.log`。私有 PG 使用真实数据库事务与回环 HTTP 假供应商。Worker 的转发专项使用模拟下游。生产整链、真实供应商执行与远端取消未验证。

源码、独立反审、合并制品与上线按项目授权边界分别处理。W3 由根代理收口提交。

## W3-R1 与 W3-R2 返修

初审冻结保留为 `W3-v1-reviewed.patch`，SHA-256 `f1bf5980e9c24693fcb8321304b150e90eccddc116307bf292f8543fd3cf8194`。返修后完整 `W3.patch` 的 SHA-256 为 `817f10225d51ab7e21d9054131c3c13218db72e3ac98523cc43c3a49be28e1f5`。相对初审快照的 `W3-repair-increment.patch` 的 SHA-256 为 `4adf95e64a55e276a55fd55c3f787685e18c34dbecf376d3d13bb465b807f246`。逐文件摘要和增量范围见 `W3-source.json`。原 Astra 独立交互复查 7/7，通过记录见 [REVIEW-W3.md](REVIEW-W3.md)。

- 已持久化为 unknown 的网页请求统一以 `ai_chat_result_unknown` 返回，供应商诊断仍记在原审计里，其他业务拒绝仍保留原 HTTP 状态。浏览器遇到无法证明未派发或完成的失败时，保留原请求号并禁用发送和切换模型，包括收不到后端回执的网络错误。
- 历史查看继续可用。浏览未知请求期间切到另一既有会话会清空旧正文，保留请求号和恢复限制，刷新仍核对同一请求。只有确认未派发、确认已停止、完整读回原答复或显式新建独立会话才解除限制。恢复已保存回复及新建独立会话时均清空旧草稿。后台回执沿原账本保留。
- `W3-repair-node.log` 的 41 项通过，包括原组件 handler、原 SSE 解码器、合成 hooks/网络下的超时、断线、明确 unknown、停止待核、历史切换、刷新和新建会话。
- `W3-repair-django.log` 的 37 项通过。新增签名 SSE producer 用例使用 SQLite 与模拟 transport 验证原审计的 timeout、持久 unknown 和公开 failure 的同一请求绑定。原 9 项私有 PostgreSQL 事务及角色证据复用，登记、取消、派发和权限接线在返修中无差异。最终类型检查随第一批源码统一收口。
