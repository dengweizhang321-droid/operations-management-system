# AI 管理操作修复候选

任务 2026-10-13，准备跨至 2026-10-14（Asia/Shanghai）。当前源码及 Django 制品就绪，Worker 原在线准备受唯一发布锁阻塞，完整制品未就绪，未上线。功能和验证见 [REPORT.md](REPORT.md)。

| 绑定项 | 精确值 |
| --- | --- |
| main 中功能提交 | `b366c065` |
| main 中格式收尾 | `0990a0aee6c42a4eb9d3b791c5b6f4255566c4b2` |
| 实际安装 Django 来源 | `c1df9357cccdbe5e0541e5bd553d6bcc07150621` |
| 精确组合来源 | `beff9877ad8ffc0d29e7a16e1d9abb97dbe771f0` |
| 最新 main v2 完整差异范围计划 | `b1deb55123de5be47d769ef0151592130f91a191cf98f1e2b59b00bea4a684dc` |
| Django PrepareApp ID | `112b58a3e34f493eaa33dd5fbb767bb2` |
| 收据 SHA-256 | `83a17c6d98d20a3b17d1326c00871c8b0d081cbf8920e76bdb0b99ad2536fd50` |
| 原正式 manifest SHA-256 | `08695d0d67c45970a52032421650e859f3926d739aa2993ce896fdd7dc803b92` |
| 候选 manifest SHA-256 | `e6edc621d87ebcaaed0b61f997617494e4f7d17bdc4b443d7d438683ae97be6a` |
| 候选应用指纹 | `e0324b6aaf9373e76b3376ad08426f8d0a972bf07c48cbc468a0a6c37b4320d2` |
| 原 Worker release | `20261013T091815Z-878966319497c4bd` |
| 原 Worker manifest SHA-256 | `b2d57b6d6e990a1fc2cb6909ce778d887e8b019c491bdd9002f3c416f36d982e` |

源 worktree 为 `D:/.codex/worktrees/ai-management-candidate/运营管理系统`，远端同名 `codex/ai-management-candidate` 已保全。它只有管理页面、后端配置/路由和管理测试 4 个 Git 文件差异，保留已安装其他功能。用户暂不上线的流式候选不包含在此组合内；main 中其他未采用修改也未夹带。

Django 制品由原普通用户 PrepareApp 在线生成，进程正常退出 0；原清单时间是 staging 生成时间，不能冒称部署时间。完整应用包逐文件回读：除 `backend/ai_assistant/configuration.py`、`views.py`、新增 `test_management_controls.py` 之外，仅原 smoke 自动产生的 `.wrangler/cache/cf.json` 传输字段变化。其精确前后 SHA、`clientTcpRtt`、`edgeL4/deliveryRate` 和 TLS 随机/握手字段名保存在 `PACKAGE_DIFF.json`，不保存字段值或增加通用忽略；完整字节被上表清单/应用指纹绑定。全部 migration 字节相同，本次不执行迁移 dry-run 或迁移。

Worker 原 `planWorkerReleaseRotation({prepareOnline:true, sourceBindingFile, sourceBindingSha256})` 通过当前前驱与来源身份核验后，在唯一 rotation 锁处失败 `EADDRINUSE`，尚未进入构建、apply 或控制入口安装。原失败证据保持，不删除锁或终止占用进程；后续只允许已证明无构建/切换效果的准备重试，不能重放未知生产动作。锁释放后的新计划须重新绑定实际前驱与来源，不能将本页旧前驱当长期许可。

第二次准备仍在同一锁拒绝，独立证据位于 `worker-attempt-02`，本页状态仍是 Worker 未准备完成。末次现场只读观测维护/排空 gate 已存在，不能据旧安装 manifest 外推后续未变化。当前 v2 范围计划在 `CURRENT_SCOPE.json`；旧候选工具 v1 `d94568e6…` 保持 `SCOPE.json` 原字节。当前规范无 migration 差异不执行迁移 dry-run，未把旧工具输出改成已验证。

上线后验收计划：核对实际 Worker/Django 版本和必要服务就绪，验证模型删除历史保留、直接默认选择、文本/视觉预算自由填写。生产删除或修改已有真实模型仍由用户选择具体条目；开发验证没有替用户更换默认模型、删除密钥或调整实际参数。发布使用原唯一应用维护和普通用户常态启动方式，保留 PostgreSQL、无 schema migration；代码恢复走原受控应用/Worker successor 入口，数据库恢复须另有精确授权。

当前没有执行任何生产维护、服务启停、采用、迁移或真实配置写入。源码、Django staging、候选来源和原失败证据保留。证据根 `D:/codex-artifacts/ai-management-controls-20261013`。
