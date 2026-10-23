# AI 运营工作流独立复核

日期：2026-10-09（Asia/Shanghai）。范围：推荐工作流的资源库安装、现有报告执行契约及本次界面改动。此记录为隔离开发验收，不表示生产采用或真实模型效果验收。

## 结论

后端定向测试在真实、独立 PostgreSQL 17.11 上 **34 项全部通过，0 失败、0 跳过**，测试阶段 25.745 秒。预设仅追加现有资源库配置，复用原报告 DAG、授权、人工复核与交付流程；无新数据库迁移、调度器或业务写入通路。正式模型调用与真实通知未执行。

## 独立验证

- 原报告资源库 21 项、作者预设 9 项、独立并发 4 项一起执行；原签名回执、配置快照、不可变记录、报告结构与交付门禁保持。
- 两条推荐以相同 `expectedVersion` 同时安装：仅一个事务成功，另一个返回 409；模板、方法、流水线整包保存，不出现另一包的残留。
- 安装与原有编辑器同时提交：仅一个事务成功；失败方刷新后可保存，不抹除已安装配置。
- 已安装且经用户修改、停用的方法，并发重复安装仍保持原内容、资源库版本及 AI 域 revision，不产生新记录。
- 管理员通过首轮检查后等待 PostgreSQL 域行锁，在此期间被撤销管理员角色：获得锁后再次授权检查返回 403，无配置落库。
- 作者负例同时覆盖部分标识占用、容量上限、未知预设、混合字段、受限管理员、过时版本及六条工作流空跑。空跑没有 Agent job 或投递记录。

## 界面复核发现与处理

发现运行配置已打开后，资源库刷新会更新 `library.version` 而保留旧 `selected`，使界面可能展示旧模板关联但提交新版本。作者已修为每次成功读取资源库时同步选中流水线；关联预览随之刷新，停用或关联不完整时禁止启动。实际浏览器复验由主验收器覆盖，见同任务浏览器证据。

未发现本次后端改动引入其他阻断问题。源码复核确认 `snapshot(0)` 的三个原始默认场景保持，安装发生在现有 `mutation` 行锁内，写入前后均采用现有无数据范围限制管理员授权。完整重复安装不会恢复停用项或覆盖自定义内容；部分标识冲突明确拒绝。

## 环境与复现

使用本任务独立 worktree、已核验依赖版本的测试 Python 及现有 `tools/ai-postgres-rehearsal.py`。启动父进程先移除非系统路径环境变量；runner 使用随机合成凭据、独立目录 `.runtime/ai-pg-d10473062a01` 和回环端口 55891。未读取正式配置、正式连接或生产凭据，未操作生产服务。

在具备 `backend/requirements.txt` 依赖的隔离 Python 环境，并清除继承的服务配置后执行：

```powershell
python tools/ai-postgres-rehearsal.py --tests-only --preprovision-ai-runtime-roles --test-label ai_assistant.test_report_library --test-label ai_assistant.test_workflow_presets --test-label ai_assistant.test_report_recommendations_review --port 55891 --test-verbosity 2 --test-timeout-seconds 600
```

端口须先确认空闲；运行器拒绝使用生产端口。测试退出码为 0，随后确认本次端口无监听、`postmaster.pid` 不存在、临时合成密码文件已删除。仅保留停止后的隔离测试目录及日志，代码/日志摘要绑定见 [postgres-review.json](postgres-review.json)。

本验证不证明真实模型输出、当前业务数据完整性、生产运行身份或上线结果；这些不在本轮开发执行范围。
