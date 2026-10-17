# Pi Agent 一期前端与薄 Worker 验证

日期：2026-10-17。状态：工作树源码与隔离验证完成；未提交、未部署、未操作正式服务。

## 正式入口与复用

- 正式入口复用 `app/ai-module-view.tsx` 的既有 AI → Agent 工作流页签；页内默认进入 Pi Agent，原 Agent 工作流通过同级子页签保留。
- 新工作区 `app/ai-pi-agent-view.tsx` 复用既有 `ai-workbench` 布局和主题、`SearchableSelect` 模型选择器、`AiMarkdown` 内容组件，以及主系统 `subnav`。新增 CSS 只补 Pi 技能、事件、范围和附件区域。
- 数据全部来自 `/api/ai/pi/*`；产品页面没有内置演示账号、静态技能清单或伪造运行结果。浏览器验证夹具仅位于测试文件中。

## 已实现及对齐的契约

- 9 个 Next 路由文件仅导出 `forwardAiRequest`，覆盖技能、环境列表/创建、环境详情、消息、事件、停止、上传、文件元数据与文件下载。
- `lib/django/ai-service.ts` 对公开路径精确准入。Pi 读取和写入均进入所属 Django writer；显式 reader 请求拒绝，保留真实 principal/HMAC、响应 revision、超时和传输上限。
- `lib/ai/django-route.ts` 继续使用现有角色与同源保护。Pi 上传 JSON 有界为 720 KiB，消息 JSON 有界为 800 KiB；Django 分别继续验证实际附件字节与消息长度。Worker 不执行 Pi、技能、查询或导出业务。
- 文件 `/content` 仅被动转为附件响应，保留 `attachment`、`no-store`、`nosniff` 和 CSP sandbox；HTML 不在应用中执行。
- Pi 文件 JSON 响应上限单独设为 12 MiB，容纳后端允许的 8 MiB 文件经 base64 编码后的有界信封；其余既有 `/content` 仍保留 9 MiB 上限。
- 技能与安全模型来自 `/skills`；界面展示真实名称、说明、可用状态、技能标识和版本。禁用技能不可勾选。用户可勾选技能或输入 `/skill:技能标识`。
- 环境 GET 恢复、模型选择、技能选择、范围选择、任务提交、停止、增量事件、回答、附件选择/上传/下载及来源 manifest 均已接线。
- 浏览器在任何 POST 前持久化 `clientRequestId/sessionId/kind`，不持久化任务正文、附件字节、凭据或模型配置。成功消息及停止也等待 GET 回执协调：消息匹配 `operations[].clientRequestId`，停止匹配 `controlRequests[].clientRequestId`；文件丢响应可匹配 `files[].clientRequestId`。创建丢响应由环境列表的 `createClientRequestId` 恢复。
- 刷新、断线恢复和轮询只执行 GET；未知请求保留原标识，界面禁止同环境新消息，不自动重发模型请求。
- 具有明确 4xx 拒绝响应的请求释放该次待核实标识，允许用户修正参数；网络丢响应和服务不可用仍保留原请求，不自动生成新标识重试。
- 对齐后端状态 `succeeded/failed/canceled/canceling/unknown/frozen`。未知操作保持发送围栏；权限收窄冻结立即清空旧消息、附件和草稿，提示新建环境。切换环境取消旧读取，并用 generation 防止迟到响应覆盖新环境。
- `/skills.scope` 和 `session.scope` 作为当前授权及当前环境的范围元数据；部分空白维度继承服务端范围，全空消息省略 scope 由后端继承当前环境。新建环境支持初始 scope。范围变化隔离旧消息与附件；需要附件时，按“先选范围 → 新建环境 → 上传 → 提交”执行，范围尚未应用时禁止选择旧附件或上传。
- 单店选择使用独立 `shopSelection: {platform: "京东" | "天猫", shop: "精确店名"}`：界面提供平台选择与精确店名输入，环境创建与本轮消息均可传递；不把店铺伪装成渠道，也不改 principal scope。恢复环境后显示“仅该店”，省略字段沿用当前环境；更换店铺产生新 generation 并隔离旧上下文和附件。无平台店铺的可枚举接口时不伪造店铺清单，精确名称由服务端校验。
- 环境列表按 30/60/90/100 有界读取，100 条后仍有更多时明确提示截断；保存的当前环境标识仍可通过详情 GET 恢复。

## 实际验证

在独立 worktree `D:/.codex/worktrees/piagent-phase1/运营管理系统` 使用该树依赖执行。

```powershell
node --import tsx --test tests/ai-pi-frontend.test.ts tests/django-ai-service.test.ts tests/ai-business-source-forwarding.test.ts
node --test tests/ai-pi-browser.test.mjs
npx eslint app/ai-pi-agent-view.tsx app/ai-module-view.tsx lib/django/ai-service.ts lib/ai/django-route.ts tests/ai-pi-frontend.test.ts tests/ai-pi-browser.test.mjs
git diff --check
```

- 范围 Node 测试：19/19 通过。覆盖精确公开路径、writer 归属、禁止 reader 覆盖、路由方法、真实同源/角色解析、有界上传和消息、8 MiB 文件的实际 base64 传输及 12 MiB 信封拒绝边界、被动下载安全头、精确请求协调、未知状态发送围栏、范围继承及事件序号合并；同时回归原 AI 服务及既有文件下载入口。
- 实际 React/Chrome 无服务器测试：1/1 通过。测试将真实组件 bundle 写入临时单文件目录，以 `file:///D:/...` 加载，并用合成 fetch 响应替代网络。验证先定范围后创建/上传、真实组件技能选择及不可选状态、模型默认选择、上传附件引用、POST 发前 requestId 已持久、服务端已接受但 POST 响应丢失、刷新后只有 GET、停止持久回执协调、同会话下一轮通过独立 shopSelection 收窄为单店且 scope 不变、旧代际内容隔离、权限冻结清空旧内容，以及旧环境读取迟到不得覆盖新环境。测试结束关闭浏览器并清理独立临时目录。
- 范围 ESLint 和 `git diff --check` 通过。
- 范围 TypeScript 编译器 API 验证通过：以本项目 tsconfig 选项、`cloudflare-runtime.d.ts` 及五个目标文件（Pi 页面、AI 模块入口、AI transport、薄路由、Pi 前端测试）建立独立 program，结果为 `{"targetFiles":5,"targetErrors":0,"dependencyDiagnostics":0}`。保留项目环境声明后，目标文件及其实际依赖均无类型诊断。
- 尝试 `npx tsc --noEmit --incremental false --pretty false`：现有仓库有大量范围外类型错误，例如 `app/product-module-view.tsx` 的 `productKind`、既有文档 demo、market annotation headers 和旧测试夹具。输出未出现本次修改文件的类型错误；未把全仓 TypeScript 宣称通过，也未扩展修复无关代码。

## 验证边界

- 浏览器测试验证正式 React 组件与可恢复交互，接口返回为合成夹具；不代表真实 Django/Runner/供应商链路已执行成功。
- 薄 Worker 测试在受控服务接缝处替换 Django transport，同时保留实际同源、JSON 边界与响应生成代码；真正 Pi SDK、技能文件、PostgreSQL 幂等和 Runner 回执由后端/Runner 专项验证负责。
- 本子任务没有启动预览服务器，没有调用真实模型、真实业务数据或正式上传，没有执行迁移、发布、启停、提交或推送。
- 新代码仍需主代理统一整合与独立审查；候选验证通过不等于已上线。
