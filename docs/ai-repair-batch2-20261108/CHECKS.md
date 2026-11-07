# 第二批检查与证据层次

当前为开发交付候选；Pandas 专用轮换、逐项独审与最终固定兼容检查均完成。所有原失败保留。不同层次及返修前后同场景不相加为一个通过数。

| 小任务 | 当前有效检查 | 证据边界 |
| --- | --- | --- |
| W5 模型诊断/报告选择 | 首包私有PG4、Django85+1条件跳过、Worker2；别名返修PG5、SQLite29+4条件跳过；原Astra增量独立4通过 | HTTP/模型回复合成；未新增真实供应商长任务。别名PG含真实writer角色和原不可变触发器。 |
| W6b 完整导出 | Django36+2既有真实PG/Broker跳过、Worker10；独审Django20/Worker4通过；原Astra另核两来源真实DataFrame增量 | 来源与 owning ORM 使用隔离SQLite/合成reader。真实容器链为mock datasets.query→实际export_frames→真实签名容器，不把跳过项改写为通过或完整生产取数链。 |
| W8 投递 | 私有PG83、SQLite73+8PG条件跳过；独审22通过；ESLint与PythonAST通过 | 传输与外部平台为模拟；不声称双连接竞争或真实平台送达。两项旧PG夹具在W8前触发immutableguard的原失败保留。 |
| W9 等待 | 初始SQLite5/PG5；两P2返修后SQLite6、定向PG2；原Astra增量2通过 | 合成provider；同条件各10个图从6轮变4轮，仅声明减少调度次数，无线上秒数承诺。 |
| W6R 专用轮换 | Linux真实root/systemd/UID1000/rootless容器第05轮、Windows实际未配置入口及已配置原函数接缝通过 | 原Linux启动证明与Windows函数接缝分开；后者真实WSL启动/签名/自测/原回执已测，Windows保活/安装保护/租约为私有fixture，完整Windows栈未测。 |
| W6R Node 发布编排 | 新Pandas定向10通过；首次相关99项中98通过，原readiness短预算项失败，未改测试的孤立重跑通过 | 原生动作是夹具；失败原件保留，不称全仓CI全绿，不替代Linux/PS原件。 |
| TypeScript | 5.9.3，基线和候选167条file/code/message逐项一致，新增0、删除0；原命令退出2 | 不是全仓类型全绿。既有错误未扩修。 |
| G02 最终固定入口 | 干净 `9368676d` 的4项实际检查退出0；原Astra最终增量通过 | 完整载荷8,486项、5工具、8日志及引用摘要核验；`packageIntegrity/nativeEntryBoundary=true`，完整Windows `nativeColdStart=false`，限定Pandas scope实证单列。 |

外置证据根：`D:/codex-artifacts/ai-repair-batch2-20261108/`。小包源码与测试绑定分别在 `w5/SOURCE.json`、`w5/r1/SOURCE.json`、`w6b/W6B-FREEZE.json`、`w8/MANIFEST.json`、`w9/SOURCE.json` 与 `w9/SOURCE-r1.json`。类型对照见根目录 `types-comparison.json`；比较脚本保留 TypeScript 嵌套消息缩进，未通过吞掉诊断伪造无新增。

## 可直接打开的界面文件

- [报告模型选择 HTML](D:/codex-artifacts/ai-repair-batch2-20261108/w5/W5.html)：冻结仓库运行范围 JSX 直接渲染，合成模型A/B与默认选项；file://检查选中B、3选项、窄屏无整页溢出、外部请求0。不是交互式生产整链。
- [投递状态 HTML](D:/codex-artifacts/ai-repair-batch2-20261108/w8/W8.html)：实际状态组件渲染5种合成状态，file://检查外部请求0。无真实消息动作。

## 隔离环境

本批独立 WSL `Codex-AI-Batch2-20261108` 从官方 Ubuntu24.04.5 镜像导入，根目录 `D:/codex-isolated/ai-repair-batch2-20261108-wsl`；不借用生产 `TERUISI-Pandas`。rootfs校验摘要及安装脚本在 `environment/`。rootlessDocker29.1.3、UID1000、cgroup2/systemd、CPU/内存/交换/PID限制可用；rootful服务被mask，Windows磁盘自动挂载与互通关闭。

测试镜像 `sha256:4c5815d845a4579d5402f2f4c22c8c822701a0116df2e0fc8b28ef31e832d580` 使用原仓库 Dockerfile、entrypoint 和已审 Python 基础镜像摘要。它仅为隔离测试镜像，不是正式生产制品；来源绑定见 `environment/IMAGE.json`。安装时PowerShell管道末尾CR及首次rootless服务PATH遗漏均已查明，只影响这个新隔离实例，后续使用字节stdin与正确私有service环境；原失败没有冒充成功。

真实业务数据、真实供应商调用、生产修改、生产容器清理与钉钉外发均为0。main未合并，正式应用制品与上线未执行。

## 最终固定入口

[成功机器报告](D:/codex-artifacts/ai-repair-batch2-20261108/candidate-compatibility-g02-v2/REPORT.json) SHA-256 `3ed9b8c46b4be6dfba7d62dde28df3b452f7f05f96c9698f1f6353ec2cb2e8a4`，绑定提交 `9368676d81a175c86c0d7bd6f90d1de395765d67`。实际 `ai-repair-batch2-compatibility`（4项）、`ai-repair-batch2-publication`（10项）、`powershell-entry`（1个实际多入口用例）及 `actual-django-package`（原生PASS）全部退出0，最后源/工具/依赖漂移复核与隔离候选清理通过。详见 [独立复核](REVIEW-G02.md)。首次 `candidate-compatibility-g02-v1/REPORT.json` 因PS5错误显示折行导致文本断言失败，修正后新目录实际重跑通过，旧失败未覆盖。

测试环境最终为 [retained_stopped](D:/codex-artifacts/ai-repair-batch2-20261108/environment/FINAL-STATE.json)：四个精确试验unit inactive/MainPID0、本域零容器、18129零监听后，停止本批rootlessDocker并终止本批发行版及保活。测试磁盘、镜像及故障意图保留；未停止其他发行版或生产服务。
