# 全部店铺目录与总览最新日期查询优化

京东推广全部店铺、天猫全景目录和京东新总览的晚间失败均有实际 PostgreSQL statement timeout 证据。网店及 Worker readiness 正常不能替代这些业务读取通过。原诊断位于 `E:\codex-artifacts\netshop-failure-diagnosis-20261003\diagnosis.json`。

## 最终改动

- 目录先从实际明细中枚举完整 source/dataset 前缀，再利用现有 `net_scope_date_idx(source,dataset,platform,shop_name,business_date)` 定位平台并跳过重复店铺；最后合并、去重、按数据库排序取原有上限。不固定来源清单，不过滤历史或未完成批次，不以一个前缀的当前页冒完整目录。51 个成员见证仍交给原 50 家上限门禁。
- 新总览复用 `source_latest_date` 的按店索引前缀读取，保留完整历史和 completed/platform 原资格；前 64 行无法证明最新有效日期时仍走原精确回查，不伪造不存在。不改变指标、日期、权限、来源版本、缺数或环比/同比口径。
- 仅将有真实 PostgreSQL `57014` 和 statement timeout 原因的读取错误返回为 503/source_not_ready，提示“当前范围查询超时，请稍后重新读取。”不泄漏数据库异常或 SQL。其他连接/取消错误及导入错误协议保持。
- 合成对比 UI 验收脚本改用动态 import 加载同一组模块，保持 CommonJS 文件、原业务与隔离限制，使现有 lint 规则通过；未关闭 lint 规则。

本改动不新增迁移、索引、业务回填或权限；原 SQL 7 秒、跨域 RPC 8 秒、整体 65 秒和 2MiB 限制保持。Worker 生产源码没有功能改动，采用时只需 Django 后继应用包。

## 验证与限制

证据根 `E:\codex-artifacts\netshop-all-shops-optimization-20261003`。

| 检查 | 结果 |
| --- | --- |
| 独立合成 PostgreSQL 首轮：目录、最新日期、总览、共享来源、错误及共同期限 | 75 通过 |
| 补充截图范围、API、consumer、来源版本 guard | 41 通过 |
| 推广与真实驱动超时/事务恢复 | 48 通过 |
| 全景、经营事件、销售来源独立 PostgreSQL | 75 通过，证据 `E:\codex-artifacts\netshop-panorama-M5-20261001\core\panorama-pg-c99e820da6a5ff043415` |
| 公开适配、总览、推广及共享合同 TypeScript | 42 + 52 通过 |
| 全量 unit 首轮 | 3197 通过、24 跳过、7 失败；新树缺 `.runtime/test-venv`，旧失败原日志保留 |
| 补齐本树纯 Python 测试环境后，全部受影响文件定向复验 | 49 通过、0 失败；不倒写首轮全量为全绿 |
| 独立生产构建 | 通过；未覆盖正式 dist/runtime |
| lint | 首轮 5 错误来自 CommonJS 合成脚本；改为同模块动态 import 后最终 0 错误、14 条既有警告，exit0；原日志保留 |

百万行、四店/平台、两源/平台、宽字段的独立自造实例保留原 7 秒限制，所有目录成员与最新日期均与旧查询一致。实测如下，不代表生产或 P95：

| 查询 | 京东旧→新 | 天猫旧→新 |
| --- | --- | --- |
| 目录 | 3432→1.63 毫秒 | 3440→1.94 毫秒 |
| 最新日期 | 761→3.48 毫秒 | 773→1.20 毫秒 |

最终性能及计划证据为 `performance\teruisi-metadata-pg-6129022ee464`。首次私有 harness 因中文路径的 PG 配置编码失败，保留在 `metadata-pg-e51a01669044`；改为独立 ASCII 临时目录后正常启动、验证、停止。后续用高分辨率计时替代 Windows 粗粒度 monotonic；不把旧 0 秒样本视为零耗时。

候选 SQL 曾通过现有 `teruisi_netshop_reader` 在正式库作一次只读验证，保持 7 秒且 revision 前后一致：京东目录 4 店约 102 毫秒、推广最新日期前缀约 312 毫秒；天猫目录 6 店约 4.9 毫秒、推广最新日期前缀约 15 毫秒。两平台均无 fallback。这是一次元数据读取及计划证据，**不是生产整页验收，也不是全量接口/P95**；原运行包仍未采用本次源码。

## 采用边界

当前正式 Django 为 318/139、Worker 为 87；本轮仅源码调整、隔离验证及在线候选准备，不执行维护、部署、迁移、回填、服务重启或业务补跑。在线 Prepare 只生成后继候选并绑定当前前驱，不能当作已经采用。

采用需按 `docs/STARTUP_RELEASE_OPTIMIZATION.md` 和 `docs/NETSHOP_READINESS_GATES.md`：批准本次后继应用维护后，排空、前备份/Verify/独立恢复、精确 Prepared Deploy/Harden、后备份/独立恢复、Exit/唯一 Start、12 组件及启动绑定；最后分别验收京东推广全部店铺 9月20–24日、天猫全景目录 9月20–26日、京东新总览全部店铺 9月20–26日及原月/单店功能。不可省略原门禁，不重复139迁移或缓存回填。

市场 projection identity 去重计数的周期性超时属于另一个已记录问题；本次没有修改其 consumer、调度或任务，不声称已证明其为截图失败的负载根因。
