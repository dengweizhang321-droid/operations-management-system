# Astra 生产入口 transport 静态复审

2026-10-11。仅阅读源码、做V1/V2文本比较并重算指定文件哈希；未运行runner/bootstrap、生产查询、备份、生命周期、采样器、测试或构建。生产执行由主agent负责，本记录不提供额外操作授权。

## V1结论与V2修正

V1已确认：仅spawn一次原6989入口；argv严格是entry、execute、批准规格path、f15批次SHA和已记录批准UTC；19步骤/原引擎/collector/规格未改。同SID管理员门、Node9a与输入读句柄、NODE_*清理、wx日志保留。

V1发现的具体风险是spawn后先await DIRECT_PROCESS写盘，再注册error/close监听，极快失败可能先于监听。V2的完整diff仅为：在spawn后立即建立outcome Promise并注册两个监听；然后才写DIRECT_PROCESS；等待结构化exitCode/errorCode，并把errorCode加入FINISHED。spawn失败返回null exitCode与显式errorCode；进程返回0仍明确标注需独立验收，未当作全部生产成功。

原argv计算及assert、spawn调用、所有门禁和wx文件名完全未变。V2 prep复用原APPROVAL字节并assert相等，另建V2 binding/bootstrap，不覆盖V1。重复调用同transport会在spawn前因已存在的wx日志/STARTED拒绝，不会由V2自行重试入口。

此修补没有扩大执行范围，已解决所指出的监听注册窗口。它仍是transport：意外终止/证据写入失败必须依原WAL/owner/gates核对，不能靠重跑transport推断或重做动作。

## 实际哈希复核

| 绑定对象 | SHA256 |
| --- | --- |
| runner V2 | `34cd926401d09cbe806c586b4d426e6a5e9656c22192daeb838085957ce9a7b0` |
| 原APPROVAL | `dfd9e3dc69b61c1fb7761fa058d5ee66a519782de1d8d830b28a57df29be835a` |
| 原规格 | `960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b` |
| 原fresh入口 | `69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99` |
| Node | `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de` |
| TRANSPORT_BINDING_V2 | `5eb79ede184e8febed93beee0af1a53ec998b292e4ba8fd861384345263be46d` |
| BOOTSTRAP_V2 | `01641eac44098b6e55836fec7ebf51573214c79bc7ce53fd075822495902edd0` |

五文件closure与APPROVAL/transport/bootstrap的绑定均逐项重算匹配。批准批次仍为 `f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f`。没有发现新的范围扩大或重复执行路径。

## 可用性采样器的指标边界

静态阅读 `sample-approved-availability.mjs`：只对固定loopback Worker静态CSS `/assets/index-BcwbDyNL.css` 做GET，不跟随redirect；单次deadline3秒、响应体2MiB上限，完成一次读取/记录后等待30秒，最长6小时，观察到transport FINISHED后结束。还只读既有watchdog latest，不调用Check、不访问业务API、不触发生命周期。

`exactResource`只表示该次HTTP200且CSS bodySHA与所指定候选资源匹配。它不证明完整业务UI、后端、所有组件或正确release身份，也不区分可提供相同CSS字节的不同release。响应耗时是这次资源HTTP采样耗时，不是用户页面渲染耗时。

30秒是两轮间等待间隔，实际采样间隔还包括请求和文件读取耗时；不能由稀疏采样精确推导完整停机时长或不存在短暂中断。watchdog为已有自然报告，可能滞后，须看其原时间戳；单个healthy字段不是采样时点的全业务健康证明。6小时/FINISHED停止条件也不等于生产验收完成。

本轮未执行采样器，未核WAL或当前生产结果。等待主agent提供最终原始记录路径后，再在明确只读范围内做独立核对。
