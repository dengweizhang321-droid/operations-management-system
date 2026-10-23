# 十一个历史候选：身份、引用与处置边界

## 结论

这 11 项可识别为**登记在 9 月 1—10 日的旧候选残留形态**，均不在当前原生有效发布链中；它们的 manifest 来源树与来源路径摘要都不同于原 a3。不能把这些记录身份差异扩大为“已经证明从未受 a3 迟到作用影响”或“可以删除”。

它们没有 `source-snapshot`、`dist`、`helper`、`node_modules`，留下工具、manifest、审计/激活记录、package 文件和 `.dev.vars` 链接等。没有查到谁、在何时移除了载荷，因此不声称已由某个原生清理任务成功清理。

**建议保留原位，不以删除解决 S05d。** 8 项仍有旧 rotation plan 的显式候选引用；其余 3 项只是在本次固定五域内未命中引用，不等于全机无引用。185 个枚举文件逻辑大小共 **9,054,803 字节（8.635 MiB）**，其中 11 个为多链接文件；该数字不是物理可释放空间。`.dev.vars` 仅取属性，未读取内容。

## 逐项结果

所有行均不属于当前有效链，四类载荷目录均缺失；8 个命中计划的 sidecar 摘要同时成立。完整路径、manifest/来源摘要、实际保留叶与引用字段见 [ownership-evidence.json](ownership-evidence.json)。

| releaseId | 枚举文件数 | 逻辑字节 | 本次五域引用 |
| --- | ---: | ---: | --- |
| `20260901T110013Z-97fd5e59dfbda47c` | 16 | 779246 | 1 份旧 rotation plan，candidate 身份 |
| `20260901T164914Z-d12b11511f5e621e` | 16 | 779246 | 1 份旧 rotation plan，candidate 身份 |
| `20260902T083840Z-4772d42b42ae2a81` | 16 | 797098 | 1 份旧 rotation plan，candidate 身份 |
| `20260903T042106Z-dbc7eaae4c8d7a3d` | 16 | 801191 | 固定五域内未命中 |
| `20260903T050156Z-e813392551d650bb` | 16 | 801956 | 1 份旧 rotation plan，candidate 身份 |
| `20260903T140732Z-627476acd7561b9e` | 16 | 811211 | 固定五域内未命中 |
| `20260904T171710Z-1bd7be5db9ffede6` | 16 | 825408 | 1 份旧 rotation plan，candidate 身份 |
| `20260905T175520Z-9732204d73443f0e` | 16 | 829170 | 1 份旧 rotation plan，candidate 身份 |
| `20260909T080530Z-96bf0ec48b5423c2` | 19 | 857525 | 1 份旧 rotation plan，candidate 身份 |
| `20260909T081318Z-8ff55574021b20ff` | 19 | 857526 | 1 份旧 rotation plan，candidate 身份 |
| `20260910T160720Z-21fced515f9eb124` | 19 | 915226 | 固定五域内未命中 |

## 证据与搜索边界

先完成三个目录的小范围形状/大小预算，再执行一次固定脚本 [inspect-ownership.mjs](inspect-ownership.mjs)，**7.738 秒完成**。脚本显式叶读取 12,753,741 字节、2076 次；这个计数不含本地既有大 observation/策略文件，也不代表原生 chain helper 内部读取总量。没有运行旧 CLI、写原生记录、全量 collector、payload 构建或业务接口。

- 原完整 observation 的长度与 SHA 先核同；11 个当前 manifest 原字节 SHA 与 observation 一致，manifest 自身 payload 摘要成立。11 项登记 source tree 与 root path SHA 均不同于 a3。
- 固定 3 件原生工具 SHA 读取前后核同，只调用已审的 `resolveEffectiveReleaseChain({verifyInstalledHead:false})`。当前 head 和 chainStateSha256 与成功 observation 相同，有效链保护 262 个 release、261 条 successor，11 项均不在其中。此结论不是全机进程普查，也不证明它们历史上从未产生过作用。
- 仅枚举每根顶层及 `tools`、`audit`、`.runtime` 一层。没有未进入的剩余子目录，185 个文件属性已记录；除 `.dev.vars` 外读取并摘要必要保留叶。83 个实际工具叶均与 manifest keyFiles 及此前独审的全文 SHA 家族相符，不把未知代码继承为已审代码。
- 引用搜索限定原生 state 下 `worker-prepared-builds`、`worker-release-publication-staging`、`worker-release-rotation-plans`、`worker-release-rotation-consumptions`、`worker-release-successors` 五域。目录成员与成功 observation 核同，1874 叶/937 JSON 的实际 SHA 核同，再按这 11 项的精确 releaseId、manifest SHA、规范路径匹配引用字段；8 个命中均是 plan 的 `.candidate.releaseId` / `.candidate.manifestSha256`。不将 plan 的存在写成已消费，不将域内未命中写成全机无引用。

统一证据 SHA 为 `8fa856543b3a40d17839ced81f59275cc99879f116f703323bccce456323f3b8`。独审直接核原件及逐项绑定，结果见 [REVIEW.md](REVIEW.md)。

## 为什么仍不能直接排除或删除

当前 collector 从 `source-snapshot` 中寻找实际源码区别见证；这 11 项没有该副本，所以走 `conservative-no-positive-difference`。既有历史保留工具资格另要求已消费链锚定，而它们不在该链中；没有直接套用该资格或修改规则。

本轮确认了旧登记身份、残留形态、实际工具版本和引用，不提供完整源码字节证明、所有旧入口首效前拒绝证明或删除许可。载荷缺失意味着它们不是完整可用制品，但不据此声称所有历史入口都无副作用。8 份旧计划与 sidecar 也不能作为“无用文件”顺带删除。

如果继续 S05d，下一步应限定在这种旧候选残留的分类/排除规则，复用本轮证据，保留现有原件；不是把这 11 项全部当 a3 产物搬走，更不是直接删除。该实现不在本轮只读核对范围内，尚未执行。原 unknown、原两个 decision 和现场状态保持。
