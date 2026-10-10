# 未就绪失败取证修补（源码交付，未生产采用）

442b实际原20通过，原21 STATUS_NOT_READY/不可重试后unknown。真实失败Status正文和进程证据没有保存，不能把后来的Ready或源码修补当作原21通过；应用仍5fa/f4e/237，实际97链和active保留。当前生产源码、冻结E候选和原历史都未修改。

原成功invoke后parse/完整就绪/附加断言抛错，没有携带成功读取的native process。`release-batch.mjs`和`release-batch-admission.mjs`现在在该窄catch中附实际process及限定状态证据；`release-readonly-retry.mjs`白名单保留state/backend/worker枚举、releaseMatchesExpected、12个bool/null组件、缺项/非法值与额外key计数。JSON错误保留原stdout字节SHA/process，不伪造解析状态。原完整就绪/身份/附加断言、命令/环境、共同期限及4种暂态重试规则不变，NotReady继续非重试。

非作者发现第一版Error携带raw status及二次过滤丢失snapshot/process两个缺口，已改为**源头只附限定snapshot**并严格幂等再过滤。导出异常、WAL和两次安全序列化均不泄漏任意reason、额外ID/字段名、客户数据、URL、argv或stdout正文。该修补只解决未来诊断证据缺口，不能识别或修复已经丢失的真实NotReady条件。

专用工作树复用原UI源路径，分支`codex/release-readiness-failure-evidence`从最新origin/main `a3d41827995647e7cd368edf0bf83f44658a4eff`开始，修改前干净；原三份source-witness producer和旧候选字节保持。只开发必要源码/隔离夹具，没有部署、服务启停、调度、业务写入或生产再试。

| 验证 | 真实结果 |
| --- | --- |
| 作者新capture验证 | 11/11；actual query函数文本及真实retry/parse/assert，native transport为合成替身，不生产执行 |
| 作者相关组合 | 17/17=上述11＋原6环境验证；5478.2183ms，RELATED_FINAL.log；包含独立tmp真实PS5/Unicode/直接异常退出，不碰正式服务 |
| 非作者独立 | 21/21，INDEPENDENT_REVIEW.json/md；逐12false、missing、raw异常隐私、幂等、JSON/附加断言、4次暂态/共同期限 |
| 开发辅助项 | INDEPENDENT_REVIEW_APPENDIX.json/md，只读审核loader与4个synthetic batch模式字段，未重跑native |
| lint/diff | 修改3源码/新test目标lint exit0，仅React检测环境提示；diff检查通过 |

首次作者夹具3/8失败因缺`batch.recovery.mode`，已补正确full模型；原输出由授权read_thread原command item `exec-46f2026e-c08c-4ec0-9580-11c1542708f2`完整保存在FIRST_FIXTURE_FAILURE.log（工具输出对象，不冒充原native字节日志）。相关suite先缺当前工作树typescript，再在已有v3源码暴露旧fixture缺mode（15/17）；origin/main相同分支已有该前置schema读取。只补四synthetic batch full模式，原断言和所有生产代码不因此改变，失败日志保留。test-only loader仅从现存D工作树解析开发依赖，未安装、移动或link依赖；experimental-loader环境提示如实保留。

原生产unknown21、19 strictfalse、旧pre备份轮转缺失、清理blocked及观测缺口保持。源码提交/合并/推送不等于采用；下一次实际原安装B仍没有此取证，不能声称未来旧scope运行会自动获得这些新字段。需要受审的精确补充验证/采集方式才可实际使用，不能裸重复原21或自动协调unknown。
