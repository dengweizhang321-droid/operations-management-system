# 京东客服闭合既有红测试修复

状态：候选，未合并 main、未准备生产制品、未上线。主线基线 `da3ab2e5f6d6d7022ab8b30ef4a9be23abfcd127`，独立树 `D:/codex-worktrees/jd-cs-close-red-tests-20261105`，分支 `codex/jd-cs-close-red-tests-20261105`。

## 范围与复用

直接读取用户指定的 `codex-提示词-客服闭合红测试.md`。已核上一诊断候选 `c673e6b129e3b8558ebeda67553fa3dc245421fe` 未合入本轮 main，因此在新树 cherry-pick 为 `45202da2`；旧候选树/分支保留。本候选已完整整合旧候选的改动，后续取得授权时只需合本次新分支，避免再单独合旧分支造成重复。本报告区分主线基线、已复用诊断和本轮增量，不把原有八条失败归因于未合并候选。

复用的是现有 `CustomerServiceCloseDiagnostic`、WeakMap 元数据、脱敏 reason 和对应隔离诊断测试；没有新增第二套机制。本轮只细分原拒绝条件的诊断，并同步过期 fixture、调用签名和已确认的测试语义。所有原安全门槛保持，没有新增 kind、闭合语义或业务续跑路径。

## 原失败基线与八项处理

基线在修改和复用前实跑，close-authority **20 项中 12 通过、8 失败**；同时运行其他指定的三个既有套件，合计 45 项中 37 通过、8 失败。其他三套分别 quality-recovery 5/5、daily-files 3/3、workflow 17/17。

第 8 项旧调用把 fetch stub 传为第三参数，但现行第三参数是 coordinator，第四参数才是 fetch，因此裸跑会调用默认的真实 localhost API。先静态识别此风险，再给基线和候选统一加载禁止网络的 preload，阻止 fetch、HTTP(S)、TCP 访问；基线第 8 项实际由 `TEST_NETWORK_ACCESS_BLOCKED` 在默认 fetch 截断。其余七条断言失败原样重现。没有为了取得第 8 项异常而访问生产 API。

| 提示词序号 | 基线失败与源码核实 | 分类及本轮处理 |
| --- | --- | --- |
| 1 | 合格 downloaded_pair 期望允许，实际拒绝。fixture 使用 `source.xlsx/source.log` 且未记 failureBoundary；现行检查要求固定 `list.xlsx/messages.log` 与浏览器已关闭的 export_messages 边界。 | fixture 过期。补真实允许形态，原 `closeAllowed=true`、kind 和生成器接受断言保留；没有放宽来源检查。 |
| 2 | 旧格式缺 failureBoundary，reason 未包含该字段名。 | 可诊断性退化。原拒绝条件挂 `failure_boundary_missing`，reason 明确缺少 failureBoundary；仍拒绝。 |
| 3 | 双文件失败码错误时，旧测试期待拒绝响应仍带 `target.kind=downloaded_pair`，实际无 target。 | 旧响应语义过期，同时缺少具体原因。当前 read-target 仅在 inspect 成功后构造 target，拒绝分支没有 target；原 edca 前的拒绝 target 仅作提示，已被统一候选契约替代。fixture 补齐后仍严格断言 `closeAllowed=false`，并明确断言 target 为 undefined、`failure_code_mismatch`、reason 包含固定 PAIR_PARSE_REJECTED，避免把未经核实的对象当成可提交候选。 |
| 4 | 自动白名单形态但缺 failureBoundary，reason 仍为泛码。 | 同第 2 项，恢复明确原因；不改自动白名单，不短路人工核查。 |
| 5 | executed 旧测试期待拒绝，现行代码有意返回 executed_verify。 | 测试语义过期。用户本轮已明确确认保留现有验证续接行为；同步测试为 executed_verify 候选，并断言仅原 C 验证、不重跑导出/导入。另核 planned/completed 仍拒绝。生产代码的 executed 分支没有改变，本轮没有新增业务语义。 |
| 6 | proofs 非空仍拒绝，但 reason 丢失“部分导入进度”。 | 可诊断性退化。在原 plan 拒绝条件上附 `partial_import_progress`，原拒绝门槛保持；测试覆盖 proofs、importingDate、dailyFiles 三类证据。 |
| 7 | 空来源而目录有残留仍拒绝，但 reason 丢失“残留”。 | 可诊断性退化。原边界拒绝附 `directory_residue`，不输出残留文件名或目录路径，仍拒绝。 |
| 8 | 第三参数误传 fetch，协议仍为旧 close-authority-v1；完整基线 tsc 同时报五处参数类型不符。 | 旧签名和协议测试过期。改显式 coordinator + 第四参数 fetch、现行 reconcile-authority-v2。坏版本、错授权编号、过期和无效编号均明确拒绝；正确授权只查询合成的已闭合精确目标，保持原闭合身份和原件，不生成恢复许可。禁止资源触达的 coordinator 保证该用例不进入真实槽位/n8n/端口链路。 |

提示词“全部是代码退化”的总标题不能作为事实：四个原因文案确实退化，但 fixture、拒绝响应契约、executed 与 dispatch 测试也确有过期部分。各类分别依据当前代码、历史 edca 前后差异和实跑定位处理。

## 本轮程序增量

`lib/jd/customer-service-close-contract.ts` 在已复用的诊断联合类型内追加四个固定类别。`tools/jd-customer-service-source-recovery.ts` 只在原条件已拒绝时选择对应类别；原条件的合取/析取、执行顺序、异常类型和错误码保持。`tests/jd-customer-service-close-authority.test.ts` 更新上述 fixture 与断言；复用的 `close-diagnostics.test.ts` 字节未改。

计数断言、正常导入 200 条限制、closureEvidenceOnly 策略、二次来源比对、锁、授权和 CAS 均未修改。原源码 `operator-reconcile` 没有改动。reason 只增加固定文案、类别及 plan 非敏感字段名，没有插入失败计划的任意值、路径、聊天或异常文本。

## 限定检查与证据

证据目录：`D:/codex-artifacts/jd-cs-close-red-tests-20261105/`。原始 TAP 和 tsc 输出为依据，汇总由这些原始结果生成。

| 套件 | main 基线 | 候选 |
| --- | --- | --- |
| close-authority | 12/20，8 失败 | 20/20 |
| quality-recovery | 5/5 | 5/5 |
| daily-files | 3/3 | 3/3 |
| workflow | 17/17 | 17/17 |
| close-diagnostics（复用） | main 中不存在 | 4/4 |

候选五套合计 **49/49**，记录 `candidate-tests.tap`。之后仅修四个 fetch stub 的 TypeScript 标注及返回的真实 Response，再跑受影响 close-authority，仍 20/20，记录 `candidate-authority-final.tap`；其他源码与测试没有变化，结果复用。基线记录 `baseline-tests.tap`、`baseline-failures.json`；逐套汇总为 `baseline-suite-summary.json`、`candidate-suite-summary.json`。网络禁止脚本为 `no-network.mjs`。

完整类型检查覆盖原 tsconfig 全部包含文件，基线与候选使用同一 TypeScript、同一配置和无缓存参数，等同执行 `tsc --noEmit -p tsconfig.json`，额外 `--incremental false --pretty false`；Node 堆上限 2GB，单次 120 秒硬期限。干净隔离树没有 outputs/tmp，未复制生产配置。基线实际 **173 条 error TS**、exit 2、47.18 秒，不能以工作区带噪声时“约237条”代替此次基线。

首轮候选完整 tsc 也有 173 条：旧五处 coordinator 参数错误消失，但四个过窄 fetch stub 导致五处新类型错误。没有把它报告为通过；保留 `candidate-initial-*` 输出与差异。随后仅把四个 stub 标注为 `typeof fetch`、返回真实 Response，重做完整检查，最终 **173 → 168，新增 0、消除 5**，43.24 秒。消除的是原 close-authority 第 165/172/176/180/182 行的 coordinator 参数 TS2345，其余 168 条原始排序 error TS 行完全一致，没有行号移动噪声。整体仍 exit 2，未宣称全仓类型全绿。证据为 `typecheck-comparison.json`、排序原始 error TS 行与 `typecheck-errors.diff`。

原生 helper 构建在独立 artifact 目录完成，exit 0；bundle 的 `node --check` 通过，构建回执中的 source-recovery 输入 SHA 和 bundle 输出 SHA 均与最终文件一致，记录 `helper-build-check.json`。没有启动 bundle 或生成生产应用包。`git diff --check` 和任务报告引用检查随交付完成。没有追加其他业务测试、功能验收或生产接口检查。

初次启动 baseline 测试使用 Windows 绝对路径传 `--import` 被 Node URL 规则拒绝，未运行测试正文；已保留初次失败记录，改为合法 file URL 后取得上述基线。一次 PowerShell 文本重定向造成中文编码展示问题，已保留旧输出并由 Python 原始字节捕获重跑基线，报告引用后者，不把加载失败或乱码输出冒作业务断言证据。

## 交付边界

没有生产 API 请求、部署核查、业务采集、导入、重跑、闭合 POST、迁移、备份、发布、启停或进程终止；生产 outputs/active 与来源原件未读改。测试文件均在 mkdtemp 隔离目录构造。主线基线与复用候选树保持，任务不合 main、不准备生产制品。

两个 Astra High 独立反审均通过，包含最终 stub 类型增量及 173 → 168 的完整类型对照，见 [双独立反审](REVIEW.md)。既有只读分类器对完整程序差异给出 `scope=full`、`components=[worker]`、`migrate=false`；保留完整 Worker 处理范围，不涉及 Django 载荷或迁移。该分类仅是计划，未准备制品。候选的合并/准备、上线仍各按现行授权边界执行；此报告不是生产操作授权。
