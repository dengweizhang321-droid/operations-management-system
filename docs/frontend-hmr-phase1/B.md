# 前端热更新一期 B：开发入口、横幅与说明

## 交付状态与来源

- 基线：创建 worktree 前 fetch 的最新 `origin/main`，`5347b18d60d11a332c36efca165b990df8327716`。
- 分支：`codex/frontend-hmr-phase1-b-20261020`。
- worktree：`D:/codex-worktrees/frontend-hmr-phase1-b-20261020`。
- 仅提交并推送 B 分支，不合 main、不准备正式制品、不上线；保留分支、worktree 及忽略的本次隔离材料供 C 统一独立复核，不另开重复审查。
- A 依据：`cda4d7cd2cd4cc587d118e70b91dfb8d568943be`，分支 `codex/frontend-hmr-phase1-a-20261020`；已核对远端 SHA 一致，并读取该提交的 `launcher.mjs`、`dependencies.mjs` 和 `A.md`。依赖同步、启动检查及专用 profile 文档已完成最终修订。未将 A 合入 B，使用说明明确描述 A+B 配套行为，不宣称本轮执行了组合启动。

## 文件与变更

仅修改用户分配的六个文件：`package.json`、`app/layout.tsx`、`tools/preview/vite.config.ts`、`README.md`、`docs/运维/部署与启动/isolated-preview.md`、本记录。

- 新增 `dev:hmr = node tools/preview/launcher.mjs start`，不带 `--open`；保留 `preview:isolated` 的 `--open`，原 `dev/start/build` 字节不变。A 交接中“应由 B 调整”的表述按原需求落实为新增无打开行为的 `dev:hmr`，不移除用户明确要求保留的 `preview:isolated --open`。
- 复用 `app/layout.tsx` 原 fixed 横幅及样式，没有新建页面、导航、指标或组件系统。直接读取编译时 `DEV`，与预览标记同时成立才显示，正式编译可移除横幅代码。
- Vite 只取 session `port` 并校验整数范围；只读 `git branch --show-current`（5 秒超时）取分支；仅 define 预览标记、端口字符串、分支，不向页面传完整 session/token/环境/本地路径。
- 文档依据实际 seed 与当前入口修订：worktree 硬前置、主检出拒绝、主机名、完整端口组、合成集与非全覆盖、快照范围和顺序、Waitress、AI 本地新建/POST/PATCH 限制、内部 reader POST、认证及独立 runner 边界。
- 未修改 launcher/helper、fixture、写接口、认证、生产服务和真实数据。主检出已有用户改动未暂存或覆盖。

## 必要代码与启动检查

| 检查 | 结果 |
| --- | --- |
| 本树 `npm ci --no-audit --no-fund` | 成功，611 个包；原 postinstall 的 workerd patch 成功；锁文件未改 |
| 定向 TypeScript | `node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --strict --esModuleInterop --module esnext --moduleResolution bundler --target es2017 --jsx react-jsx --allowJs app/layout.tsx tools/preview/vite.config.ts`，退出 0 |
| 定向 ESLint | `node node_modules/eslint/bin/eslint.js app/layout.tsx tools/preview/vite.config.ts`，退出 0 |
| 编译守卫 | esbuild 转换 layout TSX，即便预览标记 true，`DEV=false` 的输出不含横幅文字，`DEV=true` 保留；均无警告，无正式制品生成 |
| 脚本入口 | 与基线逐项比较 `dev/start/build/preview:isolated` 相同，`dev:hmr` 精确匹配无 `--open` 命令 |
| 隔离冷启动 | 设置 `TERUISI_PREVIEW_PORT=3110` 后 `npm run dev:hmr`；原启动器完整组检查通过；独立 venv、合成 SQLite、Waitress 18110/18111、Vite 3110 就绪，控制端口 13110；原启动首页检查得到 200 |
| 收尾 | `npm run preview:stop` 返回 stopped，启动会话退出 0；只处理本次自有进程；3110/18110/18111/13110 无监听残留 |
| 差异与引用 | `git diff --check` 通过；仅检查本次文档链接与六文件范围 |

默认没有打开浏览器；没有执行 `preview:verify`、业务功能测试、全量 smoke、真实权限场景或效果验收。启动时 Cloudflare 的 `Request.cf` 拉取超时并回退占位对象，随后正常就绪；没有扩展修复。依赖安装出现既有包弃用及 install-script 提醒，安装及后续检查成功。

以上代码及 3110 启动检查来自 B 初次交付 `1e61588dc2b97b3d762e9520a56b7ff4205c2405`，使用 main 基线原启动器。收到 A 后本次仅改 README、使用说明和本记录，复用上述有效代码检查，仅补本次文档差异和引用核对，不重复安装、启动或业务测试。A 自己在 3100 组的普通权限 13 项检查为其交接记录所载，本轮不冒称由 B 独立重跑。

## A 实际代码核对

- `dependencies.mjs` 按锁文件、package 安装元数据、npm ci 生命周期及当前本地 Node/ESM 文件闭包、npm 配置、Node/npm/ABI/平台等计算指纹；非安装 scripts 排除在安装指纹外，因此 B 新增 `dev:hmr` 不会单独触发重装。命中还检查磁盘标记、安装后隐藏锁摘要及三个必要包；安装前失效旧标记，失败或前后输入变化不写成功标记。
- `launcher.mjs` 已运行分支核对当前/控制器/磁盘指纹，变化时拒绝复用并要求用户先停止；不在运行中重装或自动停止原会话。新启动与就绪会话复用均调用 `checkStartup`，核四端口映射、development/直连配置、实际 Vite 模块、两个后端 health/live 和首页预览响应标识；CLI 不打印完整配置或指纹。
- `openPreview` 仅在显式 `--open` 且 Windows 找到 Chrome 时打开，固定传入本树 `.runtime/preview/chrome-profile` 绝对路径；浏览器生命周期独立于服务。默认裸 start 不打开浏览器。
- session 仍为 `port/reader/writer/control/token`，B 的 Vite 仅取 `port`，分支仍只读 Git 获取；端口公式、环境/方法限制和 seed 均未被 A 改写。A 修改文件与 B 六文件无重叠。

## C 的复核入口与限制

先按最新 AGENTS 与相关规范读取原始需求，再检查 B 六文件完整差异和直接依赖。数据清单依据 `tools/preview/data.py` 及 `netshop_fixture.py`、`workflow_annual_fixture.py`、`report_fixture.py`；方法限制依据 `worker.ts`、`fetch-policy.mjs`；AI 新建及历史选择入口是 `app/ai-assistant-view.tsx` 的 `startNewConversation/openConversation`。

B 不修改 A 文件，也不导入 A 工作区字节。本次未执行完整正式 build、浏览器 HMR 操作、业务数据/角色/scope 验收或 A+B 组合启动。正式构建横幅排除依据为定向编译守卫，真实业务与浏览器效果不在本次检查范围。A 精确提交与 B 最终分支一并交 C 统一独立复核；未合 main、未准备正式制品、未上线。
