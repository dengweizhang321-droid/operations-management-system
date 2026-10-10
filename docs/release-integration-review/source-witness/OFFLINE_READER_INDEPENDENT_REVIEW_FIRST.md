# 六表离线COPY提取器独立审查

当前首轮结论为**阻断**：原表根算法及离线入口方向正确，但时间分组丢失微秒和两个响应脱敏出口存在实质缺口。源码修复后需按新精确SHA重新运行本独立夹具并复审；本报告不证明实际post六表摘要已匹配，也不授权任何生产操作。

首轮被测 `copy-witness.mjs` SHA `20dab853a0df5634153e6d4ed253a727d1f00951397245765b15e3d5d88e53b2`，同期 `inspect-post-dump.mjs` SHA `ee945fd704acf7e9fdc3bdf600448ac23c3daf0ad2465b43ad7b9111e6b640f8`。测试 [copy-witness.independent.test.mjs](copy-witness.independent.test.mjs) 使用固定合成32字节key、合成身份与行；10项中7通过、3失败，exit1，日志 [OFFLINE_READER_INDEPENDENT_TESTS_FIRST.log](OFFLINE_READER_INDEPENDENT_TESTS_FIRST.log)。没有读取实际私密key或raw客户数据，没有启动pg_restore、SQL、Status、HTTP、Backup、Restore server或生产锁。

## 必要修复

| 位置 | 触发及实测 | 修复要求 |
| --- | --- | --- |
| copy-witness.mjs77、90–93、97 | cutoff `05:44:20.123400Z`，created/updated为`.123900+00`；Date.parse均截到`.123`，独立测试实际prefixRows=1、预期0。输出cutoff也被toISOString截成毫秒。完整postRoot匹配不能识别这个后续分组错误 | 使用严格ISO解析和整数微秒（例如BigInt）比较，保留offset换算及完整cutoff精度；新/旧及modified判定全部采用同一精确协议 |
| copy-witness.mjs66 | response_payload中的numeric id/taskId/commentId直接存数字。合成735791357/246802468/369121518在结果出现原值，违反ID仅HMAC输出边界 | 身份字段无论输入类型都HMAC，或明确拒绝不符合真实业务schema的numeric身份。不得直接输出numeric/boolean身份；版本和deleted另做严格类型验证 |
| copy-witness.mjs68 | `Sat, 10 Oct 2026 12:00:00 GMT (synthetic-private@example.invalid)`被Date.parse接受，nested createdAt原样落结果；独立负例未抛错 | 响应时间只接受严格规范格式、合法日历/offset/精度；禁止自由日期注释或其他文本，拒绝未支持格式，不直接保留任意可解析字符串 |

上述三项是解析/输出边界缺陷，未证明生产源行中存在该恶意或异常值。即使暂未发现这些输入，也不能把“非敏感输出”或“微秒分组”作为已验证能力。

## 原摘要协议与可接受的边界

实际已部署 `tools/postgres_no_key_backup.py` SHA `ee86b4a48eff411616256556c83734cd5aa282f7fc75551facf0d691336de8b8`。106–130行以PG `sha256(convert_to(row_to_json(t)::text,'UTF8'))`生成32字节行摘要，再按bytea排序，逐二进制摘要连接后SHA256；重复摘要必须计入，空集合按空字节SHA。collect/inspect设置UTC；主备份在同一MVCC snapshot收集profile并导出给pg_dump。

copy-witness的pgRowJson保留COPY给出的物理列顺序，对typed bigint直接保留原整数token，对JSONB保留原raw格式，不经JSON.stringify重排/压缩JSONB。tableRoot使用Buffer.compare排序和32字节二进制更新，符合原聚合方式。独立已通过固定行字节、UTF8/COPY空值/转义、二进制重复摘要、列顺序漂移拒绝、单表postRoot坏摘要拒绝、重复request identity拒绝、prefix成功仍fullComparisonClosed=false这7项。

但夹具字节仍不是实际PG row_to_json的全格式覆盖。六表每一完整post count/root与已pin后manifest**全部精确相等**，才认证当前离线流。物理列集合一致不足以认证列次序；实现保留实际COPY顺序并最终比较完整root，顺序错误必须拒绝，不能按schema排序补绿。JSONB、字符串控制字符、真实UTC微秒或未支持类型导致任何不匹配时保留失败，不能进行“合理规范化”或放宽原root。

decodeCopy区分SQL NULL `\N`与literal `\\N`，解码标准控制字符、八进制/十六进制UTF8字节，fatal UTF8及NUL拒绝；未知转义保守拒绝。缺/重复表、列集合、列数、重复身份、未结束COPY、row/line/output/deadline界限继续保持。JSON解析只能用于typed审查与脱敏，不用其浮点结果改写认证行字节。

## 离线入口审查

reader固定已pin前后manifest、原contract/validator、原pg_restore.exe和本次post dump；实际argv包含 `--file=- --data-only --no-owner --no-privileges --strict-names`及仅六个table选择。没有--dbname/host/user/connect，也没有shell、psql或执行提取SQL。子环境移除全部PG*；stdout只进入内存UTF8/COPY解析，不写raw SQL/rows文件；stderr仅字节数/SHA和有界固定错误汇总。spawn使用windowsHide、stdin ignore、有界输出及超时结束。

dump流式hash与manifest匹配，结束复验dev/ino/size/mtimeNs/ctimeNs/nlink；源码/解析器启动SHA在结束再次检查，输出create-only/fsync。原源码首读后父任务已加入启动代码SHA及结束复验，首轮测试记录对应上列reader SHA。仍建议把本次调用的两源码精确SHA固定在调用/交付记录中，不把执行中改源码后的失败当最终样本；私密key不入Git、不输出，目录与文件继承受控。

六表根不匹配时reader只写EXTRACTION_FAILED；失败字段只保留table、类型、digest、计数和source location，原错误message做SHA，不落原value。成功也必须写beforePayloadRecovered=false、fullComparisonClosed=false。本次没有实际读key、重hash dump或运行入口，因此这里只是源码边界结论；不声称看到全部运行时子进程行为。

## 证据范围仍然有限

时间cutoff来自before.createdAt，不能单凭名称把它等同精确PG snapshot建立时刻。若prefix的完整旧行count/root真实匹配原pre，才有该子集的密码学约束；created_at、新增数量或结果键类别本身不足。mutable workflow_tasks及revision的before随机token/微秒/原字段缺失，不能以post生成它们。即使部分prefix匹配，也不自动闭合六表历史变化或当时签名principal/权限/发送任务来源。

本首轮不修改作者源码。三个独立失败需修复并重验；原failed log继续保留，不把它覆盖为新通过结果，也不扩大为生产采用或原严格比较成功。
