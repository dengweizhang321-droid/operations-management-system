# 工作流差异来源与原哈希合同独立审查

2026-10-10，非作者只读源码审查；分支 `codex/release-ab-source-witness` 从main `cb007f05152bccaf884e60b8cdeaad0c2077557d`。**现有Task回执/活动不足以提供完整before/after及历史授权证明；离线post可证明自身和部分追加前缀，不能补造已删pre的任务、revision前行。** 未运行SQL、Status、HTTP、Restore、生产CLI或dump/4k重hash，未导出业务行、修改生产代码或旧证据。

## 精确受审来源

实际 `D:\teruisi-runtime\django-sales\app\deployment.json` 原字节仍237fbe0d...；下列10个小源码文件的实际SHA与原AB9 collector封存pin逐项相等。仅核这些文件，未新做完整app/runtime密码学闭包。

| 部署app相对路径 | SHA256 |
| --- | --- |
| backend/workflow/models.py | f22eb52113e305a39f0a5accd5e84841e727bd78340583cb5f3a0481b464afd6 |
| backend/workflow/operations.py | ced850b63668a9c1e8712bf91c179a05a349011606f7b6802527e1eb28597a9d |
| backend/workflow/write_requests.py | 92173d9f24f37d6237037a482ca117e941fce89e0e48a74563ddc9dbb33b137f |
| backend/workflow/views.py | 13154e9d9a35cf9f09c0c45e7e4d3c7732b832436bd24eb72bf058b4b5a21b10 |
| backend/workflow/revisions.py | 738fb07ee4d52781cd62932a832747e1d9dacb52159c489a3f2a8d32b8f9f264 |
| backend/workflow/operations_views.py | a2f75762bb12498d6015e729848935edb3748fbb84ceee57fc39f6d31483ed1e |
| backend/workflow/urls.py | 4def59457775a3417311ab7ee23c7ac4de5f2eb169865892107cd285b4ae5e07 |
| backend/sales/auth.py | 0a2c48977c3830921ca90fe33212415024f2427bc62e9f42e1bec2f2c0d5e195 |
| tools/postgres-consistent-backup.py | 0a1449b329a4afe0261c662236a6aacae60a6e7a4120801fb42eea2322368483 |
| tools/postgres_no_key_backup.py | ee86b4a48eff411616256556c83734cd5aa282f7fc75551facf0d691336de8b8 |

## 原摘要定义不能替换

`postgres_no_key_backup.py:106` 的完整profile表合同是：SQL `sha256(convert_to(row_to_json(t)::text,'UTF8'))` 得每行32字节，按该bytea排序，**重复行也计入**，Python依次连接原二进制32字节再SHA256，结果为 `{rows,sha256}`。空表摘要是空二进制流SHA。不是JSON.stringify、按ID排序、十六进制字符串拼接、JSON文本行排序或可减去增量的checksum；不能从post表SHA“减去”新行得到pre表SHA。

离线COPY必须根据实际dump的完整表定义/物理可见列顺序及类型，复现PG `row_to_json` 的UTF8表示。需保留JSON/JSONB正确表示、SQL NULL与字面`\N`、COPY转义、毫秒以下timestamp精度、UTC/数值精度和重复记录。不能用Python排序键/ensure_ascii或API响应格式代替SQL行表示。先使六表各自完整post摘要**全部精确等于**post manifest；任何不匹配或未支持类型都拒绝，不补“合理规范化”。

`postgres_no_key_backup.py:32` 的profile外层摘要则对profile/roles/tables/catalog使用Python `sort_keys=True,separators=(",",":"),ensure_ascii=True,allow_nan=False` 的ASCII JSON。`postgres-consistent-backup.py:1834` 的contentSha是main evidence结构的同类canonical摘要，包含表count和revision/authority等，**不是**全行profile哈希；其canonicalSha还加入数据库身份及contentSha。三个层次不得互换。

## 写入来源、回执与缺口

实际tasks/comments路由在 `urls.py:19/44` 指向 `operations_views.py`，不能只审launch `views.py` 的principal。`operations_views.py:50/125/131/175` 对Task写入要求签名principal为operator/admin且scope=None，再经 `_write` 明确 `authority_scope="operations"`。`sales/auth.py:84` 核request-id、时间窗、原正文SHA及绑定method/path/query/principal的HMAC；不接受裸role/email。`write_requests.py:45/99/135` 限workflow_writer/非readonly进程，并核**operations** authority epoch/cutover；不是launch authority。两manifest的两类authority均相同，但receipt本身不存签名envelope、角色/scope判定或epoch快照。

`views.py:119` 通过actor/method/path/body/query摘要绑定request-id，业务callback、活动/revision及completed response receipt在同一事务；重复completed请求只重放response。`write_requests.py:151` 每次还可删最多20个过期receipt，processing超过5分钟/failed可重新claim，TTL7天。因此receipt行数+4不能直接等同“四个全新合法请求”，既有行可能重写或清理；须先验证原子行绑定及完整旧前缀。

`models.py:59/118/158/170` 与 `operations.py:136/239/339/404` 的实际保存能力：

| 对象 | 已保存 | 未保存/不可据此补齐 |
| --- | --- | --- |
| write receipt | actor、method/path、body/query SHA、claim/status、可见response_payload、时间/到期 | 原正文、HMAC envelope、历史role/scope决策、完整before；原header revision也不在receipt |
| Task activity | task FK、action、summary、actor、created_at；update的changedFields、新version及可能的新status | request-id、完整旧字段/新行、旧status、新/旧mutation_token；无Task专属from_version |
| comment | 完整comment行；活动存commentId | 由增量计数推出原评论未改/删、历史授权 |
| Task response | 可见业务字段、version、createdAt/updatedAt | mutation_token、updated_by、deleted字段、完整created_by；时间由 `_iso` 截到毫秒 |

更新在 `operations.py:360` 重置随机UUID token、updated_by、精确updated_at；旧token无法由新值或正文摘要恢复。即使找到先前完整可见response，其毫秒格式也丢失微秒，仍不是原SQL行像。`WorkflowOperationActivity` 另有from/to version和from/to status，但属于未变化的operations_record表，且也不是完整行审计，不能套用到Task。

`revisions.py:20` 每次锁singleton，把revision+1，source_digest只算 `{"previous":旧revision,"reason":本次reason}`；**未纳入前一个source_digest，也没有完整历史reason/旧updated_at**。前后main evidence确为360→364，但这只支持四次bump计数；最终digest只约束最后一步，替换早先reason而保留最后reason/序号仍得同一最终digest。Task更新活动的新version可检查相邻版本形状，不能据此补成全局完整链或前行SHA。

## 最小充分后续证据方案

1. 在私有离线内存中解码已保存post，输出仅受限metadata/摘要。验证六表完整物理列、typed值、row数及原行/表哈希全部等于post profile；不把业务正文、actor邮箱或原响应落入docs/stdout。提取器、schema、源dump身份及测试日志精确绑定；不得连接数据库或执行提取出的SQL。
2. 对comments/activity/receipts等候选追加族，按实际PK/引用/版本建立明确候选增量集合。对**完整剩余行集合**重算原排序32字节表SHA并等于pre对应摘要，才可说该子集受pre摘要约束；不能凭创建时间、净增count、前N行或“日志应只追加”通过。receipt旧行reclaim/TTL删除必须检测，不能隐藏。
3. 在已经校验完整post的私有数据中检查receipt与activity/comment/task响应的一对一关系、method/path/query绑定、task/comment ID、after版本/字段、actor一致性及事务顺序；歧义、缺链或多解要拒绝。只有body SHA时不得捏造请求正文来填补expectedVersion或完整before。
4. 历史权限证据须来自实际签名/身份及权限判定来源，绑定原请求和时点；当前源码role gate、当前角色或receipt.actor字符串只能证明代码规则/一致性，不能单独宣布当时请求已授权。市场193个回执还需独立market来源审查，本报告不认定其合法。
5. mutable `workflow_tasks` 的完整before随机token/精确时间/旧字段及 `workflow_data_revisions.updated_at` 在列出的记录中缺失。旧pre dump已删、只有不可逆表摘要；除非找到既存可信完整before像/等价完整事务历史，不能严格重建原pre表根，也不能证明所有修改限于申报字段。离线post精确校验及追加前缀成功不会弥补这两项缺口。

当前最远可形成“精确post自一致＋部分原前缀证据＋与部署规则一致的关联分析”，不能称六表全量授权转换完成。原strict unknown、原比较器和两baseline必须保留。任何未来新合同须明确已证实及仍无法证实部分，不能白名单六表、忽略时间/token、改旧unknown成功或把推测写成授权来源。未来发布协议应在验收闭合前保全所需before恢复材料；这不使本次已删pre重新有效，也不授权现在改保留策略。

## 必需负例

- 缺表/列、重复COPY块或未支持类型，NUL/转义/null混淆；大整数精度丢失、JSONB格式/列次序/微秒被规范化；必须导致post原SHA不匹配或明确拒绝。
- 少/重复一行，改旧prefix行、净增不变但删一增一、expiry清理或旧claim重写；不得仅按count/time分类通过。
- after成功但before token/updated_at未知；忽略“volatile”列、用after当before或API毫秒响应填µs；不得生成pre一致证明。
- version跳号/重复、revision只匹配最后digest而中间reason不同、receipt/activity一对多/无request-id；不得宣称完整链。
- actor字符串一致但签名/角色决策缺失、restricted/viewer被写成operator、body/query hash不符或未知路径；不得用源码允许集合充当实测授权。
- 其他表/字段未覆盖、market部分未证明；必须真实表达uncovered，不能扩大统计或重复计算节省时间。

本轮仅审源码和原两manifest元数据，未审查父任务离线提取器或宣称其结果通过；后续实现及实际六表摘要须再独立复核。
