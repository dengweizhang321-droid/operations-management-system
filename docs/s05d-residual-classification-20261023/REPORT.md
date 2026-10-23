# S05d 旧残留有限分类与 S05b 准入

2026-10-23，**有限分类、最小检查、独审与真实只读通过；进入 S05b 控制采用准备，来源移动准入尚未完成。** 此处不把代码通过写成已经退休或封存。

## 已完成与当前止点

- 只修改 history/collector 两个既有生产模块；没有新增控制包成员、相对导入边或 CLI 参数。旧 consumed-history 链条件及原两个 decision 不放宽。
- 最小 4 项检查通过；独审发现的解码来源地址/外部根义务漏项已补，追加的单项复核通过，其余结果复用。既有 32 成员包结构检查直接复用。见 [IMPLEMENTATION.md](IMPLEMENTATION.md)、[pins.json](pins.json) 和 [REVIEW.md](REVIEW.md)。
- 最终固定副本的真实只读 **99.228 秒完成**，collector 83.734 秒、closure CAS 12.937 秒，SHA 前后不变。11 项旧残留原位保留，8 份旧计划及 sidecar 未被列入移动；保留原 221 项 consumed history。实际仅剩 4 个 source action：原 packet/source、普通 merge 来源、原相关 staging、原 source-tuple 候选 f5；artifact action 为 0。见 [原始结果](readonly-result.json) 与 [清单投影](readonly-scope.json)。
- 新鲜对象快照兼容性诊断在 **300.043 秒**自设预算结束。两个 Git 来源各 9,654 叶、约 159 MB 的完整前像已读；staging 在 49.337 秒开始后尚未返回，第四个候选和全对象统一 CAS 未完成。这个预算结束不是生产 40 秒/60 秒门禁失败，更不是已通过。见 [原始结果](snapshot-preflight-result.json) 和 [私有原件索引](diagnostic-evidence.json)。
- 因此 S05d 的代码/方案部分通过；S05b 可按既定顺序先采用新 reader，但目前不能开始移动来源或封存。独审确认没有已知新增控制 prepare/adopt 代码阻断，安装 reader 不以完整档案前像或已退休为前置。实际采用回执将另行记录，尚无回执的步骤不预填成功。

## 本轮授权与范围

用户明确要求：“下一步应先做这个小范围修正，复用已有证据完成最小核验和独审。通过后，再进入 S05b 的控制采用与现场准入检查。”本轮据此实施有限分类，满足前置后由主负责人串行执行受控采用和现场准入；不重复索取已经给出的该项授权。子代理只负责方案、隔离实施和独审，不操作现场。

实际目录、8 份旧计划与 sidecar 原位保留；不手工删除清单行，不按 11 个 release ID、日期或 dispatch 白名单放行。保留原 unknown、旧两个 decision 与原有控制/身份/退休门禁，不启动新生产 dispatch、制品准备、数据库写入或应用发布。

从已核最新 main `36668589cab03d5d2d9d98383fb58eeb19c391ee` 创建 `codex/s05d-residual-classification-20261023` 独立分支/worktree，再 fast-forward 复用已推 `c7f94a7929673c27871511ad799c3e137002e31e`。现有 hook 保持启用；使用现有引用与 ls-remote，没有 fetch/推进 origin/main。旧树及用户主检出改动保留。

## 方案与实施

独立方案为 [PLAN-ADDENDUM.md](PLAN-ADDENDUM.md)：新增独立 `retained-unconsumed-residual` 角色，既有 consumed-history 的消费链锚条件不变；按实际有限形状、完整保留字节、已审工具家族、固定引用关系与共享外部来源义务资格化，全部动态复验成立才原位排除。缺文件、tuple 不同、单次未命中引用均不独立构成资格。

复用已经通过的 guard/CAS 修复与 94.585 秒完整只读结果，只补直接相关的必要反例。分类通过后，再从冻结代码进行必要的现场只读兼容和待移动对象准入核验；不能将单独 closure CAS 的 12.751 秒冒充完整 archive/CAS、普通写者或退休门禁通过。

模型分工沿用 v3：独立规划请求 Astra High，实施/原独审上下文沿用 Sol XHigh；实际底层型号未由工具独立确认。只作增量，不重新审查所有旧任务。

两个未运行的中间只读副本保留不用；实际成功运行的是 `inspect-code-d1468c7b-6ba6-4565-a5d3-9b6dd41369aa`，history 为最终 `3ebf251a…c9e9f`，collector 为 `4fc3afbb…cea2a9`。诊断不接受外部 proof，不产生 intent、移动、删除或恢复回执。

## 现场止点

控制采用必须使用固定普通权限 handoff 和原 installer，绑定最终干净代码、材料 SHA、原/新代际及原生 direct-exit 回执。当前还没有生成或执行本轮材料，未注册现场任务、关闭来源或重启。

现场新缺口须用具体证据说明，不能绕过门禁或临时扩大范围。来源关闭、完整 boot、双轮观察/ACK、最终封存及 S05b 完成分别以实际原生回执记录；代码通过和只读检查不代替它们。
