# 最终交付与发布范围

代码已合入并推送 main，Worker 与 Django 最终制品均就绪；**尚未上线、未恢复正式任务、真实付费调用为 0**。功能、合成比较与验证见 [REPORT](REPORT.md)。

| 项目 | 精确绑定 |
| --- | --- |
| 主功能提交 | `94d46172`；首次合并 `67609f3e` |
| 未知零价保护 | `eec6733613b0a9ffc07147b1782c318269bce42d` |
| 重复回执维护锁保护（最终功能 main） | `1350a69330068bd574ec9b6a9c584b1ce4c1309f` |
| Worker 来源组合 | `68e7de7b00d2153d3acb76acd16c7a4fde6083a4` |
| Django 最终来源组合 | `2154f9e4bafbe343b809ec3783fcd5925386dc72` |
| 当前安装内容比较基线 | `4b2867e2b71481e8eb99ea79c32d420e3064ffc4`，外部 installed-baseline.bundle 保全 |
| 最终范围计划 SHA256 | `b230d9ceb932fadec5941ac4bfccfa916473bb22f46e6d1bd6cb3ee9d4263ca9`，Worker + Django / full，migrate=false |
| Worker 候选 | `20261014T112215Z-9aa39933d2a878fe` |
| Worker manifest SHA256 | `5320f531c5ca9266ff4f4d3985077d656dc81e7ac55494306fdb27c0dab3f49f` |
| Worker guard SHA256 | `640610d9f0931ed209d49f2ce7ca421276fb18281cc23468b9ea8db6a6e3279d` |
| Worker plan SHA256 | `e34d7bb460180a59119c6a52a00be06a1170ba97efba94308ce760681adf2562` |
| Worker 来源指纹 | `85f7dd0b83db0887a5231b1857411b0c4cd3d53209d024c8a9736d7f44ddb076` |
| Worker 来源绑定 SHA256 | `f423338fe26dbc1b5f8372f8f08d1e921581091aea8735d3fded9f0e6e0698ed` |
| Django PrepareApp ID | `8fa6bccecf764207be66be01fadf84c7` |
| Django 准备回执 SHA256 | `e9acda1c6aa7b1a894c3f3fe8d70861fa3b18386d016ec1493f8196182d14b74` |
| Django manifest SHA256 | `01d7d1cf0c28d7caa462cd06af63775b35cbda067c7b6d9903984d5de98d4f56` |
| Django 应用指纹 | `749eb97145494f159c70f3e7c9111b3caaa27c288b84c1bdab0fb19d56172b07` |

两个组件分别绑定真实来源及不可变制品。最后的回执保护仅涉及 Django，16 个受测 Worker/前端/调度/取图文件字节逐项相同，复用已通过的 Worker 制品；没有再次构建无变化的 Worker。实际服务保持 Worker `20261014T045841Z-0084b48bfe8257bf` 与 Django 前驱 manifest `53c63261c3d646b3dcfdb06d17c6385aa22f3b244ea9a23a7b2f7610ed3368f9`。正式前驱变化时，旧计划不可直接沿用。

发布组合保留已安装的其他模块字节，排除尚未采用的商品经营、Agnes 和监控改动；组合分支不回合 main，以免回退主线其他功能。本次实际载荷：Worker 的市场页面、持续派发、缓存输入及本机唤醒；Django 的 A/B 领取/回写/状态及后台活动屏障。云端既有并发、模型、供应商与全局参数未修改。**无新增 schema、迁移或回填**。

Django 最终包逐文件比较只改变两处业务路径：backend/market/annotations.py、annotation_activity.py；所有迁移字节与安装版本一致。cf.json、deployment.json 和依赖清单是准备生成的精确绑定元数据；34 个包记录完全相同，仅顺序不同，运行依赖文件字节不变。最初私有依赖未复现两处现有补丁，已恢复实际安装字节；最终新工作树还保留了两条既有迁移的原换行字节。此前暂存包/旧计划/比较失败均保留，均未采用，不篡改收据或降低门禁。

验证：覆盖 72 个不同 PostgreSQL 用例，相关 TypeScript 156 项通过；新增边界另定向补验，正式 reader/writer 最小权限与签名 API、原生 Windows 共享/独占锁、真实 React+合成 HTTP、真实视觉适配器+边界替身均通过。真实模型质量、吞吐和供应商实测未做；合成每个方案均 240 次模拟调用，不宣称真实提速倍数。净水 Prompt 正文/输出枚举冲突单列且未替换分类体系，仍需业务确认。

上线另须本次生产授权，走原排空/维护/切换及实际影响的数据保护。范围工具提示不替代原严格发布门禁；发布后只确认部署成功、目标版本与必要服务可用。净水剩余识别与真实付费调用是独立授权范围，未知隔离项不重置、不重放，其他历史任务保持。

恢复：保留前驱包、精确回执/owner/租约/审计，未知结果先回查；优先原受控兼容应用恢复或前向修复，已 fence 的 Worker 走原 successor/恢复入口。无 D1 回退；生产数据库恢复另批精确恢复点和目标，应用恢复不等于数据库回滚。

原件和稳定本地交付入口：D:/codex-artifacts/market-annotation-priority-20261014/。两条发布组合树因来源/准备回执引用保留；已合并开发树在原件保全后归档。主工作区既有用户改动未动。
