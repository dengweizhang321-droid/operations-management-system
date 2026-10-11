# 第九个精确 namespace pair：V6 冻结

2026-10-11。当前交接为 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_LIVE_GUARD_CORE_HANDOFF_V6.json`；代码到此冻结，不再编辑。原三次QA失败、旧source绑定/记录和运行包保持原样。

已独立完整读取管理员观察 `PRIMARY_ADMIN_WSL_NAMESPACES_V1.json`，SHA256 `bc969d234858aed26dda6518ceea523714b2c68ecb4807bace9524c14f51ae25`。无采集错误，`mnt:[4026532299]` 稳定，raw mountinfo SHA为 `9745f6ec4272c1c03e31c2e4c8d1ed5f6b42dfa5690cedf447268958527683dd`，与QA3摘要相同。

33条记录按完整现有字段（device/root/mount/fstype/source/superoptions）排序比较，与同次2219及历史2219逐项多重集完全相等，原排列不同。具体为已知Linux ext4 `/dev/sdd` 根及distro视图、rootfs `/init`、设备/内存/proc/sys/cgroup等伪文件系统和已审Linux overlay上下层；唯一9p是 `/usr/lib/wsl/drivers`、source=drivers、root=/、superoptions明确ro/aname=drivers。没有DrvFS、Windows驱动器/UNC或新增网络文件来源。

没有保存的mount-id、parent-id、per-mount/propagation字段不用于猜测这23字节差异成因，也未据此判断其管理员/IPC用途。它们未在已审核路径来源字段中引入新的源路径；所有原始字节仍由完整9745…SHA在实际采集的mountinfo上重新计算并严格匹配。为这一有限路径来源判定，无需为了重建23字节再触发UAC。

因此唯一改动是在原已审表增加：

`mnt:[4026532299] → 9745f6ec4272c1c03e31c2e4c8d1ed5f6b42dfa5690cedf447268958527683dd`

不是通用“最多9个即可”；仍必须每个ID都在封闭表内、raw hash精确相等、namespace集合与全部process证据精确对应，所有PID/start/flags、FD、mount前后、boot/PID1/kernel、native/HCS以及已有引用检查均不变。任意新ID、第10个ID或同ID不同hash仍拒。

新增3例验证实际使用的pair绑定函数：精确已观察pair允许、同ID改变字节所得digest拒绝、其它新ID借用9745…也拒绝。正例仅证明pair绑定；原始新namespace完整文本未落盘，因此不伪造其文本fixture。实际validator仍自行hash整个capture.mountinfo，最终现场成功必须由下一轮实际QA证明。原“未知第9个”诊断测试仍拒绝，只把期望错误从容量门改为更具体的未知ID门。

全部相关 **128/128通过**，日志 `ASTRA_EXACT_NINTH_NAMESPACE_TEST.log`。policy SHA `83c30ab48fe6768a13d8f8f3df91d694ad14aa21a0a4cea7d2db4bd52e128279`；wrapper SHA `984dbfdad743ad28cc106d60878ae4ea00cc5d68550fb0bc0256c0e246e87b64`。上层guard字节pin同步，collector未改，没有再次现场采集或生产动作。
