# 任务 D：采用任务 A 的集成边界

任务 A 只交付源码与隔离验证，不含生产许可。生命周期工具本次首次采用仍是严格发布，前后备份/恢复、排空、权限、完整性与原服务身份门禁保持。

1. 使用最终合并提交准备全新精确候选/批次；不得沿用旧请求 argv、旧工具摘要或手改历史 WAL。保留未决旧批次的原固定协调入口，原 started/unknown 不自动重放。
2. 每个生命周期 command.files 需额外绑定适配器同目录的 `process-deadline.ps1` 实际路径和 SHA；保护主入口、Control、Worker service 和 watchdog 安装副本的 helper 闭包都须提前 pin。Worker 新包已将 helper 列入 guard/bundled/key files，沿原受保护入口安装与回读；11→12首引入和半安装恢复负例通过。实际导入的任务B `release-readonly-retry.mjs` 也加入 bundled/key files；watchdog Install 会复制并绑定 helper SHA，本轮没有执行 Install。
3. StartWorker 新参数 `-ExpectedWorkerManifestSha256` 必须等于 batch.binding.artifactSha256，`-ExpectedDjangoManifestSha256` 等于 batch.binding.djangoCandidateSha256，`-MaintenanceId` 等于 batch.binding.maintenanceId。Worker-only 展示路径还需唯一 `-ExpectedDrainId <同一维护ID>`，严格路径不带此参数。缺、错或重复参数在封存阶段拒绝。
4. 只有原直接 exit0、有效引擎完成、精确两端 manifest/PID/release、全部原启用组件和预期维护/requests gate 均确认时才 passed。HTTP 200、曾经 ready 或晚到结果不能覆盖非零/未知。完整就绪门禁继续使用原 Control/Status。
5. `TERUISI_PROCESS_DEADLINE_UNIX_MS` 是本次调用的绝对预算，仅在子环境传递/临时恢复；不写全局环境、调度或服务持久配置。准备环境指纹仅剔除这个保留字段，永久supervisor启动前清除它并恢复控制器父环境。新子调用只能取更早期限。任务 B 的只读重试也必须消费该期限，不能在 A 超时后重置总预算。
6. 生命周期/写入 operator 用 preserve，超时留未知和占用；只读 probe 用直接内核句柄清理；普通测试/构建仍用原预算内 tree 清理。短预算 tree 未确认会保留明确诊断，不能泛化 killtree 到服务。
7. D 的计时分别列启动引擎、完整状态校验、外壳与协调等待以及批准至全部收尾总时。合成秒数不替代原3.7–4.2分钟生产启动，也不证明生产提速已达标。
8. watchdog 测试没有真实发送；公共函数修改后仍保留 DWS sending/unknown/sent 不重发。R03 部分成功状态保留、代理退出和其他业务问题没有顺带实现。

相关测试入口为 `node --import tsx --test tests/release-wait-optimization.test.ts tests/release-process-deadline.test.ts`；第一个已经导入 PS5 环境回归，不再重复添加该 mjs 文件。另需 Worker service/rotation、watchdog原回归、最终构建与修改文件 lint。完整日志及已知失败在 [报告](REPORT.md) 中列明。
