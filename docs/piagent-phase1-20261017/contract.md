# PiAgent 一期实施契约

状态：开发与隔离联调中；不是上线记录。

基线：远端 main `cdf1c5eb92e584e65e693cdf3e55b2a9a036a28c`。独立工作树 `codex/piagent-phase1`，主工作区已有修改不纳入本任务。

用户当前需求是权限内经营分析闭环，包含真实 Skills。保留 React/Vinext 和薄 Worker，Django 管身份、权限、账本和字节，独立 Linux/rootless Runner 管容器、Pi RPC、工作区和资源，Pi 管模型工具循环。旧 Chat/Agent/DAG/pandas 的限制与执行路径保持。

## 冻结的接缝

- 官方 npm 注册表和发布 tarball 核验的稳定版本为 `@earendil-works/pi-coding-agent@1.3.0`，依赖使用独立锁文件。RPC 的 prompt response 给出 `disposition=started|queued|handled`；真实 `agent_settled` 才证明自动工作全部落定，不能用 `agent_end` 代替。handled 无 run 直接按命令回执处理。
- 新建独立八表 `ai_pi_*`，不依赖旧 Agent 队列。会话唯一活动 operation，服务端 operation ID、代次、序号、幂等正文绑定；unknown 保留栅栏，不换键重放。
- Pi 容器 `network=none`，专属 Docker named volume 保存 HOME、会话和工作文件，不绑定宿主目录。可信扩展经 stdout 请求网关，Django worker 从已签名 Runner state 拉取请求，执行后回传；WSL NAT 不依赖反向 localhost 回调。
- 真实供应商凭据只由现有 Django 凭据和受控 provider transport 使用。所有模型派发先登记，结果未知不自动重发；工具每次重新核对 principal、scope 和显式中央 `pi_agent` 准入。
- 中央工具唯一声明仍为 `lib/ai/tool-registry.ts`。异步导出只返回小型句柄，后台逐页查询与审计，保留 provenance、字段单位、来源版本、截止日、完整性和摘要。原明细权限保留。
- 文件经对象 ID 读取，被动 attachment/no-store/nosniff/CSP 下载。上传、结果及缓存重新鉴权，代次变化隔离旧文件和上下文。
- Skills 从可信 bundle 配置与实际 Pi 发现共同验证，记录版本及整包资源摘要。只有当前获准选择进入 Pi 活动技能及命令发现集，运行中固定，空闲安全点更新并验证发现。镜像内的预置只读资源库仍可读，不将勾选解释成文件系统访问权限。技能不能扩展网关权限。

## 页面与公开接口

复用 AI 原 Agent 入口，Pi Agent 与原工作流为子页。公开路径 `/api/ai/pi/skills`、`models`、`sessions`、`sessions/{id}`、`messages`、`events`、`abort`、`files` 和 `files/{id}/content`；Pi 所属状态读取走 writer，因为权限变化可能冻结状态。浏览器失联/刷新只回读，不重发 prompt。

## 参考资料边界

同事《方案-Agent完整CLI能力-施工契约-2026-10-11.md》最终第 12、13 节仅作架构参考。采用长驻 Pi、稳定持久环境、参数恢复和技能安全点的方向。其生产授权、其他仓库路径、迁移号、进程生命周期令牌、网页终端和 `agent_end` 完成判据均不继承；以本用户范围和冻结版本官方协议为准。

## 交付边界

仅隔离合成数据验证。真实 Pi/容器与合成模型测试、真实供应商测试分别记录。生产由用户手动点击现有 BAT，本任务不部署、不启停生产、不写正式业务数据、不发送外部消息。结构迁移、有限 recipe、原生安装器和隔离证明随同源码交付，不执行全库备份/恢复。

官方证据入口：[npm 发布包](https://www.npmjs.com/package/@earendil-works/pi-coding-agent/v/1.3.0)、[官方仓库](https://github.com/earendil-works/pi)。实际协议以固定 tarball 内 docs 与 dist 源码核验结果为准。
