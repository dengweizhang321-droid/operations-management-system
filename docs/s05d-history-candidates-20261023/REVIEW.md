# 11 个历史候选只读归属核对独审

2026-10-23。复用既有独审上下文，范围仅为成功 observation 中 11 个 `conservative-no-positive-difference` 历史 release 的归属、引用及能否从 a3 范围排除。新文档树基线为 `244cfa91`，已读共享记忆入口、本树 AGENTS/README 与文档规范；沿用本上下文同版本模型分工 v3 和已读相关专题。无源码、规则、生产状态、任务或服务修改，不子派工、不新增测试或全量扫描。

缺 snapshot、未在有效消费链中、目录较旧或 manifest source tuple 不同，都不单独证明实际完整源码差异、零作用或可删除。产物归属、受支持消费路径和清理授权分别判断；即便能排除 a3 归属，也不推导移动、删除或恢复许可。

## 原件与引用核对

已核 [ownership-evidence.json](ownership-evidence.json)，SHA `8fa856543b3a40d17839ced81f59275cc99879f116f703323bccce456323f3b8`。原 observation SHA 独立核同 `0f92c078…40ae`；11 行的 path、manifest SHA 与 source 对象逐项等于该原 observation 的保守候选集合，无新增或遗漏。取证脚本一次完成 7.738 秒，计数的原生 metadata/固定叶读取为 12,753,741 字节、2076 次；未调用旧 CLI、重跑全 collector 或扫描应用 payload。

11 项 manifest 声明的 source tree/root-path SHA 均与 a3 不同，当前均缺 `source-snapshot/dist/helper/node_modules`。各根只保留 16 或 19 个已盘点文件，工具共有 **83 份**（77 份常规工具及 6 份 D1 工具），全文 SHA 全命中前轮已审字节；三种 BAT 的 SHA 也等于前轮已审 launcher。这里复用既有 native 入口语义，不新增资格。`.dev.vars` 只记类型和大小，未读内容。旧 helper 仍是可执行工具，不能把这些目录称为完全无能力的空目录。

经已固定 native 代码解析的新鲜 effective chain，head/chain SHA 与成功 observation 相同，11 项均不是该链 262 个成员之一。这只证明当前链归属，不证明没有任何历史作用或未知尝试。

引用核对限定于 5 个既有原生状态域，1874 个记录叶（937 个 JSON）的字节与成功 observation 相同。按 11 个 release ID / manifest SHA / 路径匹配，命中 8 份 rotation plan：命中字段均为 `candidate.releaseId` 与 `candidate.manifestSha256`，sidecar 均存在并核同；每份对应一个历史候选。以下三项只是在这些域和匹配标识内未命中，不写成全机无引用：

- `20260903T042106Z-dbc7eaae4c8d7a3d`
- `20260903T140732Z-627476acd7561b9e`
- `20260910T160720Z-21fced515f9eb124`

## 独审结论

**上述有限归属与引用事实核对通过；不能据此直接排除整个 a3 可执行来源闭包，更不能删除或移动。** 本轮证明的是不同的记录身份、当前非 effective-chain 成员及已知工具残留；没有把 manifest tuple 当作缺失源码的完整实际字节证明。8 个历史 plan 的存在也不是消费成功或 a3 专属关系证明。

现有 collector 的 `conservative-no-positive-difference` 原因仍成立：缺实际差异见证时保守纳入。本轮没有修改该规则或生成新的排除资格，不能把报告当作代码已排除或恢复就绪。保留这 11 项及其计划/sidecar，原 a3 unknown 与生产状态保持。后续如要改变排除规则或处理目录，由主负责人先取得相应决定；本轮不新增设计、扫描、测试或生产动作。

已读 [OWNERSHIP.md](OWNERSHIP.md) 最终措辞，与上述原件及边界一致：185 个枚举文件的 9,054,803 字节仅为逻辑大小，不当作可释放空间；保留 helper 能力、域内未命中、历史作用未知和现规则未排除均明确区分。该份只读归属报告可交付，无新增阻断；本轮没有授予删移、规则修改或恢复许可。
