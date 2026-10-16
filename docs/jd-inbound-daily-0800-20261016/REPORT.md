# 京东入仓每日08:00采集

## 范围与当前状态

已上线并启用原 n8n `JdLogisticsDaily2026`，北京时间每天08:00执行。今天的完整手动执行9627已成功完成四源下载、正常幂等导入、独立精确回查、D正常disabled及资源释放；下一次名义定时为2026-10-17 08:00。实际发布版本`196ba27b-2207-4ad1-ad5c-af7d0f597048`，active=true，发布图与当前声明图一致，原22个其他工作流定义及启停状态未改。

本轮仅接入志高商用设备旗舰店账号（`jd-yiyong-director`）。志高商用厨电旗舰店独立，待用户确认设备店数据后另行提供账号；切肉机、洗碗机等未加入京东入仓采集。正式库存监控API及实际前端解码验证139款商品、19列。源码新账号模板仍默认关闭；实际n8n启用不等于给新账号自动开采集或推送。

事业部绑定来自注册 Chromium Default 资料的只读现场观察，唯一 EBU4418046540089；不复用早期佛山亿玖演示绑定。正式配置通过已有公开接口登记，revision2仅启用物流与四源能力；库存监控及推送关闭，全局通知关闭，未发送钉钉消息。

## 聚焦修改

- `a2212fd7`：仅设备店四源绑定、08:00时区调度模板。
- `09f2a367`：身份字段尚未加载时有限等待；出现不同或多个事业部立即拒绝，不以预期值代替观察。
- `9bc7b475`：一次性9542导出前失败闭合操作员工具，保留原失败，严格证据和原锁后归档活动指针，不重放旧执行。
- 实际发布源码组合 `b28562f46af3569be647808756a56758e88cb69c` 以当前146兼容包为底，保持既有BI权限及健康检查语义。

## 已有证据

固定证据目录：`D:/codex-artifacts/jd-inbound-daily-0800-20261016/`，原始业务行及凭据不进Git。

首次完整手动执行9542于09:04失败，run `jdl-774dfd3a-5597-4a3b-b1a3-8e876f55587f`，错误 `JD_LOGISTICS_BUSINESS_UNIT_MISMATCH`。四源无导出清单、无批次、无scope revision；以同一已安装导出器的提交顺序和完整文件状态共同证明未点击导出，不仅依赖空下载目录。该错误不证明曾使用错误账号；随后注册Profile只读观察明确属于预期EBU，确认现有即时身份读取缺少就绪等待。

9542终态及n8n释放保持原样；09:25闭合原活动指针并保全原字节，`closure-apply.json`为committed。旧执行永久错误，不重试9542，也不将其写成成功。原导出器生命周期与四源零导入等前后复核成立后才移除活动指针，归档采用同卷不可覆盖移动；未知或中断须停住查证。

隔离验证：身份与原导出工作流22项通过；真实不可变helper构建/claim/A/B/C/release默认关闭烟测通过、0下载/0业务写；闭合26项夹具、聚焦TS检查和独立复审通过。

实际Django候选2975→2975文件，仅deployment、7个同类型CF网络缓存叶子和health.py行尾变化。health.py仅CRLF→LF，完整规范化相同，未改变BI行为。发布范围工具要求完整Worker+Django，无迁移；按此执行，不手工删减计划。原既有恢复点只读Verify完成，无新全库备份或恢复演练，历史143恢复点不作为146逆向恢复许可。

## 日期与运行约束

实时库存取当天，快照取前一天；流水沿用累计覆盖策略，初始2026-10-15至运行日exclusive，maxSpanDays366，首个超限日期2027-10-17。该既有策略不是无限滚动窗口；未为本轮接入另改未来日期政策。商品取所属事业部启用店铺商品。

## 最终运行证据

最终实际采用为Worker `20261016T052138Z-501da6b1afc58fef`（源b647）及Django manifest `61da6a63c5e9fb4f83e1970a6354378aba5018a925924b85ca869d6902ea7b05`（源fca）。UTC后端修复于14:34:30完成发布，原Start/启动绑定、维护清空及3000/5791/8051/8052/8081正常，Worker head/chain未改，结构146保持。

完整新执行9627于14:34:53开始、14:36:03成功，run `jdl-b5936fd7-70d3-4717-9323-333cb2f09635`。四源fresh下载，流水215、商品906、实时427、快照900行均verified。流水/商品/快照内容相同，正常duplicate并回查精确9619原imported reference及current/revision1；实时库存内容变化，正常导入新batch `2c72f1ef-2a3a-4504-aad1-e68975a8eaf4`、current/revision2。没有为了成功重写9619、复用其旧下载或忽略C比较。

`FIRST_SUCCESSFUL_RUN_VERIFICATION.json`逐个GET精确batch，核全回执（含UTC微秒）、原文件/内容哈希、行数、当前selection及duplicate reference；helper已释放，D结果disabled，0京东缺货推送。`FINAL_MONITOR_DATA_VERIFICATION.json`用实际前端decoder核正式库存API：139款、19列、第一页25款，无浏览器预览。

14:37通过已登录n8n UI发布版本“京东入仓·设备店·每日08:00”；14:37:30首次回读active=1且activeVersionId=versionId。`SCHEDULE_ACTIVATION_VERIFICATION.json`核发布历史、当前声明图、08:00与Asia/Shanghai、9627成功及原22个其他工作流不变。发布图与当前声明图原始内容一致；成功执行元数据包含n8n按固定node/typeVersion补齐的默认值，已逐项精确核对，无未知图差异。初版只读比较把这些默认值当差异的诊断保留，未改工作流或业务C。次日08:00是按发布计划计算的下一名义触发，不声称明天已经执行。

`final-run-review.json`已由独立Sol High按实际SQLite、公开API、原磁盘及真实前端decoder复核，状态factual_verified。四批当前性、UTC回执、duplicate引用、D disabled、helper释放、全部node字段/连接/settings、发布历史与其余22工作流不变均核实；没有重跑业务或扩大验收。任务文档提交及受管开发树归档结果另见制品目录最终CLOSEOUT记录；所有绑定正式制品的普通冻结源码树保留。

原始上线及每日定时授权来自本聊天连续用户指令，未取得该消息的独立机器时间戳；不把后续就绪时间追认成授权起点。本轮可核业务尝试自9542 09:04至9627 14:36，全部失败、等待、已知下载/导入及恢复记录保留，未仅按停服窗口描述总等待。

## 日期控件增量与首次切换观察

首次采集修复制品Worker `20261016T012126Z-dc89c4ec5bfabd85` 与Django manifest `ae0daba9e4d74309e1d5dd08077c32db0fb0dc55cafc28846e4c66b23c58a475` 已由原Apply/Deploy采用。原Start返回unknown：Django全部启动、release验证、supervisor启动均completed，最后AutoStartDingTalk被另一Django本机操作并发门禁拒绝。原失败不重写、不重放Start/Deploy/Apply；只读精确head、manifest、快捷方式绑定、两门禁和3000/5791/8051/8052/8081检查完成，当前相关服务可用。未声称该次钉钉接收器自动启动完成，未扩修其并发机制。

新完整执行9556于10:03失败，run `jdl-de6e61c0-210b-4798-b259-fbfb80b2ac8c`，`JD_LOGISTICS_DATE_CONTROL_AMBIGUOUS`。首flow exporting、其余planned；仍无导出清单及四源批次/scope revision。该码可能来自trigger歧义或面板未就绪/歧义，仅凭历史错误码不能断言当时count=0。现场CUA确认稳定后trigger/picker均唯一；新增等待处理面板动画与挂载竞态，点击一次，前后唯一、月份/日期/范围验证保留。

源码 `da305b85` 日期修复及只设日期probe已推送main；`0b40b191`为第二个精确9556闭合靶，不是通用失败码允许列表。原安装cfa6ec5f... exporter证明DATE所有相关flow抛错位置均在baseline/submitting/单次导出点击之前；复用原协议并独立审查，10:15取得committed，原9556 error永久保留，不重放9556。

日期真实DOM与相关测试30项通过，闭合增量28项通过；聚焦TS通过（新增断言先作union类型收窄）。10:13:50注册设备Profile实际观察唯一EBU，原日期函数设置后起止均10/15，0查询/导出控件点击，关闭浏览器及端口确认。另一京东product-detail任务占锁期间正常等待，不接管/打断；一次资源获取竞态失败无浏览器动作，另次正常获取后probe完成。

## 第二制品准备与维护续接

日期修复的运行源码组合为 `6587ca38c8b6a4db7df72cd0d2d0bc0da175c736`，从当前b285包仅cherry-pick日期三文件，干净且已推送。新Worker候选 `20261016T021943Z-228f5e3dc3956a5c`，plan `6ff836ece068b3f61a9b2a59b24336286a897d9331ed6205a3ff6613d475bb29`。Django准备ce81d1bd76074d0f961f03c9fb83cf56，receipt ad3815ea343b645b8c201dd69534e8f04d98b879e5c6553e48c34571a3aab954，manifest36d84e6a396b70204e3b5f898d6f987f8ce4547d2513eab427aa5cd89270f201。完整包比较仅deployment/7个CF缓存叶变化，health.py逐字节保持。READY与独审在证据目录package-date。

10:45原EnterMaintenance已写同ID双gate并受控停止Worker；后续Django Stop因并发门禁失败，原unknown保留。未Deploy/Apply，不重包。原已安装BeginMaintenance支持同ID、同KeepPG直接返回，再继续原Stop/CompleteDrain；经规划及独审确认后，仅做精确本次续接：原actor退出、Worker状态stopped、3000/5791无监听、两gate原SHA/typed合同、原前驱/候选/工具摘要均匹配。

第一次续接尝试在rotation锁获取处被另一项在线制品准备拦下，未创建RESUME_PUBLICATION_STARTED、未调用ResumeEnter；该日志保留，不把资源获取失败当服务操作已执行。等待占锁准备自然完成后（未打断/修改另一任务），11:04按相同维护ID开始唯一实际ResumeEnter。此维护窗口因此延长；未改变报表调度或发布锁规则。另一任务的制品不是本次部署范围。

等待期间三来源只读预检：shop_products/realtime_inventory/inventory_snapshot均唯一EBU4418046540089，JH C仓/明细/分仓页签可见，快照默认10/15；0导出/导入，浏览器和端口关闭。该预检不能代替随后的全链路下载导入证明。

## 第三次采集与真实协议核查

11:24:45日期制品完整发布完成（`package-date/RESUME_PUBLICATION_RESULT.json`），本次Start为success，maintenance清理、快捷方式绑定与3000/5791/8051/8052/8081通过，先前unknown和维护失败仍保留。第三次完整n8n9581于11:25先按原5分钟机制排队两次；天猫两个正常M长任务自然完成后，11:35:36领取。helper的`next_day`显示是最近完成响应阶段，并不代表M没在推进；结合真实终态确认后没有中断或修天猫。

9581的flow完整下载并validated215行，110097字节；随后products因高级筛选默认折叠、商品状态不可见失败，后两源planned，B完整四文件屏障阻止任何导入。该次不属于无效果：flow已完成下载。新专用operator经规划与独立88项验证及实际全inspect，在原两锁内12:03闭合；仅归档active，原CSV/export-manifest/failedmanifest留原路径、原字节保全，9581继续error，旧文件不转交新run或借用签名URL。恢复分支提交f70ab8c8，其他任务远端代码正常合并提交f3ee2c64。

Scope新准备入口由真实产品/JH导出与只读probe共用：产品唯一展开并回读启用；JH明确选择C仓/明细/分仓，快照仓库状态全部，选择/等待/唯一/读回保持严格。3源实际只设置预检及GUI查询均通过：产品906、实时明细427、10月15日分仓快照900；0导出控件点击/0导入，浏览器与端口关闭。证据exact-source-scope-preflight-v2.json、exact-source-query-preflight.json。初次probe在调用准备函数前因诊断脚本缺少out变量失败，未发生设置/导出/导入；原日志保留，修复为-v2后完成，不覆盖失败。

利用本轮注册Profile实际script src追溯官方公开静态JS，确认产品导出成功后自动打开任务popper、轮询、下载，不需要猜任务行点击。真实完成码为3成功/4失败，2仍处理中；进度查询ids为仍有效任务集合、pageSize相应，初查才是ids空及10条。普通下载经过签名URL fetch→arrayBuffer→Blob→a.click，fetch失败才直接点击签名URL。原实现的完成码2、只认空ids和只认直接URL均与真实前端冲突，纳入同一轮必要修复。原JS地址、SHA及十个精确函数摘录在product-download-research/；无Cookie业务API或导出调用用于该静态研究。

## 完整控件与产品下载协议修复

最终修复主线提交 `86a0bfb1`，运行源码组合 `0fdb0185d2f34e0b7b114f6513b4d7d2077dbe41` 仅在当前6587包追加四个本任务文件：exporter、source-tasks、scope UI测试、product download测试，未带入同期其他功能候选。两者均已推送；冻结源在D:/codex-isolated/jd-inbound-source-contract-20261016/source。

产品完成仅认3，4明确失败；初查和多ID进度两类raw请求shape均严格校验，任务ID只接受正safe integer/无前导零十进制字符串，规范化后精确比较并查重，unsafe number/不合法字符串拒绝。原提交taskId、事业部、taskParams、日期、数量与完整文件门槛保持。自动Blob下载须匹配scsw来源、原ACK/getURL任务及唯一签名附件GET的响应字节长度/SHA；直接fallback仍须URL精确匹配。没有增加任务行点击或主动替代下载。

独审隔离实证发现：response事件已到但body尚未完成的第二ACK/URL，旧records.push位置会让最终断言漏计；已改为headers阶段同步登记pending/身份，唯一正常body等待完成，晚到重复不能在close丢弃。原Blob/direct慢body反例已补回归并正确拒绝。独立Sol XHigh增量复审通过，raw固定shape和全部scope门禁保持，scope函数未再变化；原static JS字节及十个摘录精确重算通过。

冻结实际运行源的七文件单次定向集合（产品下载、scope UI、日期、原export、identity、workflow和pipeline）108/108、0skip通过，包含B/C完整文件屏障/owner/丢失回执/重放等直接调用链；`contract-package-tests.log`。不可变helper构建及真实claim/A/B/C/release默认关闭烟测通过，0下载/0业务写，`contract-package-helper-smoke.log`。没有以这些隔离测试冒实际四源导入。

JH两种导出最后也用本轮实际script src及被动script请求URL取得的官方静态资产独立核查：实时明细『下载报表』直接触发DETAIL导出，无额外确认；快照『按周期导出』标题、开始/结束日期和『导 出』均与实现吻合，单日开始结束同一天；查询有whStatus但导出对象按原JS省略。静态字段与jhLogisticsExportRequest无直接矛盾；它不是实际导出API响应证明。证据在product-download-research/jh/，未猜chunk路径或调用业务API。

## 最终制品与审查绑定

`package-contract/READY.json`（SHA256 `19e21a44417ff39a6d72edb284cd78bf6849d8383d94592e11a7d76a432b5ef4`）绑定冻结源码0fdb、Worker `20261016T042259Z-480b1bb8ae3f6605`、plan `1bfa316cba8c2462778e0b41dfa698eae35f96544e3a4c287a059616e5c2b17f`、Django prepared `5082fe58243c4103b2ebc81f37f1fa68`、receipt `d98f0ecb334ef3f35e002e30a08d2884b2a09af9ba21cd33f3c4556d7137f8b3`、candidate manifest `e967054036135f97ef8bec68fe91d52b196a77dddb5ef20c4f70813cfb727db1`。

Sol High独立核对34项工具摘要和实际制品，create-only `review-ready.json`为approved。实际Django包2975→2975仅deployment metadata及6个既有CF缓存叶变化（TLS random、4个Authenticator、deliveryRate）；本轮clientTcpRtt未变，health.py与当前正式包逐字节相同。范围仍为完整Worker+Django、0迁移；既有恢复点只读Verify完成，不新建全库备份或恢复演练。

发布脚本沿用原维护、停止、DeployApp、HardenAcl、Worker apply、退出维护及Start/VerifyStartup。维护内等待到每5分钟的第2/3分钟再退出，避免已观察到的启动尾部争用，但不承诺杜绝其他操作抢占原mutex；未改变原锁或报表任务。实际生产结果以下方最终回执为准。

## 最终协议制品实际采用与9607

`package-contract/PUBLICATION_RESULT.json`于13:04:04确认上述Worker/Django实际采用、Start及启动绑定成功、维护清除、3000/5791/8051/8052/8081可用，0迁移/0业务导入/0消息发送。原发布操作均成功，未触发恢复。

随后创建完整新n8n9607，run `jdl-ce4d594f-d110-4309-b10e-e899e06ae0be`，13:04:56开始、13:05:38以`JD_LOGISTICS_REALTIME_GRANULARITY_MISMATCH`结束。流水215行、商品906行已完整下载校验，产品真实自动任务4418060962074完成码3及Blob附件证明通过；实时库存exporting但尚无本源export intent/文件，快照planned。四文件屏障未满足，0批次导入；n8n已释放资源，旧失败不重写。

真实只读对照：直接冷导航两JH的identity及同prepareScope均通过；原“来源→下载中心两次→hash返回来源”出现frame unavailable/detached；两baseline后先完整进入about:blank再回同来源，两源均通过。证据`jh-cold-scope-diagnostic.json`、`jh-baseline-return-diagnostic.json`及`jh-baseline-cold-return-diagnostic.json`，全部0查询点击/0导出点击/0导入。这支持返回页document/frame生命周期不稳，不能据此断言9607具体是哪一个标签未就绪。

最小修复在两baseline一致、owner核对后完成about:blank，断言主页面精确URL且仅主frame，再安装fresh查询观察、清空身份观察并沿用原导航/身份/scope/查询/稳定行数/单次导出。旧文档销毁前不接受fresh查询；blank失败即停。真实Chrome旧iframe及定时器销毁、失败/重定向/残留子frame拒绝，与原scope/export合计40/40无skip；原业务协议和产品下载不变。

该候选原`exportJdLogistics`在原rotation→pipeline→Chromium锁内、固定配置/旧执行证据摘要下，单次真实导出两JH到独立artifact目录。`jh-candidate-exports/RESULT.json`于13:16:18完成：实时427行、task4773819、41973字节；快照900行、task4773820、109288字节。原manifest downloaded、文件SHA/内容SHA/日期与任务绑定、browser关闭/9224关闭均成立。独立完整解析核验通过，`jh-document-review.json`批准对应候选进入制品。这是两次真实外部导出任务，0正式导入/0推送，不能写成无外部业务效果，也不把这些验证文件交给正式新run。

9607专用闭合实现`bf94b0f9`与旧入口分开，仅保留已知完成的两下载，原4文件逐字节保全；独立171项组合及实际profile/零batch/scope/原installed/helper lifecycle通过。`known-two-downloads-closure-review.json`批准后，原双锁精确apply于13:17:56取得committed，原active归档至`known-two-downloads-9607-3965e4a4f63ad386/active.archived.json`。9607继续error，旧下载仅审计、禁止handoff/import/改标签或借用签名URL。

页面切换修复主线`26c089fa`与运行源码`b64719f807f3e3b7b13c7274ec0bed6c02b76494`均已推送。运行源以实际0fdb包为底仅追加exporter8行及新测试，不含同期其他功能。已通过40项及两真实候选导出的exact源码SHA与冻结源相同，复用有效证据；原108项仅为上一对应制品的验证，不冒称本次重新跑108或合并为一次113项。新冻结不可变helper真实route/default-off烟测通过、0下载/0写入。

## JH修复最终发布绑定

`package-jh-document/READY.json` SHA256 `c816161f90990d065b112f2903e9be5b2f9390b1fff13ce61c1c75bc9471d793`绑定b647源码、Worker `20261016T052138Z-501da6b1afc58fef` / plan `e9be749214d22ecce0dfd917a508e2c3417082b67cfde3d1a5a0996e6fed924f` / manifest `24e532b7ef5f2f4b0f7e2665dbbc5fbb0739f71116c703621c3bcd8d4e9d7572`，Django prepared `b6820f2f9910435292824836cfe33c90` / receipt `8677109c44c37d6b8ee07b80ddbfc095ef8aba74904d1096068dc4f313457bf6` / manifest `f310d1278d148db696332b073a587190f8c5de0c2738bd94e59024d4602f2230`。

独立Sol High末核41项执行摘要及实际制品匹配，2975→2975包只有deployment metadata和6个既有CF缓存叶变化，其余源码（含health.py）逐字节不变；`review-ready.json`为approved。原full流程保持，0迁移，仅对既有恢复点执行只读Verify，不新建全库备份或执行恢复。旧失败与unknown保留；该回执本身不等于已切换，实际切换以PUBLICATION_RESULT为准。

## 9619实际四源导入与UTC回执误报

JH修复于13:57:58实际发布完成，`package-jh-document/PUBLICATION_RESULT.json`确认501da Worker与f310 Django、Start/启动绑定/必要接口成功，维护清空。随后新完整执行9619，run `jdl-ce856c34-e4e4-4045-9bf0-0342efd3dbf8`，13:58:15开始，四源实际下载并导入：流水215（batch `8db4cb33-0700-4ffe-b039-aebcf63ad62c`）、商品906（`bf108313-c47a-487a-a29e-6e8661609f14`）、实时427（`c3055dba-d893-4db2-a9e2-be656e60d577`）、快照900（`4f4c25ce-f7e5-48c9-936b-d4a73421eefb`）。13:59:20 C以`JD_LOGISTICS_BATCH_RECEIPT_CHANGED`终止，n8n释放成功，D未执行。

公开精确批次独立回查确认四项均imported/current=true、scope revision1，原文件/内容hash及数量相同。按实际stableReceipt/canonical逻辑，唯一真正差异是`collectedAt`：POST新建ORM实例仍为输入+08:00，PG重载GET为+00:00；四组时间精确到微秒是同一瞬间。collectorEvidence键顺序已由canonical忽略，不是失败原因。`9619-receipt-comparison.json`保留完整元数据。正式监控GET经同前端decoder验证139款、19列，`FORMAL_MONITOR_DATA_VERIFICATION.json`；无浏览器预览。数据已存在不等于该次n8n全链成功，原error始终保持。

最小后端修复仅把_batch_payload的采集时间统一UTC isoformat，保留微秒，其他回执/来源日期/客户端strict比较不变。原代码红测5例复现，隔离SQLite签名POST→数据库重载→GET的42项及独立2项通过，覆盖5种偏移、零微秒、跨日、current与旧批noncurrent；不冒称隔离PG实测。源码主线`18b078b0`、实际应用冻结源`fca631ff4a9e4d5fc65f019d29c9507f44aa2734`均推送。实际b647→fca完整Git差异只有2个后端文件，机器计划scope=backend、components=[django]、migrate=false；不准备或activate Worker。

9619四已知导入专用协调工具作为独立生产运维产物交付于`dce99c3a`，不安装、不进入Worker/helper/Django载荷或引用闭包，也不作为应用发布baseline。apply是生产控制状态写入，不称离线或纯只读。独立99项及八原件完整解析/四批当前全对象/固定4组微秒时间例外/n8n C失败与释放/helper生命周期/双锁/端口闭合全部通过；正式C仍严格，无通用时间例外。原双锁单次apply于14:18:33取得committed，active归档至`known-four-imports-9619-f6ea9ca7540ff01f/active.archived.json`；原failed manifest、4批次及8原件不写，sourceBindingVerified=false不提升，0新导入/0事实修改/0外发。新执行必须四源fresh按原正常幂等，不能重跑旧C、改stage或借用旧文件。

## UTC后端包与独立运维产物的部署边界

`package-receipt-utc/READY.json` SHA256 `f77b48dc9bc3a9431903eba939429138045ffde09ece43730db57498f52ff1e4`绑定应用源fca、Django prepared `c45f52f7130746d7b8f0c0c63057a847` / receipt `91dd2c46b0927affea9653ec5fe6e89a3e0bf8258edb424aae4ff511db4f6f78` / candidate manifest `61da6a63c5e9fb4f83e1970a6354378aba5018a925924b85ca869d6902ea7b05`。实际包2975→2975只有已审jd_logistics.py、部署metadata和6个既有CF叶子变化，health/controllers及其他成员逐字节不变。独立26项执行摘要、真实制品、closurecommitted和机器backend范围通过；`review-ready.json`为approved。

本次不准备、不apply Worker；沿用501da head及原chain，在同一唯一Worker入口临时进入完整应用维护KeepPG、Stop无IncludeBackend，再DeployApp/HardenAcl，最后同head退出维护并Start/VerifyStartup。前后head/chain必须不变，临时停止运行进程不冒称更换前端制品。0迁移、既有恢复点只读Verify、0新全库Backup/Restore；同字节42+2测试直接复用。新运维工具独立冻结和执行记录与应用源/范围各自保存，不用工具未部署提交伪装应用baseline，也不手工删减范围计划。
