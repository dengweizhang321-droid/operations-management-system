# 两项功能同时生产采用

2026-10-14 21:22:24（Asia/Shanghai）完成上线，首页 HTTP 200、目标 Worker/Django 版本及原启动绑定通过，原维护和排空记录已清除。

用户授权范围：“优化 AI 标注队列调度”和“添加单品与组合装筛选”同时上线。主线功能已包含于8b18ba22；组合来源fa711c5a8679b3c8e28fafa217d5117552c30e65以最新main建立并保留其他已安装域的代码，不合回main。

| 组件 | 采用版本 |
| --- | --- |
| Worker | `20261014T124800Z-49f5ec9db80e195b` |
| Worker manifest | `f99c40b1b12abdf84d597f914ef50624139eb80279063cfb600040bf62cd1f7e` |
| Worker plan | `31f08ca440cb6bd7e8c84da139ce7e370e1dabba7c6b318b97ec960b2e726158` |
| Django manifest | `c75dd5704d23587820b73ff657bfe41917078b4ce6babf96d1198efb427c40e1` |
| Django PrepareApp | `6ebd105fbd5d4c6382fa98b482af3144` |
| 维护ID | `83411114d3854fe6899422f9b0e494aa` |

A类优先一次识别分类和价格，B类只补价格，持续补位、缓存复用、幂等回执和未知零价保护已采用。商品明细支持单品/组合装；上方卡片固定组合装口径，毛利区间38%/42%/46%，已一并采用。

复用原功能验证：市场72个PG用例、156项TS及必要边界；商品主线19项PG、安装基础8项PG、16项浏览器/接口；24个发布功能文件对照原受测来源一致，两域无重叠，组合契约6项通过。Worker执行一次在线准备和原构建/不可变校验；Django完整包实际仅六个业务Python路径与封包元数据变化，迁移与运行依赖字节不变。当前有效备份由原installed Verify复验，未重复生成备份或隔离恢复。

维护首次停止返回unknown，原launcher记录商品reader子进程13860的元数据未完整；相关root及端口实际已消失。管理员独立CIM、Get-Process、监听端口及同ID维护核验后，按failed-partial-stop保存独立协调记录，以同ID原幂等EnterMaintenance续接。原失败不改写、不冒作exit0；续接停止、apply、DeployApp、HardenAcl、ExitMaintenance、Start及VerifyStartup全部成功。未修改发布工具或绕过进程门禁。

没有新增schema/迁移或单独迁移操作；原Start内部既有检查保持。没有手动恢复正式AI识别任务、真实付费测试、业务补跑、模型配置改写或数据库恢复。回退仅原受控兼容应用/后继恢复；旧Worker已fence，不直接启动旧包，生产数据库恢复须单独批准。

原件：`D:/codex-artifacts/combined-release-20261014/`。组合发布来源及其准备副本暂保留，部署来源manifest和发布回执仍引用该路径；主工作区既有改动保持原样。
