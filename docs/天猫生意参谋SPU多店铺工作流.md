# 天猫生意参谋 SPU 多店铺工作流

本流程用于逐店补齐生意参谋“商品排行”SPU 分天 `.xls` 数据，并在运营系统中完成店铺隔离、日期校验、幂等导入和落库回查。业务日期以 `Asia/Shanghai` 为准，默认只处理到昨天。

## 1. 安全边界

- 店铺注册表位于 `config/tmall-store-accounts.json`。每个店铺必须使用不同的 `profileDir`、`debugPort` 和 `downloadDir`。
- 注册表不得出现密码、Cookie、Token、Session 或验证码。首次登录和登录失效后由操作者在对应独立浏览器 profile 中完成验证。
- 只有注册表中 `enabled=true` 的店铺可以导入。服务端不再接受任意天猫店铺名，也不会把所有文件强制归入亿玖店。
- 下载前必须从页面可见店铺身份核验当前店铺；文件进入运营系统前还必须通过店铺/日期/文件哈希签收单。
- 店铺之间串行运行。不得共享浏览器 profile、下载目录、签收单或恢复清单。

## 2. 首次配置店铺

1. 在 `config/tmall-store-accounts.json` 找到店铺，设置唯一的浏览器目录、端口和下载目录。
2. `initialStartDate` 表示该店铺首次纳入自动补数的起始日。已有数据时应设为已确认覆盖的下一天；不能确认时保持 `null`，运行时显式传 `--start-date`。
3. 完成独立 profile 的首次登录，确认进入 `https://sycm.taobao.com/portal/home.htm` 后页面展示的店铺名与 `shopName` 完全一致。
4. 只有上述核验完成后才把 `enabled` 改为 `true`。

## 3. 生成缺失日期计划

运营系统运行时执行：

```powershell
npm run tmall:daily:import -- --dry-run
```

只规划一个店铺：

```powershell
npm run tmall:daily:import -- --dry-run --store-key tmall-yijiu
```

已人工确认非连续缺口时，使用显式日期清单；执行器仍会先查询这些日期是否已经覆盖，只规划尚未导入的日期：

```powershell
npm run tmall:daily:import -- --dry-run --store-key tmall-yijiu --dates 2026-07-28,2026-08-01
```

执行器会逐店调用 `product-performance` 只读接口，按 `platform=天猫 + shopName + dataset=spu_daily` 查询实际覆盖，生成 `outputs/tmall-multi-store-import/run-*.json`。计划中的每个 `planned` 项都是一次独立的单日下载，不能用京东 SPU 截止日或其他天猫店铺的截止日代替。

## 4. Power Automate Desktop 下载流程

建议建立一个主流程和一个“单店单日下载”子流程。主流程读取计划 JSON，按文件顺序串行调用子流程。

子流程输入：`StoreKey`、`ExpectedShopName`、`BusinessDate`、`ProfileDir`、`DownloadDir`。

子流程步骤：

1. 用该店铺独立的 `--user-data-dir=ProfileDir` 启动 Chrome，然后附加到生意参谋页面。
2. 等待页面加载；如出现登录、验证码或权限不足，立即停止该店铺并记录 `waiting_login`，不得切换到其他店铺的会话。
3. 读取页面左上角当前店铺名称，必须与 `ExpectedShopName` 完全一致；不一致时停止并记录 `shop_identity_mismatch`。
4. 点击顶部“商品”，进入商品排行。
5. 点击“日”，选择 `BusinessDate`。选择后再次读取页面统计日期，必须等于目标日期。
6. 点击“下载”，等待 `.crdownload` 消失且 `.xls` 文件大小连续两次保持一致。
7. 将文件保存到该店铺独立 `DownloadDir`，不要移动其他店铺或旧日期文件。
8. 调用签收命令；只有退出码为 0 才把该日期标记为已下载：

   ```powershell
   npm run tmall:receipt -- --store-key tmall-yijiu --date 2026-07-31 --file "D:\谷歌浏览器\tmall-yijiu\实际文件.xls"
   ```

签收命令会读取工作簿并核验统计日期、SPU 表头、文件大小和 SHA-256，然后在同目录生成 `<文件名>.tmall-receipt.json`。内容不同的同日文件不会被静默选择。

## 5. 导入、去重与恢复

下载与签收完成后执行：

```powershell
npm run tmall:daily:import
```

执行器仅接管签收单与文件哈希一致的 `.xls`，并逐店逐日完成：

1. 本地工作簿日期和结构复核；
2. `POST /api/netshop/import`，提交 `source=tmall_product_daily`、店铺和同一天目标范围；
3. 校验 HTTP 状态：新导入必须为 `201/imported`，文件重复必须为 `200/duplicate`；
4. 校验批次的来源、数据集、平台、店铺、日期、状态和行数；
5. 再次查询同店铺同日期覆盖，只有命中后才算完成。

同一店铺同一天的数据行使用 `dataset + platform + shopName + businessDate + SPU` 作为自然键。重新导入同一日期时只替换该店铺该日精确范围，不会与其他店铺或日期累加。

运行清单状态：

- `waiting_download`：缺少有效签收文件；补齐文件后重新运行。
- `failed`：文件冲突、校验、接口或回查失败；修复原因后重新运行。
- `imported`：新批次已导入并回查成功。
- `duplicate`：相同文件已经导入，批次和覆盖回查成功。
- `completed_with_warnings`：已落库，但存在主数据未匹配等告警，需要人工复核；不要重复下载覆盖。

## 6. n8n 工作流

亿玖店可导入仓库内的 n8n 工作流：

```powershell
n8n import:workflow --input "automation/n8n/tmall-yijiu-sycm-daily-import.workflow.json"
```

工作流按 `Asia/Shanghai` 每天 09:15 运行缺口规划，并监听 `D:\谷歌浏览器\tmall-yijiu` 新增的 `.xls`。文件写入完成后自动执行以下有界流程：

1. 只接收该店铺独立下载目录内的真实 `.xls`，拒绝相对路径、目录越界、符号链接越界和其他扩展名。
2. 从工作簿识别唯一业务日期，再按店铺、SPU 表头、日期、文件大小和 SHA-256 生成签收单。
3. 对这个明确日期执行强制内容核验：同店同日同内容由导入接口返回 `duplicate`；同店同日内容变化则以新批次精确替换该日范围。
4. 核验批次身份、状态、行数和日期，并再次查询同店同日覆盖；回查不命中时让 n8n 执行失败。

工作流 JSON 默认 `active=false`。导入后先确认 n8n 与运营系统运行在同一台 Windows 主机、项目绝对路径和下载目录未变化，再在 n8n 中发布。n8n 只接管计划、文件签收、导入和回查；生意参谋网页登录、验证码、页面店铺身份确认、逐日选择和点击下载必须由操作者完成，工作流不得保存登录凭据或浏览器会话。

### 6.1 亿玖店货品快照 + Cookie 直连四段式副本

同事脚本或既有 Cookie 已经完成授权验证、且只处理注册表中的亿玖店时，可导入独立副本：

```powershell
n8n import:workflow --input "automation/n8n/tmall-yijiu-sycm-cookie-daily.workflow.json"
```

该副本不依赖 n8n 2 默认禁用的 `ExecuteCommand`，四个节点只访问 `127.0.0.1:5791`。执行前在另一个本机终端启动一次性辅助进程：

```powershell
$env:TMALL_SYCM_COOKIE_FILE = "D:\path\to\cookie.txt"
node --import tsx tools/tmall-sycm-cookie-pipeline.ts serve --port 5791
```

也可以把 Cookie 原文件的绝对路径作为单独一行写入 Git 已忽略的 `.runtime/tmall-yijiu-sycm-cookie-path.txt`。指针文件只能保存路径，不能复制 Cookie 内容、账号或密码。辅助进程只监听本机环回地址，n8n 按 `M→A→B→C` 顺序调用；重复、乱序或并发请求返回失败，成功或失败后自动退出。旧版工作流仍可从 A 开始，但不会自动补货品主数据。

执行门禁：

1. M 节点先查询 `tmall_product_master` 最新完成批次；当天快照已存在时直接跳过，并允许在辅助服务已处于 `mastered` 阶段时幂等重跑，不再返回 `invalid_stage`。否则使用注册表中的亿玖店独立 Chrome profile 打开千牛 `商品 > 出售中`，从页面可见文本核验店铺身份，关闭右下角“重要通知”（仅在显示时），再从右下角打开“商品管家”。脚本只向右侧商品管家聊天输入“导出全部商品”、发送并确认，等待本轮唯一的新“前往下载”链接后保存 `.xlsx`；不再点击“批量导出表格”或“更多批量操作”。文件必须位于该店独立下载目录，并通过“发布模板”工作表、商品/SKU 表头、25 MB 上限、行数和 SHA-256 校验；之后调用当前导入接口并核对精确批次、快照日期、店铺、数据集和落库行数。
2. M 节点在发送聊天指令前写入活动清单，并记录通知处理状态与商品管家入口状态；下载完成后记录路径、大小、哈希和行数。右下角“商品管家”优先按截图确认的最右下角蓝色图标加“商品管家”白色胶囊按钮识别，文字即使位于普通 `div`/`span` 子元素中也可定位；同时兼容 `aria-label`、`title`、图标 `alt` 或商品管家专用类名。脚本先关闭标题为“重要通知”的提示；若显示截图中的“商品巡检”浮层，则同时按标题、通知上下文和 `notify_body` 结构识别，只点击“忽略”，明确禁止点击“去优化”；聊天框底部的“商品巡检”快捷词不属于通知，不执行关闭。若入口完全无标签，只允许选择最右侧且贴近底部、固定或悬浮、尺寸较小且可点击的唯一候选，并排除粉色翻译图标、商品巡检弹窗、返回顶部、客服、帮助、通知、关闭和下载入口。发送键只允许在当前商品管家 `Sender` 组件或其浮层内、输入框右侧附近定位；无法唯一定位时只对当前输入框发送 Enter，不再扫描或点击页面后台按钮。确认阶段兼容“确认导出/确认任务/确认执行”等任务卡片，也接受聊天明确出现“导出商品到Excel”的任务受理或唯一下载结果；已有活动清单处于 `export_submitted` 或 `export_confirmed` 时只接管当前隔离会话，禁止新建会话或重复发送。多个“前往下载”DOM 候选先按同一聊天框中的视觉位置合并父子元素；若确有多条历史结果，只选择附近包含“成功导出/所有任务已完成”且位置最下方的唯一链接，位置并列或跨页面时安全停止。“前往下载”进入导出记录页后，脚本把活动清单 `startedAt` 转为上海时间，与每一行“任务创建时间”比较，只选择时间最接近且在允许窗口内、状态精确为“已完成”的唯一任务，再点击该行“操作”列的“下载”；时间同样接近、状态未完成或同一行存在多个下载操作时停止。经核验的任务创建时间写入最终审计。“前往下载”和最终下载控件都使用 Chrome 浏览器根 CDP 会话捕获下载事件，可覆盖新标签页或非原页面下载；文件先写入该店独立临时目录，只接受安全 `.xlsx` 文件名和本轮唯一文件，再原子移动到带运行 ID 的规范路径。若通知出现但无法唯一定位安全的“忽略/关闭”按钮，或“商品管家”无法唯一定位，脚本会在发送指令前停止。导入失败时重跑只接管与清单完全一致的文件；测试必须传入临时审计目录，禁止读取或删除真实 `active-*.json`。登录失效返回 `waiting_login`，页面店铺名不符返回 `shop_identity_mismatch`，两者都不会继续导入。
3. A 节点查询当前运营系统中 `天猫 + 天猫-志高亿玖专卖店 + spu_daily` 的实际日期覆盖，只规划注册起始日至昨天的缺口，单次最多 31 天。
4. B 节点读取 Cookie 后先校验 `sn` 登录身份必须属于亿玖店，再对每个业务日单独请求一次生意参谋导出；不允许多天合并。响应必须通过老式 XLS 魔数、25 MB 上限、当前 SPU 表头、唯一业务日、行数和 SHA-256 校验。
5. C 节点再次核验文件路径、标准文件名、大小和哈希，生成店铺独立签收单，调用当前 `tmall_product_daily` 导入接口，并回查同店同日覆盖。接口成功但覆盖回查未命中仍视为失败。

工作流保持 `active=false`。首次执行 M 前，使用下面的只启动命令打开注册表指定的独立 Chrome profile，人工完成千牛登录并确认“出售中”页面能看到亿玖店身份；命令不会填写或保存密码，也不会发送导出指令：

```powershell
node --import tsx tools/tmall-product-master-export.ts --store-key tmall-yijiu --launch-only
```

当前一次性辅助进程只用于人工触发的一轮执行；若要发布小时级定时触发，必须先把辅助进程纳入受控服务生命周期和健康检查，不能让 n8n 在辅助进程未运行时空触发。M 每个上海自然日最多生成一个已确认货品快照，后续小时补跑会跳过；Cookie 失效、身份不一致或接口返回非 XLS 时只更新原 Cookie 文件并重新启动辅助进程，不得把 Cookie 或登录密码粘贴进 n8n 节点。

## 7. 每日调度顺序

1. 确认运营系统可用。
2. 运行 `tmall:daily:import -- --dry-run` 生成缺失计划。
3. 操作者按店铺串行逐日下载；可由 Power Automate Desktop 生成签收单，或由已发布的 n8n 工作流监听新 `.xls` 后自动签收。
4. 未使用 n8n 自动接管时，运行 `tmall:daily:import` 导入和回查。
5. 检查最新运行清单；只有所有项均为 `imported`、`duplicate` 或已人工确认的 `completed_with_warnings`，当天任务才算结束。

不得在计划任务中自动输入或保存店铺密码。登录失效、验证码、页面结构变化或店铺身份不一致必须转人工处理。
