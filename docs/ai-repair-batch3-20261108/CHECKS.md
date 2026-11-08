# 第三批验证记录

以下证据分别绑定业务源码、实际工具、隔离环境和所测边界。未决账户及生产采用条件见 [交付总览](REPORT.md)。

| 范围 | 通过项 | 实际覆盖 |
| --- | --- | --- |
| W10 返修后 | Django 55、Worker 17、独立 Astra 7，定向 ESLint | 三场景、三类原生 Schema 适配、版本和尺寸证据，跨请求号、跨管理员与陈旧未决回执，明确终态重测。使用合成供应商和 SQLite，可重入交错测试未覆盖 PostgreSQL 双连接争锁。 |
| W11a | Django 95、1 项 PG 条件跳过，Node 14。独立合成 Django 65、组件和路由 12 | 报告候选和文字资源库，人工审核、版本、发布回读、停用和冻结。React 测试渲染器与合成网络。 |
| W11b | Django 51、Worker 9，独立后端 9、前端状态 8，真实签名容器 1 | 当前目录与在途包版本隔离。实际 Django 签名 HTTP、私有 Runner 与容器，执行已审 Excel 脚本并验证产物。模型为合成两轮。 |
| W12 R1 | 主线与第二批组合各私有 PG 12，独立 SQLite 4 | 两个来源、错渠道拒绝、原时点唯一、本人目标、原回执、停用。测试事实和网络回应为合成夹具。 |
| 前两批隔离组合 | 编排串行 128，定向双证明 4，独立复跑 4 | 来源、准备、切换、续接接缝使用原生动作替身。真实组合冷启动待验证。 |
| 必需应用检查 | Worker 构建、Django 检查、差异空白 | TypeScript 167 条与精确基线逐项一致。全仓后端边界检查仍报既有天猫到吉客云预检引用，相关文件无本批差异。 |
| 可打开的文件 | Windows file URI 交互验证通过 | 详情、活动尺寸选择，Pi 页签及展开，窄屏无横向溢出，零文档资源请求。 |

原件路径在 `D:/codex-artifacts/ai-repair-batch3-20261108/`。首轮 G02 拒绝未获资格的应用路径。初版适配器按应用差异预期 `combined`，而计入验证器后完整计划为 `full`，原失败日志留存。最终固定入口按实际完整计划验证。

最终 G02 绑定应用冻结 `d9a148335ffeb6dc75328d81342d8f94e60297c5` 和受检提交 `304c7d6410bf4578423913bab9590df5e9a3636e`。Worker 与 Django 全范围检查，迁移标记为 false。九项原生及隔离检查均退出 0，候选载荷 8,463 项，候选目录和 Git 登记已清。Astra 独立核对日志、工具、载荷摘要及 18 项准入边界。机器结果的 `packageIntegrity` 和 `nativeEntryBoundary` 为 true，`nativeColdStart` 为 false。

- [G02 机器结果](D:/codex-artifacts/ai-repair-batch3-20261108/candidate-compatibility-g02-v3/REPORT.json)，SHA-256 `063473f23c23c9b43ddd2403ab1bca9a31bb2b3221789e16eeaa5de0bcdd29e5`
- [G02 独立复核](D:/codex-artifacts/ai-repair-batch3-20261108/g02-astra/REVIEW.md)
- [最终 Worker 构建](D:/codex-artifacts/ai-repair-batch3-20261108/worker-build-final.log) · [TypeScript 基线比较](D:/codex-artifacts/ai-repair-batch3-20261108/types-comparison.json)

W11b 私有运行沿用批二隔离 WSL，测试 Pi 镜像独立构建。前置失败分别涉及私有 Docker 尚未就绪、BuildKit 缺失、源码归档漏配置、隔离网关字符串或加密配置未对齐。原失败保留，每次新建独立测试身份。最终签名运行成功，Pi 容器与卷清零，私有发行版及 rootless Docker 回到停止状态。第一、第二批发布资格及真实生产环境状态不由这次隔离回执替代。
