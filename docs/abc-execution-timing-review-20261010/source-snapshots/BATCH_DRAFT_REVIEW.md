# 新批次与验收适配器草稿非作者静态审查

后续处理：主任务撤下未执行的三份新增mjs草稿，原字节保全于evidence/withdrawn-drafts/同名.mjs.txt。BD01–BD10没有宣称修复通过，也没有生成engine batch；最终仅交付[非执行精确范围和门槛](FINAL_RELEASE_PLAN.md)。此审查不成为撤下草稿的执行授权。

2026-10-10（Asia/Shanghai）。草稿尚未执行或封存。本轮只读源码、原接口契约及已准备AB包的文件存在性；未运行测试、构建、PG、adapter、seal 或生产 operator。

结论：**当前草稿有阻断，不能封存为已满足严格保障的批次。** 以下问题须最小修复，并对最终字节重新复审。源码范围和原 AB/ABC 核心复审结论不由此反推失效；本报告针对新增批次/适配器。

被审初稿：`acceptance-adapter.mjs` SHA `cc595ff6ddefd1874ea824dbb500096714a7a094ed2e44dc41db0a8397dba5cc`；`seal-candidate.mjs` SHA `612fa7d5a916b561275620178d2305633228a0cadadd0db83debd85197852fbc`。行号均为该字节版本。

| ID | 精确位置、触发与影响 | 最小修复要求 |
| --- | --- | --- |
| BD01 P1 | `seal-candidate:37,50,53–56` 的PS脚本argv使用拼接或 `D:/...`，files.path由path.resolve归一成反斜杠。`runApprovedOperation`对installedOperator及PS入口与files.path做严格字符串比较；Backup/Restore与lifecycle会在实际调用前被拒绝 | 构建时统一canonical Windows路径；每个实际argv入口必须与其绑定文件path完全一致。保持原operator限定，不能放宽检查来接受任意别名 |
| BD02 P1 | `seal-candidate:65` 绑定 `candidate/tools/release-acceptance-ui.mjs`。实际AB不可变包该文件**不存在**，只在 `source-snapshot/tools/release-acceptance-ui.mjs`；history/report也仅在snapshot。封存会ENOENT，UI导入也不能成立 | UI/history/report使用已核对的不可变snapshot路径，并绑定其真实直接依赖。不要假设全部源码工具都在runtime/tools；保持两者角色区别 |
| BD03 P1 | `acceptance-adapter:55` 调用原watchdog Install没有 `-Execute`，原Install `:350–351`必定拒绝。当前只核installer返回及installation字段，没有实际调用前的精确原task XML/动作/主体/触发/设置绑定；原installer在task缺失时会Register新任务，超出草稿所称“仅更新已有任务” | 使用原受审参数/UTF8子环境、明确Execute；先只读核原任务与批准XML绑定，缺失/变化拒绝，或另行明确批准创建范围。原installer返回契约与script/helper/launcher/installation/task回读均核实；Install/Set/Enable/Start仍只能在最终明确批准后运行 |
| BD04 P1 | `seal-candidate:29–34` 把tests.status写死passed、checks直接赋全strict列表，仅hash证据文件。`:64`让source-assets覆盖business/permissions/migrations/writes，但 `adapter:29–42`只比源码、Django manifest及HTTP资源；没有真实相应验收，输出长布尔标签不能建立覆盖 | 逐项绑定实际通过/未覆盖证据、被测源码/制品与必要等价映射。source-assets只报告已核范围；业务深比较、权限拒绝、迁移/写路径隔离证据、历史保全和原任务验收用具体可复核操作覆盖。不得为封存而缩减严格required断言，也不要求未经批准生产写业务来“验证” |
| BD05 P1 | `seal-candidate:56,66` 把AggregateStatus算作components覆盖，assertions却只有adapter.status=completed。原Django AggregateStatus可返回not_ready的域数据且exit0；lifecycle adapter只是解析并包装，并未验证全部域就绪 | 断言该次操作返回的真实aggregate全部已启用域、readiness与身份，或用原精确Control/Status完成12域断言。collector稍早成功不能替代当前操作证据；保留失败而非把wrapper完成标作组件通过 |
| BD06 P1 | `acceptance-adapter:18–25` 恢复保全没有核原restore sidecar、rehearsal/backupId、dump或expected/restored content与manifest绑定；只有expected==restored可接受一份同样错误的内容声明。没有copy restore sidecar；full-profile重新序列化不能标作原字节，save也未fsync | 对原受保护manifest、完整profile/目录/角色/sidecar与restore原字节逐项绑定，同点/dump/content/id/cleanup/seq全部校验；原sidecar一起保全。derived profile标明派生或以含完整profile的原manifest为权威。create-only写入并fsync，失败不得返回fullRecoveryMetadataPreserved |
| BD07 P1 | `seal-candidate:42–43,51,55,57,65,73` 的command/collector闭包不覆盖实际动态导入/installer工具。closeout只pin候选helper，实际Control加载的是 `D:\运营管理系统\tools\process-deadline.ps1`；watchdog使用snapshot脚本/helper/launcher.cs，native backup还调用evidence Python、Python/PG工具及原加载闭包 | 按实际调用路径完整pin：区分runtime副本、source-snapshot副本、已安装原拥有方与保护入口。原Django deployment/软件身份及原loader需要的证据工具/解析依赖按完整契约绑定；不得靠候选同名文件SHA冒充已安装文件。每个command.files与collector角色分别审查 |
| BD08 P1 | `adapter:47–50` 接受空或部分baseline.files并宣布originalAuditBytesPreserved；没有原审计根/集合完整性和捕获截点见证 | 基线明确固定范围、完整根盘点与不可变原文件集合，保留started/unknown/failed/reconcile原字节；空集合或漏域不能表达“全部”。新增合法文件单独记录；不重写旧操作事实 |
| BD09 P1 | `adapter:44–46` natural-watchdog只保留两条成功摘要，忽略中间失败/异常，也丢失原快照字节、SHA、admission fence/完整身份。两个同release的快照可能来自不同启动边界 | 保全所有新观察的原字节/摘要和失败；两项成功绑定同批准候选与同fence及原完整健康协议。观察期间未知/失败如实呈现，不仅筛成功；不能将自然任务触发效果或TestNotification=false说成已验证无任何自动外发 |
| BD10 P2 | `seal-candidate:25,35` 在全部aux/闭包验证及makeBatch之前create-only写proof/tests。稍后ENOENT/断言失败会留下部分输出，修复后再次调用直接EEXIST；没有明确partial状态或新attempt | 先完成全部输入/闭包/证据验证，在私有新attempt准备；保持原失败材料，最后才发布权威sealed批次。已存在材料只能在逐字节同绑定验证后重用，不覆盖或删除原失败来伪造首次成功 |

## 当前保留的正确边界

- 草稿没有调用execute/apply/lifecycle；makeBatch strict/full 保持前后两次Backup/Restore与原维护排序，没有借C给机制首次采用减免。
- Django candidate/predecessor绑定同一个拥有方manifest，没有DeployApp；Start显式带双manifest与maintenance owner，adapter/helper依赖框架继续沿原引擎。
- 子过程仍用文件协议及preserve；unknown按原WAL保留、不自动重放。B重试只读声明在最终closeout，候选Subprocess collector没有悄悄启用C内存复用。
- 主任务已计划独立watchdog安装的最终授权范围；当前脚本没有执行它，修复也不能在准备阶段代为安装/改调度。
- 批次journal的母操作duration含子观察；新增adapter没有额外合计节省时间。尚未生成原采样/完整delivery文档，不能预写耗时或SLA结论。

## 只读物理路径核对

已准备AB包 `20261010T014638Z-97833d2f2b7e7bc9`：`tools/release-acceptance-ui.mjs`、`tools/release-history-preservation.py`、`tools/release-closeout-report.mjs`均不存在；snapshot UI、watchdog脚本及launcher源码存在。此核对只说明闭包路径问题，不是重复验证该包或批准采用。

未执行草稿负例。修复后至少用隔离fake operator/read-only夹具覆盖canonical argv/绑错helper、not-ready aggregate、假相等restore/sidecar变化、空/漏审计基线、夹入失败的自然观察、缺/变化task，以及输入验证失败不能留下伪sealed状态。真实生产镜像、构建与发布动作仍由主任务按既定串行/最终批准边界执行。
