# AI 对话历史执行详情兼容修复

## 问题与修复

正式页面恢复历史会话时，列表与消息接口均返回 HTTP 200；一条回复的 `execution.guidance` 和 `execution.skills` 为空对象。执行详情直接访问 `guidance.rules.length`，触发 TypeError 并进入对话区错误边界。刷新会重新载入同一回复，因此无法恢复。

`app/ai-chat-workbench.tsx` 在展示前校验配置/技能的版本与名称列表。缺失、空对象或无效结构显示“未记录”；有效空列表继续分别显示“通用口径”和“未匹配技能”，有效版本与名称保留。侧栏最近回复配置使用同一校验；最近回复没有证据时不回退展示较旧回复的配置。

本次只改前端展示，不改消息、模型配置、后端、权限、请求或恢复流程，不需要迁移与业务数据处理。

## 验证

- `node --import tsx --test tests/ai-chat-execution-history.test.ts tests/ai-chat-stream.test.ts tests/ai-chat-panel-layout.test.ts`：11 项通过。新增回归覆盖完整/紧凑布局及缺失、空对象、null、缺数组、异常列表成员、有效选择和显式默认选择。
- `npx eslint app/ai-chat-workbench.tsx tests/ai-chat-execution-history.test.ts`：通过。
- `git diff --check`：通过。
- 回环合成浏览器夹具使用真实组件，分别载入空对象和有效选择；执行详情及侧栏可以打开，输入区存在。空对象显示“未记录”和“暂无配置版本记录”；有效选择显示 v2/库存口径。空对象场景控制台无 error。
- 浏览器验证只使用合成数据，无模型调用、外发或正式数据写入。

## 交付边界

修复交付后仍须经正式 Worker 版本切换才能在生产生效。用户本轮授权修复，尚未明确授权上线；生产服务未停止、重启或部署。制品和版本准备结果另记本目录交付材料。
