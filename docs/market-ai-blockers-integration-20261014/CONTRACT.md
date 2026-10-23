# 第一轮阻断修复共同契约

共同开发基线：`b8cbdd435e12970d572328978f352f5ce1605830`。A、B分别在独立分支及工作树开发，由总控集成，不另建用户聊天。

沿用 `complete_task`：成功结果为 `result`，耗时为 `result.timing`；失败为顶层 `error`、`failureCode`、`failureKind`、`retryAfterMs`、`timing`。timing继续使用 `imageLoadMs`、`imagePrepareMs`、`modelCallMs`、`totalMs`、`inputBytes`，不新增数据库列或公开接口字段。

`failureKind`沿用 `transient`、`rate_limit`、`permanent`，未知结果使用 `unknown`。已确认的模型配置或供应商协议错误为 `model_configuration`；普通HTTP400需检查错误证据，不能一概归类。正文空、截断或无效结果为 `model_response`。POST发出后未收到完整结果为既有 `inference_result_unknown`，服务端隔离该图片身份并暂停，保留历史失败次数。

服务端领取返回的 `jobId`进入视觉适配器内部参数，作为OpenCode稳定任务会话依据。连接探针使用独立、诚实的探针身份。标注请求使用独立非思考参数，保留已保存全局模型配置与其他AI功能参数。

同一租约只创建一个固定完成请求身份，存储重试复用结果，不重新调用模型。A/B共用现有12并发与双租约、防重复、维护排空、权限及人工复核契约。

真实验证共用原追加账本 `D:/codex-artifacts/market-annotation-chain-audit-20261014/provider-call-ledger.jsonl`，启动核数20次，上限50次。历史成功不代替本次结果；新验证加载干净、已提交候选源码，并绑定提交与文件摘要，不由审查脚本注入会话头或修改思考参数。
