# Pi 原生能力补全实施契约

用户已批准四步方案并要求实施。默认执行模式，按需转计划；计划强约束；子代理独立环境并支持原授权业务；Skills仅内置。未授权生产切换、真实付费模型、业务操作或外发。遵守AGENTS现行必需代码检查分工，不新增/执行功能测试或验收，用户上线后自行检测。

1. 模型可调用questionnaire：多题、选项描述/推荐、自由填写，持久化原问题与一次性回答；固定可信扩展经现有ctx.ui.input专用title pi-questionnaire-v1传递version=1的结构化请求，Runner识别后网页渲染；响应仍extension_ui_response.value(JSON)。禁止照搬TUI custom。绑定operation/generation/tool call，取消/过期/重复提交明确处理，不把答案当业务授权。
2. mode_set与计划revision：根树持久modeRevision/admissionEpoch，所有后代gateway、本地工具、业务准入逐次核验。计划只读取数、固定分析helper、save_plan；禁任意bash/Python/PTY/安装/一般文件写入。切计划先阻止全树新增执行，再排空；unknown保持切换中。转执行由用户绑定planRevision/scope/tree版本，不允许模型或旧回答升级。计划结构包含目标、约束、步骤、交付物、待定事项。
3. agent_spawn/list/send/follow_up/wait/cancel/close完整链：每child独立PiSession/容器/operation/capability；默认继承实际模型/强度/skills快照，权限取交集，显式上下文和文件，不复制父完整历史或凭据。支持嵌套与依赖，默认每root三个并发子run（可配置）。send不唤起idle、followup唤起/排队、wait持久集合和游标、先登记后检查，事件/消息/取消/超时唤醒且不占执行槽；RPC继续读。避免祖先等待占满子执行资源。业务新增delegation绑定原actionId/意图/child/版本，唯一owner CAS；child保自身身份，不能复制新意图或冒充父operation。取消/权限变化/到期立即失效。交接不可变文件快照绑定源/目标/generation/scope/SHA，每次读取重新授权。根turn结束≠整树完成，问答/交接/unknown仍存活；close只释放已终结资源，保留历史文件。
4. 复用现有steer/follow_up控制，新增目标代理/真实队列与清队列反馈，停止先clear_queue再abort。历史树可视化，使用get_fork_messages有效起点；fork/clone不回滚文件业务，不复制队列/授权/child树；计划副本变新草稿。真实能力显示，不伪造navigate。thinking档Pi/provider交集，补max，请求/实际/待生效值，安全点生效，不降档，保留长上下文/输出/时限，不公开私有思考。
5. Skills原生解析/发现/渐进读取/显式参数/relative resources/disable-model-invocation/allowed-tools/diagnostics。仅审核内置根，不扫描workspace或宿主。包版本与正文metadata分离，取消正文必须自定义version和name必须目录的额外限制；按固定顺序原生冲突诊断；全资源manifest校验仍保留且新增资源类型显式登记。分清discovered/selected/read/invoked/executed。安全点reload，固定每轮与child摘要。

统一API复用POST workspace controls，新增mode_set、plan_save和agent_*；现有ui_response扩结构化答案。新增中央系统工具仅lib/ai/tool-registry.ts唯一声明，受surface/risk/roles/scope约束。所有后端权威Django，Worker薄适配。新结构仅迁结构，需原生recipe/角色/readiness/备份清单/Runner升级材料。四阶段均要真实接线，不能仅DTO或UI占位冒称完成。

协作分工：backend代理拥有backend/ai_assistant、lib/ai中央注册和工具、领域业务delegation；runtime代理拥有backend/pi_runner、containers/pi-agent与本地执行策略；frontend代理拥有app/ai-pi-*与前端契约；root负责文档、发布结构工具/有限recipe、交付整合和必要代码检查。代理不得自行转派，不改他人范围；接口先消息对齐。不要提交/合并直到root统一安排。
