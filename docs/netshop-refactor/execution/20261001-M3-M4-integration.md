# M3/M4 集成候选登记

本记录承接M1/M2既有验收，不重复开发总览或底座。人类已授权I向既有P/A/S/C协调，并将休息期间常规实现、测试、合并及安全清理决策交I；原生产边界继续有效。

## 主线与候选分离

- 最新核验远端main：`39bc403a5385cb4766c45b0c670bd4c65f96b9b8`。M2冻结为`9d4830ee50232b956bdb9c1c7dd5b30564805355`；后续均价协议d135/39bc经独立复核后已正常推main，未注册任何未完成栏目。
- P公共接线c581：Root集成候选普通合入P最小cd8后，注册两个实际GET reader、SDK90秒/2MiB约束，共享内部caller deadline仅能缩短65秒，不扩请求或重试。
- P来源更新：普通merge `e229144cc59723d8180782fa7522c14435e8e3c6`，集成合并`b15f46cd`，继承作者子分支祖先。P完整UI尚未在此合并。
- 返回起点候选`78a9334f`；展示偏好与账号/实际日期范围绑定候选`115ef5775884a2a4303561135a70a8872f9c5a8a`。二者仅已推`codex/netshop-integration`，不是main或正式栏目验收。
- A最低实际reader/API交付`d428efa0cc8400ceb2dbf22f7e0ec8d0e358bece`已接收，独立A接线候选树从真实39bc建立，避免将未完成A混入M3。A后续语义修复仍由原Lead交准确最终提交。

M3默认商品先合；M4推广同步实际M3 main后复验再合。S/C仍等两者接口**均已main**，当前不具备正式M5/M6开工条件。设计、字段和缺源准备继续由原Lead继承。

## 单写与隔离资源

| 角色/任务 | 工作树、分支与写入范围 | 状态 |
| --- | --- | --- |
| I | `D:\.codex\worktrees\netshop-integration\运营管理系统`，`codex/netshop-integration`；shell、P公共接线与执行文档 | 在途；main由I唯一串行处理 |
| F临时I任务：旧推广报告复用 | 同I树，只写旧diagnostic panel/GET route/report及新I复用测试 | 不提交或合并；完成由I审查、统一提交，另Q复核 |
| I Teammate：A公共接线 | `D:\.codex\worktrees\netshop-promotion-integration\运营管理系统`，`codex/netshop-promotion-integration`；views/urls/SDK与新I接线测试 | 自有依赖与动态私有PG；不得push main或注册未交UI |
| I Teammate：P显式AI取数 | 同I树，只写新AI handler、中央注册表和独立测试 | 原Lead有界需求已接收；仅list候选，不自动暴露detail或paid解释 |
| Q | `D:\.codex\worktrees\netshop-wave2-review\运营管理系统`，`codex/netshop-wave2-review` | 等精确组合继续独立复核，保留自有依赖 |

P3120/18120/18121/13120，A3150/18150/18151/13150沿原登记；Root测试只使用动态私有端口、唯一证据目录，启动前复查占用。未引用已归档F/Q环境或生产产物。作者运行的预览/测试不据一次空端口作清理许可。

## 已完成组合检查与待办

- Root实际signed HTTP商品列表与精确详情200、body/owning revision头一致、未认证401、跨scope403、未知/重复400、POST405、错误section版本409；加P作者实际私有查询/detail共71项在隔离PG通过。证据`E:\codex-artifacts\netshop-scheme2-20260930\coordinator\foundation-pg-9d6ef40e2eff`，端口57703，实例已停止。
- 新返回链L→D→A→D→L采用两个平级裸URL，不递归嵌套shopReturn。两目标拒绝外部URL、未知/重复view、片段及任何return协议字段；日期/店范围变化清旧起点。
- 共享products-ui-v1偏好严格白名单；history.state单一命名空间绑定账号提示与实际起止日期/预设意图/规范店集合/维度。账号提示不是权限版本或授权证据；真实数据仍逐次API验principal。未绑定深链接、换账号、手改范围、跨午夜拒绝新偏好和多步起点恢复；旧单返回书签兼容。
- Root相关Node49、导航56以及新桥8测试分别通过；这些测试有重叠，不能累加声称独立总量。shell lint0；全库类型检查188条继承诊断，新shell文件零。没有据纯函数或合成结果声称正式来源/完整浏览器验收。
- P待正式UI合并/slot与顶部“商品表现”接线、目录完整集合服务器筛选、质量缺码与未映射分开、完整组合独立复核；P自身UI子候选32446b14不等于根e229已含UI。
- A待费率/ROI/CPC/基期对象独立复核修正、实际公共接线、原1—7日独立诊断报告复用与完整UI组合。旧报告基期保持前等长，不冒称全页F环比/同比导出。
- P/A新AI仅有界显式数据工具候选；未做付费模型调用，不把聊天候选当生产采用。

## 清理及生产边界

已完成并安全清理的四树仍为overview-review/fix与foundation/review，回执见wave2-state。新增集成、复核、栏目及其Teammate树在途，继续保留；未删除未知目录、独有子历史、恢复标签或活动预览。

main与候选均未生产采用；运行版本准确状态沿M2只读时间标注，不能用新源码SHA替代运行版本。本轮未执行生产部署、维护停服、迁移、服务重启、真实下载导入、业务补跑、外部通知或真实付费模型测试。
