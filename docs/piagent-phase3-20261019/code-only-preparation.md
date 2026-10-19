# 必需代码检查与制品准备

本增量只调整原生 Worker 准备材料，落实本次“只检查构建、部署、启动必需代码”的要求。新构建不再调用原 sales 功能测试；既有测试文件、v1 收据和旧制品保持原语义。

新收据版本为 `teruisi-sales-retired-code-receipt-v2`，明确记录 `status=code-checked`、`codeOnly=true`、`functionalValidationPerformed=false`，不生成 TAP 或功能通过声明。源树、锁文件、Node 版本、构建命令和制品指纹绑定原构建闭包。验证器对 v2 使用精确字段并从已核验的源快照重新生成静态 D1 退役证据；v1 继续走原测试收据验证分支。版本、制品完整性、身份、权限、前驱、互斥、排空、启动及 trusted verifier 精确字节门禁保持。

固定控制安装器增加限定的 `--native-tools-update` 材料入口。它只接受已固化前后 SHA 的三个原生文件：旧 `worker-local-release.mjs` 加本次收据改动、旧 rotation 加 v2 版本识别、未变的 `d1-retirement-proof.mjs`。新闭包存放在 `stateDirectory/native-tools/<闭包摘要>/tools/`；不把整个最新 main 作为原生工具来源。更新只改变配置中的 `nativeToolsSource`，复用原配置 CAS、队列锁、rotation 锁和进程收敛门禁，不能与依赖更新混为同一意图。

外层 `readLivePublication` 的原生来源只用于完整链和已安装 guard 核验，不调用完整候选 verifier。实际构建和发布仍由最终冻结来源执行；候选 verifier 与 Django trusted copy 的精确字节绑定不增加旧版本例外。

本次已执行 Node 语法、差异空白和必要材料/依赖绑定检查；未新增或运行功能测试、SQLite 业务演练、业务接口或生产操作。外置材料位置：`D:/codex-artifacts/piagent-phase3-20261019/CODE-ONLY-NATIVE-TOOLS-UPDATE.json`。材料准备不代表控制采用、应用制品 PREPARED 或上线；旧 UNKNOWN 的协调另走其精确原请求协议，不由本入口消除或重试。
