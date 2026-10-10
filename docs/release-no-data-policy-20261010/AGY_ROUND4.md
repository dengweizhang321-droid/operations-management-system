# TERUISI 发布规则调整（v3 not-required）第 4 轮独立终审意见（第一部分）

> **审查方**：Antigravity 独立审查席
> **审计对象**：`tools/release-batch.mjs`、`tools/release-impact.mjs` 及 `tools/release-no-data-observation.mjs` 完整原文与最新固定实现
> **审查输入**：主 Agent 提供的完整原证明函数、固定观察器实现、Astra 逐项复核裁决与测试回归记录（`astra-review-regression.log` 32/33 及修正后 33/33）
> **环境与操作明示**：**本审查席位亲自未执行本分支代码**（恪守只读与无生产授权约束，不调用任何本地执行工具），一切推导与审计基于所给物理代码、形式化逻辑及主 Agent 真实实跑证据。坚决杜绝以双模型“主观共识”代替实际测试执行。

---

## 一、 上轮（AGY_ROUND3）阻断主张的逐项复核与裁决

基于主 Agent 本轮补充提供的完整原证明函数（`ORIGINAL_FULL_PROOF_FUNCTIONS`）、固定观察器全量代码及回归日志，本席位对上轮提出的各项阻断主张进行逐一核实、客观裁决与状态更新：

| AGY 原主张 | 依据完整原文与实跑事实的核查结论 | 裁决状态 |
| :--- | :--- | :--- |
| **1. `makeImpactProof` 丢失 before/after 源码导致封存必崩** | **【原主张不成立，正式撤回】**<br>上轮意见基于未包含未变上下文的截断 diff 做出。完整源码证实：`makeImpactProof` 始终封存了所有变动文件的完整源码文本（`proof.before` 与 `proof.after`），`verifyImpactProof` 在比对库存哈希后，将其完整展开并传入 `classifyImpactV3`。真实 105 项测试与新增的 JSON roundtrip 测试已证实原字节完整往返，`makeBatch → verifyBatch` 真实封存通过。 | **正式撤回** |
| **2. `djangoCandidateSha256` 未绑定导致可传空值绕过** | **【原主张不成立，正式撤回】**<br>底层操作在执行时由原操作员校验器 `assertStartBinding` 严格兜底，缺失哈希会触发 `TypeError` 失败关闭。主 Agent 针对此项在批次头部为 v3 显式补充了两项 Django 哈希强类型断言，测试由 32/33 修正至 33/33，消除了隐式报错，防御完全闭合。 | **正式撤回**（确认加固生效） |
| **3. 观察操作可浮动至 prepare/drain 造成假验收** | **【原主张不成立，正式撤回】**<br>`validateNoDataObservation` 开头即包含硬性断言 `assert.ok(['acceptance','closeout'].includes(op.phase))`。批次全量拓扑校验同时确保 `EndWorkerDrain` 必须在 `switch` 完成，观察探针在物理上无法前置至应用切换之前。 | **正式撤回** |
| **4. `collector.files` 存在多余文件逃逸风险** | **【原主张成立，最新代码已修复闭合】**<br>新提供的 `FINAL_FIXED_VOCABULARY` 已增加集合封闭性断言：`collector.files.some(f => !noDataCollectorFiles.includes(f.path) && f.path !== collector.args[3])`，禁止任何未受信任的附加文件，且强制去重。参数 `args[2]/[3]` 严格锁定为绝对 `.json` 路径，消除了任意文件与参数注入风险。 | **已修复闭合** |
| **5. Windows 路径大小写与 PowerShell 5.1 路径阻断** | **【原主张不采纳，正式撤回】**<br>硬编码 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` 为既有已验证的生产操作员平台契约；父进程为 `pwsh` 不代表部署执行器需更换宿主。路径大小写严格匹配属于合规的保守拒绝策略，不构成安全漏洞。 | **正式撤回** |
| **6. CSS/JSX 骨架规则早期范围过宽** | **【原主张成立，且已获实质收紧】**<br>Astra 确认早期规则存在过度放行风险，现已大幅收紧为：仅接受有限间距/字号/字重/圆角字面类，组件必须为零参数、无导入、无事件、无表达式的被动静态组件，且已被真实 `textContent writer` 负例测试拦截。 | **已采纳收紧** |

---

## 二、 最新代码深度安全审查（Current Code Adversarial Review）

对本轮提供的最新固定实现（`FINAL_OBSERVER_COMPLETE`、`FINAL_FIXED_VOCABULARY` 及证明闭环）进行对抗性专项审查：

### 1. JS 任意代码执行防御审查（Arbitrary JS Execution）
- **沙箱隔离**：Playwright 上下文显式声明 `{ serviceWorkers: 'block' }`，禁用 Service Worker 离线缓存与后台线程。
- **断言求值沙箱化**：
  ```javascript
  if (check.text !== undefined) assert.equal(await target.innerText(), check.text);
  else assert.equal(await target.evaluate((element, property) => getComputedStyle(element)[property], check.property), check.equals);
  ```
  - 表达式为写死的箭头函数，禁止传入动态代码字符串。
  - `check.property` 严格受限于 10 个安全 CSS 属性白名单（`gap`, `padding`, `margin`, `color`, `backgroundColor`, `fontSize`, `lineHeight`, `width`, `height`）。
  - `check.selector` 正则限制为 `/^[a-zA-Z0-9 ._#>:-]{1,200}$/`，不包含引号、括号或反斜杠，杜绝了 Playwright 高级选择器引擎（如 `:has-text(...)` 或 JS 选择器）的代码注入。
- **页面资产完整性**：页面所消费的所有静态资源必须逐字节哈希匹配 `candidate` 制品文件，任何未登记或篡改的脚本都会被直接拦截。
- **审查判定**：**JS 任意代码执行被物理级阻断**。

### 2. 伪只读 API GET 拦截与网络副作用阻断（API GET Writes & Network Egress）
- **客户端拦截网（Client-Side Routing Net）**：
  ```javascript
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET' || url.origin !== origin || url.search || url.hash || !(expected.has(url.pathname) || url.pathname === '/')) {
      prohibited.push({ method: request.method(), path: url.pathname });
      await route.abort('blockedbyclient');
      return;
    }
  ```
- **核心安全机理**：
  - 页面允许请求的目标仅限于 `origin` 下的根路径 `/` 以及候选静态资源清单 `expected`（匹配 `/assets/...`）。
  - **任何发往 `/api/...` 的接口请求（包括伪只读 GET、初始化探测、数据拉取）直接命中客户端终止 `route.abort('blockedbyclient')`**。
  - 请求在浏览器网络栈底层被直接切断，**根本不会发出到物理网络，后端 Django / Worker 服务器在整个验收期间完全接收不到该请求**。
  - 任何包含 `url.search`（查询参数）或 `url.hash` 的请求一律被拦截，杜绝通过 URL Query 传参实施数据外发或状态污染。
- **审查判定**：**伪只读 GET 的后端副作用被网络路由层彻底阻断**。

### 3. POST 请求与重定向攻击防御（POST & Redirect Exploits）
- **写方法阻断**：若页面尝试发起非 `GET` 请求（POST/PUT/DELETE），请求首先被 abort，随后在验收结算时执行强断言：
  ```javascript
  assert.equal(prohibited.some(r => r.method !== 'GET'), false, 'Page attempted a write');
  ```
  直接判定验收失败并保留拦截证据。
- **3xx 重定向阻断**：
  - 根路径抓取设置 `maxRedirects: 0`。若根路由发生 HTTP 重定向（例如跳转至包含初始化写操作的页面），`route.fetch` 返回 3xx 状态码触发 `response.status() !== 200`，推入 `mismatched` 并导致测试崩溃。
  - 权限探针显式设置 `{ redirect: 'manual' }`，禁止自动跟随重定向，确保严格断言 401。
- **审查判定**：**写方法与重定向穿透防护完全成立**。

### 4. 资源漂移（Resource Drift）与运行前/后实体锁定
- **执行前静态比对**：
  - Chrome 可执行文件哈希与 Playwright 核心库哈希在运行前比对 `batch.binding`。
  - 部署 Manifest 比对 `batch.binding.artifactSha256`。
- **执行后环境一致性复验**：
  - 在 `performNoDataObservation` 退出前，强制复验：
    ```javascript
    requireHash(batch.binding.djangoCandidateSha256, 'Django identity');
    assert.equal(hash(await safeRead('D:\\teruisi-runtime\\django-sales\\app\\deployment.json')), batch.binding.djangoCandidateSha256);
    ```
  - 自然 Watchdog 在 300 秒观测窗口的前后，严格比对 `django-supervisor-desired-state.json` 的哈希栅栏（Fence），确保监控期内未发生外部配置漂移。
- **审查判定**：**关键资源与配置状态具备闭环哈希锁，漂移即熔断**。

### 5. 真实 Effect 证据保全与失败 Unknown 状态管理
- **不可变证据落盘**：`runNoDataObservation` 使用原子性 `writeOnce`，在独立目录中保存：
  1. `started.json`：锁定 `batchSha256`、`operationId` 与启动时刻；
  2. `result.json`：完整记录观测结果明细与回执哈希；
  3. `failure.json`：保留详细失败上下文（包括 `blockedRequests`, `mismatchedResources`）。
- **不可变批次原则遵循**：
  - 发生任何断言失败或网络违规时，直接抛出异常终止流程，将批次置于失败/阻断终态。
  - **绝不在运行时动态将批次现场篡改或降级为 `full`**，恪守了“已封存批次不可变”的黄金法则。

---

## 三、 残留风险提示与工程边界说明（Residual Risks）

当前代码设计在形式化闭环上已十分完善，但在复杂生产运行时环境下，仍需注意以下工程细节：

1. **时钟单调性与微小 NTP 抖动风险**：
   在 `validateNaturalNoDataObservation` 中：
   ```javascript
   assert.ok(Date.parse(value.at) > after && Date.parse(value.at) <= Date.now());
   ```
   若 Watchdog 守护进程与批次执行器在同机不同进程间存在数十毫秒的时钟偏差，或发生 NTP 阶跃微调，`Date.parse(value.at) <= Date.now()` 理论上存在边缘误杀可能。建议在后续迭代中加入极小（如 1000ms）的时钟容差。
2. **端口硬编码对多实例的限制**：
   `permissions` 探针硬编码了 `8071` 与 `8101` 端口。这要求生产环境该两处服务必须处于运行且监听状态；若因运维原因端口产生偏移，将直接导致发布在 acceptance 阶段无法通过。
3. **带版本查询字符串静态资产（Query String）的潜在冲突**：
   网络拦截网严格禁止 `url.search`。若某些前端插件在构建生成 HTML 时为 CSS 附加了缓存清除参数（例如 `/assets/main.css?v=20261010`），请求将被 `url.search` 视为违规而拦截。须确保候选制品构建产物引用的是干净路径。

---

## 四、 审查结论与后续确认

1. **第 4 轮第一阶段终审裁决**：
   - 上轮关于 `makeImpactProof` 丢失字节导致的封存必崩主张，在完整原代码事实面前**正式撤回**。
   - 收集器文件封闭性、参数校验及 CSS/JSX 被动静态范围收紧已在最新代码中得到**彻底修复与形式化闭环**。
   - 现有的 `observeDisplay`、`permissions` 与 `natural-watchdog` 机制**成功阻断了 JS 任意执行、伪只读 GET 后端穿透、POST 写操作、HTTP 重定向与配置漂移**。
2. **基线与状态维持**：
   - 确认本轮审查未赋予任何生产命令执行授权；
   - 生产环境旧活跃批次 `active 9f79` 维持独立与不可变状态，未接管其 WAL；
   - 维持不预先承诺任何“净省分钟数”或“秒级停机”的严谨口径。
3. **下一步交接**：
   核心发布门禁与观察器实现已通过独立审查。等待主 Agent 在下一轮提供最终的**部署非源码输入证明（Preparation Receipts Comparison）**与**具体 Effects 独立审查报告**，本席位将进行最终完整闭环审查。
