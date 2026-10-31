# Catalog 基线检查：精简交付

基于 main `ba708cf9`，替代未合并的 `codex/catalog-baseline-20261101` 重版本。旧分支只保留历史验证证据，不应再作为待合并实现。本轮仅开发，未合并、准备制品或发布。

## 保留的改动

- Tmall、Workflow 两个采集器的 `acldefault('S', owner)` 改为小写 `s`。PG17 大写 S 表示 foreign server，默认只有 USAGE；小写 s 才表示 sequence。序列的 `relkind='S'` 保持。
- `tools/check_catalog_baselines.py` 只读六份 JSON、AI 的 `REFERENCE142` 和两个 Pi 的 owner 权限字面量。按 PG17 表八项（含 MAINTAIN）、序列三项直接求缺失集合，报告文件、对象和缺项；读取或格式错误返回失败。不连接数据库，不更新基线。
- 在现有合并前源码检查阶段执行，CI 复用同一命令。不以汇总数量或日志正则判断通过。
- 两处修复影响现有 Sales/Workflow 代码摘要，因此更新两条当前 recipe 的新证明引用，保留既有证据格式必需字段。

## 不再引入的内容

不携带重版本的 AST 执行路径、循环、SQL 或调用链约束，以及全量登记/N/A 报告、双计数、compact 协议、专用报告 SHA。

candidate、admission、PrepareApp、五个 rehearsal、CopyApp、CODE_FILES/CHECKS、controller pin 和原摘要检查器均保持最新 main 字节。本任务没有新运行时门槛。原显式 capture 保持原来的 JSON 写入行为，不再声称只写候选。最新 main 的角色授权触发修复完整保留。

## 验证与证据复用

`python -B tests/catalog-baselines.py`：5 项通过，覆盖正常数据/CLI、精确历史 Workflow 仅 USAGE（准确缺 SELECT/UPDATE）、表漏 MAINTAIN、Python 内嵌权限漏项，以及读取/格式错误。门禁直接检查数据，不证明采集函数执行路径或未来任意代码修改。

`python -B tools/check_catalog_baselines.py`：当前基线通过。合并前需实际执行或复用匹配源码的有效结果，不能因 CI 配置存在就推定任意合并都已检查。

`bind-current-recipes.py` 为本次一次性材料工具：逐文件 SHA 相同时复用 Git 中原语法结果；仅补查最新 main 的 `publish-prepared-main.mjs` 语法，并检查本次新 Python 工具语法。迁移、models、settings 的完整 backend 与原证据相同，迁移闭包复用；两采集器也与此前私有 PG 四场景验证字节一致。复用来源的提交、路径和 SHA 写在新 execution 文件中，没有声称本轮重新运行这些验证。

现有 `check_schema_code_digest.py` 对 Sales154、Workflow156 两条当前 recipe 均通过。历史 plan/receipt/proof 未改写，其他祖代 recipe 未刷新。新证据仅保留原格式的源码清单、语法/闭包状态、复用引用等必要字段，不嵌入重复 catalogBaseline 报告。

没有重跑数据库、rehearsal、controller 测试或 PrepareApp，没有检查业务功能。两处采集器修复的此前验证可在 Git 提交 `a370c993` 的 `docs/catalog-baseline-20261101/SYNTHETIC-COLLECTOR.json` 追溯。

## 使用与范围

```powershell
python -B tools/check_catalog_baselines.py
```

未来有意撤销 OWNER 默认权限时明确调整本项目契约，不从实际库自动学习期望。新增 catalog 格式按届时需求支持，不为假设的未来形式增加当前限制。

本次无 migration 或业务数据变更。运行工具的后续制品范围仍按现有范围工具处理；本报告不表示制品就绪或生产已采用。
