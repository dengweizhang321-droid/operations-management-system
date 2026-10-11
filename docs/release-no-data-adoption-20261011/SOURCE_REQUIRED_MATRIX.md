# 来源、执行者与旧消费者矩阵

| 环节 | 实际来源/行为 | 必需绑定或采用条件 |
| --- | --- | --- |
| 旧前驱证明 | 原immutable AB verifier/resolver验证其旧manifest/谱系 | 不修改旧包、旧记录或前驱参数 |
| 新在线producer | 独立已审查工具读取指定canonical绑定文件+SHA，保留原锁/前驱/CAS | 同一完整source identity；只准备，执行另批 |
| 新manifest | source中可选sourceBinding原字节，完整源tree/inventory和toolchain对应 | 新verifier理解可选字段；原schema不带字段继续接受 |
| 新typed plan与receipt | 同一envelope进入plan；receipt绑定精确plan/candidate manifest/identity | 四方不一致不能回退默认来源 |
| batch+标准collector | 批次先验证source binding；collector回读真实plan/manifest/receipt/sidecar再选源 | in-process session必须同根，原全字节与现场门禁保持 |
| 固定主入口Start/Status | operations-system-control调用同目录worker-local-service，后者调用同目录rotation | 原installProtectedEntrypoints包含worker verifier、rotation、service，切换前原子装入受保护根；不能提前覆盖旧入口 |
| 登录快捷方式 | 原apply后重绑候选release的worker-local-service | 候选同目录新resolver/verifier；原VerifyStartup仍需回读 |
| runtime supervisor | 从自身immutable release导入worker-local-release | 候选包包含兼容verifier；PS service只严格查manifest顶层/processIdentity，source细节交verifier；没有增加顶层未知字段 |
| installed Django Backup后release retention | installed维护器调用colocated release-payload-retention.ps1；其JS导入colocated旧rotation/worker verifier，PS后置再次resolve | **现装旧工具不兼容新plan/source字段。必须用原PrepareApp/DeployApp准备精确工具更新，不能忽略retention失败或称整个备份阶段已闭合** |
| Django工具准备来源 | 原脚本ExecutionRoot为其自身所在源码父目录，PrepareApp固定复制backend/config/tools/drizzle/runtime-tools并绑定原app前驱 | 可使用自有完整来源副本；backend/config/drizzle/运行依赖必须与实际installed字节等价，仅更新两工具；最终Django manifest会改变 |

实际installed PrepareApp清单已有worker verifier、rotation、d1-retirement-proof及release-payload-retention；未列collect-d1-retirement-proof/process-deadline。当前已退役D1的普通resolver/retention路径只需实际静态d1依赖；process-deadline字符串在verifier中是候选guard文件要求，不是colocated脚本导入。不能为泛化恐惧私自扩清单；如后续真实使用路径发现缺模块，须单列证明后按原准备能力处理。初始D1采用动态collect路径不在此次范围。

十文件是相对AB的Worker运行源码变化集合，另有必要Django工具包部署身份，不是全系统仅十个文件。历史authority/链中Django237引用不改写；新应用包身份由原PrepareApp前驱/候选收据和batch Django绑定体现。本文只是实际接口与必要条件，不代表已经准备、部署或批准新Django应用。
