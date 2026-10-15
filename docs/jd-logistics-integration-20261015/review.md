# 京东物流集成独立关键复审

日期：2026-10-15。审查工作树：`codex/jd-logistics-integration`。收尾时工作区基线为 `acf5a417`，本报告审查其上的本任务修改和新增文件；最终交付提交由集成主代理绑定。请求角色为 critical-review、模型 `gpt-6.1-sol`、强度 xhigh，工具未返回可独立确认的底层型号回执。

## 结论

本次候选源码及直接受影响的隔离验证通过，未保留已证实、尚未修复的本任务P1/P2。范围包括四源导入、POP核对、C仓单品矩阵、默认关闭的缺货通知、A/B/C/D/helper及必要运行权限和备份清单。最终59项PG之后新增的参考图业务反例另以6项增量验证及审查者7个独立纯函数反例闭合，没有重跑旧套件或把计数合称一次65项全套。

用户已明确选择“按可用库存可售天数”。缺货阈值最终采用固定30日可用库存可售天数，独立于现有库存周转、京东原生周转和UI的7/30日显示窗口。可用0、现有5、调拨在途5、30日销售出库2的反例现在判定缺货；在途和非可用库存不会把该风险变为健康。

此结论不等于生产全链路已经运行。真实四源文件已手工取得并完成跨语言规范化核验；当前受控采集器的四源串行自动正向、生产业务导入、组件部署和真实钉钉发送尚未执行。n8n已保存新的 inactive 草稿，尚未发布、激活或执行。

## 审查范围与方式

先读取共享记忆启动协议、工作树规范和作者证据，再独立阅读源码、构造反例及执行定向验证。最终范围采用用户后续明确的四源、C仓页面及单品矩阵、专用群通知，覆盖早先较窄的范围说明。

- Django：`jd_logistics.py`、通知模块、模型、视图、URL、`0012/0013`、health与通用数据集排除清单。
- Worker与React：真实principal及reader/writer路由、multipart文件解析、现有系统壳内的POP/C仓页、完整范围矩阵、子页/分页/请求竞争。
- 自动化：四源真实导出适配、policy/manifest/pipeline、原helper execution owner、共享Chromium锁、A/B/C/D与n8n模板。
- 运行闭包：最小数据库授权、PrepareApp通知配置复制、备份及维护证据条件清单。

审查者未修改作者实现，只写本报告；未操作生产端口、浏览器或真实外发。没有扩大修复已知的无关维护测试问题。通知审查使用了 [dws 技能](C:/Users/86137/.agents/skills/dws/SKILL.md) 的能力边界，未调用发送命令。

## 已闭合的关键问题

| 触发条件及实际影响 | 最终核对结果 |
| --- | --- |
| 旧下载任务仅因状态/数量改变就被认作新任务；任意下载候选可能串到旧任务或其他事业部 | 流水采用已观察的本次直出CSV回执，不运行未验证的旧任务中心fallback；商品采用本次taskId及两次下载RPC的ID/path/URL绑定；JH采用稳定ID、不可变元数据、提交窗口与baseline锚点。分页截断、多候选、旧ID和异origin拒绝。 |
| 源页残留筛选使子集被声明为完整范围，导入时会删掉原范围的真实行 | 新鲜query与export请求、源页范围读回及query/task/file行数共同核验。店铺商品明确是启用关系全集，status进入计划、证据和批次合同。 |
| TS/Python时间精度不同，或Excel数值日期丢小数秒；未映射业务列丢失造成假duplicate | 文本和Excel数值时间统一六位微秒并处理进位，Python拒绝更高精度；按Unicode码点排序。源额外业务列以有界文本属性完整纳hash，合法重复事件保留多重次数，排除展示序号。 |
| 官方商品CSV缺平台/事业部商品编码，空编码关系被错误合并或借其他编码补造 | 平台及缺失商品编码保持未知；906条启用关系含10条未关联商品，按真实关系键独立保留并禁止人工商品映射，不跨`department_product/jd_sku`命名空间。 |
| 正常实时T与快照T-1无法配对；ERP待映射、零销量或缺7日销量一票否决所有指标 | T/T与T/T-1分别有日期证据；补货后库存只依赖当日实时可用与两类在途，系统30日周转只依赖自身现货及正30日销量。ERP待核对单独披露，缺失分量不回退、不填零。 |
| C仓历史/其他来源占满候选上限；当前仓页拼成商品矩阵导致漏仓、漏列及错误汇总 | SQL先限定两库存源各事业部最新日再应用上限；服务端完整筛选范围按事业部+JD SKU聚合后分页。未知成员不稀释总数，先合计数量和需求再算天数，不平均天数。源省市缺失时独立仓列，不猜城市；原生30天周转仅单仓明细展示。 |
| 切换子页串用原页码，或全局列增强器根据当前页生成假全量选项 | 子页入口重置自身页码，同模式点击不改写状态；历史返回保留原URL。矩阵与详情显式退出不适用的全局列过滤增强。 |
| 通知将其他事业部混入、一个零销量商品阻断整BU，或把未知覆盖当无风险 | 内部事业部集合精确筛选；按today与固定30日可用可售指标自身资格生成完整已知风险，未知/缺来源覆盖另行披露。缺现有库存或补货后分量不阻断该已知风险；缺可用、缺/零销量保持未知，无风险但覆盖未知不能返回真empty。 |
| 现有5、可用0、调拨在途5、30日销售出库2，以现有库存周转75天判断会漏报当前缺货 | 新`stockoutAvailableDays30d=可用÷30日销售出库×30`及自身qualification，单仓、矩阵汇总与通知均采用它；矩阵仍先合计数量及需求。7/30切换不改变风险基准，原`turnoverDays`与`nativeTurnover30d`各自保留。通知风险摘要和消息纳新依据，RULE_VERSION升v2且configDigest包含规则版，旧计划不能静默承用新语义；原业务日/重叠BU的unknown防重栅栏保持。 |
| 弱ok回执、递归metadata或截断目录可能冒充动态目标和发送成功 | 仅接受明确成功的typed群目录、完整分页、唯一精确群名及该群内唯一机器人；要求真实整数status=1及robotCode。最终成功采用安装版本1.0.57的根`im.batch-write.v1`、精确`succeeded[].target`及1/1/0计数，拒绝dry-run/partial/弱ok；最终增量还拒绝根unknownCount/unknown/complete否定信号与succeeded内显式失败/未知或下层success:false/error。 |
| 原`lock_active_authority()`只读取不加锁，最终目标复验期间写入权可能被切走；直接行锁又会超出现有writer权限 | 新通知专用authority行锁先于revision/ledger，最终preflight后再次校验原process/epoch/cutover。仅授予`UPDATE(updated_at)`以支持PG行锁；状态、epoch、cutover等继续禁写。授权脚本先撤销旧列权限，health动态证明精确列集合并拒绝全表或额外列UPDATE。 |
| 发送前状态未提交，或结果未知后换run/原SHA重发；C完成被当成通知完成 | 独立账本先持久提交sending，外部边界前由另一连接可见；业务日+重叠事业部的sending/unknown栅栏不依赖run或原文件。C只到verified，D先落notifying再POST；网络未知、坏ledger及未投递结果不重POST。sent/duplicate须精确deliveryId独立GET回查。 |

通知成功回执形态已对照官方 [v1.0.57 batch_write.go](https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/v1.0.57/internal/shortcut/chat/batch_write.go) 与 [unified_send.go](https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/v1.0.57/internal/shortcut/chat/unified_send.go)，没有根据旧替身猜测字段。行锁的最小列权限依据 [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html)，并以实际数据库角色验证。

## 验证证据

以下明确区分审查者独立执行与复用作者的增量证据；通过的旧范围没有因新增通知再次整套重跑。

| 验证 | 结果与归属 |
| --- | --- |
| 四源parser/exporter/pipeline/workflow定向 | 审查者独立46/46通过，75.04秒。包含原CSV字节、完整范围、批次当前选择、合法重复、任务错配及未知提交不重发。 |
| C仓依赖与矩阵 | 审查者独立7个矩阵断言及4个SSR/decoder测试通过；复核全scope先聚合后分页、零需求与未知分量、跨BU及原生指标分离。最终缺货依据另独立运行7个纯函数反例：两个显示窗口均判可用0缺货、缺onHand不阻、缺available未知、缺在途不阻、零需求未知、缺7日销量不改变固定30日风险；现有库存周转75及原生值保持。该独立验证显式禁止数据库连接，外部调用0。 |
| 通知D及直接受影响的owner/路由/模板 | 审查者独立14/14通过，126.44秒；覆盖关闭/缺配置零POST、未完成C拒绝、sent/duplicate回查、响应丢失、错ledger、撤销、未知覆盖和POST未投递。 |
| 原四源私有PostgreSQL | 审查者独立37项通过，证据`.runtime/jd-logistics-pg-2609b35cdf8dcae3`；原子范围替换、并发一胜一409、人工CAS、命名空间和最小权限。该集群已停止。 |
| 矩阵真实签名GET | 复读后端41项成功证据`.runtime/jd-logistics-pg-0833763c51ca0991`，含product/7日窗口/单品分页及完整汇总回读。 |
| 通知及最终authority增量PostgreSQL | 复读最终59项成功证据`.runtime/jd-logistics-pg-b3ae0a4174b6b48c/{evidence.json,verify.log}`；0011↔0013结构正反、八表零seed、13权限探针。新增前置关闭及已知无风险empty反例，强化未知/执行预览/下层失败回执负例。两个通知竞争仅一次fake send；发送前另一连接看见sending；authority独立UPDATE被55P03锁住；真实SET ROLE writer与production process/epoch/cutover下fakegateway正向sent。证据显式确认writer仅updated_at列UPDATE、无表级UPDATE、reader无任何authority UPDATE；五类关键字段UPDATE拒绝，额外status列授权被health拒绝。随机端口53154，stop=0。真实外发0。 |
| 最终缺货口径v2增量 | 另复读`.runtime/jd-logistics-pg-a04d2c7448ac2501/{evidence.json,verify-stockout-v2.log}`，6/6通过，oldSuiteReplayed=false。包含5/0/5/2反例、缺分量未知、7/30风险不变、矩阵合计4/10×30=12及未知不稀释、rule变更使configDigest变化、缺onHand的真实service/product7/通知fakegateway与ledger/message新依据；过旧日期资格另在该直接纯函数case补验。复用前述迁移/权限/并发证据，随机52641已stop=0，真实外发0。另复读`available-stock-risk-preview.json`：合成预览的领域服务实际回查确认风险0天、系统周转75、原生17.5各自保持，通知仍关闭。 |
| 真实原文件跨语言合同 | 审查者独立完整解析并与Python normalize/hash比对：新流水122、启用商品906、实时427、快照900；原簿流水2084、实时121、快照112，全部一致。未输出或提交业务原行。 |
| 实HTTP与Worker运行时 | 复读`public-route-http.json`：真实公开route在隔离绑定下multipart→Django→精确GET回查200，非浏览器上传。增量`notification-public-route-http.json`：同一真实route的notify关闭结果200/disabled、任意message拒绝400、矩阵200，真实外发尝试0。复读`worker-parser.json`：真实Miniflare/workerd当前parser处理合成GB18030 CSV成功，外部请求/业务写入0。 |
| 真实页面与不可变helper | 复读现有系统壳内POP/C仓/矩阵截图及`product-matrix-contract.json`，不是另建独立站壳；作者实际immutable builder与helper关闭演练通过，业务写入/下载0。受影响tsc与自动化叶子范围lint通过；父此前二次生产build成功，首轮XLSX ESM导入失败证据保留。最终前端5个Link/render-ref问题已最小修复：三个叶子lint为0errors/0warnings、tsc和14项parser/matrix测试通过。审查者核对scope在layoutEffect的commit阶段更新并cleanup为空，原POST闭包比对保留；C页Link禁prefetch且未修饰左键保留原整页导航，避免只改URL而不同步现有壳。最终组合构建由主代理完成，不用此前build替代。 |
| 运行与备份 | 复核八表授权、条件备份/迁移凭据、通知配置进入原PrepareApp完整树；父31项备份及原5项复制闭包检查通过。审查者对最新授权脚本AST检查0错误，最终diff whitespace检查通过。原维护两项无关失败未冒称通过。 |

外部安全摘要位于`D:/codex-artifacts/jd-logistics-integration-20261015/`；隔离PG材料位于本工作树`.runtime/`。原文件、登录状态、签名附件URL及目标真实ID未写入Git。

## 当前采用状态与保留边界

1. **已证明**：真实来源入口和本次文件合同、四源完整样本跨语言一致、领域服务与公开路由隔离联调、真实React矩阵、不可变helper默认关闭路径、通知fakegateway状态/权限/并发合同。
2. **已安装inactive草稿**：官方n8n CLI新建`JdLogisticsDaily2026`，13节点、11连接与冻结模板逐对象一致。总流程23、active17；原22流程的名称、active、节点、连接与settings摘要保持。安全证据`n8n-draft-installed.json`。安装草稿不表示已发布、已激活、已执行或helper已部署。
3. **默认关闭**：来源绑定为空，新能力与事业部开关关闭；独立通知配置固定“测试群聊／志高助手”且enabled=false。页面可计算风险与通知实现已具备，不把notificationAvailable、disabled、duplicate、empty或notified阶段冒称新发送。
4. **尚未执行/证明**：当前受控自动采集器完整真实UI四源串行正向、生产迁移/部署/版本切换、真实业务导入、正式流程启用和实际通知成功。真实群与机器人仅完成父代理只读核验，发送前仍须动态复验。不能由手工下载或替身测试推断上述生产结果。

后续实际采用按对应版本、组件制品和明确授权推进；本次代码审查通过不代替这些事实证据。
