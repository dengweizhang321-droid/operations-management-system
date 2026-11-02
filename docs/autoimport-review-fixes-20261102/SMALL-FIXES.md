# 展示来源与模型注释最小修复

日期：2026-11-02。基线：`4e94566a`。本文件只记录本执行单元；客服与通知修复由其他执行者负责。未修改主工作区未跟踪的原始反审报告。

## 变更与边界

- `lib/netshop/tmall-direct-daily-policy-runtime.mjs` 承载原有纯策略实现。原 `.ts` 入口保留函数名、泛型签名和返回类型，通过代理复用同一实现；现有 TS 消费者不用改 import。原生 `.mjs` 目录生成器直接调用同一策略，从有效店铺的 `productMasterCadence.intervalDays` 生成 `masterIntervalDays`，不再另抄每日常量。无新增依赖、TS loader 或配置写入。
- 正常重生成 `lib/imports/chain-catalog.generated.json` 和 `backend/workflow/import_chain_catalog.json`，均无字节差异；现有六店目录仍为有效每日节奏。
- `app/n8n-workflow-view.tsx` 仅改天猫配置文案：两处三日表述改为每日直连；更正旧商品管家/逐页导出及推广页面下载描述，补充当前近七日缺口与逐日循环说明。复用原 `workflowConfigs.tmall`、原卡片/概览/安全说明组件与 CSS；不改工作流定义、请求、权限或导航。
- 页面仍导入原仓库模板并显示其原阶段标签；实际发布状态以 n8n 为准，本轮没有换模板或改节点。有效策略说明不证明六条 n8n 工作流均已启用。
- `backend/workflow/automation_models.py` 只纠正说明：三轴是独立列，词汇可以重叠；`choices` 需显式校验，`save()` 不自动 `full_clean()`，现模型没有三轴值域 `CheckConstraint`。不新增字段、约束、`blank=True` 或迁移。
- [tmall-workflow-copy.html](tmall-workflow-copy.html) 从实际天猫配置和既有 n8n 样式提取静态交付片段，保留卡片和可展开安全说明；不包含在线编辑器或真实操作。

## 原报告结论的采用范围

依据 [已交付反审报告](https://github.com/dengweizhang321-droid/operations-management-system/blob/20796b9d2757454d1f5e4462654bb34b8b6b7436/docs/autoimport-report-counter-review-20261102/REPORT.md)，本轮采纳其真实展示来源问题和虚假注释纠正，不把理论三轴组合推成当前 UI 静默事故，也不增加数据库矩阵闸、整行 `full_clean()` 或发布前置条件。人工路由与客服三种未完成状态须按各自入口处理，由其他执行单元记录。

保留原报告末尾已有有效更正；“历史三日文档未判过期”、历史目录漂移的反向归责、未披露 `errorWorkflow`、仅凭草稿变更认定本轮修改、`executed` 等同完成、全部本轮仅99项等说法，以已交付反审报告的纠正和证据边界为准。本轮没有重写旧报告或改写历史现场。

## 必需检查

- `node --check`：目录生成器、共享策略 `.mjs` 通过。
- TypeScript 5.9.3：受改 TS/TSX 的 `transpileModule` 语法检查通过；共享 `.mjs` 与保留的 TS 泛型入口执行局部 `strict + checkJs + noEmit` 类型/依赖检查通过。
- esbuild：从原 TS 入口解析并内存打包共享 `.mjs`，浏览器目标依赖检查通过；未落生产制品。
- Python `ast.parse`：受改模型文件通过；仅注释变化，无迁移。
- 目录正常重生成后两份输出没有差异。
- HTML 用无登录态、隐藏的独立浏览器读取 Windows `file:///D:/codex-worktrees/autoimport-review-fixes-20261102/docs/autoimport-review-fixes-20261102/tmall-workflow-copy.html`，每日直连文案读取、安全说明原生展开交互通过，资源网络请求为0；未启动在线预览。
- `git diff --check` 通过。

没有运行应用功能测试、全量测试、生产接口、导入、采集、闭合、迁移、服务启停、n8n 修改或外部发送。未提交、推送、合并或准备生产制品，交由 lead 统一交付。
