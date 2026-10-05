# 公共能力接入与四领域交接

状态：**待集成**。新接口不要求现有消费者同步重写；默认函数继续独立读。所有实例均由页面/会话所有者创建，不建立Node/Worker全局共享池。

## 精确依赖

公共JSON读：`lib/http/read-client.ts`→`lib/http/api-client.ts`→原`lib/http/api-error.ts`与新`lib/http/performance.ts`。后端、schema、DB migration、release/lifecycle均无依赖变更。依赖锁未变。

壳层：`app/page.tsx`使用`app/shell/module-loading-state.tsx`；`reloadable-lazy.tsx`新增可选preload；原错误边界、导航契约和React19保留。可以分别评估壳层和公共读取接入，不需四域同时改版。

| 领域所有者 | 可接入路径 / 前提 | 必须继续保留的契约 |
| --- | --- | --- |
| 销售 | `/api/sales/summary`等经所有者审计的纯GET；同完整URL、准确会话/role/scope指纹与owner版本才合并。原`fetchWithTransientRetry`已显式用于部分读。 | 原revision、sourceRef、分页与query packing、role/scope、错误解码、generation fence与8秒等既有网关预算。新池无自动重试；禁止将原独立retry套入池底层扩大执行次数/期限。 |
| 库存 | `/api/inventory/overview`、`age-analysis`等分别注册，`view=plan`与overview及日期/warehouse筛选保留精确query；版本须来自库存owner。 | 自身快照/需求窗口不冒shell日期，原权限和business quality、plan分页、错误状态。补货创建/更新、导入/上传、钉钉投递全禁用公共合并。 |
| 商品经营 | 初始完整/initial-page没有可靠先验token时`version:null`；在owner已给snapshotToken后可评估page/overview同token合并。 | source scope+完整query+snapshotToken共同绑定；统计/明细分区、迟到回包fence、overview补齐恢复及owner版本漂移重建。不能把同snapshotToken当同范围，也不能把常量`initial`冒充版本。 |
| 市场 | 已有`requestMarketOverview`在途池与4秒近期预取/短TTL；先验证原机制，评估吸收公共负例或复用新能力，不能再套一层重复池。 | 原版本缓存/authority/scope/账号/事务绕过与规则，前端键的身份变更清理应由owner核验；AI任务提交、SSE、图片/上传/任务操控不适用。 |

`CurrentUser.scopeRestricted`只是布尔展示字段，**不足以成为完整权限指纹**。领域须给出可靠的会话generation及完整principal/role/data scope指纹/epoch来源和失效事件。如果拿不到，不启用跨消费者合并；既有后端每次鉴权继续执行。指纹不能是Bearer或Cookie，不使用固定字符串冒充权限。注册GET并不证明它无副作用，所有者必须审计后才加入exact paths。

## 可选读取示例

```ts
import { createReadJsonClient } from "@/lib/http/read-client";

// 在浏览器页面/会话边界创建一次，生命周期由所有者持有。
const reads = createReadJsonClient({
  origin: window.location.origin,
  paths: ["/api/sales/summary"],
  lifetimeMs: 8_000, // 示例须匹配该既有路径预算，不使用上限扩时
  maxEntries: 2,
  maxBytes: 2 * 1024 * 1024, // owner核验实际合同后设置
});
const common = {
  identityKey: verifiedSessionGeneration,
  permissionKey: verifiedFullPrincipalScopeFingerprint,
  version: reliableOwnerVersion ?? null,
};
const controllerA = new AbortController();
const controllerB = new AbortController();
const [a, b] = await Promise.all([
  reads.read<MyDomainDto>(exactUrl, { ...common, signal: controllerA.signal }),
  reads.read<MyDomainDto>(exactUrl, { ...common, signal: controllerB.signal }),
]);
// 只有同key且仍在途才共享；null版本独立读；a和b是独立对象。
// logout / permission change / committed write / owner-version invalidation:
reads.invalidate();
// 真正卸载时：
reads.dispose();
```

每订阅者timeout只脱离自己，整体lifetime从首请求开始、不被后来订阅延长。最后订阅者退出才abort公共传输；底层不协作时仍占槽位。请求失败后不存结果，新调用重新读取；容量失败不是可无限retry的信号。`invalidate()`只取消待完成读，没有持久结果要清理。owner版本检查/原generation fence仍必须运行，不由前端池授予读权限。

接口只接受同源exact path的GET JSON，保留重复query字节/顺序，全部请求头纳入key；拒绝外域、URL凭据、fragment、unknown path、显式Cookie/Authorization、AI路径和SSE accept。不接受method/body等 mutation选项。禁止写操作、上传、任务提交、AI流式和业务任务去重或自动retry。不得将accepted AI/business任务的取消信号接入页面隐藏cleanup。

## 观测与代码预加载

```ts
import { createPerformanceRecorder, createPerformanceTrace } from "@/lib/http/performance";
const recorder = createPerformanceRecorder(128); // 初始关闭
recorder.setEnabled(true); // 明确诊断开关，结束后disable+clear
const trace = createPerformanceTrace(recorder.observe);
const result = await trace.measure("auth.permissions", () => actualPermissionResolve());
// 或 createReadJsonClient({ ...config, observe: recorder.observe })
const numericSamples = recorder.snapshot();
recorder.setEnabled(false);
recorder.clear();
```

这只是调用方计时。真正身份解析、权限RPC、Worker前置、Django roundtrip、Django队列、SQL、编码、浏览器headers/body/decode/render必须在各自真实边界接入；没有探针就标`unknown`。`headers`时间含浏览器/网络/服务端，不直接冒TTFB纯传输；Django roundtrip包含内部排队/SQL，**不得把重叠阶段简单相加**；`body`包含字节收取与UTF-8解码，`decode`为JSON解析。浏览器commit/rAF只能作为渲染机会，不冒GPU绘制。

Server-Timing只接收最多2048字符/16项，固定`worker,identity,permissions,local,django,queue,sql,encode;dur=数字`映射；忽略任意描述/未知字段。当前真实网关未转发或产生这些阶段header；例如sales网关使用既有allowlist，因此不能宣称仅开浏览器记录器已得到后端阶段。后端/Worker安装探针属后续统一集成的精确批准范围，不得改domain契约或泄露内部身份header。

```ts
const lazyModule = createReloadableLazy("sales", () => import("./sales-module-view"));
// 仅明确导航意图；未在本轮Home自动调用。
void lazyModule.controller.preload().catch(() => undefined);
```

如owner接入意图预加载，须限制每会话数量/同时数量，不在注册时调用，不预取全部页面/业务数据；隐藏、save-data和弱网策略需验证。reset用于明确错误重试；成功module仍由ESM缓存，浏览器下载的代码无法通过abort保证撤销。共享Loading按区域使用，保留错误/重试和独立busy状态，不让一个区域加载遮住已可用的另一区域。

## 统一集成必要验证

1. 各owner注册纯GET、明确完整身份/权限scope/版本来源和失效事件；拿不到可靠来源就保留原读，不能用展示布尔或常量凑key。
2. 真实DTO/错误解码回归；用户/role/scope、日期、重复筛选、排序/分页、版本漂移、取消+后续失败组合；写后失效；保持默认行为和原timeout/byte边界。
3. 实际Worker普通认证与本地直连分别采样；只考虑同请求、同核验结果的局部复用且每次role检查仍成立。不持久缓存授权、不扩scope。
4. 后端abort逐段接线核验：目前仅客户端fetch/正文取消证据；同步SQL/DNS或已接受工作不能据browser canceled宣称停止。SQL仍由原statement timeout/deadline约束。
5. 初次代码请求、重组件构建、重复渲染与真实大响应clone成本；错误边界/键盘/mobile/区域加载成功态；browser长会话heap及隐藏轮询订阅清理；accepted任务不能误取消。
6. 组合版本的相关tests/build/lint；仓库额外typecheck的188错误另有未修改源文件证据，不冒全仓类型检查已通过。
7. 无生产压测。后台争用只在确认同窗CPU/内存/DB连接/锁等资源与慢请求相关后再提独立调整方案，本轮不改正式调度/并发或生命周期。

## 复现（本树隔离环境）

```powershell
node --import tsx --test tests/foundation-read-client.test.ts tests/foundation-independent-review.test.ts tests/foundation-shell.test.ts
node --import tsx tools/performance/foundation-benchmark.ts
node --import tsx tools/performance/foundation-soak.ts
node tools/performance/foundation-browser.mjs
npm run build
node tools/performance/foundation-audit.mjs
```

benchmark/browser仅临时loopback+合成数据、GET-only、关闭外部请求；audit依赖本树dist与types-final.log。工具会更新本目录证据，必要时先另存上一轮（不覆盖有价值的失败样本）。Node24.18.0、原锁定依赖；`npm ci`后应执行原`postinstall`，仅补本树摘要固定依赖。纯Python旧合同用本树无pip`.runtime/test-venv`，不复制正式连接/凭据。不要运行`npm start/dev`或任何生产生命周期命令来复现本轮实验。
