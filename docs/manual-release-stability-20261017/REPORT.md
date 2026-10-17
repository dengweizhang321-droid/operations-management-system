# 手动发布包稳定性修复

范围：继续准备 main 发布包，交付用户手动点击的固定 BAT。本轮不执行生产维护、部署、迁移或服务启停。

## 修改与证据

- 保留原生命周期互斥；仅对 BeginMaintenance、CompleteDrain、EndMaintenance、AutoStartDingTalk 使用最长 120 秒等待，并服从继承的总时限。普通操作和 Start 的防重复启动及维护围栏不变。
- 对当前精确旧 Worker/Django 前驱增加同一次 publisher 内的首次维护有限协调。原失败、actor 身份、请求及 STARTED 原件保留；当前完整停止、原 controller 退出、持锁 owner、同维护 ID 和完整来源全部核实后才允许最多一次原入口续接。其他前驱、迟到进程、后续动作或证据不足均停止，不重跑整个 publisher。
- Pi150 发布闭包补齐 publish-prepared-main 及所需的手动维护辅助文件，避免源码准入成功而后台包缺文件。
- 沿用既有直接进程退出及文件快照传输，不改写输出协议，不取消版本、权限、维护或未知结果保护。

## 验证

- Windows PowerShell 5 与 PowerShell 7 私有命名互斥夹具：超过 30 秒等待成功；继承时限、停止/维护围栏、已放弃互斥路径通过。测试不启动生产控制器。
- 首次夹具失败来自测试变量与 native Operation 参数重名；修正为 effectFile 后通过。原失败未记作成功。
- 现有 publisher 43 项、有限续接 35 项及原维护互斥 13 项通过；双层编码控制进程增量与最终 Pi149→150 隔离证明在代码冻结后补记。
- 独立复核发现 WSL 观察期限误用毫秒和旧 Django 包无 process-deadline 文件，两项均按实际已安装文件闭包修正；不修改旧运行包。另用真实 productionCommandArguments 合成命令复现并修复双层编码的迟到控制参与者漏识别。

## 交付状态

当前为候选修复。只有合并推送、最终提交对应原生 PREPARED 成功后才报告可手动发布；准备完成不等于上线。

PS5/PS7 结论仅覆盖私有命名互斥与纯断言夹具；实际 publisher 固定使用 Windows PowerShell 5，不宣称完整生产链已在 PS7 运行。

## 独立复审结论

独立审查确认三项真实阻断已修复，最新有限续接与 publisher 共 78 项通过。仅对当前精确旧前驱启用有限桥接，不声称通用恢复。无法分类的编码 PowerShell 控制参与者保留 unknown，禁止续接。

已对先前 f9507f253046 原生准备包只读核对：后台 staging b5bec1ea94c14a3385fbfb83d77d1a00 缺 publish-prepared-main.mjs，而冻结 source 存在；本修复补齐真实 CopyApp 清单，最终包还需逐项核对。

两轮早期 Pi 合成库演练均通过；之后因审查修复导致代码绑定变化，旧证明不用于最终发布。最终证明必须来自全部代码冻结后的重新演练，不重新签名旧结果，不移除受影响文件。

## 最终冻结验证

- 定向 Node 测试 96 项通过：publisher/有限续接 78 项，真实双 shell 互斥与原维护 gate/命令选择 18 项；无全仓测试或全量 lint。
- 最终 Pi 演练目录：`.codex-tmp/pi-agent-npakdlm3`，合成 PostgreSQL 55531，149→150 原子升级/回滚、精确目录、权限、旧数据保留、unknown 禁止重放、Pi状态与旧队列隔离全部通过；有限安装器 6 项、Pi runtime 29 项。数据库已停止，临时密码文件已删除，无生产写入或全库备份/恢复。
- [最终迁移证明](schema-validation.json)由原始演练输出逐字节复制，recipe 同步真实 codeSha256/validationSha256；codeSha256 `74c6e6b8686dd69c011491ccc9b66a438b2f2c823c53d6186e869fdfc2d92d6b`，validationSha256 `6cf9320118e3277c1c971afb99557d28a14cd86dded42d02084c9efc1b5625f0`。
- 最终合并提交及 PREPARED/BAT 检查回执保存在固定发布目录的 `MANUAL-PACKAGE-DELIVERY.json`，避免为记录生成的提交本身反复重建制品。
