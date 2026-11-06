# Skill 步骤工具登记校验

状态：开发候选，待独立审查。基线 `origin/main` 为 `77382b5f`，分支 `codex/fix-toolname-20261106`，工作树 `D:/.codex/worktrees/fix-toolname-20261106`。本任务只提交分支，不推送、合并、准备制品或上线。

## 修改范围

`backend/ai_assistant/skill_candidates.py` 的 `_validate_content()` 在保存前逐项检查 `steps[].toolName`：非空字符串必须存在于调用方提供的登记目录；未知名称返回 `invalid_request` / HTTP 400，错误标明具体步骤位置，且不创建候选。

- 保留空字符串及省略 `toolName` 的无工具步骤；显式 `null`、其他非字符串、非数组 `steps` 和非对象步骤返回 400。
- `requiredTools` 原校验循环与错误文字保持不变；两个字段不强制互相包含。
- 不修改 `output_schemas.py`、schema 摘要、读取、审核或发布逻辑；存量候选中的旧工具名仍可读取。
- 原未提交草稿已保全在本工作树忽略目录 `.runtime/toolname-original/`（原实现与原测试各一份）；最终实现由原草稿收敛，未把原草稿备份放入应用源码。

## 目录及权限核对

现有 POST 入口 `pi_views.dispatch()` 先核对路径中 operation 的存在性及所属账号，再以真实 principal 和该 operation 调用 `pi_gateway.catalog()`，把第一返回项的名称传入 `save()`；`save()` 内仍经 `request_schema()` → `pi_sources.evidence()` 核对所属任务及成功状态。本次不改这些边界。

目录经 `transport.catalog()` → Worker `django-edge.ts` 的 `entries()` → `getToolsForPrincipal()` 动态按真实 principal、入口 surface 过滤。`pi_gateway.catalog()` 有 operation 时会加入 `pi_business` 目录，其第二返回项进一步筛选直接只读、native 及本 operation 获准的业务操作；第二项不是完整登记目录，第一项也不等同于该任务的执行授权。这里继续沿用 `requiredTools` 的登记校验语义，避免把步骤名称校验扩为新的授权规则；实际执行仍由原执行入口控制。

## 隔离验证

只读复用已安装的 `D:/teruisi-runtime/django-sales/venv/Scripts/python.exe` 解释器及依赖，没有修改运行目录。测试子进程显式设置 `TERUISI_DJANGO_ENVIRONMENT=test`、`TERUISI_DJANGO_PROCESS_ROLE=development`、`DJANGO_DEBUG=true`、`TERUISI_DJANGO_SQLITE_PATH=:memory:`，清空 `TERUISI_DJANGO_DATABASE_URL`、内部签名密钥、AI 加密密钥及 Runner 密钥文件变量；不连接生产数据库，不调用真实模型、业务工具或外部发送。

在本工作树 `backend` 目录执行：

```text
python -B manage.py test ai_assistant.test_skill_candidate_step_tools ai_assistant.test_skill_candidates ai_assistant.test_skill_candidate_schema_route --noinput -v 1
```

解释器为上述完整路径，`PYTHONDONTWRITEBYTECODE=1`、`PYTHONUTF8=1`。2026-11-07 首轮 SQLite 测试结果：`Ran 56 tests in 3.807s` / `OK` / exit 0；系统检查 0 issue。新模块 11 项，原 candidate 与 schema 路由两模块合计 45 项。覆盖逐步登记、独立于 requiredTools 的拒绝、可选字段、类型错误、目录来源、HTTP 400/201、存量读取，并复用原所有权/审核/发布回归。SQLite 结果不代表 PostgreSQL 行锁或数据库特有约束验证；本次没有修改事务、模型或迁移。

### PostgreSQL 发现与夹具修正

后续组合分支的真实隔离 PostgreSQL 验证执行 24 项，出现 1 个 error：本项 `test_legacy_candidate_with_unknown_step_still_reads` 先保存再 UPDATE `content_json`，被 `ai_immutable_record_guard()` 以 `ai_immutable_identity` 拒绝。该错误属于旧数据测试夹具，不是保存或读取生产行为的缺陷；首轮 SQLite 通过不能说明这项夹具适用于 PostgreSQL。原日志保留于组合工作树 `.runtime/ai-pg-0b0e9cab5508/failure.log`。

增量仅修正测试：通过已完成 operation 的真实 `request_schema()` 取得报告、schema、反馈绑定，带合法的 export 来源引用和真实 `canonical()` / `digest()`，一次 INSERT 完整 draft 字段，模拟旧版已接受的正文。没有 UPDATE 不可变内容、关闭触发器或放宽生产门禁。读取时同时核对步骤、正文摘要及报告版本摘要。相同隔离 SQLite 配置下单独执行修正用例：`Ran 1 test in 0.099s` / `OK` / exit 0，系统检查 0 issue。PostgreSQL 增量结果由主任务后续组合重跑后记录。

`git diff --check` 通过。未执行全仓测试、生产迁移、服务启停、推送、制品准备或上线；下一步由主任务安排独立审查。
