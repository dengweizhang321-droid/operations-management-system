# 五 PID V2 冻结交接与 AGY3 回应

实现者 Astra，2026-10-11。没有执行 V2 目标采集或管理员入口；本记录不是独立签名或生产批准。

**当前手工入口仅指封包 V2**：`RUN_READONLY_RESIDUAL_AUDIT_V2.cmd`，entry SHA256 `8583c6c834d42ef3ed68ba066d8b8c95b34e18d7dd320d911f4cc3dd4cf84789`；packet `bb861c8fecab8e5652029c6c509daba48b767344a0c494ea39bd281a83c4b0e0`。详见 `ASTRA_RESIDUAL_ENTRY_V2_REVIEW.md`。此前生成器 V1 的静态复审未发现 H 与内置 h/Get-History alias 冲突；实际普通令牌边界测试在 hash 前失败，不能把下方历史静态意见当作 V1 执行通过。V1 包与入口保留但停用；探针源 6cef 未改变。

## 精确交接

- 新文件 `Probe-ResidualProcessMetadataV2.ps1` SHA256：`6cef0abc35f4c99300d9b36393add66191557715d14d3d4a930dc0627d0f3ff9`。
- 原 V1 `c6ee15…`、五目标普通权限拒绝、self64 证据保留未改。
- V2 增加仅 PID1700/6548 的同句柄 QueryFullProcessImageName；先核绑定 baseline birth 与实例稳定，路径必须精确为对应 `C:\Windows\System32\LsaIso.exe` / `NgcIso.exe`，拒绝 reparse 祖先。只对这两固定文件 hash/签名，FileShare.Read 句柄保持到签名及后核完成，拒绝写入/删除共享。
- 后核同句柄镜像、创建时间及 CIM 实例。路径、权限、签名、身份任一不符，保留失败且 status=unproven；成功也仅标 metadata-collected-not-admission。签名 Valid 不是行为无引用证明；平台验证可能遵循系统信任/吊销配置，不声称完全离线。
- PS5.1.26100.9168 对实际源做 AST parse 与原 C# Add-Type 编译，均通过；**nativeCalls=0**。证据 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_RESIDUAL_V2_COMPILE.json` SHA256 `bc70c8cbbfad226d5566a284ee8213ab4355480ab9a7897fb44b76b9cbcead62`。

## AGY3 原结果逐项回应

原始末条保留在 `E:/codex-artifacts/release-site-blockers-20261011/SITE_AGY3_STREAM.ndjson`。

| AGY3 判断 | 本轮事实与处理 |
| --- | --- |
| DllImport/ToString 缺双引号导致编译失败 | 实际 V1/V2 源均有字符串引号；V1 self 已成功实编译并查询，V2 本轮真实 PS5 编译也通过。否定此项对实际源码的判断。可能存在审查输入传输失真，但尚未定位，不能直接归因模型或传输。 |
| ReturnLength 可放宽到48/64 | 不采纳。官方结构和当前 self 实测64尚无支持本机接受48的必要证据；未知布局保持拒绝，不为兼容猜测扩大解析。 |
| CIM 容忍1ms偏差 | 不采纳。六个保存实例均按微秒匹配，差值0至8个100ns tick。当前没有需要1ms放宽的原始证据；native/CIM身份关联保留严格精度。 |
| Class7与失败不得豁免 | 接受。API成功布尔值、保护级别数值分开记录；API返回false与有效ProtectionLevel=0不能混淆。查询错误/null不是无保护或无引用。 |
| WSL与生产阻断 | 接受。guest诊断有明确覆盖边界，未改变9e/f0；不能据此豁免五对象或签生产。 |

## 历史 V1 生成器静态复审（入口已停用）

已读 `prepare-residual-admin-entry.mjs` SHA256 `708e9f8abc5fb11de87e62a0307da186f033d21df252c884991d20d3e21b128f`。它绑定原9e包和4e diagnostic，生成 create-only 新 packet/encoded bootstrap/cmd；bootstrap要求相同SID、既有管理员令牌、严格Boolean false，固定输出E目录、检查祖先reparse并拒覆盖，持只读句柄读取并校验脚本后执行捕获字节。没有 RunAs 或自动提权，没有调用 batch/lifecycle。

`.cmd` 是可见手工入口，执行前仍需用户核对批准的entry/packet精确SHA；不是任意可变路径都可信。固定父链检查属于时点检查，原安装目录/证据目录的权限与平台信任前提保留。这个复审针对生成器源；生成的最终字节还应由主 agent 重算绑定，未把尚未执行的管理员采集描述为成功。

源已冻结，后续只读采集、实际类型解释、独立复审与精确用户批准由主 agent 接续。本轮未改旧9e、f0、guard、SourceV3/pkg21c，未启动/停止服务或WSL。
