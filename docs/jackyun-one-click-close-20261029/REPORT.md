# 吉客云五表一键闭合

从最新 `origin/main` 的 `d95852dd8542e95b8927787c1e7b082a16a5b215` 创建独立 `codex/jackyun-one-click-close-20261029` 工作树。本轮只开发、审查和检查构建必需代码；未合并、准备生产制品、上线、启停服务、释放11026或补跑业务。

## 页面与语义

实际入口为「数据导入 → 链路规则 → 吉客云 ERP · 五表」。复用 `app/import-chain-rules-view.tsx` 的矩阵、规则抽屉、按钮和现有主题，在单元格与详情中共用 `JackyunCloseControls`，没有只修改旧工作流页。卡片显示目标编号、部分导入模块及不能闭合的具体原因。

闭合结束旧逻辑任务并拒绝旧派发，保留原 n8n 失败、原计划、原文件、检查点、批次和已提交事实。不调用业务导入、finish、导出、重试或成功标记；不声称零效果。完成后由用户从 n8n 普通手动入口创建新的完整运行。已发送的 Webhook 不保证消失；迟到入口在持久目标校验时拒绝进入旧业务。

可直接打开[单文件 HTML](一键闭合.html)。该文件内嵌样式、脚本和合成数据，展示部分导入、仍运行、提交未决、半闭合和已闭合状态，不连接真实服务。按当前指令未启动浏览器或执行交互/功能验收。

## 权限与持久边界

- Worker `/api/imports/recovery/close` 要求真实 `admin`、无限制数据范围和同源写请求。Django `/api/workflow/jackyun-close-authority` 再次校验真实 principal，复用现有 `WorkflowWriteRequestReceipt`，使用独立 close action，不能把普通 retry 权限当闭合权限；没有新增表或迁移。
- helper 的 loopback POST 只接受 UUID，并从上述受保护接口回读有效授权、工作流、精确目标和摘要，不提供无授权可写的闭合入口。
- 原锁内重验活动源、逻辑归属、原计划、恢复链、原 JSON 证据摘要及 n8n 明确失败终态。五个领域只读取原 scope 和精确 checkpoint 的公开 recovery GET，不能把 `waiting`、提交未决或服务不可用解释为无写入。
- `operator-closures/<logical>/intent.json` 是永久拒绝边界。完整 intent 先在同卷 staging 目录持久化，再无覆盖发布整个目录；原活动索引归档后才 create-only 写 `closed.json`。任何未完成 intent 暂停吉客云新领取，完成后只永久封禁原逻辑/source/failed ID。其他平台没有安装该持久围栏。
- 活动索引通过同卷硬链接 create-only 归档、验证同一文件身份后移除原名。若中断留下双名，只允许同 inode/device、精确原字节和 nlink=2 的同请求补尾，不覆盖新 active。旧 plan、control、checkpoint 不修改。
- close journal 保存原授权。授权有效期内复用原 UUID；超过7天的半闭合由当前管理员显式重授同 target 和原 `closeRequestId`，只补尚未完成的闭合步骤。普通授权 TTL 保持原值，不删除原 intent 或用新 ID 换目标。完成回执不依赖未过期授权或当前新任务空闲。

## 隔离槽与支持范围

主线程为每个 slot 保留唯一 instance、真实 `Worker.exit` 完成见证及前门 inFlight 数。闭合先同步冻结原 slot 并阻止新的共享资源领取；活线程、在途转发、其他正在使用资源的工作流均拒绝。不会终止共用 helper 或任意浏览器。

Windows 只读进程核验仅保留 primitive 计数，要求 owner/current helper 后裔、专用 Profile/端口进程及调试端口均已退出。无法取得证据时拒绝，不把读取失败视为不存在。旧锁仍由当前共用 helper PID 持有时，还须精确退出 slot 见证及完整 ownerToken、PID、processIdentity、runId、purpose、acquiredAt 一致；在原 recovery mutex 和原 publication fence 下先落永久 intent，之后原样归档旧锁，再取得正常 close 锁。无 slot 的同 PID 锁不能走此分支。旧 helper 进程已退出时，保留现有 stale-lock 身份规则并先核资源退出。

支持正常失败终态且资源空闲的任务，以及有真实线程退出和资源退出证明的失败隔离槽。允许保留部分已提交批次；`complete_intent`/`committed` 必须回读为精确已提交终态。提交请求无明确终态、未知正在提交、活线程、缺失进程证据、损坏/变化的原证据都保持 blocked。仅 `uploading` 且未发出完成请求时，可保留其未提交或未知事实，不改成零效果。

11026 的交接证据为货品、库存、库龄已提交，销售尚未形成上传 checkpoint；这是该能力拟支持的情形。本轮未对11026执行任何闭合或释放操作，也不把源码交付当该任务已恢复。后续采用时旧 helper 的 quarantine 可能影响既有排空；仍须按当次授权和原生命周期门禁处理。

## 旧派发与读取兼容

在共享前门领取、A–E、自动 retry-context/reserve、持锁 budget/claim、人工既有 intent 回读、实际 send 前和 pipeline 原锁内安装闭合围栏。现代入口从 n8n 持久 entry 读取逻辑/失败/人工授权身份；有无 caller header 均不能隐藏旧目标。旧入口继续按持久固定计划核身份。

相关人工授权按真实 UUID 写 revoked。bound `retry`、`new+supersedes` 与精确终态 consumer 均检查；新的人工派发 intent 保存完整 authority 和 target，并核原摘要。历史无 authority 的 intent 只有在 createdAt 合法、非未来、且已超过原7天 TTL 时才留存 `unresolved` 记录，不伪称已撤销；缺时间、未过期回读失败或泛 new 尚无终态消费证明会阻断闭合，不泛撤其他逻辑。

正规 closed 索引让活动索引已归档后仍返回 `closed`/`closing`。读取兼容既有11023的一次性 `operator_closed_partial` 真回执，保留其部分效果语义；若闭合之后还有更新的原计划而 active 缺失，仍失败关闭，不能猜作空任务。

## 检查与交付范围

[CHECKS.json](CHECKS.json) 绑定本轮代码和 HTML。三个真实入口以 esbuild 内存编译通过，均0错误、0警告，没有执行入口或形成生产制品。Python三文件 AST 与嵌入 PowerShell 的 Parser.ParseInput 通过，未执行进程检查程序。目标 TypeScript 依赖图与 HEAD 原字节基线比较，双方各6个既存诊断，新增0；未修改这些 JD/销售/天猫历史类型问题。HTML 经 Windows `file:///D:/...` 读取及内嵌脚本语法检查通过；未做浏览器功能验收。独立 Sol 只读审查的原发现已修复，最终源码无剩余已确认阻断。

本轮完整差异涉及 Worker/页面、helper、Django 和文档，无新增 migration，发布范围为 Worker+Django。main 内已有但尚未采用的销售0012及153→154 recipe 保持原字节；原检查绑定的86份源码哈希全部未变，无须重绑该 recipe。后续制品准备仍由原范围工具按真实尚未采用的结构决定配套迁移，不能把本轮“无新迁移”说成0012已上线。

未运行功能测试、业务接口/权限场景验收或综合验收；实际使用由用户采用后检测。后续按「单独授权合并 → 单独授权准备制品 → 单独授权发布」推进，本地提交不代表这些阶段已获授权。
