# v2 批次支持工具非作者复审（初轮）

2026-10-10，Asia/Shanghai。本轮针对 validators、owner隔离准备/runner和既有只读采集；实际adapter/sealer尚未提交本复审。没有修改实现、重跑owner/PG/构建或调用生产operator。复审者独立运行纯validator负例并重算拥有方源字节。

结论：拥有方源映射和已执行只读事实可核；原17个纯例通过，但新增5个独立负例暴露验证器缺口，隔离runner也有接口边界缺口。**当前不能宣布v2支持闭包全部复审通过。** 作者已接受最小补强，修复后的guard负例、原25项及最后字节须重新复审；原记录不改写。

## 已独立核到的事实

- owner deployment仍 `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`。实际installed backend **1256/1256** 与清单逐SHA相同；私有隔离目录 **1264/1264** 原源与8个新增测试文件匹配，无差异，见 [字节绑定](evidence/batch-v2-owner-independent-binding.json)。另两份shared测试、原配置和工具/drizzle依赖独立声明，没有把它们写成拥有方业务增量。
- 原第六轮owner日志确实 `Ran 25 tests ... OK`，前五轮路径/依赖失败日志存在且保留。此结果属于精确复制源的SQLite隔离合同，不是生产写测试、生产DB后端全链路或任意native代码OS沙箱。
- [只读采集](evidence/batch-v2-readonly-preparation.json)为57144.7006ms，完整合同295 evidence tables/296 profile tables；两个实际未签名GET（8071客服、8101权限用户）为401/`authentication_required`。真实Control为Running/Ready/exact_release/D5、12个实际域true；它们没有被说成全角色/scope权限矩阵。
- 原同点恢复JSON/sidecar、manifest/dump/content/profile/序列/清理及端口55591此前已独立复核。existing point不是新批次前后备份。native latest仍unknown，快路径资格false，未采用或生产批准。

## 验证器独立实跑

被审初始 `validators.mjs` SHA `8ad2c9641cd80f7d3bf29762763e0ef354b46ce2e3a66b4c9c3e898438e31aad`。原测试独立 **17/17通过**，日志 [原17项](evidence/batch-v2-validators-independent-original.log)。非作者新增 [validators-independent.test.mjs](batch-v2/validators-independent.test.mjs) 的五个预期拒绝例均被当前实现接受，原 **0/5通过、5失败**日志保留 [新增负例](evidence/batch-v2-validators-independent-negative-original.log)。没有网络、文件或数据库操作参与这些pure例。

| 触发 | 初始缺口 | 最小补强 |
| --- | --- | --- |
| 删除完整software tuple中的pgDump项 | assertFullManifest只核deploymentSha，仍通过 | 合同绑定完整七项software/keyset/摘要，不能只单Django标签 |
| 修改profile roles，保留旧contentSha | 内层内容根未重算，仍通过 | 原profile四部分与contentSha真实绑定；保留原schema约束 |
| catalog digest替换数组并重算profile根 | 只核catalog键，值可错误类型 | 原catalog摘要值/schema类型严格校验，不以matching arrays替代原目录证据 |
| baseline文件含未声明root | root各自count只覆盖部分文件，仍输出全部保全 | roots唯一/实际批准集合、全部文件归属、路径、size/hash及计数总和闭合；完整采集算法不能由boolean标签替代 |
| 四个任意true probes | 检查数>=4而不检查原四名 | 固定 `homepage/live/ready/helper` 精确集合及原完整状态协议 |

原 `postgres_no_key_backup.digest` 使用 Python `json.dumps(sort_keys=True, ensure_ascii=True, separators=(',',':'), allow_nan=False)` 的ASCII字节；与v2 UTF8 canonical不同。profile内根重算必须与原生产者完全一致，包括Unicode转义。合法fixture应提供真实内层根、catalog hex及完整software，不用h('d')假标签让正例看似成立。

## 隔离runner边界

初始 `owner-isolated-tests.py` SHA `63e25350a92416e0e5f15b2537a7b91ae1173e71fccd98ab0713baebb35e6078`。静态发现：只patch `sqlite3.connect`不能覆盖Django使用的dbapi2别名；memory URI substring判定不能证明其mode/路径；Popen未闭合相对/UNC参数、cwd/env且子进程不继承Python monkeypatch；socket connect拦截不涵盖DNS/UDP及已知psycopg类入口。

这些缺口不等于已发生生产连接或写入；本轮没有这类事实。需要补两SQLite别名和严格URI/私有根解析、明确子进程同守卫runner/真实参数与cwd/env边界、DNS/UDP和已知连接入口的轻量拒绝负例，再以相同实际业务断言运行原25项。作者明确不会把Python接口守卫夸大成覆盖libpq/ctypes等任意native代码的OS沙箱；证明范围应是已盘点的owner/test/工具闭包与明确接口/数据根。

复制工具还需在最终证据记录解释：实际1256字节匹配是本轮独立实测；部署manifest声明不是它的替代。测试runtime/依赖、8+2测试来源、原配置/SQL/tool，以及后续guard自身字节均应进入隔离结果的完整输入映射。没有将SQLite合同推成PostgreSQL运行环境等价；原PG恢复/目录/角色与真实只读拒绝提供各自层的证据。

## 下一轮必须保留的范围

修复后真实正/负例及最终支持文件SHA，再与实际adapter/sealer一并复审；母操作/子观察计时不叠加。原前五轮失败、第六轮成功、原17通过和独立5失败全部保留。核心A/B/C及两个不可变候选没有被本复审修改；没有因此提前封存或批准生产批次。
