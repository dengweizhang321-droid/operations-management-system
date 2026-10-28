# xlsx 原型污染（CVE-2023-30533）postinstall 补丁（2026-10-28）

- 分支：`codex/xlsx-prototype-pollution-patch-20261028`
- 基线：建于 `fd90e1aa`，已变基到 `main` = `837c9f39`
- 来源：2026-10-24 系统审查「阶段 0 止血」第 22 项（xlsx 漏洞版本）
- 状态：**改动完成、必需代码检查通过，未提交前已自测；未合并、未推送、未准备制品、未发布**（AGENTS.md 规则 4）
- 范围：只修 CVE-2023-30533（原型污染）。CVE-2024-22363（ReDoS）按既定决定**接受风险，未碰**

## 一、改动内容

| 文件 | 性质 | 说明 |
| --- | --- | --- |
| `tools/install-xlsx-prototype-patch.mjs` | 新增 | 哈希锁定的 postinstall 补丁器 |
| `tests/xlsx-prototype-patch.test.ts` | 新增 | 6 个测试，含真实 OOXML 攻击包 PoC |
| `package.json` | 改 1 行 | postinstall 串接新补丁器 |
| `.github/workflows/ci-unit-test-files.txt` | 改 | 新测试加入 CI 白名单 |

照既有先例 `tools/install-workerd-heap-patch.mjs` 写（同为 `package.json` postinstall 的依赖补丁器）。

## 二、漏洞机理（实测确认，非引用报告）

`node_modules/xlsx/xlsx.js:11646` 的 `sheet_insert_comments()`：

```js
comments.forEach(function(comment) {
    var r = decode_cell(comment.ref);     // "__proto__" → {c:-1, r:-1}
    if(dense) { ... } else cell = sheet[comment.ref];   // sheet["__proto__"] → Object.prototype 本体
    if (!cell) { ... }                    // 本体是真值，走"已存在"分支
    if (!cell.c) cell.c = [];             // ← 污染 Object.prototype.c
```

`decode_cell()` 只累加大写字母与数字，对全小写 ref 返回负坐标；代码未检查负值。官方 0.19.3 的修法是在 `decode_cell()` 后加一行早返回守卫，本补丁就是反向移植这一行。

**守卫语义已核**：该 `return` 位于 `comments.forEach()` 的回调内，所以只跳过这一条恶意批注，**不中止其余批注的解析**，不改变正常文件的行为。

## 三、可达性（本次新查明，交接文档未覆盖）

**批注解析无开关，默认必走。** `xlsx.js:23078` 的调用点只按 sheet 关系类型 `RELS.CMNT` 判断，**没有任何 `opts` 条件**：

```js
if(sheetRels[sheet][n].Type == RELS.CMNT) {
    var comments = parse_cmnt(getzipdata(zip, dfile, true), dfile, opts);
    if(!comments || !comments.length) return;
    sheet_insert_comments(_ws, comments, false);
}
```

实测仓库 9 个 `XLSX.read` 调用点（finance/parser.ts、market/parser.ts、netshop/normalized-import.ts、inventory 四个 workbook、warehouse-mapping）**全都没传 `cellComments`/`bookDeps`**——这不构成防护，因为该路径本就不受这些选项控制。**结论：9 个入口全部可达该漏洞。**

## 四、验证

### 4.1 原始哈希来自官方 tarball，不是抄的

从 npm 缓存离线取出 `xlsx-0.18.5.tgz` 解包，对比补丁器里钉死的 `originalSha256`：

```
pristine package/xlsx.js    f3366db1313e47985ddd23c57989a35298ca613124f2971513fd0efca9e50df6
pristine package/xlsx.mjs   992eec8c1a888e7f6c9b2a3cbba014bedade473da4cbd8fc9bb95de56a87f222
```

两者与补丁器常量**逐字符相等**；tarball 的 integrity（`sha512-dmg3LCjBPHZnQ…`）与 `package-lock.json` 记录一致。锚点在两个文件中各命中 1 次（唯一性成立）。

### 4.2 测试有牙（关键验证）

一个"打了补丁就通过"的测试，若在未打补丁时也通过，则等于没测。做了反向对照：

| 环境 | xlsx 状态 | 结果 |
| --- | --- | --- |
| 分支 worktree | 已打补丁 | **6 通过 0 失败** |
| 主仓库 `D:\运营管理系统` | 未打补丁（pristine） | **3 通过 3 失败** |

未打补丁时的失败信息正是污染本身：

```
AssertionError: Object.prototype.c was set by a crafted __proto__ comment ref
                (CVE-2023-30533 regression)
AssertionError: xlsx.js is missing the CVE-2023-30533 guard line
```

**这同时证明了两件事**：漏洞在本项目的真实依赖树上确实可复现（不只是理论 CVE），且补丁确实是阻断它的原因。

PoC 不是桩：现场用 `fflate.zipSync` 组装了一个结构完整的 OOXML 包（`[Content_Types].xml`、两级 `_rels`、workbook、sheet、legacy comments part），批注 ref 为 `__proto__`，走真实 `XLSX.read()`。测试对 `Object.prototype.c` 做前置断言与 `finally` 清理，不会污染后续测试。

### 4.3 幂等与防误打

- 同一树上连跑两次：第二次全部报 `already_patched`，产物哈希与第一次相同
- 合成 0.18.5 树测试：先 `patched` 后 `already_patched`，再把版本改成 0.19.3 → 按预期拒绝（`locked 0.18.5`）
- 篡改输入 → 抛 `unknown dependency digest`，拒绝盲打
- 已打补丁的文件**反向还原后再比对原始哈希**，防止把来源不明的"看起来已打补丁"的文件当成合法状态

### 4.4 必需代码检查（AGENTS.md 规则 4 口径）

全部在变基后的分支上实跑：

| 检查 | 结果 |
| --- | --- |
| `npm run build`（含类型检查） | **通过**，exit 0 |
| lint 基线门禁 | **通过**，56 errors / 171 warnings＝基线，零回归 |
| CI 单测白名单（11 文件 53 测试） | **53 通过 0 失败** |
| `check:backend-boundary` | **通过**，exit 0 |
| `check:pi152-acl` | **通过**，exit 0 |
| 新增测试 `xlsx-prototype-patch` | **6 通过 0 失败**，两次计时 0.70s / 0.72s |

未执行业务功能验收（规则 4：功能是否正确由用户上线后判断）。

### 4.5 发布链会真正执行这个补丁

交接文档未核的一环，本次查明：

- `tools/worker-local-release.mjs:155`：`npmCiArguments = ["ci", "--ignore-scripts=false", …]` ——**显式开启** scripts，postinstall 在隔离构建根会运行
- `listGitSourceFiles()`（`:926`）的排除前缀为 `dist/ node_modules/ .git/ .runtime/ outputs/ tmp/`，**不含 `tools/`**，故新文件随 git 跟踪进入源快照
- 因此**无需**改 `workerReleaseBundledSourcePaths` 那份硬编码清单（它管的是另一类受控入口文件）

**未触碰**被 `preparation-producer-qualification.mjs` 三代闭包按字节钉死的三个文件（`worker-local-release-rotation.mjs`、`publish-prepared-main.mjs`、`worker-local-release.mjs`），不需要追加第四代闭包。

## 五、预期落差（须知悉）

`npm audit` **仍会报这两个 high**，因为它按 `package.json` 版本号匹配通告，不读实际代码：

- `xlsx <0.19.3` 原型污染 —— 代码已修，通告仍在
- `xlsx <0.20.2` ReDoS —— 按既定决定接受风险

本项目 CI **没有** `npm audit` 步骤（`.github/workflows/ci.yml` 实测零命中），所以这不会阻断 CI；只在手工跑 audit 时出现。

## 六、为什么不升级版本

| 路径 | 结论 |
| --- | --- |
| npm registry 升级 | registry `latest` 停在 0.18.5（SheetJS 0.19+ 转自有 CDN，不再发 npm） |
| CDN tarball URL | 发布链 `npm ci` 强制离线（`publish-main.mjs:67,116-119` 设 `npm_config_offline=true`），npm 缓存按 URL 做键，命中不到 |
| vendored tgz + `file:` | 同被离线缓存阻断；且 `worker-local-release.mjs` 打包清单硬编码、不含 vendor 目录 |
| 迁 exceljs | API 不兼容，牵动约 10 生产文件 + 25 测试 + 6 tools，属范围扩大 |

哈希锁定的 postinstall 补丁把依赖**留在已审阅过的 0.18.5 代码树**上，同时移除脆弱代码路径，是这四条里唯一不触碰发布链的办法。

## 七、后续

- 合并授权后：合并、推送、核验远端，报告最终提交
- 本次改动含 `package.json` 与 `tools/`（影响构建与安装），属有应用载荷变更，合并后仍需单独取得制品准备与发布授权
- `node_modules/` 不进版本库；补丁在每次 `npm install` / 发布链 `npm ci` 的 postinstall 阶段自动重新施加

## 八、postinstall 自动挂载已于 2026-10-29 回退，改为手动执行

**本节推翻第 15 行与第 140 行关于「自动重新施加」的描述。**

`package.json` 是 `workerGuardEntrypointPaths` 里的**受保护发布入口**，其 sha256 被已上线 release 的 guard 收据（`audit/legacy-worker-guard-receipt.json`）钉死。发布链在任何工作之前就校验「活仓库的受保护入口 == 已上线收据里的哈希」：

- `tools/worker-local-release-rotation.mjs:543` 的 `verifyInstalledGuardEntrypoints()` 做比较，`protectedSourceRoot` 即 `D:\运营管理系统` 本身（`worker-local-release.mjs:133` 写死）；
- `control/tools/publish-main.mjs:113` 在 `withRotationLock` 内第一步就 `resolveEffectiveReleaseChain({ verifyInstalledHead: true })`，且 `:126` 用 `prepareOnline: true`。

**两条路径（`准备main.bat --prepare-only` 与 `发布main.bat`）在这道门上行为完全相同**，均于步骤 1 失败、未触及停机：

| 时间 | 入口 | 结果 |
| --- | --- | --- |
| 2026-10-28 09:10 | `--prepare-only` | 失败，`requestId 9bdbbafe…` |
| 2026-10-28 11:49 | 停站发布 | 失败（38 秒），服务全程未停、生产 release 未变 |

这构成死锁：要发布须先一致，要一致须先发布。改动受保护入口需要一条尚未查明的专门流程（重签收据的工具、或带授权的控制层入口）；`docs/规范/验证与发布.md:81` 只规定了「先核受保护入口差异……不沿用旧收据」，未给出操作入口。

**因此回退 `package.json` 的 postinstall 串接**（仅该一行），回退后其 sha256 为 `c4c7f6a0422370d7…`，与 guard 收据**逐字节相等**。

### 现在怎么施加补丁

`tools/install-xlsx-prototype-patch.mjs` 与 `tests/xlsx-prototype-patch.test.ts` **全部保留**，补丁器本身未改、仍然有效（幂等、哈希锁定、反向还原校验齐备）。每次 `npm install` 之后手动执行一次：

```
node tools/install-xlsx-prototype-patch.mjs
```

2026-10-29 在主工作区实测：输出 `[{"file":"xlsx.js","status":"patched",...},{"file":"xlsx.mjs","status":"patched",...}]`，随后 `tests/xlsx-prototype-patch.test.ts` 6 通过 0 失败。

### 必须知悉的落差

**生产环境的 xlsx 不再被自动打补丁。** 发布链 `npm ci` 带 `--ignore-scripts=false`（`worker-local-release.mjs:155`）本会运行 postinstall，但串接已移除，所以**生产制品里的 xlsx 保持 0.18.5 原始状态，CVE-2023-30533 原型污染在生产仍然存在**。

风险边界（不是解除，是接受）：触发需要攻击者投递构造过的 xlsx 文件，而九个 `XLSX.read` 调用点均在 admin/operator 才能触达的导入路径上。

### 待办

恢复自动化需要先解决 guard 死锁。两个方向待查：是否存在 guard 收据的正规重签工具；或 `CONTROL-INSTALLATION.json` 那套控制层是否提供受保护入口变更的授权入口。查清前不要再尝试直接改 `package.json` 发布。
