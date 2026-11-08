# F01、F02、F03 独立审查

2026-11-08。请求模型 `gpt-6-astra/high`，实际底层型号未独立确认。审查者未参与聊天及测试实现，读取原脚本、原件和直接依赖；只作文件检查及私有 PG 只读查询，没有新增业务请求、取消或模型调用。

## 结论与范围

F01 的代表性分流、F02 的后端 HTTP 流式/取消、F03 的真实 HTTP 未知结果同号保护通过。F03 页面围栏复用已审原组件逻辑证据，不称本轮真实浏览器或 DOM 验收。全部供应商行为来自回环 HTTP fixture，不证明真实模型账户能力或推广报告业务正确性。

审查脚本：`tests/ai-functional-chat.py`、`tests/ai_functional_http.py`、`tests/ai-functional-provider.py`；原 HMAC、Django chat/transport、真实中央工具桥保持。原件根为 `D:/codex-artifacts/ai-isolated-functional-20261108`，下列文件均在该根。

| 项目 | 已核原件及事实 |
| --- | --- |
| F01普通/重复 | `CHAT-ordinary-web-chat-v1-1794130957781-1e470adf-890a-46c9-8364-46539cb52bf2.json`：两次200且相同会话/答复，实际仅一条 provider dispatch。普通问候 toolCalls=0。 |
| F01店铺日期/推广 | `CHAT-routing-web-chat-v1-1794131367522-58b000cf-7f4f-443b-826c-fe2d1ed1d21b-recheck.json`：普通店铺日期问法无推广标记；明确推广有精确店铺/日期、toolCalls=2。独立只读审计核到 `get_data_freshness` 与 `get_jd_promotion_diagnostic` 各自 started/succeeded，edge 日志有真实 consumer。推广为 HTTP200、`promotionStatus=source_unavailable`，不是完整推广报告成功。 |
| F02流式 | `CHAT-stream-web-chat-v1-1794131428118-f2d64dc7-971d-43fc-86f0-9dfa542034a6.json`：三次 delta 到达78/234/390ms，done547ms，回执 succeeded。不是仅在结束时拼接出的 SSE 文本。 |
| F02派发前取消 | `CHAT-cancel-before-web-chat-v1-1794130980023-7eb5c863-879d-4008-a721-95b153fb2562-recheck.json`：Stop200，后续POST499/ai_request_cancelled，GET cancelled/not_sent。独立只读 PG 核到 completed 的 early-stop 墓碑，无普通聊天回执及供应商派发。 |
| F02派发后取消 | `CHAT-cancel-after-web-chat-v1-1794130981148-67873764-668e-4377-a604-9e222a0b85f0.json`：已收请求再取消，Stop先返回 stopping；原调用和同号再调均409/ai_chat_stopped_after_dispatch，GET stopped/finished/cancelRequested=true。独立 PG 核到一条已调用 dispatch，fixture delay 模型仅一条请求。 |
| F03截断未知 | `CHAT-disconnect-web-chat-v1-1794130986470-b557cecb-de38-40b9-bafb-66d4788a9cbc.json`：fixture 声明长Content-Length后截断。首次503/ai_chat_result_unknown，同号409，GET unknown/unconfirmed。独立 PG 核到仍为unknown及一条 dispatch，fixture drop 模型仅一次，未清库或换号补跑。 |

`provider-requests.jsonl` 按模型、时刻、bodySha256与对应场景对账：聊天OK五条对应普通、两个流式、店铺日期及明确推广；delay/drop各一条。普通重复和routing同号重查均没有新增模型POST。日志是持续追加文件，本结论限已核的上述聊天记录，不涵盖其他代理后续场景。

## 页面旧证据复用

原件：`D:/codex-artifacts/ai-repair-batch1-20261107/chat/W3-source.json`、`W3-review-increment-node.log` 及仓库第一批 `REVIEW-W3.md`。原组件 handler + 合成 hooks/fetch 的7/7，不能称真实浏览器验收。

本轮核验 `lib/ai/workspace-recovery.ts`、`lib/django/ai-stream.ts`、`tests/ai-chat-recovery-interaction.test.ts` 原始SHA与清单相等。`app/ai-assistant-view.tsx` 整文件SHA已变化，差异属于模型Schema探测配置；与第一批最终265ef9bb比较，从 `const stopMessage =` 至 `const testConfiguration =` 之前的聊天处理块按UTF-8/LF完全相等，摘要 `240ad45cb36e64cee4ddea848d05b9b0731d3ed02615609b29de75dc3e4b4aa5`。据直接影响复用围栏证据，不冒称整文件未变。

## 保留失败及限制

首次普通请求ID格式不完整，明确not_dispatched且无receipt；后续为修正fixture的新场景，不是重放unknown。cancel-before初断言误写409，实际499契约正确；routing初断言误以为必须HTTP错误，实际source_unavailable分层正确。初失败文件全部保留，同号复核没有新增供应商调用。

本次通过不证明取消能撤回供应商已接收工作或费用；只证明取消后没有新的模型派发，以及状态/回执可追溯。没有真实外发、生产或发布动作。
