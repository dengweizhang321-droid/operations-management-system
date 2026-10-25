# 已证 OS 实例的有限分类建议

2026-10-11；基于用户批准后产生的 bb861 管理员只读记录。这里只给新外置 guard / 新未批准批次的最小合同建议，不修改旧 f0/9e/guard/运行包，也不宣布生产通过。

## 独立事实核对

`ADMIN_RESIDUAL_METADATA_V2.json` 重算 SHA256 `0c0c0b4074403c8b7d1a53e9d4c4ffdbdb97802bed6827bcd13e70fb264cf4d6`；packet 为 `bb861c8fecab8e5652029c6c509daba48b767344a0c494ea39bd281a83c4b0e0`，实际探针源仍为 `6cef0abc35f4c99300d9b36393add66191557715d14d3d4a930dc0627d0f3ff9`。

可重复本地核对 `verify-residual-metadata-v2.mjs`，输出 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_RESIDUAL_V2_RECORD_CROSSCHECK.json`：五实例 native/CIM birth 与原 baseline 逐项一致；NT=0、Size/returned=64、PID正确、layout/identity稳定；两 image 的实际路径、hash、Valid Microsoft signer、签名后身份均匹配。没有再查询原生对象。

| 实例 | flags | PEB null | protection 数值 | 额外已保存证据 |
| --- | --- | --- | --- | --- |
| 236 | 129 (`secure+protected`) | true | 5 | Session0，固定 birth |
| 280 | 1 (`protected`) | true | 5 | Session0，固定 birth |
| 1700 | 128 (`secure`) | false | `fffffffe` | System32 LsaIso、hash `c6d056…`、Valid Microsoft signer |
| 6548 | 128 (`secure`) | false | `fffffffe` | System32 NgcIso、hash `a35439…`、同 signer |
| 53880 | 0 | true | `fffffffe` | Session0，固定 birth；此形状本身不证明 WSL 归属 |

保护级别仅按实测数值绑定；不外推“全部数值5对象安全”。两 IUM 实例 secure=true，但 protected=false / level NONE，不能错误要求它们同时为 PPL。现有记录没有 token SID，不把未采字段写成已验证。

## 第一部分：四个固定 OS 实例可以有限收口

建议新 guard 内只支持本次四个固定实例的小表：PID、native FILETIME、SessionId、完整 flags、PEB是否null、protection数值；前两个还要求无用户镜像的原观测形状，后两个要求系统镜像精确物理路径、已审文件 hash 和 Valid Microsoft 签名。名字只作一致性字段，不能独立选择例外。

新批次把这个表、原0c0c记录、原baseline以及采集实现的精确字节列入 command files/test evidence。执行边界应重新取本次实例元数据并核同句柄/创建时间；记录是预期值，不是给失败查询自动填值的缓存。权限不足、实例重启、任何原始查询/布局/路径/签名错误仍为 unknown。如果未来决定使用“历史类型证明+当前实例核对”，那是另一个明确的证据复用策略，不能在此次实现中暗中等同于新鲜查询。

分类顺序必须先保留原引用检测与失败，再只对预期的 OS 元数据缺失种类使用类型证明。任何已识别目标引用不能被覆盖；解释器、业务 Worker/Django、未知 vendor、新 PID/重启实例以及额外 unresolved path 继续走原拒绝规则。不要把普通命令查询失败统一视为系统组件。

这属于明确的受信 Windows 组件分类，而非证明这些对象物理上不可能有任何句柄。依据是本次原生内核类型+固定实例+系统文件来源；其信任边界必须在新规则及批准说明中公开，不能包装为数学上的全进程零引用。

## 第二部分：vmmemWSL 需要单独的有限补充

flags0/PEBnull/NONE 不是 WSL 特有类型。不要因为前四个闭合就把第五个沿用同一例外。最小补证范围可以固定为本机这一 host instance、当前这一个已运行发行版/VM epoch，而非扫描所有磁盘或建立全系统永久账本。

1. 用现有 host 计算系统/WSL 身份元数据关联此 host PID 与预期 VM/发行版；关联不支持就报告具体未知，不能只比较 `vmmemWSL` 名称。
2. guest 采集限定已有实例与固定脚本、`python3 -I -S -`，不启动服务或 shell profile；记录 guest boot/namespace 身份及前后进程成员/各实例 starttime。任何权限/未知 namespace/不支持 mount 形式保持阻断。host running 名称相同不等于 guest epoch 相同。
3. 对本次实际出现的路径和挂载形式实现小范围解析：cmd argv、cwd/exe/root/fd 路径、mount映射；将可映射的 Windows 路径交回原物理 alias/祖先规则。只支持明确的驱动器挂载，遇无法解释的 bind/escaped/跨namespace映射拒绝，避免引入任意脚本静态分析。禁止“字符串不包含目标=无引用”。
4. 前后快照与原维护所有权仍不能排除任意未来进程。此验收只是既定维护边界的当前引用检查，不承诺连续全系统排他；若 guest 无法给出所需的有限路径覆盖，明确保留该缺口，而不是停止/重启 WSL 或自动豁免。

现有 root guest 38进程/0refs/0errors 是有用诊断，但因 mount/alias/epoch/瞬时fd边界，不能原样当新 guard 的永久 pass receipt。复用原 predicate、原 source/package字节和现有 lifecycle 即可；新增只在外置 guard 的受限采集/分类里，不需要第11个运行模块或重写生命周期。

## 必须拒绝的最小反例

- 同名 PID 换 birth；正确 birth 但 NT/size/PID/layout错误；缺字段被当0/false。
- 伪造或回放旧管理员 JSON，重算普通自带digest但不匹配新批次已绑定记录/工具字节；live查询失败却用旧值补齐。
- IUM secure位不成立；任意 protected/PPL 进程被套用四实例规则；系统目录外同名exe、junction路径、签名有效但文件hash不同、签名后实例改变。
- PowerShell/node/python 命令不可读被当OS豁免；原判断已发现目标引用后又被白名单覆盖。
- vmmem同名/相同flags但不同host/guest epoch；guest权限错误、未知挂载、别名、路径解析失败；同名running清单覆盖停止/重启；无errors但漏掉namespace映射。

应以这些真实边界做少量正负测试并交独立复审。新 guard 改变可执行分类合同，必须生成新未批准批次；原f0批准/旧诊断都不能自动授权执行。
