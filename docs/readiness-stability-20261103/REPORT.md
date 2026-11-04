# Ready 503 稳定性修复候选

用户明确要求按四点建议修复。基线`e7aaf6c16939770d0941994873747fe301ef0b93`，统一分支`codex/readiness-stability-20261103`，工作树`D:/codex-isolated/readiness-stability-20261103`。本轮仅开发和隔离必需检查，未合main、准备生产制品、安装采用、发布、启停服务、发送消息或调用生产HTTP。

历史证据与双Astra方案反审已复用：共享4秒存在排队耦合，10/29聚合503约4秒而200约3.6秒；11/3没有保存失败body，不能声称本次唯一根因已被证实。权限、ACL、业务探测分离和已完成的e7记账恢复不重做。

## 四点落地

### 1. 拆分预算并对齐实际消费者

保持23个服务、6并发、全部ready才通过，单服务4秒覆盖响应头和完整响应体，从真正发出请求起算。整轮18秒，覆盖四波接近4秒响应的约16秒及2秒余量；这是工程预算与隔离边界结果，不是生产P95承诺。父取消/短期限仍可以提前中止。

直接ready调用方调整为20秒；liveness、helper和主页原期限保持。Watchdog控制driver单独90秒，其他子进程仍60秒，均被120秒snapshot的剩余父期限裁剪。未检查或被整轮截断的服务有`incomplete`状态，不能当作后端自身报错。

聚合与各调用方的代码、父窗口、精确采用入口和隔离检查见[PROBES](PROBES.md)。没有改通用AI bounded-fetch、增加并发或缩短单服务4秒。

### 2. 仅正常发布末端等待

新增`tools/publication-readiness.mjs`，分离**单次探测**与**末端等待**。`publish-main-tail.mjs`在原Start/VerifyStartup完成后调用显式`waitReady`；一次最多120秒，每轮结束后约5秒间隔，首个合法ready立即结束。持续失败写原FAILED，SUCCESS仍在就绪通过之后生成。

发布前现役观察、已有SUCCESS复用、显式status/resume、adopt和未进入维护的观察仍是单次检查，没有各自再加120秒。前置瞬时拒绝这一限制保留；聚合预算修复可能改善它，不宣称所有历史503均已消除。旧精确恢复入口不热改，也没有增加恢复权限或自动补账。

等待只重复原ready GET，不重复Deploy、Start、VerifyStartup、迁移或业务请求。初次18分钟发布lease在尾部前已有刷新，120秒等待不逐次同步刷新lease。

### 3. 截止时间传递

`publicationDeadline()`验证绝对期限；显式值与继承环境同时存在时取更早值。`deployReadyMain → runPublisher`显式传递该值，在环境白名单过滤后重新注入冻结子进程；到期在spawn前拒绝。实际隔离子进程检查覆盖了该边界。

单次探测也按父剩余量收窄20秒。`publish-main-status`在清环境前保存/验证父期限，随后恢复给其子动作和单次ready。末端把父剩余量与120秒一次性换成单调预算，响应头、正文和重查间隔共用；没有父期限就只用阶段上限，不新增整轮调度框架。

### 4. 失败原因与诊断

聚合返回兼容的`unavailableServices`，新增有限`serviceChecks`：白名单服务名、ready/not_ready/incomplete、固定reason、排队/请求耗时、可选HTTP状态。没有URL、SQL、原始异常或业务正文。

发布单次探测禁止重定向，最多读取16KiB并严格解码JSON。合法200还须ok=true/status=ready，不能带非空不可用列表。合法原因未知503记为`not_ready_unknown`并允许尾部有界等待；可识别的配置/身份/协议、鉴权/404等错误终止。底层泛化503不会被捏造成已识别权限错误。

尾部每次安全观察按顺序**尽力异步**写`readiness-observations.jsonl`；日志故障或挂起不能拖住就绪判定、不能把已成功探测改成超时失败。无法保证每条诊断均落盘；持续失败时原FAILED还带有有限结构化readiness摘要。探测结束和同步观察期间的取消均拒绝成功；晚到响应及取消清理有界，未回显任意异常对象。

## 采用与复制闭包

| 修改 | 生效载体 |
| --- | --- |
| Worker聚合及Worker自身监控 | 对应最终main的immutable Worker release |
| prepared/tail/helper与status | 对应最终main的完整冻结发布source；历史冻结来源不改 |
| fixed publish-latest及父期限跨环境 | 新控制包经原受控安装/采用；`install-main-prebuild`复制清单含新helper |
| 总控、watchdog driver及watch脚本 | 原真实入口与immutable watchdog安装，维护既有driver-binding资格 |
| 桌面启动器 | 原installer重编译/采用，主页8秒保持 |
| Django复制清单 | 仅新增helper一行，保持已复制prepared/tail的必需静态依赖；没有新增执行路径 |

标准发布继续从冻结source运行，不从Django app/tools运行发布器。Django既有prepared副本也被当作source pin材料；本次保留静态模块闭包，不添加可选timing动态导入的整套发布器。源码修复不表示上述载体已经采用。

## 检查与反审

已执行的聚焦结果：聚合预算/边界13项，Worker与总控38项，watchdog最终48项，定向TypeScript、PowerShell解析/BOM、C#编译与既有隔离launcher检查均通过。发布helper18项、发布回归167项以及其后受影响增量6项通过；167项是前轮回归证据，后续期限/诊断收窄用增量结果覆盖，不冒称每轮重跑。没有生产或业务功能验收。

已闭合的代码反审发现：诊断期间同步取消仍返回成功、单次探测未服从父期限/显式值可放宽父期限、status清环境丢期限、诊断I/O把已就绪改成期限失败，以及watchdog control child的隐藏60秒窗口。按两路原上下文增量复核，核心代码无剩余P1/P2；最终兼容profile结果单独记录。

固定`verify-release-candidate`的精确readiness profile与必要包/入口检查见[COMPATIBILITY](COMPATIBILITY.md)。它是合并前隔离材料，不进入发布器或CI新增生产门禁；不得用旧Pi或apply-timing资格冒充本次范围。最终机器回执与提交绑定在该报告中补记，本候选未获合并/上线授权。

## 最终就绪与交付

两路实现反审及配套资格增量审查均已通过，发现和修正见[REVIEW](REVIEW.md)。同步原维护测试的当前源码字节断言为精确copy pair，历史资格常量与许可保留；两个原维护套件76/76通过。

固定verifier于北京时间2026-11-03 22:52:19—22:55:26执行，11组检查全部exit0，原生REPORT状态passed。报告绑定代码提交`d4ad90b4c6049026f87809ec87cb4bbef3939b44`与tree`af8c4229f5e5a3bd63f16255fa9d0f30682462ec`；后续收尾仅修改文档，源码/测试/依赖字节保持。报告SHA=`f65debafaf77fdf05b1f93b6219bf36436e7c063a092dc1cb0bdb7bb3dabf0ca`。包完整性、实际隔离入口检查通过，未执行原生完整冷启动，未据此宣称生产采用。

候选分支完成后按项目约定推送并保留工作树，等待本次明确合并授权；生产制品只从最终合并提交准备，应用发布和固定控制包/watchdog/desktop的具体采用仍走其受控入口。当前生产e7和已完成记账不被本轮修改。
