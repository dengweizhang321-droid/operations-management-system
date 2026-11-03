# n8n 可靠性修复独立审查

2026-11-03。角色请求为 `critical-review / gpt-6.1-sol / high`；当前工具未提供可独立确认的实际底层模型回执。本审查上下文未参与方案或实现，未转派。审阅基线为工作树 `codex/n8n-reliability-20261103` 的当前六文件差异及直接依赖；独立规划见 [DESIGN.md](DESIGN.md)。

## 结论

当前六文件修改未发现阻断交付的代码问题。修改能解除已定位的设备推广规范化请求 64 MiB 拦截，并修正确定性 413 的小时重试及转人工原因误报；不能据此声称生产导入已经成功或全部业务流程已经恢复。

源文件、幂等身份、内容指纹、原计划所有权和提交未知处理均未改变。尚待实际处置的旧客服/物流计划、天猫两店 P 403、DWS 重新授权须单独列明，不能合并计为本轮代码已修复事项。

## 源码与证据核对

| 审查点 | 核对结果 |
| --- | --- |
| 413 的真正拦截层 | `lib/django/netshop-service.ts` 在计算签名、调用 fetch 前按规范化 JSON 字节数拒绝超限请求。主代理原函数离线测量给出源文件 12,960,502 字节、16,006 行、规范化请求 75,915,746 字节，落在旧默认 67,108,864 与新默认 134,217,728 之间。本审查直接核对测量脚本与发送路径，没有重复读取原始客户明细。 |
| Django 实际上限 | `tools/django-netshop-service.ps1:43` 既有 writer 上限已为 134,217,728，并用于 Waitress 和进程环境。`backend/teruisi_backend/settings.py` 的修改是默认值对齐，不能写成生产 Django 原来只有 64 MiB。market/inventory 等领域默认值未随之扩大。 |
| 资源和权限边界 | 客户端 128 MiB 硬顶保持；公开导入仍要求真实 admin principal 和平台 scope，源文件 25 MiB、规范化及 Django 50,000 行限制保持。后台 signed loopback、body 摘要和 writer 路由未变。未把整日文件拆成多次替换导入，也未丢弃 raw 字段。 |
| 推广导入错误 | `tools/jd-promotion-export.ts` 仅保留首字符为英文字母、后续限定英数字/下划线、总长最多 96 的 code；不插入任意响应正文。HTTP 状态仍在错误中，原成功/duplicate proof 校验保持。 |
| 413 终局分类 | 新正则同时覆盖现场 `HTTP 413` 文案及 `payload_too_large/request_body_too_large`。由同一模式数组供导出分类函数和生成后的 n8n Code 节点使用；现有网络重试及吉客云受控特殊分支未放宽。 |
| 终局与派发未知 | 收集终局失败节点使用 `terminal_manual_action`；只有实际派发错误出口生成 `retry_dispatch_result_unknown`。准备提醒节点对 workflow、code 和 execution ID 校验后使用 `p.code`；不会再把合法终局代码兜成派发未知。原连接顺序及单次 POST 配置未改。 |
| DWS 重新授权识别 | `ProcessEvidence` 来自既有有界 CLI 捕获。新判断仅在未进入 sending 且脱敏 stderr 包含授权提示时保存 `dws_auth_required`，不输出 stderr、profile 或身份值。`sending/sent/unknown` 防重复发送及发送前身份核验仍保持；该修改没有执行登录或发送。 |
| 今日运行统计 | 独立读取现有 `execution-summary.json`，按上海 11 月 3 日窗口筛出业务 `mode=trigger` 为 16 条：9 success、7 error。共享错误流、webhook 重试未加入分母。六条终局错误与设备推广后续重复 413 可由同份证据区分。n8n success 仍只是其配置终态，本次未访问业务库重新证明全部事实。 |

已检查生成后的 workflow JSON 中对应 Code 节点及连接关系；本轮工作树未修改其他业务模板。

## 非阻断的交付与采用提醒

1. 生效前按既有发布材料核对 Worker 是否显式设置 `TERUISI_DJANGO_NETSHOP_MAX_REQUEST_BYTES`。仓库中未发现另一个赋值位置，但仅修改默认值不会覆盖运行环境中显式旧值；当前源代码审查不能证明某个生产环境变量不存在。
2. 75.9 MB 的已知请求低于新上限，仅说明本次明确的容量拒绝得到覆盖，不代表任意 25 MiB 文件都一定能导入，也不证明之后没有时限或其他业务拒绝。保留 128 MiB 硬顶是合理的有界修复，当前没有证据要求先建设新分块协议。
3. 现有 waiting execution 使用旧定义快照。发布新错误流不等于此前等待重试已停止；采用说明应精确交代旧等待项，由已有授权和受控入口决定处置，不做全局清空或自动重放。
4. 旧客服三店需要分别按原阶段执行 reconcile，物流复用既有精确恢复器；天猫 403 仍须按原店铺、原任务判断 report_submitting 的提交结果，禁止因错误 HTTP 状态就删除清单重新 POST。DWS 必须由同 profile 交互重新授权；不得把诊断代码当成认证修复。
5. [DESIGN.md](DESIGN.md) 另提出客服消息 200→2,000 的改动，主代理随后已实施；此增量由另一独立 `deep-review` 上下文审查，本报告结论不代替该边界审查。主代理补充的脱敏标量为故障会话 223 条消息/34,240 字节，本审查未重复读取原客户聊天。
6. 公共 StopAndError 节点的名称问题已在增量中修复为“保留人工处理原因并停止”，不再有此项待办，详见下方增量复核。

## 必需检查及边界

- `node --check tools/n8n-hourly-retry-policy.mjs` 通过。
- workflow JSON 解析及 5 个嵌入 Code 节点以异步函数语境进行纯语法编译通过；未执行节点代码。首次用普通 Function 包装时因原有顶层 await 拒绝，该检查包装已改为 AsyncFunction，非产品语法缺陷。
- `backend/teruisi_backend/settings.py` 的 Python AST 解析通过。
- `tools/n8n-manual-action-alert.ps1` 的 PowerShell Parser 检查通过。
- `git diff --check` 通过。

未运行功能测试、生产接口、业务库查询、数据写入、服务操作、n8n 发布/触发或外部消息发送；TypeScript 编译结果由主代理的必需检查材料报告。本审查只新增此报告文件，未修改被审文件。

## 增量复核

2026-11-03，按主代理交接仅复核节点改名及设计文字：生成器名称、生成 JSON 节点和两条连接目标、原测试两处断言已同步为“保留人工处理原因并停止”；节点 ID、StopAndError 类型及读取已校验 terminalCode 的表达式保持，未发现接线遗漏。DESIGN 的推广错误说明已改为仅保留有界公开 code，与实际实现一致，不再要求传递上游自由 message。增量无阻断；复用前述检查结果，未重复运行检查或扩展至客服消息上限实现。
