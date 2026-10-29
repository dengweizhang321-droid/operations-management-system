# 方案四只读查清：发布包生成入口与保留策略可行性（2026-10-29）

只读调查。未改动任何代码或生产数据。

## 0. 两个结论，其中一个推翻了我昨天的判断

**一、生成入口已找到**：`tools/publish-latest-main.mjs` 的 `prepareLatestMainOnce()`。

**二、「纯文档提交也建全量包」这个判断是错的。** 昨天报告第 8 节据此提出方案四，该前提不成立，现予更正。

实测 `classifyRelease()`：纯 `docs/`、纯 `tests/`、`README.md` 的改动**都正确判为 `components=[] / scope=non-production`**，不会打包。`tools/` 下改动才升级为 `[worker,django] / full`（这符合规范对发布工具的要求）。

真正的原因是**比较基线不是上一个提交，而是上次已部署的提交**（`live.mainCommit`，取自 `app.previous`/已部署记录）：

```
base = 18c25a3a153e（上次已部署）   head = 93a13d7b（我昨晚的纯文档提交）
累积差异 2057 个文件，其中非 docs 144 个
→ components=[worker,django] scope=full   ← 正确
```

即那个 144 MB 包反映的是**自上次部署以来的全部累积改动**，不是那一个文档提交。生产已连续多日未部署 Django，累积自然很大。**这是设计使然，不是缺陷。**

## 1. 生成机制（实测）

`tools/publish-latest-main.mjs:78-95`：

```js
const name = target.slice(0,12) + '-' + live.head.bindingSha256.slice(0,8) + '-' + live.djangoManifestSha256.slice(0,8);
const packet = path.join(config.releaseDirectory, name), source = path.join(packet,'source');
await fs.mkdir(packet, {recursive:true});
if (!await exists(path.join(source,'.git'))) {
  await git(config.repository, ['worktree','add','-b','codex/manual-main-'+name, source, target]);
  await git(config.repository, ['worktree','lock','--reason','Manual latest-main release source; keep while package is in use', source]);
}
...
const plan = makePlan({base: live.mainCommit, head: target, cwd: source});
if (!plan.components.length) return {status:'non-production', ...};   // ← 跳过打包
```

要点：

1. **包目录与 git worktree 在 `:85-88` 创建，范围判定在 `:92-93`**——先建后判。所以即便是 `non-production`，仍会留下一个 worktree（内含 `node_modules` junction 与完整源码检出）。
2. 每个包配一个 `codex/manual-main-<name>` 分支，且 worktree 被 **`lock`**。
3. `config.releaseDirectory` 来自必需参数 `--config`（`runLatestMainCli` 断言 `需要固定发布入口配置 --config`），仓库内无硬编码路径。
4. **全程没有任何保留或回收逻辑**——grep 过 `publish-latest-main.mjs`、`publish-main.mjs`，无删除、无计数上限、无 TTL。

## 2. 我昨天执行方案一的遗留（本轮发现，需一并处理）

删包时只删了目录，**没有注销对应的 git worktree 注册与分支**。实测：

| 项 | 数量 |
| --- | --- |
| 指向 `main-release-packages` 的 worktree 记录 | 77 |
| 其中目录已不存在（我删掉的） | **75** |
| 这 75 条全部带 `locked` | 75 |
| `codex/manual-main-*` 分支 | 79 |
| 两个保留包的记录 | 健康 |

**影响评估（实测）**：

- `git status` / `git log` / `git fetch` 均正常，日常操作不受影响；
- `git worktree prune --dry-run` **无输出**——因为带 `lock`，自动清理不会回收它们；
- 风险是 `.git/worktrees/` 下累积 75 份失效元数据，以及 79 个无用分支，属卫生问题而非故障。

**这是我的疏漏**：方案一只考虑了磁盘目录，没考虑这些包是 git worktree。清理需 `git worktree unlock` 再 `prune`，以及删除对应分支——属额外动作，**未执行，等授权**。

## 3. 保留策略可行性

### 可行，但不建议改 `publish-latest-main.mjs`

该文件是发布链入口，改它要动 `--config` 契约与 worktree 生命周期，且它与 `publish-main.mjs`、`frozen-main-source.mjs`、`release-scope-plan.mjs` 相互断言（如 `:84` 的 `Frozen packet changed`、`:99` 的依赖目录校验）。在发布工具里加删除逻辑，风险远高于收益。

### 候选 A：独立保留脚本（推荐）

新增一个与发布链解耦的只读+清理工具，按本轮验证过的口径运行：

- **保留**：`app/deployment.json` 与 `app.previous/deployment.json` 两个 `sourceRoot`（执行时现查，不用静态清单）；外加最近 N 个（建议 N=5）作为缓冲。
- **动作**：`git worktree unlock` → 删目录 → `git worktree prune` → 删 `codex/manual-main-<name>` 分支。四步齐全，避免我昨天那种半清理。
- **优点**：不碰发布链；可先 `--dry-run`；顺带解决第 2 节的遗留。
- **工作量**：小。需补测试（保留集口径、拒绝删保护项、分支与 worktree 同步注销）。

### 候选 B：只在发布成功后追加一次清理调用

在发布成功路径末尾调用候选 A 的脚本。

- 优点：自动化，不再累积。
- 缺点：发布链里多一个可能失败的步骤；参照 release 保留清理的教训（挂在备份成功之后，备份一坏清理就再也不跑），**不建议把回收挂在发布成功这一条件上**。
- 若采用，须像 `releaseRetention` 那样独立返回状态、不把清理失败报成发布失败。

### 候选 C：不加策略，定期人工执行候选 A

- 优点：零机制风险。
- 缺点：依赖人记得。按实测生成速率（10-17 一天 17 个、高峰约 2.5 GB/天），**约两周会再积起 10 GB 量级**。

## 4. 建议

**候选 A，并把第 2 节的遗留一起清掉。** 先做 `--dry-run` 给你看清单再执行。

不建议候选 B——把回收挂在发布成功上，正是 release 保留清理今天收不回 33.77 GB 的同一个结构性错误。

另外**不需要**做「纯文档提交不建包」：第 0 节已证明该前提不成立，范围判定本来就正确。真要省，可做的是把 `:85-88` 的建目录/worktree **挪到 `:93` 范围判定之后**，让 `non-production` 不留 worktree——但那是改发布链入口，收益（每次省一个 junction 式 worktree，不含依赖实体）远小于风险，**不建议动**。

## 5. 待你决定

1. 采用候选 A（独立保留脚本 + 清掉 75 条失效 worktree 与 79 个分支）、B 还是 C；
2. 保留缓冲 N 取几（建议 5）；
3. 是否同意不改 `publish-latest-main.mjs`。
