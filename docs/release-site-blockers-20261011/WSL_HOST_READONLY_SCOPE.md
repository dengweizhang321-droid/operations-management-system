# 剩余 WSL 宿主关联，只读范围

用户已批准并真实执行bb861包；原5实例native query均0/64，实例稳定且两IUM系统镜像已核。该包没有HCS枚举或宿主parent vmwp取证，授权不能自动扩容到这些接口。

新的封存包`E:/codex-artifacts/release-site-blockers-20261011/WSL_HOST_READONLY_PACKET_V2.json` SHA256 **`6af6ec639f51242f3afc8290669fe83f9ea8a7cfab77794ceccead28445f67ad`**。唯一手工入口`RUN_READONLY_WSL_HOST_AUDIT_V2.cmd` SHA256 `a288e0561b3352d30fa4101c3a261aee9d5bbc80821879aabeeb9359a9770394`；实际源码4bce23bf…已封存。

仅两次现有HCS计算系统枚举，以及已绑定vmmem53880/parent7788的0x1000进程元数据。只对同实例实际System32 vmwp.exe读取预期hash/微软签名；命令原文只在内存，输出GUID候选、参数类别/hash、状态及出生时间。未知HCS字段和错误保留unproven；模糊GUID候选不是准入通过，须实际结果后钉明确形态。系统签名验证可能遵循平台信任/吊销设置，不称完全离线。

没有VM创建/打开/启停/修改，没有服务/WSL启停、维护、批次、备份恢复、调度或业务调用；不启Debug，不远程内存读写，不注入或杀进程。固定E create-only审计，Windows正常编译/系统日志不包装为零OS副作用。bootstrap要求同SID和既有管理员令牌，不RunAs；源码持只读句柄捕获/hash执行，父链reparse检查为时点检查。

实际封存字节链独立重算一致；普通令牌实测在角色门拒绝，未调用probe、未生成管理员结果。原型0c7包停用、未管理员执行，旧源码与原artifact保留；更新仅补参数形态和把已采末实例证据移到可选字段语义断言前，拒绝条件保留。

如用户同意，请在原管理员PowerShell按任意键返回提示符后执行：

```powershell
& 'E:\codex-artifacts\release-site-blockers-20261011\RUN_READONLY_WSL_HOST_AUDIT_V2.cmd'
```

结果固定`WSL_HOST_ASSOCIATION_ADMIN_V1.json`（文件名V1与包V2故意不同，不是旧结果）；如已存在或报错保留，不能覆盖/重放求绿。此只读操作不批准上线。新生产guard已保留HCS缺口，实际结果后还须接入、必要回归、独立复审及另封新19操作范围，旧f0不修改。
