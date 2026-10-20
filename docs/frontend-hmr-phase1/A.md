# 前端热更新一期 A：隔离开发启动器

本轮仅交付任务分支，不合 main、不准备正式制品、不上线；保留 worktree 供 C 统一独立复核，不新增重复审查。

## 来源与文件

- 基线：`5347b18d60d11a332c36efca165b990df8327716`（创建 worktree 前 fetch 的最新 origin/main）。
- 分支：`codex/frontend-hmr-phase1-a-20261020`。
- worktree：`D:/codex-worktrees/frontend-hmr-phase1-a-20261020`。
- 文件：`tools/preview/launcher.mjs`、新增 `tools/preview/dependencies.mjs`、本交接记录。
- package.json、layout、预览 Vite 配置、README、预览说明均由 B 负责，本分支不修改这些文件。

## 供 B 更新说明的实际行为

1. `node tools/preview/launcher.mjs start` 默认不打开浏览器；显式加 `--open` 才打开 Chrome。当前基线 `preview:isolated` npm 脚本仍携带 `--open`，应由 B 调整；A 没有改该脚本。
2. `--open` 固定传入当前 worktree 的绝对 `--user-data-dir=<worktree>/.runtime/preview/chrome-profile`。可复用这一专用 Chrome 会话，正式 profile 不参与。没有找到 Chrome 时维持原来的不打开行为。专用浏览器的生命周期独立于预览服务。
3. 第一次使用新启动器，即使已有 Vite，也会因缺少有效安装标记执行 `npm ci --no-audit --no-fund`。安装环境白名单、npm 生命周期及项目 postinstall 均沿用；不增加 `--ignore-scripts`、不改用 npm install、不共享其他树的 node_modules。
4. 指纹包含精确锁文件、可选 shrinkwrap、package 安装元数据、npm ci 生命周期脚本及其当前本地 Node/ESM 依赖文件、项目 npmrc、有效 npm 配置及用户/全局 npmrc 摘要、Node/npm 版本、Node ABI、平台和架构。单独修改预览启动等非安装 scripts 不触发重装；普通应用源码保存继续由现有 Vite/Vinext 的 RSC/SSR 开发链处理。
5. 成功标记在本树 `node_modules/.teruisi-preview-dependencies.json`，只存协议号、输入指纹和安装后隐藏锁文件摘要。命中还需 Vite、Vinext、Cloudflare Vite 插件存在。安装前删除旧标记；npm ci 非零退出或安装前后输入变化均不写成功标记，启动停止。正常 npm ci 清空 node_modules 时也会自然删除旧标记。
6. 已运行时先比较当前输入、控制器持有的安装指纹及磁盘成功标记，再返回已运行。变化或旧控制器不含指纹时，退出并提示先 `npm run preview:stop`，之后重新启动同步；该路径不会执行 npm ci、不会自动停止原预览。依赖已同步但仍在准备中的会话提示等待，不冒称就绪。
7. 新启动和复用已就绪预览均检查实际会话端口、`development`/本地开发配置、实际 Vite 开发模块、两个会话后端的 `/health/live`、首页 `X-Teruisi-Preview: synthetic-v1`。只打印端口、开发标识、两个隔离地址、预览响应标识及原有状态/分支/地址，不输出会话 token、密钥或完整环境。
8. `session.json` 的 `port/reader/writer/control/token` 保持兼容；不向客户端暴露 session。B 继续从已有 `port` 取端口，从 Git 取分支。内部带认证的控制响应新增安装指纹，CLI status 不打印指纹。
9. 默认仍使用 3100 端口组；`TERUISI_PREVIEW_PORT` 仍支持 3100–3900，reader=port+15000、writer=port+15001、control=port+10000。完整组有任一冲突均拒绝，启动器不自动换组、不终止占用者。现在安装/数据准备之前也检查完整组，持久子进程启动之前保留原检查。多任务需调用方先选无冲突组。
10. 原有独立 codex worktree、环境文件/链接拒绝、合成 SQLite、环境清理、只读 Worker/fetch 策略和只停止当前 ChildProcess 句柄的边界保持。

## 必要检查

2026-10-20，最终代码的必要检查通过。宿主 shell 为高完整性，因此安装和启动检查通过当前用户的临时 Interactive/Limited 任务执行；检查脚本核验 `S-1-16-8192`，拒绝高完整性。Node `v24.18.0`、npm `11.16.0`。

| 检查 | 结果 |
| --- | --- |
| 两个新增/修改 mjs 的 `node --check` | 通过 |
| 优先选择完整空闲端口组 | 选中 3100 / 18100 / 18101 / 13100 |
| 临时占用本组 writer 端口后启动 | EADDRINUSE 拒绝，安装标记未改变，未终止占用者 |
| 真实 npm ci 与既有 postinstall | 成功，Miniflare / Wrangler 补丁按原入口执行；成功标记与输入/安装锁一致 |
| 真实隔离启动 | 首页 200、Vite 开发模块检查通过、两个 `/health/live` 通过、开发配置和 `X-Teruisi-Preview=synthetic-v1` 符合本会话 |
| 默认裸 start | 未创建 Chrome profile，未开启浏览器 |
| 同指纹再次 start | 返回 ready 并重新完成轻量启动检查，复用原会话 |
| 运行中临时改变已有 postinstall 的本地导入文件 | 指纹改变；再次 start 退出非零，提示停止后同步，旧安装标记和原预览进程保持；原文件按字节恢复 |
| 注入安装失败（helper 的 run 回调抛错） | 安装前已删旧标记；失败后不留成功标记 |
| 注入安装输入前后不一致（helper 回调返回但指纹不匹配） | 拒绝成功标记；不重复执行真实 npm ci 来制造故障 |
| 控制入口停止及资源收尾 | 自有启动器与子服务退出，完整四端口组可重新绑定；临时普通权限检查任务已移除 |
| `git diff --check` 与文件范围核对 | 通过；只有本交接记录及两个启动器文件 |

实现过程中补充 npmrc 摘要后，初轮旧控制器与更新后的指纹不一致，被正确拒绝复用；停止旧会话后，才执行最终代码的上述完整必要启动检查。原始材料保留于本 worktree 的 `.runtime/preview/verification.json`、`startup.log` 与 `verify-a.mjs`，不提交运行配置或密钥。最终私有检查记录为 13 项通过。

既有 Miniflare 在获取 `Request.cf` 元数据超时后提示使用默认占位值；之后实际预览与上述检查通过，未将此无关网络元数据警告扩成额外修复。

没有执行正式 build、preview:verify、业务接口场景、全量 smoke、综合验收、生产服务操作、生产数据操作或真实消息发送。没有修改认证、写接口、fixture、后台 runner、真实自动化、指标或日志系统。

## 限制

- 标记用于依赖同步，不是逐文件依赖完整性/防篡改证明；不会为此扫描整个 node_modules。
- 本地生命周期文件跟踪覆盖当前仓库的 Node 入口与相对 ESM 导入闭包。未来若引入 shell 安装脚本、动态计算的文件读取、本地 file 依赖或 workspace，需按其真实输入扩展跟踪，不把当前闭包称为任意安装脚本的通用解释器。
- 启动检查证明开发服务器与隔离后端就绪，不证明浏览器 HMR 交互、业务功能或 PostgreSQL 等价性。Chrome `--open` 参数由代码差异核对，默认检查不打开浏览器。
- 所有运行材料均留在被忽略的 `.runtime/preview` / node_modules；不提交会话配置、密钥或生成数据。保留分支与 worktree 供 C 复核。
