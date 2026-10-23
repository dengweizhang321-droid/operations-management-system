# 精确并发转换来源独立复审与新收尾合同设计

结论：**这份精确source evidence可接受，属于通常工程意义的独立来源一致判断；它不批准生产执行，也不证明旧第19项通过。** 已验证的前值、完整post、回执/DTO/活动、请求摘要、真正已采用源码及不变权限目录，共同支持受保护应用入口产生这些合法形状的并发业务提交。原规范没有要求逐次永久保存HMAC信封，不能仅因为现在无法重新验签而增设无限门槛；同时不能把已丢失的信封、当时完整role/scope文本或独立人类指令假称已找回。

本复审只读现有文件、在程序私有内存处理已授权缓存并运行纯规则负例；没有生产SQL、Status/HTTP、dump重跑、Restore server、锁、外发、旧E9/WAL修改或新收尾scope执行。没有读取fingerprint-key.bin，原行/标题/评论/用户邮箱及私密key未输出或入Git。新 `exact-closeout.mjs`／`execute-exact-closeout.mjs` 不属于本报告的API/调用器复审范围。

## 已证实的输入及边界变化

`S = E:\codex-artifacts\release-integration-review-20261010\AB-source-witness-20261010-1139-final`。

| 输入 | 绑定及本次结论 |
| --- | --- |
| POST_SNAPSHOT_WITNESS.json | SHA `af96a9f2065af73ca5cad4b5328248d14b33d75b7812fc560275db24124b7860`；六post原生count/root匹配，四个完整旧prefix根匹配 |
| BEFORE_RECONSTRUCTION-wal.json | SHA `cef6c63131f19134b1612b4e6401d8e9f03dfde57c9b9a153ff8838da37c769d`；此前heap不完整失败保持，WAL候选已给出完整匹配前根，选中字段未借用post |
| private/transition-input-private-v2.json | 实际文件存在、regular/single-link，SHA `3a214c764366bb9b0bce5c929eb54b12d4d2a37941fa6b1bed39b565ca9a8b6a`；与被测初cache字节相同。本复审程序内重算90行before/post和1行revision before/post完整根，分别为原92924…/ccf206…及ca27f5…/06eac2… |
| EXACT_TRANSITIONS_NORMALIZED.json | SHA `03937b8d5e4b53fe6310525803e45c42b9354d6b7da386bb3c3891c5076942ee`；3行实际变化仅status/version/mutation_token/updated_at，created_at与updated_by未变 |
| EXACT_TRANSITION_PROOF.json | SHA `f95d5d8c338eeeadaa3058d311a2b3574e1bd6787fe921728e92e53a1da24140`；allSix/allFour/before90/before1为true；历史信封恢复、独立重新证明历史授权及originalStrictEquality仍false |
| transition-rules.mjs | SHA `22ffac76c3c75c27f2fb1cc2f3bde65bdff2979ed14708de045afe73281e6d7f` |
| exact-transitions.mjs | SHA `401905b3df6dac6821faf3049d6cf5ec2b3b77e96d40433aa2be03b2e7a07513`，仅离线源数据提取，不是生产收尾协议 |

原“没有完整mutable before”的限制对这两个表已被新证据解决；原pre dump仍未恢复，90行及revision恢复不等于恢复全库恢复包。旧 `EXACT_TRANSITIONS.json` 的created_at误列来自UTC/+08文本表示，原文件保持，不能用它作为真实字段变化名单。新比较按原PG UTC表示及完整微秒归一化；不规范化业务字符串或忽略其他字段。

总profile是296表，**六个精确变化、290表原count/root完全不变**，不是“跳过六表”。profile/roles/catalog/sequence lower bounds均相同，整体content SHA仍真实不同。六表检查的实际范围是：

- 市场回执180759完整原行根保留，新增193个不同request_id，均POST/completed/200，同一body/query、同一内部actor。每项完整结果恰为ok:true及result的job:null/claims:[]，不能只验两个键存在。
- 工作流回执59完整原行根保留，新增4项；3个PATCH和1个POST，分别200/201。评论9完整原行、活动198完整原行保留，新增1条评论、4条活动；没有旧回执TTL清理或旧行改写被藏进净增数。
- tasks前后ID集合均90，87行所有列不变；3项由工作中/version2变为已完成/version3，mutation token按原UUIDv4格式变化，updated_at改变，updated_by仍等于该提交actor。字段值时间比较用精确UTC instant，不能把同一时刻的不同offset列成变化。
- revision完整旧行360及新行364认证。四操作、四活动与bump相符，最后digest按原previous:363和最后task_update reason精确重算；原算法未串联前一个source_digest，不能把它描述成保存了四个中间签名链。

三个工作项的标题被父任务私下确认不是TERUISI/发布/A/B/C；本复审不读取或输出这些标题，也不推定它们属于发布任务。正常获准账号处理非发布工作项，本身不是违规或本发布脚本的授权动作。

## 真正已采用源码及权限门禁

本次读取实际 `D:\teruisi-runtime\django-sales\app\backend` 和实际Worker release `20261010T014638Z-97833d2f2b7e7bc9/source-snapshot`，后者下列字节还与原批准source `5faac8151f59d66de72c3caead8cad916ea547da`逐项相同，没有拿main替代运行来源：

| Worker source-snapshot相对路径 | SHA |
| --- | --- |
| app/api/workflow/tasks/route.ts | b2203546a5fdf063a60104b50d20787c59f47867380111ca1488651d1b42b112 |
| app/api/workflow/tasks/[taskId]/comments/route.ts | 140882da0c1c6c4ff16a30fcc8f8391147dba7af59128f4b774d0e83afd03c04 |
| lib/django/workflow-service.ts | ad1c64ee9844a73d2a7270b275570831ca6e12a6d44d00ee561b85d78a4c731a |
| lib/django/sales-gateway.ts | 38857d14e8281120b9c421b2d532d838334c8d63a937bd98648aec1716d4686f |
| lib/auth/authorization.ts | 3c320d2c82f5ce7fdb6a46353beb2c48db878041325ebbfad2feb57fe1969702 |
| lib/market/django-image-cache-runner.ts | ce287cd22f01cc78ee7e8d600ef805a35fb66f96bb704c9ac4bb6bd79cae0734 |

Worker tasks PATCH和comments POST先requireAppPrincipal(operator/admin)、scope无范围限制，再签名转发。workflow-service231行将payload确定地JSON.stringify为UTF8，绑定method/path/rawQuery/body SHA/request-id及真实principal。实际Django operations_views.py54–59、141/184在创建回执之前重新verify_principal及operator/admin/scope=None；_write130–131指定operations authority。write_requests.py142–152在create199行之前还核writer进程、非readonly配置及postgres epoch/cutover。views.py119–147把callback业务变化和completed回执放同一事务，actor从通过门禁的principal对象赋值，不从业务正文取值。market的签名/角色/scope门禁同样在claim之前，images command要求admin；固定内部runner principal本身声明admin/scope=None。

已采用image runner30–40行构造market-command-v1/images外壳；18行MAX_BATCH=8，144–151行默认jobId空串、limit8、claim_image_cache。该确定序列化119字节body SHA**精确等于全部193条的** `ec6dbd4d4337814896dc1a9e7d37e121e86de60078db8f5360ecbfd45d1d2852`，query为空SHA。其153–154行无job即idle返回，在该分支不取图、处理claim或finish任务。Django _claim在无job前仍会清理过期claim，不能凭返回形状声称历史上从未发生过任何瞬时变化；本次完整290不变根证明没有未说明的持久市场业务delta。

三个PATCH的确定状态/version2请求42字节SHA精确等于回执 `9fc6c6aa5c0f67f54a72ad5b3d775e0c825c01597a9e9f6e2b45ae904ebf4c54`；规则还在私有内存逐项验证实际目标query摘要、完整after DTO、actor、token、活动、comment正文摘要与DTO、最终revision。这是摘要约束的具体请求归因，不声称原raw body被永久保存。

在原工程信任边界中，把已认证数据库commit记录与唯一已采用写入口、确定请求字节、原子结果和不变权限catalog合起来，足以支持**“这些提交与当时被程序门禁接受的来源一致”**。这比“代码允许”或“当前账号是admin”强；没有反证时不增加假设PG管理员恶意伪造的无限验收要求。但它是应用执行与commit来源判断，**不是重新验证每个原HMAC信封的密码学证据**，也不证明人类当时点击了哪一界面或另一智能体持有哪条聊天指令。相关原始信息未保留，必须维持这些限制。

## 现有getter与剩余证据

已只在程序内扫描Django market/workflow writer共24个stdout/stderr文件，窗口08:53UTC/16:53本机时间无匹配行；当前两writer stdout0字节、stderr93字节。未输出日志正文、email、title/body。因此这批文件未提供可重新验签的principal/request历史trace；无日志不等于无获准调用。

最小补充getter应只读现有、范围明确的材料：

1. 私有已认证cache逐request输出HMAC locator、source标签、method/static path、精确Body/Query SHA、完整DTO匹配bool、业务/activity/comment/revision一对一关系和精确时间；本轮规则已实现这些核心检查。每个非白名单字段、关联多解、缺项或额外行都拒绝，不能只看actor相同。
2. 若现有已授权任务历史/HTTP执行回执有08:53这四个请求，可提取实际人类指令的source ID/时点/摘要及请求结果locator；请求本文、令牌或评论只在程序私有内存比较。侧栏标题/摘要、另一任务自称完成或现在的role不能替代它。没有材料就报告“未独立找回人类操作来源”，不要伪造历史信封或为寻找不存在日志反复全盘扫描。
3. 若要强化原子时间绑定，使用部署代码的completed expires_at减去固定7天作为写入时marker，同时标清它不是PG COMMIT时间；不可把一周TTL当业务/活动可任意延迟一周的窗口。实际本次事件在08:53:01–38及同一after快照内，源证据检查不授权未来任意时间样本。

scope接受的是这两份精确快照的差异，不是当前/未来数据库全历史。新发现未知caller、源SHA不符、actual field/actor/digest不符或权限catalog变化应拒绝；单纯缺原raw签名不是规范新增的自动阻断。

## 不伪装旧合同的新收尾设计

原第19 `full-postgresql-deep-comparison` 明确要求completeBusinessContentEqual=true、unauthorizedContentChanges=0。六表确实不同，原strictEquality=false，不得回填旧op19 passed，也不得把source-consistency bool变成旧unauthorized=0。source evidence和新plan应先交付；**当前不能执行新收尾动作**。

一个同保障的新独立typed合同可以把判定目标写成：全部296完整覆盖；290精确不变；四append旧根精确不变；90→90仅这3项精确状态转换、1精确评论、4活动/4回执/4revision bump；193个精确内部idle claims；无额外行、字段、对象、权限/迁移/业务持久delta；按已采用门禁的来源一致。这是逐项证明整个观察差异，不能变成六表白名单、忽略时间/token或泛化“用户日常业务允许变化”。

新plan至少封存：original batch/source/candidate、原19 exact unknown/failed event及当前head、pre/post manifest和dump、v2私有输入SHA、完整before/post根、全296覆盖清单、全部源码/解析/规则及独立日志SHA、应用来源门禁图、精确197回执/4业务操作、真实limitations、新批准scope/user item/time，以及明确范围的后20/21只读动作与ownership终结。私有原行和key只留受控外置目录，不能入Git；源码一致和字段转换证明不能被拿去批准执行器。

执行器需另独立复审及精确真人批准。保持原19及全部历史unknown/failed；独立append新的acceptance-contract记录，原20/21真正执行、每个边界继续原动态身份/权限/维护/排空和完整pin，前passed及Backup/Restore/lifecycle不重放。新终态可明确为completed-with-approved-exact-transitions，并经单独授权的原锁/owner CAS精确释放占用；**原engine的completed仍false，原19 strictEquality仍false**。不能手工改WAL/active、借取消接口释放已切换批次，或让旧UI/7389批准自动扩大成新验收合同。

用户可以明确批准这个新的、逐字段而完整的验收目标及已声明的工程来源证据限度；这不使旧合同当年通过，也不补造历史授权文书。若目标仍坚持原内容逐字节相等，则当前结果不满足，应保持阻断。本轮未执行/批准新API，API/调用器安全性及最终动态准入仍是后续独立门槛。

## 独立规则验证

23/23通过（2个真实缓存/UTC表示正例＋21个改动、身份、Body/Query、DTO、评论、活动、revision和market负例），exit0、210.3837ms。测试输入与v2字节相同，并另对v2本身运行纯正例及完整90/1前后根重算。每个原始异常先捕获并只哈希，测试reporter不打印私密assert value。

规则测试文件SHA `c2352b027813e05c5aed1cafe7b02fe671d60fe7dfcc34d76925272a46bdbd79`，日志 `TRANSITION_RULES_INDEPENDENT_TESTS_FIRST.log` SHA `93d6db686119a0b7449a8ae8504499219af3599929b64edfdec508c496d657b6`。source evidence没有阻断发现；签名重验/人类来源及首次错误日志的限制如上保留。机器结果见 [EXACT_TRANSITION_REVIEW.json](EXACT_TRANSITION_REVIEW.json)。
