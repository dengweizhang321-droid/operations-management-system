# 证据索引

| 入口 | 用途 |
| --- | --- |
| [VALIDATION.json](evidence/VALIDATION.json) | 最终命令、退出码、执行前后同一源码 SHA、stdout/stderr 摘要 |
| [SHA256SUMS.json](evidence/SHA256SUMS.json) | 任务报告、独审、验证器及所有证据文件的原始字节索引（不自包含） |
| [Node 原始输出](evidence/node-targeted.stdout.log) | 新协议、原队列与封存历史协议回归 |
| [控制包材料构建](evidence/frozen-control-materials.stdout.log) | 原构造器私有产物、完整成员与两个实际包内 help；不采用 |
| [PS5](evidence/ps-5.json)、[原始输出](evidence/ps5.stdout.log) | 实际 PS5.1 门禁 facts 正/负例与 AST 前后比较 |
| [PS7](evidence/ps-7.json)、[原始输出](evidence/ps7.stdout.log) | 实际 PS7 门禁 facts 正/负例与 AST 前后比较 |
| [SOURCE-OBSERVATIONS.json](evidence/SOURCE-OBSERVATIONS.json) | e786 原结果 unknown、无 resolution，及原 ExitMaintenance 失败原件摘要 |
| [历史兼容清单](../../tools/preparation-resolution-history.mjs) | 8 条不可扩展的历史原字节/完整证据树摘要及原 replay 策略 |
| [producer 资格](../../tools/preparation-producer-qualification.mjs) | 经审原执行代码闭包摘要；无 dispatch 事故编号 |
| [历史测试原件](../../tests/fixtures/legacy-preparation/) | 从 f641685b 原字节保全，不进入控制包 |
| [独立审查](REVIEW.md) | 未参与方案/实现的新上下文审查、发现与增量复核 |
| [初次失败](evidence/initial-failures/VALIDATION.json)、[第二轮失败](evidence/second-failures/VALIDATION.json) | 保留早期失败，最终报告单独出具 |
| [规范化前通过记录](evidence/before-normalization/VALIDATION.json) | 代码行为通过后统一 Git 字节；最终版本重新构建及定向验证，不沿用旧字节摘要 |

原始失败与历史 evidence 均仅只读访问；未复制客户数据或凭据。没有为 e786 生成 resolution 或 evidence 目录。
