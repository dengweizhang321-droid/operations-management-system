# 方案二只读核实：63 个任务目录分类清单（2026-10-29）

只读审计。未删除、移动或修改任何文件。完整逐目录数据见 `plan2-audit-20261029.json`。

## 0. 结论

63 个超 7 天未写入的任务目录，合计 **31.1 GB**，按风险分三类：

| 类 | 判定 | 数量 | 大小 | 处置 |
| --- | --- | --- | --- | --- |
| **A** | 有未提交源码改动 | **1** | 0.33 GB | **必须保留** |
| **B** | 含独特发布回执 | **2** | 1.66 GB | 建议先归档回执再删 |
| **C** | 无未提交改动、无独特产出 | **60** | **29.08 GB** | 可删 |

另 5 个目录因近 7 天内有写入**已自动排除**，其中 `main-manual-release-20261016`（10-29 01:48 写入）是发布包生成器的宿主目录，**绝不可动**。

## 1. 判定口径（可机械复核，非主观）

对每个目录检查四项：

1. **未提交改动**：目录内每个注册 git worktree 跑 `git status --porcelain` 计数。
2. **独特产出**：扫 `.json/.md/.log/.txt/.jsonl/.csv`，排除 `node_modules`/`.git`/`.next`/`dist`/`source`，再**排除文件名在 `git rev-list --objects --all` 中出现过的**，剩下才算任务自身产出；日志噪音（`*.log`、stdout/stderr、npm-cache）另行剔除。
3. **worktree 注册**：是否在 `git worktree list` 中，是否带 `locked`。
4. **大小与文件数**：不跟随 reparse point，避免把 `node_modules` junction 的目标算进来。

### 一次需要纠正的误判

初版把「不在 `origin/main`」当作未归档证据，得出 30 个目录 20.7 GB 有证据。核查发现大量命中是 `AGENTS.md`、`source/docs/文档目录.md`、`docs/AI_BUSINESS_ATTRIBUTED_SKU_*.md` 这类**仓库文件的旧版本**——其中 AI_BUSINESS 系列在 git 历史中各有 5 条记录，是提交 `51e68353`（归档 1892 个历史证据文件出仓库）移除的，**可从 git 历史恢复，不是会丢失的产出**。改用「文件名从未在 git 任何对象中出现」后，真信号收敛到发布回执。

## 2. A 类：必须保留（1 个）

`product-combo-details-release-20261014`（337.8 MB）

```
worktree: D:/codex-isolated/product-combo-details-release-20261014/source
branch  : codex/product-combo-details-release-20261014
HEAD    : 1d848e8f feat(products): align kind cards and expand combo component data
未提交  : M app/product-module-view.tsx
          M tests/product-detail-performance.test.ts
          M tests/product-progressive-contract.test.ts
          M tests/product-region-recovery.test.ts
```

**该分支的提交未合入 `origin/main`**（`git merge-base --is-ancestor` 返回 NO）。删除会永久丢失一个页面改动与三个测试改动。**不建议删**，建议由负责该任务的人决定是提交、是另开分支保全，还是明确放弃。

## 3. B 类：含独特发布回执（2 个，1.66 GB）

| 目录 | 大小 | 独特回执 |
| --- | --- | --- |
| `backup-pi-tools-release-20261019` | 856.5 MB | `publish-3918480da94f/SUCCESS.json` |
| `jackyun-credential-release-20261017` | 847.3 MB | `main-release-request.json`、`publish-09db4c0130a9/FAILED.json` |

这两份回执各不足 1 MB，记录的是一次成功与一次失败的发布执行事实，仓库内无同名文件。建议**先把回执复制进 `docs/<任务名>/`**（属文档提交，不影响发布），再按 C 类处理其余。若判断无追溯价值，也可直接随 C 类删除。

## 4. C 类：可删（60 个，29.08 GB）

最大的 8 个：

| 目录 | 大小 | worktree |
| --- | --- | --- |
| `release-no-data-policy-20261010` | 4446.1 MB | 0 |
| `jackyun-audit-adoption-20261013` | 1392.5 MB | 0 |
| `jd-monitor-release-20261016` | 1305.4 MB | 1 |
| `market-ai-blockers-release-20261014` | 1181.2 MB | 1 |
| `jd-pop-release-20261015` | 1020.4 MB | 1 |
| `combined-release-20261014` | 1018.5 MB | 1 |
| `market-ai-round2-release-20261015` | 1003.7 MB | 1 |
| `jackyun-unified-adoption-20261013` | 947.4 MB | 0 |

其中 **27 个含注册 git worktree、涉及 23 个分支**。

> **删除方式必须走四步**：`git worktree unlock`（带锁的）→ 删目录 → `git worktree prune` → 删对应分支。只删目录会留下失效注册与孤立分支——这正是本会话昨日在 `main-release-packages` 上踩过的坑，已于 `2193a542` 清理（75 条记录 + 77 个分支）。

## 5. 建议的分批

| 批次 | 内容 | 回收 |
| --- | --- | --- |
| 1 | C 类中 **无 worktree** 的 33 个 | **9.58 GB** |
| 2 | C 类中 **含 worktree** 的 27 个（走四步） | **19.49 GB** |
| 3 | B 类 2 个（回执归档后） | **1.66 GB** |
| — | A 类 1 个 | **不删，等负责人决定** |

三批全做回收 **30.74 GB**，D 盘可用将由 67 GB 升至约 98 GB。

先批 1：不涉及 git 状态，风险最低；观察一轮无异常再做批 2。

现有工具 `tools/release-package-retention.mjs` 只针对 `main-release-packages`，**不能直接用于这些任务目录**（命名规则与保护集口径都不同）。批 2 需要扩展它或写一个同构的脚本，同样先 `--dry-run`。

## 6. 待你决定

1. 是否按批 1 → 批 2 → 批 3 执行；
2. B 类的回执是先归档进 `docs/` 还是直接删；
3. A 类那个未合入的分支如何处置（我不建议我代为提交或放弃）。

---

## 7. 批 1 执行记录（2026-10-29，用户授权）

新增 `tools/codex-isolated-task-retention.mjs` 与配套测试（8/8 过、eslint 0）。**回收 7.48 GB，D 盘可用 67 → 75 GB（85% → 83%）。**

### dry-run 的实际候选是 30 个 / 7.48 GB，不是清单估的 33 个 / 9.58 GB

脚本比第 1 节的审计更严，多保护了 3 个，差异都是脚本更正确：

| 目录 | 脚本跳过理由 | 我的审计为何漏判 |
| --- | --- | --- |
| `jackyun-browser-preflight-20261013` | `uncommitted(5160)` | 审计只对**注册 worktree** 跑 `git status`；该目录的 `source/` 是独立克隆，未被覆盖 |
| `jackyun-unified-adoption-20261013` | `uncommitted(5199)` | 同上 |
| `pi-inventory-erp-publish-recovery-20261018` | `holds-worktree` | 审计的 worktree 归属判定只看顶层目录，漏了嵌套路径 |

那两个 5000+ 的"未提交"实为**零提交空分支上的一次性暂存检出**（`A ` 全部为暂存新增、`M/D` 为 0，分支 `codex/jackyun-browser-preflight-candidate` 尚无任何提交）。抽查其中不在 `origin/main` 的文件为 `.agents/skills/*`，在 git 历史中有 2 条提交记录、且 `origin/main` 仍有 15 个 `.agents/` 文件，属可从历史恢复的内容。即便如此**本批仍予保留**：脚本的保守判定优先，不在授权范围内自行放宽。

### 脚本的安全设计

执行时逐项重新验证，不信任任何预存清单：跳过 `--min-age-days`（默认 7）内写过的、持有注册 git worktree 的、有未提交改动的、以及硬编码保护表里的（`main-release-packages` 与发布包生成器宿主 `main-manual-release-20261016`，后者被 `publish-latest-main.mjs` 以 `pwshDirectory`/`npmCacheDirectory` 引用）。删除前再次断言目标的父目录就是 `codex-isolated` 且不在保护表内。

### 执行后核验（全过）

| 检查 | 结果 |
| --- | --- |
| `codex-isolated` 子目录 | 69 → **39** |
| D 盘可用 | 67 → **75 GB** |
| `main-release-packages` / 生成器宿主 | 均在 |
| A 类 `product-combo-details-release-20261014` | 在，4 个未提交改动完好 |
| 两个 5000+ 暂存目录 | 均在 |
| worktree 总记录 | **125**，未变 |
| 发布包 | **2**，未变 |
| 网页 `127.0.0.1:3000` | **HTTP 200** |

未停机、未碰 `D:/teruisi-runtime/`。

### 剩余

| 批次 | 内容 | 预计回收 |
| --- | --- | --- |
| 2 | 含 worktree 的 27 个，须走 `unlock`→删目录→`prune`→删分支 | 约 19.5 GB |
| 3 | B 类 2 个（回执归档后） | 1.66 GB |
| — | A 类 1 个 + 两个 5000+ 暂存目录 | 等负责人决定 |

批 2 需扩展本脚本以处理 worktree 注销（现版本是**跳过**而非处理），同样先 `--dry-run`。

---

## 8. 批 2 执行记录（2026-10-29，用户授权）

扩展 `tools/codex-isolated-task-retention.mjs` 处理 worktree 注销，**回收 17.21 GB，D 盘可用 75 → 93 GB（83% → 79%）**。

### 脚本扩展

新增 `--with-worktrees` 开关与三个导出：`parseWorktreeRecords`（取出 branch 与 locked 状态）、`selectWorktreesFor`（把注销范围严格限制在本次要删的目录之下）。

**默认行为不变**：不带该开关时仍拒绝任何持有注册的目录，所以普通运行永远不会留下失效注册。开关只是让调用方显式接管这件事，接管后必须按序走完四步：

```
unlock（仅带锁的）→ 删目录 → prune → 删分支
```

顺序是有讲究的：带锁的 worktree 不会被 `prune` 回收，所以 `unlock` 必须在最前；`prune` 必须在删目录之后才认得出哪些注册已悬空。

`selectWorktreesFor` 的测试专门覆盖了前缀相近的陷阱：`doomed-sibling` 与 `doomed` 共享前缀但是不同目录，主检出与本会话自身的 worktree 也必须永不入选。

### 执行范围的一处收窄

首轮 dry-run 的候选是 30 个 / 18.19 GB，其中混入了两个 **B 类**目录（`backup-pi-tools-release-20261019`、`jackyun-credential-release-20261017`）——它们含独特发布回执，属批 3 且回执处置尚未决定。已用 `--only` 排除，实际执行 **28 个 / 17.21 GB**。

### 执行前核验（全过）

| 检查 | 结果 |
| --- | --- |
| B 类是否已排除 | 是 |
| A 类 `product-combo-details-release-20261014` | 被 `uncommitted(4)` 跳过 |
| 两个 5000+ 暂存目录 | 被 `uncommitted(5160/5199)` 跳过 |
| `main-release-packages` / 生成器宿主 | 被 `protected` 跳过 |
| 待注销 worktree 是否越界 | **0 条越界** |

### 执行结果与核验

```
removed dirs=28  pruned worktrees=28  deleted branches=24
```

| 检查 | 结果 |
| --- | --- |
| D 盘可用 | 75 → **93 GB** |
| worktree 总记录 | 125 → **99** |
| **目录已删但注册残留的失效记录** | **0（四步生效，未重演 main-release-packages 的半清理）** |
| 五个保护项 | 全部在位 |
| A 类 4 个未提交改动 | 完好 |
| 发布包 | 2，未变 |
| 网页 `127.0.0.1:3000` | **HTTP 200** |

测试 12/12、eslint 0。未停机、未碰 `D:/teruisi-runtime/`。

### 本条线累计

| 轮次 | 回收 |
| --- | --- |
| 发布包 78 个（方案一） | 约 13 GB |
| worktree 注册与分支（候选 A） | 0（卫生清理） |
| 任务目录批 1（30 个） | 7.48 GB |
| 任务目录批 2（28 个） | 17.21 GB |
| **合计** | **约 38 GB，D 盘 54 → 93 GB** |

### 剩余

- **批 3**：B 类 2 个、1.66 GB，待定回执是先归档进 `docs/` 还是直接删；
- **等负责人决定**：A 类 `product-combo-details-release-20261014`（4 个未提交改动，分支未合入 `main`）、两个 5000+ 暂存目录（内容可从 git 历史恢复，但本会话不自行放宽）；
- **治本**：发布包仍在为每个 `main` 提交生成，`tools/release-package-retention.mjs` 已就绪但未接入定期执行。

---

## 9. 批 3 执行记录（2026-10-29，用户授权：先归档回执再删）

**回收 0.97 GB，D 盘可用 93 → 95 GB。本条线三批全部完成。**

### 归档先于删除

先把回执复制进仓库并**推送到远端**，确认远端已有，才动手删原目录——这样任何一步出问题证据都已入库。

实际回执比第 3 节记录的多一份：`jackyun-credential-release-20261017` 下有 **3 份**（原记 2 份），多出的 `resume-schema-transport/SUCCESS.json` 恰是最有价值的一份。四份均校验字节一致：

| 归档位置 | 内容 |
| --- | --- |
| `docs/backup-pi-tools-release-20261019/publish-3918480da94f-SUCCESS.json` | 2026-10-19 worker+django 发布，main `3918480da94f`、Worker release `20261019T104309Z-f28b90a85276e948`、无 migration |
| `docs/jackyun-credential-release-20261017/main-release-request.json` | 本轮发布请求 |
| `…/publish-09db4c0130a9-FAILED.json` | 2026-10-16T17:44:18Z 在「登记结构迁移」失败：`Invalid approved script parameter value` |
| `…/resume-schema-transport-SUCCESS.json` | 18:04:23Z 恢复成功，migration `inventory.0015_jd_monitor_preferences`（147 条）、健康 ready、`originalFailurePreserved: true` |

两个目录各附 `README.md` 说明来历，因为原工作目录已不存在。

### 执行结果

```
removed dirs=2  pruned worktrees=2  deleted branches=1
```

分支只删 1 个：另一条 worktree 是 detached，无分支可删。

### 执行后核验

| 检查 | 结果 |
| --- | --- |
| 两个目录 | 已删 |
| 回执在仓库 | 4 份在，且远端可取 |
| D 盘可用 | 93 → **95 GB** |
| `main-release-packages` / 生成器宿主 / A 类 | 全部在位 |
| A 类 4 个未提交改动 | 完好 |
| 网页 | **HTTP 200** |

### 一次自查误报（记下来免得下次误判）

核验脚本一度报「38 条失效 worktree 注册」。追查发现首条是 `D:/运营管理系统` 主检出本身——**Python 的 `os.path.isdir` 在这些含中文的路径上判断失败**，属脚本缺陷而非真失效。以 git 自身为准：`prunable` 标记 **0 条**、`git worktree prune --dry-run` **无输出**、`codex-isolated` 下 7 条注册逐一实测存在。清理是干净的。

> 教训：判断 worktree 是否失效应当以 `git worktree list --porcelain` 的 `prunable` 标记为准，不要自己用路径存在性去推断——本项目的路径含中文，容易踩编码坑。

## 10. 本条线总账（2026-10-29 收尾）

| 轮次 | 回收 | 备注 |
| --- | --- | --- |
| 发布包 78 个 | 约 13 GB | 方案一 |
| worktree 注册 75 条 + 分支 77 个 | — | 候选 A，卫生清理 |
| 任务目录批 1（30 个） | 7.48 GB | 无 worktree |
| 任务目录批 2（28 个） | 17.21 GB | 走四步注销 |
| 任务目录批 3（2 个） | 0.97 GB | 回执先归档 |
| **合计** | **约 38.7 GB** | **D 盘 54 → 95 GB（88% → 79%）** |

`codex-isolated` 子目录由 69 降至 9，worktree 总记录由 200 降至 97。

### 仍未处理（等决定，非遗漏）

1. **A 类** `product-combo-details-release-20261014`：4 个未提交改动，分支 `codex/product-combo-details-release-20261014` 未合入 `main`，删除会永久丢失，交负责人定。
2. **两个 5000+ 暂存目录**（`jackyun-browser-preflight-20261013`、`jackyun-unified-adoption-20261013`）：零提交空分支上的一次性检出，内容可从 git 历史恢复，但本会话未自行放宽授权范围。
3. **治本**：发布包仍为每个 `main` 提交生成（约 145 MB/个）。`tools/release-package-retention.mjs` 已就绪，但**未接入定期执行**——不建议挂在发布成功之后（理由见 PLAN4 第 3 节候选 B）。

---

## 11. A 类核实结论：建议放弃该分支（2026-10-29，只读）

**结论与此前判断相反：`product-combo-details-release-20261014` 不该抢救，它是 10-14 的旧快照，合并会回退两周改动。** 以下为实测依据，未执行任何处置。

### 一、那 4 个「未提交改动」是行尾差异，零内容改动

```
git diff --ignore-cr-at-eol --numstat  → 四个文件全部「无差异」
```

`git status` 把它们报成 `M` 仅因 CRLF；仓库的 `.gitattributes`/autocrlf 会在下次 touch 时归一化。**没有任何内容需要抢救。**

### 二、两个未合入提交中，第一个已以等价提交进入 main

| 分支提交 | main 对应 | 证据 |
| --- | --- | --- |
| `1d848e8f feat(products): align kind cards and expand combo component data` | **`af46feac`，标题完全相同** | 两者提交时间戳均为 `2026-10-14 22:10:15 +0800`，是同一份工作 |

实测 `lib/products/read-contract.ts`、`lib/products/summary.ts` 分支版与 main **零差异**；`docs/product-combo-details-20261014/` 的 REPORT.md 与 PRODUCTION.md **已在 main**。

`tools/release-scope-plan.mjs` 仍有差异，但方向是反的：**main 版更新**。main 现有分支版所缺的 `workflow` 与 `businessDataProcessing` 字段，以及 schema-only policy 的说明注释；该文件在 10-14 之后又被 `5146cc3d` 改进过。分支版是旧状态。

### 三、合并该分支会回退一个已上线的安全修复

分支相对 main 的净内容差异（排除 docs）：**873 个文件、+30835 / -105810 行**，其中包括删除：

```
worker/same-origin-write-gate.ts   119 行
worker/index.ts                      4 行
```

`same-origin-write-gate.ts` 正是 2026-10-24 上线的**全局同源写闸门**（审查 #2 的修复，实测跨站写返回 403）。main 有该文件、分支没有——合并会把它删掉。

提交数对比：**main 独有 403 个提交，分支独有 2 个**。

### 建议

**放弃该分支与目录**：删目录、`unlock`→`prune` 注销注册、删分支 `codex/product-combo-details-release-20261014`。可回收 337.8 MB。

理由：唯一的内容贡献（`1d848e8f`）已在 main 以 `af46feac` 落地；"未提交改动"是行尾噪音；保留它的唯一风险是将来有人误以为这是待合入工作而合并，从而回退包含安全修复在内的 403 个提交。

**不建议提交或另存**：没有内容可保，且该分支已被 main 全面超越。

仍由用户决定；本会话不自行处置。
