# I公共商品经营序列 v1

2026-10-01，I专属作者Teammate，codex/netshop-product-series；独立树 D:\.codex\worktrees\netshop-product-series\运营管理系统。准确父为3fd373577815e59068217cc45a52e68153c50f01；开工时它是I候选、actualmain为b7，随后fetch/ls-remote确认该父已成为actualmain，未重复merge或cherry-pick。未使用Sales在途e88。需Q独立复核/I正常合入后才供S/C消费，不代表M5/M6完成。

## API与所有权

- Python：backend/netshop/product_scope_series.py 的 read_product_scope_series(principal, params, *, deadline=None)；校验函数 validate_product_scope_series_query。
- TS：lib/netshop/product-scope-series-contract.ts 的 validateProductScopeSeriesQuery / decodeProductScopeSeries(value, query, owningRevision) / restoreProductScopeSeriesMetric(dto, point, columnKey) / resolveProductScopeSeriesCoverage(dto, metricRef)。
- 参数仅F原 platform/outlet/dimension/startDate/endDate/periodKind/snapshotToken 及 grain=day|week|month；必须显式单平台、精确单店。JD SKU/SPU分开，TM SKU仍422。q/category/page/productIdentity不是此全店读取，400拒绝，不能悄悄缩成一页。
- 未注册API/路由/SDK/权限/grants/UI；公共接线由I单写。未修改既有P/F算法或栏目文件，复用已main P的 _base/_window_rows/_annotations/_metrics/_extra_metrics/_visitor_value/_execute_product_reader/_finish。

## 原始事实与日期

_base保留精确平台、店、源、dataset、合法商品ID及其所属completed batch；一次全店聚合不遍历详情、不相加列表页，不把当前档案/库存当历史、不混SKU/SPU或A推广分母。

完整F context原样返回：三期actual windows、calendar、coverage、capabilities、freshness、requested/effective scope、owning和全部typed vector。当前≤366，原派生合法≤367；三个源期各自真实日期，不裁成当前长度或改名本期日。

分桶复用period_groups：日、周一开头自然周、自然月，首尾夹在原期间内。日用P annotations全店分日，周/月按合法日期桶在SQL用同一annotations聚合后调用P比率算法。无记录不为0；numeric0仅在presence成立时保留。单点完整性使用该桶真实日期/字段presence，不套整期complete；私有评价context只供P算法，绝不替代返回的F carrier。

## 投影与引用

schema为netshop-product-scope-series-v1，projection为point-field-cells-v1；这是独立owning投影，不能声称原P DTO完整。

- columnDefinitions固定21列：P七核心、十三extras和visitorValue。冻结key/unit/basis/aggregation/sourceIds/fields；visitorValue沿原netshop-money-per-count-v1、CNY_CENT_PER_COUNT、product_day_visitors_sum，不舍入底层商。
- coverageFields固定P ALL_FIELDS的17字段顺序；pointCoverage[ref]含唯一来源、精确shopKey、实际桶dates、observedDates、rows、17项presentCounts及missingFieldDates，后者保留每字段真实缺日（包括无行日和存在行但该字段不全的日）。
- point含date/endDate/coverageRef/cells；cells严格六元tuple为 [value,status,reasonCode,coverageColumnIndex,numerator,denominator]。第四项必须等于本列index，布尔、错位或另列index拒绝。
- 覆盖解析为 pointCoverage[point.coverageRef] + columnDefinitions[index].fields + coverageFields/presentCounts/missingFieldDates；标量和复合指标两个同点同源field可恢复，不复制21份覆盖对象。日期、店、源和字段索引不可跨点/跨期。
- 先过本模块decoder，再用restoreProductScopeSeriesMetric恢复原Metric/DerivedMoney形状，恢复ref为point ref#columnIndex。resolveProductScopeSeriesCoverage明确返回该列参与字段的同源逐日交集、完整性和精确missingByShop。decoder核实际完整点/桶边界、全部列、四态/真0/missing状态、weighted operands和结果、strict scalar/closed fields、引用可解析、typed vector、共享scope与owning响应头。

停留/跳失、店铺去重UV、复购、自然/付费拆分或其他新源无证明，不能伪造。

## 预算与错误

复用3fd resolve_read_deadline及P外层SQL前后fence；调用方deadline只能缩短原65秒。actor/read_context/聚合/三期points/末向量/actor/JSON序列化共用预算；到期不开始新read SQL，允许事务清理。无新嵌套重试/cache/statement或grants放宽。

SQL故障默认整helper503，transaction rollback后分类，不降成缺源；权限403及向量409保留。超过2MiB明确422，不裁F carrier/源期/字段/日历。

## 作者验证与资源

独占E根：E:\codex-artifacts\netshop-scheme2-20261001\product-scope-series\author-20261001T103429+0800-7e7b9f60e2e54c5dbe2c0b5c2d024df5。

- 私有PG run01共44通过：本模块10及初版直接导入TestCase导致发现的P34旧回归，日志保留。模块式fixture复用后的run02/03各12通过；最终run04本模块13通过：全店31商品/异店异维度/failed与foreign batch、真0/缺字段/缺日/非numeric、自然周weighted/短月闰日/精确字段缺日、四角色/scope/非active、owning/typed scope/actor变化、真实SQL错误rollback、整体deadline、unsafe整数、明确422。
- 最终实际最大PG DTO为366/366/367三期共1099日点×21列，原owner JSON序列化1,459,650 UTF-8 bytes、29 SQL，完整F calendar366及覆盖保留。同比367最后点可读；是合成私有PG单次规模，不代表生产性能。旧1,359,641字节样本仅为追加逐字段缺日之前的历史版本。
- 最终原PG DTO直接送TS decoder11项全通过、无skip，包括最大DTO；点/列/field index/ref/header/vector/window造假、真0/缺字段/缺日、字符串/布尔、比率operand/结果错误负例、field ref#01/#21与真实字段缺日resolver。
- 五份小DTO从run04原字节复制到tests/fixtures/netshop-product-scope-series，SHA吻合；run02原字节仍在E。最大DTO留E，无E环境常规测试10通过/1明确skip外部最大DTO，不冒实际PG通过。
- 定向TS lint、backend boundary、diff check通过。最终全库typecheck exit2，188项继承诊断，新增两TS文件0诊断；不能声称全库类型全绿。本变更没有组件/route，不新增UI或正式构建验收声明。
- 自有.runtime/product-series-venv及npm ci，动态隔离PG非5432，不借归档环境；每run独占E。最终命令/SHA/资源与ignored保全见作者交接回执；独立Q/I采用待，不把作者测试称Q。

未执行生产采用、维护停服、迁移、服务重启、真实下载导入/补跑、外部通知或付费模型调用。
