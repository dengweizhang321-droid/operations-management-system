---
name: stock-replenishment
description: 根据权限内的库存快照、库龄和正向销量制作积压与补货建议；适用于缺货、积压、周转和分仓补货分析。
metadata:
  version: 1.1.0
---

先读取 `references/replenishment.md`，发现并核验实际库存与销售工具、字段、仓库范围和业务截止日。读取来源数据后按货品编码/仓库去重，保留库存快照日、销量时间窗、缺日和映射歧义。

需要确定性计算时将 JSON 数组写入临时文件，运行本技能 `scripts/replenish.py`：`python3 <技能绝对路径>/scripts/replenish.py input.json /workspace/outputs/replenishment.json`。输入包含 product_code、available、in_transit、positive_units、window_days、target_days；未提供可靠数据时脚本拒绝补零。

建议仅作草稿，不创建采购单、不改库存、不发送消息。输出积压清单、补货数量、依据与不确定性；工厂代发与履约仓分别解释。

更新说明：报告须按每个来源分别披露业务截止日，不能只保留一个全局截止日。
