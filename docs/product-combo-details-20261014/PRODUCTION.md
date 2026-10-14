# 商品经营明细生产采用

用户确认 HTML 后明确授权合并 main 与发布。功能提交 `af46feac1cae1b77a8abd907782bf89b9763b90e` 已推送 main；生产来源 `1d848e8fe3142766129d2536bb68d84d5f2dcbfe` 从已安装来源组合本次十二文件差异，逐文件保留其他已安装功能，受测七个功能源码字节与候选一致。

2026-10-14 22:58:12（Asia/Shanghai）原发布操作完成；23:00:02 回读首页 HTTP 200、目标版本、原启动绑定和单品／组合装空历史日期契约通过，维护与排空已解除。

| 项目 | 精确绑定 |
| --- | --- |
| Worker | `20261014T142300Z-5417c162f772702e` |
| Worker manifest | `7a38ce49a28b9376443dbd6fa9dbc3ff67ccbc31c34b00acd1aabf4796523b22` |
| Worker plan | `62cf7e4df74e7920972dff7a816401f966aaf1ea98ee6b8923a5dcce87b9e5b7` |
| Django manifest | `ab8da2178572fb974489bc37f5abeb2d2725f5232a909d958eae0d0c24556d9f` |
| Django PrepareApp | `5599647885594f188a6bb7711c1f187f` |
| PrepareApp receipt | `59c4f0ffa49ba4bdbb43f7a9d92eee14992a7e74e8c0270d284e81f91dbdd03f` |

复用相关 PostgreSQL 18 项、Node／Chromium 18 项和用户 HTML 确認；仅生成一次有效 Worker 候选、一次 Django 候选。Django 实际只变更 `products/combinations.py`、`products/query.py` 及封包元数据、精确 CF 缓存叶子，其他业务、依赖、迁移字节保持。有效备份由原 installed Verify 回查，无新增 migration、重复备份、隔离恢复、真实付费调用、业务补跑或数据修复。

失败原件保留：普通权限核验既有高权限进程失败；首次发布脚本导入缺 TypeScript，发生在维护前，独立零效果回查后补入候选内相同依赖；首次维护已停止 Worker，但管理员环境缺少 PowerShell 7，后端仍运行。管理员只读核对原 supervisor 消失、Worker/helper 端口与回执不存在、同 ID 维护／排空及 Django 前驱保持后，以同一 ID 原幂等 EnterMaintenance 续接。仅补充已核验 PowerShell 7 的子进程 PATH，原控制器、停止身份、候选和准入检查不改写。续接 apply、DeployApp、HardenAcl、ExitMaintenance、Start、VerifyStartup 完成。

原件与有界回读：`D:/codex-artifacts/product-combo-details-20261014/release/`。用户随后追加普通权限启动、停止、重启、发布要求，属于本任务后续运行环境验证；此处不把它尚未完成的验证写成全部通过。商品经营功能已实际上线。
