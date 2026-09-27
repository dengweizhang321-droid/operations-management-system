# 0073 隔离 shadow snapshot 候选

这是**默认关闭、仅合成数据的测试脚本**，入口为 `tools/protected-ai-shadow-snapshot-0073.py`。本轮只实现独立脚本、纯测试及此说明，**未启动 PostgreSQL、未执行跨集群演练，也未修改正式备份、恢复、PrepareApp、迁移或旧 stream-v1 字节**。脚本的 `status=passed` 只有未来在受控隔离源与第二新集群实际跑完时才可能生成；当前没有该结果。

脚本仅接受 `.runtime/ai-pg-<12位十六进制>`、loopback 的 `teruisi_ai_rehearsal`/`ai_rehearsal_admin`、精确 0072→0073 合成升级证据、不同的隔离目标端口，以及显式 `--enabled`。缺任一条件先拒绝。执行时要求源私钥表原本为空，再插入一条随机合成 verifier key；源库因此只是可丢弃测试库。要求已有 HTML 和 XLSX 非空 file chunks，逐块独立复算 SHA-256，受限计数和总字节。全库源证据、9 个 protected 表行根、13 个全局角色及成员关系、文件根都从同一只读 repeatable-read 导出快照读取；快照 ID 的摘要和各根进入版本化加密上下文。`pg_dump --snapshot` 标准输出直入现有 v2-stream-v1 AES-GCM 封装，使用**进程内新生成的随机 256 位密钥**，不落地明文 dump；先验证错误密钥拒绝，再以同一加密文件双遍认证并向第二新集群的 `pg_restore --single-transaction --exit-on-error` 送入。恢复后逐项比较原库 content 根、protected 行根、文件根、全局角色，并调用 0068–0073 的既有目录验证。测试还要求正式备份入口在产生归档前以精确受保护迁移原因拒绝。

这不是正式备份路径：随机密钥没有托管、轮换、授权、灾备或重启后获取机制，进程结束后**无法长期恢复此归档**；`formalBackupPathVerified=false`、`longTermKeyCustodyVerified=false`、`productionWrites=false`。现有正式备份仍采用 `--no-owner --no-privileges`，在受保护迁移收据出现时提前拒绝；正式恢复仍拒绝 protected TOC。旧无保护历史备份的兼容性只因正式代码未改而保留，尚需在独立旧库做前后恢复实测。测试身份 `ai_rehearsal_admin` 是隔离集群管理员，不证明正式受控 operator、密钥管理员或生产授权链。

**剩余接线及验收**：当前 HEAD 的 test-only migration installer 钉在旧源码并拒绝 0074 及以上迁移文件，不能把它在当前源码上的成功虚构成 0073 来源。需先在独立、冻结 0073 源码/迁移清单中取得精确合成 seed，核 `.runtime` 路径和 source/target 端口，串行运行此 shadow，保留退出码、无明文归档、双集群停机和有限证据的 SHA。须真实确认 HTML/XLSX 均存在、私钥初始为空，验证错误密钥、ACL/owner 漂移负例、密钥/文件内容相同与篡改拒绝，并对前 0067 旧备份做独立恢复比较。真实持久密钥托管及受控正式身份设计另需授权与工程实现；在此之前不得打开正式备份/恢复门禁或认定报告已可发布。
