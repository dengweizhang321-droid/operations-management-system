# M5 actual Home 验证工具与固定来源

这是 I 委派的工具作者交付，工具作者执行不具有独立 Q 资格。运行 node tools/verify-netshop-m5-home.mjs；另一 Q 可设置 NETSHOP_M5_UI_ROLE=Q-independent 并在其审查的实际提交执行。

工具直接编译并挂载 app/page.tsx 的真正 Home，使用它唯一的 history、共享导航、module wrapper，以及 app/layout.tsx 声明的三个全局 CSS。没有第二个 Router、Prototype 页面或 C 模块导入。独立 npm 依赖安装在当前 Root-owned M5 工作树；没有借用其他树的解释器或 node_modules。动态 127.0.0.1 端口和全新 headless browser context，禁止 service worker、外部流量、未知 GET、所有写方法和模型派发。

## 来源与不变项

manifest.json 中三个现成 S raw capture 直接指向已提交 tests/fixtures/netshop-panorama 原文件，按原字节大小/SHA核验，不重复改写。第四份 original-composite.json 是 Root 已提交原 S e8f7 捕获的原字节副本：212544 bytes，SHA256 e8f7da2995b21c1cee2b986814ec65e854c7c57d7f43baea11922bfe845364c3。只从 RootI 提交 0058b6e20df9fc36096de806af7fe55ecb63b12f 的 tests/fixtures/netshop-integrated-shell-ui/m5m6-source/response-owning-jd.json 读取 Git blob；original-provenance.json 同源保存原 query、header 与 E provenance。没有复制 RootI harness 或任何 C 合同。

原字段、金额、F 三实际源期/context/calendar/coverage、单位、分子分母、修订与 token 完全不变。默认正例为 original-composite 的京东 A / SPU / 2026-09-01；其余三份从自身 context.requestedScope、tableScope、实际 current 窗口及 netshop owning_revision 还原 URL 与版本头。不同店、日期、维度或 grain 没有对应捕获时返回明确 source_pending，不把已有 carrier retarget 到另一个范围。

P/A 跨栏目使用 S 内原 owning envelope 的不改值投影，明确不是另一次独立 HTTP 证明。只有完整原 P 列表 total=items.length 才允许 q/分页/每页大小的展示投影；所有行均从原 items 选取，不造新行或聚合值。全店 summary、series、源期、覆盖和 token 序列化不变式逐次核验。没有 golden 的详情读取固定 source_pending，不用产品行拼假详情。A 的独立 SKU 载体不伪桥接 P 的 SPU。

## 本阶段覆盖与边界

实际桌面及320/390布局、sharedNav固定/S标题与自身筛选滚动、五旧路由、01新旧及原ERP入口/error保留、S→P单一可见返回和原browser back、q/每页及page=2深链接不改全源、401/403/409/503清旧结果、按平台/日期真实UI改变范围后的200/401/403/409迟到与取消栅栏、限制账号切换清旧数据、AI草稿准确店日/低信任说明且不发送，以及显式安全拦截探针。

目前无一份原 F 的无 outlet 授权目录 carrier，目录读取诚实503，不改选定单店 carrier 冒充目录。因此没有验证完整多店授权目录/换到另一授权店的正向经营读。账号返回是合成认证响应，只证明真实 UI 的失效；生产与实际数据库权限另验。

当前原始三份 S 捕获不含最终 Finance/temporal/all-six 同范围组合。待 S 最终交接后 Root/Q 可局部新增目录及完整原捕获。支持 NETSHOP_M5_SOURCE_MANIFEST 指向外置只读 manifest，schemaVersion=netshop-m5-home-source-v1、syntheticOnly=true、records 数组；每项 name/file/bytes/sha256 必填，可携带原 query 与 owningRevision（按键值校验，不依赖 query 排列）。每个 file 相对 manifest 目录读取并按原 size/SHA校验，再由实际 S decoder 验证。外置集合需至少一份完整非空 P nested 列表，作为 whole-list/q 展示正向控制；不能借可选外置 manifest 绕开全部范围/协议校验。

作者 screenshot 在 f0b7 基线发现 sp-date-selector 继承 global date-selector 的38px固定高度，统计期间按钮下溢并在320压下一字段标签。工具已增加真实 date button/自身 field/下一 field 的几何回归；该问题须由 S/I 在其 Source 写权修，工具不改业务CSS。先前31项通过不替代这项新增布局门槛。

## 同一运行六路原始捕获（opt-in）

新增 same-run6-00dad2 目录，全部 raw/meta 与 capture-handoff.json 均 CreateNew 原字节保全，旧三文件/e8/旧 manifest 未覆盖。运行时设置 NETSHOP_M5_SOURCE_MANIFEST=tests/fixtures/netshop-m5-home/same-run6-00dad2/manifest.json。原捕获源码 00dad2ddd7d1a66885dcda7d69e0311ec1f1ecd0，来自 E:/codex-artifacts/netshop-panorama-M5-20261001/tests-root/00dad2ddd7d1a66885dcda7d69e0311ec1f1ecd0/directory-narrow-final；所有六路 header 都为 1:263b6b9094b1，freshSeedSHA256 都为 61e3b869890eed14d20da1d5191703491bd536542bceb41ab72aad48b3b69c31。Finance 此 seed 原8/9月不与旧全年29月数据混拼。

| 路径 | 原 bytes | SHA256 |
| --- | ---: | --- |
| response-owning-directory.json | 7602 | 983a13587862f3eb98638db1fb6f2c8aafc81bb39bce2f6d845354e5d55c80fc |
| response-owning-all-six.json | 207334 | dd919540b8015463c9b35a0a082610464804da97901d2863972758af5ca54bb9 |
| response-owning-direct-products.json | 41172 | dd283e033cf9133dd8eef7b62a9a90f1bb66be32e512c2fb7f9547c136f6748f |
| response-owning-direct-product-detail.json | 27025 | 4e6a04d675bedf6ca0e6c87bd5e5dd75b3d9cf29d158cbd835dd0e52c090489c |
| response-owning-direct-promotion.json | 37786 | f684b8e731543605e6fdcc958b6ffc97a2286b82e2f4bd9e35a507052f846f04 |
| response-owning-direct-promotion-detail.json | 18313 | a0487987a469dce43b86803ff880d7593622c2418742cf8e2f933261a8846849 |

每份完整 body 用其原 meta query 和原 header 经实际 F/S/P/A decoder 正向校验。只同一 seed 的 panorama/目录/direct 分组互通；其他旧 capture 不借用新目录或新详情。字段原 query 的缺省值由实际 query validator 解释，不把缺省顺序差异当作新范围。详情身份、实际窗口和 token 必须匹配；没有 exact-product SKU采样时不补一个、不伪桥接SPU。专题列表允许完整行集合的展示投影，完整原生指标、F载体、序列和版本不变。

精确 P detail 原pageSize20，测试先通过真实 S 每页20控件进入该范围，原详情 body不改5；S→P detail后原控件直接返回S原URL，与真实共享history规则相同。A使用实际“推广花费”widget定位章节，再进原SKU专题、按原对象标题进入详情、关详情并用其原返回控件恢复S精确URL。目录正例从原空outlet carrier取得选项，再由用户select明确单店，没有隐式第一店。Finance current/previous/yearAgo取各原读取引用，ERP日期/原生数量从原 compact series tuple对照，不复制SQL或业务聚合。

NETSHOP_M5_DATE_PROBE=1 只运行真正Home的1440/1280/390/320期间选择几何探针。记录trigger/label/popup/近7按钮、viewport、ancestor overflow和内层scrollLeft/Top，若确有可达横滚只用可见mouse wheel并断言真实scroll变化，绝不forceclick或改DOM/CSS。Source8e实测popup computed fixed/y1008（1000高viewport），不是horizontal-scroll；公共Source修复由I独占。

NETSHOP_M5_VALIDATION_SCOPE=transport 明确暂不执行已知需要公共CSS修复的日期矩阵，result会写该scope与pending，默认 full 保留全部日期与手机断言。它不会跳过手机：Source8e全6在390有ERP implicit grid track974撑页面1003的真实失败；错误截图、geometry与旧日期失败原样保留，未改为baseline绿。交接时新六路前11项实际Home已通过，完整新matrix仍待I串行源CSS修复及非作者Q。

没有完整 O/旧ERP数值 golden 时只证明原入口/error存在，M1/O与M4原证据分别继承，不称真实经营回归、M7或生产采用。各失败 run CreateNew 原样保留；每 run 写 SourceHEAD/dirty、compile dependency/layout SHA、原捕获清单、DOM/截图、运输记录及正常 browser/server shutdown，无 PG/GRANT/业务下载导入/付费模型/生产操作。
