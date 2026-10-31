# `.wrangler/state` 17 GB 迁移方案（审查 #1）

- 日期：2026-10-28
- 性质：**方案待定，未执行任何动作**
- 授权要求：按 `AGENTS.md` 规则 6，生产数据迁移须用户授权；本方案须停服务执行

## 一、先更正审查报告对这项的定性

报告写「生产图片和附件（8.3 GB）、生产密钥都放在开发 git 目录」，把它归为阶段 0「止血」。**实测后要更正两点**：

| 报告 | 实测 |
| --- | --- |
| 8.3 GB | **17 GB**（10-28 实测，三天翻倍） |
| 「开发 git 目录」 | 不是开发缓存，是**生产数据的实际存储位置**，且被运行时 manifest 哈希钉死 |

### 17 GB 的真实构成

```
D:\运营管理系统\.wrangler\state\v3\
  d1\       9.0 GB    本地 D1 数据库
  r2\       7.9 GB    工作流附件与商品图片
  cache\    48K
  images\   48K
  v3\       104K
  do\       0
  workflows\ 0
```

### 两半都是活数据，一点都不能删

**`r2/` 7.9 GB** —— 四个使用方全部可从生产路由到达：

| 文件 | 被 `app/api` 或 `worker` 引用 |
| --- | --- |
| `worker/index.ts` | 6 处 |
| `lib/workflow/attachment-storage.ts` | 2 处 |
| `lib/market/django-image-cache-runner.ts` | 1 处 |
| `lib/workflow/collaboration.ts` | 1 处 |

**`d1/` 9.0 GB** —— 12 个使用方中 **9 个可从生产路由到达**：

```
lib/settings/service.ts          106 处   ← 系统设置，引用量最大
lib/finance/database.ts            5 处
lib/inventory/database.ts          5 处
lib/market/database.ts             5 处
lib/erp-reference/database.ts      5 处
lib/netshop/database.ts            5 处
lib/workflow/tasks.ts              7 处
lib/workflow/schema.ts             4 处
lib/workflow/collaboration.ts      1 处
```

仓库里虽有 `tests/d1-retirement-proof.test.ts` 等退役证明测试，但 `lib/settings/service.ts` 那 106 处引用说明 **D1 仍在承载系统设置**，不是空壳。另据既有记录：D1 的 finance 域含 40233 行财务数据且缺退役回执。

**所以这项是「迁移」而非「清理」。**

## 二、真实风险（比报告描述的更高）

`.gitignore:45,54` 确认 `.wrangler` 与 `.dev.vars` 均被忽略。**这恰恰是危险所在**：

| 风险 | 后果 |
| --- | --- |
| `git clean -xdf` | **直接删光**——被 gitignore 的目录正是 clean 的目标 |
| 磁盘故障 | 工作流附件、商品图、系统设置全丢 |
| 误操作仓库目录 | 同上 |
| 备份未覆盖 | 以上任一发生即不可恢复 |

叠加「体积每日增长」（8.3 → 17 GB / 三天），**风险随时间恶化**。

## 三、迁移的真正难点：路径被哈希钉死

这不是「移动目录 + 改配置」那么简单。生产 manifest（`deployment-manifest.json`）里有两个路径哈希：

```
persistRoot            D:\运营管理系统\.wrangler\state
persistRootPathSha256  707232242c7126c9190e3f2641c1cbd99a3443a967d93e9a4e97259279c6d116

sourceD1Path           D:\运营管理系统\.wrangler\state\v3\d1\miniflare-D1DatabaseObject\faaf2b0445a…
sourceD1PathSha256     f0d4996d3d9ee2768996b95271957fb3ccd744657cfcc59269811f9267057ec5
```

哈希是对**路径字符串**算的（`tools/worker-local-release.mjs:1693/1985/2171` 的 `windowsPathSha256(persistRoot)`），且参与发布校验（`:60/:66/:88/:121` 的 proof 字段）。

**后果**：改路径 → 两个哈希都变 → 现有 release 的 manifest 与新路径不匹配 → 发布校验失败。

`persistRoot` 由 `--persist-to` 传入（`tools/worker-local-release.mjs:2222/2975`），`tools/start-local-worker.mjs:48` 另有环境变量 `TERUISI_LOCAL_WRANGLER_STATE_DIR` 可覆盖（仅本地开发入口）。

## 四、三个方案

### 方案 A：目录联结（junction）—— 推荐

把数据物理移到新位置，原路径留一个 Windows 目录联结指向它。

```
D:\teruisi-runtime\worker-state\        ← 数据实际所在
D:\运营管理系统\.wrangler\state         ← junction，指向上面
```

| | |
| --- | --- |
| **路径哈希** | **不变**（manifest 里的字符串仍是原路径），无需改任何发布配置 |
| 停机 | 需要（移动 17 GB 期间服务须停） |
| 风险 | 低。junction 对应用透明；失败可直接把数据移回 |
| 解决「git clean 删光」 | **是**——clean 只会删掉那个 junction（一个目录项），不碰真实数据 |
| 解决「备份未覆盖」 | 是——新位置纳入每日备份 |
| 遗留 | 仍有一个指针在仓库目录里；但数据本体已不在 |

**这是唯一不触碰路径哈希的方案**，因此风险最低。

### 方案 B：真迁移 + 改配置 + 重算哈希

把路径真正改成 `D:\teruisi-runtime\worker-state`，同步更新所有引用与 manifest 哈希。

| | |
| --- | --- |
| 路径哈希 | **全部要重算**，并更新现有 release 的 manifest 或重新发布 |
| 停机 | 需要 |
| 风险 | **高**。要改 `--persist-to` 的传入点、重算 `persistRootPathSha256` 与 `sourceD1PathSha256`、核对发布校验的 proof 链；任一处漏改即发布失败或启动失败 |
| 收益 | 彻底，仓库目录下不再有任何残留 |

**不建议现在做**——收益相对 A 只是「少一个 junction」，代价是动发布校验链。

### 方案 C：只做备份覆盖，不迁移

把 `.wrangler/state` 纳入每日备份并镜像到第二块盘，位置不动。

| | |
| --- | --- |
| 停机 | 不需要 |
| 风险 | 极低 |
| 解决「备份未覆盖」 | 是 |
| 解决「git clean 删光」 | **否** —— 风险仍在，只是可恢复 |
| 17 GB 备份成本 | 每日全量不现实，须增量/快照方案 |

**可作为 A 的前置步骤**：先让数据有备份，再从容做迁移。

## 五、建议执行顺序

1. **先做 C 的备份部分**（不停机、零风险）：把 `.wrangler/state` 纳入备份并验证可恢复。这一步让后续任何操作都有退路。
2. **再做 A**（停机，约需 17 GB 的移动时间 + junction 创建）：
   - 停服务
   - `robocopy` 移动到 `D:\teruisi-runtime\worker-state\`（带校验）
   - 核对两端文件数与总字节一致
   - 删原目录、建 junction（`mklink /J`）
   - 启服务、验证 R2 附件可读、D1 设置可读
   - 失败则删 junction、把数据移回
3. **B 不做**，除非将来有独立理由要彻底消除 junction。

### 需要先确认的事（执行前）

- `D:\teruisi-runtime` 所在卷的剩余空间 ≥ 17 GB
- 第二块盘的可用性与容量（镜像用）
- 服务停机窗口（迁移 17 GB 按本机 6–11 MB/s 估算约 25–45 分钟，比发布停站长）
- 备份方案对 17 GB 的可行性（全量 vs 增量）

**以上四项本方案均未核实**，须在执行前查明。

## 六、不在本方案内的

- `.dev.vars`（2402 字节，生产密钥）同样被 gitignore 且在仓库目录内。它体积极小，可单独处理，但**密钥迁移涉及运行时读取路径**，须单独核。
- D1 是否真能退役（9 GB 中有多少是可归档历史）—— 这是独立议题，须先核 PG 侧数据完整性，不在迁移方案内。迁移不改变 D1 的存废。

## 变更记录

2026-10-28：建立。更正审查报告对本项的定性（非开发缓存而是生产数据、8.3→17 GB）；查明路径被 manifest 哈希钉死这一迁移难点；给出三方案并推荐「先备份、再 junction」。未执行任何动作。
