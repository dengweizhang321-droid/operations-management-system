已在当前真实会话完成对 Astra 第一轮/第二轮答复、落实现状以及具体实现与测试的独立对抗交叉复审。详细技术审查报告已生成至规划文档 [`astra_cross_review_plan.md`](file:///C:/Users/86137/.gemini/antigravity-cli/brain/111272d0-f535-4130-847a-4e1dc8f487db/astra_cross_review_plan.md)。

---

### 一、 逐项回应 Astra 事实更正

| 审查项 | 上轮表述缺陷 | Astra 事实更正 | 本轮独立核验与纠正裁定 |
| --- | --- | --- | --- |
| **1. 待办任务范围** | 称“全待办只有 C” | AI workflows 仍有未提交改动，main 也有独立测试/文档追加；不可从“未就绪”推断“全系统不存在”。 | **采纳并纠正**。撤回“全系统永久只有 C”的断言。准确界定为：*在当前实际生产前驱下，暂未发现第二项已独立就绪、且可与 C 合批的待发布项*。AI workflows 处于旧基线未提交状态，未有当前前驱的最终候选，不具备合批前提，但这不代表系统无其他开发中工作。 |
| **2. 旧 D5 ABC 状态与 `verifyBatch`** | 称“旧 ABC 物理作废”，且认为 `verifyBatch` 会查现场拒绝 | 旧 ABC 源码与制品完整保留作比对参考，不可删除；静态 `verifyBatch` 仅查内部结构与哈希绑定，不查现场。 | **采纳并纠正**。撤回“物理作废”误称。旧 ABC 是因前驱迁移导致生产执行失效，但其 tree hash（`2a060401...`）与 44 个差异文件完整保存在制品库中。`verifyBatch` 为纯内存静态校验，现场漂移是由 `executeBatch` 运行时的 `collectCurrent` 与 `assertBindings` 拒绝。 |
| **3. 反例假设 vs 实测数据** | 将等齐 40 分钟、联验 50 分钟与“故障风险成倍扩大”混作事实 | 这些仅为情景反例假设，非本次已测样本；不可用修辞代替数据。 | **采纳并纠正**。严格区分“理论机制反例”与“实测数据”。等齐与故障连带阻断用于证伪“合批必省 50 分钟”的绝对化假设，非已测实绩，不再使用“成倍放大”等未定量表述。 |
| **4. UI 展示覆盖率边界** | 称“UI 有 fetch 所以 100% strict，展示覆盖率 0%” | 0% 是针对历史 3 个批次与当前 4 个 UI 文件的样本事实，不可无界外推全产品与未来。 | **采纳并纠正**。将 0% 明确收窄为“既往 3 批次与当前 4 UI 文件的实测统计”，非全系统未来永久定律。但对本批次而言，因涉及 `/api/sales/summary` 请求，保持 STRICT 毫无疑义。 |
| **5. 工具命名与定位** | 提议 `release-batch-composite.mjs` 并当作实现 | 该文件并不存在；实际落地的是离线检查器 `tools/release-composition-review.mjs`。 | **采纳并纠正**。撤回对不存在工具的引用，以当前实现的 [`tools/release-composition-review.mjs`](file:///D:/.codex/worktrees/release-high-impact-execution/运营管理系统/tools/release-composition-review.mjs) 为唯一法定评估对象。 |

---

### 二、 对具体实现与测试的独立对抗审查

经仔细查阅 [`tools/release-composition-review.mjs`](file:///D:/.codex/worktrees/release-high-impact-execution/运营管理系统/tools/release-composition-review.mjs) 及 [`tests/release-composition-review.test.mjs`](file:///D:/.codex/worktrees/release-high-impact-execution/运营管理系统/tests/release-composition-review.test.mjs)，给出如下独立审查与反例分析：

#### 1. 核心正确性机制核验（全部通过）
- **精确增删改并集（Lines 10-11, 64, 85-86）**：通过 `delta` 函数按排序文件名对比前驱与组合后库存，精准捕捉新增、修改与删除（`delete expected[name]`）；任何未批准变更或漏删均触发 `combined-source-not-exact-union`。
- **前驱一致性绑定（Lines 50-51）**：严格断言 `item.predecessor` 的 `sourceSha256` 与 `inventorySha256`，杜绝不同前驱的变更强行拼接。
- **双任务就绪门禁（Lines 52, 87）**：强制要求 `item.state === 'ready-unexecuted'`，且显式断言 `items.length >= 2`，单任务直接报告 `fewer-than-two-items-no-batching-opportunity`，杜绝伪合批。
- **同路径保守冲突（Lines 66-72）**：即使两任务修改同一文件产生完全相同的字节，`owners.has(key)` 依然保守记录 `overlapping-path` 阻断，拒绝隐含语义耦合。
- **四大证据链完整性（Lines 57-63）**：强制检查 `independent-tests`、`dependency-review`、`acceptance-plan`、`rollback-plan`，缺一不可。
- **文件系统防伪（Lines 107-117）**：`readSourceTree` 与 `safeRead` 杜绝重解析点（Junction/Symlink）与硬链接（`nlink !== 1n`）；证据文件哈希漂移直接抛错。
- **CLI 退出码标准（Lines 124-125）**：业务审查阻断优雅输出 Exit 2 并打印完整 JSON，格式或 I/O 损坏报 Exit 1，且输入文件完全只读。

#### 2. 代码行级缺陷与反例评估（均为 Non-blocking，无需返工）

* **[Non-blocking] 观察 1：循环依赖时 `preparationOrder` 产生残留污染**
  - **行号**：[`tools/release-composition-review.mjs` 第 75–83 行](file:///D:/.codex/worktrees/release-high-impact-execution/运营管理系统/tools/release-composition-review.mjs#L75-L83)
  - **反例机制**：在深度优先遍历检测循环时，Line 77 虽将 `dependency-cycle` 压入 `blockers` 并 `return`，但在递归调用栈展开过程中，Line 81 依然执行了 `visited.add(id); preparationOrder.push(id)`。导致报告在 `status === 'blocked'` 的同时，输出了一份包含循环任务的不完整 `preparationOrder`（如 `['b', 'a']`）。
  - **判定**：非阻塞（Non-blocking）。因为外部消费者依规只能在 `status === 'ready-for-combined-review'` 时向下流转，blocked 时该字段被丢弃。
* **[Non-blocking] 观察 2：路径重叠阻断时 `expected` 状态被后置覆盖**
  - **行号**：[`tools/release-composition-review.mjs` 第 66–72 行](file:///D:/.codex/worktrees/release-high-impact-execution/运营管理系统/tools/release-composition-review.mjs#L66-L72)
  - **反例机制**：当任务 A 与任务 B 发生路径冲突时，Line 68 记录了 blocker，但 Line 71 依然将 `expected[change.name]` 覆盖为任务 B 的内容。若 `combined` 代码恰好采纳了任务 B，Line 85 的并集校验不会再报 `combined-source-not-exact-union`。
  - **判定**：非阻塞（Non-blocking）。因为 `overlapping-path` 已经产生，整批已被不可逆地锁定为 `blocked`，保守阻断机制完全闭环。
* **[Non-blocking] 观察 3：证据篡改导致 Exit 1 而非 Exit 2**
  - **行号**：[`tools/release-composition-review.mjs` 第 112–114 行](file:///D:/.codex/worktrees/release-high-impact-execution/运营管理系统/tools/release-composition-review.mjs#L112-L114)
  - **反例机制**：证据项缺失时（Line 58）报告 blocker（Exit 2）；而证据文件在磁盘上哈希不匹配时（Line 113）直接抛错（Exit 1）。
  - **判定**：非阻塞（符合设计意图）。退出码 1 区分了“底层文件损坏/篡改异常”与“上层规约审查阻断”。

---

### 三、 测试日志证据核对（声明：未亲自运行测试，基于作者留存日志）

核对 `E:/codex-artifacts/release-high-impact-execution-20261010/` 留存日志：
1. `composition-tests-first.log`：新增的 15 项测试全部通过（15 passed）。
2. `related-release-tests.log`：既有发布关联测试 93 项初次运行 92 通过、1 失败（失败原因为既有 watcher 夹具并发干扰 `Inputs changed while evidence session was held`）。
3. `existing-watcher-isolated-recheck.log`：针对该 watcher 失败项单跑，1/1 passed。
4. `related-release-tests-serial.log`：关联发布测试串行重跑，93/93 全部通过，证明新工具未造成门禁回退。
5. `changed-lint-first.log`：exit 0，提示最小测试环境缺 React 检测环境，无实际代码 Lint 错误。

---

### 四、 真实前驱差异与耗时事实对齐

1. **真实代码树差异事实**：
   - Actual AB $\rightarrow$ Old ABC：5157 $\rightarrow$ 5196 文件，44 项差异（docs 36, tests 2, tools 6）；before hash `92c2656c...` 与现场 manifest 一致，old ABC tree 为 `2a060401...`。Old ABC 仍绑定 D5，仅作比较材料，**绝不可批准、不可执行、亦不可删除**。
   - Actual AB $\rightarrow$ Main (bc1d830b)：458 项差异（docs 433, tests 10, tools 15），app/backend/lib/worker 零差异；但因涉及 tools/tests protected 路径，**依法不能免除 STRICT**。
2. **生产 75 条事件耗时与准入核算界限**：
   - 现场 75 条日志实测：25 次准入累计耗时 **47.808 分钟**，其中包含 13 次嵌套 Status 查询累计耗时 **7.701 分钟**。
   - **红线界定**：Status 耗时内含于准入中，**绝对不可相加**！且准入包含 Python 7918 文件遍历、配置与大树哈希，其内部各子项开销依然未知。即使合批省掉一轮批次，剩下的批次仍需完整执行各步准入。**严禁断言“47.8 分钟全可节省”，更不可承诺中位净省 $\ge 30$ 分钟**。

---

### 五、 最终裁决与停止扩建结论

1. **工具定性与资格边界**：
   - [`tools/release-composition-review.mjs`](file:///D:/.codex/worktrees/release-high-impact-execution/运营管理系统/tools/release-composition-review.mjs) 已严密实现离线静态检查能力，报告明确声明为“调用方声明”与“非原子顺序快照”。
   - **严禁把离线 `ready-for-combined-review` 当作生产发布或新 batch 的准入资格**。生产准入必须继续走原计划封存、CAS 与现场真实门禁。
2. **工程停止扩建**：
   - 鉴于当前可合批组数量为 0、历史展示覆盖率为 0%、准入复用实测仅省秒级，**坚决停止大系统与自动化合批引擎扩建**。
   - 新增工具已满足离线审查的最小必要需求，3 项细节问题无需强制重构，本轮开发阶段至此收口。
本轮与 GPT-6 Astra 的交叉复审与对抗质询已全部完成并闭环归档。详细技术审查计划与最终走查见 [`walkthrough.md`](file:///C:/Users/86137/.gemini/antigravity-cli/brain/111272d0-f535-4130-847a-4e1dc8f487db/walkthrough.md) 与 [`astra_cross_review_plan.md`](file:///C:/Users/86137/.gemini/antigravity-cli/brain/111272d0-f535-4130-847a-4e1dc8f487db/astra_cross_review_plan.md)。

---

### 一、 关键复核事实与更正收口

1. **事实纠偏到位**：
   - 撤回“全系统永久仅有 C”的绝对化表述，确认在当前实际生产前驱下，暂无第二项已就绪且可合批的独立候选，AI workflows 仍处未提交状态。
   - 撤回旧 D5 ABC“物理作废”的误称，确认其源码树（`2a060401...`）与 44 个差异文件完整保留作为比对参考材料，不可执行亦不可物理删除。
   - 纠正 `verifyBatch` 现场查询误述，确认其为纯内存静态比对，现场漂移由 `executeBatch` 时的动态 collector 拦截。
   - 严格分离情景反例假设与实测数据，不将理论推演当已测实绩；0% 展示覆盖率收窄至既往 3 个历史批次与当前 4 个 UI 文件的样本范围。
   - 彻底废止未实现的 `release-batch-composite.mjs` 名称，全面对齐实际落地工具 [`tools/release-composition-review.mjs`](file:///D:/.codex/worktrees/release-high-impact-execution/运营管理系统/tools/release-composition-review.mjs)。
2. **代码级对抗审查裁定**：
   - 逐行确认 [`tools/release-composition-review.mjs`](file:///D:/.codex/worktrees/release-high-impact-execution/运营管理系统/tools/release-composition-review.mjs) 的精确增删改并集校验、前驱哈希绑定、双任务就绪门禁、同路径保守阻断、四大证据链完备性及 Exit 2 退出机制全部有效。
   - 查出 3 项代码特征（Lines 75–83 循环残留、Lines 66–72 状态后置更新、Lines 112–114 证据损坏 Exit 1），经对抗论证均属于**非阻塞（Non-blocking）**且不破坏 fail-closed 安全闭环，**裁定无需强制修改代码**。
3. **现场数据与耗时核算红线**：
   - 现场 75 条事件中，25 次准入（47.808 分钟）与 13 次嵌套 Status（7.701 分钟）为**包含关系，绝对不可相加**。准入各细项耗时仍属未知，严禁断言“47.8 分钟全可节省”，更不可盲目预估 $\ge 30$ 分钟净省。
   - Actual AB $\rightarrow$ Main 虽无核心代码变动（458 差异均在 docs/tests/tools），但受 protected 路径约束，依法维持 STRICT。

---

### 二、 最终裁决

- **严禁资格泛化**：[`tools/release-composition-review.mjs`](file:///D:/.codex/worktrees/release-high-impact-execution/运营管理系统/tools/release-composition-review.mjs) 仅为纯离线静态检查助手，**其生成的 `ready-for-combined-review` 严禁等同于生产或新 batch 的准入资格**。生产准入必须继续执行原计划封存、CAS 与现场真实门禁。
- **坚决停止大工程扩建**：鉴于可合批组数量为 0、展示覆盖率为 0%、准入复用仅省秒级，本轮坚决停止泛化大工程与新生产调度开发。
- **环境纯净确认**：本工作区未做任何文件修改、未执行任何 shell、未执行任何生产操作，已完全就绪并安全归档。

