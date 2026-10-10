# B 就绪失败证据缺口：独立静态定位

**缺口已确证，当前origin/main同样存在；本轮只读，不改变生产或原21 unknown。** 当前主线按已同步的 `origin/main a3d41827995647e7cd368edf0bf83f44658a4eff` Git对象审查；本地main2f55c396仍旧且没有这两文件，未把它当最新主线。

已采用不可变B `20261010T014638Z-97833d2f2b7e7bc9/tools/release-batch.mjs:426–434`：428行成功取得value后，429的parseStatus、430的assertCompleteReadiness或431额外断言抛错，query直接退出。434行observed.value/result赋值没有发生；437行以后的结果解析catch也覆盖不到该异常。实际进程证据在局部value中，没有附到error，parsed Status也没有限定摘要。主线对应 `tools/release-batch.mjs:500–508`（502–505为同一缺口，511才进入后面的try）。

两版 `tools/release-readonly-retry.mjs:11–14` 字节相同：safeObservationError只在error已有processEvidence时保留安全process，并无Status摘要。35–39行把该缺失的error记录到attempt；42行正确执行NotReady非暂态立即失败。因此原97链第96项只保留STATUS_NOT_READY/unknown，没有原21成功receipt/PID/退出/具体组件。本修复无法事后补造那些丢失的实际值。

最小修复放在readonly query内：让value/status位于捕获作用域，覆盖invoke、parse、完整就绪及全部原op断言。若invoke确实返回，附其真实processEvidence（不把child的真实exit0改成语义passed，也不改原错误码）；解析成功时再附bounded snapshot；始终重抛原error。invoke本身失败时保留原已有process，不发明Status。

snapshot只保存版本、实际运维模型的固定state/backendState/workerState枚举（任何其他值统一unknown）、releaseMatchesExpected布尔、固定12组件的true/false/null、只含这12个已知名字的缺项/非法值列表以及实际/额外字段计数。额外字段名也可能是PII，不能保存；false与缺项/非法值必须区分。**不保存任意reason、原stdout/stderr、URL、argv、正文或客户字段。** 完整输出仅绑定实际进程的字节数/SHA。无法解析JSON时没有parsed snapshot，但仍应保留实际process和输出SHA。

safeObservationError增加该严格白名单snapshot的保存，重序列化须幂等。后续明确采用的新wrapper若有自己的safeAttempt/safeFailure，也必须保留这组限定字段，不能再过滤丢失内层PID/摘要。旧442/295封存代码及既有WAL全部保持。

断言不变：精确release身份、Running/Ready/exact_release、12项均true且无额外项、全部原op assertions、期限/command/closure。4次上限和唯一暂态集合STATUS_TIMEOUT、ECONNRESET、ETIMEDOUT、EAI_AGAIN保持；**STATUS_NOT_READY仍非retry**。诊断摘要只解释失败，不产生passed或receipt，不允许绕过unknown协调。

隔离验证最少覆盖12项逐个false/缺失、错状态/错身份、额外组件计数、非法JSON、真实失败/超时、未知枚举/嵌套对象/customer reason不泄漏、两层摘要幂等与内层Status进程、同一期限与4次暂态上限。成功transport但NotReady的实际进程证据应保持completed/exit0，操作仍失败；不能把“子进程退出正常”等同于“就绪断言通过”。

原文件SHA：release-batch `0b2eb39f495fa7ec92f598c24d2c2d585bf6fe9c8a4eef6278e14a71eb21c944`；主线 `684359a553530d68433198ce3f1341302700f570a485fff269e3e9aa30aa0f75`。两版readonly-retry均 `c520faf92035fa0aa6e2feb7429b3941ebd20fae9fa2234ff35ff1c9ef9cc5ab`。机器定位见 [READINESS_FAILURE_EVIDENCE_GAP.json](READINESS_FAILURE_EVIDENCE_GAP.json)。未调用新的Status/业务请求，没有生产源码修改或下一次执行方案。
