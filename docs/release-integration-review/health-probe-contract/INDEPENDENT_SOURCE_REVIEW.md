# 健康探针契约独立源码复审

结论：隔离源码候选通过非作者审查，无剩余源码阻断。生产执行未批准，本结论不证明实际 1cae Unresponsive 根因或 AB 闭合。

- 基线：3ea0271dc6ba711a5484e27eb9bd2bd33ddfa84f；分支：codex/release-health-probe-contract。
- 最终 control SHA：37d329c1a9e5a06f5d04ffd2d73be415d327f1e9c5d66957197a189bd9c09529；retry SHA：1139287b2f9633dce57d7ea0b525e082c66382f521577c594817119f3f234ef6。control 保留 UTF-8 BOM、LF。
- 两作者测试 SHA：c5b9b5e1b795c34f272ef7e52febda95943d8f43014abec38eba7f6b896fba20；2f1e5f3834fd01e2775d9f2a2552e6c04077b9257bbec0641d851b0fcf122df1。独立脚本 SHA：e807316f2880a69cb13cb24bbf6afd9f72fc11b21ed91cc74b8d9feade32695f。

ready 外层 5 秒覆盖 Worker 内部最大 4 秒；live/helper 仍 3 秒。三探针共享继承绝对期限，响应全文读取后及最终状态返回前核验。原完整就绪、身份、12 组件和四类暂态重试均保持；没有新增生命周期动作。

三项静态缺口已闭合：control:443–444 的 degraded status/code 必须为字符串且大小写精确；control:474/496–501 的缓存及最终返回核共同期限，先保存真实摘要再拒绝迟到 Running、不更新健康缓存；control:768 的既有错误 JSON 现在带受限 healthEvidence，StatusError/exit1 保持。

独立 10/10：7 项 PS5/AST 健康函数、3 项纯投影，8 个真实 PS5 进程均 exit 0 且 signal 0 确认自身 PID 不存在。2026-10-10T23:21:07.438Z→2026-10-10T23:21:18.566Z，11127.4399 ms。只用自建随机回环/临时目录，无 ControlMain、生产端口、业务环境或生产请求。覆盖 chunked 全响应晚于旧 3 秒但早于新 5 秒、三探针耗同期限、缓存 state/trace 同 checkedAt、摘要迟到拒绝及隐私/幂等。实际被测 control SHA 为 dadd5ac892cdc0cecc8bf5fc00a7ddd4f6612525aebc405ff065720e4e83c9fe，源码前后一致。最终 control 的唯一后续增量是错误 JSON 字段；机械移除该行得到原被测 SHA，已静态覆盖，不能说独立 10 项运行在最终字节。

作者最终 23/23 与独立 native 串行：2026-10-10T23:23:52.522Z→2026-10-10T23:24:24.485Z，31962.3476 ms、exit0，最终 control/retry 前后 SHA 一致。原日志 SHA 0537ad701b07b604293cee102fcb9d3260a1a32c51ad5b5356d1b96ddd0bf056 已独立核字节与 23/0 计数。独立与作者套件不相加为不重叠覆盖。

独立 FINAL log SHA 1d2894abe46637f5c8981b3d7e28e7742707e2b0c94808aae59da95ede21c6d2；stderr 空 SHA e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855。首轮 9/10 原日志/metadata 保留，唯一失败是夹具旧预期为过期返回 Unresponsive，而新最终守卫正确抛异常。只修夹具为 caught=true/state=null、原摘要保留、不更新健康缓存及各 probe 严格断言；作者源码未改变。FIRST log SHA a4b946fcdb1b3871084e47a17951990af1cbc43be4d9d491fada02de094beff1。

边界：CLI 错误 JSON 现在可带已存在的受限 trace，但旧 runReadOnlyProcess 的非零退出传输仅保留 native 过程与 stdout SHA，不保证解析该 body。未来外置候选必须另明确捕获失败 native 输出才能声称端到端摘要覆盖；子进程被杀无输出不能补造摘要。正常 Status/NotReady 摘要固定 live/helper/ready、布尔/有界数值/枚举，重复过滤幂等，不保留正文、URI、原因或未知字段；旧状态不伪造 trace。

本轮没有部署、候选构建或更改实际入口/旧 4771 pins。原 102 条失败保持；后续新只读候选需另行封存复核和精确批准。
