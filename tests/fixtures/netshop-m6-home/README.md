# M6 真正 Home 工具（静态交接阶段）

仅本新目录及 tools/verify-netshop-m6-home.mjs 由工具作者维护，不改任何栏目/公共生产源码，不替工具做独立Q。实际 M6候选源码与最终API捕获由总控另行pin。当前结构在 RootI 创建，未运行 Home编译、API或浏览器；只能静态inspect/lint。

静态入口 node tools/verify-netshop-m6-home.mjs --inspect-corpus 会核完整原file bytes/SHA、query/header及阶段，明确输出 finalCorpus=false，不构建或发API。默认 manifest-stage-c22-c9.json 引用已经提交的10份C22原始body＋metadata和早期C9 ERP temporal三case完整wrapper。前者保留原body字节，后者保留整个已提交wrapper字节、读取其中原response JSON投影；绝不声称wrapper投影是另一次独立signed HTTP。未知seed标null，不造一个或与旧S6称同seed。旧capture阶段不会自动升级最终验收。

最终运行必须指定 NETSHOP_M6_SOURCE_PIN（准确干净业务Source40位SHA）、NETSHOP_M6_CORPUS_MANIFEST（最终原捕获清单）、NETSHOP_M6_CORPUS_SHA256（独立64位原manifest SHA）。当前HEAD只能相对source pin增加本专属tool/fixtures或review docs，生产差异会阻断；检出必须clean。finalCorpus必须true，comparison记录必须实际 signed-owning-api 层、finalAcceptance=true且有真实seed。没有最终sameSeed/source条件时在build前拒绝，不能在RootI WIP启动。

编译入口直接挂 app/page.tsx 真正Home、layout html/body和原三全局styles，真实S/C/P/A注册、唯一history和shared导航；没有Prototype或第二个Router。原固定loopback动态端口、空headless context，外部/未知GET/所有写方法/模型请求拦截。原比较每一个完整query经实际C validator归一后必须精确匹配，包含mode/custom baseline/metric/grain/sort/page；只解释拥有方真实缺省，不改capture context/金额/日历/单位/版本，不将partial页投complete。缺原query返回明确pending，实际scoped reader负责先清旧body。原Body经实际decodeComparisonInsights验证，无本工具aggregate。

最终corpus schema netshop-m6-home-corpus-v1，records含name/kind/file/bytes/sha256/query/owningRevision/phase/apiLayer/seed/finalAcceptance。原本独立JSON直接回原bytes；wrapper必须显式caseIndex并披露投影含义。非comparison的sameSeed原目录/S/P/A/topic/detail可以显式加入，由已提交M5机制复用，但只有当前C case已声明相同seed才委派；不能仅凭同店名拼旧S原六来源。

完整门槛保留：fiveOldNavAndOERP、metric22、allGrains、sortPageQ、nativePlatformTotals、memberFold、calendarClicks、sameSeedPDrill、sameSeedADrill、late401403409、accountScope。final manifest.validationCases 每项必须引用原capture、有真实UI步骤和至少一个绑定原sourcePath的post assertion；无数据、无步骤或无原字段则阻断，不用一个gate标签冒通过。steps仅支持实际select/click/fill/browser back，无force/evaluate/CSS改写。旧O/ERP来源不齐只继承M1/M5源证明并核真实入口/error，不称真实经营全验。

当前缺最终C clean交接、同seed signed C/P/A q/page/grain/direct，及native owner ERP全平台totals/bucket/member fold最新capture，均pending。范围冻结，只补已承诺核心阻断，不扩新分析能力。Root完成工具单独commit后可显式纳入M6干净候选，由未编写本工具的Q运行；工具作者不会自称Q。每run E独占CreateNew Source/corpus SHA、实际compile/layout样式closure、原请求、DOM/viewport、资源及normal browser/server shutdown，所有失败保留；无生产/真实业务/付费/GRANT。
