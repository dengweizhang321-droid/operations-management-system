# 京东物流采集、导入与 POP 页面实施规划

日期：2026-10-15。规划基线：`895b1755`，独立工作树 `codex/jd-logistics-integration`。请求角色 `decision`、模型 `gpt-6-astra`、强度 `high`；实际后端型号未独立确认。本文是实施边界与验收依据，不是生产安装、启用、下载或导入完成证明。

## 1. 本轮目标与已确认范围

用户最终确认：四类数据全部加入采集与导入，POP 与 C 仓监控页面都做。该指令覆盖上一轮排除 C 仓及本轮早期仅做采集的范围。C 仓展示源库存、7/30日销量、周转、采购/调拨在途、补货后库存与缺货阈值；实际通知投递须独立目标配置和授权，不以开关宣称已发送。

| 数据集 | 本轮能力 | 日期与范围语义 |
| --- | --- | --- |
| `flow` | 库存流水导出、校验、导入，支持 POP 调拨与人工 ERP 确认 | 精确起止业务时间、事业部、仓库及类型筛选；不以文件生成日代替业务时间 |
| `shop_products` | 店铺商品批量导出、校验、导入，辅助 POP 商品归属与映射 | 精确事业部内启用状态的商品关系全集（按用户截图的状态筛选），允许一商品多店；CSV未给平台时保留未知 |
| `realtime_inventory` | 实时 C 仓库存明细采集导入 | 实际采集时点与源页面筛选，不标成昨天的历史余额 |
| `inventory_snapshot` | T-1 库存明细分仓采集导入 | 上海目标日，页面日期、任务及文件证据一致才接受为历史快照 |

开发目标为可连接真实 API 的 React 页面、Django 事实与维护接口、可检验的下载器和默认关闭的 n8n 工作流。未知京东端点、文件契约或导出身份须先观察核实，不在规划中猜造。ERP 目前仍是人工确认；没有真实 ERP 单据回查证据时不显示“ERP 已核验”“账实一致”或“倒挂已解决”。

## 2. 系统架构与布局地图

开始任务先理解整个系统的模块地图与相关垂直调用链，再修改具体文件；不以旧独立 HTML 页面替代现有 React 布局。本次已按 `AGENTS.md`、README、系统架构和相关规范核对以下分工：

| 层次 | 现有入口 | 本次边界 |
| --- | --- | --- |
| 应用壳与导航 | `app/page.tsx`，模块 lazy loader、URL 模块状态、真实 currentUser | 沿用工作流、BI、网店、市场、客服、销售、库存、货品、事务、导入、设置、AI 的统一壳；不复制侧栏或自建一套模块标签 |
| 库存 React 页面 | `app/inventory-module-view.tsx`、`app/inventory-filter-bar.tsx` | 现有库存总览、库龄、备货、滞销、京东入仓、广东入仓保持；在京东入仓区域增加 POP 切换与独立组件，使用现行按钮、卡片、表格、错误及加载状态 |
| 公开 API 与薄网关 | `app/api/inventory/*`、`lib/django/inventory-service.ts` | 真实 principal、输入/文件解析、体积和时间限制、签名传输；不拥有新的业务事实、去重或调拨规则 |
| 库存领域 | `backend/inventory/urls.py`、`views.py`、`models.py` 与新增物流服务 | PostgreSQL 唯一事实源；库存 reader/writer 分离；新增物流数据集独立于既有 ERP stock/age，不覆盖现有库存快照 |
| 其他业务域 | sales、netshop、products、erp_reference、market、workflow、customer_service、finance、access_control、ai_assistant、bi | 各域拥有自己的事实；ERP 编码可引用既有受控主数据，不新造 ERP 建单接口；商品归属不写回 netshop 事实；BI 不复制本次事实 |
| 账号注册 | `config/jd-store-accounts.json`、`lib/jd/store-registry.ts` | 复用受控可执行文件、Profile、端口、下载目录；物流能力与来源授权独立登记，原店铺 enabled 不自动启用物流 |
| helper 与流程 | `tools/tmall-sycm-cookie-pipeline.ts`、`tools/jd-n8n-pipeline.ts`、n8n 模板 | 复用 helper 的 execution owner 与 A/B/C 模式；物流有独立协议、工作流 key、状态与 manifest，不挪用商品/商智业务任务 |
| 浏览器互斥 | `lib/jd/chromium-run-lock.ts` | 复用所有京东流程共享的全局 Chromium 锁；同 userDataDir 各 Profile 串行，关闭本次自有实例并确认端口释放 |
| 批次、审计与部署 | 库存 batch/scope-head/attempt/fingerprint/receipt/revision；现行构建、迁移及发布工具 | 复用领域模式，审计与事实在 PostgreSQL；下载 manifest 仅是采集证据。新增表同步最小权限/readiness/必要运行清单，结构迁移与业务导入分开 |

现有京东入仓监控由 ERP 库存和销售 consumer 组成，`nativeComparisonAvailable=false` 是原能力声明。本次 POP 功能和 C 仓文件导入不能自动改写它。若新增 AI 读取能力，须在中央 `lib/ai/tool-registry.ts` 显式登记有界只读工具，不把任意 operation 或 SQL 暴露给模型。

## 3. 身份、共享来源和策略

`businessUnit` 表示已核实的京东物流事业部/货主业务身份，必须与源系统组合。`storeKey` 是采集账号的受控注册引用；商智 `shopId`、店铺名、Profile 名均不能替代 `businessUnit`。源页面与导出表编码的具体字段映射，以真实证据固定并标注契约版本。

同一事业部可由多个账号访问，也可关联多个店铺。A 先按“源系统＋businessUnit＋dataset＋精确范围”去重，再从已授权账号中选定唯一 collector。其他账号只是来源访问关系，不能形成多份事实或多次导出。计划后禁止遇错自动换账号；来源授权或 Profile 变化必须重新核验，不能接管旧提交。

策略由服务端受控配置或 Django 配置返回，前端不自造 enabled。新账号可动态出现在候选列表，但物流能力、自动采集、来源核验与四类数据集启用分别判断；新项默认关闭。A 保存策略版本和必要内容摘要，B/C 核验原版本与当前撤销状态：关闭或撤销应阻止新业务动作，不能在已下载/已导入后篡改历史计划。仅无启用项可返回明确 `disabled/not_due`；契约不完整、来源未知或覆盖读取失败返回 `not_ready/failed`，不得包装为空结果成功。

页面中店铺筛选只过滤有来源证据的商品关系。无法把单条流水归属某店时显示“事业部共享流水”；多店关联不能重复累计同一调拨商品。人工商品映射至少绑定源系统＋businessUnit＋事业部商品编号；人工调拨状态至少再绑定京东单据编号，不能绑定行号或排序位置。

## 4. 前后端合同

本轮采用统一公开路径 `/api/inventory/jd-logistics`，通过明确的 method 与 operation 区分读取、导入、映射维护、人工状态及采集策略。该路径是 TERUISI 自有 API，不是京东端点。最终 operation 名称与完整字段由前后端共享合同固定，本文不再维护竞争版本。

合同要求：

1. GET 只读进入 inventory reader；写方法只允许对应 operator/admin 和 unrestricted scope，按既有库存权限设计。网关和 Django 各自拒绝未知 method/operation/字段；不得提供任意路径、函数名或来源 URL 透传。
2. 通用身份包含 dataset、source system、businessUnit、精确 scope、contractVersion、rawFileHash、规范化 contentHash、batchId、revision、collectedAt/sourceAsOf 和状态。编码按字符串保留前导零；时间明确 Asia/Shanghai，缺失值不默认为零。
3. 浏览器文件上传与 helper 下载文件导入使用同一解析合同及领域服务。格式、表头、必要工作表、业务类型、日期、数量和来源先严格校验。前端显示准确文件错误，不只把上传 HTTP 200 当完成。
4. 服务端独立重算规范化内容指纹；原文件哈希用于追溯，不单独决定 duplicate。人工映射、状态更新使用 expectedVersion/CAS；调拨证据变化后旧人工确认须重新核对，409 不静默覆盖。
5. 返回有界分页、revision、精确批次与证据状态；旧结果可带上次成功时点保留，刷新失败不能变零、清空或显示核对通过。切换用户、事业部、子页或筛选时取消旧请求并用 generation 隔离迟到结果。
6. C 仓两数据集供独立 C 仓监控读取，按相同事业部、商品编码命名空间、仓库身份配对；实时 T 与官方 T-1 快照允许配对并显示两日期，过旧、未来或缺源不填零。源省市原文保留，不臆测大区。新指标不覆盖原 ERP 库存健康卡和原备货计划事实。

## 5. A → B → C 工作流

工作流模板默认 `active=false`；页面加载、文件导入或策略列表查询不安装、发布、激活或执行正式 n8n。模板、源码、已安装版本和已激活版本分别记录证据。

### 领取与 A：冻结计划

定时和手动入口都先通过原 `/coordination/claim` 领取 `workflow key＋n8n execution ID`。健康检查不能替代领取。共享池未授予时只在 A 前按现行有界等待规则排队；不得占用后并行启动另一个京东 Profile。

A 动态读取受控账号、物流策略、核验来源与必要覆盖，固定上海业务日、数据集、精确范围、collector 和 source contract。生成 runId、executionId、policyVersion、plan digest；同源范围去重。实时库存绑定采集模式，历史快照绑定计划目标日，两者不能混用日期策略。流水初次范围、回补窗口与来源最大跨度应作为显式策略，不照搬商智“当月补缺”或用当前日期臆定历史窗口。

### B：串行下载、全量校验、导入

按计划的稳定顺序逐来源/数据集执行。每次业务动作前核验 owner、来源身份、允许范围、策略未撤销；在共享 Chromium 锁内启动原注册 Profile，来源不符、登录/验证码或安全验证异常立即失败关闭。

每一导出保存 baseline 和 submit intent 后只提交一次。仅绑定与来源、筛选、日期、时间窗及 baseline 一致的唯一任务；不选“最新一条”，不接管历史账号文件。`submitting` 后没有确定结果时保留 unknown，不自动重发、不换 Profile 再试。

下载的原文件保存到该 run/dataset 的受控独立目录。校验唯一来源、完整分页/批量任务集合、表头、字段类型、所有业务行、范围及原文件摘要。店铺商品若需多批导出，应先验证并合并为一个权威集合后一次导入，避免逐批快照互相覆盖。下载/校验可设独立函数替身，但正式 adapter 只能使用已观察的京东页面/任务协议。

建议本次计划全部必需文件完成验证后再开始导入，减少来源格式错误造成的半轮发布。各数据集按自己的事务原子提交；不能宣称四表跨域事务。中途失败保留已发布的精确 batch 回执和其余状态，只允许同一计划的有证据协调，不能回滚已成功批次或重复导出。

### C：独立精确回查与收尾

C 重新读取持久 manifest 和真实 API 批次，逐项核对 dataset、businessUnit、scope、raw/content hash、规范行数、状态、告警与当前选用版本。duplicate 必须绑定已存在的同范围同内容批次，并验证其仍是该范围的有效事实；若被后续版本替代，不能把旧批次 completed 当作本轮当前数据。

历史快照核对精确日期，实时数据核对实际采集时点，流水核对完整声明范围，商品关系核对完整事业部/店铺集合。没有权威来源完整空集合证据时零行不得清空旧事实。只有所有计划项回查成立、无未知提交并且自有浏览器关闭/资源释放成功，才把整轮标为 completed。部分成功和 disabled 单独表达，不伪报“新导入四表”。

## 6. 最小持久 manifest 与恢复边界

运行 manifest 至少保留 protocolVersion、runId、executionId、workflowKey、planHash、policyVersion、collector storeKey、已核验 source identity、四类 operation 的精确 scope 和阶段。每项记录 baseline 摘要、intent 时间、唯一 task identity、下载相对路径与 raw SHA/bytes、parserVersion、contentHash、rowCount、服务端 batchId/receipt、核验结果和失败代码；不存 Cookie、签名下载 URL、Token、密码或原始个人信息。

阶段建议为 `planned → submitting → submitted → downloaded → validated → importing → imported → verified`。阶段通过原子写入推进；`submitting` 与 `importing` 的未知结果分别通过原任务/原请求回执协调，不能直接回退。所有动作绑定原 execution owner，跨 execution 续接在没有专门受控协议前拒绝。重启也不能只按 active 文件不存在推断没有导出。

原始业务行不以 Excel 行号作事实身份；稳定源事件 ID 未证实前，流水按完整精确范围原子替换，规范化指纹保留重复行的多重次数，不折叠可能合法的完全相同事件。重叠范围用“事业部＋数据集”的稳定基域串行 owner/fencing，不能以整段日期字符串作互斥键。新内容移除旧行，但人工映射和人工历史不随源替换删除。

## 7. 实施顺序与直接验证

1. 固定真实页面/任务/文件契约：来源身份、四类导出动作、日期与分仓模式、批量/分页、唯一任务、附件、空集合和范围上限。截图只能作为入口证据，不能代替网络与文件事实。
2. 前后端共享合同与结构：统一 API、Django 模型/事务/权限、文件解析、批次回查及人工 CAS。migration 仅结构；历史文件导入与业务回填另列。
3. React 接入现有库存壳：POP 页面、映射与人工状态、来源/导入状态；验证子页切换、刷新、权限和请求竞争，保留原京东入仓区域。
4. 下载器及 A/B/C：先用合成 adapter 和临时目录验证状态机，再按已核验来源补齐正式 adapter；生成 inactive n8n 模板并测试真实 helper 路由与 build 入口。
5. 独立关键审查覆盖共享来源、跨账号隔离、导入原子性、未知提交、人工 CAS 和最终完成判定。按修复增量复审，不扩大为全仓审查。

必要反例包括：同事业部多账号重复计划；同商品多店重复累计；同编码不同事业部；策略在 A 后撤销；旧 execution/owner 迟到；任务点击结果未知；多个下载候选；历史日期不一致；缺页/空文件/坏表头；同内容重排 duplicate；业务内容变化替换；范围重叠；合法重复事件；同单多商品；人工确认后新流水；导入成功响应丢失；C 遇到旧已被替代批次；浏览器关闭失败。隔离 PostgreSQL 验证事务与权限，合成 n8n/helper 验证实际路由和状态，React 验证实际页面。仅对直接影响做测试。

## 8. 完成与交付证据

文档/源码完成、隔离验证通过、真实来源适配完成、正式 n8n 安装、工作流激活、正式业务导入是不同状态。报告必须逐项注明已证实和待完成项。开发完成后按现行交付契约提交、推送、合并与准备绑定制品；生产部署、结构迁移、账号授权绑定、业务采集导入和定时启用按本次具体授权执行，不能由“搭建工作流”外推为已授权所有生产动作。

本规划不执行任何生产操作，不修改共享运行配置，不发送外部通知。当前最关键的证据缺口是四类来源真实导出合同与完整性证明；缺口未闭合时 adapter 应明确不可运行，不能以合成测试通过宣称自动链路已打通。
