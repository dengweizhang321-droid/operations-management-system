# 发布链路维护前检查

本任务从 `848228b1` 的独立 `codex/release-chain-preflight-20261018` 工作树实施。目标是将普通权限进程可见性、冻结来源和实际旧控制器恢复能力的缺口前移到 STARTED/维护之前；应用上线另待用户明确授权。

## 实施范围

- `manual-maintenance-process.psm1` 把真实 CIM 输入复制为独立六字段对象。相关进程身份不可读继续为 unknown；不通过空路径排除，不修改 CIM 只读属性。有限续接继续执行原双锁、encoded actor、控制参与者、后代及原 token/原完成凭据检查。
- `frozen-main-source.mjs` 在实际准备、发布和观察入口复用完整 commit、HEAD/tree 与干净来源检查，维护前再次确认。批准目标在单次调用中不读取可变 `origin/main`；原选择入口仍先 fetch 并冻结目标。请求、PREPARED、原生包和最终成功回执的绑定继续保持。
- 实际已安装 Worker/Django/AI/transport 和恢复适配器以完整精确集合摘要绑定。资格已核字节不在后续重新采样时变成新基线。独立只读前检在 STARTED 前执行，原双锁 Check 复核两分钟期限、同一工具字节、Pi receipt/config 和当前精确进程身份。
- legacy/pi19db 路线要求相关名称的完整进程可见性；native-exit-observer 路线核原生 Pi 身份及实际 Stop 能力，不要求旧续接桥的全机无参与者资格。前检明确 `provesStopped=false`。未知身份或新鲜度失败不进入原生维护操作。
- 实际前驱 6dc 与候选 PiWorkspace 的 AI 整文件不同。有限兼容记录同时绑定原 Worker/Django/transport/AI 完整摘要、真实 manifest/release tuple 与精确候选 AI 摘要；它只选择原 native Stop，不授予重试或有限旧桥能力。其余代际仍要求原已审能力或拒绝。
- 控制工具包和 Django PrepareApp 清单加入实际新增依赖。Django 免完整冷启动资格只允许精确三行清单增量反投影，其余函数、参数和顶层保持。PiWorkspace `CODE_FILES` 同样只增加三项闭包，不改安装/迁移逻辑。

## 验证与证据

定向第一轮 107/107 通过；第二轮 58/58 通过，覆盖冻结目标不随 main 推进、源码漂移、真实 control bundle 动态导入、AI 资格后摘要漂移、精确包库存反例、前检失败先于 STARTED、PS5/PS7 真实 CIM 投影以及双私有锁内的新动态失败。PS 测试使用私有目录和锁，不调用真实维护、WSL、任务或业务接口。当前工具调用的实际 Windows token 为管理员；纯可见性反例和真实 CIM 已验证，不能把它们写成真实普通 token 全机可见性通过。

现有 `pi_workspace_rehearsal.py` 另执行一次轻量私有 PostgreSQL 演练，真实 150→151 结构、权限、事务回滚、数据保持、有限安装器负例和 46 项 Pi 状态测试通过。端口 55531、独立目录/凭据/命名空间；退出确认 PostgreSQL 已停止且口令文件已删除。新证明 [schema-validation.json](schema-validation.json) 绑定当前完整代码摘要 `3d5491800b59adaab3567dcb5c2dc5d2a65d6ae3d2293c51d83a55d95421d66d`；recipe 指向新证明，原 `docs/pi-phase2-workspace-20261018/schema-validation.json` 字节保持。未重跑浏览器、WSL、外部模型或完整业务 E2E。

原始日志在 `D:/codex-artifacts/release-chain-preflight-20261018/`：`targeted-first.log`、`targeted-second.log`、`private-schema-launch.log`、`private-schema-evidence/`。正式候选验证由 `tools/verify-release-candidate.mjs` 在 `candidate-final-1/REPORT.json` 生成，记录最终受测 commit/tree、完整载荷、依赖/工具、真实命令退出码及输出 SHA；其结果以该原件为准。专用 profile 保留包完整性和实际入口检查，不重复无关队列/历史结构/全仓测试；完整冷启动保持未执行。

## 交付边界

本次未合并、推送、控制工具采用、打包或切换生产；以上工作由发布负责人按本次授权完成。原 19db/6dc 的失败、STARTED 和 unknown 原件保持，不泛化临时恢复 driver。未改 Start/Stop/WSL/token 写入或 45 秒退出语义，没有新增 migration、业务补跑或真实外部发送。

实施请求模型为 `gpt-6.1-sol/high`；工具未提供底层实际型号，未独立确认。独立方案和审查由发布负责人记录，不把本报告自检充作独立复审。
