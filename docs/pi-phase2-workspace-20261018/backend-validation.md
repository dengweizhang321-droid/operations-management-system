# Django Pi 工作区控制验证

本材料记录二期候选的 Django 服务验证，不表示正式采用或新增真实供应商验收。

## 控制与权限

`GET /api/ai/pi/sessions/<id>/workspace` 只观察状态和原回执；`POST` 使用 `{clientRequestId,command,payload}`。独立控制 ID、会话递增 controlSeq、正文摘要、原 operation 与 epoch/generation 共同绑定。相同 ID/正文返回原回执，改正文拒绝；响应丢失通过签名 `state`/`receipt` 观察，不重新执行 shell、模型、安装或输入。

异步 accepted/queued 与终态分开。存在未完成控制时，模型、会话、重置、升级和新 prompt 保留互斥；兼容的观察、PTY 输入及运行中 steering 使用各自回执。暂停要求原 operation 已确定结束，所有 active 状态均在任何副作用之前拒绝。unknown operation 不因观察到其他已知控制而清除。

容器外的依赖 GET 下载也计入活动。服务先用原 controlId 登记签名 activity_begin，再开始 DependencyBroker.fetch；期限来自控制创建时刻加当前配置任务时限的剩余量。资源安装已受理或下载确定失败后才发送固定 activity_end。两次转换分别先写不可重放的 PiDispatch 和追加审计；开始结果未知不会发起下载，结束未知不会重做安装。GET 不续租。Runner 的未知活动、Django 未确认的活动派发或缺少结束证明的租约，均不能因普通控制已完成而被清除；仅含活动字段的 worker 状态同样检查。

浏览器控制参数按命令精确白名单核验。私有 gateway_response、身份/capability、原始资源 bundle 和文件 action 覆盖均拒绝。公开扩展 UI 使用服务端生成 ID，绑定 owner、operation、generation；旧 UI、重复回答及取消后的新回答拒绝。文件下载按 Runner 不可变 snapshot 的 SHA/长度保存为 Django PiFile，后续通过既有权限下载路径交付。

模型及思考切换须实际 readback 成功，下一轮使用事务内冻结的模型/思考配置；不会修改全局模型设置。prompt 与 pause/model_set 在同一权威事务排序。较早发出的 GET 若晚于新控制返回，仅协调原控制回执，不能覆盖较新的状态、模型与暂停结果。

`workspace.usage` 来源为 Django 的模型 dispatch 账本，最多 100 条，保留窗口和缺用量数量。只显示匹配 operation 模型版本的名称；历史版本不可得时明确缺失。费用为 null 与 not_configured/unknown，Pi 虚拟模型的占位零费用不作为实际费用。

历史控制响应最多 100 条，每条结果投影最多约 4 KiB；原证据保持。大结果显式标记 omitted、原 SHA 与字节数。直接控制响应也有明确投影边界。完整回执与下载只走签名只读观察，不以重复控制取得结果。

## 实际运行结果

- 原一期 Pi 权限、取消、未知不重放和导出回归：46/46 通过。
- 新工作区定向回归：31/31 通过，包括独立 steering、响应丢失及原 unknown 原因保留、action 注入负例、owner/旧 UI 与异常回答预拒绝、停止与暂停、异步控制及独占安装与 PTY 的互斥、不可变下载、模型确认、单店环境快照、历史响应预算与实际用量口径。
- 新增 7 项活动保护覆盖 begin 在下载之前、未知 begin 不下载/不安装/不重发、确定下载失败先 end、未知 end 保留原事实且不重装、GET 不续租且不能清除未知活动、缺少活动状态不等于租约已结束，以及 worker 的仅活动状态读取。
- Django 模型与 migration dry-run 一致，无未生成结构差异。
- 独立 PostgreSQL、签名 HTTP Runner、真实 Pi 1.3.0：3 轮真实对话后执行 compact，产生 1 条新的模型 dispatch，并以真实终态与控制回执完成；实际模型切换、思考 readback 及下一轮 selected model 使用通过。
- 同一真实环境的两线程交错：暂停先完成后 prompt 受理被拒绝；较早签名 GET 缓存到暂停完成后返回，持久状态仍 paused。

最终实际链证据：`D:/codex-artifacts/pi-phase2-workspace-20261018/django-real/case-93cbe74de8/RESULT.json`。执行脚本和 `SOURCE-BEFORE.json` 源码绑定保存在同目录，并确认执行期间绑定源码未变；该轮包含最终用量投影与独占控制围栏。此前成功为 `case-6dd75d4108`、`case-668b49f397`，保留原件。两次初始夹具启动问题分别保留在 `case-f5e2f0d6c9`、`case-c0c3b71528`；没有作为成功证据。

真实链之后增加三处新路径保护：异常 UI 回答在 pending 状态变更前拒绝；workspace operation 继承单店选择；未知控制协调保留原原因的追加审计。随后按空闲条件要求增加容器外依赖下载的固定活动租约与 worker 活动观察。各项均已在最终 31 项测试中验证，真实成功路径的 compact、模型及暂停交错没有变化，未重复整链。[差异绑定](post-proof-delta.json)明确记录真实链与最终文件 SHA，不把较早证明说成最终整文件逐字相同。Runner 的实际租约交接、期限与停止证明由对应原生运行验证单独记录。

实际链使用独立最小 Pi PostgreSQL 结构及原状态/不可变 guard；完整 150→151 有限安装器、角色权限及全目录核验由主交付的结构证明单独记录。供应商 HTTP 为合成接缝，未发送真实付费模型请求。这里不声称已验证任意第三方扩展或生产业务准确性。

## 资源收尾

该实际链的 Runner 已退出，唯一测试容器和所属卷均已移除；PostgreSQL 已停止，55557/55813 无监听，临时口令文件与三轮成功夹具的 Runner 通道密钥已删除。运行数据库只包含合成内容并已停止，原日志和证明保留；没有操作正式服务、正式数据库或旧 unknown 记录。
