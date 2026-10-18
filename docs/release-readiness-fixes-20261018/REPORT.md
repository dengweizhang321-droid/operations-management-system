# 发布前就绪修复

2026-10-18。routine，请求 gpt-6.1-sol High；实际底层模型未独立确认。开发基线 `4b733d1aed4bdc619adccb37debd61d57f1ce6fb`，使用独立 worktree。执行者没有生产准备、部署、服务启停、控制安装或生产 hook 调用；真实 Git hook、进程和数据库测试仅在专用私有夹具内运行。主工作区原有改动保持。

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

## 维护与控制安装前置

- 控制材料生成在创建 out/intent 前调用现有只读 `nativeOperationBindings`，尽早拒绝非法证据布局；采用阶段原动态扫描继续保留。合法成熟 source/node_modules junction 不进入操作证据后代扫描。新增私有重解析点反例通过，拒绝时未创建材料目录。
- 发布在原 PREPARED 复验完成后、STARTED 前核真实前驱、现有控制器与恢复材料。冻结请求的 `--check` 共用静态只读检查。当前 19db 原生 Stop 仍是旧实现，因此为精确 Worker `20261018T081823Z-282cee340c57bf41`/Django manifest 组合准备有限首次采用桥；候选退出观察器采用后普通后继使用原 native Stop，未知控制代际在维护前拒绝。
- 19db 首次门禁在原 Worker/Django 两锁内复核预绑定 Pi receipt/config SHA。原维护失败后保留原 ID、STARTED、FAILED、actor、源代码与请求；只有原 rotation owner 精确身份及 pipe 仍在、原维护 actor/控制后代退出、Pi 原 token stopped ack 与精确 PID absence、同 ID requests gate、前驱不变、无后续作用时才进入一次原同 ID EnterMaintenance。
- 独立 Check 子进程生成 create-only 观察文件。续接绑定其路径/SHA、120 秒期限，并在动作前独立重读当前事实；SHA 写入续接 STARTED/COMPLETE。长期服务只允许原 native receipt 和 `Get-VerifiedProcessDescendants` 验过的精确身份，late Python/WSL 控制后代继续拒绝。已完成维护仅在原 durable native completion 和原 native stopped 断言齐全时协调，不把 Windows 进程消失当成 Linux 完整停止。新续接开始后拒绝再次进入；其他 unknown 不重放。
- 现有 c9da 桥保留默认 legacy 路线。PS7 的新 Pi 路线保留 ISO 日期字符串，数值 PID 允许 int/long 且限制 Int32 范围；字符串 PID/exitCode/version 和强制布尔值拒绝。原部署/apply/Start/ready 尾部保持。

必要定向结果：19db 新范围 25 项全部通过，包含发布者成功/unknown 集成、原始失败保留、PS5 真实 productionCommandArguments/environment 外层、PS7 参数入口，以及两 shell 真实原生断言的 late control、receipt/Pi token/absence、重复 JSON、first CAS、真实 JSON durable completion 反例。原 legacy 路线与原生发布尾部的定向 59 项通过；受影响的 publish-prepared 原功能在首轮同批检查中通过，新增 Pi 字节未变时不重复跑其已过验证。当前实际 19db 只读静态 readiness 也通过（六个源文件 pin、真实控制器 SHA、Pi receipt/config 绑定），未取生产锁或调用控制入口。

原失败如实保留：control 新夹具初次缺 TypeScript 依赖，接入只读依赖 junction 后该项通过；新桥夹具曾因旧 fixture 未显式允许私有 inline preparation、PS debugger 未阻断、PS5 继承 PS7 模块路径及 PS7 Int64/ISO 自动解析失败。最终改为真实外层首个私有缺失输入失败边界、主机模块环境、原生 JSON 类型用例和明确的私有 fixture 模式，未放宽生产门禁。上述问题不回写为曾通过。

## 交付与后续执行边界

源码先后形成独立 queue/lock 提交 `1d0337de`、Pi 观察提交 `9ee85c42` 与本次就绪前置提交。最终固定候选兼容验证、独立机器报告核验、合并/推送及制品准备由交付负责人串行完成；结果写入工作树外 `D:/codex-artifacts/release-readiness-fixes-20261018`，不为收尾文字改写冻结树。本报告不表示已合并、已打包、控制已采用或已上线。

控制升级保持八文件不可变 bundle；不同 config/bundle 的旧 queue 结果不得改写成新代际 fast reuse。同目标/真实前驱/input 不变时原 packet/native PREPARED 保留。最终包已准备后，下一次获授权采用新控制入口应直接 deploy 已备精确包：新 CLI 在 fetch 前持 queue，期间同目标 ticket 发布完成后以 already-current 闭合，不预先另跑新代际 prepare。联合交错增量测试通过。若另行手动调用新代际 prepare，因无同代际 terminal 会保守执行一次原生复验，仍复用既有 plan/PrepareApp，不重建或 npm ci；配置输入若真变化则拒绝覆盖旧请求。正式采用前须比较真实控制 CONFIG 与固定配置输入，不能仅据代码推断相同。

本轮未执行生产控制安装、部署、维护、服务启停或数据库迁移。完整 Pi/WSL 冷启动仍未执行，范围仅为已限定的 Windows 退出观察与私有原生 worker 闭环。独立审查已核实现与增量反例，最终机器 REPORT 仍由负责人核验。
