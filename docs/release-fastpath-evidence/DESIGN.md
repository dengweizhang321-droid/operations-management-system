# 任务 C：展示证明、原 Worker-only 和准备身份复用

开发基线 origin/main `99eaa0b90149a860d3e286c678ea4b2ab0a27160`，2026-10-10。本次没有生产部署、启停、写入、备份调度修改或外部发送。机制自身首次采用属于严格发布。

## 分类边界

保留 display/business/strict。impact policy 升级为 v2、批次版本升级为 v2；新批准必须重新封存，旧批次和未知结果由原已采用版本的入口核验、协调，不换绑旧批准。

完整差异仍从实际前驱 release/source-snapshot 到最终组合来源计算，绑定两侧完整 tree/inventory、变更字节、候选、依赖、工具链、配置与独立复审。Django manifest 相同只证明后端包身份相同，不能单独授予展示分类。无独立完整闭包证明时仍 strict。

| 变化 | 自动证明的范围 | 超界处理 |
| --- | --- | --- |
| JSX | 客户端组件的文本与普通字面 className；任意值/URL生成类不覆盖 | 服务端组件、API、可执行结构或导入改变进入完整流程 |
| CSS | 同一选择器、属性、规则结构，只改明确展示属性的值（颜色、字号、间距、宽高等） | 资源、URL、@规则、变量定义、content、隐藏/交互门禁、选择器/属性增删不覆盖 |
| PNG | public 下既有 PNG 替换，CRC、IHDR/IDAT/IEND、8位非隔行、尺寸≤2048、解压上限16MiB及行过滤合法 | 新增/删除、SVG、元数据、APNG、其他格式、畸形或尾随内容不覆盖 |
| 本地只读交互 | 无参客户端函数，仅 import useState、单一布尔状态与直接 JSX return；普通 type=button 的精确布尔切换；状态仅控制被递归验证的被动文本/内容及 aria-expanded | 资源加载、表单、submit/disabled、其他事件、自定义元素、赋值/构造/调用/效果/过滤/权限/身份归属不覆盖 |

app/api、route、权限、导入、自动化、迁移、工具、依赖和配置属于受保护面；混合变化不能因 UI 文件占多数放行。真实第三批四文件的查询归属、权限拒绝清理、请求与交互逻辑仍为 strict；没有用人工勾选替代证明。

## 恢复点与数据库步骤

26小时内有效点、7天内同一 manifest/dump 的完整恢复、持续成功日备份、当前软件/目录/角色权限/序列/保留/调度/精确点有效性条件全部保持。每轮收集原 Verify、ReleaseEvidence、Status 和保护根内原恢复回执，不缓存恢复资格。

v2 批次封存 `databaseOperations.required` 及精确 operationIds；完整流程仍强制前后 Backup/RestoreRehearsal，不允许执行中 skipped。资格在任何边界失效都阻断原快批次，不能中途添加/免除已批准步骤。

## 原 Worker-only 流程

仍使用 BeginWorkerDrain → 原 StopForRelease（批次 step=StopWorker）→ 原 apply → 原 Start → EndWorkerDrain。四个步骤必须唯一、typed lifecycle、mutating=true、固定 phase、精确 maintenanceId，且调用被 pin 的原适配器。展示批次拒绝 Django deploy/maintenance、IncludeBackend、额外未证明写操作和伪造 step 标签。

helper、业务任务、备份/background、请求 lease 排空、原互斥、owner、版本/CAS、activation fence、回滚和未知不重放均沿原引擎。解除失败保留 requests gate；没有第二套生命周期实现。

## 有界证据复用

唯一新复用范围是 `workerPreparationIdentity` 的**派生计算**。标准 collector 可在已批准 `transport: in-process-content-evidence-v1` 中复用同批私有内存；普通 subprocess 不获得缓存。collector 的 Node、全部直接/传递工具和 TypeScript parser/package 必须 pin。只接受准确标准 argv，不识别任意 adapter。

每轮仍读完整源/Node/npm闭包、运行配置、实际 npmrc、环境摘要。来源在工具/配置采样前后完整盘点；持续 watcher 仅使证据失效，不替代内容校验。源（包括根 .git）、配置/工具链、缺失父目录创建、watcher错误或观察期间变化拒绝；返回对象为副本，禁止持久 JSON 注入。上下文10分钟、24次上限，禁止并发；失败/中断/退出丢弃。首次、drain、apply、Start及closeout重做完整准备身份。WAL前和原动作紧前再次检查上下文；WAL后失效按原 unknown 协调，不自动重放。

**完整制品不属于新增缓存。** 原 admission/drain/closeout的大树/head校验保留，另加实际 apply 边界；原 apply/Start 自身完整 payload、guard、权限及进程门禁保持。原其他phase没有做大树的行为不算新缓存节省。每轮另用原 `verifyWorkerReleaseProcessState` 现场核验 Worker/helper 精确回执；权限、排空、维护、恢复资格由原现场引擎继续核验。

## 计时及证据

`admissionStages` 记录 classification、来源、工具链、配置、前驱、完整制品/head、精确进程、Status和恢复资格；类别分别为 sealed-evidence / mutable-input / immutable-content / dynamic-state。阶段数组是外层 admission duration 的子项，不能再加进总等待。in-process失败阶段也写原 WAL，去掉路径和原错误值；旧 subprocess失败暂只能保留外层耗时。

[measure.mjs](measure.mjs) 串行、同冻结源/Node/npm/配置/环境及 dist+依赖字节，反转执行顺序测准备身份；不调用生产引擎。普通 Node HTTP 子进程样本只测少重启一个私有进程的差异，**不能证明原 Django/PostgreSQL/Worker 完整切换省3–6分钟**。该完整场景须由 D 在隔离镜像测量。完整 release 验证耗时也不能用 dist+依赖内容哈希替代。

数据库预计48–55分钟来自既有三批生产记录；Worker-only预计3–6分钟、重复检查预计10–20分钟均是预算，只有合格条件和相同验证范围的实测支持时才能宣称。三类耗时不能重复累计。没有为了这些目标删除安全检查。
