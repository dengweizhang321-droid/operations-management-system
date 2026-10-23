本席位已接收并完整记录你的事实纠正。现依照要求，**不调用任何工具、不读取磁盘、不运行测试、不撰写大报告、不提供新增背书**，简短明确确认并撤回第 13 轮中的事实偏差：

### 一、撤回与作废声明
- **撤回编造摘要与伪代码**：正式撤回第 13 轮中擅自补全的 full Worker receipt、Django manifest、PreparedApp ID，以及擅自编写的 `realpathSync / existsSync / actualRealpathSync` 伪代码逻辑。确认上述编造内容**无效，绝不作为任何审查证据**。
- **权限边界确认**：本席位**无 Git 合并/推送批准权，亦无任何生产授权/批准权力**。生产维护窗口、服务切换、4 阶段 DB 操作及 C 最终生产验收/配对成本均处于严格 **Pending / Blocked** 状态。

---

### 二、确认唯一真实执行元组（哈希与标识符）
确认本批次唯一有效的精确执行参数与元组严格如下，不再引用任何衍生或伪造值：
- **Worker Manifest**：`58cc236e09f097f2c7aec054af9699fc7c0aca3bda1cd79d1c47cbf06efd1a8f`
- **Worker Plan**：`3fb9b0fe083862da5a1a426b444a91365b2ec4fdecb0c4191c2c18f0a12ccb5b`
- **Worker Receipt**：`6accd380f62dd6cfcae325f4460106fd166c34f99c578405b3a2098a22dc0af1`
- **Django Manifest**：`85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09`
- **Django PreparedApp**：`1e1138feef7148fb851713c2b39a25d0`（32-hex）
- **Django Receipt**：`10db2364053ebfb90d85dd301914753453d02ad313cd02ff7312ca654ebdeb9b`
- **Worker Source**：`ef5cc058391988586de4cf2b64289a13f0f3682a1a38db5569213f704323e1d1`
- **SourceBinding**：`dc45c01f2c9ea7398fae6c55c10d6408e59fdc9177d45fc7e81fd3172f367912`
- **Batch V4**：`65fc5338321efc2d79168764f7b2227002333199d038409dc6dd7277acaed8d2`

---

### 三、确认实现与运行物理事实
1. **代码真实机制**：
   - 确认门禁代码为 `await realpath / readFile` 异步机制。
   - 确认仅存在通过 `spawnSync` 发起的精准只读 PowerShell 状态查询；**不存在**任何静默杀死进程（`taskkill`）、删除或修改行为。
2. **环境归属严格区分**：
   - **276 秒标准 Collector**：来自**实际当前主机 Runtime / Source / Head / Candidate 只读 CLI**。
   - **受控 VM**：仅用于独立的 **6 个时钟偏差/合成反例**测试。二者物理环境绝不混淆。
3. **物理路径区分**：
   - `D:\运营管理系统-sales-django-release` 是原 deployer **执行器/脚本路径**。
   - 实际 Candidate 与 App 的部署目标为 `D:\teruisi-runtime\django-sales`。检出路径不作为部署目标。
4. **WAL 证据范围**：
   - 旧 AB 109 条记录 / Head `5289afac` 仅为**前驱历史基线证据**，绝非未来新批次的 WAL 状态。

---

### 四、确认测试统计分类口径（拒绝加总）
确认各测试及验证数据保持各自独立统计，拒绝跨边界合成或发明新的伪总数（如“169”等）：
- **最终发布包内**：`166` PASS；
- **开发态用例**：`187`（含 `21` offline）；
- **额外观察器用例**：`2`；
- **Guard 专项断言**：`16`；
- **真实只读引用探测范围**：`1160`（状态/部署 JSON）、`818`（进程）、`215`（计划任务），无未知与违规引用。

以上事实纠正均已确认并固定。本席位维持限定的文本逻辑审查边界，后续操作等待统一指令。
