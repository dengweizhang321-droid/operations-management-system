# 本机存储保留与 GitHub 归档

本方案分开管理数据库备份与可重建程序依赖。现有源码仓库为公开仓库，不能接收业务数据库、配置、密钥或恢复密码。GitHub 大文件使用独立私有仓库的 Release 附件，不进入 Git 历史或 Git LFS。

已提供只读计划、依赖打包/下载/解包验证和默认不删除的受控清理工具。生产采用以本次审计结果为准；数据库自动备份尚未采用。不能把此文档或一次上传成功当成恢复验收或清理授权。

2026-09-13，两套依赖及恢复索引已上传私有GitHub Release并完整回下载验证，137个候选目录仍全部保留。只读清理预检因现有Worker运行回执未正常收尾而拒绝继续，正式清理尚未采用；临时目录删除亦被执行环境自动审批阻止。详见 [本轮证据](evidence/storage-dependency-archive-20260913.json)。

## 依赖归档范围

`node tools/storage-retention-plan.mjs` 使用现有完整 successor 验证器读取真实 effective head，核对安装入口，并在读取全部清单后再次采样链摘要。保留当前版本和最近两个前驱的完整依赖；只把已在验证链中且更早的 `node_modules` 列为候选。链外目录、失败候选、暂存、数据库、源码、dist、helper、工具、凭据、所有清单/审计/activation fence 和 successor 记录均保留。

计划按原始 `sha256-ordinal-path-length-content-v1` 内容身份分组。同一依赖树在 GitHub 只需一份归档，旧版本各自仍保留原始树摘要。此次盘点有151个发布目录，但只有140个处于当前验证链；保留3个后，计划只包含137个候选，不处理另11个链外目录。

`storage-archive-bundle.py` 只支持在独立目录中打包/解包普通文件，拒绝重解析点、硬链接、tar链接、特殊文件、路径越界、Windows设备/流别名、大小越界及覆盖既有解包目录。上传前必须解包并与原发布依赖树摘要比较。云端附件完整下载后再次解包比较，不能使用HEAD、文件名、ETag或一次HTTP成功代替完整验证。

`github-dependency-archive.mjs` 要求目标仓库为精确私有仓库，绑定数值repository ID，并在上传/下载前后复核。固定Release tag为 `storage-dependencies-v1`；附件名为 `dependencies-<原依赖树SHA>.tar.gz`，单文件小于2 GiB。不覆盖同名远程附件，上传未知结果不自动重放；已有附件只有经过完整下载/解包后才能复用。归档过程不含生产删除，不改变启动校验器。

运行示意（先创建独立私有仓库及上述正式Release，scratch必须是已存在的独立目录；GitHub按tag查询草稿Release会返回404）：

```powershell
node tools/storage-retention-plan.mjs
node tools/github-dependency-archive.mjs archive-dependencies owner/private-backup-repo D:\isolated-scratch <精确计划SHA256>
```

## 删除采用前门槛

任何正式删除必须另由受控operator执行：本轮重新完整下载并校验远程归档；再次绑定仓库ID、附件ID、原清单、依赖树和当前链摘要；保护最近3版，确认候选无运行进程引用；遵守现有发布/服务互斥，逐候选完整验证原依赖树，写入持久预留与清理审计后仅删除精确 `node_modules`。删除后复核完整历史链和当前不可变release。未知结果停止，不扩大范围，不删除回执，不自动启动旧版。

恢复只允许先下载并在独立目录校验，再按受控路径恢复原依赖树；恢复依赖不授予旧版启动资格。当前架构跨过PNR的业务域只能受控前向恢复。

`storage-dependency-cleanup.ps1` 默认只验证1个候选，不删除；显式 `-Apply` 才删除，`-MaximumCandidates` 有界且默认1。持有现有 `Local\TERUISI.Worker.LocalService.v1` 互斥期间完成云端回下载、完整head验证、逐候选检查与后验；互斥已占用时立即退出。候选逐份绑定本次preflight摘要，完整内容验证后以原生PowerShell删除精确路径。目录缺失只跳过；内容不符、进程引用、删除不完整或未知结果立即停止。审计以flush-to-disk写入，scratch与结果需放在独立持久目录并保留。

```powershell
# 先把精确plan和两份proof保存在独立scratch；必须保持GitHub CLI登录。
powershell.exe -NoProfile -File tools/storage-dependency-cleanup.ps1 `
  -Repository owner/private-backup-repo -Scratch D:\isolated-scratch `
  -ApprovedPlanSha256 <精确计划SHA256>
# 按同一参数加 -Apply 先验证一份实际清理，再决定批量范围。
```

## 数据库保留目标

目标是本机至少14天且至少7份成功备份，云端按日/周/月分层归档。当前 `backupRetentionPlan` 只做计划，不授权删除，也未改变原来30天的正式策略。

数据库上传前须使用标准认证加密，密钥不得进入Git或同一备份附件。必须完成独立密钥恢复、云端完整回下载、解密和隔离PostgreSQL恢复；证据绑定原始备份manifest、authority、迁移版本及内容摘要。没有这些证据就保留本机备份。关键迁移/retirement/attestation及恢复记录继续固定保留，不因日常保留期到期清理。

用户已选GitHub私有归档与U盘/离线存储保存恢复密钥。云备份不把GitHub变成正在使用的数据库或附件对象存储；R2仍有效的图片/附件须单独盘点，不能声称一份PostgreSQL备份覆盖整机所有数据文件。

GitHub并非专用数据库备份服务；应限制传输频率与保留量，并在任何配额、权限、上传、校验或恢复失败时停止清理。数据库自动调度及生产采用须在上述验证之后实施。

## 验证

```powershell
node --test tests/storage-retention-policy.test.mjs tests/github-dependency-archive.test.mjs
python tests/storage-archive-bundle.test.py
node --import tsx --test tests/storage-retention.test.ts tests/worker-local-release-rotation.test.ts
```

安全回归覆盖私有仓库身份、上传未知/重复附件、回下载校验、归档截断与路径穿越、最新版本保护、链外拒绝、历史证据篡改拒绝，以及仅清理历史依赖后完整链和当前启动身份仍可验证。

参考：GitHub [Release附件](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) 与 [大文件说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)。
