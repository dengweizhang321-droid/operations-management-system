# C 项发布侧 ROI 结算（2026-10-27）

- 性质：**ROI 结算结论 + 削减方案评估**，基于第一次真实产出的 `apply-timing.json`
- 结论：**发布侧经评估不可削**（与准备侧同结论，但这次有实数支撑）
- 对应单：S16（观测）已完成、S17（ROI 结算）本文结清、S18（汇总收尾）解除阻塞
- 本文未改任何代码、未发布

## 一、数据来源：通道终于通了

C 项第三步的落点修复（`18c25a3a`）于 2026-10-27 上线，release `20261027T131435Z-b1714d1611033bc6`，**首次产出 `apply-timing.json`**。

回执位置：
```
D:\codex-isolated\main-release-packages\18c25a3a153e-4a9cb3f5-b05895d2\publish-18c25a3a153e\apply-timing.json
```

`unexpectedLineCount = 0` —— 拦截窗口干净，没有准备侧计时键混入，证明 (b2) 落点选择正确（(c) 方案那个「窗口不洁净」的否决理由在实数上得到印证）。

## 二、发布侧 180.4 秒的去向（14 个阶段）

| 阶段 | 耗时 | 占比 |
| --- | --- | --- |
| `apply.candidate-stopped#1` | 79882 ms | **44.3%** |
| `apply.head-stopped#1` | 37243 ms | **20.6%** |
| `apply.install-startup` | 13029 ms | 7.2% |
| `apply.head-stopped#2` | 12622 ms | 7.0% |
| `apply.candidate-stopped#2` | 12301 ms | 6.8% |
| `apply.candidate-stopped#3` | 12144 ms | 6.7% |
| `apply.validate#1` | 4431 ms | 2.5% |
| `apply.validate#2` | 4411 ms | 2.4% |
| `apply.chain-resolve` | 4315 ms | 2.4% |
| `apply.install-entrypoints` | 21 ms | 0.0% |
| `apply.verify-guards` | 15 ms | 0.0% |
| `apply.publish-successor` | 14 ms | 0.0% |
| `apply.publish-consumption` | 9 ms | 0.0% |
| `apply.d1-receipt` | 1 ms | 0.0% |

与此前两次实测的 202 秒 / 213 秒同量级。

### 关键发现：时间不花在「等进程停止」，而花在全树哈希

`apply.*-stopped` 的名字是「停稳核验」，不是「等待停止」。

- `tools/worker-local-release-rotation.mjs:1060` 的 `assertStoppedForCandidate` 调完整的 `verifyWorkerRelease({processPolicy:'stopped'})`
- 其中 `tools/worker-local-release.mjs:3035` 的 `validateTree(releaseRoot/node_modules, manifest.build.nodeModulesTree)` **重算 node_modules 全树哈希**
- `node_modules` 实测 **31420 个文件**，本机磁盘 6–11 MB/s、IOPS 受限

**六次停稳核验合计 154.2 秒，占 85.4%。** 真正的安装、CAS 校验、入口写入、守卫复验加起来不到 18 秒。

## 三、削减方案评估：技术上可行，但 ROI 不成立

### 可削部分（技术判断成立）

`head-stopped#2`、`candidate-stopped#2`、`candidate-stopped#3` 三次合计 **37.0 秒**，技术上确可删除。

**两条独立证据**：

1. **锁连续性**（间接证据）：`serviceLock` 在 `:1499` 获取，`applyApprovedRotationPlanCore`（1394–1459）内**零次** `serviceLock = null`；唯一释放发生在 `installAndVerifyStartup` 回调（`:1515-1516`），而该回调在 `apply.install-startup`（`:1442`）才调用——晚于全部三次待削核验。对照：准备侧 `:1155` 有显式释放锁，这正是准备侧 609 秒**不可削**的原因（锁释放期间别的进程能改 worker 状态，三次校验是重新取证）。
2. **目录物理互斥**（直接证据）：`installProtectedEntrypoints`（`:891-919`）只写 `candidateManifest.manifest.runtime.protectedSourceRoot`，只读不写 `candidateRoot`；而 `assertStoppedForCandidate` 走 `verifyWorkerReleaseInternal`，其 `validateGuardReceipt` 默认 `verifyInstalledEntrypoints=false`（签名见 `worker-local-release.mjs:2734`），**根本不检查 `protectedSourceRoot`**，只校验 `releaseRoot` 下的 `source-snapshot`/`dist`/`node_modules`/`helper`。两个目录零重叠。

所以即便锁协议被绕过，结论仍成立。`candidate-stopped#3` 不是「对入口安装结果的重新取证」——那条校验链压根不看那个目录。

另：`head-stopped` 校验 `chain.headManifestPath`（前驱 release），`candidate-stopped` 校验 candidate release，两者本不是同一棵树，不能互相替代；可削的是**各自内部的重复次数**。

### 但 ROI 不成立

```
停站总时长    1091 秒 ≈ 18.2 分钟
削 37 秒后    1054 秒 ≈ 17.6 分钟
实际缩短      3.4%
```

37 秒占 apply 段 21%，但放到真实停站只有 **3.4%**。

**代价清单**：

| 项 | 内容 |
| --- | --- |
| 改字节钉死的文件 | `worker-local-release-rotation.mjs` 被 `preparation-producer-qualification.mjs` 三代闭包按字节钉死，必须追加第四代（且保留旧代际，否则本次改动的回退会被自己的资格条目阻断） |
| 字节绊线 ×2 | `tests/preparation-resolution.test.mjs:40-71`（追加第四代、`.size` 3→4、tripwire、三处遍历列表）；`tests/release-optimization-boundaries.test.mjs:141`（包装点数 **30→27**，apply 侧 15→12） |
| **隐蔽陷阱** | 见下 |
| 防御纵深变薄 | 见下 |

### ⚠ 隐蔽陷阱：闭包不同步不会在发布时立刻暴露

原先以为「只改 rotation 不追加闭包」会在发布时被 `maintenanceReadiness` 拒绝。**这个判断是错的**：

- `maintenanceReadiness`（`tools/manual-maintenance-continuation.mjs:147`）管的是 django/pi 维护资格，**与 producer 闭包无关**
- 真正的拒绝点在 `tools/preparation-resolution.mjs:144` 与 `:273`：
  ```js
  assert.ok(producerQualification.closures.some(c=>canonical(c)===canonical(p.producerFiles)),
            'Unqualified preparation producer code');
  ```
- 这两处由 `cleaned-preparation-writer.mjs:28` / `cleaned-preparation-observer.mjs:17` 调用，属**队列异常恢复回路**，**正常顺利发布一次都不会触发**

所以失败形态是：窄门禁放行 → 发布成功 → 风平浪静 → 某次准备异常终止、队列进清理回路 → 这时才炸 `Unqualified preparation producer code`。**比「立刻被拒」麻烦得多**——那时正在处理一次异常，却撞上一个无关的资格错误。

### 削掉后失去什么（不是免费削减）

那三次重复校验在正常路径下信息量为零，但作为**深度防御**捕获三类场景：

1. 将来有人往 1394–1459 之间插入写操作，而不知道这里有「禁止写」的隐含契约
2. 文件系统层面的损坏（与锁无关，概率极低但非零）
3. **某个同 Windows 用户权限、不遵守那把具名 mutex 的外部进程写了 candidate 目录** —— `acquireWorkerServiceMutex` 只约束遵守该协议的代码，**不是文件系统级 ACL**

删掉后，这三类从「发布时立即拦截」退化为「启动服务前才可能被发现」。`apply.verify-guards` 与 startup 校验仍在，所以不是从有保护到无保护，但纵深确实变薄。

### 样本充分性：不够

180.4 秒是**单次观测**。`#1` 的 79.9 秒对 `#2`/`#3` 的 12 秒差近 7 倍，明显是冷缓存。仅一次样本无法排除机器负载、磁盘碎片、AV 扫描对「12 秒」这个基线本身的影响。

这不影响**正确性判断**（1394–1459 无写操作是从代码路径推出的，不依赖样本数），只影响**值不值得做**。

## 四、结论：发布侧不可削

**S17 结算：发布侧经评估不可削**，与准备侧同结论。

但两者的「不可削」理由不同：

| | 不可削的原因 |
| --- | --- |
| 准备侧 609 秒 | 锁释放期间状态可变，三次校验是**重新取证**而非重复取证，缓存会掩盖它本要防的东西 |
| 发布侧 37 秒 | 技术上**可削**，但只值 3.4% 停站，而代价是改钉死文件、两处绊线、一个隐蔽陷阱、削薄一层防御 |

## 五、数据指出的真正瓶颈

`candidate-stopped#1` 的 79.9 秒（占 apply 的 44.3%）才是发布侧大头，而它是**首次全树哈希的冷缓存代价**——与准备侧 609 秒**同源**。

两处合起来说明同一件事：**瓶颈是 31420 个文件的全树哈希在 6–11 MB/s、IOPS 受限的磁盘上重算。**

BOARD.md 此前记的那两条非「削减」路径，现在有了发布侧的数据支撑：

| 路径 | 预期效果 | 风险 |
| --- | --- | --- |
| **换 NVMe** | `#1` 的 80 秒与那几个 12 秒等比缩短，收益比削 37 秒大一个量级 | **零代码风险** |
| 缩小 release 本体 | 直接减少被哈希的文件数 | 发布架构改动，风险高 |

**推荐优先评估换硬件。** 它同时作用于准备侧 609 秒和发布侧 154 秒，且不需要动任何被钉死的字节、不触发任何门禁、不削薄任何防御。

## 六、后续建议

1. **本轮不改 `rotation.mjs`**，让后续 2–3 次发布自然积累 `apply-timing.json`（通道已通），确认 `#2`/`#3` 稳定在十几秒区间。
2. 若将来仍要削那 37 秒，按本文第三节的代价清单执行，**必须同步追加第四代闭包**，否则会埋下第三节那个隐蔽陷阱。
3. 该改动**不能与 C 项第三步的 `applyTimingReceiptOnly` 差异集合批**——两个窄 flag 成员集合不同，混批两边都不命中。两次闭包追加也必须串行（`closures` 数组末尾追加会互相冲突）。
4. S18 汇总可以开始：S16 观测已交付、S17 本文结清、发布侧与准备侧均有实数支撑的不可削结论。

## 七、本次纠正的判断错误

| 错误 | 纠正 |
| --- | --- |
| 「这次发布拿不到 `apply-timing.json`」 | **产出了**。错在把控制包里脚本的字节当成执行时字节，而执行器从**冻结源码**取当次目标提交的字节（规划第十节已写明，读过未用上） |
| 「闭包不同步会在 `maintenanceReadiness` 被拒」 | 拒绝点在 `preparation-resolution.mjs:144/273`，且在**异常恢复回路**而非正常发布路径 |
| 「`candidate-stopped#3` 可能是对入口安装的重新取证」 | 不是。该校验链不检查 `protectedSourceRoot`，两个目录物理互斥 |
| 削减论证只有「同一把锁内」 | 那是间接证据；补上「目录物理互斥」的直接证据后，结论不依赖锁协议被遵守 |

## 变更记录

2026-10-27：建立。基于首次产出的 `apply-timing.json` 结清 S17 发布侧 ROI，结论为不可削；指出真正瓶颈为全树哈希的磁盘 IO，推荐优先评估换 NVMe。未改代码、未发布。
