# 新品周报维护准入

本子项仅修改 `tools/django-workflow-service.ps1`。原 `RunWeeklyReport`、`ForceWeeklyReport`、`DryRunWeeklyReport` 继续使用同一个服务 mutex；取得锁后，先通过原 `Read-SystemMaintenance` 和 `Read-AutomationDrain` 读取准入状态，再进入昂贵的 runtime 校验和周报调用。

任一有效 gate 存在时，返回 `status=deferred`、`sent=false`，附原 action、维护和排空 ID，并记录原 launcher INFO 事件。两 reader 均执行，坏 gate 仍抛原异常；不增加两个 gate 之间的新关系协议。无 gate 时，原 runtime 校验、学习同步、到期判断、force/dry-run 参数、投递账本及发送链保持。

n8n 模板每五分钟直接执行 `RunWeeklyReport -Json`，没有后续响应解析节点。本次不修改模板，也不增加重试或补发。延期只表示本次没有执行周报；维护结束后的下一轮仍遵守原发送窗口，可能按原规则不发送。

检查使用 [私有门禁夹具](../../tests/weekly-report-admission.fixture.ps1)，只提取函数定义，在唯一临时 runtime 和 mutex 下执行原 gate reader 与原 mutex。昂贵 runtime 校验替换为必抛 sentinel，无数据库、DWS、周报业务或发送调用。PS5 `5.1.26100.9444` 和 PS7 `7.6.5` 各 28 个控制边界通过，含三种 action、维护、两种 drain phase、双 gate、坏 JSON、错误 runtime/id、超大文件、目录、单一 JSON 输出及 mutex 持有和释放。

[逆投影检查](Check-WeeklyAdmissionProjection.ps1) 在两 shell 下删除唯一新增 helper 及周报函数最前两个 AST statement 后，与 `8e1411cc` 原文件全文一致（仅统一 CRLF/LF）。其余函数、参数、顶层分发及原业务函数剩余文本未变。原始检查记录在 [evidence-weekly-admission](evidence-weekly-admission/ps5.json)，另有 [PS7](evidence-weekly-admission/ps7.json)、[PS5 逆投影](evidence-weekly-admission/projection-ps5.json)、[PS7 逆投影](evidence-weekly-admission/projection-ps7.json)。`git diff --check` 通过。初版夹具把 `$PSScriptRoot` 用于参数默认值，在 PS5 首次启动时为空；已移到参数解析后的初始化，随后两 shell 完整通过。

此方案不抢占已取得锁并开始执行的周报，也不添加锁外预读。若周报在维护取得锁前已经开始，仍按原 mutex 等待规则串行；锁等待/超时不被伪报成 deferred。没有执行生产生命周期、数据库操作、发送、打包、部署、提交或推送。
