# 正式只读 UI 补充验收独立闭合

2026-10-10 09:03:46 UTC。精确补充 `0bcad05b44a127e63bb0c38ad16046d282eb529e47cf0c7d9022fac248f6cac2` 的实际只读 UI 验收已闭合；**整批 AB 尚未闭合**。机器记录见 [INDEPENDENT_UI_SUPPLEMENT_CLOSEOUT.json](INDEPENDENT_UI_SUPPLEMENT_CLOSEOUT.json)，SHA `8e4d734dd8f590f80e13fd3c4f629f8dbc9ae00093b82fae7f29643a27f622ca`。

人工补充批准为 `08:41:31.000Z`、user item `01a124f9-78a0-75b3-bd46-c484e6734b12`，其 canonical SHA 与 supplement-approval 原回执绑定相等，原 AB 批准时间仍为 `05:28:51.000Z`。补充manifest核心canonical SHA、22个封存文件、UI `2ae444e2...`、helper `5055f2d5...` 均精确通过；原authority bytes未改。replacement command由原只读op加新精确脚本及依赖重建，SHA `3475d704d981879f00f3ea474e7f4876b280e83028de3c54f89212b102b38454` 与 started/result相等。

实际WAL序号经原文件纠正：000047为admission，000048为 `09:00:24.108Z` started，hash `abf7851eb4567b7785b642f763cae58d52940dbb13157747d8e5675dc85c1123`；000049为 `09:00:42.362Z` passed，hash `c6271487b9139e053ef4d5b66cc0cb832be5b40624273d6e5e93593259771d7d`。新intent/started/result全部绑定该parent started及原failed节点b68；passed的reason明确为 `explicitly-approved-readonly-validation-supplement`。原始回执SHA `43ff5b59a51018c7aa5019de6c38e88b400877ff6e048144c3ac46115feb9772` 包含文件末尾LF，WAL绑定解析对象canonical SHA `96e54223093ac54fc4f7d3bfd04c5bcedef36975ec4e7c7bfa156ba230498c75`；两者均独立计算一致。

实际新UI的四项cases全部passed：三个日期取消、搜索取消后清空恢复、当前店铺客服行及只读详情、商品四视口返回与键盘。新audit 86次请求全部GET，productionWrites及attemptedBusinessWrites均0，dangerous/failures/missing均空；原audit与result raw SHA分别为 `38614752cb4cdb3d5ab01bd4c86dd7d309be90422d58c8544f28d6a009864a81` / `3a4e23a890c8f20563021d8dd42e364876a14d756f9bcdb2bf24251822016338`，与补充回执相等。子进程65300 exit0、stderr0字节，完整processEvidence与WAL相等。父操作18.254秒包括子进程15.939秒，不重复累加。

旧WAL前45节点完整保留，原UI仍3次started、3次unknown、3次协调failed、零原passed；新补充只新增一次started/pass，回执明确 originalAttemptSucceeded=false。前九步全部仍各只有一次started及passed，未重放Backup、Restore、维护、切换、启动或资源检查。此快照53节点的canonical原字节及完整hash链通过，active仍AB9；第11步已出现一次passed，12–21在抓取时未开始。本记录不替代这些后续操作的独立验收，状态可能在快照之后推进。

当前worker元数据仍AB `20261010T014638Z-97833d2f2b7e7bc9` / manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113`，candidate-handoff源码提交 `5faac8151f59d66de72c3caead8cad916ea547da`；实际Django deployment原字节仍 `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`。C未采用。此次reviewer只读小回执/元数据和22个补充文件，没有运行Status/UI、生命周期、Backup/Restore、Install、外发或全制品/全库扫描。GET/零写审计限于此受审浏览器流程，不能外推所有生产参与者或全部OS效果。
