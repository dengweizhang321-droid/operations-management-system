# PiAgent 二期完整工作环境

2026-10-18。开发基线 `0be03eca5006e40e1bbfa7edb30b66bbd8625deb`，独立分支 `codex/pi-phase2-workspace`。本报告随验证及交付结果更新；源码、验证、制品、生产采用分别判断。没有本次生产切换授权。

## 一期实际核对

- 当前 main 包含一期 `a70f9d1c` 停止准入修复：停止与每次模型/中央工具/导出页在同一权威事务内排序。未另建队列或模型体系。
- 一期固定 Pi 1.3.0、可信扩展 `pi-gateway-v1`、Django 独立操作/派发账本、HMAC Runner、每代持久卷及预置 Skills 均有真实实现。本期保持该版本，按实际包 RPC 协议实现控制。
- 一期整链报告的供应商与业务 HTTP 为合成边界，薄 Worker 路由由 Node 承载，不能倒填为 workerd 证明。本期另跑真实 workerd 贯通链。
- 一期交付回执 `D:/codex-artifacts/pi-phase1-closeout-20261018/delivery/DELIVERY.json` 证明合入、46 个后端回归、5 个 PG 交错和 Pi 整链；原准备因旧 dispatch unknown 被阻断，不表示已上线。
- 只读发布记录 `PUBLISHED-MAIN.json` 指向 `19db6d2c` 的历史采用。它不证明当前健康，也不把后续 main 合并自动算作采用。最终只读核验了正式deployment manifest与签名Runner状态；未执行服务启停或切换。当前manifest与19db回执相同，Runner仍是一期源码908122/镜像c393，二期尚未采用。

## 二期能力与职责

复用 `app/ai-pi-agent-view.tsx` 的 Chat/Agent 控制器、系统主题及组件，新增对话/文件/终端面板和会话、模型、环境菜单。切换面板与刷新仅观察，不自动新建任务或重放输入。

- Django：owner/权限、代际、操作与独立 control ID/seq、普通 UI pending ID、真实模型派发与用量、不可变产物。
- Runner：Pi 原生控制、PTY、文件、资源、容器精确身份与镜像升级。
- Pi：原生推理工具循环、steer/follow_up、bash 上下文、会话树/分叉/克隆/切换/新会话/压缩及导出。
- 模型及业务工具仍走无网络容器发出的可信扩展请求，由 Windows Django 出站并回传。供应商密钥、数据库及宿主控制均不进入容器。

控制同 ID 同内容只读原回执；改变内容拒绝，丢响应不再执行。steer/follow_up 的接收、排队、实际处理分别记账；停止清除队列，保留一期新派发边界。`!` 使用 Pi bash 并进入上下文，`!!` 排除输出；手动 PTY 输出仅经用户引用进入输入框，不自动送给模型。bash abort、Agent abort、关闭终端与环境暂停独立。

文件仅开放 `work`、`inputs`、`outputs` 工作根。保存/重命名/删除携 SHA；Runner 冻结全部会话写者，再由固定辅助容器提交，恢复前检查精确身份。下载先收集确定字节，后续同名文件变化不会改变下载内容。Pi 控制、历史、凭据和受管技能不随文件面板开放。

公开研究只发送用户在研究菜单明确填写的公开搜索词或 URL，在容器外获取并返回来源、时间及证据；不会附带当前模型上下文或业务文件。容器仍 `network=none`，无任意代理出网。外部 GET 读取器固定公网地址连接、TLS 校验并逐次检查 DNS/重定向，拒绝回环、私网、元数据及控制面地址。

用户依赖以官方源精确版本、完整受支持依赖清单及 SHA 锁下载，在用户空间离线安装，跨轮保留。安装脚本不自动运行，不把包变成可信扩展或技能。系统依赖仍由受控镜像更新。

暂停保留工作文件、历史和依赖；后台进程结束后不会自动复活。重置建立新代际并保留原卷隔离；unknown 原件和围栏不删除。升级消费服务端登记的计划，绑定镜像、Runner 源码和协议，使用独立候选卷及恢复材料，保留旧容器与旧卷；兼容性证据不匹配时拒绝。

## 验证入口

原始隔离证据根：`D:/codex-artifacts/pi-phase2-workspace-20261018/`。供应商与中央业务来源使用合成夹具；真实公开 GET 与包源获取单列。没有新增付费供应商请求或正式业务写入。

- `research/public-probe-evidence.json`：公开 Python 网页、搜索及实际 wheel/npm 下载；研究边界 14 项测试。
- `e2e/attempt-20261018T191250/`：真实 Chrome/React/workerd/Django/PG/HMAC Runner/Pi，64.103 秒成功，含一期五轮回归及二期 PTY/文件/暂停链；后续最终源码绑定证据见交付索引。
- `django-real/case-668b49f397/RESULT.json`：真实压缩新增模型派发、模型和思考档回读、下轮采用选择，以及两个 PG 并发屏障。
- `schema/`：真实 150→151 结构、事务回滚、目录/权限、未知不重放及父链证明；最终 recipe 绑定有效记录。
- `review/`：独立审查、原文件竞争反例及增量闭合记录；未参与实施的独立新上下文，请求 `gpt-6.1-sol/xhigh`；工具未独立返回底层实际型号。

## 运行边界

- Pi 1.3.0 没有 RPC 会话 navigate，本期树展示、按 entry 分叉及登记会话切换均与其区分，不伪造 TUI 专属组件支持。
- 普通扩展 HTML/JS 不执行；确认框不升级为业务写权限。内部 capability、模型原始帧及私有思考不进入前端。
- 文本编辑有大小上限；二进制/大文件明确只读或下载，不以空编辑器代替内容。
- 公开研究为受控 GET 文档读取与搜索，不含登录后操作、表单、发送或任意脚本浏览器。动态或拒绝访问的来源明确返回失败。
- 依赖支持精确便携 wheel 和受支持 npm 完整图；不支持的原生构建、sdist、环境标记、可选依赖等明确拒绝，不降低隔离。
- CPU/内存/PID/tmpfs 是硬限制；总工作区字节/文件数为软扫描，可能有窗口超调。超限保留文件并暂停新增消耗。
- 真正未知的模型/控制效果保持围栏；不是中断后任意自动续算。环境后台进程不能跨停止存活。

## 工程交付状态

功能、定向验证、有限结构交付与独立审查已完成。最终 Git、原生准备和运行采用状态分别记录于 `D:/codex-artifacts/pi-phase2-workspace-20261018/delivery/DELIVERY.json`。未取得原生 PREPARED 不称制品就绪；没有生产切换。


## 最终验证补充

- [真实浏览器与传输](e2e-validation.md)、[Django账本与并发](backend-validation.md)、[有限结构与实际包](schema-validation.md)、[PS原生入口](native-validation.md)、[独立审查](review.md)。
- Runner42项真实Pi/PTY/依赖/升级/恢复通过；Windows DPAPI与真实PS5/PS7入口16项通过。提交换行归一化仅影响2个Runner相关文件，AST/JSON等价且其余49个绑定成员逐字节不变；另补2项实际升级探针36.568秒，新Runner源码 `f8546ad39b86cc44416ddd86c96579b972a138503275df9e1296c52f9dc7893f`，镜像 `sha256:ab4ee452bfc6f66dedac6e874dec7ed492b687d24f217c75e80fc9535a26bbb2`。
- Django31项新控制/活动租约测试、原46项Pi回归；publisher47项定向测试；PS5/PS7有限151各21项；151与150 recipe4项、安装器6项；前端8项、浏览器控制恢复1项和完整直接类型闭包0诊断。
- 新的依赖下载租约在外部fetch之前由Django持久派发并取得Runner回执，end不延期，GET不续租，未知或过期保留原操作围栏。
- 只读正式核验：当前Django manifest `a9e3fdb943dfcc558a69982f9d410aff103872712e26e0d50b0cefe3841693e7`；签名Runner源码 `90812210898b7b69269a977a02828a6943adc15651e6ae0c07c664f89fe92407`、一期镜像c393、active/unresolved/unsafeUnknown均0，closing=false。这里只说明本次有证据的采用与执行状态，不代替全服务健康验收。
- 既有全仓类型检查与后端边界扫描有范围外遗留问题，本期未修复；直接类型闭包最终0诊断。后端边界遗留为 `tmall-sycm-cookie-pipeline.ts → n8n-preflight-evidence.ts`，与本次路径无关，不冒称全仓通过。

保留的一期镜像会话在独立Runner源码升级后继续绑定原镜像与原卷，必须使用匹配实际依赖/历史证明的登记镜像计划才能启用新PTY/文件helper；新环境使用新镜像。界面明确展示需要升级，不把旧环境标成完整二期镜像。任意原生包、任意TUI组件和动态脚本浏览器仍在明确能力限制之外。
