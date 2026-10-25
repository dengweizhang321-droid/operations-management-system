# TERUISI 发布规则与迁移闭环门禁（`tools-no-migration-v1`）独立对抗性复审报告

> **审查方**：Antigravity 独立审查席  
> **审计对象**：相对基线 `ba656` 的最新 4 模块实现差异（`tools/release-batch-admission.mjs`、`tools/release-batch.mjs`、`tools/release-impact.mjs`、`tools/release-no-data-observation.mjs`）  
> **审查基线**：真实已闭环 AB（W chain 219 `aaf62994`，W manifest `f4e537`，Django `237fbe`，WAL 109 `5289`，旧引擎 `strictfalse / unknown` 保留；owner 确已 absent）  
> **审查约束**：纯文本阅读审查，无本地文件/Shell/生产工具调用，不重新访问未授权资源；**不宣称已实跑测试，不宣称生产已通过；不具备生产授权权力**。

---

## 一、 审查基线与授权边界核定（Invariants & Scope Ruling）

1. **授权状态与生产红线**：
   - 用户明确授权：开发修改、隔离环境测试、Git 提交与精确候选制品的准备；
   - **生产红线维持**：生产服务切换、维护窗口、备份恢复执行、调度外发及业务写入**绝对未获授权**；
2. **首次自举四阶段铁律（Strict Bootstrap Invariant）**：
   - 本次引入的新规则（包括 `tools-no-migration-v1` 与 `source-binding`）首次采用，**必须作为原引擎的 `strict / full` 批次执行**；
   - 必须完整执行 4 个原生物理数据库阶段（前置备份 → 前置恢复 → 后置备份 → 后置恢复），**绝无任何跳过或自我豁免**；
3. **前置审查结论继承**：
   - 第 9 轮已完成审查的 Worker `source-binding` 与 `rotation` 代码字节保持未变，本轮不作重复背书，重点聚焦新增的迁移闭环规约与准入时效强化。

---

## 二、 核心新增门禁对抗性攻击分析（Adversarial Attack Analysis）

针对新增的 `tools-no-migration-v1` 判定逻辑、CF 缓存比对与准入时钟机制，展开专项攻击推演：

```
                    ┌────────────────────────────────────────────────────────┐
                    │      tools-no-migration-v1 攻击防御推演拓扑            │
                    └────────────────────────────────────────────────────────┘
                                                 │
          ┌──────────────────────┬───────────────┴──────────────┬──────────────────────┐
          ▼                      ▼                              ▼                      ▼
  【攻击 1：伪造全量库存】 【攻击 2：夹带代码与迁移】    【攻击 3：恶意CF缓存篡改】 【攻击 4：试图豁免4阶段】
  manifest.appFingerprint 变动文件强断言仅限 2 个       严格递归比对 JSON 键结构   recovery.mode 强制要求
  与 live 实盘逐字节比对  工具模块, 任何 py/sql         仅限 6 个标量叶子变动,     full, 仅替换测试类别,
  无法绕过清单哈希绑定    变动直接触发数组失配拦截      禁止数组/对象注入          4 DB 阶段依然 100% 执行
```

### 1. 攻击推演一：伪造全量 Django 库存（Forged Application Inventory）
- **攻击路径**：攻击者试图伪造 `scopeValidation.before` 或 `scopeValidation.after` 的清单，隐瞒未审查的文件变动。
- **防御验证与拦截机理**：
  1. `verifyScopeApplication` 强制要求 `hash(proof.manifestRaw) === binding.djangoPredecessorSha256 / djangoCandidateSha256`，清单源码受发布绑定的强类型 SHA256 锁死；
  2. `applicationInventoryFingerprint` 遍历全量 2933 个文件的相对路径与哈希，计算 `appFingerprint: hash(rows.sort().join('\n'))`，必须与清单中的 `manifest.appFingerprint` 逐字节相等；
  3. 准入阶段通过 `verifyLiveToolsNoMigrationScope` 直接实盘读取 `djangoRoot` 下的真实文件（`beforeRoot` 与 `afterRoot`），计算实际磁盘哈希，并强断言 `canonical(observedDjango[side]) === canonical(scopeValidation[side])`。
- **裁决**：**离线伪造或篡改库存文件在密码学与实盘双重比对下被 100% 拒绝**。

### 2. 攻击推演二：夹带数据库迁移、模型或配置修改（Smuggled Migrations/Code）
- **攻击路径**：在候选 Django 中夹带未声明的 `drizzle/` SQL 文件、`backend/migrations/` 脚本，或篡改业务代码。
- **防御验证与拦截机理**：
  1. **文件增删零容忍**：
     `if(canonical(Object.keys(before).sort()) !== canonical(Object.keys(after).sort())) throw new Error('Django file additions/removals cannot qualify for migration closure');`
     任何新增或删除文件的行为直接熔断；
  2. **修改文件精确白名单**：
     `const changed = Object.keys(before).filter(name => before[name] !== after[name]).sort();`
     `if(canonical(changed) !== canonical([...djangoToolDelta, ...(cacheChanged ? [cfCachePath] : [])].sort())) throw new Error('Django application/dependency/migration/operator bytes changed outside the two reviewed tools');`
     变动文件被绝对锁死在 `['tools/worker-local-release.mjs', 'tools/worker-local-release-rotation.mjs']`（以及受控的 CF 缓存），任何对 Django 业务、配置、ORM、迁移脚本的微小改动都会使 `changed` 集合溢出并抛错；
  3. **工具源码一致性**：
     强制断言 Django 中的这两个工具模块必须等同于 Worker 候选中的对应文件（`after[name] === impactProof.inventory.after[name]`）。
- **裁决**：**任何形式的代码或迁移夹带均无法穿透该门禁**。

### 3. 攻击推演三：通过 `.wrangler/cache/cf.json` 实施恶意配置/代码注入
- **攻击路径**：利用 CF 缓存文件的变动许可，注入未知配置键、原型链污染或恶意字符串。
- **防御验证与拦截机理**：
  1. 结构完全冻结：递归比对 `beforeCf` 与 `afterCf`，强断言 `canonical(Object.keys(left).sort()) === canonical(Object.keys(right).sort())`，禁止新增、删除任何键；
  2. 叶子节点白名单：受影响字段被白名单 `cfChangedPaths` 严格限制在 6 个标量叶子（`tlsClientRandom`, `tlsExportedAuthenticator.*`, `edgeL4.deliveryRate`）；
  3. 强类型与有效性校验：除 `deliveryRate` 必须为有限数值（`Number.isFinite`）外，其余必须为严格 `string`；禁止任何数组、对象结构篡改；
  4. 变动审计强闭环：实际变动的字段集合必须精确等于封存回执中的 `review.changedPaths`。
- **裁决**：**恶意 CF 缓存污染或结构注入被严格递归类型检查彻底阻断**。

### 4. 攻击推演四：利用 `scopeValidation` 逃避生产 4 阶段数据库操作
- **攻击路径**：试图通过提供 `scopeValidation`，使得批次误入 `not-required` 流程，从而跳过生产备份和恢复演练。
- **防御验证与拦截机理**：
  1. `validateToolsNoMigrationScope` 入口前置硬性断言：
     `if(batchVersion !== 'teruisi-release-batch-v3' || impact?.version !== noDataPolicyVersion || impact.level !== 'strict' || recoveryDecision({impact}).mode !== 'full') throw new Error('Migration closure qualification is v3 strict/full only');`
     若 `recovery.mode` 不为 `full`，直接抛错拒绝；
  2. `requirementsForImpact` 内部行为：
     仅执行 `tests: original.tests.map(name => name === 'migration-rehearsal' ? 'migration-closure' : name)`；
     **`original.backup` 保持原值 `'full-pre-and-post'` 丝毫未动**；
  3. `makeBatch` 与 `verifyBatch` 对操作列表校验不变，`backup-pre`、`restore-pre`、`backup-post`、`restore-post` 4 个数据库阶段必须全部封存于 approved operations 中。
- **裁决**：**`tools-no-migration-v1` 仅将“迁移重演测试”置换为更切合实际的“迁移零变动闭环证明测试”，绝对没有赋予 `not-required` 豁免资格，4 DB 阶段依然 100% 强制执行**。

---

## 三、 准入时序强化与观察回执隔离复核（Timing & Logging Hardening）

本轮 Diff 对准入阶段的慢核超时、状态回执与目录污染实施了重要修复：

1. **时效性强断言（`ageMs <= 5000`）**：
   在完成耗时的动态观测后，记录 `dynamicObservedAtMs = now()`，并在最终组装结果前断言：
   `if(!Number.isSafeInteger(dynamicObservedAtMs) || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 5000) throw ... { code: 'STALE_ADMISSION_SNAPSHOT' }`
   强制要求动态观测结果必须在 5 秒内完成封存；若因慢核或时钟异常超时，安全熔断为 stale 错误，杜绝采信陈旧观测快照。
2. **终态多维实体一致性复验**：
   在准入收集的末尾追加了 3 项不可跳过的现场一致性复验：
   - `effective-chain-final`：确保发布链 Head 与链状态未漂移；
   - `django-identity-final`：确保 `app/deployment.json` 未被物理篡改；
   - `journal-final`：确保批次日志事件未被并发篡改。
3. **本地白名单 DTO 替代外部依赖（`safeAdmissionReadinessFailure`）**：
   通过内置的 `allow` 白名单数组与 12 核心组件映射，完成了对未就绪状态的安全 DTO 转换，无需引入第 11 个外部 helper 或额外的探针逻辑，依赖闭包保持自洽。
4. **观察回执目录隔离修复（`_observations`）**：
   ```javascript
   - const root = path.join(state.dir, 'observations', ...);
   + const root = path.join(path.dirname(state.dir), '_observations', ...);
   ```
   将观测回执路径移至批次目录的同级 `_observations/` 中，彻底解决了因将回执写入 WAL 目录而导致后续日志解析器拒绝未知子目录的严重 Bug。

---

## 四、 局限性与未证明缺口声明（Retained Limitations）

按照最高严谨度标准，声明以下客观存在的覆盖与环境缺口：

1. **测试覆盖未完全闭环**：
   187 个开发用例虽已通过，但尚有 166 个限定用例有待在最终生成的真实候选上全量重跑；21 个离线用例不在当前构建包内；
2. **观察器替身覆盖缺口保留**：
   此前 72 秒隔离循环测试中使用了 observer 替身，该环境替身所带来的覆盖缺口依然作为事实保留，不据此宣称全浏览器端到端行为已完备；
3. **生产数据库恢复演练未执行**：
   当前的 `backup-recovery` 逻辑属于 consumer 协议契约与失败门禁，**不代表真实 PostgreSQL 数据库恢复演练已在生产完成**；实际的 4 DB 阶段演练必须在后续获批的正式生产窗口中物理执行。

---

## 五、 最终复审裁决

基于对新增 4 模块差异的对抗性分析与逻辑推演，Antigravity 独立审查席给出最终裁决：

- **漏洞与阻断判定**：**无**（经针对性攻击推演，伪造库存、代码/迁移夹带、恶意 CF 缓存污染、时钟漂移及日志目录冲突均被严密拦截，未发现可执行阻断反例）；
- **候选准备准许**：**【准予进入候选准备阶段（CLEARED FOR CANDIDATE PREPARATION）】**。本版本具备制作正式候选制品及执行自举计划准备的工程完备性与密码学自洽性；
- **生产控制令维持**：**坚决保留生产阻断**。本裁决不构成生产发布批准，生产切换及 4 DB 阶段物理执行必须留待最终封存批次审批后由原执行流程闭环。
