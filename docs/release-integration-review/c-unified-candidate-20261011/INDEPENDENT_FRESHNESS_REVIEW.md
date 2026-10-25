# 统一 C 候选实际 collector 新鲜度独立复审

结论：**该精确候选暂不能作为最终 C 验收候选。** 本轮只审单文件，其他源码/制品/来源契约状态仍未知；没有生产请求、候选 import、数据库/锁/生命周期，也没有修改另一任务或已冻结候选。

实际读取 `D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T034516Z-f308beaede528df7/tools/release-batch-admission.mjs`：19435 字节，普通单链接文件，读取前后 stat 和 SHA 稳定，SHA **`115fbf67bc52ed1d1ff7e85a7f2d78fed58a7a73f23383a3455c1c27d74a630e`**。对照已审 `fcfe50aa59a5ccdf4a2b44c044e02cec8eb6aaba` Git 原字节确为 `6a7f8891a04daf7a52610505e940d1dfc46d879e63b11463a14bdb81092e6b6a`。详情见[机器报告](INDEPENDENT_FRESHNESS_REVIEW.json)及[原补丁独立报告](../../release-c-preparation/source/FRESHNESS_INDEPENDENT.md)。

| 发现 | 实际候选位置与触发条件 | 必须修复 |
| --- | --- | --- |
| UCF-01 P1 | `:168` Worker/helper、`:181–187` Status 先完成；`:189` recovery、`:190–191` 慢 session/完整 reread 后，`:192` 才用 `observedAtMs:Date.now()` | 将完整慢检查和最终 provenance 检查放在末动态采样之前；保留真实 native 返回/身份完成时间，不以返回点续期；有限、非负、<=5000ms，失败保留原 attempts/stages |
| UCF-02 P1 | `:117–118` Django/journal 与 `:132` chain 只初读，慢读后没有末尾比较 | 最后以原 `verifyInstalledHead:true` 完整解析核 chain-state/head binding/manifestPath，重核 phase-validated Django raw digest 和 journal previous/条数，然后 Worker/helper/Status；保留原 lease |
| UCF-DIAG | `:184–186` native 已返回，但 parse/readiness 失败没有附原 result.processEvidence/受限状态 | 移植已审 bounded capture catch；原完整断言与 NotReady 不重试保持，不存正文/reason/PII |

独立 VM 执行的是候选实际完整函数，外部只用 synthetic reads/operator 与虚拟时钟。六项检查成功复现缺口，**不是候选六项安全测试通过**：慢恢复＋reread 的旧 Status 为 302000ms 却返回年龄0；另以 full 模式、recovery 零耗时，仅最后源码重读180000ms＋写尝试2000ms，仍把182000ms旧响应标为0。慢读中 Django/journal/head manifest path 漂移也被接受，各只读取一次。native exit0 后 NotReady 正确拒绝，但实际返回 process/bounded readiness 未附在该错误上。

上述数值是受控时钟负例，不是生产耗时或真实故障归因。原23项通过的覆盖和来源契约未在本轮复审，不能据其数量推断已移植补丁；真实文件明确没有末尾 guard、真实响应时间或年龄拒绝。

已执行的 inline body 与工具返回 stdout 后续原样保存为：[五项代码](INDEPENDENT_VM_FIRST.cjs)、[五项输出](INDEPENDENT_VM_FIRST.stdout.log)、[full 零恢复延迟代码](INDEPENDENT_VM_FULL_MODE.cjs)、[对应输出](INDEPENDENT_VM_FULL_MODE.stdout.log)。保存没有重跑；它们不是冒称执行前已存在的磁盘捕获文件。执行 cwd 为本 preparation worktree，所用实际候选 SHA 与夹具种子范围见机器记录。

附带静态核对 [REPORT.md](REPORT.md) 与 [CANDIDATE_AUDIT.json](CANDIDATE_AUDIT.json)：5157/5160、92c/ad21、十 tools、19 keyFiles、两个原 C helper/四个合成核心、115fb 与来源元组及审查范围一致；五个原报告 Markdown 链接存在。原 binding 日志 SHA `13c1b71…` 与 23 pass/0 fail 尾数实读一致，未重跑。没有据此独立重算源树、dist/node_modules 或签来源契约/其他功能。根后续报告新的 Django PrepareApp `1e1138feef7148fb851713c2b39a25d0` 已存在：原截点 B02 的缺收据表述应更新，安装顺序/完整兼容验证仍待闭合，不能将新收据等同该层通过。

最终正文一致性已核定：REPORT 原字节 SHA `e15588715bbbac273508cb46e7f138c216cd024728a40d41ec91b0b6e0f63ac6` 已改正 B02 并明确 UCF-DIAG，八个相对链接存在。`audit-django.mjs` 的 path/LF/file-SHA、ordinal UTF16 排序、LF join 和 UTF8 hash，与实际旧 `django-local-service.ps1:1181–1210` 的 v2 指纹协议在本次实际路径集合一致。Django audit 记录前后各2933文件，差异准确为两个工具加 `.wrangler/cache/cf.json` 三路径；原两路径断言失败保留，缓存产生因果明确为推断。报告没有把新 PrepareApp 或静态树一致冒充真实消费者调用、切换顺序或新鲜就绪。此次只比对脚本/记录/正文，不复跑全树，也不接受候选其他未审功能。

建议由统一候选拥有方把已审时序/provenance/capture 精确移植到 SourceBindingCollector，再核最终字节和负例并创建新的不可变候选。不要就地改旧 release 或沿用失效的旧 manifest/计划/批准。此次没有重复开发该来源契约或扩展为整份候选验收。
