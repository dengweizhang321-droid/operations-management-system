# Pi 一期导出请求身份与状态活读修复

日期：2026-10-18。开发基线 `848228b1`，分支 `codex/pi-export-request-identity`。本报告记录已完成的隔离源码修复与验证；最终 Git、原生制品与准备阻断分别保存在 `D:/codex-artifacts/pi-export-request-identity-20261018/DELIVERY.json`，没有生产采用。

## 问题与修改

同一 Pi operation 的多个工具共用父 operation ID 作为 AI consumer HTTP 请求 ID，写回执因正文不同拒绝 409。即使只替换状态查询 ID，写回执仍会回放首次状态快照。

- `lib/ai/pi-export-tools.ts` 继续使用真实父 operation ID 作为 start 的 `operationId`，HTTP 幂等 ID 则由版本命名空间、父 operation ID、Pi 网关稳定的 `providerCallId` 确定性 SHA-256 生成。相同单调用重投复用 ID；缺网关调用身份时拒绝，不使用随机 audit invocation ID 补足。
- `backend/ai_assistant/views.py` 仅对 `consumer/pi-export-status` 在既有 writer、authority、当前 principal 检查之后实时读取，跳过写回执；其他写请求及其正文绑定合同保持。状态查询仍由 AI writer 服务持有，注册表执行前后审计保持。
- `backend/ai_assistant/pi_exports.py` 将既有 Pi surface 校验应用于 start/status 两者。现有 owner、scope、generation 检查及网关当前 operation 归属检查保留；未新增状态请求字段，旧 Worker 状态请求正文可继续使用。

不改变模型、Runner、数据库模型、migration、停止准入、逐页取消或 unknown 保护。原真实业务执行最后 `access_denied` 的具体分支仍未证明；不把该修复视为查明其唯一原因，不清除或重放历史 unknown。

## 定向验证

原件根目录：`D:/codex-artifacts/pi-export-request-identity-20261018/`。启动脚本只保留操作系统必要环境变量，显式注入合成测试配置；没有继承生产数据库连接、业务凭据或外部发送配置。Python/PG 二进制和 Node 依赖只读复用，全部写入私有测试数据库和任务证据目录。

| 验证 | 结果 | 原件 |
| --- | --- | --- |
| HEAD 产品源码下真实 TS 注册表 → HMAC HTTP → Django WSGI/写回执红测 | 2/2 按预期失败：第二数据集 start、start 后 status | `red-baseline.log`、`red-baseline.json` |
| 修复后 SQLite：新增真实 HTTP 3 项 + 既有 PiRuntime 46 项 | 49/49 通过 | `green.log`、`green.json` |
| 独立私有 PostgreSQL 17：同一真实 HTTP 接缝 | 3/3 通过；测试库销毁、集群停止、临时口令文件移除 | `pg-http-tests.log`、`postgres-http.json`、`pg-stop.log` |
| Node 中央工具注册表与导出上下文 | 5/5 通过 | `node-tools.log` |

执行命令（PowerShell；脚本内创建并限定私有环境）：

```powershell
& 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' 'D:\codex-artifacts\pi-export-request-identity-20261018\run-isolated.py' --baseline
& 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' 'D:\codex-artifacts\pi-export-request-identity-20261018\run-isolated.py'
& 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' 'D:\codex-artifacts\pi-export-request-identity-20261018\run-private-pg.py'
node --import tsx --test tests/pi-agent-tools.test.ts
```

新增 HTTP 测试真实执行工具 handler、签名、网络请求、Django writer 归属/authority/principal 检查、写回执、双阶段工具审计和导出文件保存。覆盖同 operation 两数据集 start、同 single-call 相同正文防重、同 ID 改正文 409，以及每个导出的 queued → running → 第一页进度 → succeeded/file。多次相同 status HTTP ID 不生成状态写回执，已有旧状态回执也不固定结果。来源数据分页为合成边界替身，21 行、2 页、完整 manifest 和真实文件字节均核验。

负例覆盖：writer/reader 归属、错误 authority、损坏 HMAC、他人 owner、失效 generation、收窄 scope、错误 surface；已有 PiRuntime 回归覆盖跨 operation manifest 拒绝、停止后新工具准入拒绝、停止后不查询未来页/不发布最终文件、旧 unknown 与新 ID 不重放。

隔离库通过实际 Django models 创建测试结构；没有验证生产迁移安装器、数据库最小权限角色 grants 或发布制品。本次不新增 migration。若最终组合版本包含尚未采用的 0085，仍须将其有限 recipe 与隔离结构证明绑定最终代码，不以本次无 migration 省略组合范围中的必要准备。

## 交付边界

运行范围为 Worker + Django，制品应绑定最终合并提交。后端源码属于现有 PiWorkspace source inventory，后续组合包的该证明必须绑定最终 source；不能沿用旧源码摘要。当前其他发布任务的准备阻断由主任务处理，本修复未修改发布工具、队列或旧 unknown。

没有生产数据库操作、服务启停、供应商真实调用、浏览器操作、业务补跑或部署；未重复此前真实生产故障测试。本次隔离接缝通过不等于真实单店业务已完成自然收尾验收。

独立只读审查通过，原件为 `D:/codex-artifacts/pi-export-request-identity-20261018/REVIEW.md`。产品三文件与红/绿、私有 PostgreSQL 证据逐字节绑定；普通业务修复没有更改原发布、生命周期和迁移执行逻辑。
