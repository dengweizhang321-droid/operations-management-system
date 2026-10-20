# PiAgent 三期功能验证与修复

2026-10-20。验证基线 `5bebdee7`，分支 `codex/piagent-phase3-verification-20261020`，独立工作树 `D:/codex-isolated/piagent-phase3-verification-20261020`。用户本次明确要求功能验证、发现问题修复，并禁止合并 main。本次未合并、发布、迁移正式结构、启停正式服务、补跑真实业务或发送真实消息。

## 结论

原实现存在两类已复现的预期偏差，已在本分支修复。修复后29项隔离后端/原生证据测试及16项前端、注册表与直接回归检查通过，共45项，无跳过。普通工作计划与新鲜库存草稿会直接排队；补缺、报告外发及过期库存草稿仍要求用户核对具体预览后确认。

**不能把本次结果称为四项能力均已在正式环境完成端到端验收。** 正式六店 n8n 原生图与三期登记候选不匹配，当前全部返回 `n8n_version_changed`，尚不能从Pi发起真实补缺。机器人基础配置及凭据文件存在，但本次没有验证有效接收目录或真实投递。没有调用真实模型验证其选参质量。

## 逐项结果

| 功能 | 本次实测 | 结论与边界 |
| --- | --- | --- |
| 工作计划 | 必填项、真实日历/先后顺序、未受限writer权限；正式WorkflowTask及活动/版本保存；同action回执重用、观察原对象 | 隔离通过。修复原来一直停在prepared、不自动排队的问题 |
| 补货草稿 | 库存质量、缺销量、过期与版本变化拒绝；正式ReplenishmentPlanItem保存、回执重用、后续原编辑入口修改数量 | 隔离通过。复用原库存reader及writer；reader本次以合成数据为接缝，不声称重新验收全套库存算法或正式数据质量 |
| n8n补缺 | 实际六份候选图；合成原生SQLite的active/版本/图匹配、固定七日范围；无缺口不建动作；原execution标记、下载/导入批次/覆盖/收尾缺一不可；多execution冲突拒绝 | 原生解析与完成判据隔离通过。正式元数据只读核查六店均版本不匹配，未采用候选。没有创建真实execution |
| n8n节点准入 | 通过真实合成元数据reader绑定原execution；错误token、execution、版本及取消后拒绝 | 隔离通过；未调用真实helper、浏览器或业务导入 |
| 报告定向投递 | 当前目录过滤、文件类型/大小/hash/权限、预览零发送、正文/附件分段回执、策略变更拒绝、部分成功保留unknown且不重发 | 隔离通过；发送提供商使用受控替身，只证明平台受理语义，不证明真实送达/已读 |
| 持久队列与控制 | 明确意图、其他操作的意图拒绝、过期/撤权/取消、同调用换invocation不重复、同client确认不重排、刷新纯读、丢响应观察、失租约unknown不重领 | 隔离通过 |
| 并发与数据库 | 两线程同时准备同意图，仅一个action、另一请求复用；真实PostgreSQL17.11及原0086状态触发器验证prepared→queued及version递增 | 通过。ORM合成表和原状态trigger，不冒称正式ACL或完整迁移验收 |
| 前端与中央注册表 | 真实React业务卡、过期警示、丢POST响应后刷新仅GET恢复、在途取消不冒充回滚；双供应商schema一致、普通Chat/Pi只读/钉钉无写权限 | Headless Chrome及注册表检查通过 |

## 修复说明

1. `backend/ai_assistant/pi_business.py`：普通计划/新鲜库存草稿原来只创建prepared，唯一queued入口是用户再点confirm，与三期明确的直接排队预期不符。现在在同一权威事务中绑定原预览摘要、重查有效身份及环境后排队，version递增符合现有PostgreSQL触发器，不新增迁移。
2. 同文件的`perform`原来对缺少status或未知status的业务回执默认成功，空对象已复现误报。现在仅接受登记状态；无可核实状态保留unknown、原动作及幂等身份，不重放。
3. 自动排队修复保留原过期库存人工确认要求：模型`acknowledgeStale:true`不构成人的确认。只有库存拥有方明确返回`inventoryStale:false`才自动排队；True或缺失均保留prepared。业务卡明确提示过期风险。此项是本次自动排队修复的必要边界保护，不把它冒称原实现已有的第三类缺陷。

原始基线15项中失败3项（两项自动排队、一个空回执）；其余12项通过。补充writer、报告、原生n8n、PG及并发后，最终29项全部通过。私有测试夹具中的authority初值、租约版本和SQLite关闭问题已修正，未修改产品门禁来让测试通过。

## 命令与证据

使用现有Python虚拟环境和Node依赖只读执行，在独立工作树生成全部临时材料：

```powershell
& D:/teruisi-runtime/django-sales/venv/Scripts/python.exe tests/run-pi-business-verification.py --postgres
node --import tsx --test tests/pi-agent-tools.test.ts tests/ai-pi-frontend.test.ts tests/pi-business-tools.test.ts tests/pi-business-browser.test.mjs
```

- [PostgreSQL最终日志](postgres-final.log)：29项，通过；使用新建私有cluster/55873端口，原0086状态trigger，结束后停止该cluster并核端口关闭。
- [Node/浏览器最终日志](node-final.log)：16项，通过；包含既有Pi前端与只读工具直接回归。
- [正式配置只读观察](read-only-readiness.json)：六店均`adopted:false/available:false/n8n_version_changed`；机器人仅基础配置与文件存在性，不读取或输出凭据内容，不冒称有效配置或真实投递。
- [独立复审](REVIEW.md)：按项目模型映射请求Sol High新上下文，审查者未修改源码或生产状态。

测试运行器清空继承的生产环境变量；默认内存SQLite，`--postgres`明确新建私有cluster，合成n8n元数据文件只读打开。正式n8n观察另行使用当前配置路径及`mode=ro/query_only`，没有写入n8n。外部模型、机器人和真实业务边界未调用。

## 交付状态

修复、测试及报告仅交付本任务分支，未合并main，未生成生产发布包。主工作区既有改动保持。分支与工作树保留供用户审阅；后续仅在用户明确说合并main后才执行合并。版本对应的生产采用、n8n候选采用/激活及真实外发分别需要对应授权，不能拿本次隔离成功替代。
