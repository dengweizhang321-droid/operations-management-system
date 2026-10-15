# 京东物流接入：前端架构与布局复用核对

日期：2026-10-15。请求执行模型 `gpt-6.1-sol/high`，工具未独立返回底层实际型号。本文为隔离开发记录，不代表已上线。

## 修改前核对

- 应用外壳与一级导航由 `app/page.tsx`、`app/shell/navigation-catalog.ts` 统一管理；库存模块复用 `app/inventory-module-view.tsx` 的 `subnav inventory-subnav`。现有京东入仓页是 ERP 库存/销售计算视图，必须保留其读取、筛选与原功能。
- 本次在「京东入仓监控」内增加同风格二级入口「ERP 京东仓 / 京东 POP / C仓监控」，POP 内使用现有 `subnav outlet-subnav` 的次级标签组织流水、调拨核对、商品映射、导入记录、账号设置；没有独立侧栏或静态演示外壳。C仓页是用户最新明确恢复的业务范围，使用独立组件，不扩写原ERP视图。
- 页内复用全局 `panel`、`table-toolbar`、`data-table`、`data-state`、`row-action`、`primary-button`、`secondary-button`、`status` 与分页样式。账号/仓库选择复用 `SearchableSelect`，弹窗复用 `app/ui/dialog.tsx` 的焦点管理、Escape 和背景隔离。局部 CSS 仅补间距、字段网格和溢出。
- 既有公共库存筛选是 ERP 仓库/品牌/品类维度，不可将其误用于京东事业部身份。POP 使用事业部、京东仓库、业务日期及 Enter 确认搜索，保存 URL 并支持前进/后退；账号身份独立于商智 shopId。
- `app/import-module-view.tsx` 是统一文件导入入口，保留原所有来源及权限，本次加可到达京东物流专用四源导入表单的入口。工作流页面由主代理接入现有原生流程概览及 n8n 门禁。
- 新业务权威后端位于 Django 库存域。Worker 只做真实 principal 鉴权、严格方法/路径准入、有限请求体与工作簿解析、签名转发和稳定错误响应；不在 React 或 Worker 实现库存聚合、去重或权威映射。

## 数据与交互边界

2026-10-15 后续用户参考单品矩阵，C仓页改为单品汇总行、来源省市/仓库横向矩阵，点击商品左侧展开既有分仓明细。继续使用完整React header、原库存/ERP/POP子导航及现有panel/data-table/筛选样式；仅修改C仓组件与局部样式。数据按后端完整有界scope先分组商品再分页，列和当前范围汇总也由后端提供，不能从当前仓库页拼全国。列只用真实来源省市或明确仓名，未知仓按身份分列；没有已验证店铺归属时保留事业部库存池筛选，不复制朋友站点商品图或业务数据。7/30日切换只显示已有来源和服务端派生指标，不加15日假控件。

- 默认不显示样例、合成统计或成功连接。无账号显示未配置；服务不可用显式报错；未采集/未核实显示「—」或未知，不能转成零。
- 四类导入为库存流水、店铺商品、实时库存、库存快照。保留原始数量分量、库存类型/状态/渠道及商品身份字段；人工映射 C/D、人工调拨状态 C 绑定稳定业务键和服务端行版本 CAS。
- 原文件只提供仓名时保存 `warehouseCode=""` 和 `warehouseIdentityKind=name`，使用显式 `warehouseKey=name:<来源仓名>`；不伪造京东仓库代码。两库存来源按 `jd_sku`、POP流水/店铺商品按 `department_product` 隔离商品命名空间；人工映射携带该类型。
- 真实原簿约37.4MB（主要是媒体），因此文件边界为40MiB、multipart总请求48MiB、标准化JSON仍按后端24MiB拒绝；ZIP仍限制500项/64MiB展开/单项32MiB。实时原表重复A:O与P:AD，仅在每格一致时读取一次，否则拒绝；不是按商品去重。
- 原始额外业务列全部进入 `sourceAttributes: Record<string,string|null>`，只排除源序号，100列/表头100字/值1000字；Excel数字采用 `String` 保留源文本，避免跨语言浮点序列化差异。额外列参与权威指纹，颜色/等级/品类/良残/体积重量/15日销量/原生周转等不能静默丢失。省市原文另存 `sourceProvinceCity` 并在C页显示，不推断区域代码。
- 实时文件无日期列时必须提供实际采集时刻，页面不默认填写当前时点；缺事业部列的快照以显式人工声明补充，批次来源身份保持未核实。安全的原Excel数字型标识仅在非负精确整数且最多15位时转文本，不猜测前导零。
- 读取同时绑定 principal、完整筛选、页码和请求 generation；切换时取消旧请求且阻止迟到响应。写入后回查相同 scope；失败或未知结果不自动重复提交。
- 新账号物流采集、监控与推送均默认关闭；页面不接收或保存密码/Cookie/Token。人工「已调拨」与 ERP 实际建单证据分别展示。
- C仓页通过 `operation=inventory_monitor` 直接展示 Django 按事业部、商品、仓库计算的结果：区域、实物/可用库存、采购/调拨在途、7/30日销量、周转、补货后库存、缺货阈值及资格说明。实时来源日与快照来源日分别显示，任何未知分量显示 `—`。阈值在账号设置按版本维护；当前无真实通知投递，不把开关当成发送成功。

## 验证记录

- `tsx --test tests/jd-logistics-frontend.test.ts tests/django-inventory-service.test.ts`：17项通过，包含四源标准化、店铺商品CSV字面量与启用状态范围、六库存分量、Excel日期序列、重复事件保留、一对多商品关系、编码前导零/安全数字标识、未知库存不转零、跨事业部拒绝、公式/歧义/空集合拒绝、URL恢复、完整额外业务列改变指纹及精确读写准入。
- 只包含受影响 React 页面、Worker 路由、合同、解析器、网关与直接依赖的 TypeScript 检查通过。隔离配置位于忽略目录 `.codex-tmp/jd-logistics-tsconfig.json`。早期测试只读复用依赖junction；按预览入口规则移除该链接后，在本worktree `npm ci` 安装独立依赖，未修改生产依赖。
- 早期整仓 `tsc` 受到其他既有商品类型、工具测试类型问题阻塞；没有为此扩修无关模块，随后以上述精确依赖闭包完成本次检查。
- `git diff --check` 通过。未运行生产构建，未启动、重启、迁移或发布正式系统。
- 已用既有 `tools/preview/launcher.mjs` 在3100启动完整React外壳，后端固定本轮18100/18101，独立SQLite明确 `synthetic-v1`，没有复制生产配置。先验证默认无账号空态，再仅通过本机Django领域服务生成合成四源夹具；页面真实GET经过Worker与Django读取相同隔离库。预览POST继续403，不能据此声称公开文件写入链路已做浏览器验收，也未放宽只读或外网限制。
- IAB2实际验证：ERP/POP/C导航、POP五标签、四源选择、实时采集时刻字段、账号新增全部开关关闭、Dialog的Escape关闭和焦点恢复、C指标与未知行、浏览器返回恢复C范围，原ERP公共筛选与页面保持。截图在 `D:/codex-artifacts/jd-logistics-integration-20261015/`：`pop-empty.jpg`、`account-dialog.jpg`、`logistics-import.jpg`、`logistics-import-full.jpg`、`cwarehouse-monitor.jpg`、`cwarehouse-table.jpg`。C截图是隔离合成夹具，不是真实经营数据。
- 原用户两簿只读完整解析结果：流水2084行、实时121行、快照112行，全部经过当前Python `normalize_rows`，与TS/helper内容哈希相等，`changedKeys=[]`；额外业务列分别保留7/4/10列，仅修改额外属性也改变Python指纹，快照112行省市均保留。原实时日期上下文明确使用合成声明时间供纯解析验证，没有冒充原采集时点，没有写入业务库。
- 主代理新下载的实时样本427行也完整解析、标准化与指纹一致；采集上下文使用已观察的导出查询时点，下载时点另记，不能混用。新文件与原簿证据分开，统计证据 `D:/codex-artifacts/jd-logistics-integration-20261015/original-workbook-contract.json`，不含业务行。
- 主代理新下载的2026-10-14单日分仓快照样本900行也完整解析、标准化与指纹一致，额外业务列10列全部保留，900行省市保留，额外列独立变化会改变指纹。该文件未提供事业部列，纯解析验证使用主代理前置页面读回的事业部声明，不能把文件本身说成已提供事业部身份证明。
- 店铺商品真实新导出为GB18030 CSV，906行、13个中文表头，全部状态为启用；新文件完整解析、Python标准化和TS/Python指纹一致，`changedKeys=[]`。缺平台906行保持 `platform=""`，缺事业部商品编码10行保持空编码并独立保存ESG关系，不拿平台SKU或ESG冒充事业部编码；映射页面优先使用服务端 `sourceRelationKey`，`mappingAllowed=false` 时禁编辑。证据 `D:/codex-artifacts/jd-logistics-integration-20261015/shop-products-csv-contract.json`。
- source4 v1统一为“事业部启用商品关系全集”，手工和工作流同域同范围；顶层 `productStatus` 映射真实商品状态，缺失、停用或混合状态拒绝，不能用all-status人工文件覆盖enabled工作流。source4 CSV按13列表头、8MiB/20,000行受控解析，严格UTF-8（含BOM）或GB18030解码；引号、列数、公式型文本均验证，编码字面量从不数值化。真实导出在闭引号后带尾部制表符，仅允许闭引号与分隔符间的水平空白；其他错位内容拒绝。六个未映射业务列进入 `sourceAttributes`，改变其中一列会改变指纹。
- 日期精度独审增量：Excel数值日期的SSF小数秒归一至6位微秒，保留秒/日期进位。`.123`与`.987`两个事件完整指纹不同，且各自与Python标准化指纹相同；同值文本时间与数值时间一致。证据 `D:/codex-artifacts/jd-logistics-integration-20261015/excel-fraction-contract.json`。只重验受影响的日期/CSV解析及类型闭包，没有重跑全量PG。
- 窄HTTP写链路验证：忽略目录Node harness在回环18190载入当前真实 `route.ts`，仅注入本轮预览绑定和开发Host上下文，实际执行 `PATCH登记合成账号 → POST multipart XLSX → Django18101 → GET Django18100 → 精确批次回读`，再验证GB18030 CSV的同链路，均200。XLSX微秒、CSV字面量、平台未知、缺事业部编码关系和enabled范围均回读一致。harness已关闭，3100的GET/HEAD只读限制保持；这是Node隔离HTTP联调，不冒称浏览器上传或Cloudflare生产运行时验收。证据 `D:/codex-artifacts/jd-logistics-integration-20261015/public-route-http.json`。
- 最后真实流水类型增量：新试采流水是GB18030 CSV，真实30列表头与原流水XLSX同构；共享入口现仅允许 `flow` 和 `shop_products` 两类CSV，实时/快照仍严格XLSX。流水数量列允许合法负整数字面量并进入原库存整数合同；其余公式型文本继续拒绝，事件不去重。UI文件accept与格式说明同步。新流水122行完整解析、Python标准化与指纹一致，`changedKeys=[]`，7个额外源业务列保留并影响指纹，证据 `D:/codex-artifacts/jd-logistics-integration-20261015/flow-csv-contract.json`。本增量仅跑当前解析测试10项、受影响类型检查和diff检查，复用此前有效网关/PG/HTTP证据，未重跑全源或PG。
- 四类真实新下载文件已分别通过纯解析/标准化/指纹核对：流水CSV122行、店铺商品CSV906行、实时库存XLSX427行、库存快照XLSX900行。统一无业务行统计 `D:/codex-artifacts/jd-logistics-integration-20261015/four-source-contract-summary.json`。这证明文件合同与规范化等价，不代表生产导入或自动化已启用。

## 单品矩阵增量验证

- C仓宿主请求 `inventory_monitor&layout=product&salesWindow=7|30`，查询身份同时包括principal、事业部、仓库、搜索、产品页码与销量窗口，保留AbortController/generation。后端先分组商品再分页；横向列和当前范围总计来自完整有界scope，前端没有重新汇总、平均、补零或拼全国。
- 新纯展示组件 `app/jd-logistics-product-matrix.tsx` 定义唯一TS响应合同及严格解码：校验指标number/null、动态来源列身份、cells归属、产品分页和明细完整性。未知来源单列为明确仓库，缺单元格显示“暂无该范围来源”；图片无源则用已有货品占位图标。
- 产品行显示可用、采购/调拨在途、窗口销量、可售天数与风险；展开显示完整分仓13指标、实时/快照/销量截至日期、京东原生30周转及中文资格说明。原生周转仅单仓显示，汇总保留null；详情超限时显式提醒不完整。7/30影响服务端窗口可售天数，缺货风险另用固定30日可用库存可售天数。
- 顶部保留真实事业部库存池和仓库筛选，无未经核验的店铺归属、固定七城、15日或建议补货假控件。矩阵及嵌套详情显式关闭全局当前页列筛选增强，避免临时页选项冒全量。
- 仅用户切换不同ERP/POP/C来源时jdPage置1并push，活跃来源重复点击不改URL；POP子tab切换同步自身页码1并push。浏览器back仍从原历史恢复旧页，避免共享jdPage从流水高页串到单品低页。
- `tests/jd-logistics-product-matrix.test.tsx` 4项SSR/响应合同测试通过：使用服务端总计而不加当前页cells、动态未知仓不合并、不抄图片/城市、展开原生指标与来源日期、部分详情提示、缺失/重复/外部列拒绝及中文理由。受影响TypeScript检查通过。
- 私有预览新增 `synthetic-matrix-dept`（“单品矩阵 · 合成库存池 · SYNTHETIC-MATRIX”）四源夹具，只有合成事实。真实公开Worker→隔离Django读取验证：3单品、4来源列、首单品4仓完整展开，两无省市仓分别列；7/30服务端天数不同；零销量仍保留已知补货后库存；原生周转只在details显示。统计 `D:/codex-artifacts/jd-logistics-integration-20261015/product-matrix-contract.json`。父代理负责最终完整React浏览器展开/切窗口截图。
- 父代理构建发现XLSX默认导出在Vite ESM不存在：已改namespace import，named SSF优先，Node CJS仅通过Reflect读取default.SSF；保留所有微秒逻辑。修复后解析10项＋矩阵4项、日期微秒TS/Python哈希针对复验、受影响tsc与diff检查通过。原失败构建日志保留，最终构建由父代理从冻结代码重做；本说明不冒称构建已成功。
- 最后缺货P1增量新增 `stockoutAvailableDays30d` 及独立指标资格，后端固定按可用库存/30日销量×30计算；DTO/decoder的仓详情、单品汇总、来源格和完整范围总计均要求该第13指标。健康title、展开“缺货依据（30日可售）”、KPI和账号阈值文案明确新口径，既有现货30日周转/京东原生周转保持分列。SSR反例保留现有5、可用0、调拨在途5、30日销量2：现货周转75与缺货依据0同时可见，不互相覆盖。现有notification布尔、options渠道元信息和折叠限制说明未改。
- 同轮只做两处易读性调整：筛选说明改为“按来源省市或仓库展示；店铺归属未确认的商品不自动分配店铺”；采集时刻在C仓局部按Asia/Shanghai显示到秒，原始含微秒时刻保留title，业务日和快照日不变。现有通用格式器不提供该精度，未改其他模块格式器。leaf lint为0错误/0警告，受影响类型及矩阵4项通过；解析10项结果复用，本增量未构建或重跑PG/全源。
