# 按权限契约路径补齐结构发布授权

状态：开发分支候选；未合并 main，未准备生产制品、发布、操作生产数据库或启停生产服务。

## 问题与设计

基线 `03f6e474d0fcdfb3328485dad5d1719f4d8f1080`。此前 AI ProvisionRoles 只随
PiAgent/PiWorkspace/PiBusiness/PiNative 执行，而 `b8c0ed58` 修改 AI 权限契约，
为 `ai_write_request_receipts` 增加 DELETE，可以随 WorkflowAutomation 一起发布。
additionKind 只能说明结构增量，不能代表整个冻结 Git 差异的权限影响。

生产代码只改 `tools/publish-prepared-main.mjs`：

- 用 `releasePlan.changes` 的 `path` 和 `before` 精确检测
  `backend/ai_assistant/database_contract.py`，与原四个 Pi addition 取或。
- 库存也有同类缺口：实际 reader_tables/writer_privileges 在
  `tools/django-inventory-service.ps1` 的内嵌 Python 中；该路径与原
  TmallWarehouse 条件取或。对应 readiness 契约在
  `backend/teruisi_backend/health.py` 的 INVENTORY_WRITER_TABLE_PRIVILEGES；
  单改 health 不会改变授权操作，所以不以整个共享 health 文件触发库存授权。
- 不改 provision 实现、权限清单、门禁、发布重试或其他编排。

保留现有 **Install → 库存/AI ProvisionRoles → Finalize → PiUpgrade → 启动**。
源码原调用在 Finalize 之前；Finalize 校验权限，不能移到它之后。
EnterMaintenance 使用 KeepPostgres，沿 Django 的
Invoke-InstalledDjangoDomainStops 调用 AI 和库存 Stop；AI Stop 停止 reader/writer。
部署和结构操作均要求应用已停。此时 PostgreSQL 可用，8111/8112 无监听及受管
AI 进程已停的 Assert-AiPortsFree 门禁继续生效，未绕过或修改。

## 无真实发布的测试方案与结果

1. `node --check tools/publish-prepared-main.mjs`：通过。
2. `node --test tests/publish-prepared-main.test.mjs`：79/79 通过。
   直接调用真实 publishPreparedMain，所有原生动作经已有 context.runStep 替身、
   临时目录、假 sourceIdentity/sha/rotation/fetch 实现，不调用真实 PowerShell
   发布器、生产网络或生产文件。
   覆盖原 5 类授权条件、白名单与路径同时命中只调用一次、WorkflowAutomation
   精确路径/重命名前后路径/双契约/缺失与空 changes/无关路径、prepare-only 无
   ProvisionRoles、Install 后且 Finalize/升级/启动前执行，以及失败即停、无 SUCCESS、
   unknown 不重放。
3. `tests/ai-role-provision-postgres.py`：真实 PostgreSQL 17.11，18 项通过。
   以随机端口 63246、专用临时数据目录和随机测试凭据启动独立集群，使用当前真实
   database_contract.provision、合成空表及迁移收据。传入连接前校验 data_directory
   和端口，禁止生产 runtime 路径，不接收任意外部数据库 URL。
   - 带 WorkflowAutomation 收据，Pi 已安装代数为 0/1/2/3/4 时全部可重复授权；
     先移除 write_receipts DELETE，再调用真实 provision，四权限严格相等。
   - 四组 Pi 守卫分别验证缺收据、缺整组表、缺部分表，12 个负例全部拒绝。
   - Pi 四代齐备时，实际 workflow_automation_catalog.preservation 在 DELETE
     修复前后完全一致，覆盖旧行和 ACL 摘要。
   - initdb/start/stop 均 exit 0，集群已停止；没有应用服务冷启动或完整发布演练。
   首次夹具因模型含无数据库列的字段失败，已过滤该类字段；失败集群也正常停止，
   原记录保留。没有修改被测生产函数来迁就夹具。

复跑隔离数据库测试（`--out` 必须是新目录，Python 需安装 Django/psycopg）：

```powershell
python -B tests/ai-role-provision-postgres.py --postgres-bin <独立PostgreSQL的bin目录> --out <新测试目录>
```

证据目录：`D:/codex-artifacts/provision-roles-path-trigger-20261031/`。
编排原输出 `node-tests.log`，数据库结果 `postgres-test-2/RESULT.json`，失败夹具
原件 `postgres-test/RESULT.json`。测试程序从 EDB 官方 Windows 17.11 二进制归档
独立下载至上述目录，不读取生产 PostgreSQL 程序、数据或凭据。

独立 Sol High 源码审查未发现本次修复的必要阻断；请求模型 gpt-6.1-sol/high，
实际底层型号未由工具独立回传确认。

## 范围与交付边界

- 保留外层 `if(schema)`；本次修复任意已支持 addition 携带上述契约变更的结构发布。
  无迁移发布不在本次最小补丁范围，仍不会由该处执行 ProvisionRoles。
- 非 Pi addition 不会因名称被四道 Pi 检查拒绝；已有收据与表不一致仍拒绝，
  不能用本补丁修补损坏的结构状态。
- Workflow Finalize 保全旧 AI/Pi 表的 ACL。未来若契约变更涉及保全集中的表，
  Finalize 仍可能拒绝，需要该次迁移的兼容设计；不放宽现有保全协议。
  本次 write_receipts DELETE 不在该保全集内，隔离实测摘要不变。
- 发布工具变化按既有范围计划属于 full（Worker + Django），本补丁没有 migration。
  合并、生产制品准备、发布仍分别需要用户明确授权。
- 没有将源码修复称为生产授权已修复，也没有将测试替身或合成数据库称为原生冷启动通过。
