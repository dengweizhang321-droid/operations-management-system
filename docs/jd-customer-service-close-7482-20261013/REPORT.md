# 洗碗机7482失败闭合与客服去重核查

2026-10-13，用户明确要求闭合原失败任务，并检查系统去重；缺少时补充。7482已按零业务效果失败闭合，原计划及n8n error保留，没有重跑、导入、发布或服务启停。闭合解除该店原active指针门禁，不代表下载导入恢复或历史缺日补齐。

## 现场核验与闭合

- 权威本机n8n SQLite只读核验：`JdCustomerServiceDishwasher2026`仍active，current=published；7482是2026-10-09上海09:00的自然完整execution，在B阶段失败，C未执行、无pinData。
- 原固定范围为2026-09-09至2026-10-08。计划source为空、proofs为空，无importingDate、派生文件或源文件摘要；该execution的专用下载目录不存在。导出代码在确认提交前持久化检查点，该次未留下检查点。
- 运营MCP不可用，使用用户指定本机系统的受保护拥有方PostgreSQL只读替代来源；截至本轮核验，从7482原计划创建时间起，该店客服导入尝试、批次、处理中scope均为0，同店重复conversation_key为0。没有读取或保存原始客户聊天。
- 在原店铺planning.lock下复验原计划、active、n8n错误摘要和同工作流无在途execution，create-only保存闭合intent、原active归档及完成回执，仅移除原active指针。回读确认原失败计划SHA不变；未把stage改为completed，未修改n8n原error或定义。
- 脱敏监控账本新增7482闭合事件；原失败次数、历史成功、原通知去重及其他店铺状态保留，未发送恢复通知。

原始证据保留在本机私有目录`E:/codex-artifacts/jd-cs-close-7482-20261013`；店铺账本与闭合回执位于原`outputs/jd-customer-service-pipeline/jd-cuizhiwang-dengweizhang`目录。原计划SHA为`9e12e68977a4715fb72889cbec959f429a86cef9af727d883826fffee3f38874`，原n8n executionData SHA为`f941df31be91fa0f47adf96e284695763288a56cd886d8a5f69c8e5807d061fe`。

## 已有去重与验证

本轮不需要新增去重规则。已安装Django的`backend/customer_service/import_service.py`与最新main同文件SHA一致：`86db78dcc5ad301fb64733e3977ab91d267f72ecb0f97bd5cda2aa3713b9c209`。

1. 完整规范化业务内容指纹按店铺及会话身份集合计算，排除原始行号等非业务差异；当前已完成批次内容与身份集合相同时返回duplicate，原文件哈希变化不单独触发新写入。
2. 会话身份在后端加店铺前缀，数据库conversation_key唯一；已有同身份会话更新，新增身份才插入，处理位于原子事务和店铺scope写锁内。
3. 签名写请求还有request-id回放保护；同request-id且请求内容变化拒绝，避免迟到或冲突请求被当作原成功。

独立worktree的合成SQLite测试`customer_service.tests.test_api`共3项通过，覆盖相同请求回放、原文件哈希变化而内容相同的duplicate、同request-id内容冲突、日期边界及权限拒绝。只在隔离测试库写合成数据，没有调用真实京东导出或生产导入接口。

限制：当前duplicate快捷返回只匹配店铺scope的当前批次；隔着其他日批次再次导入旧一天可能产生新的审计批次，但稳定会话唯一键不会重复追加同一会话。本轮没有宣称全部历史批次都被复用，也没有修改内容变化或原始异常保留规则。零效果确认解决了此前“业务效果未知”的证据缺口，但底层B阶段失败原因仍未证实。
