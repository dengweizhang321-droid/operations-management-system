# 就绪失败诊断证据：非作者独立复审

**开发候选通过，阻断项为空；productionExecutionApproved=false。** 本次只审三个源码和作者测试，基线origin/main a3d418。没有部署、生产请求或新的续接scope。

| 文件 | SHA-256 |
| --- | --- |
| tools/release-batch.mjs | 077404b8174a2334bc9726fe0bee070f4b4f6f44888d4f1d7cfa42cafeb42e95 |
| tools/release-batch-admission.mjs | cf0922b3bafd0a909e21c8b3c1cddebeb0102d8cf9c433e8842a944260e3dfa6 |
| tools/release-readonly-retry.mjs | 648d5107fce2839b5a9b7ca09298de56edd7a4b188f6ac30bcf241cdc9c9f834 |
| tests/readiness-failure-evidence.test.mjs | 4fb508ee0f3e6d6e3cab0f839a171a6f95bc3e0125ed79bc604303bf861a1ac1 |

独立合成 **21/21**，116.7489ms：逐12组件false、core/ai缺失、wrong release、batch/admission异常隐私、两次序列化、非法JSON、额外原断言、四暂态的四次上限和同一期限。仅最低transport seam返回合成值；没有子进程或Status/HTTP/SQL调用。作者结果不合并为独立计数。

初版两个缺口已在最终源码闭合：raw Status曾直接附公开Error，现batch与admission在源头只附bounded readinessEvidence，异常JSON不带private reason/额外ID/字段名；已过滤process/readiness再进入safeObservationError时，snapshot的releaseMatch/缺项/count和内层进程保持，不重新从已去除的releaseId推导成false。限定字段重新过白名单。

精确diff仅补失败证据：真实invoke/result的processEvidence及字节SHA保留，语义NotReady仍失败；原完整断言、精确身份、12项true/无额外项、4种暂态和4次上限、2000ms等待、总期限、原command/closure均不改。非法JSON只保留真实process/输出SHA，不虚构解析结果；诊断摘要不能产生passed或成功receipt。

独立最初loader日志保留：夹具目录回退4层而应3层，未执行源码测试；路径修正后才执行上述21项。此不是作者源码缺陷，不把首loader失败重写成通过。

**未证明实际NotReady已修复。** 原不可变B、E295/E442及97链的原21 unknown没有改动，丢失的旧进程/Status不能事后补造。合main仅为开发交付；生产采用和任何再试仍须另有精确审查与授权。机器记录见 [INDEPENDENT_REVIEW.json](INDEPENDENT_REVIEW.json)。
