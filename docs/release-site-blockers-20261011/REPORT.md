# 现场引用阻断核查

本轮用户授权核清现场阻断，再提交精确生产范围批准。只读诊断不等于生产批准；未执行维护、切换、启停、调度修改、备份、恢复或业务写入。新开发从最新origin/main `4c799a4e2ff21343347db818dab990e61c03455d`创建独立managed worktree和`codex/release-site-blockers-20261011`；既有用户检出、准备目录与原始证据保留。

## 已核现场

- 原AB关闭收据及109条WAL重算一致，原engine completed=false的历史不改；当前active、system-maintenance和automation-drain文件不存在。这是时点元数据观察，不证明任何互斥已被取得。
- 原已安装resolver直接复核effective head `20261010T014638Z-97833d2f2b7e7bc9`／manifest f4e、219条successor链／aaf629、已采用source-snapshot声明digest92c265，且安装guard验证通过。导入前3个旧installed模块均按原封存完整D库存中的精确字节、物理路径与single-link重核。
- Django当前237f、新Worker候选6cff／plan0afd与原封存绑定一致；未重复全包扫描，未以元数据声称所有就绪、ACL或生产验收通过。未观察到pg_dump/pg_restore进程。
- 非管理员CIM-only快照198 unknown来自缺失程序路径；不是198个已知旧目录引用。对已知PowerShell PID47936使用0x1000成功读取系统PowerShell镜像，其父37392为Windows Terminal；同一出生实例下Nt类60也读取到启动命令。原始命令不落盘。
- 2026-10-11 19:27（Asia/Shanghai）批量同句柄／出生时间关联诊断833进程、215任务，18项native补充、0已识别引用、179 unknown；这179项均OpenProcess error5。不能凭进程名豁免，不把不同时间集合简单相减为已解除数量。原冻结guard仍CIM-only、没有消费此补证。
- PowerShell及其父的0x1010／0x0410在当前账户下拒绝访问；启动命令无目标字面量不证明cwd、模块或句柄无引用。

Windows的CIM ExecutablePath有权限条件，QueryFullProcessImageName支持较小的查询权限。Native成功而CIM字段为空可以是取证渠道差异，不直接视作守卫错误。[Win32_Process](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)、[进程访问权限](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights)

## 已准备的管理员只读包

V2 packet SHA `9e906d1e53ee9acf67b909be0198520e137d9cc08d1b8fbc3aa5adf7f709df38`。固定Node、collector、evaluator、launcher的字节和当前Windows SID；启动前由调用者持匹配launcher只读文件句柄，管理员literal bootstrap再次核packet及SID／角色，捕获匹配hash的脚本bytes后执行。Node二进制持FileShare.Read，从hash到子进程结束；清所有NODE_*，防额外coverage/warnings写入。输出仅固定E审计根的create-only脱敏记录，父链reparse检查是时点校验，不夸称连续目录锁。正常系统启动／编译的临时资源不当作业务写入。

采集全量进程及任务动作元数据，只申请0x1000；仅已知PID47936另申请0x0410，读取有界x64进程参数中的工作目录。PEB/RTL为内部布局，使用架构、PID、两cwd、native image／command及CIM/native出生时间交叉检查；不支持或不一致保留unknown，不读取全内存，不查任意业务内容，不启用Debug权限，不注入或终止进程。[微软内部接口限制](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess)

命令和原始cwd只在内存／管道供固定原predicate检查；输出只有hash、引用判定、创建时间及API错误。管理员确认只是只读权限确认，不是生产上线确认。管理员也可能无法读取PPL／内核对象，不能承诺unknown归零。若用于最终执行门禁，必须按实际合同另审新外置guard并封新未批准scope，或证明原合同在拟定执行身份下成立；不能直接用诊断结果使旧f0bb通过。

## 独立验证、首次失败与未测

详见[只读复审](ASTRA_READONLY_REVIEW.md)、[启动包首审](ASTRA_ADMIN_LOADER_REVIEW_V1.md)、[最终cwd复审](ASTRA_ADMIN_CWD_FINAL_REVIEW.md)。实际C#命令解码／出生时间关联15个受控反例通过，未调用现场native；PS5实际UTF8／argv测试通过。V1继承NODE_V8_COVERAGE曾多写1个受控文件，修正后0；cwd换行及错误身份两个真实消费反例成立，修后原5例加错birth／空birth共7/7，原断言保留，不声称PEB现场验证通过。

真正AGY两次CLI plan调用保留prompt／stream／stderr／call：均等待5分钟，stderr明确print timeout，SUCCESS字段配空response不是完成复审，不算认可。首轮usage为0；次轮同会话已有21670 input／37124 thinking但无最终response，说明有模型工作而非完成文本复审。不继续无变化重试求结果；Astra受控证据与源码核验不被模型空状态替代。此前生产策略的真实AGY复审仍按原已交付范围有效，本轮没有改生产策略或门禁。

首次管理员探针因为证据目录创建尚未结束而写出失败；只读查询没有产出持久记录，修后重采。PS5初稿不支持32768u字面量，修为显式uint32；原拒绝保留。managed worktree初始detached，明确创建codex分支后继续。未把这些启动／夹具失败解释为生产事故。

已按精确V2 packet请求一次Windows管理员只读确认；Start-Process返回“操作已被用户取消”，未启动管理员采集，没有生成ADMIN_CAPTURE_SUMMARY／ADMIN_REFERENCE_DIAGNOSTIC／ADMIN_READONLY_COMPLETED。原错误作为Windows取消保留，不误称自动审批拒绝或取证成功，不自动重试。当前可用权限下剩余179访问拒绝项仍阻断；必须取得只读管理员核查结果，不能仅等待、按名字豁免或改TTL。

尚无最终生产准入通过结论，因此目前不能提交可执行的上线确认。`f0bb/6989/SourceV3/pkg21c`及旧guard均未修改；仅限定非复用准备已验收，整个C缓存现场仍未闭合。所有后续生产动作仍等待用户对精确范围明确批准。
