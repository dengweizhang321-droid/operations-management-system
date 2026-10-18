# 发布前就绪修复

2026-10-18。routine，请求 gpt-6.1-sol High；实际底层模型未独立确认。开发基线 `4b733d1aed4bdc619adccb37debd61d57f1ce6fb`，使用独立 worktree。没有生产准备、部署、服务启停、控制安装或 hook 执行。

## 同目标准备与发布协调

- 保留 Git `old=0` 事件：真实首次 fetch 和 Git 2.55 `pack-refs` 都可能发该事件，不能以物理 ref 变化判断新语义目标。
- v2 队列先完整校验原 ticket/result/dispatch/native PREPARED/request 绑定；只有完整 selection（目标、packet、实际前驱与链）及 config/bundle 都相同，才向 consumer 传递原完成结果。consumer 再核 request/source tree 与原 PREPARED SHA，复用原完成事实，避免重复取得 rotation 和重复原生准备。孤立 PREPARED 仍走原生验证；未知、缺依赖或篡改继续拒绝。
- v2 发布在 fetch 前取得同一准备队列 lease，并持有至回执和实际版本确认结束。保持 queue→rotation 顺序；准备占用时在发布开始前拒绝。释放后唤醒可能由 fetch 排入的票据。
- 复用准备完成事实不代表新一次原生完整性复验；真正发布仍调用原有原生验证及全部动态门禁。

必要定向验证：`node --test --test-concurrency=1 tests/publish-latest-main.test.mjs tests/main-prebuild-queue-v2.test.mjs`，35 项通过、0 skip；包含私有 Git 真实 pack-refs/新 SHA、同目标复用、孤立及篡改凭证、前驱/控制代际变化、unknown/残 dispatch 和两种 prepare/publish 锁交错。`git diff --check` 通过。首轮收窄前 32 项通过不作为后续改动的证明；最终 35 项覆盖收窄后的字节。最终候选兼容验证和独立审查由交付负责人安排，未把上述函数/隔离测试称为生产发布或完整冷启动。

## Pi 与首次采用

候选 `Stop-PiRuntime` 保留初次精确 Resolve、原 token stop 写入、45 秒总 deadline、最终 ack 和原 Stop-OwnedProcess/runner stop；仅观察循环改为专用只读 helper。退出中的元数据缺项继续等待，fresh CIM 零行才建立 absence；查询异常、多行、任一已知身份字段变化或 receipt/control 原件漂移立即拒绝。unknown 不进入清理或 runner stop。

必要定向验证已通过：PS5/PS7 各 11 个瞬态/失败/身份/超时/原件/ack 用例；PS7 真实 `Start-ManagedProcess` 启动原 `pi_worker.main`，私有空 SQLite、独立 authority、连续两次真实空队列 SELECT 后建立可运行证明，再调用候选 Stop，核同 token 真实 ack、精确进程退出、receipt 清理一次及 stderr 为空。网络完全禁止，生产配置不继承。测试明确把 runner stop 替换为计数接缝，**没有执行固定 WSL runner 生命周期或完整 Pi 冷启动**。使用只读隔离 Python：`D:/codex-artifacts/release-three-optimizations-20261018/venv/Scripts/python.exe`。

AST 边界测试通过：仅固定 SHA 的新增 observer 与 Stop 内精确观察替换/原件绑定获资格，其余函数、参数、分发与路由冻结；增加调用/改 Start/runner/observer 均拒绝。规范记录了该 Windows 观察缺陷的限定资格，候选验证器输出 `piWorkerExitObservation=true`、`nativeColdStart=false`，不把真实 worker 闭环冒称完整 runner 验证。

Pi150 successor gate 已核：它验证原历史 plan/receipt 与当前 migration delta；本次没有 migration，未删除 CODE_FILES 或放松历史 proof 绑定。最终 PrepareApp/DeployApp/Start 仍走原 gate。
