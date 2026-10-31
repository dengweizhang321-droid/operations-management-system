# Catalog 基线检查与采集修复

状态：开发候选；基于 `3ce73dfa87884ceea23f3b71f90b2244704b4170`。本任务没有合并 main、准备制品、生产迁移、部署或启停生产服务。

## 问题与结果

2026-10-31 Workflow156 的冻结 JSON 仅列 sequence OWNER USAGE，正常的 SELECT/UPDATE 会在启动时被判为多余。`03f6e474` 已补 JSON。本次进一步修正 Tmall 和 Workflow 两个采集器的 `acldefault('S', owner)` 为 `acldefault('s', owner)`：PG17 的小写 s 表示 sequence，大写 S 表示 foreign server（仅 USAGE）。序列元数据的 `relkind='S'` 保留。

新 `tools/check_catalog_baselines.py` 只读源码，不导入项目模块，不执行 SQL，不更新基线。它登记全部 12 份 Python/6 份 JSON，通过有限 AST 读取当前支持的结构；未知结构或新文件要求显式扩展适配。表 OWNER 固定 PG17 八项（含 MAINTAIN），sequence 固定 SELECT/UPDATE/USAGE。此为本项目当前冻结契约，不表示 PostgreSQL 禁止显式撤销 owner 权限。

检查还覆盖：实际采集 SQL 的 r/s 参数；OWNER 到实际比较的连接；实际表循环；表成员、序列表/列/名称与 identity/nextval 信号；重复 JSON 键、ACL 行、严格类型和空值。主判定按权限集合，独立辅助口径直接扫描原始行；不从日志提取“通过数量”。当前报告是 47 个表基线条目（含代际重复）和 2 个序列，OWNER 集合成员及原始行均为 382；继承记录与无新 ACL 的增列/索引记录另列，不把这些数值当放行常量。

## 实际接线

- CI 直接执行检查器及其代码反例；不改 `package.json`。
- Workflow156 candidate 在读 recipe/runtime 前检查，admission 也检查当前输入；proof 必须绑定实际检查报告，CHECKS 新增 `catalog-baseline`。
- `Prepare-Application` 在结构 admission/successor 分支和创建 staging 前调用同一检查器，因此无 migration 的普通准备也会检查。compact 输出保持同一检查结果，并以 SHA-256 绑定完整报告；非零退出、截断、非完整 scope、deferred 目标或异常字段均拒绝。
- Django 显式复制清单收录检查器；集成检查逐项核对报告的 tools 输入均在清单中。
- 五个已有 JSON capture 入口改为：前置检查祖先及目标采集代码，捕获后完整检查内存候选，然后以独占创建方式写入本次私有演练目录的 `*_catalog.json.candidate`。不覆盖冻结 JSON。普通 rehearsal 在建目录/启动 PG 前完整检查。
- 未扩展 `verify-release-candidate.mjs` 的有限 profile；CI 成功不代表生产已准备或已获发布授权。

## 证明与历史边界

`run-mandatory-checks.py` 在本任务隔离 worktree 真实运行语法与迁移闭包检查，使用 Git 中的 154 代迁移夹具和无数据库的 Django MigrationLoader；连接被显式禁止。不会读取 installed runtime 或进行 candidate binding。

执行材料新增在本目录：

- `MANDATORY-CHECKS.json`：当前 Workflow156 97 个 CODE_FILES 成员。
- `MANDATORY-CHECKS-SALES154.json`：当前 CI 仍消费的 Sales154 86 个成员；其原四项 CHECKS 保留，附本次额外 catalog 结果。
- `workflow156-mandatory-code-checks.json`、`sales154-mandatory-code-checks.json`：新路径 proof。

只更新 `config/main-schema-releases/workflow-0009.json` 和 `sales-0012.json` 的当前引用。已安装历史 plan/receipt、此前任务目录中的 proof/evidence 均未改写；其他祖代 recipe 不批量刷新。Sales154 对本源码额外 workflow migrations 的 source_delta 拒绝仍如实记录，没有把它重新认定为可安装候选。

Django controller 只新增一个只读 helper、Prepare 首部调用和一个复制条目；独立 AST 比较证明其他旧函数正文保持不变。新精确字节资格常量追加到原集合，保留所有旧常量；不自动跟随文件更新。

## 验证

| 检查 | 结果与边界 |
| --- | --- |
| `python -B tests/catalog-baselines.py` | 33 项；历史原始 sequence、成员缺失、重复、错类型、未知对象、空循环、比较断链、capture/CLI 等门禁自身反例 |
| `python -B tests/catalog-baseline-integration.py` | 4 项；包含 PS5.1/PS7 实际 helper 和 8 类拒绝、准备顺序及复制闭包；只提取函数，不运行 controller 顶层或 PrepareApp |
| controller qualification / manual maintenance tests | 55 项；精确新 pin、历史保留、改字节及跨 controller 拒绝 |
| `tests/schema-code-digest-static.py` | 15 项；现有 recipe 摘要检查器自身反例 |
| `run-mandatory-checks.py` | 68 次 Python 语法检查覆盖 67 个唯一路径、5 Node 文件、11 PowerShell 文件双宿主、15 JSON 语法，以及静态迁移闭包；不是业务功能验收 |
| 两条当前 recipe source bindings | Workflow156、Sales154 均 passed；不验证生产前驱，不声明已执行安装 |
| 私有 PostgreSQL17.11 采集回归 | 两个实际 sequence_catalog 函数 × NULL/显式 ACL，共 4 例通过；独立非超级用户有效权限查询，错误大写 S 独立得到 USAGE |

历史反例来自 `03f6e474^` 的精确 Workflow JSON blob，夹具记录原文件 SHA 和原 sequence；无需 CI 拥有完整历史。结果准确缺 `SELECT/UPDATE`。Tmall 历史 JSON 原本三项齐全，不伪称其历史 JSON 同样错误。

`SYNTHETIC-COLLECTOR.json` 记录私有 PG 回归。只读取已安装 PG 的不可变程序文件，数据目录位于本 worktree `.runtime/catalog-pg`、端口 55590，使用新随机凭据与新非超级用户角色；未使用生产端口、凭据或业务数据。测试结束已停止私有 cluster，删除密码文件。没有运行完整 addition rehearsal 或业务功能测试。

开发过程中修复了两个独审发现：Pi 空表循环绕过实际比较、AI 内嵌 identity 的整数 0 冒充 False。还补齐了表采集空循环/返回断链拒绝。私有 PG 夹具初次遇到 initdb 降权后的私有目录权限、Windows 后代继承 PIPE、inet 文本包含 CIDR 的问题；分别只授当前用户私有目录权限、改写私有文件句柄、使用 host(inet_server_addr())。原私有 cluster 经 PID/目录/端口身份核实后停止，未操作其他服务；不能把这些早期失败记为通过。

## 范围与使用

```powershell
python -B tools/check_catalog_baselines.py
python -B tools/check_catalog_baselines.py --compact
```

默认完整报告包含各对象权限、缺项、原始行计数、源码摘要。`--compact` 只改变输出形式，不改变检查或退出码。capture 的 defer/replacement 仅为受限 Python API，CLI 不提供跳过目标选项。

本次无 migration 变更、无业务数据处理、无前端功能变化。运行/发布工具变化按现有范围工具归为完整组件流程，后续制品采用须绑定最终合并提交；本开发交付不表示制品已准备或生产门禁已安装。
