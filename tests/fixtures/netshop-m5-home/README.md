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

没有完整 O/旧ERP数值 golden 时只证明原入口/error存在，M1/O与M4原证据分别继承，不称真实经营回归、M7或生产采用。各失败 run CreateNew 原样保留；每 run 写 SourceHEAD/dirty、compile dependency/layout SHA、原捕获清单、DOM/截图、运输记录及正常 browser/server shutdown，无 PG/GRANT/业务下载导入/付费模型/生产操作。
