# W6R Pandas Broker 内层诊断与专用轮换

## 源码与采用边界

- `backend/pandas_runner/server.py` 和 `diagnostics.py` 从首批保全候选逐字节恢复。Broker 完整运行包从 `3173042892d14e6edcf8465b8ea97e878f307e08fdb1c81d2752f82e03dcc610` 变为 `5bfb727f33095c0d3e4f9b63644fc0dda8c2b69293a38ea25acf49ca5d3913c5`。签名协议、严格探针、首次安装器及固定容器策略沿用原代码。Broker 将已验签的业务请求按 nonce 摘要串联到本机 journal，记录接收、防重、解码、容器预检、创建、隔离、运行、结果、清理及回信。诊断发送失败不影响执行或清理。
- `PreparePandasRotation` 绑定冻结应用及其收据、原/新运行包逐文件摘要、同镜像、配置、固定 UID/socket/state、Windows DPAPI 密文及同一通道密钥的私有指纹、原/新单元字节和 operator 字节。只创建不可变 release 及 plan。准备和复验不发签名状态请求，因为原状态探针也会登记 nonce。Pandas 未配置时显式返回 disabled 证据并在维护前重新核验。
- `SwitchPandasRotation` 要求原发布租约与维护 ID、原准备应用已安装、Windows AI 与 Pandas 保活停止证据。Linux 在固定域互斥内重新校验有效 unit、停止状态、精确进程、监听、Broker 文件锁与本域零容器，先持久登记意图，再仅原子替换 unit 并执行 daemon-reload。该回执状态为 `switched_stopped`。未知意图保留，拒绝再次切换。
- 原 `Start-PandasSandbox` 使用同一意图进行一次启动，分别执行原签名状态探针及合成计算。探针前后绑定同一 Linux PID、systemd invocation 与启动时间。原接缝使用 create-only 写入 attempt 和 startup 回执。`CompletePandasRotation` 读取这份回执并核对已持久证明，同一原意图可观察补回执。观察不重启、不再次执行合成计算、不改 nonce ledger。
- 准备应用显式复制两个 operator 与发布模块。生产入口固定在受保护的 Windows app/prepare 路径、专用 WSL 发行版、用户和 unit，独立试验布局只存在测试入口。Node 侧串行发布接线、恢复限制及控制器资格由批次负责人一并集成与审查。

## 验证结果

| 证据层 | 实际通过范围 |
| --- | --- |
| 原生 Linux/WSL | 独立 `Codex-AI-Batch2-20261108` 上真实 root-owned unit/release、systemd user unit、UID 1000 rootless Docker、原镜像入口、严格签名 status 与合成计算。准备时原 unit/config/key/ledger 字节和进程保持，切换后原 nonce 仍在同一 ledger 并被拒绝。验证了原进程运行、端口占用、候选权限、准备收据和通道指纹冲突、drop-in、容器遗留、CAS 冲突拒绝。意图后与替换后 reload 故障注入均保留意图且拒绝重放。最终三个试验 unit 均 inactive、MainPID 0，私有端口 18129 零监听，本域零容器。 |
| 两来源 DataFrame | W6b Django 导出器接收合成来源响应。商品日真实走两页，销售品类趋势走一页，两个完整帧通过签名请求交给同一真实隔离容器。结果是商品日 2 行、销售品类 1 行、合成净额 −300 分。Broker 对该调用写入十个脱敏 journal 阶段。此证据不改变两次历史失败内层原因未确定的结论。 |
| Windows 原生参数和准备应用 | Windows PowerShell 5.1 执行真实准备应用复制和 ACL、`PreparePandasRotation` 与 `PandasRotationCheck` 参数入口，验证未配置路径、移除已配置计划拒绝、两 operator 和 Node helper 的文件摘要闭包。 |
| Windows 已配置启动接缝 | Windows PowerShell 5.1 从实际控制器读取并执行 `Start-PandasSandbox`、`Complete-PandasRotation` 与原 create-only 回执函数。使用独立测试 unit 的真实 systemd 启停、原签名探针及真实合成自测，真实 Linux 身份与完成回执。重复完成复用原回执，两个探针各一次。Windows keepalive、安装保护与发布租约由私有夹具代入，配置后的完整 Windows 服务栈未启动。 |
| 直接测试 | Broker 签名及诊断 16 项中 13 通过，Windows 上 3 个 Linux 容器测试跳过。独立 WSL 的原生验证如上。Python 语法、PowerShell 解析和差异空白检查通过。 |

- [最终原生 stdout](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/native-run-05.stdout) · [原 unit/切换/完成及清理回执](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/native-rehearsal-observed.json) · [真实镜像材料](D:/codex-artifacts/ai-repair-batch2-20261108/environment/IMAGE.json)
- [实际 Windows 参数与复制](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/windows-ps-fixture-01.txt) · [已配置启动接缝](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/windows-startup-seam.txt) · [Broker 直接验证](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/broker-unit.txt)

原生试验 01 的私有账号配置目录缺失，02 暴露 Ubuntu systemd 的固定 root-owned XDG 兼容路径。已分别补齐试验目录并在生产 operator 中精确接受同一 canonical unit 的固定兼容目录，原失败留存在外置目录。原生 05 使用最终 Linux operator 字节。Windows 接缝日志保留真实 startup JSON，Linux 05 原生回执保留其独立 startup SHA。

本子包保留所有真实旧失败和未知回执。试验使用私有目录、独立端口和合成数据，生产环境、正式制品、主线及真实模型调用均无操作。
