# 共用 collector 新鲜度修补独立复审

结论：本次精确源码修补通过，无剩余本范围阻断；生产未批准。受审 `tools/release-batch-admission.mjs` SHA 为 `6a7f8891a04daf7a52610505e940d1dfc46d879e63b11463a14bdb81092e6b6a`，作者测试 SHA 为 `c79b960eb09343c0f4df96238e7e5544a8a1c12dfbcb2c57949711a07d4a256d`。完整事实见 [机器报告](FRESHNESS_INDEPENDENT.json)。

先做原完整 artifact/head、恢复资格、source/session 内容检查，再完整 `verifyInstalledHead:true` 解析并核 chain-state/head binding/manifest path，重核 Django 原摘要及 journal head/条数；最后验证 Worker/helper，acceptance/closeout 再执行原完整 Status。所有新增慢检查都在末次动态采样之前。`observedAtMs` 保留 process 验证完成或实际 native 响应返回时点，解析及写盘不续期；非有限、倒退或超过 5000ms 拒绝，原 attempts/statusObservation/admissionStages 保留。

初稿 SHA `a05885b7…` 的四项独立检查复现两个相邻缺口：慢核验中 Django 或 journal 变化仍能返回成功。这是原有早采样不足，不是本补丁删除门禁。作者随后最小加入最终链/Django/journal 重核。最终独立 5/5、exit0、10.3751ms，前后源码 SHA 一致：慢 session 中真实外部 Django 摘要变动、慢读中 journal head 变动、chain-state/binding 相同但 manifest path 漂移、末 process identity 失败以及非有限采样年龄均拒绝；后三项实际结果按机器记录保存，失败状态不会被新时间白洗。

验证直接在 VM 执行实际完整 collector 函数，只用隔离 synthetic 外部依赖。没有 import 生产模块、创建子进程、网络/数据库请求或生产锁。作者 infrastructure 仅作夹具种子，独立在慢读完成点注入外部漂移；没有复跑或复述作者 11 项。作者报告 11/11 约 334ms 单列，不与独立项数相加。

原分类、manifest/plan、Django Prepare、完整制品、恢复、身份、权限、lease/WAL、Status 参数与断言、四类暂态及期限均保持。必要的最终完整 installed-head 重核增加成本，不计为缓存收益。时间是响应/验证完成点，不能冒称原健康探针开始时点或保证后续永不变化；原实际动作门禁仍不可省。

当前共用源码基于 main v3；这里只接受时序、真实时间和漂移守卫的精确差异，不接受 v3/NoData 生产采用。统一准备方须把同样修补移植到自己的 SourceBindingCollector，再绑定最终字节及闭包验证。没有构建或生产候选，不证明原 Worker 意外退出的根因已修复。
