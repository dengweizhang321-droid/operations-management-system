# 物流 11037：闭合工具施工与现场边界

2026-11-02，基线 `4e94566a`，独立工作树 `D:/codex-isolated/autoimport-stuck-closure-20261102`。原[优化方案](D:/运营管理系统/docs/autoimport-stuck-plan-closure-20261102/优化方案.md)在主工作区只读保留、未复制或修改；本文纠正其“只换 target”和“进程变化后重采重跑”的实施假设。

## 交付状态

- **代码候选已实现**：11037 有只读 `prepare`、冻结目标 `inspect`、显式 `apply` 入口，复用原闭合主体；9851 的旧常量、导出函数、CLI 与原特殊资格保留。
- **只读候选已采集**：现采摘要与身份只代表观察时点；`approved=false`、`executionEligible=false`。没有将现场自采值视为审批。
- **完整现场资格未核验**：未调用会获取生产锁的完整 `inspect`，未停用 n8n、未写闭合 intent、未归档 active、未执行 apply、未恢复调度、未发起新 execution。因此不能说 11037 已闭合或已具执行资格。
- 未提交、推送、合并、准备生产制品或部署；没有新增或运行功能测试。必要 TypeScript 语法转译三个变更文件均无错误；项目负责人统一完成类型/依赖检查和独立审查。

## 已观察到的差异与处理

11037 是 `jdl-c74beae0-781f-4ee2-9d6f-8757b2695c1f`。其 execution 在 `2026-10-30 00:50:16.460Z` 至 `00:50:27.838Z`，位于 seq271 入包与 seq272 出包之间；历史包是 `20261028T125857Z-7f8e70a23ee72777`，当前观察包是 seq275 的 `20261101T022438Z-d66b62c835444d90`。

历史与当前 helper tree 不同（`b891233b…` / `f04ad924…`），三个 PowerShell 资源相同，`tmall-workflow-helper.mjs` 不同；exporter 原始来源 SHA 同为 `9c69a122…`。因此不能替换 9851 target 后声称满足“新旧 helper 逐字节相同、入/出两帧直接接到当前包”的原特例。

新增资格仅适用于静态硬绑定的 11037：

1. 历史 execution/run/plan/active/manifest/data、原包 manifest/receipt/helper tree、exporter、入包/出包记录均在 `jd-logistics-login-11037-target.ts` 固定为本轮真实只读采集值，目标文件不能覆盖。
2. 历史 manifest 摘要绑定 receipt，manifest 与 receipt 都绑定固定四文件 tree。逐个实读四文件，用原长度/路径/字节算法重算 tree；receipt 输入明确绑定 exporter，exporter 来源实读校验并证明 login 失败在任何 flow export 之前。
3. 当前包仍独立执行原 `installedEvidence` 的四文件完整性、exporter、receipt、supervisor receipt 与精确进程校验；另核当前 manifest 到 receipt/tree 的绑定。两端 exporter 必须是同一固定来源字节。
4. 冻结目标保存 seq271 到当前包的**完整连续链**，本轮观察为 271→272→273→274→275。每帧检查 sidecar、文件摘要、payload 摘要、前驱 binding 文件名；相邻序号连续、完整 successor/predecessor 相同、激活时间严格递增。前两帧包住原 execution，尾帧绑定当前包且无后继。
5. workflow 必须已冻结为 `active=0`、`activeVersionId=null`、current version/history graph/shape 精确匹配；原 error/trigger execution、无成功重试/在途、原图入口限制保留。11037 精确 schedule 节点是“每天08:50计划入口”；9851 保持“每天08:00计划入口”。
6. 原计划四 operation、无 export/receipt 等执行结果、仅空 flow 下载目录、配置/店铺/端口、全量历史批次分页和精确批次选择、历史策略只允许事业部 revision 变化、helper ready/idle、双锁及移动前后三次进程复查均保留。

这不是把 9851 的字节等价门禁普遍删除；其原分支保持原门禁。11037 的新证明由历史包真实性、完整执行区间、连续发布链及当前包独立真实性共同完成，仍须在现场授权冻结后运行完整检查。

## 入口与冻结文件

源码入口：`tools/close-jd-logistics-login-11037.ts`。以下命令以有 `node_modules/tsx` 的已准备源码目录为工作目录。当前隔离树可使用主工作区既有 loader：`node --import file:///D:/运营管理系统/node_modules/tsx/dist/loader.mjs`，不在生产树安装依赖。

```powershell
node --import tsx tools/close-jd-logistics-login-11037.ts prepare
```

`prepare` 只读本机文件、n8n SQLite 和本地 GET，不创建生产锁/intent，不改配置或 active。输出观察信封与 `target`；只允许精确 11037。历史 revision 只能由原 selector 唯一复现所有原 operation 字段得到，不能猜值。任意 `login-11037-*` 目录存在即拒绝重采，防止用新 PID/新目标绕过旧意图。

本轮隔离观察文件（忽略产物，不随源码提交）：

| 文件 | SHA-256 | 含义 |
| --- | --- | --- |
| `outputs/closure-preparation/logistics11037-observation.json` | `014bf016911329a6c870989510c67ba5c716eaecc04743b1255d44fa8583f0c3` | 完整未批准观察信封 |
| `outputs/closure-preparation/logistics11037-target.candidate.json` | `58bb1b191cd29f9e371eecdeafe98c0d05df691daa6044c9ad1e2b04c544d611` | 目标候选对象，不能因文件名/SHA 就当审批 |

观察时 workflow 仍启用，`activeVersionId=7ad45df5-5ce8-4dae-b08a-4dc9f2d0230c`；事业部原/现 revision 均为 50。当前 helper/supervisor 身份已采集，但没有用这些观察宣称完整资格。目标随进程、设置、批次或当前版本变化即可能失效。

未来获得对应授权后，先独立核对候选，冻结**只含 target 对象**的完整 JSON 文件及其文件字节 SHA（不能把外层观察信封作为 target）。只有没有任何旧 intent 时，才可按授权通过 n8n 官方入口冻结并独占其手动入口；不通过 SQLite 写入冻结。完整检查与 apply 都使用同一已审核目标/SHA：

```powershell
node --import tsx tools/close-jd-logistics-login-11037.ts inspect --target D:/approved/target11037.json --sha256 <已审核文件SHA256>
node --import tsx tools/close-jd-logistics-login-11037.ts apply --target D:/approved/target11037.json --sha256 <同一文件SHA256> --apply
```

上面的路径是格式示例，没有预建审批文件，也没有授权这些生产动作。SHA 参数只保证读取的是同一份文件；业务授权、精确历史资格和现场全量检查仍各自成立。`inspect` 获取与 apply 相同的原生产锁，本轮没有调用。

## 四态中断手册

所有中断都保留原失败 execution、原 manifest 以及恢复材料。不要删除 active、改失败为 completed、覆盖 intent/committed，或重放 11037。路径固定为 `outputs/jd-logistics-pipeline/login-11037-c34404deffc764f2`。

| 状态 | 只读判定 | 下一步 |
| --- | --- | --- |
| 未 intent | recovery 不存在；或已有目录/原件但 `intent.json` 尚不存在 | recovery 完全不存在时，可在后续授权下重新准备并独立审核。若已有目录/部分原件，属于中断/未知，保留并人工核对，入口拒绝重采和 apply；不能因无 intent 就删除目录重跑。 |
| intent 已写、尚未归档 | `intent.json` 与原件齐全，`active.json` 仍等于原 active SHA，`active.archived.json` 不存在，`committed.json` 不存在 | 保持冻结，核对**原 intent 中同一 target**及其摘要、原件与 active、进程/锁/工作流/下载/批次证据。入口没有自动 resume；须明确授权的同意图人工对账方案，不能换 PID 生成新目标重试。 |
| active 已归档、未 committed | `active.json` 不存在，archive 等于原 active SHA，`committed.json` 不存在 | 这是未知/未完成，不能恢复调度或运行新 A。即使进程校验随后失败，也不能重采 PID 重跑、搬回 active 或手写 committed。保留同意图证据后制定精确人工对账/恢复方案。两份 active 同时存在、两份都缺失或任意摘要不符也按此停止。 |
| committed | 原 intent、原件、archive 摘要/路径与 `committed.json.intentSha256` 全部一致，active 不存在，原失败 manifest 保持 | 表示闭合归档事务完成，原执行仍是失败；不表示新采集成功。后续只有获得恢复调度/新完整 execution 的对应授权，才恢复冻结的原发布版本并从新 A 开始；永不 retry 11037。 |

`apply` 先保存原件，再 create-only 写 intent，复验后才移动 active；移动后还会重新检查并可能失败。任意 recovery 目录存在，prepare/inspect/apply 全部拒绝重新开始。工具没有把未知结果自动“补成成功”的入口；上述人工对账并不授权绕过原门禁或执行未批准的状态写入。
