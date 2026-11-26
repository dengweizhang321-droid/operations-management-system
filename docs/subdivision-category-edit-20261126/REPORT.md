# 品类细分可编辑 + 大类目 + 按规格代码归集 交付报告

状态：**候选**。分支 `codex/subdivision-category-edit-20261126`（基于 `origin/main` `7a769c36`），未推送、未合并、未发布。
- 方案：[PLAN.md](PLAN.md)
- 演示：[demo.html](demo.html)（合成数据，可直接打开）

- **分工**（用户指定）：
  - Claude Opus 5.5：写方案与提示词、写本报告、做独立反审（含一轮增量反审）；
  - Claude Sonnet 5.5：编码。
- **模型映射差异**：`docs/规范/任务模型分工.md` 的当前映射为 GPT 系列，本任务按用户当次明确指令使用 Claude 模型。

## 提交

| 提交 | 内容 |
| --- | --- |
| `2bb417db` | 后端：两张新表与迁移 0014、生效映射、写接口、授权、就绪检查 |
| `9b984691` | Worker 与前端 |
| `ff1970cb` | 方案、演示、README、业务口径 |
| `114f1de6` | 复审修复：映射列表把所有档案行都记为“已找到” |
| `b441e0a0` | 结构发布包：门禁、catalog、binder、rehearsal 及各接入点，代际 162→163 |
| `edb73b60` | `config/main-schema-releases/sales-0014.json` 与隔离验证证据 |
| 本报告 | 文档 |

## 用户确认的口径

见 PLAN 第 0 节。要点如下：
- **归集顺序**：按吉客云规格代码（`product_code`）归集，优先级从高到低为手动归类 → 静态表中带代码的条目 → 只有名称的条目先按名称在吉客云货品档案里找到代码 → 档案里也找不到的按名称兜底计入。
- **供应链名称**：取吉客云货品档案中的“供应商”字段。
- **排序**：表格每列都可以点击排序，表头显示 ↕，点击在升序、降序之间切换。

## 变更

**品类分析 › 品类细分**
- 删除“趋势粒度”，趋势固定按日。
- 新增“大类目”下拉，目前只有“直饮机”。
- 明细表每个数据列都可 ↕ 排序。
- 每行“查看货品”后新增“编辑”，可删除本细分或新增细分。
- 列出该大类目的全部细分，没有销售的细分显示 0。
- 表尾新增“合计”行：显示全部细分的合计，同比和环比按整体重新聚合计算，不受分页影响。

**系统设置 › 货品细分映射**
- 新增“大类目”筛选和列。
- 删除重复的“吉客云货品代码”列，只保留“吉客云规格代码”。
- 新增“供应链名称”列。
- 每行新增“编辑”：可手动归类或设为未归类。“吉客云未找到”的行可以补填规格代码，已手动归类的行可以“恢复默认”。

**后端**
- 新增两张表：`sales_subdivision_labels`（细分增删，删除为软删除）和 `sales_product_subdivision_overrides`（手动归类）。迁移 `0014` 只建表，不写入数据。
- 新增写接口 `POST /api/sales/product-subdivisions/edits`：只在 sales_writer 进程开放，只允许不受数据范围限制的 admin 调用。
- 两个读接口共用 `subdivisions.py` 的生效映射。两层缓存的身份都包含每次请求时现读的配置摘要，编辑后立即生效。

## 数据库权限核对结论

sales reader 与 writer 是两个独立的 PostgreSQL 角色，按表授权，每次启动先全部收回再逐表重新授予。新表的授权写在 `sales/analysis_options_permissions.py`，由启动脚本在迁移之后、服务启动之前调用：
- reader：两张新表的 SELECT；
- writer：标签表 SELECT/INSERT/UPDATE，手动归类表 SELECT/INSERT/UPDATE/DELETE，标签表序列的 USAGE。

`health.py` 增加了对这些授权的就绪检查，缺少时失败关闭。结构门禁在 Install/Finalize 阶段接受只有 owner 权限的状态，启动后要求精确授权，多出的授权会被拒绝。

## 必需检查

| 检查 | 结果 |
| --- | --- |
| `py_compile`（改动的 py）、`manage.py check`、`makemigrations sales --check` | 通过，无变更 |
| `manage.py test sales.tests.test_api -k category` | 6 通过 |
| `npx tsc --noEmit` | 改动文件 0 错误；全仓 172 个错误与基线一致 |
| `npx eslint`（改动的 TS/TSX） | 退出码 0 |
| `npm run check:backend-boundary` | `violations: []` |
| `django-sales-route-integration`、`settings-view` 等 Worker 测试 | 全部通过 |
| `npm run build` | 退出码 0 |
| `check_schema_code_digest.py --recipe sales-0014.json` | passed |
| 新增发布包测试 addition 13、rehearsal 7；`test_postgres_no_key_generation_159`（PS5.1 与 pwsh7） | 通过 |
| `main-schema-release`、`publish-prepared-main`、`schema-addition-enumeration-consistency`、`release-scope-plan` | 通过 |
| `manual-maintenance-continuation` | 6 个失败，基线 main 上同样失败（`pandasRotationControllerPair` 哈希过期），与本次无关 |
| 隔离 PostgreSQL 17 演练，162→0014 | 10 项通过，含 ACL、真实权限、多授权拒绝、重放拒绝；实例与数据已清理 |

## 独立反审

- **首轮**：
  - 阻断：缺少 `sales.0014` 的结构发布包。不补的话，合入后发布器会拒绝从 main 发布。已由 `b441e0a0`、`edb73b60` 补齐。
  - 建议：删除细分后，档案中存在的货品被误标为“吉客云未找到”。已由 `114f1de6` 修复。
- **增量反审**：无阻断，结论“可以合并”。逐项核实了以下内容：
  - 准备制品（planSpec、recipe、codeSha256、validation）；
  - 上线顺序与备份、维护链；
  - binder 由发布器运行时调用，无需预先提交；
  - 控制器字节为追加登记，162 回滚仍可通过准入。

## 合并与发布前提

1. 合并前确认 `origin/main` 没有改动 recipe 绑定的文件，否则需要重新演练并绑定。本报告写作时 `origin/main` 仍是 `7a769c36`。
2. 准备制品时，binder 会核对生产已完成 162 的 Finalize。不满足时只报“制品未就绪”，没有副作用。
3. 发布范围：Worker + Django + 结构迁移（162→163）。合并和上线需分别授权。

## 已知限制 / 未做

- 编辑接口只在 sales_writer 进程可用。本机 development 角色下提交编辑会提示不是写入服务，与导入类写接口一致。
- 名称转代码只在覆盖分类内的货品、或档案名称与映射原值完全相同的货品中做规范化比较。
- 手动补填的规格代码只去掉首尾空白，不统一大小写。
- 未提供标签重命名和手动排序界面；未用真实数据核对命中率。
- `system_datasets` 的 manifest 没有登记新模型。该测试在基线上本来就不通过，且不是发布或启动门禁。
- 写侧候选超过 20000 条、Django 返回 403 时，前端提示文案不够精确。属于极端情况，未改。
- `demo.html` 只做了脚本语法检查，未在浏览器中查看。
