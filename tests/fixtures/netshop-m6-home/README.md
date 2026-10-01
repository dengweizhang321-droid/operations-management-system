# M6 真正 Home 工具（静态交接阶段）

仅本新目录及 tools/verify-netshop-m6-home.mjs 由工具作者维护，不改任何栏目/公共生产源码，不替工具做独立Q。实际 M6候选源码与最终API捕获由总控另行pin。当前结构在 RootI 创建，未运行 Home编译、API或浏览器；只能静态inspect/lint。

静态入口 node tools/verify-netshop-m6-home.mjs --inspect-corpus 会核完整原file bytes/SHA、query/header及阶段，明确输出 finalCorpus=false，不构建或发API。默认 manifest-stage-c22-c9.json 引用已经提交的10份C22原始body＋metadata和早期C9 ERP temporal三case完整wrapper。前者保留原body字节，后者保留整个已提交wrapper字节、读取其中原response JSON投影；绝不声称wrapper投影是另一次独立signed HTTP。未知seed标null，不造一个或与旧S6称同seed。旧capture阶段不会自动升级最终验收。

最终运行必须指定 NETSHOP_M6_SOURCE_PIN（准确干净业务Source40位SHA）、NETSHOP_M6_CORPUS_MANIFEST（最终原捕获清单）、NETSHOP_M6_CORPUS_SHA256（独立64位原manifest SHA）。当前HEAD只能相对source pin增加本专属tool/fixtures或review docs，生产差异会阻断；检出必须clean。finalCorpus必须true，comparison记录必须实际 signed-owning-api 层、finalAcceptance=true且有真实seed。没有最终sameSeed/source条件时在build前拒绝，不能在RootI WIP启动。

编译入口直接挂 app/page.tsx 真正Home、layout html/body和原三全局styles，真实S/C/P/A注册、唯一history和shared导航；没有Prototype或第二个Router。原固定loopback动态端口、空headless context，外部/未知GET/所有写方法/模型请求拦截。原比较每一个完整query经实际C validator归一后必须精确匹配，包含mode/custom baseline/metric/grain/sort/page；只解释拥有方真实缺省，不改capture context/金额/日历/单位/版本，不将partial页投complete。缺原query返回明确pending，实际scoped reader负责先清旧body。原Body经实际decodeComparisonInsights验证，无本工具aggregate。

最终corpus schema netshop-m6-home-corpus-v1，records含name/kind/file/bytes/sha256/query/owningRevision/phase/apiLayer/seed/finalAcceptance。原本独立JSON直接回原bytes；wrapper必须显式caseIndex并披露投影含义。非comparison的sameSeed原目录/S/P/A/topic/detail可以显式加入，由已提交M5机制复用，但只有当前C case已声明相同seed才委派；不能仅凭同店名拼旧S原六来源。

完整门槛保留：fiveOldNavAndOERP、metric22、allGrains、sortPageQ、nativePlatformTotals、memberFold、calendarClicks、sameSeedPDrill、sameSeedADrill、late401403409、accountScope。final manifest.validationCases 每项必须引用原capture、有真实UI步骤和至少一个绑定原sourcePath的post assertion；无数据、无步骤或无原字段则阻断，不用一个gate标签冒通过。steps仅支持实际select/click/fill/browser back，无force/evaluate/CSS改写。旧O/ERP来源不齐只继承M1/M5源证明并核真实入口/error，不称真实经营全验。

当前缺最终C clean交接、同seed signed C/P/A q/page/grain/direct，及native owner ERP全平台totals/bucket/member fold最新capture，均pending。范围冻结，只补已承诺核心阻断，不扩新分析能力。Root完成工具单独commit后可显式纳入M6干净候选，由未编写本工具的Q运行；工具作者不会自称Q。每run E独占CreateNew Source/corpus SHA、实际compile/layout样式closure、原请求、DOM/viewport、资源及normal browser/server shutdown，所有失败保留；无生产/真实业务/付费/GRANT。

## 最终 signed 原件 checkpoint（2026-10-01）

final-signed-98dd 与 final-signed-916 各自 CreateNew 保存完整22组三文件（request/response/meta）和原signed-same-seed-manifest。98目录仅历史，不被916覆盖；两个run虽然fixture seed相同，HTTP nonce/实际时间不同，不能混称同一次。最终所有 positive C/P/A 统一引用 final-signed-916/manifest-final-signed.json。19个200＋原401/403/409三件大小、SHA、query、header、status原样核，保留真实signed/private TCP/实际Sales RPC层。seed字符串只是原manifest sharedPositiveSeed的run定位引用，原定义完整保存，不捏造新业务seed值。

原runtime组合0254d03ac3dad276e5b9955f12f7556ffd923620，已批准tool/harness来源2edecb8b1a983839de4a93874eeb2a5395c9438d；只有已明示的签名测试/helpers叶不同，runtime不变。之后Root可先只commit本专属tool/raw再加已审test-only leaf，给新的干净HEAD。Meta中的原comboPin/时间/signature/body无修改。原test_only_explicit_injective_raw_triples仅隔离fixture映射，不称生产真实别名或独立来源核验。普通smoke实测两RPC、platform day实际五RPC，不相加为独有用例。

916精确平台展开273648 bytes、SHA68b2e84e509b317bfe86a2493e56fd4b350a28a1a1282a7eb2b13bcbef4e259f；原query显式five JD outlet逐值/次序匹配父真实row.shopKeys。98旧无outlet expanded事实也有五店，但请求不同，不用于这一门槛，绝不改requestedScope/请求或C按钮来骗过。

目前交付raw与严格运输checkpoint，不声明完整Home已运行。新bootstrap直接消费原C与same-run P/A独立topic/detail，经原decoder校验完整query/identity/window/header；不再借旧S六seed。错误用原authority响应原字节；全部未知GET/写/模型/外部禁止。未知sort先确认并非已捕获同scope响应，再用真实合法UI变更验证清body；没有sort/q准确采样就明确pending，不能宣称排序源量全验。最终validationCases仍需按原实际步骤与原sourcePath逐gate落实；未执行、缺原capture或空assert不得伪通过。
