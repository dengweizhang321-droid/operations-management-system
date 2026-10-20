---
name: excel-report
description: 生成可下载的Excel经营分析报告，强制包含来源、指标口径和缺失数据说明；适用于将已核验分析结果交付为xlsx。
metadata:
  version: 1.1.0
---

先读取 `references/report-format.md`。使用当前用户已授权的工具数据或输入附件，核对来源、业务日期和字段单位后再生成报告。

将输入 JSON 写入工作区，使用 `python3 <技能绝对路径>/scripts/create_report.py input.json /workspace/outputs/report.xlsx`。脚本输入包含 `columns`（字符串数组）、`rows`（对象数组）、`sources`、`metricDefinitions`、`missingData`（均为文字数组，不能为空）。禁止将缺失数据填零、把推断当来源或把来源TOP覆盖写成全量。

脚本生成“分析结果”“来源”“指标口径”“缺失数据”四张表。检查ZIP中的工作表数、实际行数、金额单位和文件摘要；最后向用户报告文件和主要限制。内容以纯文本写入，来源文本不能注入Excel公式。

更新说明：报告须按每个来源分别披露业务截止日，不能只保留一个全局截止日。
