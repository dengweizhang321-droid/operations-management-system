# PiAgent 一期 Runner 隔离验证

2026-10-17，仅源码候选和隔离验证；未安装正式 Pi 服务、未启用生产、未调用付费模型、未操作已采用 pandas broker 或其容器。主任务的 Django/Worker 联调与最终交付状态由主报告另行记录。

## 冻结材料

| 材料 | 已核值 |
| --- | --- |
| 真实 Pi npm 包 | `@earendil-works/pi-coding-agent@1.3.0`，精确版本和完整 lock |
| 镜像 | `sha256:c393a84818c0c7f941803da2db11b1cd94395b8188b69af7294490468a48e26d` |
| 保留标签 | `pi-phase1:reviewed-c393a84818c0`（运行仍绑定上列精确 ID） |
| Runner package SHA-256 | 以 [validation.json](runner/validation.json) 的最终 `sourceSha256` 为准；此前完整 21 项的源码 SHA 为 `c225ef9dc35a9f9382cb64e4b725560cff51756d843b0bdc03b2883b05ae8415` |
| 基底 | `python@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea` |
| 容器 Node / 构建 npm | `24.8.0` / `11.6.2`，官方 npm registry integrity 核验通过 |
| 技能 | 三项预置技能，实际 `1.0.0` 和有内容差异的 `1.1.0`，逐资源大小及 SHA 清单 |

Windows 当前源码和真实 Linux 测试副本计算的 package SHA 完全一致；测试文件和 `__pycache__` 不进入该摘要。镜像来源是固定 Python 基底加经过官方完整性核验的 Linux Node/npm 归档，不能表述为已测试 Docker Hub Node 镜像。下载镜像归档只作字节获取，不替代官方完整性来源。完整材料见 [image-provenance.json](runner/image-provenance.json)、[validation.json](runner/validation.json)。

## 实际结果

Linux 完整验证命令为 `python3 -m unittest pi_runner.test_protocol pi_runner.test_real -v`，在新的 `pi-test-*` 私有命名空间运行：**21 项通过，46.096 秒**，其中 8 项协议测试、13 项真实 Pi/rootless Docker 测试。原始日志见 [real-pi-tests.log](runner/real-pi-tests.log)。Windows 另有 1 项真实 CurrentUser DPAPI 测试通过；该测试注入传输，仅证明密文包装 SHA、解密后通道 SHA 及错误绑定早拒，不能当成已运行正式服务探针。

此后独审要求补上重启 unknown 容器的精确停止：仅修改 broker 源码及相应说明，镜像不变。同时将 creating/updating/freezing 一并纳入重启 unknown，并在 capability bind/文件导入前持久化新 operation fence，防止归属仍停留在上一轮。按直接影响范围运行对应 Ledger 状态测试与 `pi_runner.test_real.RealPiTests.test_12_crashed_active_operation_cannot_replay_new_id`，**2 项通过，3.234 秒**；真实测试启动持续写文件的后台 bash，确认文件增长，再模拟 broker 中断和重启，核验原精确容器 Running=false、状态仍 unknown、可观察/可 dispose、同 generation 旧卷不可续跑。日志见 [unknown-restart-final.log](runner/unknown-restart-final.log)。其他通过结果按未修改范围复用，不把该定向验证冒称再次完整运行 21 项。

最终独审收口追加 audit cache 脱敏和 Stop readiness：运行全部 12 项协议测试，以及真实 unknown 停止边界、private frame/cap 审计扫描、其余两项技能脚本三项容器测试，**15 项通过，10.286 秒**，见 [cache-stop-skills-final.log](runner/cache-stop-skills-final.log)。另对真实 prompt/ack 被动回读加断言，**1 项通过，3.271 秒**，见 [operation-replay-final.log](runner/operation-replay-final.log)。Windows 最终对应协议与 DPAPI **13 项通过**。镜像仍为 c393，最终 broker 源码 SHA 为 validation.json 的 `sourceSha256`，未重跑无关用例。

缓存只保安全回执：pending gateway capability 不写 SQLite，私有 thinking/providerFrame 从持久事件和缓存递归剥除，文件 base64 不复制到命令缓存；中文公开结果和 eventSeq 保留。旧缓存启动时 secure-delete 清理、checkpoint/VACUUM，原始 SQLite/WAL 扫描未发现合成 capability/私有 thinking 标记。模型续会话所需私有签名仍在原生 Pi session，不另复制到审计 SQLite。

Stop readiness 保留 unknown 事实：health 实时核 full container ID、名称、标签、镜像、卷及 Running，返回 unsafeUnknownCount 与 unknownStoppedVerifiedCount。真实测试在 unknown=1、stopped verified=1 时允许停服务；重新启动该精确容器后 unsafe=1 拒绝；再次精确停止后恢复安全。不以改写或清空未知账本换取停服务。

真实容器测试覆盖：

- 实际 `/skill:excel-report` 展开、技能资源 read、bash 调用镜像内 Python 脚本，产出含“分析结果/来源/指标口径/缺失数据”四表的 XLSX；中文和 Unicode U+2028/U+2029 保持完整 JSONL 记录。
- 同一容器跨轮保存 HOME；空闲停止/恢复和技能版本更新重启后，首轮随机挑战及 assistant 回答实际出现在下一次模型请求的 messages 中。
- 真实 prompt acceptance response、agent_end、agent_settled、文件收集、application ack 分离；`handled` 无 agent_start；abort 等待真实 agent_settled。
- 真实 **22 次模型协议轮次、42 次容器内本地工具执行**，超过旧 20 round/40 tool 限制，没有调用付费供应商。
- 实际 non-root UID、无网络、只读根文件系统、无 Docker socket/密钥环境、cgroup CPU/内存/PID 值；短 capability 没有写入 HOME/session 文件。
- 忙时拒技能更新；空闲实际 1.0.0→1.1.0 生效；空选择/单选/新版本首次创建；篡改模型可写的 workspace selector 不能改变下一次启动授权版本。可信选择只从容器外 runner_init stdin 第一帧加载。
- 终态 broker 重启保留工作区；活跃状态重启变 unknown，在完整核验身份后精确停止原容器并回建可观察/可 dispose 引用；新 operation ID 不能绕过；精确清理 unknown 后仍不能在同一 generation 复用被冻结卷。
- 工作区文件数软上限触发后，精确停止目标容器并回查不再 Running，才标记 frozen；有签名 thinking frame 保留完整 protocol/model 配置绑定，未散发成无绑定 reasoning 字段。
- 真实选择 sales-promotion-inventory 与 stock-replenishment，逐一 read SKILL.md/reference 后 bash 执行 join_summary.py 与 replenish.py；核验合成退款 -120 分保留、显式输入试算建议 5 件，并披露合成来源、成本/真实快照缺失和草稿性质。三项预置技能都已实际执行相应脚本。

## 协议与部署材料

独立 `127.0.0.1:8123` HMAC HTTP 入口、operation/epoch/generation/seq、全会话 eventSeq、poll gateway、输入输出文件通道、技能包安全、资源边界及安装说明统一见 [Runner README](../../backend/pi_runner/README.md)。原生 Django 运行包自带 `backend/pi_runner/bundled_skills`，不依赖宿主技能目录。镜像构建入口是 `containers/pi-agent/build_image.py`；合成真实容器测试入口是 `containers/pi-agent/run_real_wsl.py`；Linux fresh installer 和 Windows opt-in 生命周期均在 `backend/pi_runner`。

正式 Windows 配置区分 `keyFileSha256`（DPAPI 包装文件原始字节）和 `channelKeySha256`（CurrentUser 解密后的独立通道密钥）。正式生命周期固定发行版、账号、unit、源目录与镜像；测试只调用显式测试 namespace 的已签名探针验证函数，不增加生产环境变量绕过。

## 限制与追溯

总工作区字节数和文件数是周期软扫描，存在扫描窗口超调；CPU、内存、PID 和 tmpfs 是内核边界。重启发现的 unknown 会话已精确停止，保留观察和精确 dispose，不自动续跑或重放。运行中发生 unknown 时软扫描会跳过它，由外层冻结及 dispose 处理；不能把总磁盘描述为硬配额。

库存技能中的脚本是明确输入下的通用试算，正式库存域口径优先。京东已有的近30日、逐仓、采购/调拨两类在途及负可用库存规则，应直接消费库存后台的正式预计算，不能把脚本可变窗口试算冒充同名正式补货指标；该脚本当前拒绝负 available，此类来源不能转零或强行套入，应回到现有领域工具。

早期候选曾暴露跨 Windows/Linux 路径排序影响 manifest、默认/单选创建处于 creating 状态、模型可写 selector 漂移、quota 停止证明竞态、重启 unknown 引用丢失等问题，均已针对性修正并进入上列真实测试。早期 4e 镜像在同一 candidate 标签重构后无法 inspect；没有执行镜像删除或 prune，最终 c393 已增加保留标签。旧失败日志保留于 `D:/codex-artifacts/pi-phase1-real-tests*.log`，最终报告只把当前 frozen 源码/镜像实际通过的结果计为通过。
