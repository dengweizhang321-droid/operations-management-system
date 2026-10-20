# 前端热更新一期 C：独立复核与统一集成

2026-10-20。本轮 C 是唯一合并与制品准备负责人；授权不包含上线、生产切换、迁移执行或业务外发。本说明在冻结最终提交前完成；最终提交、推送和制品结果由聊天及原生回执报告，不为回填准备结果再次推进 main。

## 精确来源与集成范围

- 最新 main 基线：`5347b18d60d11a332c36efca165b990df8327716`。
- A：`cda4d7cd2cd4cc587d118e70b91dfb8d568943be`；[A 交接](A.md)。负责 launcher、dependencies 和 A.md。
- B：`5353f62d020d5e16e6ee0b0c78208e4f68c50871`；[B 交接](B.md)。负责 package、layout、预览 Vite 配置、README、预览说明和 B.md。
- 集成分支：`codex/frontend-hmr-phase1-c-20261020`；worktree：`D:/codex-worktrees/frontend-hmr-phase1-c-20261020`。
- A/B 基于同一 main，文件无重叠；串行无冲突合并。组合代码检查提交为 `d85ba6351f238d9fb6a21069db84d82cfd738e8d`，tree 为 `cdc19f82ca09c8310c24bd0daa112d11518a3e9c`。其后只增加本说明；最终提交保留两位作者原文件的精确 Git blob。
- 主工作区的既有改动与旧 main 检出保留，不在生产目录安装依赖、构建或切分支。C 未修改关键实现或替作者解决冲突。

## 独立复核结论

C 直接阅读 A/B 完整差异、相关源码、A.md/B.md 和文档直接依赖，未发现阻断集成的问题。检查覆盖本次增量及构建、启动、发布必需代码，不扩展业务验收。

- 文件归属与 session `port/reader/writer/control/token` 接口一致；Vite 只向页面定义预览标记、端口和 Git 分支。
- 依赖同步只在停止态发生；已有会话先比对当前输入、运行指纹及磁盘标记，变化时拒绝复用。安装前失效旧标记，失败或安装输入漂移不写成功标记；保留 npm ci 生命周期和原 postinstall。本标记不是 node_modules 全量完整性证明。
- 复用独立 codex worktree、环境白名单、四端口组、合成 SQLite、私有 R2 和原进程句柄停止边界。Chrome 显式打开使用每个 worktree 的专用 profile，默认 dev:hmr 不打开浏览器。
- 新增输出没有 token、密钥或完整 session；横幅与轻量检查只输出必要的开发信息。生产启动入口、认证、写接口、fixture 和指标系统未修改。
- package 除新增 dev:hmr 外与基线对象完全一致，正式 dev/start/build 和 preview:isolated --open 保持。A 交接对移除 --open 的建议已由 B 明确按用户原要求解释：保留旧预览入口，新增无 --open 的开发入口，不据历史建议改动该选择。
- 使用说明与实际 seed、内部查询 POST、快照范围、Waitress 无 Python 热重载及独立 runner 边界一致。正式 build 的 DEV=false 横幅移除沿用 B 的定向编译证据，正式制品仍须原生准备成功才称就绪。

## 必要检查与有效证据复用

- 复用 A 普通权限下真实安装/postinstall、运行中输入漂移拒绝、失败标记失效及停止检查；已核原始 verification.json 和 verify-a.mjs，而非仅接受交接结论。
- 复用 B 对相同 layout/Vite 字节的定向 TypeScript、ESLint、编译守卫及入口比较结果；B 单独启动不冒称组合验证。
- C 使用临时 Interactive/Limited 任务，实测 medium integrity `S-1-16-8192`；从组合源码真实 npm ci/postinstall、独立 venv 与合成库启动。自有端口为 3130 / 18130 / 18131 / 13130。
- C 组合启动通过原 launcher 的开发配置、Vite 模块、两后端 health/live 和预览响应标识检查；首页 200、动态端口/分支横幅正确且不含 session token，未创建 Chrome profile；重复 start 通过轻量检查并复用原会话。
- C 仅经预览 stop 关闭自有进程，完整四端口重新绑定成功；临时任务退出码 0。源文件 blob 保全、package 单项变化、node --check 和 git diff --check 通过。
- C 本轮外部证据目录：`D:/codex-artifacts/frontend-hmr-phase1-c-20261020/`，包含 combined.json、startup.log、check-combined.mjs、source-review.json 和 check-source.mjs。运行配置、session、数据库、依赖及随机密钥不入 Git。

未执行浏览器 HMR 操作、业务功能测试、真实权限/scope 场景、preview:verify、全量 smoke、综合验收或生产操作。Miniflare 的 Request.cf 网络元数据超时回退后服务正常就绪，未扩展无关修复。

## 最终发布范围与准备边界

以当前原生发布目录记录的生产来源 `e52361d5a8fc095713e0ac3553ba078c12fcba9f` 为 base，最终提交为 head，使用现有 release-scope-plan 完整差异生成计划。当前组合预计划包含 Worker 和 Django，并包含 main 已有 `backend/ai_assistant/migrations/0087_pi_native_capabilities.py`，因此为 database-migration；该迁移并非 HMR 新增。即使仅比较本轮增量，package 与 tools 路径也按原规则处理，不强制降为 Worker-only。

合并推送后只通过已采用的普通权限准备队列处理最终目标，检查原生 PREPARED 及其提交/制品绑定，不重复手工构建。准备前只读发现历史 dispatch `00385709-d354-4d39-9e7c-bc2b42dd90f1`、目标 `c7b817989050ac5af8d989403a0f5cbbd053ce05` 的 unknown 结果，后续票据曾被原生重放保护阻塞。保留原件，不换 ID 绕过、不重放、不现场修改控制器；本轮实际结果以最终目标票据及原生回执为准，缺 PREPARED 时明确报告制品未就绪。

本轮不执行 Deploy、Start/Stop 生产服务、维护、迁移或上线。准备完成才告知用户，后续仍需明确“上线”授权。仅在内容保全且确认无进程、构建、发布和其他任务依赖后，才清理相应分支与 worktree。
