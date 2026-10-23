# 剩余五 PID 管理员只读入口 V2 字节复审

2026-10-11。当前只读手工入口仅为 `E:/codex-artifacts/release-site-blockers-20261011/RUN_READONLY_RESIDUAL_AUDIT_V2.cmd`，不使用无 V2 后缀的旧入口。没有执行管理员 bootstrap、native probe 或 UAC。

| 材料 | 重算 SHA256 |
| --- | --- |
| ADMIN_RESIDUAL_PACKET_V2.json | `bb861c8fecab8e5652029c6c509daba48b767344a0c494ea39bd281a83c4b0e0` |
| ADMIN_RESIDUAL_BOOTSTRAP_V2.ps1 | `52b0f605b8907c989a97a639a6e0b59b2b1326b3cd1e5c40aa778b6249cb0e73` |
| RUN_READONLY_RESIDUAL_AUDIT_V2.cmd | `8583c6c834d42ef3ed68ba066d8b8c95b34e18d7dd320d911f4cc3dd4cf84789` |
| ADMIN_RESIDUAL_ENTRY_V2.json | `e2776cb0e325916e48b84306f0392e44731a224f27b58947507a7e36811c4b85` |
| Probe-ResidualProcessMetadataV2.ps1 | `6cef0abc35f4c99300d9b36393add66191557715d14d3d4a930dc0627d0f3ff9` |

`verify-residual-entry-v2.mjs` 独立读取实际文件核对全部映射：entry 中 base64/UTF16 解码后的源码与 bootstrap 逐字符相等；bootstrap 固定的 packetSHA 与实际包一致；包的 scriptSHA、原9e包和4e baseline 与实际原字节一致；输出仍固定 create-only E 目录。编码命令实际5540字符，整entry5831，均在既定长度约束内。

两个 helper 改为 `Get-ResidualBytesSha256` / `Assert-ResidualPhysicalPath`，旧 H/P 函数不存在。bootstrap 没有 RunAs/Start-Process/native 查询，要求同SID、既有管理员角色和严格Boolean false，再持只读句柄 hash/capture probe 源并执行捕获字节。probe 内原 baseline 字节硬绑定和五实例范围未改变。

我此前的 V1 静态检查漏掉了函数 H 被内置 alias 优先解析的问题。主 agent 的普通令牌边界测试已实际揭示 hash 前失败，V1 首稿不能标执行通过。本次只做字节与代码串联复核；普通令牌拒绝测试由主 agent 独立执行，管理员目标采集尚不属于本记录验证范围。

交叉核对证据：`E:/codex-artifacts/release-site-blockers-20261011/ASTRA_RESIDUAL_ENTRY_V2_CHAIN_CHECK.json`，状态 `byte-chain-verified-not-executed`。V1 原材料保留，旧9e/f0/guard/SourceV3/pkg21c均未修改；任何实际类型结果仍只用于诊断，不给予生产准入。
