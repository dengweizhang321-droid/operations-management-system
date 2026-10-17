---
name: sales-promotion-inventory
description: 联合分析销售、推广和库存；在比较店铺商品表现、投入产出与可售库存时使用，输出来源、截止日、指标口径与数据缺口。
metadata:
  version: 1.0.0
---

先读取 `references/metrics.md`。通过 system_tool 调用中央目录中实际存在的发现工具，核验当前用户可读的数据集及字段，再取所需范围；不得发明数据集名称或直接使用数据库、SQL或URL。

销售、推广、库存分别保留来源、scope、截止日、水位、完整性和币种/单位。按实际商品编码映射关联，歧义行单列；金额分不自动乘除100，退款负值保留。推广归因只报告关联，除有实验依据不能声称因果。

如要在容器中合成分析，可把权限内结果保存为 JSON，运行 `python3 scripts/join_summary.py <input.json> <output.json>`（脚本路径相对于本技能目录）；输入形状见脚本。将最终可下载文件写入 `/workspace/outputs`。

输出销售推广库存联合摘要、可执行建议、缺失字段与证据限制。没有可靠成本、库存日期或订单依据时保留未知，不补零。
