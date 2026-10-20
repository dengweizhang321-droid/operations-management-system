# 明确失败与取消

1. 正式新会话第二轮：`pi_gateway_unknown`，第一次本地`read`准入失败；原操作保留unknown，不重放。
2. 私有attempt 1：模型生成与XLSX具体预览成功；夹具误读`preview.recipient`，在`preview.details`外取值导致`KeyError: 'recipient'`。异常发生在专用confirm调用之前，正文和附件均没有派发。已修正夹具，原日志未改写。
3. 私有attempt 2：合成文件复制/收集成功，随后用户要求停止。当前seq2经原service.abort取消，终态`canceled`，测试的“必须succeeded”断言因此失败；不将其当成产品完成或重跑理由。

原始日志、两份模型生成合成文件及逐文件SHA保全于`D:/codex-artifacts/pi-unified-chat-20261020/live/`。实际正文与PDF/XLSX附件投递未完成验收。
