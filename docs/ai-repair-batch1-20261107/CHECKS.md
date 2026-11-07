# 第一批检查分层

本页将必要代码检查、专项功能验证和生产采用分开。测试原件位于 `D:/codex-artifacts/ai-repair-batch1-20261107/`；不同层次、共享场景和返修前后结果不加总为一个“通过数”。

## 必要代码检查

| 检查 | 当前结果 | 原件与说明 |
| --- | --- | --- |
| TypeScript 5.9.3，原仓库配置 | 精确基线和候选均为 167 条，逐项一致，新增 0 | `types-baseline.json`、`types-candidate.json`、`types-comparison-final.json`；基线通过只读编译器宿主覆盖取得，没有覆盖工作区。W7 测试新增的类型错误已返修、独审并提交 `cb741e62`。不声称全仓类型检查全绿。 |
| 生产后端边界 | 1 个基线既有失败，无新增违规链 | `backend-boundary.log`、`backend-boundary-baseline.json`。`tools/tmall-sycm-cookie-pipeline.ts → lib/jackyun/n8n-preflight-evidence.ts` 的批准摘要与基线源码摘要不符；检查器、资格文件、入口、目标及 package.json 均与 `0c7d0feb` 原字节相同。未扩为无关整改。 |
| 发布准备与续接定向检查 | 118 项通过 | `pi/W2-publisher.log`；仅编排边界夹具，不替代 Windows 全栈冷启动或正式准备。 |
| 既有发布 profile 引用检查 | 10 项中 9 过，1 个基线同红 | `pi/W2-profile-fixtures.log`、`pi/W2-profile-baseline.log`。inventory 报 `Missing installed module: tools/publish-latest-main.mjs`，精确基线归档独立复跑同样失败。未修改 PowerShell 控制器资格字节。 |
| G02 固定候选验证入口 | 等最终干净候选执行，不能提前称通过 | 纯 profile 检查已发现当前适配器不覆盖本批混合应用与 Pi 镜像路径；最终入口结果及不覆盖清单须原样记录。定向测试不代替该回执。 |

Python 语法、Node 导入、Git 空白与最终源摘要在各小包及最终集成记录中给出。没有 package-lock、模型配置或数据库迁移变更。正式应用构建/制品准备仍须本次明确合并授权，不在开发阶段生成正式发布包。

## 专项验证

| 小包 | 已验证范围 | 实际层次 |
| --- | --- | --- |
| W7 | 客户与件数不同、真实零/缺字段/零分母、历史方法版本及两个取数通道 | Worker 58 项、Django 1 项；合成业务数据。测试类型补正另 15 项，通过原 Astra 增量复核。 |
| W4 | 普通问数、可信推广续问、否定推广、销售切换、页面入口及原权限 | Django SQLite/mock 10 项；原 Astra 独立函数对照 7 项。W3 后相关实际 answer 流已纳入直接影响复测。 |
| W3 | 持久 Stop、早到/迟到/派发许可/HTTP 间隙、实际 writer 权限、普通断流与 UI unknown 围栏 | 私有 PostgreSQL 9 项，Django SQLite/mock 37 项，Node 41 项；原 Astra 独立交互 7 项。供应商是回环模拟服务，不证明远端供应商被停止。 |
| W6a | 逐来源权限/导出/分页、签名通道、被动结果、旧 Broker 摘要兼容 | Worker 3 项、Django 25 项；真实本机 HTTP/HMAC 配合合成 Docker。Broker 8 个运行文件恢复原字节；内部诊断后置。 |
| W1/W2 | 容量拒绝、保卷/身份/历史、单名额竞争、未知保护、旧镜像和无 capability 唤醒 | 私有 PostgreSQL、实际 Broker/SQLite、真实 rootless Docker/Pi 与 Windows Django 签名连线分别记录在 [PI.md](PI.md)。模型回应为合成；原生共享场景不可重复加总。W2 模型快照返修已通过原 Astra 独立回归及原件复核。 |

原失败、反例、跳过和后续通过全部保留。未调用真实业务模型、未执行生产整链验收、未对生产旧容器做本轮盘点或清理。生产状态和回滚资格仍须未来对应授权及原生门禁现场核验。
