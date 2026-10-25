# S05d 独立关键规则与代码审查

审查日期：2026-10-23（上海时间）。按当前模型映射请求 `deep-review / gpt-6.1-sol / xhigh`，仅对缺回执、部分完成和迟到作用边界局部升级；工具未提供可独立确认的实际底层型号。审查者未参与规划或实现，没有修改被审源码、转派或执行生产动作。

## 结论

**只读诊断实现与本次阻塞交付可接受；S05d 的原有限恢复目标仍未完成，S05b 继续阻塞。** 没有可写第三 decision、可供采用的恢复控制包或允许对 a3 创建 resolution 的新资格。不能把本审查结论写为恢复就绪、S05d 通过或已恢复。

现有证据只支持保留 unknown。缺 FAILED/PREPARED/worker-plan、当前没有匹配进程、退出错误字符串或同 boot 内的诊断日志，都不能证明原 actor/后裔已可信退休或不存在迟到作用。PLAN 对持柄树闭合及完整 boot provider 的描述属于尚未实现、未资格化的未来方案；本轮没有验证或授予其生产使用资格。

## 独立核对范围

- 完整读取新增 `preparation-missing-failure-audit.mjs`、其定向检查及本次 PLAN/REPORT、施工单和导航差异；仅沿直接依赖核对 queue canonical 读取、稳定文件读取及原两个 decision 的准入边界。
- CLI 只接收 `--config`、`--dispatch` 和帮助参数；运行路径没有文件写入、队列初始化/持锁、进程启动/终止、Git、任务唤醒、observer 或生命周期调用。导入的既有模块没有在导入时执行其写入入口。
- 原 winning ticket、dispatch、terminal 的请求、目标、config/bundle 和原件摘要相互关联；可读 request/PREPARING/source-binding 复核相应前驱和源码 commit 字段。PREPARING 的 Git tree 仅核 40 位格式；request 原本包含可选 sourceTree 时才严格交叉比较，缺该字段时输出明确只观测到原件值、未交叉核对或检查源码内容。source-binding 的内容树 SHA-256 不作为 Git tree 的替代。两次有界 packet 快照及末次原件重读只检查诊断一致性，不是最终动态恢复准入。共享 runtime、消费记录、进程/锁、task/boot 没有被冒称已完整检查。
- 输出始终 `recoveryEligible=false`、`resolutionWritten=false`、`retryOriginal=false`；产物不存在、原树退休和迟到效果围栏保留 `null`。自填 claims、文件存在或 marker 不会变成恢复证明。旧 decision 的证据提示明确 `validatorExecuted=false`。
- 原 `preparation-resolution.mjs`、writer/observer、queue、history、producer qualification 及控制包成员清单均无本次源码修改；未注册新 decision，也未接入固定生产控制入口。
- PLAN、REPORT、BOARD、S05b/S05d 和导航均明确诊断交付与恢复能力的区别，保留 S05d/S05b 阻塞，不承诺安装诊断即可解阻。

## 发现与增量修正

首读发现目录遍历仅限制单目录项数、文件总数及深度，缺全局目录数上限；大量空目录仍可能扩大诊断工作量。实施者已补全局最多 256 个目录的拒绝条件，并加入多组空目录反例。增量核对该上限在进入目录前生效。

另建议稳定读取后再次核对每文件 2 MiB 上限，避免前置 lstat 与真正读取之间增长突破对外声明；实施者已补。原两支拒绝边界输出也已补充，明确这里只报告观察到的 FAILED/PREPARED 与未检查的消费链，不冒称执行了旧 validator。以上修正没有引入写入或恢复能力；当前没有遗留诊断实现阻断。

主负责人首次用真实 a3 参数只读调用时发现新的诊断兼容缺陷：实现和原合成 fixture 都错误假定 request 必含 sourceTree，真实 PREPARING 的 Git tree 因与 undefined 比较而被拒绝。首轮独审未核到真实 request 构造的可选字段语义，遗漏此问题；原拒绝记录保留在 [a3-readonly-audit-first-rejection.json](a3-readonly-audit-first-rejection.json)。

增量直接核对 `publish-latest-main.mjs:100` 的实际 request 构造、`publish-main.mjs:39` 的传参及 `assertFrozenSource` 对可选字段的原严格检查，确认 request 不要求该字段。实施者已按真实结构修正 fixture 与诊断：保 PREPARING commit/target 和 tree 格式，可选 request tree 存在时继续严格相等，新增 `sourceIdentityEvidence` 说明值的来源及未核范围。独立增量运行真实 shape、可选 tree 匹配/漂移与格式/commit 反例、CLI 只读等 3 项关联检查，全部通过；没有重跑旧两 decision 的完整用例。该修正未改变恢复资格，S05d/S05b 仍阻塞。

随后增加的 source-binding 可选 identity.commit/target 比对，以及 `preparingGitTreeIndependentlyVerified=false` 已增量核对；仅独立重跑其直接关联的 Git tree 用例，通过。最终源码 SHA-256 为 `749be4a4a33b96fbb5d6efb23b206a4d13959727b6d83f22f19c5b52e23a12d6`，最终测试文件为 `9455ffcf6509ca546491b357cf8b959eb831b6348678739be1381e057108ad04`；对应实施者增量检查见 [schema-fix-checks.json](schema-fix-checks.json)。

主负责人第二次精确 a3 只读 CLI 返回 exit 0；独立读取 [a3-readonly-audit.json](a3-readonly-audit.json)，确认原 dispatch/request/target、6 件非 source packet 文件、`status=blocked`、`code=MISSING_FAILURE_BLOCKED`、`recoveryEligible=false`、`resolutionWritten=false`。实际参数兼容已确认，树值仍明确未独立验证，request 中未提供 tree 的交叉核对为 null。该诊断没有证明原 actor 退休、零效果或恢复资格；原件和队列末次保全比对由主负责人完成。

## 必要检查与证据

- 独立按大小与 SHA-256 复核 [evidence.json](evidence.json) 中 12 件直接复用的 S05c 原件，全部一致。没有重新认证全部历史 resolution，也没有把队列快照当现场准入。
- 独立在私有临时目录运行本次 9 项定向检查，全部通过，覆盖原件未写、绑定漂移、额外 marker/claims、硬链接/超限、目录总上限、未知 decision 拒绝、原 unknown 持续阻塞后票及 CLI 不接收 proof/out/resolve。
- 实施者检查记录见 [checks.json](checks.json)：上述 9 项、原两 decision 的 2 个既有正向兼容用例和两个新增文件的语法检查。旧源码没有变化，兼容结果可复用，不开展全仓测试或完整构建。
- 本次文档和源码差异检查未见放宽 unknown、历史读取或原目标禁止重放规则；最终提交、远端与文档链接由主负责人收尾核验。

本审查不包含采用、现场协调、准备、服务/计划任务/数据库操作、应用发布或业务功能验收。原恢复目标的剩余阻断是缺可信原执行身份/退休屏障、完整 producer/作用/消费闭包及对应新鲜同锁动态准入；这些缺口不会因诊断检查通过而消失。
