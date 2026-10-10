# 私有 before image 独立验收

2026-10-10。**本批已捕获私有证据接受：完整pre任务90行/control1行及对应post根独立重算一致。** 没有生产执行授权，不认可原第19步成功或历史权限来源已证明。[机器结论](BEFORE_IMAGE_INDEPENDENT_REVIEW.json) SHA `6eb33ef77832afcc81becfdeb1520fde878956e84a6d99e0c684700a2b963cd2`；[真实自动复核](BEFORE_IMAGE_INDEPENDENT_REAL.json) SHA `e73423c505d4d12ccbd19fd739a8d6f72d6c8faa3f4dc34f2aea5e2e39dd1e8c`。

review接口为independent/acceptedEvidence=true、beforeTasksRootMatched/beforeRevisionRootMatched=true、productionExecutionApproved=false、blockingFindings=[]。空阻断只限**这批具体已捕获数据**；不宣称capture/reconstruct通用CLI或新closeout API可执行。

独立程序只读已有private reconstructed90/1、transition input、heap、三个FPI及私有WAL segment；没有spawn/pg_restore/pg_waldump/服务器连接/SQL/新production capture，也没有读原dump或重hash它。key仅进内存用于HMAC比对，未打印/复制Git；业务行未输出，报告仅metadata及摘要。采用另写的text/int8/UTC微秒renderer，再按原SQL的每行SHA二进制32字节排序、连接和SHA定义，而非直接信任作者match标志。

完整pre任务根 `92924de089751466251f2a2fd6627951e224a1398fb27b9a82bb8fcf25a85818`、控制根 `ca27f5ad337de852d363bd2ea3a628c9d62e339dce235db8253fd7d69c602608` 与原pre manifest精确相等；对应post90/1也逐根精确等于原post。两边PK唯一、集合90相同，仅3条任务改变，其他87条所有18列逐行等价。三条旧任务各v2，三张FPI全部输入SHA匹配；报告标定的normal LP位置各直接解出完整18列并与独立私有旧行吻合，实际borrowedPostFields均空。旧control360在已捕获heap正常tuple恢复，包含原精确updated_at，单行完整根匹配。候选按不同规范行摘要去重，每ID1个、枚举1组合、仅1组合满足完整pre根。

即使未来遇到不能解出的TOAST字段，借post值也只可在明确声明且**整90行pre根精确等于原根**时作为受根约束候选，不能称该字段从物理旧tuple恢复。真实内存负例修改before字段、替换为不同after token、改其他87任一字段、借after revision时间均导致原根不匹配；本次没有用这些借值路径。

原schema审查正确指出回执/活动中没有完整before。新追加的历史WAL/heap物理副本是不同证据源，这次实际填补对应90/1 before缺口。全根匹配证明规范行数据集合，不证明全部tuple的MVCC可见性、事务顺序、操作者历史授权，也不复活旧pre的完整恢复archive/schema/凭据/其他状态；不将旧unknown或strictEquality=false改写为原流程成功。

## 17.11 对照及负例

对照了REL_17_11的23字节heap头、null bitmap、natts及MAXALIGN；line pointer的offset/flag/length定义与小端解码一致，未将hint/xmin/xmax当可见性结论。[heap tuple定义](https://raw.githubusercontent.com/postgres/postgres/REL_17_11/src/include/access/htup_details.h)、[itemid定义](https://raw.githubusercontent.com/postgres/postgres/REL_17_11/src/include/storage/itemid.h)。

PageXLogRecPtr为high/low两个32位字段；私有heap页导出的end LSN与记录2A/C263388一致。relation map CRC32C/固定长度、pg_class固定前缀也对照了原源。[page header](https://raw.githubusercontent.com/postgres/postgres/REL_17_11/src/include/storage/bufpage.h)、[relation map](https://raw.githubusercontent.com/postgres/postgres/REL_17_11/src/backend/utils/cache/relmapper.c)、[pg_class](https://raw.githubusercontent.com/postgres/postgres/REL_17_11/src/include/catalog/pg_class.h)。

首轮独立9例5pass/4fail完整保留：external未核ONDISK18、compressed长度不足8、normal LP重叠、normal tuple未对齐。作者补四项guard并按真实PageAddItem的MAXALIGN修正合成page fixture后，独立9及作者5合计14/14通过，真实私有根仍保持；没有放宽断言。[varlena结构](https://raw.githubusercontent.com/postgres/postgres/REL_17_11/src/include/varatt.h)、[PageAddItem](https://raw.githubusercontent.com/postgres/postgres/REL_17_11/src/backend/storage/page/bufpage.c)。

额外用原reconstruct search函数的隔离合成上下文实证：两种被接受不同数据集抛歧义、4097组合拒绝、无匹配仍明确null。真实校验另要求完整根及唯一匹配，不能凭CLI exit0/报告存在判完成。官方pg_waldump用RestoreBlockImage保存FPI，文件名绑定timeline/LSN/locator/block/fork；本批私有16MiB segment与元数据SHA相等、三个页面SHA全部相等，未重读live WAL或重跑工具。[pg_waldump原源](https://raw.githubusercontent.com/postgres/postgres/REL_17_11/src/bin/pg_waldump/pg_waldump.c)。

## 通用CLI限度，不是本批数据阻断

- capture-wal-images未来重用前应在mkdir/read/spawn前核全部源/私有输出祖先无redirect；目前只做live leaf nlink不够。本批独立已核已有private链/文件常规单链接，因此不影响上述已捕获数据。
- reconstruct-before的未来pg_restore流缺绝对timeout及解析失败finally清理；歧义assert.equal(matched,null)若直接uncaught可打印matched.rows。应改恒定/boolean诊断及sanitized outer catch。此次独立读者没有spawn，错误只输出类型/摘要，合成测试只用虚构行。
- 不支持压缩/外部字段不能无声明混入before；revision/任务须规范数据集唯一，不能用exit0或单条候选代替完整根。当前实际三条旧任务无借值、全根和唯一组合均已证实。

报告没有审定或授权新的production acceptance协议；新API/调用器/sealer必须另独立审查、隔离负例及真人精确批准，仍保留原19 unknown、业务差异和全部历史异常。
