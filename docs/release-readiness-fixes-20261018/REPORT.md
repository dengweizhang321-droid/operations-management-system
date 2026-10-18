# 发布前就绪修复

2026-10-18。routine，请求 gpt-6.1-sol High；实际底层模型未独立确认。开发基线 `4b733d1aed4bdc619adccb37debd61d57f1ce6fb`，使用独立 worktree。没有生产准备、部署、服务启停、控制安装或 hook 执行。

## 同目标准备与发布协调

- 保留 Git `old=0` 事件：真实首次 fetch 和 Git 2.55 `pack-refs` 都可能发该事件，不能以物理 ref 变化判断新语义目标。
- v2 队列先完整校验原 ticket/result/dispatch/native PREPARED/request 绑定；只有完整 selection（目标、packet、实际前驱与链）及 config/bundle 都相同，才向 consumer 传递原完成结果。consumer 再核 request/source tree 与原 PREPARED SHA，复用原完成事实，避免重复取得 rotation 和重复原生准备。孤立 PREPARED 仍走原生验证；未知、缺依赖或篡改继续拒绝。
- v2 发布在 fetch 前取得同一准备队列 lease，并持有至回执和实际版本确认结束。保持 queue→rotation 顺序；准备占用时在发布开始前拒绝。释放后唤醒可能由 fetch 排入的票据。
- 复用准备完成事实不代表新一次原生完整性复验；真正发布仍调用原有原生验证及全部动态门禁。

必要定向验证：`node --test --test-concurrency=1 tests/publish-latest-main.test.mjs tests/main-prebuild-queue-v2.test.mjs`，35 项通过、0 skip；包含私有 Git 真实 pack-refs/新 SHA、同目标复用、孤立及篡改凭证、前驱/控制代际变化、unknown/残 dispatch 和两种 prepare/publish 锁交错。`git diff --check` 通过。首轮收窄前 32 项通过不作为后续改动的证明；最终 35 项覆盖收窄后的字节。最终候选兼容验证和独立审查由交付负责人安排，未把上述函数/隔离测试称为生产发布或完整冷启动。

## Pi 与首次采用

正在实现，尚未验证或采用。现有 runner 生命周期固定到生产 WSL unit/端口，不能在本机通过 synthetic config 获得私有完整 runner 冷启动；不会添加测试后门或触碰生产。后续证据将明确区分真实私有队列 worker 闭环与完整 Pi runner 冷启动。
