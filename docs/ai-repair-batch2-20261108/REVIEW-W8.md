# W8 独立反审

日期：2026-11-08。结论：**通过；本次冻结范围未发现阻断。** 此结论是开发候选审查，不代表原生产故障已定位、消息已送达或发布已获授权。

按用户本任务“每个小任务 Astra 独立反审”特例，请求模型 `gpt-6-astra / high`；工具未独立回传底层实际型号与强度，不冒称确认。审查者未参与实现，未修改被审代码、执行 Git、转派、生产操作、真实模型请求或真实钉钉调用。

## 绑定与输入

- 冻结入口：[MANIFEST.json](D:/codex-artifacts/ai-repair-batch2-20261108/w8/MANIFEST.json)，SHA-256 `c0b079eb9af96fe374d92e4a2225e913ba1662792ce810f3b7b8dc8c80d54177`。独立逐字节核验全部 24 个成员：9 个源码/文档、2 个集成依赖、13 个外置证据，全部匹配大小与摘要。
- 完整 [W8.patch](D:/codex-artifacts/ai-repair-batch2-20261108/w8/W8.patch) SHA-256 `703ea2cce27ef01904e27ab9bac5dbd0fbec35e7fee2cb58b0de9f83f653a73c`。直接核查三个运行文件、五个测试文件及相关依赖，未纳入 W9、W6 轮换在途改动。
- 清单基线 `ab8cb3039ac321fa4fcf6c8854765fdd784f716d`；负责人告知 W8 已提交至 `b3699853` 且冻结字节不变。本审不执行 Git，将提交状态记作负责人交接，独立绑定依据为上述实际文件摘要。
- 已读取共享记忆启动入口、相关项目笔记、根 AGENTS、模型/开发/架构/安全/自动化/验证适用规范；核对 [总方案 W8](D:/codex-worktrees/ai-repair-plan-20261107/docs/ai-repair-plan-20261107/PLAN.md)、同目录 REVIEW/EVIDENCE、第一批 HANDOFF/REVIEW-W3 和 [本批实施报告](W8.md)。第一批未合 main，只采用已明确列出的传输接线及本批共享诊断依赖。

## 关键核对

1. **发送边界。** `dingtalk_transport._request_json` 将解析与重解析置于空发送钩子上下文；取 token、上传和群机器人查询不领取消息发送预留。真实消息 POST 在 DNS、TCP、TLS 后调用 final fence，再进入 `HTTPConnection.request`。`requestStarted` 仅表示本地可能写出，未被用作平台接受证明。
2. **动态权限与目标。** final fence 重读配置、核对 session 配置摘要、现行 principal/scope 与凭据绑定。群保持原精确会话 ID，复核唯一机器人安装；不按群名另找目标。任务侧复核原版本、启用状态、模型绑定和广东仓来源，无单聊失败转群或换收件人分支。独立执行器的配置 reader 同时重查独占 PostgreSQL lease 连接。
3. **停止与账本。** `delivery_guard` 沿既有 `mutation` 事务按任务、运行槽顺序锁定，对 `enabled/version/ready` 作条件核对，再持久化 `sending`。停用先提交即拒绝旧版本；预留先提交则继续按在途处理，原真实受理回执可在停用后结算原槽，不伪造撤回。既有群/报告失效不阻止停用原任务，重新启用仍核依赖；页面保留不可用群选项，报告沿用既有缺项选项。
4. **确定失败与未知。** 明确拒绝类 HTTP 或无接受键且唯一目标被明确拒绝才记 rejected；网关/超时/坏响应/矛盾收件结果继续 unknown。准备阶段中断只有本版 `ready + preparing` 标记可记确定未发出；已 sending 的中断及旧记录沿保守恢复。终态旧 unknown 不被恢复循环重写，同一槽不会自动重领。
5. **真实接受程度。** 有效 `processQueryKey` 且无冲突收件结果才返回平台接受摘要；账本还要求原槽为 sending。页面区分“已生成”“平台已受理，送达及已读未核验”和未知；旧 sent 仅标历史记录，没有把模型生成或本地 POST 等同于平台/终端成功。
6. **诊断内容。** 只写固定阶段、单调耗时、受限错误码/HTTP 状态及标识摘要。原消息、token、凭据、平台 prose、staffId、会话 ID、原回执键不进入新增投递诊断；异常文本不被直接序列化。发送后的取消检查或清理失败仍按 requestStarted 保留未知。

## 验证及边界

- 独立运行 [review-independent.py](D:/codex-artifacts/ai-repair-batch2-20261108/w8/review-independent.py)：22 项全部通过，其中 17 项为原传输/企业投递测试，5 项为新增独立边界反例。原始日志 [review-independent.log](D:/codex-artifacts/ai-repair-batch2-20261108/w8/review-independent.log)，逐项绑定与结果 [review-independent.json](D:/codex-artifacts/ai-repair-batch2-20261108/w8/review-independent.json)。使用真实 bounded transport，DNS/TLS/HTTP 仅为合成桩；本次独立运行未打开数据库、未外发。
- 新增反例覆盖：身份拒绝无收件人 POST；预留后写出前预算耗尽仍明确未发出；模拟平台接受后 cancellation cleanup 失败保持 unknown；群身份查询不触发消息预留；HTTP 408/500/502/503/504 均保持 unknown 且不泄漏合成敏感字符串。
- 复核执行者原日志：PostgreSQL 定向 83 项通过；SQLite 81 项中 73 项通过、8 项 PostgreSQL 条件跳过；原 Python AST、ESLint、diff 检查及实际组件五状态 HTML 零外部请求记录与清单一致。未重复运行这些已绑定检查。
- 首轮 PG 的一个中断桩未先越过新预留，最终桩已改为预留后中断；原失败保留。两项旧测试在业务断言前触发不可变身份/证据守卫，最终定向范围排除它们及无关场景；最终 83 项不等于完整初始套件全绿。本次不扩修旧夹具。
- 不声称完成双数据库连接同时争锁实验；顺序竞争的依据是实际事务锁序/CAS 源码、原 PG 顺序用例及独占 lease 验证。独立新增反例也不替代 PostgreSQL 并发或真实平台验证。
- 生产原事件仍为 unknown/provider_unavailable；没有新增证据证明其失败发生在 token 还是消息发送，更没有终端送达/已读证据。旧任务、槽、ID 和 unknown 没有重放或改写。

没有待返修阻断。最终整批集成、构建/启动必需检查与 Git 交付由负责人收口；后续共享传输或本次文件字节变化须按实际增量复核。本报告不授予 main 合并、制品准备或上线。

机器回执：[W8-REVIEW.json](D:/codex-artifacts/ai-repair-batch2-20261108/w8/W8-REVIEW.json)。
