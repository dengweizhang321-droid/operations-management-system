# PiAgent 一期交付报告

日期：2026-10-17。本任务在独立 `codex/piagent-phase1` worktree 开发和验证，原用户主工作区的既有改动保留。源码验证和独立审查支持合并及对应制品准备；生产是否采用，以用户手动发布的实际回执为准。

## 实际完成

- 接入固定版本 **Pi 1.3.0** 的真实长驻 RPC 进程；独立 rootless Runner、持久 HOME/工作文件/会话，空闲停止与重启恢复。
- Django 八张独立 Pi 表及专用 queue，明确 `pi_rpc` 执行类型。旧 Agent/DAG 的 20 模型轮次、40 工具、64 微步骤、240 秒及领取规则没有全局放宽。
- 服务端 operation、epoch/generation、seq/eventSeq、唯一执行权、正文幂等、短能力凭据、模型/工具派发及用量审计。unknown 冻结原操作，不换标识重发；安全停服务与保留未知账本分别判断。
- 模型复用原配置、凭据和受控 provider 传输；保留可调输出、上下文、推理参数和总任务期限。思考/私有回执加密缓存，Runner 审计只保安全回执，不落 capability 或私有 thinking。
- 中央注册表逐项开放 `pi_agent` 只读能力，新异步导出与带源版本的网店分页 reader；原明细权限保持。导出 manifest 保留范围、字段/单位、来源、水位、截止日、完整性、行数与文件摘要，缺口明确披露。
- 通用字节产物和上传、被动下载、manifest、owner/session/operation/generation/SHA 绑定。安全嵌套产物保留相对来源，显示名独立；HTML/未知 MIME 不以主站权限执行。
- 三项预置 Skills：销售推广库存联合分析、积压及补货建议、Excel 报告。真实资源加载、选择和 `/skill:name`、实际脚本执行、run 版本/资源清单、空闲原子更新和重新发现；资源错误明确拒绝。
- 原 AI Agent 入口内的模型/技能/单店范围、上传下载、状态/过程/来源、停止、刷新恢复及参数恢复。失联不自动重复 POST，权限变化隔离旧内容；店铺选择独立于 ERP 渠道 scope。
- 有限 `0084_pi_agent_independent_runtime`、149→150 recipe、原生安装器、权限配置顺序与首次 `PreparePi` 准备入口。未把结构迁移捆绑业务数据导入或全库备份/恢复。

## 验证证据

各组有重叠，不合并成一个总测试数。

| 范围 | 实际结果 | 证据 |
| --- | --- | --- |
| Django 权限、账本、恢复、模型、数据集及直接旧 Agent/DAG/pandas 回归 | 94/94 | [日志](django-final-tests.log)、[后端说明](backend-validation.md) |
| PostgreSQL 149→150 结构、回滚、角色、catalog、unknown 与旧队列隔离 | 精确结构证明通过，Pi runtime 29 项通过；生产未触及 | [绑定证明](schema-validation.json) |
| Django→HMAC Runner→真实 Pi/容器→异步导出→文件桥→真实技能脚本→Excel | 三轮 1/1，23.120 秒，进程 exit 0，测试库销毁 | [原始日志](postgres-real-stack.log)、[元数据](postgres-real-stack.json) |
| 真实 Pi/RPC 与资源、技能、重启 | 原 21 项及最终定向修复组通过；含 22 模型轮次、42 实际工具调用和三技能脚本 | [Runner 证据](runner-validation.md) |
| 中央工具与薄 Worker | 34/34 | [日志](tool-validation.log) |
| 有限发布 recipe 与 Install→AI grants→Finalize、unknown 不重放 | 52/52 | [日志](release-validation.log) |
| 实际 React 组件浏览器交互 | 1/1，无在线预览服务器；含失联、冻结后新建和不可用模型恢复 | [日志](browser-validation.log)、[前端说明](frontend-validation.md) |
| PS5/PS7→CurrentUser DPAPI→真实已签名隔离 Runner probe | 通过，未调用正式 Start/Stop | [证明](native-signed-probe.json) |
| 首次安装准备 | 私有 Linux 文件安装、真实镜像 inspect、原 intent/重复、错误来源/镜像拒绝通过；systemd hook 为受控夹具 | [证明](prepare-validation.json) |
| Worker 后端职责边界 | 706 模块，0 违规 | [结果](boundary-validation.json) |

审查使用未参与实现的新上下文，局部并发/unknown 采用项目规定的 Sol XHigh；模型调用工具未提供可独立证明的底层实际模型回执，记录的是所请求型号。发现的阻断已修复并做增量核验，见 [独立审查](review.md)。

真实 Pi/容器/数据库与合成模型边界分开：供应商 HTTP 和中央 edge HTTP 使用隔离合成响应，不使用 FakePi，不发送真实付费模型请求。该验证证明运行、隔离、权限和文件机制，不能冒称生产数据分析质量或真实供应商已验收。

## 发布及首次启用

固定人工入口为 `D:\codex-isolated\main-manual-release-20261016\发布main.bat`；自动准备和状态查看复用同目录既有入口。main 控制工具需要纳入 Pi 有限 schema spec，使用既有 `install-main-prebuild.mjs` 更新准备工具；不整体更新用户脏主工作区，不改变历史 nativeToolsSource 或旧未知批次。

应用和结构发布后，Pi 默认仍未配置。首次由操作者执行已部署 `django-ai.ps1 -Action PreparePi -PiImage <精确ID>`，自动生成独立 DPAPI 通道配置及固定 Linux 安装，不启动服务；随后沿原 AI 受控 Start/Stop。操作和恢复边界见 [运行说明](../技术专题/AI助手/pi-agent-runtime.md)。

本任务不部署生产、不执行正式迁移、不启停正式服务、不导入真实业务数据、不发外部消息。合并、推送及制品实际状态另由最终交付回执记录，不用本文替代原生发布记录。

## 保留的限制

- 真实供应商付费闭环、正式 Runner 首次采用及生产数据分析尚未验证；隔离验证没有复制生产模型密钥。
- 总工作区字节/文件数为软扫描，存在窗口超调；CPU、内存、PID、tmpfs 和单文件为硬边界。
- Skills 勾选控制活动发现/命令集；可信镜像资源库仍可读，不宣称勾选形成文件系统权限。
- 原明细限制、无店铺归属的数据拒绝，以及来源缺数/水位不确定继续保留。库存脚本只作建议试算，正式指标消费原领域口径。
- 文件按会话持久保留，无自动删除 TTL；物理删除走受控维护，不能清掉 unknown 证据换取继续执行。
- 早期 marker 竞态和 PG 线程连接清理失败已定位、修复并保留原证据，未以后续成功回填旧失败。
- 网页终端、会话树、完整扩展 UI、公开联网、业务写入、真实 n8n 和多 Pi DAG 留后续。
