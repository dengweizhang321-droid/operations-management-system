"""Explicitly installed operational guidance; never permissions or schedules.

The original library defaults (including historical version zero) stay frozen.
All presets use the existing reviewed report runner and existing tool surfaces.
"""
from copy import deepcopy


COMMON_STEPS = (
    "先用 get_data_freshness 核验各来源的真实截止日、精确范围与覆盖。"
    "仅使用本次工具目录实际允许的只读工具，严格沿用 workflowInput 的范围和日期；"
    "工具不能表达或证明该范围时列为不可核实，不扩大范围代替。"
    "查询截断、缺数、无权限或不可用须披露，不能推断为零或已完成。"
)
COMMON_RULES = (
    "结论先行；事实、假设、建议分别标明，金额注明币种与单位，保留真实来源日期。"
    "跨来源金额不相加，区间访客不得用逐日或逐SKU人数相加代替；比较周期必须明确且覆盖完整。"
    "行动清单最多10项，每项写对象、依据、建议动作、待确认责任人及复查指标；责任人未知写待分配。"
    "只生成待人工复核的报告，不创建业务任务、改库存/投放、补跑自动化或发送通知。"
)


def _preset(key, name, description, cadence, scene, period, domains, keywords, method, steps, sections):
    skill_id, template_id, pipeline_id = key + "-skill", key + "-report", key + "-pipeline"
    return {
        "id": key, "name": name, "description": description, "cadence": cadence,
        "scene": scene, "defaultPeriod": period, "pipelineId": pipeline_id,
        "bundle": {
            "skills": [{"id": skill_id, "name": name + "方法", "enabled": True,
                        "description": description, "keywords": keywords, "domains": domains, "body": method}],
            "templates": [{"id": template_id, "name": name, "enabled": True, "scene": scene,
                           "format": "html", "sections": sections,
                           "dataSteps": COMMON_STEPS + steps, "writingRules": COMMON_RULES}],
            "pipelines": [{"id": pipeline_id, "name": name, "enabled": True, "scene": scene,
                           "templateId": template_id, "skillIds": [skill_id],
                           "description": description + " 核验取数→分析与行动建议→人工复核→下载。手动启动。"}],
        },
    }


PRESETS = (
    _preset(
        "ops-daily", "每日经营检查", "每天查看一家店的经营变化，优先处理有证据的异常。",
        "建议每日数据导入核验后手动运行", "weekly", "yesterday", ["sales", "netshop"],
        ["经营", "日报", "店铺"],
        "先核对数据截止日和指定店铺身份，分别说明ERP销售、平台交易及广告归因口径。"
        "如无同口径同长度完整对比，不计算增长率。聚焦销售、退款、流量、转化的真实变化；"
        "数据不足时先列补数或核实事项，原因必须区分证据和假设。",
        "使用 get_netshop_performance、get_netshop_page_data 或 get_sales_summary 中能表达精确范围的查询；"
        "不以跨店汇总代替单店，不把当天未结束的数据当完整日报。",
        ["经营结论", "范围与数据完整性", "核心指标与变化", "异常及待核实原因", "行动清单"],
    ),
    _preset(
        "ops-inventory", "库存与补货检查", "按明确仓别核查缺货、积压和备货跟进，形成补货建议。",
        "建议每日或补货决策前手动运行", "inventory", "last30", ["inventory", "sales"],
        ["库存", "补货", "备货"],
        "库存为最新快照，输入日期用于销售观察，不能把最新库存标成历史期末。"
        "沿用服务端仓别、健康分类和周转口径，库龄与库存周转分别说明。"
        "已有备货计划须核对，避免重复建议；没有销量、可用库存或到货周期依据时，不编补货数量。",
        "用 get_inventory_health、get_inventory_page_data 及 list_replenishment_plans 核对精确仓别；"
        "库存健康分布只按系统既有仓别范围，不擅自增加仓库或自定义健康阈值。",
        ["库存结论", "快照及观察周期", "缺货与积压风险", "现有备货与依据缺口", "补货行动建议"],
    ),
    _preset(
        "ops-promotion", "推广效果复盘", "复核一家店的推广投入、产出及异常对象，给出待确认调整建议。",
        "建议每周及预算调整前手动运行", "promotion", "last7", ["netshop"],
        ["推广", "ROI", "投产"],
        "先确认平台、店铺、推广归因窗口和金额单位。ROI沿用来源定义，费用为零不强算。"
        "异常阈值须有明确来源，不把相关性当因果，不将推广归因成交当ERP净销售。"
        "仅复盘已取得范围；预算、出价、停投均为待人工确认的建议。",
        "先用 get_netshop_insights_context 确认来源，再用 get_netshop_promotion_insights 或"
        " get_netshop_promotion_object_detail 读取授权范围；工具未提供时不改用专用报告profile工具。",
        ["推广结论", "范围与归因口径", "投入产出与变化", "异常对象及证据", "调整建议与复查指标"],
    ),
    _preset(
        "ops-launch", "新品进度跟进", "查看指定店铺新品七阶段进展，汇总阻塞和下一步。",
        "建议每周或新品协调会前手动运行", "weekly", "last7", ["netshop", "inventory"],
        ["新品", "上新", "阶段"],
        "从系统既有新品项目与工作事项读取当前进度，区分建模、定价、图片、视频、上架、备货、复盘。"
        "当前状态不能证明历史某日完成；起止日期只有来源支持时才用于筛选真实事件。"
        "阻塞、负责人和期限按已记录事实填写，未记录的内容标待确认，不擅自分派任务或更新阶段。",
        "用 get_workflow_page_data 的 launch_projects 与 tasks 视图，以 shopNames 指定精确店铺；"
        "根据返回的筛选和覆盖证明确认范围。阶段没有证据不得标为完成。",
        ["新品进度结论", "范围与状态时间", "七阶段进度", "阻塞及依赖", "待确认行动清单"],
    ),
    _preset(
        "ops-data-health", "数据健康检查", "交叉核对自动化执行、导入批次与日期覆盖，识别需要人工处理的问题。",
        "建议每日自动导入结束后手动运行", "weekly", "yesterday", ["sales", "netshop", "inventory"],
        ["导入", "覆盖", "数据健康"],
        "分别核对执行记录、导入批次、日期覆盖三层证据。下载或工作流success不代表业务已导入。"
        "get_automation_run_status 仅反映上海今天状态，不能冒充输入历史日期的执行证据；"
        "多店整链状态不能证明每店覆盖。未知、缺失、失败分开；不自行重试、补跑或修复数据。",
        "用 get_import_status 查询所选数据来源，再用 get_automation_run_status 核对对应链路；"
        "明确今日调度与输入业务数据日期的区别，并在有覆盖证据时逐项核验缺口。",
        ["健康检查结论", "业务日期与实际截止日", "执行与批次核对", "缺失及未知项", "人工处理建议"],
    ),
    _preset(
        "ops-service", "客服质量复盘", "基于已导入会话摘要识别常见问题与服务改进机会。",
        "建议每周手动运行", "weekly", "last7", ["customer_service"],
        ["客服", "服务", "咨询"],
        "仅使用已导入的结构化会话、问题类型、服务标注与转化状态；不读取或输出原始聊天全文及客户身份。"
        "来源样本、机器人标注和人工核验分别说明，不把有限样本当整体投诉率或员工绩效定论。"
        "店铺范围必须由查询或结果明确证明，未知转化不当作未转化。",
        "使用 get_customer_service_conversations 或经 describe_system_datasets 核验后的有界数据集查询；"
        "会话工具不支持店铺参数时，不用关键词搜索假装店铺筛选；无法证明指定店铺则披露缺口。",
        ["客服复盘结论", "样本范围与完整性", "常见问题及服务标注", "改进机会与待核实项", "行动与复查建议"],
    ),
)


def find(preset_id):
    return next((deepcopy(value) for value in PRESETS if value["id"] == preset_id), None)


def presence(preset, config):
    return [any(existing["id"] == item["id"] for existing in config[kind])
            for kind, items in preset["bundle"].items() for item in items]


def catalog(config):
    result = []
    for preset in PRESETS:
        present = presence(preset, config)
        result.append({**{k: deepcopy(v) for k, v in preset.items() if k != "bundle"},
                       "installed": all(present), "conflict": any(present) and not all(present)})
    return result
