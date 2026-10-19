# 4aac 准备失败的有限闭合

仅处理 dispatch `4aac89ca-952b-4779-b0fa-3e6764dab39d`、ticket `a9b49c5b-0222-4c72-b903-6030dcfde4b4`、target `477a94bf29f256561787284f5e095a4a7a11c662`。原 unknown、FAILED、PREPARING、source-binding 和原期限保持原件，不重放旧 packet。

原 typed timeout 的 elapsed 为 212130ms，绝对期限与 dispatch 相同，不能把错误中的 600000ms 当成实际跑满。固定原源码的内部校验失败清理 candidate/staging；现场须再证明没有原身份匹配的 manifest、plan、prepared、consumption 或 successor。决策固定 `failed-cleaned-before-plan`，native 已开始、candidate 已不存在、prepared/publication/retry 均为 false。

当前版本只接受已完成的 backup composition `3918480d` 的唯一 successor：原 request、原及标准 SUCCESS、末 successor 与 approved plan 精确归档；原 resolver 验证完整有效链。该请求前驱仍为原 4aac 的 9a，当前 head 固定 f28b、Django 固定 54a48ee1；不接受任意新 head。

普通 writer 连续持 queue→rotation 双锁；初末两遍完整元数据库存相等，五个 Worker 状态域、全部 release manifest、当前 Worker/Django 及历史 staging 目录身份均核对。只枚举旧 staging 的目录元数据，不读其 payload。每轮 spawn/token/Git/原件检查在 REQUEST 前完成；高 observer 后只做短 CAS、一次低 CIM、严格交叉比对和短写。末轮最早高动态采样至 append 保留 60 秒门槛；拒绝保存投影，不写成功 ACK。

控制包先采用最终提交。沿已验证的普通 Limited 投递运行：

```powershell
node tools/cleaned-preparation-writer.mjs --out D:/codex-artifacts/prepare-4aac-resolution-20261019/NEW-ATTEMPT
```

常驻独立高观察会话按 writer 输出逐轮运行（值取原 REQUEST，不自行拼造）：

```powershell
node tools/cleaned-preparation-observer.mjs --request REQUEST_FILE --sha REQUEST_SHA256 --out RESPONSE_FILE
```

writer 无 target、重试、状态目录覆盖参数；只追加固定 resolution，历史 reader 从封存原件复核。闭合成功后新目标才走正常新 ticket。新正常 dispatch 固定预算从 30 改为 60 分钟，原期限不重置；单校验 600000ms、Django 1800000ms、rotation 等待及观察器 30 分钟保持。

隔离验证范围：新有限分支、metadata 身份/Windows 路径、actor 与高低投影拒绝、预算透传、历史 693e reader/原字节以及真实私有控制包契约。兼容报告绑定最终冻结提交；现场双锁/普通 writer/独立 observer 成功由发布负责人另留原回执，本报告不宣称生产已闭合。
