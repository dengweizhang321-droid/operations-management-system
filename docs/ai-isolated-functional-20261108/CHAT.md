# 聊天及后端用户隔离实证

本轮运行实际 Django HTTP、原内部 HMAC、真实 PostgreSQL、原中央工具桥和独立 HTTP/SSE 供应商夹具。应用源码未修改。客户端使用数据库已注册的合成账号构造合法内部信封；不代表宿主正常登录或公开 Worker 用户身份验收。`LOCAL_DIRECT_ACCESS=false`。

| 项目 | 结果与限定 |
| --- | --- |
| W4 普通/推广分流 | 普通问题及包含店铺/日期/“报告原因”的请求均走普通模型响应。明确推广请求执行两次原工具查询并保存精确范围；由于私有库没有该推广范围，状态为 `source_unavailable`，不是推广业务报告成功。 |
| W3 SSE | 真实fixture逐块发送三段，原Django返回status/reset/三个delta/done。客户端逐行计时验证delta跨至少200ms，非仅检查最终拼接文本。 |
| W3 幂等 | 普通成功请求同ID重复返回原结果，fixture总增量1次。 |
| W3 派发前Stop | 取消先落库，随后原ID提交返回499 `ai_request_cancelled`，模型调用零增量；原ID状态回查为cancelled/not_sent。 |
| W3 派发后Stop | fixture收到请求后再取消，原回执持久保存；重复同ID不再发送模型请求，原调用只发生一次。 |
| W3 断流unknown | fixture接收请求后声明长响应但主动截断。第一次失败保留未知，原ID再次提交409，模型计数仍1，未用新ID重放。 |
| 页面围栏 | 定向执行现有真实组件handler交互测试。React调度及leaf UI为既有测试设施，HTTP响应合成；它证明编辑/换模型/历史切换的状态围栏，不冒充真实登录浏览器整链。 |
| F10 后端权限 | 私有账号A记忆保存/读取，B跨用户404；viewer写入及正文role提权403；会话跨用户404；知识按实际allowed_roles返回各自可见条目；原后台身份服务active允许、disabled拒绝；无签名HTTP拒绝。非空scope新增5条记录：同工具京东查询成功、天猫拒绝无data；本人会话原scope200，范围收窄后三空404，最后恢复原范围。Pi/CSV文件跨用户证据另见Runner报告。 |

原件在 [外置目录](D:/codex-artifacts/ai-isolated-functional-20261108)：`CHAT-*.json`、`ISOLATION-*.json`、`provider-requests.jsonl`、`edge-egress.jsonl`、`CHAT-UI-INTERACTION.tap`。每个case保存实际clientRequestId、HTTP返回及DB回执；所有原失败保持。

## 夹具纠正与未验

初始普通请求UUID格式被测试脚本错误缩短，原服务明确未派发、无业务回执；修正格式后新建正常案例。派发前取消原契约为499，首次断言误写409，纠正后使用同一ID再次核对。明确推广空来源返回HTTP200并标明source_unavailable，首次测试误以为必须HTTP错误；纠正断言后两个原ID回读，未重复模型执行。记忆创建原接口为201，首次断言误写200；后续直接读取已创建记录，不再创建。后台权限服务初始revision=0/全零digest按原门禁503，补齐合成初始snapshot和固定角色目录后通过；没有修改应用门禁。

完整宿主ChatGPT登录、正常会话签发、真实多账号浏览器切换未验。知识库是按角色共享的资料，不是逐用户私人记忆；两者按实际契约分别验证。生产DB角色最小权限资格未由本轮development角色替代。真实供应商输出质量、付费资格和外部消息均未验。
