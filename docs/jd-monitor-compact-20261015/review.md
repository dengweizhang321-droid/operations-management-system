# 独立增量复审

结论：本轮补货公式、周期设置、逐仓汇总及离线查表接缝复审通过，未发现阻断问题。审查基于 `codex/jd-monitor-compact` 的冻结后端增量及当前前端、投影工具差异；未修改业务代码。

- 用户已明确确认默认30天、周期可设置及完整推荐公式：`max(0, ceil(近30日销量 / 30 × 周期 − 可用库存 − 采购在途 − 调拨在途))`，逐仓计算后求和。
- 独立使用 `Fraction` 有理数公式对照实际后台函数，原23个断言通过：周期与精确取整、零销量、负销量、缺分量、日期资格、缺现有库存、逐仓富余不抵消、未知成员使合计未知、混周期披露，以及7/30日窗口切换。固定30日缺货依据不受补货周期影响。最终删除零销量无条件归0的特例后，仅增量验证5个边界例并全部通过：零销量、可用库存−3且在途0时建议3；在途逐步抵扣后分别为1和0；非负净库存时为0；负销量仍未知。原23项未重复运行。
- 周期范围为整数1–3650，默认30；API与0014数据库约束一致。设置沿用管理员权限、事业部范围及 `expectedRevision`，省略周期保留原值，非法值与旧版本拒绝。前端只提交所编辑字段，原提交范围及迟到响应护栏保留；这部分接缝为源码复核，未新增动态角色切换测试。
- 离线试算按完整仓库成员身份登记后台结果，客户端仅按周期和成员键查表；未知数量仍显示“—”，不在客户端重算补货量，也不保存正式配置。

独立证据：[原23项结果](D:/codex-artifacts/jd-monitor-compact-20261015/independent-replenishment-math.json)、[原复验脚本](D:/codex-artifacts/jd-monitor-compact-20261015/independent-replenishment-math.py)、[最终5项增量](D:/codex-artifacts/jd-monitor-compact-20261015/independent-zero-demand-delta.json)、[增量脚本](D:/codex-artifacts/jd-monitor-compact-20261015/independent-zero-demand-delta.py)。数据库连接与网络尝试均为0。

复用并审阅作者的[最终8项RAM结果](D:/codex-artifacts/jd-monitor-compact-20261015/backend-replenishment-ram-zero-demand.log)：包含0013→0014→0013→0014、原部门及人工状态保留、范围/CAS和实际签名HTTP权限。未重复旧59项PG套件及既有页面全套；本轮未启动服务或真实浏览器、未操作正式数据库、未执行正式迁移或外部发送。最终HTML构建与程序DOM证据由交付报告记录。
