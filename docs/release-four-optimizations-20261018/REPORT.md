# 发布兼容性前置与重复读取优化

用户授权落实四个方向，并明确不再使用 BAT 手动上线。实现基于 `cdb2ae60` 的独立 worktree；不修改主工作区已有内容，不接管另外三个已合 main 业务任务的发布，不执行生产切换。

## 实现

1. 合并前兼容入口 `tools/verify-release-candidate.mjs` 从干净候选完整差异选择精确适配器，在私有候选树执行受审的 Node/PS5/PS7 检查。报告绑定 Git 树、完整载荷、依赖树、执行工具、退出码和原始输出摘要；不接受手填 passed。未知变更需新增受审适配器，不能静默套用不消费新代码的通用测试。
2. 普通发布 CLI 和 programmatic 缺省调用仅消费已准备包，准备显式使用 `--prepare-only`；模式冲突、缺 PREPARED、未知 STARTED、来源/请求/前驱漂移均停止。旧封存精确恢复不热改。LATEST 指针将来源冻结与原生准备成功分开，不再用顶层 prepared 冒称包已就绪。兼容 BAT 保留，但不再默认要求用户点击。
3. Worker 准备身份和绑定 source snapshot 验证在单次稳定读取中同时生成 tree hash 与文件 inventory，保留 ordinal/path-length-content 协议、有界并发、分块读取及路径/链接/读取中变化拒绝，不跨调用缓存。新 inventory 正确纳入 `__proto__` 文件名，避免原普通对象 setter 吞掉该叶；当前源码没有该特殊名。
4. 当前 Django 各域已有同轮应用树与 ACL 复用，不重复建设或计为新增收益。本次仅对 v2 树扫描已枚举文件直接打开完整 SHA，省去逐文件重复 Test-Path；公开 missing 语义、旧 v1、Start/Stop 路由、动态数据库和身份检查保持。新增编排失效回归只证明私有编排边界，不声称完整冷启动。

## 验证与采用边界

固定候选验证命令：

```powershell
node tools/verify-release-candidate.mjs --base cdb2ae60 --out <工作树外不存在的新目录> --dependencies "D:/运营管理系统/node_modules"
```

候选必须先聚焦提交且保持干净。真实结果、最终候选提交和所有输出保存在 `D:/codex-artifacts/release-four-optimizations-20261018/`；机器报告记录实际成功或失败，不由本文预先宣称通过。源码变化重新运行适用检查，纯资料增量按字节绑定核对复用已有源码验证。

证据明确分为：实际包的 copy/manifest/依赖/Wrangler/ACL/local-R2 完整性；真实 Node 封装及 PS 参数/路由到首个副作用的边界；完整原生冷启动。包测试仅将生产停止观察及生产迁移准入替换为严格私有根断言，未运行生产迁移、停止或完整原生部署。完整冷启动未执行；本次 Django 仅摘要辅助函数变化，验证器用实际 PowerShell AST 核对其他函数、参数和顶层分发未改变。若生命周期语义变化，固定验证器拒绝以这些证据放行。

私有合成暖缓存基准共841文件、87,162,897字节，5轮交错测量：旧准备双读中位3232ms、旧snapshot双读4691ms，新合并单读903ms。仅是该合成语料局部结果，不能外推生产总时长或15分钟目标。原始值与可复现实验脚本分别为上述证据目录的 `worker-read-benchmark.json`、`worker-read-benchmark.mjs`。

合并、正式制品就绪与生产采用分别报告。仓库交付不代表已安装入口、现有不可变运行包或正在执行的批次已更新；后续生产采用仍需本次对应授权，不回溯阻断既有三个业务任务。

首次真实验证保留两类原失败：旧通知断言/PS7模块环境不齐；随后私有包在长用户TEMP拓扑中 local R2 put 返回 Network connection lost。补充保留底层诊断后，既有短卷根独立Wrangler真实roundtrip通过；包夹具采用该已验证的短路径及独立TEMP/XDG/日志拓扑再验。这里没有断言已经定位该通用错误的唯一底层原因，也不把私有环境调整称为生产缺陷修复。

## 最终隔离验证

冻结源码 `11314867cdd9b55c24fe0c15e51aea63e1c2ec47`，Git tree `0b6aeb12f9d382cc1397006e57105cd624db8a20`。真实验证器在2026-10-18 01:49:52—01:53:51（上海）完成，`candidate-final-2/REPORT.json` 全部10组成功：Node发布95项、Worker47项，PS5/PS7各3组摘要与编排回归，真实参数入口及跨文件路由，以及实际私有包 copy/deploy/hash/ACL/local-R2。临时包和候选工作树已清理；原失败日志保持。

机器终态 `packageIntegrity:true`、`nativeEntryBoundary:true`、`nativeColdStart:false`；完整原生冷启动没有冒称执行。依赖31,336文件、载荷9,119文件、PowerShell模块及5个执行工具均在同轮绑定/末尾复核。定向ESLint零错误/警告，本次规范与说明72个本地链接存在，差异检查通过。独立规划请求Astra High，独立关键审查请求Sol High，工具未独立返回实际底层型号。

本节为验证后的纯资料增量；交付提交与上述受测源码之间只允许文档变化，使用 `SOURCE-VERIFICATION-REUSE.json` 程序核对后复用这些有效结果。用户另有三个已合main待发任务，本轮先保留并推送已验证分支，合main/对应正式制品准备按用户选择衔接；没有生产切换。
