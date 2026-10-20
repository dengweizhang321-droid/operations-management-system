# 前端热更新与隔离演示预览

## 开发入口与硬前置

必须从最新 `main` 创建独立 `codex/*` 分支和独立 Git worktree，在该 worktree 内运行。**主检出不能启动预览**；仅在主检出新建 `codex/*` 分支也不满足要求。启动器还会拒绝链接运行目录及根目录含 `.env*` / `.dev.vars*` 的 worktree，不要复制生产配置、密钥、数据库连接或共享 `node_modules` 链接。

```powershell
git fetch origin main
git worktree add -b codex/my-frontend-change D:/codex-worktrees/my-frontend-change origin/main
Set-Location D:/codex-worktrees/my-frontend-change
npm run dev:hmr
```

`dev:hmr` 执行 `node tools/preview/launcher.mjs start`，默认不打开浏览器。`npm run preview:isolated` 与 `预览系统.bat` 保留 `start --open`，用于明确需要浏览器预览时。原有正式 `dev` / `start` 仍进入受控启动引擎，`build` 仍为 `vinext build`；新增入口不改变正式启动和发布流程。

需要预装 Node.js（版本要求见 `package.json`）和 Python 3.12+，首次安装需要网络。当前基线在缺少 Vite 依赖时执行 `npm ci`，创建 worktree 独立 Python venv，并按 `backend/requirements.txt` 同步后端依赖；不应仅凭已有 `node_modules` 就推断锁文件已同步。A 部分的最终依赖同步与启动检查行为尚待其最终提交核对，不能把计划中的增强当作当前保证。

正式页面使用 `http://localhost:3000`；开发页面使用 `http://127.0.0.1:3100/?module=inventory`，避免混用正式站点状态。不同主机名区分 origin/localStorage，但 Cookie 不按端口隔离；多个 `127.0.0.1` 开发端口也不能据此宣称浏览器会话完全隔离。当前基线 `--open` 直接调用 Chrome，未指定独立 `--user-data-dir`；A 最终浏览器 profile 行为仍待交付确认。默认 `dev:hmr` 不创建浏览器窗口。

## 并行端口与环境横幅

`TERUISI_PREVIEW_PORT` 支持 3100–3900。建议按 3100、3110、3120 等间隔分配，启动前核查**完整四端口组**，只检查前端端口不足以排除冲突：

| 用途 | 公式 | 默认组 | 本次必要隔离检查建议组 |
| --- | --- | --- | --- |
| Vite 前端 | P | 3100 | 3110 |
| Django 查询入口 | P + 15000 | 18100 | 18110 |
| 第二个 Django（内部 reader 调用等） | P + 15001 | 18101 | 18111 |
| 预览控制器 | P + 10000 | 13100 | 13110 |

例如 3100 与 3101 的 Django 端口会重叠，不能并行使用。第二个端口在实现中名为 `writer`，不表示浏览器可以提交业务写入。启动器遇到占用直接失败，不顺延端口、不停止其他进程；若有冲突，另选完整不冲突组。

```powershell
$env:TERUISI_PREVIEW_PORT = '3110'
npm run dev:hmr
```

保存前端代码后由 Vite HMR 更新，启动窗口保持运行；Ctrl+C 或另一个同 worktree 终端的 `npm run preview:stop` 停止。横幅复用现有页面组件，只在 `DEV` 与 `VITE_TERUISI_PREVIEW=true` 同时成立时显示：

> 开发环境 · 合成数据 · 禁止业务提交 · 端口 3110 · codex/my-frontend-change

端口来自当前 `.runtime/preview/session.json` 的 `port`，分支由预览 Vite 配置只读调用 Git 获取；页面只接收预览标记、端口、分支，不接收完整 session、控制 token、环境变量集合或本地路径。分支在 Vite 启动时读取，切换分支后需重启。正式构建的 `DEV=false`，不会显示开发横幅。

HMR 主要覆盖前端组件、样式等；Django 使用 Waitress，**没有 Python 自动重载**。修改 Python 后需停止并重新启动自己的预览；修改启动配置、依赖或 seed 也不能依赖前端 HMR 自动采用。不要调用正式服务的 restart 代替预览停止。

## 数据准备、保留与恢复

需要保留当前业务演示数据、再生成新数据时，顺序是 **stop → snapshot → prepare → start**：

```powershell
npm run preview:stop
npm run preview:snapshot
npm run preview:prepare
npm run dev:hmr
```

`prepare` 新建一套以当天上海日期为锚点的合成业务 SQLite，并切换当前库指针；旧库保留，不在原库重复追加。只需继续当前演示数据时，停止后直接 `start`，无需每次 prepare。已有旧库不会因 seed 代码更新而自动补齐 fixture，需按上述顺序主动重新准备。

| 命令 | 行为 |
| --- | --- |
| `npm run preview:snapshot` | 停止后保存当前业务 SQLite 的一致性副本，输出快照文件名及摘要清单 |
| `npm run preview:restore -- snapshot-<时间>-<随机值>.sqlite3` | 停止后校验本 worktree 的快照及清单，复制为新库并切换当前库；再运行 `dev:hmr` |
| `npm run preview:status` | 显示本 worktree 的预览状态和地址 |
| `npm run preview:stop` | 请求持有本次子进程的控制器退出，不按磁盘 PID 终止未知进程 |

数据、快照、随机密钥和 Worker 配置位于 Git 忽略的 `.runtime/preview/`。快照要求合成标记与 SHA-256 清单精确匹配；启动会向当前预览数据库应用当前代码的 Django 迁移。**snapshot 只覆盖业务 SQLite，不含独立 n8n 数据、R2、浏览器 profile 或 localStorage**，也不包含生产 PostgreSQL 或生产数据自动复制。

链路规则另用每次启动新建的合成 n8n 元数据 SQLite，含成功、运行、失败、等待和无记录等状态。它与业务库分离，不进入业务快照；启动器绑定本次合成路径，不继承生产 n8n 配置。此信息不能证明真实工作流今天已经执行。

## 当前 seed 的合成数据覆盖

下表依据 `tools/preview/data.py` 及其实际调用的 `netshop_fixture.py`、`workflow_annual_fixture.py`、`report_fixture.py`，列出新准备业务库的内容，不从旧文档补造 fixture：

| 领域 | 当前实际生成的内容 |
| --- | --- |
| ERP、销售 | 6 个虚构货品；截至昨天的 30 天、合计 180 条销售明细；虚构订单、店铺和供应商 |
| 库存 | 6 条广东仓库存、6 条库龄、6 个广东监控项与 2 个供应商周期；可用库存为 0/8/30/90/200/500 |
| 市场 | 40 条合成榜单商品、两个类目，SKU 维度，POP/自营模式 |
| 网店 | 天猫 6 店、京东 4 店；从本月首日前 40 天至昨天及对应去年日期的商品/推广日数据；天猫商品 SPU、京东商品 SKU，含推广店铺/商品聚合与就绪状态 |
| 财务 | 当年 1 月、2 月及上月去重后的月份；京东、天猫各一店的净销售、总销售、毛利、利润及推广费用合成行；不是全年完整财报 |
| 工作流 | 4 条工作计划（待开始、工作中、已完成，含不同到期日）；巡店与评价各 3 条不同状态记录 |
| 年度目标 | 当年京东“演示店铺1”的 1 条年度销售/利润目标及毛利率、推广费率目标 |
| 新品 | 1 条产品线及 1 个关联货品；4 个项目，覆盖进行中、阻塞、完成、未开始的示例；每个项目生成 7 阶段，并含店铺计划、备注示例 |
| AI 对话 | 1 个“广东仓库存复盘 · 合成演示”历史会话，一问一答，长回复含 Markdown 表格及配置指引信息；并非真实模型调用 |
| AI 报告 | 1 个合成网店周报，含取数/报告/人工复核节点、Agent 与工具结果记录；两个示例 SKU，无真实模型调用或投递 |

已有数据不等于所有页面及交互均已覆盖；日期筛选、页面读取契约及旧库代际都可能影响显示。未列出的领域不保证有 fixture，不为说明覆盖而新增或修改 fixture。SQLite 演示不能证明 PostgreSQL、真实角色/scope 或完整写流程的行为。

## 入口、认证与自动化边界

预览专属 Worker 的**浏览器公开入口**仅接受 GET/HEAD，拒绝提交、导入及 `/_teruisi/` 路径，未挂载定时处理器。内部签名 reader 的 POST 可以是合法查询（例如有查询正文的 consumer 调用），不能把“公开入口禁止业务提交”泛化成内部所有 POST 都禁止。

AI 的“新建对话”可能只清空或创建页面本地状态，不意味着已在服务端创建会话；发送消息的 POST 被公开入口拦截。选择历史会话可能触发 PATCH，因提交受限而失败。配置可编辑页面草稿，也不证明保存、恢复或模型调用成功。报告 fixture 中的已完成记录同样不是本环境真实执行结果。

浏览器 CSP 限制外部连接、嵌入页面与表单提交；Worker fetch 只允许本轮两个 Django origin 并拒绝重定向。R2 使用独立本地目录，Cloudflare 远程绑定与隧道关闭。子进程使用环境白名单，不继承生产密钥、代理、NODE_OPTIONS 或 PYTHONPATH；页面只接收横幅所需字段。

管理员直连用于本地展示，**不代表真实角色和数据 scope 已验证**。认证不能仅凭 `dev` / `build` 命令或 `DEV` 标记判断，还依赖现有直连开关、runtime 环境、受控构建标记、精确回环请求及原鉴权门禁；详见[安全与 AI 工具](../../规范/安全与AI工具.md)。本入口不修改认证规则。

独立 runner、CLI、n8n 实例不受预览启动器自动隔离。禁止在预览任务中执行触及生产的采集、导入、迁移、模型调用、任务启用或真实外发。`tmall:n8n:generate`、`n8n:retry:generate` 等配置生成器读写本地工作流 JSON，生成文件本身不表示已导入、激活或执行；它们可能覆盖 worktree 配置，也须检查差异。真实 runner、把 JSON 导入/激活 n8n、调用正式任务和发送通知属于另一步操作，必须有对应隔离配置与授权，不能因生成命令位于开发 worktree 就视为安全执行。

本入口用于前端开发和合成展示。按本次任务范围只检查构建、启动所需代码；`preview:verify` 仍保留为显式合成 smoke 工具，不是每次 HMR 开发或本期 B 的默认检查。默认不打开浏览器，不追加业务功能测试、全量 smoke 或效果验收；正式发布按[验证与发布](../../规范/验证与发布.md)另行授权执行。
