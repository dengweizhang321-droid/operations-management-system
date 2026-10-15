# 京东物流后端实现与隔离验证

日期：2026-10-15。工作树 `codex/jd-logistics-integration`。请求角色 complex、模型 `gpt-6.1-sol`、强度 xhigh；工具未提供实际底层型号证明，实际型号未独立确认。本文记录源码候选和隔离验证，不表示生产采用。

## 已实现范围

- 库存域 `GET/POST/PATCH /api/inventory/jd-logistics`，Worker 经真实 principal 与签名访问 reader/writer。读取允许 viewer/analyst/operator/admin 且 unrestricted scope；导入及来源设置仅 admin；商品人工映射、调拨人工状态允许 operator/admin。复用已有写请求回执、权威 epoch/cutover 与库存 revision，读取只绑定本域 revision，不查询不相关的销售缓存。
- 四个来源：`flow`、`shop_products`、`realtime_inventory`、`inventory_snapshot`。新 `0012_jd_logistics` 仅创建七个表及约束/索引，没有业务 seed、回填或数据清洗。新来源、采集、监控、推送默认全关；多个受控账号绑定同一唯一事业部，事实不按账号复制。
- 完整范围导入在稳定“事业部＋sourceKind”锁内完成。采用唯一 owner、scope revision CAS、原子删除/批量插入、行数及业务 hash 回查。重叠日期、按仓与全部仓共用同一基域栅栏。迟到不同内容拒绝 409；当前相同精确范围及完整内容允许返回 duplicate 以协调响应丢失。
- 内容指纹保留规范化业务行及完全相同合法行的多重次数；排除原始行号、排序、文件名等非业务差异。每次 duplicate 独立保留原文件 SHA、批次尝试和 referenceBatchId；空文件、身份不符、不完整和非法字段拒绝，不创建业务批次或范围头，只写拒绝审计。
- 人工商品 C/D 绑定事业部、编码类型及商品；调拨 C 绑定事业部、京东单据及事业部商品。每行独立 revision CAS；人工确认另绑定完整流水与商品映射版本，后续流水或映射改变保留原确认并标 needsReview。所有人工状态均 `erpVerified:false`，不创建或核验 ERP 单据。
- 调拨投影按原工作簿明确业务类型及库存分量识别：内配出库回传、内配出锁定负向实际变动计调出；入库回传、可销售正向实际变动计实收。预占和配对在途不重复计。实收超调出、多仓/多商家单据进入异常；未知调拨类型保留待核对；未取得完整同单历史时始终披露覆盖边界。
- C 仓监控按事业部、JD SKU、来源仓身份对齐两类库存。实时实际采集日 T 允许配对截至 T 或 T-1 的来源快照销量，保留两个日期和 datePairing/sourceDateLagDays/salesAsOfDate；每项指标只由自身依赖决定：来源、日期或对应分量缺失时该指标保留 qualification/未知；ERP映射待补单独披露，不阻断JD SKU来源指标。周转采用现货÷30天销量×30；补货后采用可用＋采购在途＋调拨在途。阈值默认 null，配置后也不触发外发。

## 源身份与字段边界

原第二簿的实时、快照明细仅提供仓名。此类行保留 `warehouseCode:''`、`warehouseIdentityKind:'name'`，服务端用独立 `warehouseKey:'name:'+规范源仓名` 分组和过滤，不把派生 key 冒充来源编码。有来源编码时用 `warehouseIdentityKind:'code'` 及 `code:` 命名空间。没有已核定区域映射时保留原仓、区域未知，不猜分区。

POP 两类来源使用 `goodsCodeKind:'department_product'`；两类库存使用 `goodsCodeKind:'jd_sku'`。相同数字字符串不会跨编码类型共享人工映射。源商家编码、商家标识、库存状态/类型、实际和可用的六个分量、一对多店铺关系均独立保存。

手工文件的事业部声明保持未核实，批次 `sourceBindingVerified:false`。工作流必须提供已登记 storeKey、启用的对应 capability、logisticsEnabled，以及采集器对受控页面的身份读回证据；这仅验证注册绑定和传入观察一致，不能成为独立远端身份或 ERP 证明。实时来源只能标记实际上海采集日，不冒充历史快照。

## 最终接口补充

- 读取 operation：options、settings、overview、flows、transfers、mappings、products、inventory、inventory_monitor、batches。列表默认每页50，最大100；聚合候选最大50,000行；导入最多20,000行、JSON最多24MiB。
- 新 `warehouseKey` 筛选和导入范围与原 warehouseCode 分开；新 `goodsCodeKind` 可用于映射筛选及 PATCH mapping。settings 支持 `stockoutThresholdDays:null|1..3650`，新建事业部的所有能力和开关必须关闭。
- POST 额外接收并保存 collectedAt、sourceAsOf、collectorEvidence（仅 runId/executionId/protocol）；身份观察证据仅接收 observedBusinessUnitCode/observedAt/sourceUrl/storeKey。
- `GET operation=batches&batchId=精确ID` 回查当前同范围事实，返回 `currentSelection:{current,verifiedRowCount,contentHash,scopeRevision}`。普通批次列表不重扫每一批事实。旧已替换批次不能仅靠历史 status 通过验收。
- 七模型在 `backend/system_datasets/manifest.json` 明确排除，不自动暴露通用 AI 表访问。新表读取、写入权限及 readiness 列/索引清单在后端同步；部署工具的授权/备份/恢复清单由集成主代理同步。

## 验证与证据

使用已安装 Django Python 解释器，子进程仅继承系统路径等允许字段。隔离集群位于本工作树 `.runtime/jd-logistics-pg-*`，随机回环端口明确拒绝5432，随机测试凭据仅内存及短暂密码文件，密码文件已删除；所有集群在 finally 正常停止。没有读取生产连接、凭据、业务库或运行配置。

- SQLite 初版19项定向用例通过；后续 PostgreSQL 覆盖导入重复重数、不同 raw hash、所有库存分量指纹、范围变化、重叠移除、空/非法/跨身份拒绝、事务回滚、命名空间隔离、两类库存、人工 CAS 与 evidence 失效、签名/角色/scope/进程角色、批次真实回查、C 监控公式和缺数。
- PostgreSQL 结构验证：0011→0012→0011→0012成功，新七表业务行均为0；未改变旧表集合。真实两连接竞争同基域且相同预期版本，结果一条 imported、一条 version_conflict；仅一份事实、revision为1且 owner为空。
- 最小角色真实探针：reader 能读事实；reader 不能读审计或删除事实；writer 能人工映射；writer 不能 UPDATE 原始事实或 DELETE 审计，共6项。
- 首次 PG 演练发现原库存 `_consistent_read` 带入无关 sales revision 读取，在最小迁移库 GET500；已收窄为 JD 自身前后 revision 栅栏。首次失败保留于 `.runtime/jd-logistics-pg-170c27606e6e02e5/verify.log`，该集群已停止，未改写失败记录。
- 最近成功证据及测试总数见本文末尾。`makemigrations inventory --check --dry-run` 无差异，定向 diff whitespace 检查通过。
- 附带尝试一次既有 `system_datasets` 全模型覆盖测试，因其他领域44个旧模型未登记失败；本次七模型均已显式登记排除，相关定向断言通过。此问题没有扩入本需求修复，也未运行全仓测试。

未执行：生产导入、生产结构迁移、服务重启、部署、n8n 激活、ERP调用或真实外发。代码提交由集成主代理统一完成。

最终定向 PostgreSQL 28项全部通过，迁移正反、并发及6项权限探针通过。证据 `.runtime/jd-logistics-pg-6d221b9e1b4c3dbc/evidence.json`、`verify.log`，随机回环端口61625，stop返回0且已停止。该轮覆盖最终 name/code 仓库身份、department_product/jd_sku 编码隔离、原库存商家标识字段及映射变更后的人工状态复核。此前成功证据保留，不覆盖首次失败。

## 独立审查后的必要增量

独立审查实证原来“实时日必须等于快照日”的条件会拒绝官方常规 T/T-1 链路，已修正为上述明确配对政策。实时行日必须符合 collectedAt 的上海自然日，快照 sourceAsOf 必须符合来源行日，且快照业务日不能晚于其实际采集日；更旧、未来或元数据矛盾仍拒绝跨源天数计算；实时来源自身完整时仍可显示实时数量和补货后库存。新增正常 T/T-1、同日、过旧、缺源、未来及采集/截止日矛盾反例，日期分别展示，不把 T-1 销量称为 T 当日销量。

审查同时证明若丢弃非 typed 业务列，颜色、商品等级、品类、良残库存、体积、重量、日销、15日销或原生周转的变化会被误判 duplicate。现四源增加 `sourceAttributes`：最多100个规范原表头键，键最多100字符，值严格为最多1000字符的源文本或 null，排除展示序号，不接受嵌套、数字/布尔类型或清理后重名。所有该对象业务值进入完整指纹；体积、重量等源值保留文本，避免浮点跨语言序列化差异，不冒充系统派生指标。快照 `省市` 另存 sourceProvinceCity 并从快照投影到 C 页面，保持源原文，不推断区域编码或大区。

时间合同最多6位微秒，Python明确拒绝更高精度而不静默截断；TS时间规范及键码点排序由对应执行者同步。该增量只改变 JSON 规范和查询逻辑，没有新增 schema。

增量定向 PostgreSQL **34项全部通过**，并复用私有演练验证结构正反、同基域并发及6项最小权限探针。最新证据 `.runtime/jd-logistics-pg-e668a4b5143e7fec/evidence.json`、`verify.log`，随机回环端口51217，stop返回0且已停止。旧28项成功及首次失败材料均保留，未执行其他领域全量验证或生产动作。


## 单品矩阵与逐指标口径

用户新增参考单品矩阵后，`GET operation=inventory_monitor&layout=product&salesWindow=7|30` 由库存服务端在完整当前筛选范围先按“事业部＋JD SKU”汇总、稳定排序，再做单品分页。每个单品含 summary、源省市/独立仓 cells、全部分仓 details 与真实 detailCount；列从完整当前范围生成，不从当前仓页推导。省市使用源原文，缺少省市的仓单独作为来源仓列，不猜七大区。单品图、价格没有已验证来源，保持 null。

完整 MetricSet 包含现货、可用、锁定、采购在途、调拨在途、补货后库存、7/30日销量、系统周转、所选窗口可售天数、补货后可售天数、京东原生30天周转，始终补齐 number/null，并逐指标给 metricQualifications。系统周转=现货÷30日销量×30；可售天数=可用÷所选窗口销量×7或30；补货后可售天数使用补货后库存作分子。京东原生值只严格解析 sourceAttributes 中 `30天周转` 的有限数值文本，在分仓详情显示，所有汇总保持 null 并说明不可加总，不求平均。

ERP映射、缺少7日销量、30日销量为0或缺少快照均不会抹去可算的实时补货后库存；该库存只要求实际采集日与可用＋两类在途分量。30日系统周转不依赖7日销量或ERP标签；阈值提醒在后续v2增量独立改用固定30日可用库存可售天数，系统周转定义保持不变。各指标分开保留未知，绝不回退其他日期或快照中的实时分量。

矩阵 summary、cells、当前范围 totals 逐分量验证全部成员，任何成员对应数量未知时合计未知，不把已知子集当全范围。已知0销量按0参与组需求，组正需求可计算，不因单仓零需求抹掉整组。各仓数量与窗口需求先分别合计后相除，不平均各仓天数。跨事业部来源时期不一致时保留来源日期集合；完整数量可合计并披露，但合计天数返回 null/period_mismatch，不称全国同日库存。

边界：完整当前事实候选最多50,000行；超过200列拒绝并要求缩小范围，不截列；单产品超过200仓时 detailsComplete=false、detailsTruncated=true，detailCount与所有 summary/cells 仍使用完整成员；每响应展开详情超过5,000行失败关闭并提示减小单品页。请求布局、销量窗口、范围共同进入只读请求身份，沿库存 revision 保证一致性；未新增迁移、图片抓取、价格推测、店铺关系猜测或外发。

本增量增加逐指标依赖反例和三类汇总反例：跨页产品仍完整及全范围列一致；未知分量不稀释范围总数；分仓两日期、已知零需求与原生周转不平均。保留父代理加入的真实店铺CSV状态/空平台/未链接ESG关系隔离，以及SQL先取最新来源日再应用候选上限的修复。

最终本模块 **41项 PostgreSQL 定向测试全部通过**，其中包含真实签名 HTTP GET 的 product 布局、7日窗口及完整单品汇总回读，未知布局/窗口请求拒绝。最新证据 `.runtime/jd-logistics-pg-0833763c51ca0991/evidence.json`、`verify.log`，随机端口56926，私有集群 stop 返回0；结构正反、并发一胜一409及6项权限探针仍通过。`makemigrations inventory --check --dry-run` 无差异，差异空白检查通过。未重跑其他业务域全量检查，没有新增数据结构。

41项验证截点的提醒边界：当时只有事业部阈值与页面风险提示，真实通知投递未实现；该截点的 notificationAvailable=false 及未发送事实保留。用户随后明确群目标并授权补通知源码，最新范围和验证见下一节；源码实现、正式启用与真实投递分别判断。


## 受控通知源码补齐（默认关闭，未真实外发）

用户明确目标为“测试群聊”，机器人“志高助手”。新增独立 `config/jd-logistics-notifications.json`，version=1、enabled=false；不复用旧备货群目标或开关。通知复用现有 DwsCli 的受控 profile、进程与凭据路径，但只读取该已配置 profile，独立于旧备货同步 enabled/Base/table/fields，未复制密码、Token或Webhook。

新增 `0013_jd_logistics_notifications` 只创建 `inventory_jd_logistics_deliveries` 及状态约束/索引，没有业务 seed。新模型已明确排除通用 AI 表访问，并进入 reader/writer readiness、精确最小权限、备份与恢复清单（工具清单由父代理维护）。

合同：管理员且 unrestricted 的 POST `operation=notify` 只接受 departmentIds 及可选完整工作流身份组 runId/executionId/protocol/planHash/verifiedBatches，不接受任意正文、群、机器人或客户端风险清单。工作流元数据必须整体提供；每个声明批次的事业部/来源/原文件Hash/业务Hash/当前选用状态/版本均从数据库回查，并要求每个事业部两类库存齐全。元数据只作已验证业务绑定和审计，不把客户端 runId 当作独立 n8n 执行证明；手工请求不接受零散 verified 声明。

全局渠道 enabled=true 且所请求事业部 logisticsEnabled/monitorEnabled/pushEnabled 全开、有阈值后，服务端在完整受控 scope 独立重算实际上海当日库存及 T/T-1 销售出库件数，按固定30日可用库存可售天数筛已知缺货项（v2，见下节）。页面“销量”明确为京东销售出库件数，不是店铺成交订单数。零销/未知项、缺现货或缺补货后分量不抹掉其他已知可用库存风险；消息写明已知风险总数、展示条数和未核实覆盖。最多展示50条且消息有字符上限，完整风险、来源、阈值和范围均绑定持久摘要，不悄悄遗漏全量风险身份。若已知风险为0但有未知覆盖，返回 not_configured/partial_coverage_no_known_risk；empty只表示当前完整可判范围没有已知风险。

投递状态明确区分 disabled、not_configured、empty、sent、duplicate、unknown。GET `operation=notifications&deliveryId=精确ID` 仅管理员返回脱敏 ledger，包含完整 departmentIds、riskCount/unknownCount/coverage、source/scope/config/target/message/receipt 摘要；不返回原群ID、profile身份或原始外部回执。notificationAvailable 表示实现且静态全局配置开启，不证明外网预检已成功；notification.implemented=true 与 enabled 分开。本候选依然全局关闭，正式自动化和真实投递未执行。

幂等身份绑定规范来源业务内容、完整风险、业务范围/上海日、阈值语义和动态目标摘要；原文件Hash、尝试batchId、runId和纯revision变化不产生新的业务通知身份。相同业务内容换文件或改事业部展示名仍 duplicate。另有独立的“事业部＋上海业务日” sending/unknown 栅栏，防止换消息Hash、开关翻转、目标/来源变化绕过未知结果重发。unknown只能等待证据协调，不能自动重送。

发送顺序：先在原 authority/revision 事务内创建并提交 sending，再开启最终事务，按 authority→revision→ledger 的统一顺序持锁，续验来源/设置/配置/owner及动态群/机器人后才调用复用 sender。新通知专用 helper 对原 authority 行作真实 SELECT FOR UPDATE；仅给writer非权威列 updated_at 的 UPDATE 权限以允许PG行锁，表级UPDATE和status/epoch/cutover等关键列仍禁止，reader没有任何列UPDATE。readiness 精确校验更新列集合必须只有 updated_at，额外关键列或表级UPDATE均拒绝；原备货流程和公共authority helper没有放宽。

动态预检只使用已观测的成功 envelope：result.groups/hasMore 和 result.bots。群搜索必须完整分页并精确唯一；群内所有同名机器人先判唯一，再要求非空 robotCode 和真实整数 status=1，拒bool/string/只靠名称、creator或manageable。metadata/error中的同名对象不能充当目标证据。受控profile改变、设置/来源改变、owner失效、authority撤销或共同期限过期均在调用外发前拒绝。

回执基于安装版本1.0.57对应的官方 [batch_write.go](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/v1.0.57/internal/shortcut/chat/batch_write.go) 与 [unified_send.go](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/v1.0.57/internal/shortcut/chat/unified_send.go) 核验：`--groups` 返回根 im.batch-write.v1，包含 ok=true、partial=false、计数1/1/0、succeeded数组中唯一 target 精确等于本次群、failures空；没有旧测试猜测的 results/status 形态。根输出路径经 runner.Output→WriteCommandPayload 直接输出map，DwsCli.run不解包。拒绝弱ok、预览、executed=false、partial、unknown、错目标以及下层显式失败；进入外发后的任何异常一律 unknown，不自动重发。仅保存回执SHA，不保存外部原始回执。

最终隔离证据：`.runtime/jd-logistics-pg-b3ae0a4174b6b48c/evidence.json`、`verify.log`，**59项定向测试全部通过**；0011↔0013结构正反和零业务seed、13项权限探针通过；真 SET ROLE inventory_writer 路径的假网关通知成功，writer授权列精确为 updated_at、表UPDATE=false、reader列UPDATE=false；故意授status列后 readiness 拒绝。双连接在最终预检期间尝试 authority 更新实际返回55P03，authority保持active；同连接模拟预检后撤销则零sender调用。两通知竞争只有一次假发送，另一调用观察sending返回unknown，独立连接已在假外发前看见durable sending；未知业务日栅栏防新payload重发。随机53154集群已stop0，真实外发0、生产操作0。首次通知演练中的“必须返回duplicate”的过强并发断言失败保留于 `.runtime/jd-logistics-pg-fee5e261a689700a/verify.log`，其56项逻辑测试均过；合法并发也可能在第一请求sending时返回unknown，因此已以“一次调用、持久sending、其余不重发”实证断言修正，没有改写旧失败。

本轮仅对 dws leaf Schema/help 和官方同版本代码作只读核验，未执行真实 send 或干跑发送命令。父代理已有目标profile下群/机器人只读唯一核验证据，但假网关和协议测试不能代替未来正式发送回执；本轮默认关闭、不自动启用或部署。


## 缺货提醒 v2：独立固定30日可用库存口径

参考图与独立反例确认：现货5、可用0、调拨在途5、30日销售出库2时，系统现货周转75天不应掩盖当前可用库存已为0。新增独立指标 `stockoutAvailableDays30d = availableQuantity / sales30dQuantity × 30`，及同名 metricQualifications；它在分仓、单品summary、矩阵cells和范围totals全部返回 number/null。系统 `turnoverDays` 仍是现货÷30日出库×30，京东 `nativeTurnover30d` 仍是原生单仓来源值，两者均未被改名或替代。

阈值状态和通知已改只依赖 stockoutAvailableDays30d，固定30日，不随页面7/30日显示窗口切换。现货字段缺失不阻断可用库存风险；available、30日销售出库或对应日期依据缺失，以及30日销量不大于0时，新指标为未知。汇总先合计完整成员的可用库存与30日需求，再计算天数，不平均仓天数，不把未知成员算0。调拨在途仍仅影响原补货后库存，不会缓解当前可用为0的缺货判断。

通知知情集合、risk_snapshot、正文及业务摘要均绑定新指标，规则版本升级 `jd-stockout-notification-v2`。notification_policy.configDigest 同时绑定独立配置与 RULE_VERSION，使自动化A阶段冻结算法语义，不能把旧算法计划默默用于新阈值口径。同事业部＋上海业务日 sending/unknown 栅栏完全保留，规则变化不授权未知投递重发。专用配置仍 enabled=false。

本增量只运行 **6项直接业务测试**：5/0/5/2→固定30日可用0并风险、缺现货仍风险、缺可用/销量/日期依赖与零销量未知、7/30切换不变、按数量/需求汇总，以及假发送正文新指标与固定目标和v2摘要。证据 `.runtime/jd-logistics-pg-a04d2c7448ac2501/verify-stockout-v2.log`、`evidence.json`，随机52641集群stop0；真实外发0、生产操作0。为运行测试只在全新隔离库安装既有0013结构，没有新增迁移，未重跑原59项、权限或迁移正反演练；这些已通过证据直接复用。源码语法与定向差异空白检查通过。
