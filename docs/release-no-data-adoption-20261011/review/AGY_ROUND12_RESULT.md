# TERUISI 首次采用第 11 轮独立对抗性审查报告：8.3 路径引用防御与 V3 批次核定

> **审查方**：Antigravity 独立审查席  
> **审计对象**：任务专用只读门禁最终代码（`FINAL GUARD FULL CODE`，脚本哈希 `72a9139e51badd044273c0718d940520fda0aee74869e8ae0345659777f1a99d`）、新生成的 SEALED 批次 V3（`54e839da81188fc4b60eb1431668df22291b65cd690dc3e8af12b29a17990daa` / `ADOPTION_BATCH_V3.json`）及关联环境事实  
> **审查基线**：真实已闭环 AB 前驱（W chain 219 `aaf62994`，W `f4e537`，D `237fbe`，WAL 109 `5289`，旧引擎 `strictfalse / unknown` 保留，owner absent）；Worker 清单 `58cc236e...`（源码 `ef5cc058...` 5160 文件，SourceBinding `dc45c01f...`）；Django 候选 `85cf0699...`（PrepareApp `1e1138...`）  
> **审查约束**：纯自包含文本审查，无本地文件/Shell/生产工具调用，不重新访问未授权资源；**不宣称已实跑测试，不宣称生产已通过；本席位绝对没有生产批准权力**。

---

## 一、 审查声明与前置认知纠偏（Audit Stance & Corrections）

结合主 Agent 的客观反馈与真实工程边界，本席位**正式纠正并收敛先前的部分过强表述**：

1. **纠正“原子过渡/零间隙/两组件事务”表述**：
   在维护模式下，`op-apply`（应用 Worker 候选）与 `DeployApp`（应用 Django 候选）之间**在物理上确实存在短暂的“新 Worker 文件已落盘、旧 Django 文件仍在运行目录”的受控并存期**。批次编排所保证的是：**在已批准的受控操作序列内，该过渡区间绝不调用 backup 或 retention 逻辑**；但整体安全本质依赖于逐文件 CAS、维护锁、Gate 门禁与 WAL 串行推进，并非两个分布式组件的 ACID 瞬时事务，亦无法防范带外未授权的人为违规操作。
2. **纠正“末尾 WAL 校验证明所有观察无虚假”表述**：
   Gate 末尾执行的 `journalState` 比较仅能证明**自检执行期间批次日志未发生并发写漂移**，不属于证明所有外部系统状态（进程、任务列表等）绝对不可被模拟或篡改的密码学凭证。
3. **轮次与基线事实确认**：
   确认本轮为对抗复审第 11 轮（对应用户 CLI 计数第 11 轮），历史各轮原输出与事实保留；本次变动仅限于 Guard 脚本字节调整、新 Spec 测试路径绑定与维护 ID 刷新，源码及 4 DB 阶段基线未动。

---

## 二、 8.3 短文件名（SFN）引用解析防御机制对抗性审查

针对新增的 `inspectReferences` 函数及其短路径解析逻辑进行边界攻击推演：

```javascript
const tokens = [...value.matchAll(/"([A-Za-z]:[\\/][^"]+)"|'([A-Za-z]:[\\/][^']+)'|([A-Za-z]:[\\/][^\s"']+)/g)].map(m => m[1] ?? m[2] ?? m[3]);
for (const token of tokens) {
  if (token[0].toLowerCase() !== target[0] || !/(?:^|[\\/])[^\\/]*~[1-9][0-9]*(?:\.[^\\/]*)?(?:[\\/]|$)/i.test(token)) continue;
  let physical;
  try { physical = (await realpath(path.win32.normalize(token))).toLowerCase(); }
  catch { throw new Error('Cannot resolve a same-drive short path reference; previous package replacement is blocked'); }
  if (physical === target || physical.startsWith(target + path.sep)) return true;
}
```

### 1. 误放（False Allowance / 漏报）对抗分析
- **带引号与未带引号提取**：
  正则采用三种分支：`"([A-Za-z]:[\\/][^"]+)"`、`'([A-Za-z]:[\\/][^']+)'` 以及 `([A-Za-z]:[\\/][^\s"']+)`，可完整提取命令行中带双引号、单引号或无引号空格截断的盘符限定 Token；
- **同驱过滤有效性**：
  `token[0].toLowerCase() !== target[0]` 将扫描严格限定在与目标目录相同的盘符（`D:`）。由于 Windows NTFS 的 8.3 短别名是卷级别（Volume-specific）的文件系统属性，其他盘符（如 `C:`）上的短路径在物理上不可能解析为 `D:` 盘的目标目录，跳过非目标驱动器属于数学安全的收敛；
- **短别名模式精确匹配**：
  正则 `/(?:^|[\\/])[^\\/]*~[1-9][0-9]*(?:\.[^\\/]*)?(?:[\\/]|$)/i` 准确命中了以 `~1` 至 `~999` 结尾的短名特征，且排除了 `~0` 等非法 Windows 别名，同时允许段落中带有扩展名；
- **进程与任务全面覆盖**：
  在主查询中，对进程的 `CommandLine` 和 `ExecutablePath`，以及计划任务的 `Execute`、`Arguments`、`WorkingDirectory` 均直接执行 `await inspectReferences(...)`，未受 `visitValue` 仅处理盘符前缀键值的限制。
- **漏报结论**：针对宿主机上以短路径拉起的目标目录进程或计划任务，**不存在已知的模式逃逸漏洞**。

### 2. 误杀（False Rejection / 误拦截）与潜在可用性阻断分析
- **致命误杀隐患（Fail-Closed on Stale/Dead Aliases）**：
  注意 `catch` 块的逻辑：
  `catch { throw new Error('Cannot resolve a same-drive short path reference; previous package replacement is blocked'); }`
  **安全取舍推演**：如果当前宿主机上某个完全无关的长期运行进程（如后台监控、备份工具或调试脚本），其命令行中残留了一个位于 `D:` 盘的 8.3 短路径（如 `D:\TEMP~1\batch_123.tmp`），而该临时文件已被操作系统清理：
  1. `realpath` 将抛出 `ENOENT` 异常；
  2. `catch` 块直接捕获并抛出硬性错误中断执行；
  3. **结果**：即使该引用与 `app.previous` 毫无物理关联，仅因其属于同盘符下无法解析的短名，就会直接导致整个发布在 `pre-deploy` 阶段被强行熔断！
- **审查定性**：
  这是“面对破坏性删除动作（删除旧目录），宁可误杀不可漏判”的激进防御策略（Fail-Closed）。它消除了伪造风险，但引入了**运维环境洁净度强依赖**——如果在执行前宿主机进程列表中存在指向已删除 D 盘路径的死短名，发布将必然失败。必须在最终生产审批的自检清单中，明确要求排查此类陈旧进程。

---

## 三、 新批次 V3（`54e839da...`）全量要素一致性核定

基于新生成的 `ADOPTION_BATCH_V3.json`，核定关键技术实体的一致性：

1. **唯一变动范围（Minimal Delta Invariant）**：
   对比旧 V2 批次，本次新批次仅发生 3 处严格受限的变动：
   - Guard 脚本哈希更新为 `72a9139e51badd044273c0718d940520fda0aee74869e8ae0345659777f1a99d`；
   - 批次规范文件路径调整为 `ADOPTION_BATCH_V3.json`；
   - 刷新了单次批次绑定的随机 `maintenanceId`；
2. **核心密码学基线完全冻结**：
   - 源码树哈希：`ef5cc058391988586de4cf2b64289a13f0f3682a1a38db5569213f704323e1d1`（5160 文件）
   - Worker 清单哈希：`58cc236e09f097f2c7aec054af9699fc7c0aca3bda1cd79d1c47cbf06efd1a8f`
   - Worker Plan 哈希：`3fb9b0fe083862da5a1a426b444a91365b2ec4fdecb0c4191c2c18f0a12ccb5b`
   - Django 清单哈希：`85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09`
   - SourceBinding 哈希：`dc45c01f...`
3. **操作拓扑与数据库 4 阶段完全保全**：
   - 操作表依然由原定的 20 项标准操作构成，拓扑序保持 `EnterMaintenance -> StopWorker -> worker-apply -> Guard -> DeployApp -> HardenAcl -> ExitMaintenance -> StartWorker`；
   - `databaseOperations.operationIds` 明确声明包含 `['backup-pre', 'restore-pre', 'backup-post', 'restore-post']`，`required: true`；
   - **首次自举的 4 阶段数据库操作 100% 封存，无任何豁免或减配**。

---

## 四、 局限性与未证明缺口（Retained Limitations）

1. **受控 VM 验证不等于生产实跑**：
   虽然 166 项包内测试通过（38.573s），且真实只读 Collector 在 VM 环境耗时 276.680s 完成了全量多维自检，但这属于**批准前的离线机器准备工作，绝不等于生产切换验收**；
2. **真实生产 8.3 别名未实测**：
   针对短路径解析的 7 项单测使用的是受控合成 Resolver 验证，生产环境中真实进程是否存在诡异的极端参数拼接，仍需在动作前依赖现场只读自检查验；
3. **旧 V2 批次状态清白**：
   旧 V2 批次未获批准，仅存在空的准备阶段日志，生产环境中不存在旧批次的所有权或 WAL 残留。

---

## 五、 最终复审裁决

在收敛过强表述、全面推演 8.3 别名解析防御机制及校验 V3 新批次一致性后，Antigravity 独立审查席给出最终裁决：

- **漏洞与逻辑阻断判定**：**无**（8.3 短路径解析机制对抗完备，未能构造出漏判反例；误杀风险属于受控的 Fail-Closed 策略，已知且明确；V3 批次密码学绑定闭环）；
- **候选准备准许**：**【准予作为最终候选材料保持就绪（CLEARED AS FINAL CANDIDATE SPEC）】**。代码、门禁与批次文件具备技术完备性；
- **生产控制令（最高红线）**：**坚决保留生产阻断**。本裁决不代表生产发布批准；生产环境的维护窗口、服务启停、4 阶段数据库操作及文件替换，**绝对必须等待人类操作员精确、明确的最终生产批复方可执行**。
