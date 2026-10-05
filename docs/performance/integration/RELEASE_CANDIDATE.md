# 五项性能统一发布候选（2026-10-06）

状态：**五项已合 main、组合验证通过、Worker/helper 与 Django 候选已准备并回读，尚未生产采用**。自动观察 automation-6 已暂停。正式维护、部署与采用须用户另行批准本页精确候选。

## 固定来源与候选

发布来源源码为 `2f46e1a998264a15ed514165942c5ecccd4fc044`，已正常合并推送 main 并回读远端；固定准备源 `D:\运营管理系统-sales-django-release` 保持这个 detached HEAD。后续交付文档提交不改变候选业务源码，不把文档后的 main SHA 冒成候选构建 SHA。

| 项目 | 实际绑定 |
|---|---|
| Worker/helper release | `20261005T185310Z-463d585110456a95` |
| Worker manifest SHA256 | `d67a7cdddae2c0c9ca448e30e538699e584635c7bff02d9fd54fed7e9829c361` |
| Worker plan SHA256 | `a82cca1d598bdadd2e11a8f295df2b1c300d2bff87e46b80eee0b9baffaea698` |
| Worker guard receipt SHA256 | `16bb4dd45f95af77af035a17581025bbac06708691d9271c8608ec81ae859056` |
| Django PreparedApp ID | `5cdf848db1a64ccaa17044c91e59b1d4` |
| Django prepare receipt SHA256 | `5f76ba6a96594bf1132da43642b8d623dffcf557e9b0e964ab83561cdd2a3dba` |
| Django candidate manifest SHA256 | `c51eba5ae0b59e77793a77af51278c19b470c870c5da1adfea866e5c869a6ec5` |
| Django app fingerprint | `571077e2af2c4494a9e18c6f586b24705cc852161774db6ada3fdc86c1d92774` |
| 原运行 Worker/helper | `20261005T063949Z-62c5bbb1bc2901ab` |
| 原 Django manifest SHA256 | `426b1ab97341774a0b68656897af10d6131979b7899e52bf64884255e82ab49e` |

release ID 使用工具原 UTC 命名，页面日期为上海时间。

## 实际准备与独立回读

- 固定准备源是独立 Git 仓库，初次缺新提交对象；通过已核验的本地主仓库 fetch main 后精确切到 `2f46e1a9`，没有改变远端配置、强推或重置脏工作区。锁定依赖与前驱相同，原 postinstall 补丁安装通过。
- 原 Django `PrepareApp` 实际 exit0；原 `Get-PreparedApplication` 在隔离 PowerShell module 作用域中回读、复核收据及当前前驱通过。仅准备新目录，没有 `DeployApp`、Start、迁移或权限操作。
- 原 Worker `plan --prepare-online --json` 实际 exit0/status planned；保留原完整构建、依赖、R2、guard、helper、树摘要和前驱门禁，没有增加超时或跳过完整性检查。没有 apply/Start/Stop。
- 独立脚本 [verify-candidate.mjs](verify-candidate.mjs) 重算 plan 与两侧 manifest 的原字节 SHA，调用原只读 `buildEntrypointPlan`，确认 11 个受保护入口仍为前驱字节，45 个业务源码与 Worker snapshot/Django prepared tree 逐字节相同。Django 生产包按原规则不打包五个测试源，未将其缺失误记为业务缺失；首次验收脚本误包含测试目录的失败日志保留。
- source 与原 installed app 共 149 个迁移源码文件完全相同，不需要本候选新增迁移/回填。
- 准备后的原 `Status -Json` 实际 exit0：Running、backend Ready、worker exact_release；12 个组件均 true，运行 release 与准备前相同。

回执摘要见 [candidate.json](candidate.json)；原 stdout/stderr、首次失败与校验输出保存在集成树 `.runtime/performance-integration/`，没有打印或归档生产凭据正文。

## 组合验证与仍存在的限制

见 [REPORT.md](REPORT.md) 及独立复核：Node 3309 pass/21 skip/0 fail；渲染20/20；PG销售65、库存129 pass/3 skip、商品31、市场148及最小权限负例；构建/lint/630模块边界通过；188项既有TypeScript诊断无新增。

冷库存/商品/渠道未全面达到1—2秒，部分排序/完整重入存在退化样本；市场大范围和预存比较/趋势口径问题未全部关闭，真实生产P95、后台争用及长期资源未验。通用GET共享池缺可靠上下文时未启用。不能因候选准备成功宣称所有子版块全面提速或这些旧问题已修复。

## 正式采用边界

用户批准后仍须先重核这两份收据与原运行前驱、在途任务及备份条件，沿原唯一生命周期与保留 PostgreSQL 的应用维护流程执行；前后备份、独立恢复、原 Finalize/Exit/Start、启动绑定和业务验收门禁保留。本候选没有新表、索引、grant、依赖包或n8n定义变化，不授予业务补跑、扩权或未来维护许可。

本轮来源分支虽已完整合入，但其预览进程和原始证据仍有保留用途；固定准备源、当前集成树与两份 prepared 包也为待采用来源。未强行归档使用中的工作树或删除依赖，清理应在依赖解除且材料保全后执行。
