# AI 隔离功能验证报告

2026-11-08。**本轮有限代表性功能验证已执行并收尾，已测场景通过。仍保留完整宿主登录、真实 Runner 日报周期、真实供应商资格及外部投递等未验项；不能称 W1–W12 全量验收通过。**

[直接打开 HTML](REPORT.html) · [逐项矩阵](MATRIX.md) · [最终 Git/证据绑定](D:/codex-artifacts/ai-isolated-functional-20261108/DELIVERY.json)

## 本轮实际补齐的链路

- 聊天经过真实签名 HTTP、PostgreSQL、原中央工具桥和 HTTP/SSE 供应商夹具。普通/推广分流、逐块流式、重复去重、派发前后取消、断流后的原 ID unknown 围栏通过。页面补验现有真实 handler 交互 7/7，未宣称真实 DOM 登录链。
- 周报实际从私有网店库经 Worker 工具读取，生成、待审、批准和下载 HTML。活动别名、改模型拒绝、终态复用、HTTP429、版本漂移及 DAG 同轮推进通过。单个字段完整 SPU 的客户/访客转化率为10%；汇总缺客户字段，不把原始数值当可用转化率。
- Pi 使用原签名 Runner 和真实镜像：一槽容量拒绝、停止保卷和唤醒、同卷文件回读通过。冻结技能1.3.0在当前目录1.2.0的 worker 中仍按精确摘要加载，并产生可读取的四工作表 Excel；他人下载404。
- Pandas 经过真实聊天、注册工具、三页商品日与销售品类导出、签名 Broker、无网容器和原 CSV 产物。9品类不完整来源在 Broker 前拒绝，容器代码错误保留诊断且清理成功。
- 私有注册账号验证记忆、会话、角色知识、后台停用和无签名拒绝。另验证非空平台范围允许京东、拒绝天猫，以及范围收窄后旧会话不可见。Pi/CSV资产跨用户拒绝有实际HTTP证据。

分项：[聊天与权限](CHAT.md) · [报告、指标、DAG与日报](REPORTS.md) · [Pi/Pandas](RUNNERS.md)。实际原件集中于 `D:/codex-artifacts/ai-isolated-functional-20261108/`。

## 真实层与未覆盖范围

| 层级 | 本轮状态 |
| --- | --- |
| PostgreSQL、Django、中央工具、业务查询、调度函数、HMAC、Runner、容器、文件 | 使用真实实现；独立账号/角色、目录、端口和合成业务事实 |
| 供应商模型 | 独立回环HTTP/SSE夹具；保留实际协议、传输、延迟、HTTP错误、截断和请求次数，无真实付费账户 |
| 用户身份 | 原内部签名+数据库用户与权限服务；关闭LOCAL_DIRECT_ACCESS。仓库宿主认证入口无本地会话签发，正常宿主登录未验 |
| W12完整日报 | 新增8个来源/范围反例通过；共享开发环境原门禁409。旧两组12项是协议/状态机证据，含Pi终态注入，不是真实Runner日报整链 |
| W8/W10/W11a | 按未变输入保留前阶段有限证据。本轮未实际发送钉钉/邮件/云消息，未验证真实Images/Schema资格，未重做文字方法发布全链 |
| 其他有限缺口 | DAG容量等待本轮未新增实测；Pi多槽并发、长模型历史恢复、常驻worker调度、全部资源/渠道/仓库权限组合未覆盖 |

Windows到专用WSL的原生自动localhost映射实测不可用，本轮采用专用透明TCP/stdio中继，签名端到端保留；此结果不能冒充原生网络映射修复。Python audit限制明确本轮端口，Worker outbound只允许两私有Django端点，容器无网；该组合不被称为系统级防火墙。运行角色为非superuser development角色，不替代生产最小SQL权限资格。

## 来源、改动与必要检查

本树 `D:/.codex/worktrees/bd66/运营管理系统`，分支 `codex/ai-isolated-functional-20261108`。从再次fetch的 `origin/main=0c7d0feb33f45cfc6ae1f283b81d401c873c5768` 建立，经 `4317b3255b583508be15a671dac4048f0b7f08d2` 显式merge已审 `684b6b94333fe3546b4793f28524e8c09f088fdc`。原三批、整合和原生阶段提交未重复cherry-pick。

本轮新增测试接线、验收脚本和报告，**没有修改应用、业务规则、控制器、依赖锁或发布工具**。初始失败均为测试接线/断言缺漏，包括读写同端点、受限配置读取、初始权限revision、UUID格式、接口状态码和Windows进程时间精度；纠正后在原库/原请求允许范围续接。没有通过清库、删除unknown或换ID重放已派发请求。

本阶段相对已审依赖仅tests/docs，原部署范围分类不要求新增应用制品；不变应用输入的既有G02/原生启动证据按原范围复用，未重做两轮全栈冷启动，也未把旧b728包当作含最终helper修复。本次新增脚本完成Python AST、Node语法、PowerShell解析及差异空白检查；交互7/7另有原件。没有重跑全仓测试或修历史TypeScript167条诊断。

可选收尾总账快照因测试选择了不存在的dispatch字段而未生成，原错误保留；不为该重复摘要重开服务。每个功能的原HTTP/DB账本证据及Astra独立只读查账已保存，unknown保持原状。

## 独立审查

全部请求 `gpt-6-astra/high`；工具未独立回传实际底层型号。审查者未实施被审工作，修订回原上下文复核。最终交付另用新上下文。

- [环境接线](REVIEW-ENVIRONMENT.md)
- [W3/W4聊天](REVIEW-CHAT.md)
- [用户隔离及非空scope](REVIEW-IDENTITY.md)
- [W5/W7/W9/W12分项](REVIEW-REPORTS.md)
- [W1/W2/W6/W11b分项及清理](REVIEW-RUNNERS.md)
- [最终交付审查](REVIEW-FINAL.md)

## 清理和交付

本轮Windows进程按PID、创建时间、命令及子进程身份精确停止；PG使用原pg_ctl正常停止。两套Runner单元、中继、两端临时密钥/profile已清理；私有Docker恢复inactive、WSL恢复Stopped。独立观察7个私有端口及本轮Python/Node/workerd为零，合成库、原失败和账本停止保留。旧4单元和24意图摘要保持，生产发行版/容器未操作。

三份已停Miniflare缓存文件保留。自动审批先拒绝精确私有缓存目录的递归清理，再拒绝更窄的三个文件删除，仅返回`blocked by policy`；未换工具绕过。其实际文件清单、大小及只读表行数见[缓存残留](D:/codex-artifacts/ai-isolated-functional-20261108/CACHE-RESIDUE.json)。这不影响已完成的进程停止与临时密钥清理，但不称全部临时文件已移除。

五个生产监听身份仅与上一阶段原件进行只读对照，PID及CIM微秒精度创建时间一致；不是本阶段新采集的起始快照或业务健康验收。原七小数精确比较的精度差异原件也保留。生成材料179文件/3,077,761字节对五项本轮私有凭据扫描零匹配；此为限定扫描，不是全磁盘秘密证明。

[清理原件](D:/codex-artifacts/ai-isolated-functional-20261108/FINAL-CLEANUP.json) · [Runner清理](D:/codex-artifacts/ai-isolated-functional-20261108/runners/RUNNERS-CLEANUP.json) · [生产身份限定对照](D:/codex-artifacts/ai-isolated-functional-20261108/PRODUCTION-COMPARISON-EXACT.json)

仅提交并推送开发分支，最终提交、远端回读和证据摘要由外置DELIVERY记录。本轮未合main、未准备正式制品、未安装生产控制包、未上线。后续是否合并由用户明确决定；若要求完整日报或真实登录验收，应先提供相应正常隔离入口或单独评审精确测试适配，不用本报告替代这些缺项。
