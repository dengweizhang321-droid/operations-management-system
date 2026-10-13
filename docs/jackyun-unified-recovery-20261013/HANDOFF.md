# 接续检查点

2026-10-13，当前聊天接续；此文件随工作更新，不是发布批准。

- 工作树：`D:/codex-isolated/jackyun-unified-recovery-20261013`。
- 分支：`codex/jackyun-unified-recovery-20261013`；本轮起点 HEAD `62e57b0b6fb6e04001c963d5f871b14e04f5374c`，53 个 tracked 修改及新增文件保持。
- 原成果和日志未覆盖；之前的保全及复现位于 `D:/codex-artifacts/jackyun-unified-recovery-continuation-20261013`。
- 本轮独立证据：`D:/codex-artifacts/jackyun-unified-recovery-resume-20261013`，`source-start.json` 逐文件绑定现有修改。原 CONTINUATION 的“待补”已有部分实现，不能据该旧清单重复开发。
- 已核对已有五模块逐点响应丢失的完整管线测试、库存/库龄/销售真实事务负例、publication baseline v2 规则绑定和自动派发单消费者代码。
- 上述三个文件已完整串行结束，13/13 通过，0 取消，退出码 0；五表各一个提交响应丢失断点、随后跨日迟到复验均通过，原批次提交次数保持 1。
- 当前 HEAD `f2ec557a0f5fd097d4811f72b17536174f98d8ba`。另一接续聊天在收到暂停时于 10:57 同步了 main；现已核实其 idle。本任务文件按起点摘要比较没有该聊天的新增变化。主目录用户修改保持。
- 本轮补充：ERP/销售 writer readiness 纳入新增审计/发布基线字段。真实旧结构拒绝、新迁移结构通过已加入迁移演练；`postgres-final.log` 57 项通过、退出码 0、独立集群停止及临时密码文件删除。
- 真实 n8n 首次复验启动超时、第二次 REST 请求超时保留。已把合成数据库 CLI 导入/元数据写入移至服务器启动前，第三次进入 C 后被真实规则摘要门禁正确拒绝：夹具在 A 前写紧凑 policy、B 又改为 pretty JSON。现保留同一夹具规则字节，不放宽生产摘要校验。
- 已完成真实 n8n：`real-n8n-bound-human.log` 退出 0，人工授权派发/Webhook/真实 helper/A—E 全部成功，五模块各合成提交一次，旧 8548 不改且逻辑目标 completed。修复了带 query 的恢复目标路由未匹配；真实正例和非法/重复 query 负例均覆盖。
- `final-regression.receipt.json`：524 项，523 pass/1 fail/0 cancelled，源码前后摘要相同。唯一未改动 watcher case 已原断言、原 timeout 单独复验通过；保留首次失败，不称全量全绿。`final-lint` 0 errors/112 warnings，`final-boundary` 通过。
- `final-types` 退出 2，188 条；与独立旧基线按诊断位置归一化后 188/188 完全一致，新增 0。`types-comparison.json` 为对照。
- 当前源码和独立采用源码生产构建都已退出 0。采用源码另一次 PostgreSQL 57 项通过、集群及密码文件清理；helper SHA 与真实 n8n 成功样本一致，原构建证据验证器通过。最后历史 Windows 身份/独立 EOF 复验 6/6 通过。没有本聊天留下的在途验证命令。
- 离线候选 `D:/codex-isolated/jackyun-unified-adoption-20261013/source` 已从实际前驱组装，5199 文件/94 差异，其他前驱字节未变；源码、dist ZIP 逐成员 SHA 回验完毕，`CANDIDATE.json` 已封存，inventory SHA `40ea5e7088074cd1345c7245bd494d252ea0734c3aa92bef7409b67941dcc76b`。node_modules 仅为隔离开发依赖 junction，正式准备须原工具独立 npm ci。
- 已只读读取正式 n8n 两条流程发布版本、节点摘要、调度一致、空 pinData、无在途；`formal-n8n-diff.json`。进程 3000/5791 的路径和命令行仍不可读，在线 plan/PrepareApp 无有效回执，不能声称采用包已达到可封存执行状态。
- Git 已交付：源码 `e511a5a8`，合并 `11235a61` 已推 main 并回读包含源码；随后仅文档收尾。运行验证与失败边界见 REPORT。原树和所有旧日志继续保留，不从头开发或重跑已完成检查。
- 下一步仅为生产准备阻断的解除：取得合法管理员身份预检能力，重核正式前驱/两个 n8n 发布版本，再用原在线 plan/PrepareApp 封存精确批次。完整采用包达到可执行状态后，按用户要求一次性确认对应生产范围；未获该授权不启停、不更新、不补跑。权限缺口不通过反复普通权限调用解决，不绕过保护。
- 禁止提前生产部署、启停、正式 n8n 更新、调度变更或真实补跑。既有源码构建、合成网关五表和生产验收分别记录。
