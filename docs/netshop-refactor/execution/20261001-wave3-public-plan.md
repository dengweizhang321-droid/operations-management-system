# M5/M6公共落实决策（准备状态）

本记录是总控I对S001—008及C-F/P/A/Sales/I-02的已提交请求的决策。当前远端main为`77a26703b143288edd91fbab40c6741ed487e698`；A候选已推`5e97bc8735736b3979914b84e59dd37cbc247af0`，I业务组合`0cca249977b486e06152eea87ed5a16169d545ef`尚待最终真正Home独立验收。**这不是M5/M6开工回执。**开工时须追加同时实际包含P/A的main父提交；已合M1/M2/M3继承，不重做。

用户已授权日常问题由I决策；公共入口仍由I单写，窄文件可另行明确委派。S/C写专属组件、DTO、处理器和测试；本计划不授予双方修改整份公共文件或其他领域事实规则。范围仍为全景2.1—2.8、对比3.1—3.6及用户已选01设计，不启动重复Lead。

## 两期与分类

- C使用专属版本化request/DTO/token，把用户本期和独立基期分别绑定两份合法F context的current。F previous/yearAgo仍维持原日期语义，不能为C改名。两个手动范围各不超过366日，派生日期边界继承F规则；长度不同、重叠及基期零/负/缺失均明示。
- I扩展`app/shell/shop-context.ts`、`navigation-contract.ts`及必要共享日期组件，保存版本化比较意图、来源、基期、分类证据、图表对象与分页；按范围变化重置分页，旧URL默认和P/A返回不变。未知/重复/跨账号或未绑定history偏好拒绝或回安全默认。
- P的category证据为`label_only`：真实id、namespace、parent和effectiveDates均null。Sales的category也只是标签。现时没有官方字典、跨平台同名归并或历史分类关系证明。允许明确的all/来源标签cohort/unknown；不得造官方ID，不能把P按本期标签选身份的cohort冒充历史分类结构。
- ERP/A分类只有在可靠身份与归属证据成立时才过滤；缺关系显示对应来源不可用，不回退全店总数或按成交比例摊广告。真实ID筛选须先交namespace、真实ID、version、有效范围及映射证据。

## 销售领域

- 现有`backend/sales/consumers.py::_summary`丢失outlet.channel，且不含完整groupPagination/latestBatch；`summary.py::_grouped_yoy`本期有行、最多500对象的列表不能作两期完整比较集合。
- 优先增窄、有界的拥有方两期聚合consumer，复用`query._apply_principal_scope`、原渠道/店铺/仓库选择、金额成本及配件/退货规则。canonical店名、原店名和channel须精确转换；不能跨店同名或全局OR扩大范围。旧summary无新参数时语义不变。
- 现有`analysis.read_page`已有精确platform/shop/channel、版本绑定分页和控制总数，可在其原无scope管理员、1—93天范围复用；不是全角色366天或完整店铺目录。记录日期不是店日完整结算证明，max日期不是覆盖证明。
- `order_identity`会回退source_line_key；无可靠订单号不能称真实去重订单。分组订单数不能简单相加作全域订单，旧averageOrderValueCents是件均净额。新客单价须单独可信订单分母，否则明确缺源。
- signed净额、positive/return数量、原订单毛利与大毛利分开；不得新造利润算法、猜成本或改负值规则。无历史精确商品映射时不与P/A单品拼接。

## 财务、目标与事件

- 财务月分析与annual保持拥有方无scope身份门槛。精确店铺月分析复用原`analysis.get_finance_analysis`；年度目标增加兼容可选精确pair筛选须在候选/分页前执行，不拿全集一页筛出本店。
- 真实月财报和年度目标分别标范围与缺月，不线性摊月目标、日利润或推断因果。现有finance search不是经营聚合，不能绕权限或改零值语义。
- `workflow.operations.list_records`已有精确platform/shop、occurredAt左闭右开、分页及scope，可只读复用。updatedAt不是事件发生时间；import_chain.today_status不是历史执行成功。

## 全景与多源一致性

- S固定八章DTO/decoder；P/A聚合均复用各自拥有方完整信封，不复制公式。A的京东SKU/天猫SPU上下文、主paired-whole和辅matched不能塞进S默认SPU context重算。
- 保留netshop严格向量；sales整数pair、finance/workflow digest及库存版本分别标domain/kind/scope。组合前后复验参与源，不能自称分布式原子快照，未参与域不制造失效。
- 503只标对应章节error并保留其他可信章节；401/403清除受保护旧范围、失败关闭，不能称普通缺源或0。参与版本变化409，迟到响应不得覆盖新店/范围。
- `backend/netshop/sales_client.py`的401/403权威错误保留已在main修复。跨域调用需可选remaining deadline，默认8秒兼容；actor、外部读、序列化及最终版本检查计入同一完整读取预算和2MiB，不能每个来源重开全预算。

## 增量验收门槛

精确同名店/不同channel、受限仓与角色；两期不同长度/闰月、仅基期出现的店及超过500候选；真零/缺行/缺字段、无订单号/同号跨店/多商品去重；分类同名不同namespace、未知与历史变更；八章局部503、权限失效、版本变与迟到、整读deadline/响应上限；完整汇总不随q/page改变；分类/两期钻取返回恢复。以上是待实施测试，未声称已通过或已核验真实生产来源。

由I串行接线并先S后C合main，独立Q复验最终组合。所有生产部署、维护启停、迁移、真实下载导入/补跑、外部通知和付费模型继续不在授权内。
