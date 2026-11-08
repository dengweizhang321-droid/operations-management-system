# F10 后端身份隔离独立审查

2026-11-08。请求模型 `gpt-6-astra/high`，实际底层型号未独立确认。审查者未参与实现；只读检查 `tests/ai-functional-isolation.py`、`tests/ai_functional_http.py`、真实权限桥源码和原件，没有执行该含写入脚本。

## 结论

本轮原13条记录及下方R1新增5项所覆盖的后端身份隔离通过；F10完整登录链仍未验，不能将其整项标全通过。

原件根 `D:/codex-artifacts/ai-isolated-functional-20261108`。最终 `ISOLATION-1794131290759586400.json` 记录：所有者记忆读取200、他人404；viewer写记忆及正文伪造admin均403；本人会话200、他人404；admin/analyst知识检索各返回允许角色的唯一合成内容；后台身份有效时ok=true，停用后普通读取403且原后台身份回查authorization_revoked；无签名请求401。

`lib/ai/background-principal.ts` 使用真实权限reader，`lib/ai/django-edge.ts` 校验原HMAC。edge-egress 中后台授权原503/503失败与最终200/403均保留，最终拒绝是实际 `authorization_revoked`，并非只靠“抛了某个异常”满足测试断言。

## 原失败与边界

- 第一次记忆写入实际201，测试错误期待200；后续沿用已创建记忆，没有抹除原记录。
- 两次后台授权503来自合成权限初始化缺revision/有效目录摘要，`ACCESS-SEED-COMPLETION.json` 明确补初始revision1及固定角色目录；没有修改业务鉴权逻辑。历史三份失败ISOLATION原件保留。
- 调用者从私有 `AppUser` 得到主体并用本轮内部HMAC签名；这证明受信内部边界后的权限行为，不证明宿主认证头不可伪造、正常登录/会话签发或浏览器会话通过。
- 原13项脚本后台授权scope=null；R1已补非空平台scope及会话scope收窄，但没有逐一验证渠道/仓库维度、所有中央工具越权组合。Pi/CSV跨用户文件由对应Runner审查负责，不以本报告代替；全部图片/产物/下载/Skill资源不能从本轮有限样例推定通过。
- 知识例子验证角色ACL，不是“每条知识均按所有者私有”的证明。未新增真实账户、真实供应商请求、生产数据或外部发送。

## R1：非空scope增量复核

原审查上下文只读复核 `tests/ai-functional-scope.py` 和 `SCOPE-1794131808240788100.json`，5项通过。实际注册主体的scope为京东平台、合成渠道A、空仓库；同一主体通过原catalog/HMAC/中央工具执行链请求京东取得ok=true。仅把platform改成天猫后ok=false、无data；独立私有PG只读核到前者started/succeeded、后者started/failed，参数除平台外一致。

拒绝位置核到 `lib/netshop/ai-tool.ts` 首部调用 `netshopPlatformsForPrincipal()`，`lib/netshop/access.ts` 在请求平台不属于主体platforms时抛原 `AuthorizationError`。中央工具对该异常返回泛化 `tool_execution_failed`，当前证据证明平台围栏有效，不证明权限错误诊断已经精细化，也不把泛失败本身单独作为权限证据。

同一scope账号创建真实聊天200、原scope读取同一会话200；将注册scope收窄为三空数组后，原会话读取404。脚本finally恢复原scope；审查者再次以只读事务核实账号为active且恢复京东＋合成渠道A＋空仓库。此样例覆盖scope收窄使旧会话不可见，不泛化为各维度的全部组合均验收。

`SCOPE-1794131734221199400.json` 保留初始schema字段错误（dimension/shopName）；`SCOPE-1794131758853439900.json` 保留误期待特定错误码的测试失败。两次均为有限只读工具拒绝，后续没有以重放unknown消除失败；最终聊天为单独新场景。本轮未改业务源码，审查者没有执行含写入的scope脚本。完整宿主登录仍未验。
