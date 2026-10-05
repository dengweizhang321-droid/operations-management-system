# 非作者修订源码复核

当前四项修改业务源码及新增详情解码的物理 SHA 见 `physical-source-final.json`。提交 SHA 在交付前另绑定。本审查没有操作生产连接、服务、迁移、回填、补跑、main 或外部消息。

## 结论

源码/功能定向复核通过，第一轮独立发现的2项阻断已关闭：

- 详情取消后空覆盖的新范围不会再永久禁用刷新；busy 与完整详情请求key绑定，旧详情的busy不属于新范围。
- 缺失或非法 daily.date 与非法金额不会进入共享图形渲染；商品域专属解码验证身份、日期、数值和分组字段。

范围隐藏、销售版本双header与 products 响应的来源版本核对、同范围成功内容保留及刷新实际读取详情均符合本次源码意图。全集合筛选/排序后才选页，快递费率只补当前页，未复制销售/库存计算。共享UI、sales/inventory领域源码、公共客户端、导航、全局样式、README/AGENTS未见修改。

## 非作者执行证据

| 验证 | 结果 | 文件 |
| --- | --- | --- |
| 私有PG17.11，products.tests + sales consumer API | 31通过；独立53574端口，init/start/tests/stop全exit0 | postgres-tests.log / postgres-result.json |
| Node/合成真实Chromium/相关consumer回归 | 30通过，0失败、0跳过 | node-final.log |
| 独立追加组合负例与解码边界 | 3通过；含8种非法响应及合法null/0 | negative-final.log / independent-detail-negative.test.ts |
| 独立证据测试lint、diff空白检查 | 0错误；独立文件lint0警告 | 命令执行记录 |
| 最后来源见证修订后的UI | 13通过（独立3、详情5、区域恢复3、渐进合同2），0失败、0跳过 | final-binding-tests.log |
| 同依赖/配置/基线TypeScript诊断对照 | 基线188、候选188、无新增 | ../evidence/typescript.json |

私有PG在最终前端修订之前完成，但对应后端query物理SHA完全保持，因此不用把前端修订当作新后端测试。PG测试中的48种旧查询等价覆盖沿用原31d源码；本次准确bab基线规模等价由作者配对benchmark另提供，本审查不把它们混作同一基线。

独立负例最初失败回执与修订前摘要仍保留在 `interim-review.md`、`physical-source-before-fixes.json`；不追认初始候选为通过。

## 集成及未验证边界

1. products 的 `salesSourceRevision` 是新增可选响应字段，旧总览消费者继续兼容。新详情消费需要该字段；统一集成须同步商品后端和前端，否则新详情对旧后端失败关闭。销售接口已有双revision header，不要求改销售权威实现。
2. `PERFORMANCE.md`、`COVERAGE.md`、`INTEGRATION.md`已逐项审阅。非作者从原始102阶段PG记录独立复算10个场景的首批/完整中位，与表格一致；30项深等价、108浏览器场景/165请求/28帧/无pageerror均与JSON相符。抽看稳定框架和详情截图。测算商品选择保持当前页原语义。冷日期约2.95秒、排序/部分总完成退化、两个范围缓存锁阻塞与多账号P95未验证均已如实披露。
3. 共享趋势当前毛利计算、销售名称解析/有界分组截断等原业务契约未改，不把本次性能工作当作原契约重定义；若需要新能力归相应任务。
4. 本文是定向代码与功能验证通过，不能替代生产、P95、正式鉴权或完整构建证据。保留 worktree/分支/证据，等待统一集成，不合并或发布。

## 证据修订说明

独立测试的空覆盖fixture为保留运行时合法null，先把 `grossMarginRate` 初始化为0，再 `Reflect.set(..., null)`；此前候选多出1项2322的旧诊断已由同基线新对照关闭，运行时负例仍通过。它仅修改审查测试，不改业务源码。

最终同snapshot/不同salesSourceRevision的区域错误已独立重跑：page/overview不能覆盖已验证initial的来源见证。完整功能源码无未关闭阻断；整个板块性能目标未全面完成，按材料列出的冷范围、排序、并发与跨领域依赖继续统一集成。
