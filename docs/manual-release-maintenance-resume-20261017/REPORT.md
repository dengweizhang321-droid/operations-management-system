# 已准备发布包的维护前续接

- 原应用来源固定为main `7dcd013f`，Worker plan `13a52b4c622fd915442365a8cbfecd65f567c7445fa88a0bfa86151f56679372`，Django prepared `c663d75d85064d60b70d362de6877a4a`。原失败、两个操作ID和所有原始记录保持；新的控制工具单独交付，不改原source或候选。
- 原维护调用35秒失败，与同一服务mutex内的RunWeeklyReport长耗时ACL核验重叠；非Start原生操作等待30秒。原异常正文被旧入口隐藏，锁竞争有强证据支持，不能据此断言唯一根因。
- 独立Sol核验原actor退出、原Worker进程及回执/前驱/Django部署/intent未变、没有维护或drain及下游操作与对应Begin/End/Cancel审计，排除了原维护调用作用；成功准备候选的作用保留。独立观察单独create-only记录于手动发布目录`resume-review.json`，仅限30分钟内本次精准失败。
- 续接只对固定失败和六个原记录SHA开放，使用原native reusePlan及原Django准备收据，不再build或PrepareApp。独立观察过期/不符、前驱改变、仍有原actor或维护/drain/迁移效果、双击或新unknown全部停止，不提供force或自动重放。
- 新适配器按Worker→Django有界预等，双锁内刷新事实，释放Django后仅保留Worker调用完整原生EnterMaintenance。不能全程持Django：原Worker内部Stop使用另一个PowerShell子进程，会被父进程持锁阻塞；预等仍存在释放后竞争窗口，新失败继续原样保存。
- 后续严格沿原脚本顺序调用部署、必要0015结构迁移、rotation apply、同ID退出维护、唯一Start和必要版本/服务确认，无备份和额外综合验收。
- 隔离验证：9项host/progress/限定观察测试通过；13项真实PS5私有mutex用例有效通过（主体11项及修正测试夹具后两项直接exit增量），覆盖顺序、重入、子进程Django准入、exit/异常释放、超时/废弃、等待后事实变化及全程持Django的负例。父代理首次恰在新增夹具修正前运行的两项语法失败保留，非模块失败。
- 真实只读wrapper `-CheckOnly` 等待当前后台锁释放后返回`premaintenance_admission_verified`；没有执行维护。真正Explorer Desktop ShellExecute的只读环境探针与原候选环境SHA完全匹配，实际BAT须同此环境启动，不能修改原绑定来兼容Codex进程环境。
- 用户最新明确要求修复后实际运行BAT测试。本提交为执行前控制工具交付，实际运行结果以同包新resume目录回执为准，不能据代码合并声称上线成功。
