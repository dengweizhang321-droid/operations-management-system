# 交付与发布范围

源码已合入并推送，完整制品已就绪；尚未上线，未恢复正式识别任务，真实付费调用为 0。功能和验证见 [REPORT](REPORT.md)。

| 项目 | 绑定 |
| --- | --- |
| 功能提交 | `94d46172` |
| main 合并提交 | `67609f3eeb7b63863a6eb07ced3b0d052d99e36e` |
| 精确发布组合 | `d45afb8000256620b28ebedda7b6241afb4a25bb`，分支 `codex/market-annotation-release` |
| 当前安装内容的 Git 比较基线 | `4b2867e2b71481e8eb99ea79c32d420e3064ffc4`；完整保全于外部 installed-baseline.bundle |
| 来源指纹 | `51f92309de4a00bd993bf91210145a4f5ae3ecd84b12ec2b1c600dcbacd4072e` |
| 来源绑定 SHA256 | `c1d5d4325e40deff5a7a4cf1cbccf7a5e51a74be15dcd31c37cad64b23982c02` |
| 发布范围计划 SHA256 | `a61f0376cec67264e75f35a19a09ae05ff3e8d01fa698955fd0bf3045e6832f7`，Worker + Django / full，`migrate=false` |
| Django PrepareApp | `f62d5f898a0d492aad1a9be9faec4b5f` |
| Django 准备回执 SHA256 | `245f72f2230319c6542963273ba9690885cdd4620c2760729b62caf1c874e67d` |
| Django manifest SHA256 | `e7ac72b990dea0df8c3a2414422660edf4ffe460c07bd2d22cb297e7432021ab` |
| Django 应用指纹 | `b958c845f963a924c0e8f2f1806ef4fe232d6412bb4b8d53c9bca4d8109c424a` |
| Worker 制品 | `20261014T105240Z-8a66e528f077fbdf`，在线准备／不可变校验通过 |
| Worker manifest SHA256 | `f5f8f31cde355143fe9f3defa51e9c5a979d6c1f2a296d8616a4bdf8e85cb238` |
| Worker guard SHA256 | `bb0a72d6f9d8024170ee154d5eff5f2280fd373528ee17fb62a0041636ae7f75` |
| Worker plan SHA256 | `5e73e560a025e9556e6253488888eb6a81763e0c92d5abf57682ec17f15dfd2f` |

候选从最新 main 的独立工作树组合，保持本次受测文件字节，其他应用路径使用正式安装字节；排除未采用的商品经营、Agnes 和监控变化。组合提交不回合 main，以免回退主线其他功能。Worker 前驱为 `20261014T045841Z-0084b48bfe8257bf`；Django 前驱 manifest 为 `53c63261c3d646b3dcfdb06d17c6385aa22f3b244ea9a23a7b2f7610ed3368f9`，正式部署清单和服务未被切换。发布前须重核实际前驱，变化时不能沿用旧绑定计划。

最终 Django 包逐文件比较仅两处业务路径：`backend/market/annotations.py`、`annotation_activity.py`；无迁移差异。准备生成的 cf.json、deployment.json 和依赖清单精确字节分别绑定；依赖清单的 34 个包记录相同，仅排序不同，运行依赖文件字节不变。首次暂存 `6f333628...` 虽 Prepare 返回成功，但存在两处已有运行依赖补丁未复现，未采用；恢复私有准备树中的当前安装字节后重新封包，原失败／比较记录保留，没有降低门禁。

发布范围包含市场页面、A/B 领取／回写／进度、图片缓存输入、本机后台唤醒与维护活动屏障；沿用现有并发，不替换供应商／模型／全局参数。无迁移，不执行生产迁移、数据回填、恢复、任务重放或其他历史任务操作。范围计划中的数据保护提示不替代规范和原安装发布入口的严格保障，按本次影响执行批准的备份／恢复方案。

后续生产授权应明确此精确候选、原维护排空和组件切换；仅验证部署成功、目标版本及必要服务可用。恢复净水剩余识别及真实付费调用是独立授权范围，原未知隔离项保持。净水 Prompt 正文／枚举冲突仍需业务确认，未擅自换分类体系。

恢复方案：保留前驱不可变包、Django 前驱和精确租约／回执／审计；未知操作先回查，不重放推理或覆盖 owner。优先兼容应用恢复或前向修复，已 fence 的旧 Worker 走原 successor／恢复入口；无反向 D1 路由。生产数据库恢复另批精确恢复点与目标，不把应用恢复当数据库回滚。

完整原件：`D:/codex-artifacts/market-annotation-priority-20261014/`。发布组合工作树与对应制品因待采用引用保留；合并开发树在证据保全后按项目规则归档。主工作区既有用户改动保持，未为同步 main 覆盖本机检出。
