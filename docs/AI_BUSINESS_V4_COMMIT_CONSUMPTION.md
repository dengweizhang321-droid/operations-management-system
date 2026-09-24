# v4 父封印与票据消费候选（0052）

0052 只新增 `ai_v4_sealer_commit_with_consumption`。入口从真实 `SESSION AUTHORIZATION teruisi_ai_seal_writer` 的已领取票据开始，保持角色 `NOLOGIN/NOINHERIT`；不授予旧 `ai_v4_commit_seal` 直接执行权，也不允许 sealer 直写消费表。安装前核对旧封印、claim、根目录、回放写入、消费触发器的冻结函数、所有者及关闭的直接权限。消费账本非空时拒绝逆迁移。

函数按 `commit-seal-v1` 对精确规范正文原始 UTF-8 字节求 SHA-256，并用身份、父版本、计划与目录摘要、正文摘要、正文 MAC 和 keyId 重建请求摘要，要求它等于最终票据的 `request_digest`。它重新核对活动 claim、当前来源根、每个来源的全部连续分段、段证明摘要、候选摘要链、历史票据有效领取记录及相同根、身份、密钥版本。缺少任何一个分段候选时拒绝提交。通过后调用 0038 原封印函数，并在同一个 PostgreSQL 函数调用中插入 0043 消费回执；中途异常会回滚整个语句，0043 的延迟触发器继续拒绝单独封印。若结果不确定，调用者必须通过已有 `ai_v4_sealer_consumption_result` 精确查询，不盲目重试封印。

**验签边界：** PostgreSQL 只能验证 `bodyMac` 的格式以及它在请求摘要中的绑定，不能独立验证真实 HMAC。候选回执的 `authorityVerified=false` 也不应被解释为已获权威授权。正式执行器必须在受保护环境中取得独立派生的父封印密钥，先验证正文真实 HMAC、来源权威、当期 `authority_epoch/cutover_id`，再通过受控身份调用；不得把主密钥放入命令行、环境变量、日志或测试夹具。0052 本身不激活登录、不连接生产、不派发 Agent/付费模型，也不交付报告。

目标隔离 PostgreSQL 测试为 `BusinessV4CommitConsumptionTests`：完整推广和财务候选的单语句封印消费、缺回执/错误 claim/错误请求/非规范正文阻断、旧直达封印拒绝及非空回执逆迁移拒绝。迁移升级与备份恢复另由独立演练验收；本提交仅做静态编译与纯请求契约测试，不能据此声称 PostgreSQL 或正式业务成功。
