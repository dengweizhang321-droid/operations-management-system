# M2公共底座组合与后续开工交接

本文继承[恢复登记](20260930-readiness.md)和M1。完整功能组合为`b01d039871194be3101581b587e0f940ec56bf99`；证据输出隔离修正为`fdec874156156d7b2efcc5e4f50de9de36b09fe5`；最终读取预算修正为`9f883c199e75af31db62ac770a105cd9e7ca4bb2`，计时包括入口与末次actor SQL。Q已确认最终9f的M2可合并、门禁阻断0。本公告随I正常推送main生效，实际远端SHA由总控合并回执发布并核验；栏目基线须取包含9f与本公告的实际main，不能用早期候选分支代替。

## 来源、父提交与所有权

| 阶段 | 精确提交与状态 |
| --- | --- |
| M1总览01 | 已合远端main `1c2cfa506dcf1430de900aaadad2e076cf1a4f9e`，继承O交付`0f4b3371`及独立组合复核，不重复开发 |
| 恢复登记 | 文档主线 `d3cd59ead81160fba16475576f2f86b305f7789e` |
| F首代码/同步 | `082737f9`；`a5a13560ca8b895528e0f1396827415592d5151a`包含M1与d3cd |
| F最终代码/交接 | `b86e237274f617ada352176cf7232f44ca01595f`；远端干净交接`93943e1b5f8dec69980b5af492de317ac26cd2b2`，其后两文件为交接文档 |
| I AI接线 | `65014a248de6c3abfea89212c87a55126aada86b`；测试夹具修正`7c00a654aef3f48d4c6a996bd00cc60e0d270f49` |
| 最终功能组合 | b01父提交为7c00与93943；fdec父为b01、9f父为fdec，分别隔离容量证据和修正包含actor SQL的完整读取期限 |

F无子Agent、子分支或子工作树。Q未编写产品代码。公共文件维护权已交回I：页面/导航/共享日期与部件、公共query/views/urls/consumer、netshop-service/gateway/权限/AI与公共测试由I串行协调。各栏目只写自己的路径，公共变更须提出精确符号、兼容与验证请求。

## 可消费协议

完整约定与机器作者交接见[底座说明](../foundation/README.md)、[交接JSON](../foundation/handoff.json)。实际新增`GET /api/netshop/insights-context`，schema为`netshop-insights-v1`；`decodeInsightsContextForQuery`统一验证请求范围、本期日期、维度/意图、原令牌及同kind的owning revision响应头。

当前请求上限366日/50店/2MiB，派生同比窗口可367日；返回三期实际范围、逐日日历、来源×店×日缺口、字段能力、完整typed版本向量与来源截止。缺源不能填0，字段能力不能当作经营值、映射或归因证明。UI请求上限90秒、reader成功响应整体65秒，既有单SQL限制保持。

旧接口730日、旧推广500行能力保留；旧商品本期身份精确配对基期，增长榜全集配对后分页仍归P。旧推广主费率仅完整同店同日可计算，辅助matchedRange另列。旧商品比较源503保留可靠本期并清比较，401/403清本基期与缓存；统一日期适配器以所属Python20组夹具校对，不缩旧730日。本期730可算出同比731实际日期，旧API仍拒731读取，比较明确失败并保留本期。

`local-admin@teruisi.local/admin/None`仅继承既有签名Edge本地旗标、构建及精确loopback特例，不登记用户、不改登录/角色/grant、不扩展续读或业务采集。普通账号核验真实active/role/scope/version前后；无法映射的非空warehouse/channel范围及未知scope拒绝读取。

I唯一新增AI工具`get_netshop_insights_context`：中央注册表只读，四角色、principal_scope；仅ai_chat/ai_agent/codex_mcp/test；30秒/40000字符完整信封/每请求2次。传取消signal，使用同一实际reader及decoder，保留完整日历与向量，超限明确拒绝；复用强制审计，不调用compact隐式裁剪、不自动开放Dingtalk或业务采集。客户端取消不冒称数据库SQL被强杀。

`shared/module-slots.ts`仍为空注册表，未来栏目路径与DTO核心是预留，不是可调用API或已实现栏目。P/A/S/C不得通过main引用未合接口/组件。共享筛选`sticky`可关闭，全景继续遵守用户已选非固定店铺标题/筛选。

## 独立组合证据与实际限制

- I b01相关Node204全通过；所有变更TS/TSX lint0错误、2条继承图片警告；boundary与独立构建通过。188条全库既有类型诊断与fresh d3cd基线逐条文件/消息归一化差异0，不声称全库类型通过。
- F作者Node132、另权限/transport11、PG68、合成组件UI31通过；源文件/测试/夹具/工具37项Gitblob及disk SHA已核。合成规模50店366/367完整缺日响应1,748,954字节，5000行有同环境SQL计划与金额控制，不推导生产P95。
- Q先在65014发现两项真实行为问题和三项旧源码断言；F修复后，b01独立Node142/PG27、合成harness31及实际隔离预览6项负向、build/lint/boundary通过。Q实际复验旧API730为200、731为400，日期和数据读取分别报告。
- I和Q分别对最终9f跑29项独立PG用例，均通过、SystemCheck0且正常stop；包含入口/末次actor SQL耗尽预算时失败关闭。Q最终报告`E:\codex-artifacts\netshop-scheme2-20260930\foundation-review\review-final-9f883c19.md/json`，全部M2未决关闭。最终后端产品差异限读取计时，前端/UI与已独立复核的b01代码一致。
- Q b01容量复验曾覆盖F硬编码目录的两份容量JSON。Q结果另存`E:\codex-artifacts\netshop-scheme2-20260930\foundation-review\capacity`并标实际来源。F已只读确认没有原副本或旧SHA，不能恢复或冒称原容量文件仍在；作者PG68日志、源码、历史读值与交接保留。fdec改为每次唯一目录与exclusive create；Q再跑27项通过、正常stop，新容量文件位于自身unique run/capacity，四份旧容量文件前后hash不变。容量完整JSON和计划以Q实际独立副本为准。
- 硬件触控、独立新生产来源读取、真实Worker/Django正式采用未验证。原总览来源限制继承到9月29日证据；本轮新增context与各栏目不能借此称已真实来源终验。

证据分别在`E:\codex-artifacts\netshop-scheme2-20260930\foundation`、`foundation-review`、`coordinator`、`cleanup`。各阶段计数不相加为独有测试数量；独立PG与合成UI、真实来源、生产采用分开。

## 下一阶段门槛与已接收栏目

| 栏目 | 已接收成果 | 正式开工门槛 |
| --- | --- | --- |
| 商品P | 唯一均衡经营台、顶部导航冻结；外部HTML SHA256 `979d2dd46ef3f6f35a1f11c6c9b2dcf09ba6f34878a0efbec5e587db593db02c`；新增元销售额/件数/访客/转化/加购客户率/同比环比 | 本公告实际发布并远端核验后，M3正式开工具备条件；当前设计不当正式接口 |
| 推广A | 远端`43392781`唯一01经营双栏；ROI显示名沿用归因成交/花费倍数，非利润ROI | 同M2门槛后可进入M4，与P并行；默认P先合A后合 |
| 全景S | 远端`a4428e54`唯一01、非固定筛选及ID/标题搜索5/10/20分页 | M2及P/A接口均main后进入M5；S007过滤/分页由P真实接口提供，汇总不受表内搜索影响 |
| 对比C | 远端`fd09f8a8`方案1、分类与本/基期自定义双月 | M2及P/A均main后进入M6；真实版本化分类字典/映射、任意自定义基期C-F02等公共请求仍需I串行落实，不能用Demo占比分摊 |

四个既有栏目Lead不重复启动。跨会话未获明确发件授权时，I仅从已提交材料和用户交接收成果。M2合入不等于P/A/S/C功能、M7组合或M8发布候选已完成。

## 清理与运行状态

已完成的overview-review/fix两个受管树及同名本地/远端分支已安全归档/正常删除，见恢复登记。F/Q最终清理须等实际main远端包含、独有内容/ignored证据保全、所有资源关闭且无外部依赖复核；当前尚未删除。I集成树仍工作；O3100与各设计预览、未合设计分支、C独有cherry-pick子树及未知归属启动树继续保留。

2026-10-01 00:16只读Worker状态仍为`exact_release`，release `20260930T005003Z-7df88d242a9635ba`，manifest `8d8e1e89994bf61aced64e72e28ae6261357952ba79d245d91e5fe51f838811e`，port PID31536。新main代码不代表此运行版本已采用M1/M2。本轮未执行部署、维护停服、生产迁移/重启、真实下载导入/补跑、外部通知或付费模型测试。
