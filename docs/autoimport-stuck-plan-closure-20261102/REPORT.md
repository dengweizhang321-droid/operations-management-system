# 四条遗留链路闭合修复

## 交付范围

本任务按用户要求由 leader 组织施工与 Astra、GPT-6.1 Sol 独立反审。开发基线 `4e94566a0ffbfb9a95a3e344546aba3dd7a6f657`，独立分支 `codex/autoimport-stuck-closure-20261102`，工作树 `D:/codex-isolated/autoimport-stuck-closure-20261102`。

- 客服失败闭合采用独立持久回执，后续正常 A 按当前滚动窗口 fresh 采集。原来源恢复许可不扩权。
- 洗碗机支持受控从磁盘续接原最终 verify；不重新导出或导入。
- 切肉机仅在闭合证据分析中区分消息数量上限，正常导入 200 条限制保持。
- 厨电新增 downloaded_list_only 全链契约及来源/失败边界证明。
- 物流保留 9851 原资格，新增 11037 精确历史资格、只读候选准备、冻结目标 inspect/显式 apply，以及中断处理说明。

具体边界见 [施工说明](施工说明.md)、[客服实现](customer-service-implementation.md) 与 [物流实现](logistics-implementation.md)。

## 必需程序代码检查

2026-11-02，leader 在隔离 worktree 执行：

| 检查 | 结果及范围 |
| --- | --- |
| TypeScript 类型 | 以 13 个变更/新增 TS/TSX 为根及其传递依赖，加载仓库环境声明，noEmit；相同根对照基线，无新增诊断 |
| 既存类型问题 | `tools/sales-import-runner.ts` 的两处 fee 可能为 null 为基线继承，未扩入本任务；本次触及的 Uint8Array 编码调用已修正 |
| 模块与依赖编译 | helper pipeline、isolated helper、11037 CLI、客服 Worker API、既有客服控件共 5 入口，esbuild 内存编译（write:false）通过，无 warning；不执行生成代码 |
| Python 语法 | 修改的 Django authority 模块 AST 解析通过，不导入 Django、不连接数据库 |
| Git 差异 | `git diff --check` 通过；反审修正后补查类型和受影响的 helper/控件内存编译仍通过 |

以上不等于全仓类型检查全绿、不等于功能验收或生产制品准备。未运行功能测试、浏览器验收、正式业务 verify/apply 或生产导入。

## 反审与就绪状态

请求独立审查模型分别为 `gpt-6-astra / high` 与 `gpt-6.1-sol / high`。工具接受了请求，但未另行提供可独立确认底层实际型号的回执。两位审查者均未参与实现，读取完整差异与原始代码；最终完整审查及增量复核均通过，无剩余 P1/P2 阻断。具体发现与修正见 [独立反审记录](REVIEW.md)。

候选代码检查及反审完成，可交付任务分支；尚未取得合并授权，不宣称已发布或真实任务已恢复。任务分支提交与远端绑定以最终 Git 回执为准。

## 发布及现场动作边界

本次包含 Django authority、Worker API/既有控件、共享解析与本机 helper/恢复工具。对最终 21 个文件差异调用原生 release-scope-plan 分类与复制清单：`scope=full`、组件 `worker + django`、领域 `workflow`、`migrate=false`、未知路径为空。未增加数据库 migration；后续获合并授权后按此范围准备制品。

本轮未合并 main、未准备生产制品、未发布、未重启服务、未停用/恢复 n8n、未真正闭合四条任务或补跑。物流候选准备仅只读采集已有设置、批次摘要、执行及版本身份，不作为业务验收；观察时工作流仍启用，候选标注 `approved=false`、`executionEligible=false`，不构成现场执行许可。

合并 main 须获得本次明确授权，随后从最终合并提交准备对应制品；发布上线须另外获得本次明确授权。真实旧任务闭合、物流冻结/恢复及新业务 execution 属于后续受控操作，不能拿开发完成或版本上线代替其完成事实。

切肉机闭合不保证后续新窗口导入成功：超限会话仍在窗口时，整轮依然可能被 200 条限制拒绝。
