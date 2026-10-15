# 京东入仓监控首次正式发布

用户于2026-10-15明确要求“发布上线”。本任务覆盖此前已审查的京东四源接口、库存监控、商品对照、流水与调拨核对、数据导入归属及手动库存周转周期；不自动导入报表、启用采集或外发消息。

## 实际前驱与范围

正式Worker为`20261015T092526Z-d90afd0d40109cc3`，源码组合`2a8aaef9`，manifest `ab6fb58f599eb905baefeae1c4e7df716f0cb1e3b4f8c66f444d075f7e4fa180`。Django实际源码`84345733`，manifest `d59fbd6a08536aac62045cc0214b600c1b961c229c0f4a834f35ea8cdf57d175`。二者包含未同时反映在同一main提交的已安装修复，不能用整个main直接覆盖。

发布组合从实际Worker的8458个source-snapshot成员出发，精确保留43个既有CRLF文件字节，保留实际Django十个差异路径，再叠加已确认的京东67个功能路径及本轮必要的结构准入工具。`.gitattributes`只声明已有字节的Git保全，不改变这些运行字节。原AI对话、定时报表和市场reader修复保留；组合源码单独保存，不把运行组合倒灌main。

此前“无需迁移”只针对最后一次周期调整；与实际正式前驱比较后确认库存0012、0013、0014从未安装。因此本次首次发布须增加八张京东专表及周期字段/约束，不能仅发布前端。三个迁移均只包含结构操作，无RunPython、RunSQL、seed、数据回填或报表导入。

## 必要兼容

已安装的AI143代准入精确拒绝新增迁移。本轮增加有限JD143→146子协议，三个文件摘要固定，其他全部迁移与冻结143父代保持；继续调用原143/142/140/139父链验证，不放宽原代数或删除原active指针。

新计划绑定实际前驱、候选/准备收据、完整迁移与代码/应用摘要、维护ID及隔离证据。安装先create-only保存intent，单个PostgreSQL事务内确认143、精确三个正向步骤及新增空表，再验证146；未知不重放，reconcile只证明完整已提交146。原库存角色配置在迁移之后、启动之前显式执行，最终校验精确reader/writer权限后才Finalize。正常Start只接受完整146、零pending及已Finalize凭证。

更新日常备份的精确146目录/表结构识别，同时保留旧138–143集合及拒绝未记录JD对象。按照已确认的后续结构迁移政策，本批不新增前后全库备份或隔离恢复，不把结构持久效果伪装为旧v3展示豁免。新范围计划v3不再自动生成已取消的全库备份步骤；旧sealed batch不修改。业务数据处理仍需单独授权。

## 验证与恢复边界

复用此前绑定同一京东功能字节的59项PG事务/权限/导入、6项风险增量、周期/健康和HTML交互证据。本轮只补新增准入工具：11项新定向、10项旧代兼容、10项范围政策测试，PS语法及独立146 PostgreSQL结构/回滚/默认/目录/权限/未知不重放。独立审查与最终制品绑定记录见[review.md](review.md)。

143→146提交后，旧143 Django包会正确拒绝启动；恢复必须使用保留JD146验证器的兼容前向包，不自动删表、逆迁移、重发安装或恢复生产数据库。现场失败保留原intent、owner、维护、原始输出与未知状态，先独立只读核对后再按精确原协议续接。

当前源码状态为发布准备；正式采用结果、版本和时刻仅在真实操作及必要服务确认后填写。所有完整原始证据保存在`D:/codex-artifacts/jd-pop-release-20261015/`，原始业务数据及凭据不入Git。

## 10月16日身份检查修正与原服务恢复

首次调用器未把`SchemaOnly`识别为switch，尚未调用原生SchemaPlan即被拒绝。保留失败及独立零效果观察后，以固定typed PowerShell适配器通过PS5/PS7六项Contract验证，沿原维护/操作身份从Plan续接，不重复Enter/Stop。Plan、DeployApp、HardenAcl成功。

SchemaInstall随后在创建intent之前被数据库身份检查拒绝。原单条错误JSON摘要与重建的identity错误完全一致；真实独立PG确认`inet_server_addr()::text`返回带`/32`的字符串。只读正式观察确认精确143代、无JD对象或迁移、无在途append事务，所有文件准入检查通过，未执行schema追加。

最小运行修正仅把该查询改为`host(inet_server_addr())`，不改变数据库、角色、IPv4地址和5432端口限制。新增真实PG表达式回归及身份正负例；修正组合以原6a6b6dae为底，仅改guard一行与测试/演练。新code摘要`0d3367fb90e8444598032fc1df898daf3f8653d147f4e0469ef937fdadcbafd5`，migration摘要仍`7f2bcb8886666c99c11824e51910df70e8e9cce2318b91ff757f4cb4e4e5dda8`；隔离证明`88cd577ab7b54cace86ca7045689364ade38d37f4a62bbf76b1e581fe0ebb95d`，独立增量审查通过。

为缩短继续维护时间，先用原RollbackApp恢复d59代码。第一次因调用工作目录位于app/tools内，Move-Item被PS provider在首次rename之前拒绝；独立核两包/无holding/控制器同字节后，从runtime之外的source/tools调用同一个原函数成功，继而由旧d90入口恢复原服务。这里是应用代码回退，不是数据库恢复。各原失败、未执行草稿、独立协调及成功阶段分别保留，不能改写为首次成功。

后继发布只新准备Django修正包，原Worker B27计划/前端制品保持；在旧服务恢复后重新绑定实际前驱和新attempt身份，不覆盖原失败plan或原READY。未导入真实报表、启用采集或外发通知。此段只记录已观察阶段，不宣称新京东版本已采用。

## 修正包的独立准入与结构安装

修正组合提交`4aaa472c92e2f1cf10157ad4ba919a792ae8e692`已推送，正式功能及工具修正已合入main `8af156a67169e897a9134b563f9b1ea4fd07e4d6`。只重新准备Django `69557a05121043a28477cbe0eca2c08a`，复用原Worker `20261015T152258Z-3ca63e8b9225fb87`和B27计划，不重复前端构建。新READY摘要`07652295c89ddf80d6a4f15d0b6e49609f5308c7acc0004163636d2f7c99385b`；独立核对28个执行文件、24个实际Django包差异和PS5/PS7六项参数合同通过。

新操作`73540d4d861e4e4ba3914c6fbf5cad5f`在新的KeepPostgres维护身份下执行。10月16日00:48安装三个固定迁移成功，随后原库存ProvisionRoles及SchemaFinalize均通过，正式结构为146代、精确权限已确认，新增京东表为空。原始逐步结果与失败记录分别保存在`D:/codex-artifacts/jd-pop-identity-fix-20261016/`和上一制品目录；原未知不覆盖、不重放。

## 启动协调与BI前向兼容修复

B27前端版本切换成功。00:55和01:00的正常Start遇到既有五分钟周报争用Django mutex，原queued-start fence在启动主体前拒绝。两次分别独立确认原进程退出、服务端口/Worker回执缺席及原mutex可用后，才创建同版本新Start尝试；未改desired-state、门禁、调度、迁移或原失败记录。

01:02的Start已进入主体，库存等服务启动，但BI reader报`permission denied for table inventory_jd_logistics_deliveries`。原函数在30秒就绪失败后停止BI子树，其他已启动服务保留，不能将这次记为零效果。根因是BI原先复用库存健康检查，本次新增JD表/索引随完整库存合同误加入BI，而BI投影实际不消费JD数据。

最小前向修复将BI原库存列和索引合同固定拆出，BI只使用其原依赖；库存reader/writer仍校验全部原JD列和索引，不扩大BI grant，也不删除既有BI/ERP/广东仓/修订/权限门禁。4项合同测试和复用私有146 PG的定向验证通过：BI无JD SELECT仍ready200；原BI列/索引缺失及普通库存reader/writer的JD表/列/索引缺失分别拒绝。私有验证仅替换不变的sales authority validator，其余schema/角色/只读/BI凭证检查走真实PG；此限制在原proof中明确。私有集群已停止，无正式写入。

修复已合并推送main `57e9625df042bc770f9c5b062bdd7cb1ee524ddf`；实际运行组合`2522b9b153ce8a362afd9252eed6111c5fabeb58`以4aaa为底只叠health及定向测试，保持其他运行字节。完整Git差异计划为Django-only、无新migration。既有143归档`daily-20261015T041546Z-e45dddeb5a15`通过原已安装工具的一次只读Verify，无新Backup/Restore；该证明仅说明历史恢复点完整，不能用于146后的143启动或数据库回退。

准备比较拦下一个未运行postinstall的候选：其两处既有运行依赖补丁缺失，未发布，原证据保留。执行原postinstall补齐后，新Django准备`5413a337596f44eab075dbece6cb6f51`有2975个成员，与实际包恰三差异：health、部署元数据和CF缓存六个元数据叶；全部其他字节相同。最终准备与后续采用证据位于`D:/codex-artifacts/jd-bi-readiness-20261016/final/`，READY `e1004eb842b2bbc0aeab83256c714c5ff769505866cc006a17d97ac0673e57b3`。本段只记录准备，不提前声称服务已恢复。

## Helper从未启动时的有限维护恢复

该健康修复包的原EnterMaintenance没有5791 helper可确认排空，失败只留下`779dd3efea0e485aa58aac3acc9e324f`的helpers gate。原DeployApp独立要求正式维护标记，不能用停止PG替代；helpers阶段也尚未关闭普通HTTP。因此没有直接Stop或手工构造维护文件。

最小新增能力在两份源码工具增加成对RecoveryProofPath/SHA，仅允许本次EnterMaintenance+KeepPostgres。固定原READY、146 active、B27、前驱0c4e、prepared5413、原helpers字节、三次Start未到Worker启动阶段及前次受控停止证据；同线程原Worker→Django互斥下，以严格进程/回执/全地址端口缺席证明替代helper HTTP ACK。原备份围栏、background租约、requests推进、activity租约、最后PG/console围栏内复核及原Begin维护构造器保持；create-only intent禁止unknown重放。普通无参数路径仍要求原helper ACK。

一次只读预检发现不可读的旧交互PowerShell。独立核对真实执行模型后，将未知拒绝范围限定到Node/workerd/esbuild原生宿主、已知受控PID及传递子树和可见目标路径；没有按进程年龄加白名单，没有终止或读取无关终端命令。范围外终端只记为未分类，不声称其私人用途已查明。修改后实际只读Snapshot及完整Initial绑定预检通过，均不写生产intent、phase或数据库。

恢复工具提交`849a902732bd70027e8d288612eb6968f7237f3c`已合入并推送main。实际一次性恢复源码为`278415728cdf35df47e13f4eb050192972f84789`，不改冻结的2522源码或5413包，不重建Worker。最终绝对路径下的PS5/PS7新合同测试8.171秒通过，独立另跑同类合同亦通过；含严格JSON、成对参数、多绑定与intent负例、真实字节租约、普通ACK拒绝、完整尾链及最后围栏先于marker。恢复证明摘要`354d0283b7257dd61be6e767a2da732bde0d25250b2ed1c5284a21e2101b1075`、验证摘要`6be80214ec7ec9745c79bf921974fb8459642e9902bdf1dea7dc40cba7bc166c`与八个执行文件及原READY共同独立复核通过，准入仅覆盖一次恢复及随后原Django发布。

## 正式上线结果

2026-10-16 01:57:31（Asia/Shanghai）发布完成。有限恢复经原构造器建立维护并完成原停止流程，原DeployApp切换5413包、HardenAcl、ExitMaintenance、Start及VerifyStartup全部通过；BI恢复就绪，既有配置的AI钉钉接收服务也由原启动流程正常恢复。本次没有启用京东通知渠道或发送京东提醒。

- Worker正式版本：`20261015T152258Z-3ca63e8b9225fb87`，manifest `6eaa16affe9c9bcf60af8e4f0f811614fc239c3c05ba1ecb714382e58c46d932`，原B27只apply一次。
- Django正式manifest：`6a7a23ae50539afb09e10ed2773ae82f843ab45da763cc233f4140373101c5a4`，组合源码2522，功能及健康修复对应main57e9625d；一次性维护恢复工具849a9027/27841572单独保全，未冒称其工具字节已装入5413包。
- 正式结构146，权限已核，最后前向修复没有再次migration、改角色或重apply Worker；没有新全库Backup/Restore。首页200、库存reader8051/writer8052及BI8081 ready200，京东options接口200，当前登记事业部数0。
- 正式入口：`http://127.0.0.1:3000/?module=inventory&view=inbound`，导航为库存管理→京东入仓监控→四个子页。没有启动浏览器或额外预览。
- 未导入真实报表、登记事业部或启用新采集/监控/京东钉钉通知；既有业务配置及渠道由正常启动流程保持，不把发布功能当作业务补数完成。

最终机器回执为`D:/codex-artifacts/jd-bi-readiness-20261016/final/PUBLICATION_RESULT.json`，原失败、unknown、零效果与部分启动记录分别保留。上线后只执行原启动绑定、目标组件与必要服务确认，没有追加无关综合验收。工作树中89个顶层隔离测试证据文件已逐SHA外置保全至首个制品目录`test-run-evidence/`；生成的私有PG数据与pycache不作唯一证据保留。各制品绑定的普通源码工作树保留，不清除仍作为正式制品来源的源码目录。
