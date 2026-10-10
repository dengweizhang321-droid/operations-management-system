# GPT-6 Astra 对 AGY 实际 Diff 复审的逐项裁决

2026-10-10。原始意见为 `E:/codex-artifacts/release-no-data-policy-20261010/AGY_ROUND3.md`；AGY 基于所提供的 Git diff，不曾执行该分支代码。保留原文，不把“形式推演”记为可执行复现。

| AGY 主张 | 代码事实与处理 |
| --- | --- |
| 所有 v3 封存必崩，因为 makeImpactProof 没有 before/after | **不成立**。未变函数一直存完整 inventories 和所有 changed paths 的 before/after 原字节，verifyImpactProof 先逐字节对照库存再重跑分类。新增测试直接 JSON roundtrip 检查 CSS 原字节存在，真实 makeBatch→verifyBatch 往返为 not-required。此前 105 项通过亦含实际封存，不是只测分类标签。 |
| 应只保存 skeleton SHA/签名，不再解析原文本 | **不采纳**。这会移除原字节重算保护；没有实际签名协议，不制造“合法已签名 witness”的假设。保留 TypeScript AST 与原 bytes。 |
| djangoCandidateSha256 未检查，可传空值绕过 Start | **不成立**。每个操作校验调用既有 assertStartBinding，它明确 requireHash Django candidate 并比对参数；display 还要求 Django candidate/predecessor 相同。新负例将 binding 和对应 argv 同时改为 undefined/非法文本、重算 digest 仍拒绝。 |
| 观察可以浮到 prepare/drain，验证旧页面 | **不成立**。导入模块 validateNoDataObservation 已限制 acceptance/closeout；全批顺序校验且 EndDrain 必须在 switch。新增负例将观察真正移到 prepare/drain 数组位置并重算 digest，仍拒绝。自然 watchdog 在 closeout 有意允许，没必要强改到 acceptance。 |
| collector.files 额外文件会被执行 | **不成立**。files 是逐字节读取清单，不是可执行脚本列表，标准 collector 固定原 in-process 入口。进一步收紧为无重复的完整已知直接闭包（允许精确 tests JSON），防止清单歧义，不能把这个防御加强当作已证实 RCE。 |
| args[2]/[3] 能注入 CLI flags | **不成立**。标准 in-process 分支将 args[2] 与当前 specPath 比对，args[3] 只经 safeRead/JSON.parse/hash 读取测试证据，不进行 CLI 拼接。本轮再要求两个都是绝对 .json 路径。 |
| Windows 大小写严格匹配是穿透 | **不成立**。别名差异是保守拒绝，固定规范路径用于审批可重复性；没有需求支持任意别名。不会为了“兼容”接受身份不明路径。 |
| 应解除固定 Windows PowerShell 5.1 路径 | **不采纳**。这是既有已验证原 operator 的平台契约，父 shell 是 pwsh 不代表原 operator 应改宿主。换宿主是新的兼容性改动/验证范围，当前任务继续 pin 精确系统 PS5 字节。 |
| JSX 换行/Fragment 未覆盖 | **支持范围限制属实**。无法被受限规则证明的格式/Fragment 返回 full，不是安全穿透；首版不为覆盖率扩大语法。 |
| 普通 class 可换 hidden/pointer-events-none | **早期范围过宽，已收紧**。当前只接受有限间距/字号/字重/圆角字面类。更进一步，完整文件必须是零参数、无导入/事件/表达式/自定义祖先的被动静态组件。已有 textContent writer 反例测试拒绝。 |
| 没有提供 observer/CSS 完整上下文 | **审查输入缺口属实**。下一轮提供完整函数/文件，不从截断 diff 推断未见代码不存在。新增真实浏览器测试覆盖写 GET 阻断、POST 失败、资源 SHA、样式、重定向、未知回调/属性/路径；运行原浏览器并实际统计服务端零被阻断入口调用。 |

另由主代理/Astra 实际审查新增两项必要保护：前驱与候选原 preparation receipts 比较全部非源码部署输入，现场再从有效谱系和固定 protected receipt 根验证原字节；实际独立 effect-review 报告绑定源码/制品/plan/closure 与五类观察/写入/钩子发现。CSS 语法等价不是全应用观察器无副作用的形式化定理，审查真实性继续属于既有可信审批边界，不能以报告自述伪装密码学证明。

复现原始失败也保留：新增“缺失 Django hash”负例首次期待错误含 Django；实际 undefined argv 更早被原参数 `.toLowerCase()` 拒绝为 TypeError，因此测试 32/33，防护仍失败关闭。随后仅 v3 在批次头显式检查两项 Django hash，以确定性诊断先拒绝，旧 v2 不改；同组 33/33。原失败文件为 `astra-review-regression.log`，修正复验为 `astra-review-regression-corrected.log`，不是删掉负例或改称原测试通过。

首次采用和旧 AB 所有权边界没有争议：机制自身 strict/full；旧 active/unknown/WAL 不改。本文件没有批准生产动作，也没有声称真实生产净节省时间。
