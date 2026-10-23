# 同次操作内退休档案验证复用

本轮只修诊断 status 的可选文件读取，并为退休 reader 增加显式、进程内、单次操作拥有的 scope。没有现场准备、采用、重启、封源、封存或发布；原 unknown、两个旧 decision 和历史读取不变。

## status 兼容

可选 RESULT/WATCHDOG 先核存在性，存在的文件仍经原安全读和 JSON 解析。修复后仅查询既有 feb0126f-e9ba-40f7-9fb3-064f88d38fa5 的 status：exit 0，readonly-completed，仍是 diagnostic-partial。RUN/RESULT/EXIT/PINS 前后摘要相同，未重放 frozen-run。原完整只读结果中的 37.170s 是部分组合，缺 ordinary/实际 adoption 等资格，不代表完整生产门禁通过。

## scope 与调用边界

- 核心 WeakMap 保存 opaque token 的进程、配置、registry、当前采用/native 与各 intent/seal/archive 身份；公共断言只返回 true。registry 即使为空也绑定。dirty 只清 witness，身份漂移仍拒绝。
- 首次完整 reader 连统一尾检成功后，才保存实际档案 snapshot；同 scope 同只读阶段仅省档案字节全哈希。每门仍重新读取证据、ACL、Git 保全、fresh collector、全部档案 stat/member/link、boot/ref/native/control/original/SEALED 尾检。无 token、新 token、dirty 后均全读。
- 同 token 并发/重入拒绝，不共享 pending Promise；取消、失败、未 await、关闭均用 epoch 失效并排空本 scope 在途读。首个失败原因保留；finally 先关闭/abort/清内存，再 drain。关闭后不能恢复。
- 全 scope 缓存累计最多 250000 项、1024 对象、估算 128MiB；触界清空已有 witness，单轮过大则不缓存，仍完成原全验，不新增业务拒绝。
- admission/resolution/queue/publisher 只显式传 token；动态导入 core，无新增生产模块，controlFiles 仍 32。queue 有 token 时必须显式传 invalidator。fetch、dispatch、冻结、pointer/结果/控制执行记录写入、原生调用、下一轮、等待及锁释放前清缓存。释放锁由 finally 保证。
- publisher 新全文 SHA 单列为 currentLatest，已审 16de 前 current 以原语义精确保留；未增加任意旧工具族。

## 定向检查及限制

首组 4/4（29.603s）：实际私有 collector/Git/档案/evidence reader 的字节打开计数证明同阶段两门只全 hash 一次，dirty 后重读，无 scope/新 scope 各自全读；每门 collector 都运行。cached 档案变化、原地址返回仍拒绝。另检空 registry 漂移、opaque/closed/config 变化、并发/取消/未 await/drain、真实 queue 写边界和 unknown 禁重放。测试的 OS token/boot/chain/CIM 使用既有私有替身，不是现场退休证明。

随后仅三个小边界复跑 3/3（0.236s），覆盖 queue 缺 invalidator 写前拒绝与 scope 生命周期；首因保留分支另作静态核定，未专门测试 callback 内部 catch 后返回。实际重型 reader 结果按未改变的哈希/CAS路径复用。fresh Node 的 publisher→queue→core 导入通过。status 单项 1/1（6.284s）及 status-only 现场结果分别留证。原始工具回执与 pins 见本目录 checks。

本轮没有重复完整现场只读、全仓测试或构建。写边界仍会保守重新全验；本轮不保证发布总耗时或每次必过。实际 ordinary/Task/采用/退休/发布准入仍须原流程核验。
