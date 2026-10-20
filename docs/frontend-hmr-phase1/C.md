# 前端热更新一期 C：独立复核与统一集成

2026-10-20 起。本轮 C 是唯一合并与制品准备负责人。初始授权仅包含合并与准备；用户后续明确要求“按原流程协调历史 unknown，然后继续准备；然后同步上线”，已追加本次生产发布授权。本说明在冻结最终提交前完成；最终提交、推送、准备和上线结果由聊天及原生回执报告，不为回填成功结果再次推进 main。

## 精确来源与集成范围

- 最新 main 基线：`5347b18d60d11a332c36efca165b990df8327716`。
- A：`cda4d7cd2cd4cc587d118e70b91dfb8d568943be`；[A 交接](A.md)。负责 launcher、dependencies 和 A.md。
- B：`5353f62d020d5e16e6ee0b0c78208e4f68c50871`；[B 交接](B.md)。负责 package、layout、预览 Vite 配置、README、预览说明和 B.md。
- 集成分支：`codex/frontend-hmr-phase1-c-20261020`；worktree：`D:/codex-worktrees/frontend-hmr-phase1-c-20261020`。
- A/B 基于同一 main，文件无重叠；串行无冲突合并。组合代码检查提交为 `d85ba6351f238d9fb6a21069db84d82cfd738e8d`，tree 为 `cdc19f82ca09c8310c24bd0daa112d11518a3e9c`。初次集成随后只增加本说明；后续恢复增量见文末。最终提交保留两位作者原文件的精确 Git blob。
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

上述组合检查未执行浏览器 HMR 操作、业务功能测试、真实权限/scope 场景、preview:verify、全量 smoke、综合验收或生产操作。Miniflare 的 Request.cf 网络元数据超时回退后服务正常就绪，未扩展无关修复。

## 最终发布范围与准备边界

早期目录记录中的 `e52361d5a8fc095713e0ac3553ba078c12fcba9f` 已核实不是当前生产来源；据此生成的迁移预计划不再作为执行依据。实际生产前驱由 Worker/Django 的一致来源及原生 SUCCESS 回执确认，为 `20eea975b7e2132e950de0423adf9ff14507be4a`。以该提交为 base、最终完整提交为 head，沿用原 release-scope-plan：处理 Worker 和 Django，没有 migration 变化，不执行迁移。package、tools 等共享路径按原规则处理，不强制降为 Worker-only；现场仍以原生计划和前驱门禁复核为准。

合并推送后只通过已采用的普通权限准备队列处理最终目标，检查原生 PREPARED 及其提交/制品绑定，不重复手工构建。历史 dispatch `00385709-d354-4d39-9e7c-bc2b42dd90f1` 的 unknown，以及后续准备中断产生的 `391ee25b-2c47-4c01-af96-36b9a10b8745`，按追加授权和[恢复说明](../frontend-hmr-recovery-20261020/REPORT.md)处理：保留原回执、未完成制品和失败观察，不重放旧目标；必要控制代码从新 main 的独立恢复 worktree 提交，经独立增量复核后采用，不在现场篡改已安装字节，也不以空提交或新 ID 绕过重放门禁。恢复后的最终集成结果仍须覆盖新增控制代码及其必要检查；未变化的有效检查直接复用。

只有对应最终提交的制品就绪，才按已有上线授权执行原生发布及其版本、身份、互斥、排空和启动门禁，不追加业务验收。缺 PREPARED 或最终成功回执时，明确报告未就绪或未上线，不提前宣称成功。仅在内容保全且确认无进程、构建、发布和其他任务依赖后，才清理相应分支与 worktree；保留原生冻结源和恢复证据。
