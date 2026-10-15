# 京东物流页面归属与HTML交付独立复审

2026-10-15。工作树 `codex/jd-logistics-layout`，基线 `224e986f946e6571c336e2d1266a3cf6e94a8624`。请求角色 critical-review、`gpt-6.1-sol/xhigh`；工具未提供可独立核实的底层型号回执。执行前重新读取共享记忆及本树AGENTS、README和现行相关规范，按用户最新五点要求覆盖旧记忆中的ERP入口保留安排。

## 结论

本次前端归属调整及HTML交付边界复审通过，已发现的页码错配P2已修复并增量核实，没有保留已证实未修复的本次阻断。后端事实、权限、authority、固定30日可用库存缺货口径和自动化未改；未重复原59项PG或其后6项业务验证。

本轮未启动新服务、浏览器或在线预览，未执行生产写入、部署或外发。程序化DOM是本机内存测试，不把它表述为浏览器视觉验收。用户交付物为单文件HTML，正式运行状态与离线演示分别说明。

## 页面与旧链接

| 范围 | 核对结果 |
| --- | --- |
| 京东入仓来源 | 类型和初始读取仅允许POP/C仓；默认、旧ERP和未知来源归一为POP商品对照。旧ERP monitor分支因两种模式覆盖而静态不可达，首effect前也没有ERP回退。未删除其他库存业务或后台ERP事实。 |
| POP | 固定商品对照，无流水、调拨、批次或账号页签；商品查询不携带仓库/流水日期。settings的页签、编辑器和草稿分支已移除，旧settings URL不能打开隐藏账号页面。 |
| C仓 | 实际C组件承载库存监控、库存流水、调拨核对三个页签；旧POP flows/transfers链接迁入对应C页。切换数据族清除不兼容范围并置page1；流水与调拨同族保留适用筛选；历史回读保留原页码。 |
| 数据导入 | files挂四源上传，history挂独立批次表；记录页不挂上传表单。旧batches链接迁到import/history及物流来源标记，InventoryView以过渡空态阻止误挂其他数据页，再用location.replace完成跨模块导航，避免只换URL而不换实际模块。 |
| C仓阈值 | 保留独立小Dialog，仅admin可保存；使用原settings PATCH与expectedRevision，只提交operation、departmentId、stockoutThresholdDays、expectedRevision，不带账号、绑定或采集/推送开关。固定30日可用口径、系统周转和原生周转继续复用。 |

规范迁移是客户端URL归一与必要的整页跳转，不声称新增了服务端HTTP重定向。canonical函数保持幂等，不重写其他模块URL。正常页签/来源切换与前后退使用原URL范围合同；POP/C、查询、页码、principal与presentation进入对应请求身份，保留AbortController、generation和commit阶段scope fence。

## 关键修复与权限验证

审查发现 `ImportView.changeImportSection` 在重复点击当前“运行记录”时仍写jdPage=1。若当前物流记录为第3页，父同view操作不重挂子组件，列表和GET仍为第3页，URL却成为第1页，破坏刷新与历史恢复。作者已加same-section早返回；离线导航也加入当前路由早返回。

审查者对当前实际组件运行程序化DOM，确认点击后URL3、GET3且没有多发批次读取。只在内存测试副本精确移除该一行的回归反例，复现URL1、GET3错配；证据明确标记regressionMutation，不将测试副本冒称正式源码或另一次真实旧包运行。应用文件未由审查者修改。

阈值编辑的完整key包含principal、事业部、仓库、查询、页码和销量窗口，layoutEffect在commit同步更新，cleanup置空；保存捕获原scope。旧scope的成功、失败不显示反馈、不关闭新scope编辑、不触发新scope回查。同scope成功才刷新options与当前矩阵；同scope失败显示错误，不伪报成功。后台真实principal/admin及CAS契约继续沿用，未以UI角色代替服务端授权。

数据导入记录继续允许viewer读取，files对viewer不挂任何上传form；阈值按钮对viewer/operator均禁用。移除账号入口没有误删批次读取权限，也没有把账号配置或自动化权限开放到C页。

## 直接证据

| 验证 | 结果与适用边界 |
| --- | --- |
| 独立导航定向 | 审查者执行本次5项导航测试，5/5通过。另独立枚举700种来源/旧tab/Ctab/页码/筛选组合：canonical幂等、无ERP/settings目标、POP不保留不适用仓/日期均通过；同族换页签新页1、旧历史页25仍可读。 |
| 独立真实组件DOM | 10/10通过：viewer/operator阈值禁用；viewer history可GET批次且无上传；viewer files不挂上传form；pending后role和department切换的旧成功/错误均被丢弃；同scope成功回查options+matrix，同scope错误保留错误。测试调用的是实际React组件和领域API客户端，网络边界为受控内存替身，合成PATCH被检查为上述精确四字段；真实网络/业务写入0。 |
| 重复点击当前导入页签 | 实际源码URL/GET均保持3；去掉guard的内存回归副本为URL1/GET3。新增guard之后该动态反例已闭合。 |
| 作者定向检查 | 复用作者5导航+4矩阵+1既有URL leaf共10项通过、受影响TS闭包和页面范围lint结果；未重复旧parser/exporter/pipeline/PG套件。父新组合build、682模块边界0违例及HTML工具类型/lint通过；最终提交与制品由主代理绑定，本报告不把历史构建当作后续变更的制品证明。 |
| 离线HTML DOM | 复读父`html-runtime-verification.json`：实际组件POP-only、C三tabs、展开/7日、搜索/仓库筛选、阈值提交阻断、C流水/调拨、files/history及工作流说明通过；记录页无上传。UI写请求0、外部请求0、脚本错误0，Request对象PATCH也403。没有运行浏览器或服务。 |

独立DOM证据为 `D:/codex-artifacts/jd-logistics-layout-20261015/independent-frontend-dom.json`、`import-active-tab-before.json`、`import-active-tab-after.json`。复核脚本保留在本树忽略目录 `.codex-tmp/review-jd-layout.mjs` 和 `.codex-tmp/review-import-active-tab.mjs`；后者的回归副本仅在内存bundle中生成。jsdom仅作为已安装依赖只读加载，没有启动n8n或读取其业务数据。

## HTML安全及交付边界

导出器使用真实JD页面/矩阵组件及系统编译样式，外层为明确的离线导航封装，没有把离线封装说成完整在线AppShell。样式、脚本和合成快照内嵌；导出校验仅接受本任务合成事业部、合成商品及96组预计算矩阵，额外账号设置列表不进入展示。库存数学不在HTML另算。

HTML采用合成admin外观以展示上传及阈值表单，不包含正式登录身份、密钥或后台授权。document capture在写表单提交前阻断并显示离线提示，输入搜索表单继续工作；内存fetch仅提供合成GET，对普通调用及Request对象的非GET均拒绝；CSP同时禁外连与表单外发。实际系统的admin写权限不因HTML身份改变。

交付文件为 `D:/codex-artifacts/jd-logistics-layout-20261015/京东物流监控_页面调整版.html`。源码审查、合成DOM和HTML文件完成不等于生产部署、真实导入或通知已执行；本轮未执行这些操作，也未以预览网址或截图替代HTML。
