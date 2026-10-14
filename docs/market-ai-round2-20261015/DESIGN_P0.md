# 恢复操作 P0 安全契约（规划候选）

日期：2026-10-15。核验基线：`cabf97f1`。本文件只定义契约；实施、独立审查和采用结果由执行报告记录。未执行生产读写、真实模型调用或任务恢复。

## 已核事实

- 历史 `D:/codex-artifacts/market-ai-controlled-resume-20261015/resume-operation.json` 记录单次恢复 POST 返回 503、未重发；随后审计与运行状态确认 02:30:53 已提交。原证据没有可供浏览器关联的 requestId，因此不能把该次历史结果当作新关联协议的验收。
- `backend/market/views.py::_replay_fenced_write` 已有请求 receipt，绑定 requestId、actor、方法、路径、query/body SHA。`commands` 使用 `atomic_completion=True`，成功业务修改和成功 receipt 在同一事务提交。
- `lib/django/market-service.ts::requestDjangoMarketService` 默认每次生成随机 requestId，现异常被归并为 503；公共前端未保存该身份。
- `backend/market/annotations.py::_set_cloud_run` 先锁 job、隔离过期领取，再决定是否恢复。隔离后无可重试项会正常返回 `resumeAccepted=false`，其隔离效果必须提交。现审计只写目标 state，未关联原请求、原状态和结果版本。
- `MarketAnnotationCloudRun` 没有控制版本。`updated_at` 会随调度/心跳等改变；不宜把它当稳定控制版本直接造成运行中频繁误冲突。
- 前端 `post()` 超时文案声称自动刷新续跑，但实际抛出异常；`pumpCloud()` 在 POST 之后才读取进度，异常路径不进入该读取。仅凭当前 running、时间接近或普通全局数据 revision 不能证明原恢复提交。

## 最小完整合同

### 一次命令与持久确认

1. 浏览器在首次发送之前生成不可预测的 `operationId`，保存不可变元组：`operationId + jobId + action=set_cloud_run_state + targetState + expectedControlVersion`。保存作用域至少包含当前账号，不能在换账号后继续显示前一账号信息。刷新后仍能重新查询该待定操作；不要保存身份凭据或原始商品信息。
2. Worker 严格验证这些字段，以该 operationId 绑定内部签名 requestId；原 command 序列化摘要必须固定。操作者身份只能来自服务端 principal，不能信任客户端 actor。操作 ID 只标识请求，不赋予查询权限。
3. 在原 job 锁和原 receipt 原子提交事务内：校验控制版本、任务存在与终态、原权限及 authority；执行既有过期领取隔离、恢复/暂停；写审计；写 receipt。保留失败封顶、未知隔离、租约 fencing、并发退避与供应商冷却规则，不重置历史 attempt。
4. 成功结果携带 `operationId/requestId、jobId、targetState、beforeControlVersion、afterControlVersion、auditId、committedAt、resumeAccepted、effectiveState、quarantinedExpiredClaims`。审计 before/after 同样关联请求与版本。`resumeAccepted=false` 是“命令已处理、恢复未开始”，可能已经提交隔离，不能谎称完全无写入。
5. 同 ID 改 job、state、version 或其他 command 内容仍由现 receipt binding 拒绝。同 ID 精确重放只返回原 receipt；客户端 P0 不自动重发任何 POST，也不依赖现五分钟 processing 清理机制做恢复。

### 状态查询与结果语义

新增专用只读查询，按请求元组查询原 receipt。总控实际核验 market_reader 无 receipt 表 SELECT，因此由 writer 所属服务在受限路径的只读事务中查询，不扩大 reader 权限或通用读路径。查询仍需要当前可操作该功能的角色及原 scope，至少核对 receipt actor；普通其他用户、失权用户或范围变化时拒绝。不要暴露任意市场写入的原始 response_payload、body、actor 或审计内容。

| 返回 | 必须有的证据 | 前端行为 |
| --- | --- | --- |
| `succeeded` | 精确元组匹配的 completed receipt、合法结果、关联审计/版本 | 展示“该请求已提交”；另读当前状态 |
| `rejected` | 原请求明确拒绝且保证该命令业务事务未提交的结构化响应或持久拒绝回执 | 展示具体拒绝；刷新状态后才允许新意图 |
| `processing` | 同元组的 processing receipt | 有界只读等待，禁止自动重POST |
| `unknown` | receipt缺失、读失败、超时、响应格式不合法、无法关联或证据冲突 | 明确“结果未确认”，提供继续查询，不恢复按钮重放 |

receipt 缺失绝不是“未执行”的证明；原事务可能还在进入或执行，现异常路径也会清除 processing receipt。401/403 出现在后续状态查询只代表当前无权核实，不证明原写失败。公开 503（包括代理、解析或响应校验失败）默认未知，不能从文案推导拒绝。

成功 receipt 与当前任务状态分开返回。例：恢复提交后自动暂停，显示“恢复已于 T 提交；任务随后暂停：原因”；恢复提交后完成，显示“恢复已提交；当前已完成”。后续状态不能撤销原成功，也不能从当前运行状态反推原成功。

### 控制版本与并发

推荐新增专用控制版本（单调整数或不可重复 opaque token）；只在改变控制语义的动作推进，不随心跳/普通进度推进。实现可用独立字段，或复用经过审查的现有持久容器，但必须证明所有写者不会丢失/重置该键。仅使用最后一次人工恢复审计 ID 不完整：它漏掉自动暂停、取消、完成及 ABA。

版本必须覆盖人工恢复/暂停、自动暂停/完成、取消/删除/提交等使恢复不再合法的转换。已有无token任务可以读取一个明确初始token；第一次更新须在相同锁序下升级，两个客户端同初始token只有一个成功。普通心跳不得推进版本，后台状态变更与人工控制使用兼容锁序。

终态保护在收到请求后、取得锁后复验，不能依靠浏览器按钮。取消先提交则迟到恢复失败；恢复先提交则随后取消生效，原恢复 receipt仍为成功。不得为“最后点击优先”覆盖未知事务或重设失败次数。

与实施者协调后的最小存放方案可使用 `retry_state_json.controlVersion`，避免本轮migration：所有 `retry_snapshot` 重置/回写必须保留token，控制转换才生成新token；不存在只允许兼容旧行，已有畸形值须拒绝，不能回退到初始版本。取得job锁后仍须锁住并刷新run再验CAS，因为同模型配置暂停可只锁run。多run按稳定job_id顺序处理，持有run锁后不得逆序再取得他job锁；有界批处理不能截断本应暂停的同模型计划。把token与job终态一起hash可以额外防御，但不能替代cancelled→queued等ABA路径的token推进。此为实施方案选择，仍须独立审查验证所有写者。

### 前端等待与取消

- 每个账号/job/操作维护独立 generation；同 job 未决时不启动第二次控制写。换 job、卸载、角色变化取消本地读取，并使旧回调不能改新 job 的 notice/error/progress/busy。
- 点击取消等待、页面离开、AbortSignal 触发不等于服务端取消命令；保留待定身份，可稍后只读核实。不要自动发送相反的暂停补偿。
- 首次 POST 失败或期限到达后进入“正在确认恢复结果”；在统一有界等待预算内轮询 receipt，单次查询也有界。预算耗尽保留 unknown，提供“继续查询原请求”，不承诺自动续跑。
- 正常进度轮询与 receipt查询各自有 generation；旧 receipt只能更新其原操作结果，不能用旧 `effectiveState` 覆盖最新服务端进度。已验证的迟到成功可在原操作记录中确认，但不跨job展示成功横幅。
- 不在P0普遍提高市场SDK超时、不让浏览器承担派发、不触发额外模型调用。现 `persistConcurrency` 是另一命令，不得误归到恢复receipt；若其结果未知，按自身真实状态表达，不能声称整组原子成功。

## 直接受影响的验收反例

1. 服务端提交后连接断开/503：只读 receipt确认成功，总写命令与审计各一次。
2. 请求尚未进入/processing/receipt读取失败：保持未知；不同job的running与别人的相邻审计不能闭合。
3. 错 actor、错 job、错state、错digest、错operationId、错版本：拒绝或未知且无越权泄露。
4. 预提交明确409/403与提交后查询403分开；HTTP200却坏结构不能冒充成功。
5. 恢复后自动暂停/完成：原操作成功、当前状态真实；旧receipt不覆盖新状态。
6. 两个同版本相反控制、取消与迟到恢复、ABA：只有符合版本与顺序者生效。
7. 页面切job、卸载、取消等待、旧Promise finally：不能覆盖新操作busy/提示/进度。
8. 旧过期领取隔离后无重试单元：receipt记录已处理且resumeAccepted=false，隔离提交、无新增调用。
9. 历史失败封顶/未知项不重领，租约/权限/authority拒绝仍生效。

无真实模型调用即可用隔离 PostgreSQL、签名SDK/route接缝和前端受控时钟验收这些语义；生产历史503仅是问题证据，不替代新实现验证。
