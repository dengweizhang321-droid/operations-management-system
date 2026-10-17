# 天猫入仓监控结构发布交付

状态：源码、有限 recipe、原生接线和隔离 PostgreSQL 证明已完成；未部署、未执行生产迁移、未修改已安装控制工具。最终 main 合并、控制入口更新与制品准备由本任务负责人串行完成。

## 两个精确父代

- 实际已安装来源只读核验为 147：存在 `jd-monitor-preferences-addition-active.json`，不存在 148 active，也不存在已安装 `0016_jd_product_monitoring.py`。
- [inventory-0017.json](../../config/main-schema-releases/inventory-0017.json) 只接受 147→149：严格顺序执行原 `0016_jd_product_monitoring`、新增 `0017_tmall_warehouse`，两步处于同一个 PostgreSQL 事务；中间 148 也按原 catalogue 核验。
- [inventory-0017-from148.json](../../config/main-schema-releases/inventory-0017-from148.json) 只接受 148→149：只执行新增 0017。若其他任务已经采用 148，同一 main 可以使用这条独立绑定的 recipe。
- 每个父代均由其原 verifier 校验精确捕获来源和原 receipt。未修改原 147/148 安装器、catalogue、recipe 或旧验证证明；未知父代、改写迁移、缺失/额外迁移均拒绝。

新增四张独立表：`inventory_tmall_warehouse_scopes/batches/facts/audits`。0017 只有建表、字段、索引和约束，没有业务搬迁、回填或导入。结构发布不执行全库备份或恢复。

## 原生发布顺序

固定 main 准备入口按完整迁移差异选择上述 recipe，读取绑定的新隔离证明，通过文件读取核对原父链，并生成该次冻结来源的独立 evidence。准备不连接业务数据库，不读凭据，不进入维护或执行迁移。

用户手动发布时继续沿用原生维护、互斥、前驱、prepared package 和 operation 保护：

`Plan → DeployApp → HardenAcl → Install → ProvisionRoles → Finalize → Worker apply → ExitMaintenance → Start`

`ProvisionRoles` 仅为新增 `TmallWarehouse` 分支接入现有库存 provisioner；在 Install 成功后、Finalize 之前执行。失败保留原 STARTED/FAILED、operation、维护和日志，不自动重放。reconcile 仅验证原意图对应的已提交 149，不重新迁移。

普通后续启动通过 149 active 和精确 database catalogue 检查，不重复迁移，也不要求业务表仍为空。安装/最终确认才要求四个新表为空。旧京东监控的已保存配置按原字段与排序后的完整有效权限摘要保护；ACL 条目排列变化不会误报为扩权。

## 权限与健康

| 表 | inventory reader | inventory writer |
| --- | --- | --- |
| scopes | SELECT | SELECT、INSERT、UPDATE |
| batches | SELECT | SELECT、INSERT |
| facts | SELECT | SELECT、INSERT、DELETE |
| audits | 无 | SELECT、INSERT |
| facts identity sequence | 无 | USAGE |

reader/writer 检查新表、列和索引，writer 验证以上最小 DML 和 sequence USAGE。BI 保持原库存 overview 所需的固定子集，不授予天猫表读取权限。

## 隔离验证与证据

- [schema-validation.json](schema-validation.json)：新 149 安装器完整源码摘要、完整迁移摘要、两种父代、检查集合。与两条 recipe 精确绑定；没有借用旧 0016 的 proof。
- [schema-postgres-tests.log](schema-postgres-tests.log)：25 项通过，包括 8 个有限安装/原生 PowerShell/绑定测试，以及 17 项后端业务测试在真实 PostgreSQL 上复验。
- 私有 cluster 位于本 worktree 的 `.codex-tmp/tmall-warehouse-a6oq52z8`，监听 `127.0.0.1:55471`，使用新生成独立凭据；已停止，临时密码文件已删除。没有生产数据库连接或生产业务数据副本。
- 两父代升级/回滚；旧配置与有效权限保留；原生库存 provisioner 生成的 Python 真正执行；真实 reader/writer schema 和 writer 权限检查；无天猫 SELECT 的 BI schema 检查均通过。
- 额外表/列、缺索引、缺唯一约束、RLS 漂移、错误/缺失 migration receipt、过宽表和 sequence ACL 均拒绝。已提交结果不重放，未知 intent 不重放，pointer CAS 保留旧所有者。
- 两个实际 `teruisi_inventory_writer` 会话同时写相同 owner、不同内容、`expectedScopeRevision=0`，得到一个 `completed`、一个 `version_conflict`；最终 scope revision=1、fact=1。
- [schema-parent-binding.json](schema-parent-binding.json)：禁用 socket connect 后，读取真实已安装 147 原父链、创建本任务私有 evidence 并校验原 evidence SHA 成功；没有读取凭据或执行生产写。
- `node --test tests/main-schema-release.test.mjs tests/main-schema-tmall-release.test.mjs tests/publish-prepared-main.test.mjs tests/publish-latest-main.test.mjs`：67 项通过。
- `python -X utf8 -m unittest discover -s tests -p test_jd_product_monitoring_addition.py -v`：原 148 的 13 项回归通过。
- 定向 Python AST、Node 语法和 Git 差异检查通过。未运行全仓测试、构建或生产操作。

## 固定入口的实际接入

只读核验时实际人工入口为：

- `D:/codex-isolated/main-manual-release-20261016/发布main.bat`
- `D:/codex-isolated/main-manual-release-20261016/准备main.bat`
- 控制代码：同目录 `control/tools/publish-latest-main.mjs` 和 `main-schema-release.mjs`。
- Git hook：`D:/运营管理系统/.git/hooks/reference-transaction`，调用上述 control 下的 `main-prebuild-hook.mjs`。
- 配置：`D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json`。

当时 CONTROL-TOOLS 绑定 main `624c63c28d9da0db55722bd801f2f6081a70b0f6`，其 `main-schema-release.mjs` 仍只支持 0016/148。仅合并代码不能使这份旧 control 自动认识 149。最终合并后的干净冻结源码必须先执行既有安装入口，再显式准备；两条命令都不进行生产切换、维护或迁移：

```powershell
& 'C:/Program Files/nodejs/node.exe' '<最终main干净源码>/tools/install-main-prebuild.mjs' --config 'D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json'
& 'C:/Program Files/nodejs/node.exe' 'D:/codex-isolated/main-manual-release-20261016/control/tools/publish-latest-main.mjs' --config 'D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json' --prepare-only --no-pause
```

安装器从最终 main 更新有限 control 文件、hook 和准备 BAT，并保留已冻结的 Windows 环境基底；不得用落后的任务源覆盖主线新增控制功能。随后 publisher 从本次新冻结 `source/tools/publish-main.mjs` 加载新 `publish-prepared-main.mjs` 和原生工具。实际准备成功后，用户才点击固定发布 BAT；本报告不把源代码验证称为制品已就绪或已上线。
