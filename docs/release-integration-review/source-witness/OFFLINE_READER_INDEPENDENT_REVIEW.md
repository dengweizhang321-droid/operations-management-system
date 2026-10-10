# 六表离线COPY提取器最终源码与夹具独立复审

2026-10-10 11:41:25 UTC。**最终源码及纯合成独立夹具通过，实际六表离线post认证仍待新一轮结果。** 三个首轮实质缺陷已闭合，不放宽原post根、row数、完整列、隐私或原strict比较。此结论不授权生产操作，不证明本次业务变化合法或原AB全部完成。

| 最终审查对象 | SHA256／结果 |
| --- | --- |
| copy-witness.mjs | `0d8bc1bc4f10abec8c5ac74c32144471647835cf3353da24b1a8777738f679de` |
| inspect-post-dump.mjs | `ee945fd704acf7e9fdc3bdf600448ac23c3daf0ad2465b43ad7b9111e6b640f8` |
| 原10项独立fixture | 原文件未改，SHA `3d0a7baecbb48ba7d160a622568da201bfa083447059fb982fe0a07e2976a393`，重新10/10通过 |
| 新6项UTC独立fixture | `copy-witness.utc.independent.test.mjs`，SHA `8d516cea02910e1d35b299feadede70408c10e17a125aed248bb1d964b2d2407` |
| 最终合并独立日志 | `OFFLINE_READER_INDEPENDENT_TESTS_FINAL.log`，SHA `db761f21fbee9be65a9c641fd80e5897f33bbf922a70d58cfef767bbf171c3db`；16通过／0失败／0跳过、exit0、136.5673ms |
| 首轮原报告 | 已create-only/fsync逐字节保全为 `OFFLINE_READER_INDEPENDENT_REVIEW_FIRST.md`，SHA仍 `724fd91a53a379172d570049fcbb00a5bd8df08065fa77c28a2506bd06c73601` |

复审人没有改作者源码，没有读取实际私密key或raw客户行，没有启动实际pg_restore、SQL、Status、HTTP、Backup、Restore server或生产锁。测试只用固定合成key/行，最终模块SHA与父任务给出的精确SHA一致。首轮7/10及三个失败日志保持；重验结果不反写首轮当时通过。

## 三个缺陷闭合与UTC证明范围

首轮Date.parse分组把cutoff `.123400Z`和行`.123900+00`截到同一毫秒，错分prefix。新instantNs严格解析ISO、校验真实日历，并用BigInt纳秒整数表达offset＋fraction，created/updated及cutoff全部用该精确值比较；cutoff原完整文本保留。原负例现正确分新行/modified，另验证七位.NET tick `.1234008`比`.123401`早200ns，没有降到毫秒。

数字response id/taskId/commentId现统一HMAC；版本需非负safe integer，deleted需boolean，未支持numeric identity拒绝。nested createdAt/updatedAt必须通过严格ISO instant校验，自由日期注释不能出现在输出。原数字ID和注释日期独立负例都通过，补充calendar、scalar类型负例通过。HMAC用于脱敏一致性，未来关联分析仍须遵守原实体ID的真实类型/范围，不能把文本HMAC相同单独等同于授权或完整事务身份。

已部署 `tools/postgres_no_key_backup.py` SHA `ee86b4a48eff411616256556c83734cd5aa282f7fc75551facf0d691336de8b8`，collect()310行明确 `SET LOCAL TIME ZONE 'UTC'`；106–130行原表根算法使用该session的 `row_to_json(t)::text`。归一化为UTC是复现原确定性行字节，不能把server offset保留的COPY文本直接冒充UTC profile行。

新timestamp仅把支持的PG timestamptz转到原UTC表示，保留全部原微秒，按PG式去掉fraction尾零而不舍入。独立例覆盖 `+08`→UTC、`-05:45`跨日、跨年、`.000001`、`.123000`、零fraction、负epoch以及timezone等价瞬间。元数据cutoff可支持七位tick，PG行仍只接受其最多六位微秒格式。所有转换后的全post根仍必须精确匹配原manifest；不能对不匹配追加别的“合理格式化”。本复审没有实际解析原SQL流，因此不独立断言第一次运行的唯一根因就是时区。

## 原摘要、物理列及fail-closed门禁

原SQL `sha256(convert_to(row_to_json(t)::text,'UTF8'))`产生32字节行摘要，按bytea排序，依次连接原二进制32字节后SHA256；重复摘要计入，空表为空字节SHA。新tableRoot使用Buffer.compare和原二进制更新，不用文本hex、主键或JSON行排序。pgRowJson保持COPY声明的物理可见列顺序，对bigint保留原token，对JSONB保留COPY原raw格式，不经JSON.stringify改写JSONB的空格/键序/数值精度。

独立通过固定UTF8/JSONB/bigint行字节、二进制排序及重复摘要、NULL与literal backslash-N、COPY字节转义/fatal UTF8、物理列漂移拒绝、任一post表坏SHA拒绝、重复主键拒绝及prefix成功仍fullComparisonClosed=false。列集合正确不代替列顺序；实现保留实际COPY顺序，顺序错误由完整postRoot拒绝。真实表定义/JSONB输出尚需实际六表全根认证，夹具不能替代它。

缺表/重复表/列集合或数目错误/未知类型/未终止COPY/重复身份/非法UTF8/NUL/时间类型，及300000行、4MiB单行、512MiB总stdout、10分钟deadline都继续有界拒绝。JSON解析只用于typed审查和脱敏，不用JS浮点结果重写认证行字节。

## reader范围及运行证据

reader固定已pin前后manifest、原contract/validator、原pg_restore.exe和本次post dump；argv为 `--file=- --data-only --no-owner --no-privileges --strict-names`及仅六表选择，无--dbname/host/user/connect、shell、psql或执行提取SQL。子环境清除全部PG*；stdout只进入fatal UTF8/COPY内存解析，不落raw SQL/rows；stderr只记字节数/SHA，固定失败消息不输出原异常value。spawn使用windowsHide、stdin ignore及有界终止。

dump原字节hash与manifest匹配，结束复验dev/ino/size/mtimeNs/ctimeNs/nlink；reader/parser启动SHA在结束再核，输出create-only/fsync。新实际调用须绑定本报告两个最终SHA；任何执行中源码变化或输入变化拒绝，不把失败样本改为通过。私密key不得提交、打印或进入报告。

第一次实际运行的既有 `E:\codex-artifacts\release-integration-review-20261010\AB-source-witness-20261010-1128-first\EXTRACTION_FAILED.json` 本次仅作为非敏感失败metadata读取：11:33:12.668Z→11:33:29.536Z，stdout280594293字节、stderr0，market_write_request_receipts的actual `82aef4e3868d09670f3b1639cf64973f6e1fac396ea468114641b36620649309` 不等于原expected `bd7c379c7d18370f03f16ba7fcbca0393988312e4e083e971a401970717ffe74`，因此拒绝并保持fullComparisonClosed=false。不能把“SQL已完整生成/进程无stderr”当摘要成功；本报告没有重跑或查看该raw流。

第二次实际提取须单独报告同一dump、最终模块SHA、stdout完整读尽/退出、六表各自count/root及无raw持久化。任何一表不匹配必须失败，不进行重放数据库、修改原源数据或放宽断言。

## 仍未闭合的验收

before.createdAt只是时间分类cutoff，不能单靠名字等同PG snapshot建立时刻。prefix须完整count/root等于原pre，才有该旧子集的摘要约束；数量、created_at和result键类别不足。即使部分prefix匹配，mutable workflow_tasks/revision的完整before随机token、微秒、原字段及历史签名principal/权限/发送任务来源仍不能由post补造。

成功输出继续必须 `beforePayloadRecovered=false`、`fullComparisonClosed=false`。当前结论是最终源码/16项独立夹具通过；实际全post认证待下一轮只读结果，原严格比较、历史失败/unknown及完整AB闭合限制继续保持。
