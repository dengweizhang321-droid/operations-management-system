# Pi 一期整链验收

2026-10-18，独立隔离验证。基础提交 `aaca18485021b6f98107fe168b69c8f57d55ee46` 加本任务四个后端修复文件；精确执行字节见 [source-binding.json](e2e-evidence/source-binding.json)，运行前后相同。未修改产品 UI，未提交、合并或发布。

**最终完整用例通过：1/1，31.894 秒；测试数据库正常销毁，私有资源清理全部验证通过。** 本轮闭合“取数→真实本地 Python→点击下载 Excel→刷新同会话续问、丢受理响应后只读恢复与同键重投防重复、已知停止后继续旧文件、unknown 保留围栏”的应用整链证据。

## 真实链路及合成边界

Chrome 中实际操作 `app/ai-pi-agent-view.tsx` 的 React 组件，经 HTTP 入口调用未改动的 `forwardAiRequest` / `requestDjangoAi`，发实际 HMAC 签名 HTTP 到真实 Django WSGI、私有 PostgreSQL、独立队列，再经真实签名 Runner 传输进入真实 Pi 1.3.0 rootless Docker 容器。数据集消费、异步导出、本地 bash/Python、Excel 技能脚本、产物收集、下载字节和跨轮卷均实际执行。

Worker 公开路由适配源码在 **Node HTTP 测试宿主**运行，本轮不是 workerd 运行时验收，也没有启动全系统导航壳。测试只注入固定隔离 principal 来源；Django 真实签名校验及数据库账号/权限检查保留。供应商 HTTP 返回和中央业务源传输使用确定性合成夹具，未访问真实供应商、正式业务或凭据，付费请求为 **0**。因此不代表供应商推理质量、正式经营口径/新鲜度、生产部署或全系统验收。

实际 Runner 源摘要 `90812210898b7b69269a977a02828a6943adc15651e6ae0c07c664f89fe92407`，镜像 `sha256:c393a84818c0c7f941803da2db11b1cd94395b8188b69af7294490468a48e26d`；签名观察见 [runner-health.json](e2e-evidence/runner-health.json)。没有拉取、重建或修改正式 Runner/容器。

## 最终场景结果

五轮始终为同一个 session `pi-session-667c8806-7697-453d-b5a5-a8fe934e7e2d`、epoch **1**、generation **1**。

| seq | 场景 | 终态 | 合成模型调用 / runner:prompt |
| --- | --- | --- | --- |
| 1 | 销售查询、库存与推广异步导出，真实 Python/Excel 技能生成报告 | succeeded | 4 / 1 |
| 2 | 整页刷新后，本地 Python 读取上一轮 XLSX 与 marker | succeeded | 2 / 1 |
| 3 | 运行中的本地等待任务，实际 UI 点击停止并等待确定终态 | canceled | 1 / 1 |
| 4 | 停止旧轮后开始新一轮，本地 Python 再读旧 XLSX | succeeded | 2 / 1 |
| 5 | 合成供应商响应未知，刷新后仍保持禁发 | unknown | 1 / 1 |

- 第一轮在 Django 已返回 202 受理后，HTTP 宿主发送响应头与 1 字节正文即断开，使浏览器收到正文丢失错误。原请求身份已持久化；随后刷新/恢复只发生 GET，首轮只有一个 operation、一个 `runner:prompt`，模型调用完成后计数为 4，再刷新仍为 4。
- 单独用原 `clientRequestId`、原正文和原路径显式再次 POST 一次，实际返回同一 operation 且 `replayed=true`；operation 数仍为 1、`runner:prompt` 仍为 1、模型计数仍为 4。该显式被动重投与“UI 刷新只 GET”分别验证，不能混称客户端从不产生第二个 HTTP 请求。
- Chrome 实际点击 `report.xlsx` 链接、收到 download 事件并保存 **2469 字节**。SHA-256 为 `9f6a68dd3489cdb0cdc59cd16620351577c5ba856690a239912a37e727f0fdf8`，与 Django 文件记录一致。ZIP 校验通过，结果表有 sales_summary、inventory_age、pi_netshop_promotion 三条数据及表头，另有来源、指标口径和缺失数据表。
- 两次续问都实际在同一容器工作区读取该 XLSX、验证 ZIP，并返回上述相同 SHA、2469 字节与原 marker。校验对象是新一轮实际工具输出，不能仅靠历史提示中出现文件名判定。全部业务源读取都发生在第一轮；续问没有重新取数或重建报告。
- 全链共有 **10 个唯一模型 dispatch request ID，合成供应商调用计数也是 10**。unknown 只有一个模型 dispatch，刷新后计数保持 10，发送按钮禁用。停止后继续是确定取消后的下一轮，不是重放或自动续跑被中断步骤。

明细见 [browser-evidence.json](e2e-evidence/browser-evidence.json)、[backend-evidence.json](e2e-evidence/backend-evidence.json)、[http-calls.json](e2e-evidence/http-calls.json) 和 [real-stack.log](e2e-evidence/real-stack.log)。原始下载文件与截图位于 `D:/codex-artifacts/pi-phase1-closeout-20261018/e2e/attempt-20261018T182435/`，未把二进制产物加入产品源码。

## 私有资源与清理

namespace `pi-test-e2e-086b2edb230a`；Runner **18143**、PostgreSQL **55543**、Django **55562**、UI **55563**。每次均使用独立随机通道密钥/数据库密码，未读取正式凭据；临时密钥已删除。

测试内部 dispose 是逐操作尽力清理，异常会写 [dispose-attempts.json](e2e-evidence/dispose-attempts.json)，不能独自证明清理成功。本轮前四个历史 operation 的清理尝试返回 `pi_runner_unknown`，第五个当前 operation 的清理成功；保留这些原始清理异常，不把它们写成全部 dispose 成功。外层再按精确 namespace、镜像、容器名/卷标签独立检查：无残留容器，唯一私有工作卷已移除，复查零容器/零卷，Runner 进程退出，PG 停止，四个端口均关闭，私有 Linux 目录和 PG 数据目录已移除；见 [cleanup.json](e2e-evidence/cleanup.json)。没有 Docker prune、正式进程启停、服务安装或生产数据库写入。

## 复用入口与前期调试

本轮只新增三个测试入口，放在 `tests/`，不进入发布工具目录：

```powershell
# 从有只读复用 node_modules 的独立工作树执行；须有已审 Pi 镜像及 TERUISI-Pandas WSL。
& "D:\teruisi-runtime\django-sales\venv\Scripts\python.exe" tests/pi-e2e-run.py
```

launcher 复用既有私有 PG/Runner 启动方式；case 复用 `test_pi_real_stack.py` 的合成数据源与报告协议；browser 使用真实产品组件及路由。Python 语法编译、Node 语法检查和 `git diff --check` 通过。最终 [run-result.json](e2e-evidence/run-result.json) 为 `passed=true/sourceUnchanged=true/productionTouched=false/paidProviderRequests=0`；副本与外置原件 SHA 绑定见 [manifest.json](e2e-evidence/manifest.json)。

前三次夹具调试原件留在外置 `e2e/` 根目录及 `attempt-20261018T181944`、`attempt-20261018T182104`：第一次为复制 case 后 cwd 解析错误；第二次完全丢响应头导致 Chrome 传输层同键重试，触发过严的 HTTP 次数断言，并暴露 WSGI 请求线程连接未关闭；第三次已跑完五轮，但快照先采调用计数、后采终态，末尾得到旧计数 9/新终态 10 的采样错位。分别修正夹具路径、丢正文方式/请求连接关闭和采样顺序，保留原失败；不将这些调试失败冒称产品功能失败或删改为成功。旧 namespace 清理另有 `e2e/debug-attempts-cleanup.json`。
