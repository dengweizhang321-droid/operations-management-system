# 京东物流流水直接下载修复

状态：开发候选，未合并、未准备制品、未发布。工作树 `codex/jd-logistics-flow-direct-download-20261123`，基于 `a5a51507`。本轮不访问真实京东、生产目录、n8n 数据库、Profile 或凭据。

## 根因证据与适用范围

以下来自 Lead 在 2026-11-23 提供的只读排查，本轮未访问真实环境独立取证：

| 场景 | 从导出请求到下载开始 | 观察结果 |
| --- | --- | --- |
| 历史成功 1 | 4.0 秒 | 新页面下载，`tab_url` 为空 |
| 历史成功 2 | 4.7 秒 | 同上 |
| 历史成功 3 | 4.5 秒 | 同上 |
| 历史成功 4 | 4.1 秒 | 同上 |
| 2026-11-23 20:13，execution 11938，6388 行 | 等待 45 秒仍未开始 | 导出已提交并返回附件地址；零下载事件，报 `JD_LOGISTICS_PRODUCTS_DOWNLOAD_AMBIGUOUS` |

源码确认流水依赖页面自行打开附件并被动等待下载事件。异步生成逐渐变慢、超过浏览器用户激活期从而被拦弹窗，是合理推断，未有直接日志证明。本次修复只依赖“附件已返回但页面零下载”的事实，不依赖该推断成立。

## 改动与合同

- 只改 `tools/jd-logistics-export.ts` 的 flow 路径。通过同一 `BrowserContext.request.get` 下载 `flowLogisticsAttachment` 已校验返回的精确地址；无需新页面或弹窗激活。GET 超时 45 秒、`maxRedirects: 0`、`maxRetries: 0`，不拼接或改写地址，拒绝所有重定向、非 200 和最终地址变化。
- 页面下载监听独立于商品/JH：同步接管主页面、新 context 页面及 popup 的下载事件。同附件重复事件可通过，不同 URL（包括同地址追加 query）失败关闭。只将主动 GET 的字节保存到一份 `source.csv`，不保存原生重复下载。
- 响应声明大小与实际字节长度继续受 `JD_LOGISTICS_MAX_FILE_BYTES` 限制，释放 APIResponse；CSV 合同、期望行数、原始 SHA-256、字节数与下载完成后的复用判定保持。
- 一次 operation 仍只有一次导出提交。下载异常继续使用 `JD_LOGISTICS_FLOW_ATTACHMENT_DOWNLOAD_MISMATCH` 等现有码；manifest 保持 `submitted`，不自动重放。version 2、字段集合与 `submitting → submitted → downloaded` 生命周期不变；`downloaded` 仍由原外层在浏览器清理成功后写入。人工 pre-import 闭合和自动 zero-effect 边界保持。
- `exportFlowSource` 增加导出声明，仅供合成夹具直接调用真实流程。`productDownloadWatch`、商品和 JH 行为均未改。

## 检查记录

用户指定的检查仅使用合成 page/context、测试数据及既有隔离夹具，不产生真实业务请求。

- 严格基线：从 `a5a51507` 读取原始 exporter 和导出测试，在候选文件暂存于进程内存、原始源码保持不变的条件下运行全部八文件，135/135 通过，0 失败，314890 ms，结束后恢复候选原字节。记录 `tmp/flow-baseline.log`。首次八文件也为 135/135，但后段文本检查与编辑有交叠，不单独将其作为严格基线证据。
- 新增流程覆盖：零弹窗、正常弹窗、同 URL 重复事件、不同 URL（提交时及 GET body 时）、请求失败、超时、跨 origin 重定向、最终 URL 改变、超大声明、行数不符。失败均核对 `submitted`、单次导出及公共入口禁止重提。
- 首轮新增测试 20/28：8 项在最后的禁止重提断言触发夹具目录错误；修正为项目根下独立导出目录后 28/28 通过。实现校验未放宽。
- 首轮直接传文件的 tsc 调用未继承仓库 `@/*` 别名，产生依赖模块诊断；改为继承仓库 tsconfig、仅 include 两个改动 TS 文件的严格检查后通过。ESLint 通过。
- 注入 1：去掉 `await downloads.save(attachment, filePath)` 主动下载调用，`flow blocked: exact attachment GET succeeds once with one saved CSV and verified row count` 因缺少 `source.csv` 变红（1 fail，进程 exit 1）。记录 `tmp/flow-mutation-no-active-download.log`。
- 注入 2：去掉原生下载 URL 必须等于附件 URL 的断言，`flow mismatch: fails closed at submitted with no second export submission` 因没有拒绝不同 URL 变红（1 fail，进程 exit 1）。记录 `tmp/flow-mutation-accept-other-url.log`。
- 两次注入后均恢复原源码。恢复并统一 LF 后，两份改动 TS 的 strict tsc、ESLint 均 exit 0；`git diff --check` 通过。最终八文件 **146/146 通过，0 失败，327249 ms，进程 exit 0**，记录 `tmp/flow-final.log`。
- 按自动化一般流程变更规范完成一次独立只读 review：未发现阻断问题，未追加测试或真实环境验证。审查者独立读取三个改动文件、直接依赖、基线与注入日志；最终八文件通过结果由本会话核对。请求模型 `gpt-6.1-sol high`，工具未提供实际模型的独立确认字段。

检查命令：`node --import tsx --test tests/jd-logistics-{export,pipeline,session,zero-effect-closure,pre-import-closure,flow-csv-contract,product-download,helper-bundle-contract}.test.ts`（执行时展开为八个文件名）；严格类型检查继承根 tsconfig，关闭 incremental；ESLint 只检查两份改动 TS。临时配置和日志位于工作树 `tmp/flow-*`。

## 文本及字节钉检查

- `tests/jd-logistics-zero-effect-closure.test.ts` 钉的是会话守卫构造、调用和导航发生在首次导出清单写入前的文本关系；本次未改变该关系，无需同步 pin。
- `tests/jd-logistics-helper-bundle-contract.test.ts` 检查 helper 闭包不含 `import.meta`、操作员 CLI 不进入闭包；本次未增加依赖或 `import.meta`。
- `tools/close-jd-logistics-*.ts` 的 exporter 哈希及文本断言针对各自绑定的历史 release/source-snapshot，未改历史哈希或工具，不把新源码当历史制品。

## 交付、风险与待办

风险：流水范围按配置从 **2026-10-15** 累计增长，本次不改范围口径；文件生成耗时和大小仍会增长，原大小上限继续生效。

未执行 push、合 main、制品准备、发布、迁移、生产写入、真实外发、真实京东补跑、n8n 或配置修改。

【待答：本地提交交回 Lead】仅尝试一次暂存三个任务文件，`git add` exit 1：`Unable to create 'D:/运营管理系统/.git/worktrees/jd-logistics-flow-direct-download-20261123/index.lock': Permission denied`。因此未执行 `git commit`，未重试或提权；三个交付文件保留为未提交改动。提交信息已写在工作树 `tmp/flow-commit-message.txt`，包含要求的 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。Lead 可在具备正常 Git 写权限的环境中完成单个聚焦提交；本轮不 push。

共享记忆目录在沙箱可写根之外，本轮不能写入，待 Lead 转存非敏感项目状态：2026-11-23 京东物流流水下载候选改为同 context 的精确附件 GET，禁重定向和重提，允许同 URL 重复事件；manifest/闭合协议不变。仓库报告为证据来源，候选不代表已采用。
