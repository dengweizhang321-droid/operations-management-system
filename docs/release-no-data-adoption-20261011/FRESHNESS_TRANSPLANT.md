# C collector 新鲜度补丁的受限移植

本轮基于 C 真实交接及独立候选审查修补，不修改旧 f308/20855 候选。运行时只改原十文件范围内的 release-batch-admission.mjs；先前源码绑定、迁移闭包与观察 WAL 修补保留。旧 217659 补丁和交接不覆盖。

## 与 C 的符合点

- 慢制品、恢复资格、完整 source/toolchain 重读先完成，再以原完整解析核 effective chain 的 chainStateSha256/head binding/manifestPath、phase 对应 Django 清单原字节摘要、WAL previous 与事件数量。
- 然后核 Worker/helper 精确进程，再对 acceptance/closeout 运行原完整 Status。observedAtMs 取进程身份完成或 native Status 返回时刻，不以解析／写入 attempt 结束时续期。
- 观察年龄必须有限、非负且不超过 5000ms；5001、倒退和无效时钟失败，保留 attempts、statusObservation 与 admissionStages。既有不可重试 NotReady 不转成成功。
- 初始和最终 source sampler 保持本任务完整 sourceBinding 验证；未退回固定 sourceRoot。迁移闭包完整包复验仍位于动态采样之前。原 session recheck 保留。

C 原补丁 SHA-256：`07a08b509170eeba00d2104de9d359c4e28f081c16181cceab03c4c85f028527`。

## 必要兼容差异

C 基于最新 main 的 safeReadinessFailure 导出及新 retry serializer，而受限原九文件源码中的 release-readonly-retry 没有这两个能力。直接复制 import 会导致模块加载失败；只附 error.readinessEvidence 又会在旧 attempt 序列化时丢失。

本次 collector 内复用 C 已审状态／组件白名单投影，名称为 safeAdmissionReadinessFailure；明确不带无关 health probe 投影。query 失败附原 native processEvidence 和受限 readiness；本轮 onAttempt 在原 retry 已决定失败／retryability 后，将该白名单 DTO 附入原错误记录再执行已有持久化回调。没有改变重试分类、次数或截止时间，也不保存正文、reason、URL 或未知组件名。

唯一导入差异是从 main 原行中删除 `, safeReadinessFailure`。旧受限源码原本就没有该 named import，所以 main 补丁不能直接在旧源上按删除行应用。交接提供独立 limited 补丁，最终 collector 以外的前后内容与先前受限文件逐行相同；其他五文件与先前冻结字节相同。既有 batch 的非本任务健康诊断差异仍不进入候选。

## 真实执行与边界

- 移植 C 原 11 项，并加旧 serializer 持久化、完整迁移闭包顺序／拒绝、bound source 双重采样／漂移，共 14/14。
- 最终九文件串行 187/187，43.017 秒；lint、diff 检查通过。候选代码可绑定 166 项，另 21 项是未进入受限制品的离线 composition 工具测试。
- 使用真实独立 C VM 种子与外部状态变化注入，分别执行保留旧函数和最终实际函数。旧函数仍复现 302000ms、full 零恢复耗时下 182000ms 的旧 Status 被标为年龄 0，以及三个末核漂移被接受、native 诊断丢失。最终函数保留实际 2000ms 年龄，三种漂移拒绝、失败证据附回。数字为虚拟时钟负例，不是生产耗时。
- 同一 14 项及 VM 又绑定到机械补丁实际输出 collector `10a783535add546ed8f3e28930bad416d8d9d27f7acbe126d48f393a47db7415` 通过。运行由本实现者执行，测试设计来自实际独立审查；不冒称产生新的非作者审查签名。
- 首次组包 raw 对比失败：开发 collector 为 CRLF294 行，Git 补丁输出为 LF294 行；保留 ASTRA_FRESHNESS_PATCH_RAW_MISMATCH.json。交接单独记录两个原始 SHA，最终候选必须等于实际应用输出；不以归一化 hash 放行。

## 冻结交接

`ASTRA_VALIDATION_HANDOFF_V2.json`：`7fe574b52a9547a0725ce206535becda960657fce21c30b07fc37e11c5203a33`。

- main 增量：`21ac4136e30dda7bf1d9baed6f4ab64ddc5c0f29993e80b9e532bfd2e833234a`。
- 原九文件受限源专用增量：`46f23096ea436a75d87cdf85faaef9760090880b4e9544cde4ee147708de5a9c`。

证据根 `E:/codex-artifacts/release-no-data-adoption-20261011`；保留原 C 独立报告、旧缺口复现、所有首轮结果和新 VM。运行时代码已冻结。未构建、未改候选或保护目录、未发生产请求、未部署、未提交 Git。新候选重准备和实际独立终审由主任务继续，旧批准不用于新对象。
