# 库存入口与链路状态修复

## 需求与范围

修复库存管理的天猫入仓入口崩溃、数据导入链路规则无法读取今日执行状态，并在既有矩阵展示京东及天猫库存工作流。复用实际主导航、库存子导航、原天猫组件和链路规则矩阵；不新增页面布局、调度器或业务写入。

基线：`19db6d2c217ea6a27fe22e9e29e38a70c3420dee`。独立工作树开发，主工作区既有修改保持。

## 天猫入口根因与修复

2026-10-18，通过本机正式 Chrome 新标签打开 `/?module=inventory&view=tmall_warehouse`，页面白屏；浏览器控制台报 `Error: AI 页面上下文无效`，栈指向 `page-context` 和主页面的 `useMemo`。实际导航已包含 `inventory.tmall_warehouse`，而 AI 页面上下文白名单遗漏该值；相同遗漏还影响自动化中心的 `tmall_warehouse`、`jd_logistics` 入口。

补齐 TypeScript 和 Django 的这三个精确视图值。继续拒绝未注册及跨模块视图，不放宽其他上下文校验。没有修改库存数量、权限、导入和工作流执行逻辑。

## 今日状态读取与库存链路

公开状态入口现场仍返回 503。使用显式配置的本机 n8n 元数据路径直接运行原 reader 可正常读取，未复现 schema、权限或两秒预算失败。固定发布器的 `publisherEnvironment` 白名单不继承 `TERUISI_N8N_STATUS_DATABASE_PATH`，而原 Django 设置只读取进程变量；这给出配置在发布启动路径丢失的证据支持。未读取运行中 reader 的进程环境，因此不声称已直接证实该进程缺少变量。

新增 Django 配置解析器：进程变量存在即优先，包括显式空值禁用；仅缺键且在 Windows 时读取当前用户 `HKCU\Environment` 的同名显式配置。无配置、拒绝读取或非字符串继续返回空值，后续 reader 保留绝对路径、重解析点、只读事务、时间和数量上限。未修改固定发布环境指纹、启动控制器、权限或进程生命周期。

另用实际 `publisherEnvironment → productionCommandEnvironment` 构造过滤后的环境并启动真实新 Python 子进程：确认路径变量不在环境中；旧解析返回 `n8n_status_unavailable/503`，新解析读取已显式持久配置后成功返回 `source=n8n_execution_metadata`，17 个白名单工作流，最终采样读取约 0.016 秒。该对照只读 n8n 元数据，不启停正式 reader、不触发业务流程；证据位于 `D:/codex-artifacts/inventory-route-status-fix-20261018/chain-status-evidence.json`。

目录新增 `JdLogisticsDaily2026` 和 `TmallWarehouseDaily2026`，使用事业部/货主库存主体，复用原矩阵。完整手动成功要求原手动入口、所有权门禁、京东 A/B/C/D 或天猫 A/B/C 及成功释放均执行成功；精确匹配库存模板的独立错误输出模式，仍拒绝任何实际错误、局部执行、缺回查或缺成功释放。n8n 执行状态与实际库存批次结果仍分开判断。

## 验证

- 修改前：`tests/ai-page-context.test.ts` 的导航/上下文一致性检查失败，确认主导航和上下文目录不一致。
- 修改后：`node --import tsx --test tests/ai-page-context.test.ts tests/app-shell-navigation.test.ts`，13 项通过。
- `D:/teruisi-runtime/django-sales/venv/Scripts/python.exe backend/manage.py test ai_assistant.test_inventory_page_context --noinput`，2 项通过，使用 `SimpleTestCase`，未创建或访问生产业务库。
- `node node_modules/eslint/bin/eslint.js lib/ai/page-context.ts tests/ai-page-context.test.ts` 通过。
- 集成定向验证：上述两个前端测试文件加 `tests/import-monitor.test.ts` 共 22 项通过；上述 Python 测试加 `workflow.tests.test_import_chain_status`、`workflow.tests.test_import_chain_config` 共 26 项通过。覆盖显式值/空值优先、非 Windows、缺失/拒绝/非法持久配置、真实清空应用环境的 Python 子进程经 settings 读取合成 n8n 元数据，以及库存缺阶段/错误释放/局部执行等拒绝路径。
- `app/import-chain-rules-view.tsx`、`tools/build-import-chain-catalog.mjs`、`tests/import-monitor.test.ts` 的定向 lint 及 `git diff --check` 通过。
- 既有 `Copy-ApplicationTree` 递归纳入 backend 的 `.py` 文件，新配置模块位于原封包范围；未新增依赖或 migration，原生准备仍需核对实际封包。
- 原天猫组件可由既有 HTML 导出器打包。浏览器工具的 URL 策略拒绝 `file:`，未绕过；该 HTML 的本轮 file URL 视觉/交互验证未完成，不作为通过证据。

## 交付边界

本轮未授权生产上线、启停服务、真实下载/导入、启用工作流或发送通知。代码验证、合并推送、原生制品准备及实际采用分别记录；合并或准备不代表已上线。

独立审查请求 `gpt-6.1-sol / high`（工具未另行返回实际底层模型），新上下文直接核对差异、工作流模板、权限/失败边界和封包逻辑，独立复跑上述 22 项 Node、26 项 Django 全通过，无阻断；补读本报告确认推断边界一致。相关执行和审查均按当前模型分工规范派工。

从生产来源 `19db6d2c` 到本次代码的完整 Git 差异范围计划为 Worker + Django，无 migration；生成目录工具和共享运行库使计划采用完整组件流程，验证仅围绕实际改动与直接依赖。部署前沿用原生准入与恢复流程，不重放未知操作；本任务不授权库存补跑或数据写入。
