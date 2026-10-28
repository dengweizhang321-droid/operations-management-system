# docs 证据归档：1892 个非 Markdown 文件移出仓库（2026-10-28）

- 分支：`codex/docs-evidence-archive-20261028`，基线 `main` = `72d07ad7`
- 来源：2026-10-24 系统审查第 23 项（约 3.9 万行不可达旧代码、docs 5024 个文件 / 72 MB）
- 状态：**改动完成、必需检查通过；未合并、未推送**（AGENTS.md 规则 4）
- 性质：**只移动文件物理位置**，不改动任何文件内容与字节

## 一、结果

| 项 | 数值 |
| --- | --- |
| 归档文件数 | **1892** |
| 归档总字节 | 25,438,034（约 24.26 MB） |
| 归档根路径 | `D:/codex-artifacts/docs-archive-20261027/`，保持原目录结构 |
| 候选任务目录 | 42 个（2026-10-12 及更早） |
| 其中有归档内容 | 31 个，各附 `证据已归档.md` |
| 零候选目录 | 11 个，**不建**归档说明 |
| 总索引 | `docs/证据归档索引-20261028.md` |
| 最终排除清单 | **36 项**（原 23 + 本次新增 13） |

数字自洽：归档目录下实测 1892 个文件 = `git status` 的 1892 条删除记录。

## 二、修正了一个会造成悬空引用的清单错误，并发现同类问题远不止一处

上一轮产出的可归档清单**有错**：`tools/create-startup-repair-fence.mjs` 与 `tools/retract-startup-repair-fence.mjs` 用 `path.join(own, ...)`（`own` = `tools/`）引用三个兄弟文件，而这三个文件**从未迁到 `tools/`**，只存在于 `docs/startup-status-receipt-safety-20261012/`。三个里只有一个被排除，另两个在清单第 1657、1798 行、会被移走。

按原清单执行，这两个脚本的引用会从「指向 docs/」变成「指向不存在的位置」。

### 执行时自行扫描，又发现两组同构 bug 与一类不同机制风险

扫描方法：取可归档清单中 362 个代码类扩展名（`.mjs`/`.ps1`/`.psm1`/`.cjs`/`.js`/`.py`）文件的 basename，在 `tools/`、`tests/`、`backend/`、`app/`、`lib/`、`worker/` 下搜这些 basename 的字面量，得 18 处交叉命中，逐一核实机制。

| 组 | 引用点 | 被按文件名引用、却只存在于 docs/ 的文件 |
| --- | --- | --- |
| 1（已点名） | `create-/retract-startup-repair-fence.mjs` | `Read-RepairFenceActorAcl.ps1`、`fence-original-bootstrap.mjs` |
| 2（新发现） | `tools/census-approval-contract.mjs:5` | `Read-CensusTask.ps1`、`prepare-census-intent.mjs`、`run-census-install.mjs` |
| 3（新发现） | `tools/continuation-context.mjs:22` | `Restore-RecoverySupervisorV3.ps1`、`run-continuation.mjs`、`prepare-continuation-package.mjs`、`prepare-continuation-transport.mjs` |
| 4（不同机制） | `tests/natural-resource-change.test.mjs` | 用 `new URL(n, dir)` **直接读证据目录下的源码文本**做字符串比对：`bounded-two-natural-v2.mjs`、`run-final-closeout-v2.mjs`、`run-final-closeout.mjs`、`run-natural-only-v2.mjs` |

第 2、3 组是同一个历史成因：**脚本本体迁到了 `tools/`，但它 own-join 引用的兄弟文件留在原 docs 任务目录，从未真正迁移**。第 4 组不是 own-join，是测试直接读取证据目录里的源码，属另一类风险。

### 追加排除的 13 项

```
docs/startup-status-receipt-safety-20261012/Read-RepairFenceActorAcl.ps1
docs/startup-status-receipt-safety-20261012/fence-original-bootstrap.mjs
docs/watchdog-native-census-20261012/Read-CensusTask.ps1
docs/watchdog-native-census-20261012/prepare-census-intent.mjs
docs/watchdog-native-census-20261012/run-census-install.mjs
docs/startup-recovery-continuation-20261012/Restore-RecoverySupervisorV3.ps1
docs/startup-recovery-continuation-20261012/run-continuation.mjs
docs/startup-recovery-continuation-20261012/prepare-continuation-package.mjs
docs/startup-recovery-continuation-20261012/prepare-continuation-transport.mjs
docs/release-final-closeout-20261012/bounded-two-natural-v2.mjs
docs/release-final-closeout-20261012/run-final-closeout-v2.mjs
docs/release-final-closeout-20261012/run-final-closeout.mjs
docs/release-final-closeout-20261012/run-natural-only-v2.mjs
```

排除清单 23 → 36 行，可归档清单 1905 → 1892（精确 −13，无重复）。三组受影响目录归档后剩余文件数均未归零：`startup-status-receipt-safety-20261012` 159→157、`watchdog-native-census-20261012` 47→44、`startup-recovery-continuation-20261012` 143→139。

### 核实后判定安全、未排除的用法

- `evidence/repair-fence-pair/DRAFT_V1-Read-RepairFenceActorAcl.ps1`：只被 `MANIFEST.json`（历史哈希清单，本身也在归档范围）提及，**无执行代码读取**，判定可归档；
- `tools/continuation-transport.mjs`、`tools/recovery-transport.mjs` 的 `path.basename(f.path)===...`：`f.path` 来自 JSON 计划里已写好的绝对路径，不是按 own 拼接重建；
- `tools/capture-fixed-startup-metadata.mjs`：硬编码路径指向另一个不同名历史 worktree，与本次无关；
- `tools/performance/runtime-risk-evidence-snapshot.mjs`：只写出同名新文件，不读清单内文件；
- `tests/lint-evidence-scope.test.ts`：用归档文件路径作 `eslint.lintText()` 的**虚拟 filePath**，ESLint 只用它匹配 config 的 `files` glob，**不读磁盘**。该测试本身的用例名就写着「the one archived Node diagnostic exemption」，是为归档后状态写的，归档不影响它（实测 2 通过）。

## 三、执行方式

1. **建干净基线 worktree 对照**：`git worktree add --detach … 72d07ad7`，用于移动前后比对；
2. 1892 个文件按 190 个一批分 10 批（末批 182），每批严格 **复制 → 逐文件 sha256 + 字节数校验 → 确认 0 失败 → `git rm`**，**绝不先删后复制**；
3. 批次间停顿 15–25 秒，避开同期两个并行代理（`backend/`、`lib/market` + `tests/`）的磁盘争用。本机磁盘 6–11 MB/s、IOPS 受限，上轮曾因并行过载让 n8n 报 `Database is not ready!`；
4. 归档后复核：1892 个文件已全部不在工作区（`still_present=0`），归档根下恰好 1892 个文件；
5. 31 个有归档内容的目录各写 `证据已归档.md`（归档数、字节、根路径、日期、取回方法）；
6. **未改动**任何 JSON、原始日志、截图、测试夹具中的历史路径内容（`docs/规范/文档管理.md` 第 3 条要求）——只移动物理位置。

工作区最终只有删除与新增，**无任何文件被修改**（`git status` 无 `M` 条目）。

## 四、验证

### 4.1 数据未丢失

随机抽 6 个已归档文件，把归档副本与干净基线 `72d07ad7` 的 git blob 逐字节比对：

```
OK  36d06ade…  docs/release-first-adoption-targeted-20261011/review/independent/fresh-entry-v2-literal-check.mjs
OK  bc17fbd8…  docs/release-site-blockers-20261011/evidence/LIVE_REFERENCE_READONLY_QUALIFICATION_V3.json
OK  30730a8c…  docs/performance-experience-audit-20261008/evidence/balanced-page-geometry.json
OK  c32d5d5e…  docs/startup-status-receipt-safety-20261012/evidence/ASTRA_SECOND_TEST.log
OK  b3785a7a…  docs/release-final-closeout-20261012/evidence/final-closeout-v2--TRANSPORT_FINISHED.json
OK  e3b0c442…  docs/antigravity-release-audit-20261010/AGY_STDERR.log
```

**6/6 字节一致。**

### 4.2 必需检查

| 检查 | 结果 |
| --- | --- |
| `npm run build` | **通过**，exit 0 |
| lint 基线门禁 | **通过**，56 errors / **119** warnings（基线 56 errors）。warnings 由 171 降至 119 是文件变少的正常结果，errors 持平 |
| `check:backend-boundary` | 通过，violations 为空 |
| `check:pi152-acl` | 通过，27 checks |

### 4.3 悬空引用专项

| 测试 | 结果 |
| --- | --- |
| `tests/natural-resource-change.test.mjs`（第 4 组的关键目标） | **4 通过 0 失败**，确认追加排除生效、不再 ENOENT |
| `tests/repair-fence-retraction.test.mjs` + `census-install-contract.test.mjs` | **12 通过 0 失败** |
| `tests/lint-evidence-scope.test.ts` | 2 通过 0 失败 |

**既有失败（与基线逐字一致，非本次引入）**：

- `recovery-continuation` 系列 15 用例中 1 失败 —— `E:` 盘固定包 pins 对不上，既有问题；
- `startup-exact-instance-stop.test.mjs` 的「Pinned library drift」6 个失败 —— 本机 PowerShell/pwsh 版本漂移，既有环境问题；
- `census-output-root.test.mjs`、`natural-only-continuation.test.mjs` —— 死 worktree 路径，既有问题（用户已决定保留不动）。

**结论：未发现因本次归档新引入的测试失败。**

## 五、附带发现（未处理）

`eslint.config.mjs:60` 有一条 `files: ["docs/startup-recovery-continuation-20261012/diagnose-exact-display.mjs"]` 覆盖规则，该文件已被归档，归档后匹配不到任何现存文件，**变成死配置**。

ESLint 对不存在的 `files` 覆盖项不报错，lint 基线门禁实测通过，所以**不影响任何检查结果**，只是该规则不再对任何文件生效。**本次未改** `eslint.config.mjs`——清理它超出「只移动证据文件」的范围，留作独立决定。

## 六、环境说明

本 worktree 原缺 `node_modules`（worktree 不共享主工作区的依赖安装）。为避免额外磁盘 IO，`node_modules` 以**目录链接**指向主工作区（已确认两处 `package.json`/`package-lock.json` 内容一致）。这是链接不是复制，不占 IO 预算，未写入主工作区，git 不跟踪。

## 变更记录

2026-10-28：建立。归档 1892 个文件；修正上一轮清单中会造成悬空引用的 2 项，并新发现 11 项同类风险一并排除。
