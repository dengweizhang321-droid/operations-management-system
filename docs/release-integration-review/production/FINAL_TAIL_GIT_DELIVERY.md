# 尾部方案 Git 与材料交付

截至2026-10-11本次交付，精确方案 `442bcb34d2734f5767e4b612cb1816dfd3ae3a1c25fa92b22d057041f8171c6d` 仍未新批准/执行，AB整批未闭合。用户最后批准的295d源合同已采用，原NotReady、unknown和所有权保留。最终批准范围见 [方案](FINAL_TAIL_APPROVAL_PLAN.md)。

| 内容 | 提交/回读状态 |
| --- | --- |
| 295d实际结果及停止证据 | `df128e085c4f983990b5c26127026313ce940323`，已正常推main/D |
| 新尾部实现 | `1c81e6e27ed0bfe4647e0acb8d4893d52b119186`，非作者复审通过 |
| 合并最新主线后的源码 | `f4df84728fdc81a8b617d423dfff72be9e6a5871`，封存sourceCommit；main/D/tail逐ref回读一致 |
| 精确范围和封存复核 | `0a98982d94fceef0ae1bddef73a89c22b2a48231`，main/D逐ref回读一致；tail继续f4df源码 |

46个本轮公共源码/报告与上述Git原对象逐字节一致，create-only保全于新E root的 `DELIVERY-0a98982d`；`FINAL_DELIVERY.json` SHA `116b64860665a19acc999d66a08c536122eabd0dd0eaa70de961082829f73e78`。它是候选/报告交付，不是AB完整生产交付。原111件实际执行证据继续保全在E295/ACTUAL-89-20261011，manifest70d1fa99，原文件不覆写。

本文件是另一个纯文档收尾提交，其最后提交及远端回读以新E root的 `GIT_DELIVERY_FINAL.json` 为准，不修改原scope、sourceCommit、原FINAL_DELIVERY或任何pin。代码31文件/四SHA与源码Git、独立报告匹配；全4718实际物理检查已通过，不为文档收尾重复执行生产验证。

主目录用户原六个修改及三组未跟踪项、local main2f55保持；固定应用源检出5fa干净，D/尾部源码工作树保持。原D46文件与旧源证明producer3仍逐字节匹配旧scope。工作树仍被当前验收/物理pin引用，保留，不以源码合并为由清理或采用主线其他功能。C及无数据策略未由本方案生产采用，未来第二批须重新准备新实际前驱。

没有新增维护、启停、部署、调度、Backup/Restore、业务写入或外部发送。本轮唯一真实生产补充是用户批准295d对应的已记录执行；本文件不授予442b新协议执行权，也不把后来单独Ready改写成原21通过。
