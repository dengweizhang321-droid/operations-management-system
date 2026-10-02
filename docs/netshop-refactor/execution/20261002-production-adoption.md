# 方案二本次生产采用及条件验收

2026-10-02，Asia/Shanghai。准确业务来源 `22a323c956c28179294b8dbfe494fd4f60ea497d`，M7独立冻结运行组合9e；采用前main `56e236e4c765fc7370fe88645b56eb81bd2352bd`仅文档后继。用户本次上线及维护许可已核原会话原文，暂停后明确继续/开始工作。本文记录实际采用，不能替代功能最终通过。

## 5413只读核对与恢复来源

原京东execution5413保留error及原计划锚点。原节点为trigger、时间初始化、领取两次、分支及等待，未获得granted、A/B/C未执行；独立原Code AST证明只调用本机claim。已审helper pre-ready路径不能转发业务，fixed diagnostic为starting/ready=false/exit1。54计划、412runner、341ware JSON candidates、5商智JSON及四店下载目录无该owner/时间窗效果，正式902京东批次10页完整元数据无该时间窗批次；不以文件时间单独认定无效果，不读取用户行/凭据，不把旧error改成功。

非作者窄历史资格报告：`E:\codex-artifacts\netshop-scheme2-20261002\foundation-review\5413-startup-path-review\review-qualified-readonly.md`，SHA256 `7982DCDE1EE788A99A07AA9BF79A8C432C47F8E3F329AA61224B93971822A7CC`。历史退出根因未确定。

暂停期间整机于20:34:32.5重新启动，原watchdog/唯一Start链恢复前驱服务，新helper空槽。Root没有强清槽、删除业务记录、故障重启或任务补跑；原5413error保留。旧隔离阻断失效的来源是重启后的新进程，不冒Root修复历史根因。新鲜helper/n8n/AI/备份和全部当前市场job租约重新检查；市场workspace此前503保留，独立恢复结束后canonical workspace及两job progress实际200/activeClaims0、原paused/unknown不重试，再由原排空协议准入。

## 实际采用与运行绑定

维护ID `c633fc0aa9a146b48c6c918caf9f8c4c`。原EnterMaintenance -KeepPostgres成功，helpers/background/requests/backup排空、drainedStopped=true。维护标记21:39:29.8572007—21:47:40.2449287，约8分10秒；该标记时段不是精确网页不可用时段。首次独立live/ready均200采样21:53:31，完整12组件Ready状态回执21:55:52。

- Django原准备收据954e64fa5e1140d9b5ad71e31d8b7263/2b01已DeployApp，HardenAcl成功；安装manifest `6929b2c6cc4248c5be84e108c57622419f7f071bfc393b4075d8b198d1c88707`。
- Worker/helper原计划cd77正常apply，release `20261001T164608Z-4dc26d0ae8921e88`，manifest `87f5e879ca2bb3d797886c859c7452d4a72fffdb8e9ff777cd839d039db368e9`；successor `2fed7f774fa6742ad707f9a770d17e90e8f6887bc8ce5691aa09142c804f375a`，consumption `f256c3d663d225d49ff91aa6052b63c4f95693138710851813dfbe2eb7c45fd5`。
- 同ID ExitMaintenance正常，唯一Start已产生started原回执，12组件Running/Ready/exact_release，VerifyStartup实际verified。启动绑定SHA `4734b729898195707f3aafba4df6980b0bcb5863f46439e9f6543d00898656c0`。
- PostgreSQL20664/created20:37:32.026194、n8n16852/created20:35:33.535468在本次应用维护前后保持，未为发布重启。维护之前的整机重启不是Root操作，也不能拿上午旧PID宣称全天未变化。
- 自然watchdog新release持续健康；实际22:09:24与22:10:24两次任务均Result0/Ready，Earlier Running267009/跳过实例记录不冒成功。未改安装或调度。
- 原Start内层已退出、started与真实ready已核；外层pwsh4864/create21:48:30.477933只剩conhost且管道滞留。精确关闭本任务外层shell，不终止业务进程。外壳exit-1保留，不改记整个外壳exit0，也不把它当原Start失败。

## 备份及现存恢复点

原前Backup `daily-20261002T125736Z-22d4149a98de`、Verify、E盘独立恢复61318acf4787/55897均成功，21:23:05—21:32:08；expected/restored content `398df70850998417ed6a8d8a1b8fe2a8bd75c430cbe590bd6f33243fd8f49366`相等，角色/权限profile通过，isolated_data_removed、productionDatabaseTouched=false。没有恢复覆盖生产。

后Backup/Verify实际完成：现存 `E:\运营管理系统业务数据\daily-20261002T135742Z-51d1f444fb7a`，manifest `eb53613180e52d5cea4126c2e80fa2f9784505e9cccb35b7f7a49b1f934537af`，dump `50f4ba271a22c64b4d30f615bbf083a9fd371157d6acb2257ae5c270eb6686c8`，content `568235d8352be6405f4324afe654f916f7efe48a156fae3015c93227687297e4`。原三份/两保护继续维持；本轮前恢复点被后备份按原策略淘汰，不能再引用其目录作现存恢复点。后发布包轮换completed/0载荷；前备份原发布轮换completed/28载荷，按原工具处理，不属于工作树归档数。

## 真实功能验收：未通过全部五栏

合成UI、隔离PG及M7资格不替代实际生产。非作者真实原用户会话浏览器已确认五导航及01新旧/旧ERP入口；旧总览和原sales/summary为200。无Cookie原LocalDirect实际O/P/A/C各有200、S也200，但S销售/财报/经营事件3源为service_unavailable，data为空；不是普通missing/unmapped缺数，不吞为0。

真实浏览器新O/P/A/S/C及insights-context返回503，P实际scope/query与其Direct200一致，不能将单次默认本机身份200冒实际用户通过。角色、账号缓存、查询路径问题继续只读定位，不伪造principal或读取cookie/凭据。固定诊断日志出现SQL statement timeout，不读取/保存SQL参数、用户行或原异常文本。当前actor五列窄GRANT已由已完成生产备份schema-only ACL及隔离真实role对照证实；缺GRANT假说被否定，不扩大权限或绕实时账号检查。

独立条件报告 `E:\codex-artifacts\netshop-scheme2-20261002\foundation-review\production-acceptance\review-production-conditional.md` SHA256 `4DDC840C5D39253CFC85CEC70CBCE05CAB75D8CF273A808B1A87D7212F2171AA`。实际采用/运行/备份资格成立，生产五栏目功能仍未通过。

## 后续最小修复候选及边界

共同启动器未显式传入Sales8001/Finance8011/Workflow8061三固定reader地址。Finance/Workflow客户端严格拒空；原通用Sales客户端有既有8001兼容fallback，但全景Sales适配器明确要求显式URL，不接受该fallback。隔离候选 `8707b9d60092a2697439de5609be0a09df5481ad` 仅公共环境函数与专属测试：只给netshop_reader赋三个固定loopback URL、保存恢复原环境、PS7用NullString恢复真正缺失。PS5/PS7各77真实隔离检查、既有网店runtime4项及非作者两种shell真实子进程继承检查通过。新Django已原PrepareApp仅准备：id `5bed7f7c73a14350bee5e2c93bf003a5`，receipt `b74a8ea766805dc60451627ce69025fcaf6533a3f214221064428508abb21e59`，manifest `8451c525aa8144b2ab2121498e481b878b8728a5cb308f0ef91103a36b164289`；生产仍6929，尚未追加采用。该候选待用户对新源码的追加采用确认，不能冒解决SQL超时或全浏览器验收。

不手改runtime、.dev.vars、全局环境、SQL权限或budget；无新增迁移/事实算法/真实下载导入补跑/付费模型测试/主动外部发送/n8n定义调度改动。既有自然流程及通知原策略保持。本轮安全归档17棵及额外6闲置本地refs状态继承，独有内容/活动预览/未知依赖仍按精确原清单保留，清理不阻功能验收。

精确原回执位于 `E:\codex-artifacts\netshop-scheme2-20261002\production-resumed`，真实API/浏览器状态和错误采样位于`foundation-review\production-acceptance`，绝不把条件验收改写为完全成功。
