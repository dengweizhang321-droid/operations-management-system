# v4 规范封存正文与内部只读复核

本片新增规范 seal 正文合同、应用 HMAC 和内部 `verify_seal`，不增加数据库迁移或公开路由。正文固定0038允许的精确字段：run/attempt/父版本、计划与目录摘要、各来源真实身份/修订/页行字节/末段和收据链、推广窗口覆盖、财务自然月 scope/分析区间/缺月，以及跨域非原子、不做财务日摊/SKU利润推断、不直接累加 ERP/B 端/广告金额、报告/Agent 未启用、人审必需。解析拒绝重复 JSON 键、非规范字节、额外授权字段和同修订号却不同摘要的“历史”标记。

seal MAC 与0036分段 HMAC 取自**同一受保护 `DJANGO_INTERNAL_SECRET` 主密钥**，使用不同 purpose 派生子密钥；0038 `keyId` 仍绑定原 attempt 的主密钥版本，不是独立 seal 凭据。密钥丢失或未知轮换即失败关闭。未来若改为独立 seal 专钥，必须新增版本与独立 `sealKeyId`，不能按当前合同静默重签。

内部 `verify_seal` 只允许当前无范围管理员在 `development/ai_writer` 执行：先读唯一 sealed parent 和 seal 行，在任何来源声明前重验规范正文、原文 SHA、应用 MAC、keyId 与父/attempt/当前账号；随机 64 位十六进制 MAC 即使能过0038数据库形状门禁，也被此层拒绝。它重建固定京东推广窗口加唯一财务来源目录，逐来源再次复核0036每段 HMAC、当前不可变 chunk/receipt/audit 的元数据与收据链、末段等于来源完成检查点，返回前重查账号/目录/正文/密钥。活源修订以后合法前进不使历史 seal 失效；封存正文保存采集时版本与提交时 `current_revision` 或 `historical_revision` 的披露，仍不是跨域原子快照，上游独立数字签名始终为 false。

这是内部只读验收，未把裸 `status='sealed'` 或0038随机 MAC 测试行当授权，也未接 Agent、模型、报告或文件。复核在一个事务中调用0037固定 finance→netshop 锁源函数，并流式读取每页的块/收据**元数据**，依赖0036建段时完成的原始页核验和数据库不可变门禁，不在每次复核重载最多 2 GiB 的页 JSON。当前每次全链元数据复核及写源锁最多 180 秒，真实 575,095 行规模仍需资源验收；高频 Agent 读取还需要一次完整复核后用途/版本绑定的只读句柄。

`ai_reader` 当前没有0037锁源函数 EXECUTE，也不能直接使用本服务或其返回 DTO。未来报告/Agent若运行在 reader，须走用途限定签名桥或新的只读封存句柄并在消费前复验。未来独立 sealer CLI 还需要严格的 v4 ledger/audit 最小 SELECT 或窄流函数与独立 `ai_sealer` 进程角色；0038的 seal_writer 目前只有 runs/sources SELECT 和窄提交函数，不能只替换数据库 URL 就执行本服务。受保护凭据、正式 CLI、生产发布仍属下一阶段。
