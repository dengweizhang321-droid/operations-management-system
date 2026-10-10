# 离线精确组合资料检查器

`tools/release-composition-review.mjs` 在进入既有准备流程前检查组合清单，输出可供独立复审的资料；它不生成 Worker 包、plan、batch 或生产准入回执，不访问 active/WAL，也不执行 Status。现行生产流程和批准范围不受它影响。

## 输入与运行

```powershell
node tools/release-composition-review.mjs 'E:\具体本次准备目录\composition-request.json' > 'E:\具体本次准备目录\composition-report.json'
```

退出码：`0` 表示字节和清单检查无阻断、可继续联合复审；`2` 表示有明确阻断（例如不足两个任务、未就绪、旧前驱、依赖缺失或组合不精确）；`1` 表示输入非法、路径/文件不安全、读取失败或摘要不匹配。任何退出码都不是发布许可。输出文件由调用方选择新路径保存，避免覆盖旧证据。

输入结构如下，尖括号必须替换为实际绝对路径和完整64位小写SHA-256：

```json
{
  "version": "teruisi-release-composition-review-v1",
  "predecessor": {
    "root": "D:/已核实实际运行包/source-snapshot",
    "sourceSha256": "<原source-tree算法SHA>",
    "inventorySha256": "<完整文件库存SHA>"
  },
  "combined": {
    "root": "E:/本次独立准备/combined-source",
    "sourceSha256": "<完整组合source-tree SHA>",
    "inventorySha256": "<完整组合库存SHA>"
  },
  "items": [
    {
      "id": "task-a",
      "state": "ready-unexecuted",
      "predecessor": {
        "sourceSha256": "<同一个实际前驱SHA>",
        "inventorySha256": "<同一个实际前驱库存SHA>"
      },
      "source": {
        "root": "E:/本次独立准备/task-a-complete-source",
        "sourceSha256": "<该任务完整源SHA>",
        "inventorySha256": "<该任务完整库存SHA>"
      },
      "dependsOn": [],
      "evidence": [
        { "kind": "independent-tests", "path": "E:/本次证据/独立测试.log", "sha256": "<文件字节SHA>" },
        { "kind": "dependency-review", "path": "E:/本次证据/依赖兼容审查.md", "sha256": "<文件字节SHA>" },
        { "kind": "acceptance-plan", "path": "E:/本次证据/任务全部验收.md", "sha256": "<文件字节SHA>" },
        { "kind": "rollback-plan", "path": "E:/本次证据/回退和前向恢复.md", "sha256": "<文件字节SHA>" }
      ]
    }
  ]
}
```

每项 source 是完整源码，而不是仅改动文件。至少两项才可能形成合批机会；上面的单项示例会明确 blocked。所有任务相对于共同前驱的增删改并集必须精确等于 combined，附加或遗漏文件拒绝。同一路径即使最终字节相同也阻断；此工具不擅自解决冲突，不代替接口/迁移/回退兼容审查。`dependsOn` 只允许指向本请求中的任务，跨批前置必须在实际前驱中已具备并由依赖审查说明。

摘要复用原算法，可在独立准备环境用已有函数获取；不要拿Git commit SHA或部分文件SHA代替：

```javascript
import { readSourceTree, sourceTreeDigest, sourceInventory, hash } from './tools/release-impact.mjs';
const files = await readSourceTree('E:/本次独立准备/task-a-complete-source');
console.log({ sourceSha256: sourceTreeDigest(files), inventorySha256: hash(sourceInventory(files)) });
```

## 报告的证据边界

状态和前驱来源来自调用方声明。四类材料必须逐字节匹配引用SHA，但工具不会推断其内容通过、验收充分、回滚可行或真实任务未执行。独立复审仍须检查材料内容、实际前驱、未采用状态、相互影响、每项验收/副作用授权和恢复方案；`ready-for-combined-review` 只表示可进入该复审。

各完整源按顺序读取并绑定声明摘要，不能代表全局原子现场快照；读取后变化须由原 rotation/batch/admission 再次完整复验。没有TTL、旧成功缓存或hash不匹配自动接受。没有真实独立展示见证时报告保持strict。

后续沿用[发布批次协议](../RELEASE_BATCH_WORKFLOW.md)的候选构建、联验、独立复审与精确批准。不能把这个报告直接传给execute，不把main全部功能自动纳入，也不换绑旧批准。

## 本次实际用例

外部证据目录中的 `c-composition-request.json` 采用当前AB实际source-snapshot为比较前驱，而唯一条目保留原D5前驱、`state=stale-predecessor`，拟组合只用旧ABC源。它用于证明拒绝失效准备和单项合批，预期exit2。旧ABC是历史比较资料；新的生产candidate/plan/batch均未生成。真实完整差异与历史三批分类见主报告和source-deltas/historical-source-coverage JSON。

当报告为 blocked 时，preparationOrder 与 unexpectedCombinedChanges 仅供定位问题：循环依赖可能留有部分遍历顺序，重叠路径的诊断并集可能取最后一项；均不得用于准备执行。必须先独立解决全部 blockers 后重新读取完整来源。

