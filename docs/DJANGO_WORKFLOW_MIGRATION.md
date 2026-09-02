# 运营事务新品项目 Django 迁移与切换手册

## 1. 当前状态

2026-09-02，本机结构化“新品上新”已完成 Django/PostgreSQL 正式单写切换，cutover ID 为 `workflow-pg-20260902T110500Z-bdfebd254007`，authority epoch 为 `ce0ceb5d-7bc9-4ea9-8812-0609f7fdf1aa`。PostgreSQL 是新品项目、目标店铺、七阶段、活动、revision、request receipt 及全部新品读写的唯一权威；`TERUISI_DJANGO_WORKFLOW_MODE` 必须保持 `django`。独立 reader/writer 固定监听 `127.0.0.1:8061/8062`，并已通过 authority 绑定的 `workflow-service-enabled.json` 加入受控开机启动链。

现有 React/Next.js 运营事务页面继续使用同源公开 API，公开 Worker 只承担真实鉴权、无数据范围账号门禁、HMAC、请求/响应上限、超时和薄适配。旧 D1 `workflow_operation_records.record_type='launch'` 行只作为受保护迁移证据保留；D1 authority 已进入 `postgresql` 终态，旧新品列表、详情、活动和写入路径均排除或拒绝 `launch`，不得作为读取、写入、容灾或回滚来源。工作计划、巡店、评价和变量配置仍按各自现有 D1 契约运行，本次切换只改变新品项目子域。

## 2. 本次补齐的业务能力

工作计划仍使用现有 D1 权威，但补充了服务端工作类型、店铺、负责人和来源候选，支持关键词、状态、紧急程度、工作类型、跟进人、店铺、来源、截止日期组合筛选；完整导出会按当前筛选分页获取全部结果，硬上限为 100,000 条。评论、提醒、关联、附件、活动和乐观并发控制继续保留。

新品上新使用新的 Django `workflow` app 建模：

- 项目主数据：商品名称、供应商、品牌、品类、ERP/SKU/SPU 编码、商品图片、提出人/提出日、项目负责人、目标上架日、优先级、生命周期、建议价、审批价、预计毛利率、来源和备注；
- 多店铺目标：以“平台 + 店铺”作为项目内唯一身份，另含渠道、平台 SKU、上架链接和目标状态；
- 固定七阶段：建模、分析定价、图片、视频、上架、备货、上新复盘；
- 每阶段字段：状态、负责人、计划截止日、阻塞原因、备注、证据链接/名称、完成时间和版本；
- 进度与异常：服务端统一推导项目状态、完成率、当前阶段和逾期阶段数，前端不重复定义口径；
- 展示：指标卡、阶段统计、横向矩阵、状态看板、项目详情、活动记录及适配移动端的布局；
- 系统消费：全局搜索使用固定的有界 consumer；AI 的 `get_workflow_page_data(view='launch_projects')` 只返回声明字段、最多 20 个项目、每项目最多 20 个目标和 7 个阶段。

“上新复盘”的默认截止日为目标上架日后 7 天；其余阶段在创建时默认使用目标上架日，后续可逐阶段调整。阻塞状态必须填写阻塞原因。

## 3. 数据与审计边界

PostgreSQL 表包括：

- `workflow_new_product_projects`
- `workflow_new_product_targets`
- `workflow_new_product_stages`
- `workflow_new_product_activities`
- `workflow_data_revisions`
- `workflow_write_authority`
- `workflow_write_request_receipts`

所有写入要求 `operator/admin`、无数据范围限制、writer 进程、激活且 epoch/cutover 一致的 authority。项目和阶段更新使用独立版本号执行 CAS；相同 request-id 只允许重放完全相同的主体、方法、路径、正文和查询。活动表只保存动作、版本、阶段、状态和变更字段名，不复制备注、阻塞内容或其他业务正文。

reader 接受 `viewer/analyst/operator/admin`，但同样要求无数据范围限制，因为新品项目横跨多个平台与店铺，当前模型没有安全的行级 scope 拆分。受限账号失败关闭，不根据自由文本店铺名猜测权限。

## 4. API 与路由

浏览器继续使用同源公开 API：

- `GET/POST /api/workflow/launch-projects`
- `GET/PATCH/DELETE /api/workflow/launch-projects/{projectId}`
- `PATCH /api/workflow/launch-projects/{projectId}/stages/{stageKey}`

内部 Django reader 只允许列表、详情和 `POST /api/workflow/consumers/query`；内部 writer 只允许项目与阶段写接口。reader/writer URL 必须是经批准的两个不同回环端点，不能复用其他业务域的端口、凭据或数据库角色。需要的 Worker 配置为：

```text
TERUISI_DJANGO_WORKFLOW_MODE=django
TERUISI_DJANGO_WORKFLOW_READER_BASE_URL=http://127.0.0.1:8061
TERUISI_DJANGO_WORKFLOW_WRITER_BASE_URL=http://127.0.0.1:8062
TERUISI_DJANGO_WORKFLOW_TIMEOUT_MS=<可选，受硬上限约束>
TERUISI_DJANGO_WORKFLOW_MAX_REQUEST_BYTES=<可选，受硬上限约束>
TERUISI_DJANGO_WORKFLOW_MAX_RESPONSE_BYTES=<可选，受硬上限约束>
```

Django writer 还必须以部署密文提供准确的 `TERUISI_DJANGO_WORKFLOW_AUTHORITY_EPOCH` 与 `TERUISI_DJANGO_WORKFLOW_CUTOVER_ID`。共享 HMAC 密钥继续使用现有受控密文机制，不能写入 Git、命令历史或日志。

## 5. 运行行为与终态边界

`legacy` 模式只允许用于隔离测试、迁移演练或历史恢复研究，不是本机生产回退路径。其历史行为是：

- 新品页面读取旧运营记录工作区；
- 结构化公开 GET 返回 `structured:false`，前端安全回退；
- 结构化写接口失败关闭；
- 全局搜索与 AI 的旧 operations 视图仍可读取旧新品记录。

在 `django` 模式：

- 新品页面、项目写入和阶段写入固定走 Django；
- 全局搜索先返回结构化新品项目，再分页返回仍属 D1 权威的工作事项、巡店和评价记录；
- 旧 operations 列表、详情、活动及写入路径排除或拒绝 `launch`，不回查旧新品作为 fallback；
- Django reader/writer、revision、签名、响应形状或 authority 异常均失败关闭。

搜索采用稳定的“结构化新品项目在前，D1 工作事项/巡店/评价在后”跨源分页，避免声称两个独立数据库共享一个全局时间排序。切换完成后旧 `launch` 数据只可作为受保护迁移证据，不能继续成为可达业务读写路径。

切换已跨过 PNR。故障恢复只允许 PostgreSQL 备份/WAL/PITR、兼容代码或经审批的前向修复；禁止把模式改回 `legacy`、恢复 D1 新品写入或建立双写。

## 6. 正式切换门禁

1. 从最新 `main` 建立隔离 worktree，并在与生产完全隔离的 PostgreSQL 镜像执行迁移和测试。
2. 定义旧 `launch` 到结构化字段的逐行映射。旧记录缺失供应商、商品编码、多店铺目标或阶段状态时必须形成显式缺口清单，不能静默伪造。
3. 以源文件/数据库快照 SHA-256、行数、业务身份、字段摘要和目标摘要绑定迁移 run；验证重复执行幂等、缺失/冲突拒绝以及删除记录处理。
4. 校验每个项目恰有七个唯一阶段，每个目标的“平台 + 店铺”唯一，金额为人民币分、毛利率为基点、日期按 `Asia/Shanghai` 业务日解释。
5. 建立独立 PostgreSQL reader/writer 最小权限角色。reader 必须处于只读事务；writer 不得写销售、财务、网店、市场、商品经营、库存或 ERP 表。
6. 完成 API 正向/负向、scope、角色、签名、正文上限、超时、CAS、request-id 回放、revision、一致读和审计测试。
7. 完成 PostgreSQL 备份、独立临时集群恢复演练以及应用代码前向/兼容恢复方案；不得把 D1 当作正式切换后的回滚事实源。
8. 在变更窗口冻结旧新品写入，复验源摘要未变化，建立单一写入所有者，再激活 PostgreSQL authority。禁止长期双写。
9. 启动并回读独立 reader/writer，核对 authority epoch/cutover、数据库角色、端口身份、进程回执和健康状态。
10. 切换 Worker 到 `django`，验证 React 页面、公开 API、全局搜索和 AI 只读工具；同时证明旧 `launch` 列表、详情、活动和写入路径均拒绝。
11. 只有全部证据一致后，才可进入不可逆终态并更新 `README.md`、`AGENTS.md` 和正式运行文档。生产 authority 只能通过受保护 runtime 中的 `django-workflow-cutover.ps1` 在 Worker、reader 和 writer 均停止的变更窗口内受控切换。

任何一步失败都不得宣称迁移完成，也不得把 `TERUISI_DJANGO_WORKFLOW_MODE` 留在与实际 authority 不一致的状态。

## 7. 本机正式切换证据

- 批准迁移 run：`workflow-bdfebd254007be2416297de2b17bc82e`；冻结源摘要：`bdfebd254007be2416297de2b17bc82e6390735b288b375cf80fd92f809c749f`。
- 生产迁移水位：12 个项目、12 个目标店铺、84 个阶段、38 条活动；12 个历史记录均形成显式缺口清单，没有伪造旧记录不存在的阶段事实。
- 冻结快照：`D:\teruisi-runtime\django-sales\audits\workflow-cutover\20260902-185938-79830ca5\workflow-source.sqlite`，SHA-256 为 `4a1bd31d66dd243a2d7fbf3fed7c98769234221b409c7fd8fa8cb126734842dc`。
- authority 安装前完整 D1 备份：`D:\teruisi-runtime\django-sales\audits\workflow-cutover\20260902-185501-92e29247\d1-before-workflow-authority.sqlite`，SHA-256 为 `75f1dd0cbe300181b8818eb68eb7c81bfca7cb361d43e36bbcdbe78510e48a5f`。该备份只用于审计和受控恢复研究，不是生产回退源。
- 终态 D1 authority 为 `owner=postgresql, epoch=3`；PostgreSQL authority、开机凭据和 writer 进程共同绑定本页开头的 cutover ID、authority epoch 与迁移 run。
- Worker effective release 为 `20260902T141543Z-b1002b5b2f279312`，manifest SHA-256 为 `eea1325d29cc04e335c97edf6ff7295c80bbb19c5331631c4e135f89bbbac53f`；公开 API 返回 `backendMode=django`、`structured=true` 和 revision `1:bdfebd254007`。
- 切换后 PostgreSQL 备份为 `daily-20260902T150557Z-c94854026b37`，manifest SHA-256 为 `98f62104dcd95da09d249746cd529a604d5873c3181c7e3c88015967d18260f7`，内容摘要为 `22c6a7463d02d6c43e84035da79e8f5e90aed27b1383416464de59c359a9afff`。隔离恢复演练 `5277592d0cbc` 在 `127.0.0.1:55432` 完成，恢复后内容摘要完全一致，生产数据库未触碰，临时数据已清理。
- React 页面已实机核验 12 个项目、七阶段矩阵、看板、筛选、详情、目标店铺和历史缺口说明；全局搜索命中结构化项目。旧新品列表为空、旧详情返回 404、旧 `launch` 新建返回 409，证明旧生产路径不可达。

上述数量是切换时水位，不是代码常量；当前状态应通过公开 API 和受控 runtime 状态探针动态回读。

## 8. 开发验证

可在隔离 SQLite 测试库验证 Django 契约；SQLite 不能作为生产权威：

```powershell
python backend/manage.py check
python backend/manage.py makemigrations --check --dry-run
python backend/manage.py test workflow.tests --verbosity 2
node --import tsx --test tests/django-workflow-service.test.ts tests/workflow-operations-records.test.ts tests/global-search.test.ts tests/ai-page-data-tools.test.ts
npm run build
```

测试或预览服务器只能使用隔离端口和隔离数据，不得连接生产数据库、复用正式 reader/writer 端口、重启现有运行服务或修改生产 authority。
