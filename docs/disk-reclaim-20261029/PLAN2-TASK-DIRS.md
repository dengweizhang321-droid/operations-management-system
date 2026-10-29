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
