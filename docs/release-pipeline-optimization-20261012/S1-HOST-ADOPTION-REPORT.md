# S1宿主退出码修复采用记录

2026-10-13，依据用户本聊天明确“批准A”，执行[精确采用方案](S1-ADOPTION-PLAN.md)。**仅S1宿主文件已采用并完成相应验收；未执行Worker/Django应用发布、服务启停、数据库动作、入口重绑、S2自动hook或完整CI建设。** 原计划/资格/未采用截点和原失败保持，本记录更新当前事实。

## 采用范围与恢复保全

唯一已有持久目标：`D:\运营管理系统\tools\operations-system-service.ps1`。

- 原23155字节、SHA-256 `aff5a37974251422281e75d150292115b014f9265b5895747bdae05d9b028b6d`。
- 已采用23456字节、SHA-256 `38b1e5b2de4e20c6a0e75a8a8ab400c738a7fb0bdfae64803cfe14d97d48e97d`，UTF-8 BOM；与仓库原S1固定产品字节相同。
- owner/group/DACL原始SDDL摘要 `5dd22c94c50ddb891a9197e085dae5ac86abb7d17cde20b482384bf5bad5a6cf`，采用后精确相同；未改Owner/Group、权限主体或目录权限。
- manifest `5671c3a1...`、qualified-plan `feca5a1e...`与批准方案逐字节复核。调用者、文件/父链非重解析点、单链接、流、属性、占用及真实绑定重新检查，不沿用旧观察放行。

上海06:12起重新观察；在原`Local\TERUISI.Operations.SystemControl.v2`非阻塞取得互斥后，立即复核旧/新字节、原描述符、12个guard入口、Django/快捷方式/launcher等依赖和可读解释器。仅同目录create-only stage、flush、File.Replace（不忽略元数据错误）与同文件原DACL精确还原；核实际被替换文件、最终字节/描述符后释放互斥。不Restart，不运行public Status/Panel，不自动重放。

旧文件实际替换备份、预检旧副本、原描述符二进制、前后原始观察及create-only结果位于：

`D:/codex-artifacts/release-s1-adoption-20261013/execution-20261012T221328Z/`

`actual-replaced-old.ps1`确认是aff5原前驱；`original-descriptor.bin`仅在私有保全目录，不提交原SID/描述符内容。未执行回退。以后回退仅在当前目标仍为38b、旧文件/描述符可信、无活动S1及取得原互斥时恢复同一文件与DACL；第三方变化/未知拒绝覆盖，不恢复DB或重试已发生服务动作。新的准确非零错误不当作回退理由。

## 已采用文件验收

加载的是**实际宿主已采用文件**，先设置library-only，只在私有root、测试mutex、mock控制子脚本和自然结束的测试后代运行，不调用任何真实生命周期/HTTP/浏览器/DB。

| 检查 | 结果 |
| --- | --- |
| PS5真实私有调用分支 | 21/21：Start JSON/文本、Stop全后端/仅Worker、热/完整Restart、Status的0/9/259；每例单次子调用，无额外重试 |
| PS7真实私有调用分支 | 同21/21；两shell共42，退出均0 |
| 原真实退出码夹具 | PS5/PS7分别通过0/9/259、null拒绝、直接父退出/后代输出分离、异常后独立进程获取锁；只把原夹具唯一load语句指向实际宿主，预算/断言与私有副作用替身保持 |
| 安装/权限验收 | 新SHA、长度、BOM、实际旧备份、owner/group/DACL精确相同、12保护入口未变；无遗留安装stage |
| 前后运行观察 | effective chain/head、Django manifest、快捷方式/config/任务actions相同；supervisor出生与3000/5791原端口归属相同 |

证据摘要与原输出容器见[S1采用证据清单](S1-HOST-ADOPTION-EVIDENCE.json)。独立新工作树基线8fbaa34b，源码/测试不改，仅追加本记录与证据，仓库交付不再写入用户主检出。

首次事后原生观察中，PID66784在CIM到native之间自然结束，记录`diagnostic_native_not_running`，最终汇总初次拒绝该未知。原观察保留；后续CIM确认该PID不再存在，重新完整观察得到8个相关native身份、0未知、0 S1引用，原supervisor出生仍匹配。不能把之后完整观察回填该历史未知，也不能据它反推结束进程曾无S1引用。它不属于安装或私有调用测试失败；没有为此回退、重装或停止任何进程。

## 保持的边界

- Worker仍`20261011T090355Z-21c2645a63247749`，manifest `6cff8886...`，guard `92eff2b5...`，220 successors/0 incomplete，chain `bc87c4d6...`。
- Django仍manifest `85cf0699...`、原appFingerprint；watchdog任务仍e033，桌面/登录快捷方式、launcher配置和任务actions不变。
- S1只用于运营系统.bat/npm system:*包装路径；桌面直接总控、登录启动和看门狗绕过S1，不能认领其可靠性/性能收益。后台父PID receipt仍不代表最终服务成功；旧普通Status/Panel安全边界保持。
- 主检出Git HEAD仍`2f55c3965e60b139381b6cc31ed868bcfe99a7bf`，未同步、stash/reset或暂存用户文件；原六处修改/未跟踪保留，仅新增已批准的S1文件修改。
- 普通应用发布分类仍strict/full，不把这次独立宿主操作变成v3/v4通用减免；无完整应用冷启动、业务Ready、连续SLO或净省分钟数声明。
- S2离线使用，无自动hook；完整CI原候选/失败/pending保持，建设暂缓。没有更改数据库、备份调度、外发、运行包或恢复历史。

当前状态是“仓库S1修复已合＋唯一宿主S1已采用”，不等于本轮完整CI已采用，也不等于Worker/Django已换版本。
