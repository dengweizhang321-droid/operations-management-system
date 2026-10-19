# 四项发布优化与 PiAgent 三期组合发布

## 授权与范围

用户在本会话明确授权：打包完成后，将本轮四项优化与 PiAgent 三期业务执行统一发布。首次冻结应用来源为`4072d666f1f3d85a5a1a93342196587446f08a71`；它包含四项优化与 PiAgent 三期交付，不以聊天名称作为来源证明。

范围为Worker、Django、AI结构`151→152 / ai_assistant.0086_pi_business_actions`及Pi Runner/Skills 1.2.0升级。原生制品已于2026-10-20 02:06:30（上海时间）准备完成；PREPARED摘要`4cb926c1d0dc8fb2e0a7c2a1f3ddc5ff2d3faf95ee1f5ad310d9103a63e670f8`。准备完成与应用发布完成分别判断。

本次不执行真实工作计划/补货写入、n8n补缺、机器人发送、候选工作流激活或业务功能验收。上线后的功能及业务行为由用户检测；只复用必要代码检查和发布工具原生门禁。

## 执行与证据

- 工作树外的原始授权、普通权限Task材料、真实token、原生操作记录保存在`D:/codex-artifacts/combined-release-20261020/`。
- 当前调用方为管理员，通过同SID/交互session、InteractiveToken/RunLevel0的无触发器一次性Task交给普通进程。实际Node token已确认`elevated=false / integrityRid=8192`，不是只看Task定义。
- 薄操作入口绑定完整target、控制代际、配置、PREPARED和工具字节，使用原协调器的queue lease→native rotation及`deployReadyMain`，不重新选目标或重建包。原native STARTED/unknown、权限、进程身份、排空、维护及启动门禁保持。
- 传输入口只接受这次固定发布，无任意命令、定时触发或自动重试。启动前校验已绑定配置的原始字节，清继承环境并拒绝Node/Git启动注入字段。入口及该增量已独立复核。

## 完成状态

原4072制品的两次调用均在维护前拒绝，尚未上线。必要兼容修复69b38d1e已合入main，新制品准备中。此工作单在原生SUCCESS出现后补齐最终版本、迁移、Runner、回执摘要及计时；不能以Task已启动、旧全局成功索引、PREPARED或进度文件作为上线成功。

## 已保留的发布前拒绝

首次调用在02:16:32（上海）复验后台包时，因Django服务mutex等待30秒后未取得锁而退出。精确源码在调用VerifyPreparedApplication回调前拒绝；原生进程exit1及30.632秒、原Task退出、对应日志和未进入维护/部署的状态共同核实，不单凭无STARTED推导结果。前端复验及日志写入已经发生，不称整轮“零作用”。

独立审查和定向恢复规划支持一次同目标、同原请求、同PREPARED的完整新鲜复核。02:24:45只读观察确认该mutex对象已无持有者；保留首次失败、Task、凭证及发生过的核验，新外层目录仅存独立调用记录，继续原queue→rotation、普通权限和全部原生复验，不修改包、不重建、不跳检查，也不创建替代native请求绕过未知结果。资格和观察记录在外置证据的`premaintenance-recheck-1/`中。

## 当前前驱的精确兼容修复

第二次完整复核已通过Worker、Django和Pi升级计划；02:33:48在维护前被旧前驱资格拒绝。线上实际Django manifest为`00058fea…`，旧记录仅认可`ca9c731a…`。未进入维护或部署，不继续重放4072；原包、请求、两次失败及普通权限回执原样保留。

新增`nativePiBusinessPredecessor`精确绑定当前Worker release/manifest、Django manifest、已安装和候选AI/core/Worker/transport完整摘要；旧资格不替换。已安装和候选Wait/Stop函数字节均符合原审定值，实际停止调用链和45秒receipt/control/ack协议未变。core差异只涉及Pi152准入、制品库存与环境字段；维护、排空、锁和停止路由函数字节未变。未知组合仍拒绝，不用context hook代替原资格器。

必要代码检查为83项发布控制/私有入口检查全部通过、78文件语法与未变151→152迁移闭包、真实静态readiness及原生只读preflight Check通过。该次只读Check调用来自当前管理员上下文，未冒称普通权限生产准入；实际发布仍由普通用户原生门禁新鲜检查。未执行功能验收、业务接口或真实业务操作。外部原始日志见`compatibility-tests-configured.log`、`compatibility-preflight.json`、`compatibility-ast.json`。刷新Pi152 code-only证明写入本目录，旧证明原样保留。
