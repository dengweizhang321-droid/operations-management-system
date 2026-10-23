# WP-5G 必要修复：PS5服务包装器真实退出码

本次只有 `tools/operations-system-service.ps1` 产品源码变化。复用既有 `django-runtime-supervisor.ps1:405` 的方式：等待前读取Process.Handle以持有原实例；退出码缺失即失败关闭，再转换int。非零失败文本携带实际退出码。不改原文件重定向、500ms轮询、进度、JSON选择、日志轮换、锁、唯一启停引擎或背景receipt。

修复提交：`2f21c238d2a4766caad547d08be63acab769ab08`。本报告及原始日志作为随后独立文档提交交付，不宣称已合并或已安装。

## 原失败与修复后

隔离library-only加载服务函数，将ProjectRoot/LogRoot改为任务tmp目录，系统锁使用随机测试名称。真实Windows PowerShell子脚本打印 `{"status":"completed"}` 后 `exit 9`。

| 宿主 | base实现 | 修复后 |
| --- | --- | --- |
| Windows PowerShell 5.1 | accepted=true，failure=null，错误接受completed | accepted=false；真实exit9拒绝 |
| PowerShell 7 | accepted=false | accepted=false |

PS5的Start-Process返回wrapper未提前持Handle可能给出null ExitCode，而 `[int]$null` 是0。上述真实对照证明本调用方错误路径；不证明f15 Backup外层exit1或历史supervisor退出同源。零码仍正常；合法退出259按非零失败，不能误当仍在运行；无退出证据用 `controlled_script_exit_unavailable` 拒绝。后代延迟输出五秒，直接父exit9即时拒绝，后代仍同出生身份并自然结束。Stop操作异常后另一进程能获取随机system mutex。

原始对照：[PS5修前](evidence-wp5/before-ps5.json)、[PS5修后](evidence-wp5/after-ps5.json)、[PS7修前](evidence-wp5/before-ps7.json)、[PS7修后](evidence-wp5/after-ps7.json)。其中productionTouched=false仅描述该隔离对照，不代替首轮旧watchdog夹具的网络隔离说明。

新增夹具 `tests/operations-system-service-exit.test.ps1` 在OS临时目录运行，并由既有TS入口分别用PS5/PS7执行。仅对受控子脚本、合成Process缺码与测试锁注入；未测试正式pg_ctl/服务根因。不清锁、不终止生产或未知生命周期子树。

## 本轮验证记录

原始日志存 [evidence-wp5](evidence-wp5/affected-regression.log)。固定base源码只解包tools与本测试/夹具至任务tmp，未创建生产runtime或安装凭据；安全deadline选名子集没有执行旧watchdog HTTP case。

原日志自带空白诊断行及CRLF。首次文档暂存的diff检查曾报告这些空白，不能把那次检查写成通过；随后以本任务目录局部 `.gitattributes` 对raw log禁文本规范化/差异检查，JSON禁行尾规范化，重新保全原字节。源码、测试和报告仍执行正常diff检查，不改写原失败日志求绿；此规则只作用于本任务证据目录。

| 命令/范围 | 结果 |
| --- | --- |
| 首轮Node：operations-system-service、system-lifecycle-race、startup-release-optimization、release-process-deadline | 44项，30通过/14失败；[原日志](evidence-wp5/first-regression.log)，不得改称全绿 |
| 固定base解包，仅 `approved runner\|original nested` 选名 | 原13项全部失败；[基线日志](evidence-wp5/baseline-failures.log)，缺新batch.recovery形状，执行前TypeError/旧错误断言，不是本次源码引入 |
| `node --import tsx --test --test-concurrency=1 tests/operations-system-service.test.ts tests/system-lifecycle-race.test.ts tests/startup-release-optimization.test.ts` | 17/17通过，32.632秒，包括新增两shell负例；[日志](evidence-wp5/affected-regression.log) |
| `node --test --test-name-pattern='transport deadline\|Node direct\|EOF transport\|probe direct\|exhausted inherited\|ordinary isolated tree\|shared transport\|concurrent lifecycle' tests/release-process-deadline.test.mjs` | 13/13通过，10.747秒；[日志](evidence-wp5/deadline-safe.log)。包括真实非零、直接退出与EOF分离、共同期限、原直接进程清理/后代保留、隔离争用锁 |
| PS5及PS7分别 `-File tests/django-local-service-native-ps5.test.ps1` | 两次通过；真实0/19/null→-1、唯一JSON/偏好恢复/诊断脱敏；[PS5](evidence-wp5/django-ps5.log)、[PS7](evidence-wp5/django-ps7.log) |
| `npm run lint` | exit1，63错误/112警告；[完整原输出](evidence-wp5/lint.log)。所有错误在未修改的release-integration-review历史CJS夹具及startup-recovery历史diagnose-exact-display脚本；本次不扩展修复 |
| `npx eslint tests/operations-system-service.test.ts` | exit0，0错误/0警告；[输出](evidence-wp5/changed-lint.log) |
| PowerShell解析、产品脚本UTF-8 BOM、`git diff --check`、最终差异人工复核 | 通过；最终产品脚本SHA-256 `38b1e5b2de4e20c6a0e75a8a8ab400c738a7fb0bdfae64803cfe14d97d48e97d` |

新增PowerShell用例的前后对照与测试命令重复执行不相加为独立覆盖数量。上述秒数是测试墙钟，不是启动、发布或生产净收益。源码不影响前端构建图，未运行生产构建/全量测试，也未为验证动正式服务。

首轮watchdog负例的隔离问题、待核查调用方和采用状态见 [调查报告](WP5-RELIABILITY-GAPS.md)。本轮没有修复或放行其证据合同，不将其失败解释为生产仍故障。

## 集成接口及采用

- CLI与成功返回结构保持；失败消息新增 `退出码 N`，缺码标识 `controlled_script_exit_unavailable`。没有增加自动重试、杀后代或持久状态字段。
- 本次为候选修复，未合并main或生产采用；现有永久Status/Stop选路修复也不能由此追认已采用。
- 任务5应检查文本诊断消费者及旧夹具的当前合同；任务6以本分支完整提交和最终字节统一集成，保留首失败，不用定向通过覆盖全套失败。
