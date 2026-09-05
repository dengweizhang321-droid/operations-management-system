# 聚合层 D1 依赖清理与受控发布

## 范围与状态

当前源码的公开 API、AI 工具、全局搜索与 Worker 定时入口只通过 Django/PostgreSQL 读取和维护结构化业务事实。`app/`、`worker/` 的全部入口经 TypeScript 编译后的静态导入、重导出和动态导入递归检查，不得出现 D1 binding 访问、旧数据库入口或运行时建表/写 SQL。

源码与隔离验证完成不代表生产切换完成。当前运行版本仍须以受控 runtime 的 effective head 和 Django 应用清单为准；未执行下面的正式发布与回读前，不得宣称整机已经采用本次变更。

## 最终调用链

- 顶部搜索 `/api/search` 和中央 AI 工具 `search_system_data` 共用有界适配层，14 个分组全部读取现有 Django consumer。市场使用已有的 `/api/market/consumers/query`；它返回直接的 `items/total/truncated`，版本由 `X-Market-Data-Revision` 提供，不增加另一套 envelope。
- 导入批次保持销售 → 财务 → 网店 → 商品经营 → 库存 → 客服 → ERP → 市场的跨源分页顺序。每页只读取必要窗口；计数与数据页的来源 revision/total 不一致时，该分组失败关闭。
- 财务分析、目标、导入及 AI 财务工具删除 legacy/shadow 生产分支。财务模式默认且只允许 `django`，显式旧模式失败关闭。真实 principal、scope、HMAC、请求取消、金额分单位、写请求 replay 和上游错误状态保持原契约。
- 财务目标 Django 接口落实 `view=items/options/full`：列表不再查询管理选项，选项不扫描列表，缺省 `full` 保持兼容。AI 目标查询使用 `items`。
- 网店、财务 Excel 规范化进入独立 `normalized-import.ts`；旧 D1 导入实现仅保留为隔离迁移/测试入口。ERP 分片常量从 Django uploader 获取。
- 市场模型配置只读 AI Django consumer。标注 API、单步 runner 和 scheduled 不再接收 D1 句柄；Django 已领取的任务继续按既有图片 URL 获取、Images 优化、模型调用及 claim/complete fencing 执行。
- Worker liveness 仍独立于数据库。readiness 改为核验 23 个 Django reader/writer 的 `/health/ready`、服务身份和进程角色，最多 6 个并发、总预算 4 秒、每个响应最多 16 KiB。失败返回脱敏的 `django_unavailable` 和服务名，不触发业务写入或服务重启。
- `.openai/hosting.json` 和 Vite 生产配置移除 D1 binding；构建包不再复制 Drizzle 迁移。市场图片、网店图片与运营事务附件仍使用原 R2 binding，未改变其存储所有权。

## 验证

```powershell
npm run check:backend-boundary
npm run test:unit
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
git diff --check
```

构建只能在独立 worktree 中进行，必须确认生产 Worker 不监听该 worktree 的 `dist`。构建后复核 `dist/.openai/hosting.json` 无 `d1`，`dist/.openai/drizzle` 不存在，产物无 `getD1Database`、`sqlite_master`、`ensureFinanceSchema` 等旧访问入口。

Django 验证在独立临时 PostgreSQL 17 cluster 执行，使用独立端口、测试角色和合成数据，禁用外部回调与自动化；禁止连接生产 cluster 创建测试库。执行 `migrate --noinput`、`makemigrations --check --dry-run` 及：

```text
python -B manage.py test market.tests.test_search_consumers market.tests.test_api finance.tests.test_target_views finance.tests.test_api --noinput
```

覆盖当前市场身份投影、字面量匹配、精确分页、金额分单位、签名/角色/scope 拒绝、版本交错、财务列表/选项隔离，以及既有财务导入幂等、目标版本和市场 API 契约。本次没有新增表、数据库迁移或权限授予。

2026-09-06 隔离验证结果（基于 `main` 的 `7dc79c67`）：生产依赖图检查 302 个模块，D1 违规为 0；单元测试 1,838 项通过、20 项既有跳过；构建及 20 项产物/入口测试通过，其中直接运行无 D1 binding 的编译 Worker，验证 liveness 正常、缺少 Django 配置时 readiness 返回 `django_unavailable`。独立 PostgreSQL cluster 的 26 项 Django 测试通过，迁移 dry-run 无变化。Lint 为 0 错误、9 项既有警告；全仓 TypeScript 检查仍有 160 项既有诊断，与同一 `main` 基线逐项比较无新增，不能表述为全仓类型检查通过。现有本机 23 个 Django 服务的只读 `/health/ready` 探测全部通过；没有停止、重启、写入业务数据或采用新 release。

正式发布前的配置核对发现 ERP readiness 必须复用现行 `ERP` 环境变量前缀，已修正并增加该生产配置形状的回归测试。修正后 23 项服务配置检查全部通过，单元测试为 1,839 项通过、20 项既有跳过；构建、20 项产物测试和 lint 复验通过，TypeScript 仍与基线一致。包含错误 ERP 变量名的候选不得激活。

## 正式发布门禁

1. 用户明确授权本机受控发布与必要服务操作后，重新确认最新 `main`、工作树差异、全部检查和无冲突合并结果；保留已有生产备份、迁移 attestation 与 D1 退役回执。先更新独立集成工作树，停止当前 Worker 之前必须保持主仓库中 guard 绑定的启动入口字节与现行 release 一致；不要提前用 Git 同步覆盖 `package.json`、总控或 launcher。停服后再更新其他源码，受保护入口由 successor apply 原子安装。若先行同步导致门禁拒绝，只有在确认差异全部来自本次同步并验证旧 manifest/guard SHA 后，才可恢复当前 release 的精确入口字节以执行受控 Stop；不能绕过 guard。
   同时只读核对现有 `.dev.vars` 的服务变量契约，不输出凭据。ERP 域沿用 `TERUISI_DJANGO_ERP_READER_BASE_URL` / `TERUISI_DJANGO_ERP_WRITER_BASE_URL`，服务名仍为 `erp_reference.reader/writer`；不得自行发明 `ERP_REFERENCE` 变量或靠新增生产别名掩盖适配错误。
2. 按现有 Django runtime 发布流程更新已验证的应用快照和清单，采用财务目标视图变更，回读各已启用域 readiness。不要直接覆盖运行目录或扩大数据库角色权限。
3. 按现有 Worker 控制器停止网页服务，再执行受控 successor `plan`，核对精确计划 SHA 后 `apply`。`plan` 会生成候选，不是无副作用 dry-run。不得手工启动 Wrangler 或绕过 immutable release 门禁。
4. 使用唯一总控启动；核验 Django 全栈、Worker 新 effective head、激活 fence、登录快捷方式重绑和组合状态。验证健康接口读取 Django，D1 故障或无 binding 不再阻断搜索、AI 查询和标注入口。
5. 使用真实授权账号只读回查搜索、市场、财务列表、导入历史及受限账号拒绝；生产定时任务只核验配置与已有状态，禁止为了验证主动执行模型调用、导入或外部通知。

本次不删除 D1 实体数据库、tombstone、永久 guard、历史迁移、恢复证据或 R2 对象。恢复只允许 Django/PostgreSQL 兼容代码、备份/WAL/PITR 或受控前向修复，禁止恢复 D1、旧模式或双写。
