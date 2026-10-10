# MarketWriteRequestReceipt 来源机制独立只读审查

2026-10-10 11:21:22 UTC。审查结论：已部署代码能够产生“有效新请求正常登记、但没有领取业务任务”的 completed 回执；不能把 `market_write_request_receipts` 的193条净增直接解释为193次成功业务写入，也不能一般解释为193次失败尝试。本次实际193条的来源、前后行级增删改及权限见证仍未核定，原严格比较阻断不解除。

本次在 `codex/release-ab-source-witness` 专用 worktree 仅新增此报告。读取了已部署 `D:\teruisi-runtime\django-sales\app\backend` 相关源码和已存在差异摘要；只列已知 artifact、备份、审计和日志文件名/大小/mtime。没有 SQL、HTTP、Status、Restore、pg_restore、生产写入、外发、锁获取、dump读取/重生成或已删除文件恢复搜索；没有读取环境秘密、原客户记录或日志正文。

## 精确源码与已知差异

实际部署没有 `backend/market/write_requests.py`，claim/replay/completion 位于 [views.py](</D:/teruisi-runtime/django-sales/app/backend/market/views.py:171>)。以下原字节分别匹配原 AB9 authority 中当前适用闭包的 SHA；这绑定了审查的源码，不能证明哪条路径本次实际被调用。

| 已部署相对文件 | SHA256 |
| --- | --- |
| backend/market/models.py | 76f8c4edb7f3e269a085ed21cad5175356e4e8f29cc215a166f168ad44b697c1 |
| backend/market/views.py | d58afe57263059cee7a86ccc0b92b494e8ff900227e09100e1b85e48d4e19b15 |
| backend/market/annotations.py | ee306098de91fe4e0c988ba3b5b0dc632a2abc76dcb72a51d330c05f23ca48e2 |
| backend/market/images.py | fd5a94fe1fd9219b645335702e91f4b9c2dc9b0c281d119185bf882d8d8b924f |
| backend/market/import_service.py | 92619154b444ae0b811166ff870b09ba23bdd8445d2c0cbd4fe0817c314a91c3 |
| backend/market/urls.py | 5839f4b7875c6a5cf5655e69687c51106bd02a538eb88a4bbd26c5cf9947f4d7 |
| backend/market/revisions.py | 5fb0cb2385fb4e1f6017491bfa13984d2cff748434ba8d1ca39659ca7a30adee |
| backend/market/migrations/0001_initial.py | 72bcf0af174bc1dee5187a5ff0a779286e6ff65734d41d20c9b8f372a3ac00d5 |
| backend/sales/auth.py | 0a2c48977c3830921ca90fe33212415024f2427bc62e9f42e1bec2f2c0d5e195 |
| backend/teruisi_backend/health.py | 7cc1ef835f1acdf3227c2aba088befb3bffbd4d4dbac1d2e9b76dd328e4cea97 |

已有 [POST_BACKUP_METADATA_DIFFERENCES.json](</D:/.codex/worktrees/release-integration-review/运营管理系统/docs/release-integration-review/production/POST_BACKUP_METADATA_DIFFERENCES.json:1>) 记载 pre180759→post180952，净增193；完整profile摘要由 `f6c1cd26c0d0268d372f340417febcc5b62be21ddd7c0003778dd9b0664699c9` 变为 `bd7c379c7d18370f03f16ba7fcbca0393988312e4e083e971a401970717ffe74`。净增数不等于新增行身份已经逐项验证；例如新增、删除、历史更新的组合也能产生同一净增和不同摘要。

## claim、replay、result 与时间字段

[models.py:276](</D:/teruisi-runtime/django-sales/app/backend/market/models.py:276>)及初始migration151–167行定义 request_id 主键，body/query SHA、method/path、actor_email、status、response_status、response_payload、created_at、completed_at。**没有 updated_at，也没有单独的 operation、domain、action、事务ID或完整请求正文列。** `created_at=auto_now_add`记录本行创建，`completed_at`由成功返回callback的完成登记设定；它们不能单独证明旧行从未被其他路径改变。

views.py162–168行对request_id取得PG事务 advisory lock；191–220行在短事务中锁定/读取回执，绑定body/query/method/path及标准化actor。不同绑定拒绝409；既有completed返回已存response并设置replay header，不重跑callback、不新增回执、不更新该旧completed行。既有processing小于5分钟拒绝；超过5分钟会删除并重建，新的created_at不能冒充原历史创建时间。

commands在views.py355–360行选择 `atomic_completion=True`：同一事务内复验processing拥有方、执行callback、保存completed/response/completed_at；业务command本身也在事务内验证写authority。imports在371–375行用非atomic completion，import_service拥有自己的多阶段事务，完成登记在独立事务里。因此不能把imports的请求完成失败反推为业务发布一定未发生。

| 触发条件 | 已部署机制及证据界限 |
| --- | --- |
| 签名、角色、scope或外层契约在claim前拒绝 | 不创建本表回执；这些拒绝不能直接解释193条新增 |
| 普通callback抛异常且异常清理正常执行 | views.py243–249删除该request_id的processing，随后外层转换错误；没有completed回执作为正常异常结果 |
| 进程在claim后中断、清理自身失败，或imports完成登记阶段失败 | 可能留processing；imports早先业务事务可能已经提交。不能只看客户端失败判零效果 |
| callback正常返回业务结果含failed/duplicate/空任务 | 会登记completed；completed是已存HTTP结果，不是业务成功的同义词。commands外层固定返回200/ok:true，也可能包裹领域failed或空任务结果 |
| 完成提交后响应丢失/客户端报错 | completed可能已存在；同request_id合法重放读原结果，不应以客户端失败重演业务动作 |
| 新request_id、业务无任务或无变化 | 可新增一个completed回执；不是既有回执replay，需新请求实际来源证据 |

只在本次所读正常ORM路径范围内，completed旧行重放不改历史；不能扩展为数据库不可变性证明。本表允许writer `SELECT/INSERT/UPDATE/DELETE` 是 [health.py:377](</D:/teruisi-runtime/django-sales/app/backend/teruisi_backend/health.py:377>) 的部署契约，市场migrations中未见本表completed历史的专用不可变触发器；本次没有查询实际数据库grants/triggers。外部代码、直接SQL或数据库级行为未因此排除。

## operation 与权限语义

reader的 `queries`（views.py289–309）、`consumers`（313–322）使用operation路由，但不进入 `_replay_fenced_write`；不能因为它们也是POST，就认定普通页面查询会新增本表回执。writer只挂载commands/imports（urls.py17–33）。commands采用 `domain + command.action`，不是顶层operation；仅凭本表path/body摘要或某个response形状，无法唯一还原完整action。

每次进入commands/imports及重放之前，views.py135–145、328–340/368行都先复验签名principal、角色和无数据scope。普通command需operator/admin；master、images、projection和明确高权限annotation action需admin；import需admin。已存actor不会代替当前权限检查。[sales/auth.py:84](</D:/teruisi-runtime/django-sales/app/backend/sales/auth.py:84>)复验HMAC、签名时限、正文SHA、request_id、method/path/query和完整principal。views.py344及import_service.py743调用 [assert_write_authority](</D:/teruisi-runtime/django-sales/app/backend/market/revisions.py:56>)验证postgres状态及当前epoch/cutover；不能只凭回执actor邮箱推定该次调用当时获授权。

两个可产生“没有领取任务，仅回执新增”的具体分支：

- [annotations.py:1082](</D:/teruisi-runtime/django-sales/app/backend/market/annotations.py:1082>)筛选候选；候选为空时循环不执行，1157–1158直接返回task:null/waiting:false。1703–1704的claim_task/run_next/run_batch都会走此函数。它们是有效command，故会由views记录新completed回执。若候选不为空，expire、refresh或claim可能写其他行，不能把所有task:null都统称零业务变化。
- [images.py:243](</D:/teruisi-runtime/django-sales/app/backend/market/images.py:243>)先清理已过期claim，再查任务；没有job返回job:null/claims:[]。只有当清理没有删除行且没有其他并发变化时，才可能仅本表新增；不能省略247行的删除副作用。

业务failed的正常结果例子见annotations.py1256/1273、images.py350；它们不等于Python异常抛出。import重复分支（import_service.py763–781）虽然不重新导入标准化业务资料，仍登记attempt、可创建图片任务，不能泛称只回执变化。以上都是可能机制，**未证明193条由其中任何分支生成**。

## 已有文件与原pre前值可得性

只检查已知根及列出的文件metadata，没有搜全盘、删除区或运行dump解析：

| 范围 | 看到的材料 | 可得性结论 |
| --- | --- | --- |
| E:\\codex-artifacts\\release-integration-review-20261010 | rg文件清单880项；所有 `.dump/.backup/.bak/.sql/压缩归档`及pre/preserved-recovery文件名筛选只有10项manifest/sidecar/restore回执 | 未发现该根中原pre完整dump副本；原/保全manifest不能重建row前值 |
| AB-v2-555729fd8f1dedc2及其production | pre-backup-manifest、original-pre-backup-manifest及sidecar | 有精确前摘要与清单；没有看到pre row级快照 |
| AB-backup-metadata…/production/DELIVERY-cb007f05/preserved-recovery | pre/post manifest与post Restore回执及sidecar | metadata保全；不是pre dump替代物 |
| E:\\运营管理系统业务数据 | 仅daily-20260928T125351Z、daily-20260929T012900Z、daily-20261010T093506Z三个目录 | 当前后点dump946874951字节；两旧点822882781/824029420字节。旧点不是本次pre05:44精确状态，不能用于证明这193条之前旧行未改 |
| D:\\teruisi-runtime\\django-sales\\backups\\postgres-daily | 仅20261004 incomplete目录 | 未见本次pre完整临时副本；incomplete不能授予恢复资格 |
| audits/market-cutover | 20260901 authority-install、retirement、system-test、stale-batch-remediation，另有9月1日SQLite文件 | 时间与本次窗口不同；不能提供本次事务来源或精确pre row前值 |
| audits/postgres-operations | 已知10月10日Backup/Restore审计文件名及metadata | 是候选追溯入口；仅目录清单不能证明其中含193条row前值/业务事务来源，本次没有读取正文 |
| logs/django-market-writer.*及reader.* | 新旧stderr/stdout；当前writer `20261010-142413-c8c1f421` stdout0字节、stderr93字节 | 保留日志入口，但本次没有读正文，也未验证request_id或事务级日志覆盖 |

9月旧全点可能用于历史趋势比较，但不是本次精确前驱。上述“未发现”仅限所读清单，不能声明整机或所有其他artifact根不存在副本；其他release/backup根只列顶层名字，未检索其客户数据或payload内容。没有凭文件mtime把它们认作新鲜来源见证。

## 后续派生摘要的验收边界

父任务可交付受控离线dump流的非敏感派生摘要，再独立复核其提取器/原dump绑定、完整列结构、COPY解析计数、时间区间和result分类。应避免打印邮箱、完整request_id、正文、响应中的token或客户信息。报告可用计数、不可逆行/主键摘要、path、状态、结果键类别及时间范围；不能因某类result常见而命名为已证实来源。

要证明“193条真实追加而既有180759行未改”，须有原pre行集的完整前值或可验证的原行级摘要集合，与post按主键逐项比较，证明旧行集合、每行全列摘要、删除数、新增数。原pre只有全表摘要+计数时，即使post按created_at选出193条且剩余计数等于180759，也不能证明剩余旧行内容与pre相同；除非派生算法能按原备份profile的**同一精确序列化/排序**重算旧行完整摘要并匹配原pre摘要，且时间筛分和主键边界都有独立证据。

要进一步证明业务来源合法，还需这些请求与真实原发送任务/execution、请求正文摘要、签名principal/批准范围、响应/重试和事务完成的可验证关联；源码允许该路径、HTTP200、actor字符串或时间上接近都不替代来源证据。若无前值或来源映射，保留“来源未闭合/历史改写未排除”，不得改写原严格比較断言或把original failed/unknown改成正常成功。
