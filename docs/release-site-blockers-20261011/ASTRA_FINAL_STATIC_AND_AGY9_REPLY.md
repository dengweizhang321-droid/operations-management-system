# 最终静态复审与 AGY9 事实回应

2026-10-11；只读复审，不改源、候选、封包或生产状态。

已读 `SITE_AGY9_STREAM.ndjson` 的真实非空结果，以及主 agent 发出的 `SITE_AGY10_PROMPT.txt` 五项纠正。五项纠正均成立：

1. QA4 是实际管理员 live 元数据采集。其原记录SHA `08ee56022567c737db5a270987701de5a9eeddf4618e17cad18f89c206c0f9c3`、runId `161ece1e…`，不能称离线fixture；它仍是当时截点，不代替批准后动作前再采。
2. namespace合同是已审集合的非空子集，并精确覆盖本次process及可核的namespace FD；不要求每次强制9个。每个present namespace完整raw mount SHA继续匹配。
3. `assertSystemWslUnchanged`只验证固定wsl.exe的byte/stat身份，不覆盖native五实例；native与vmwp/HCS有各自的birth/镜像/命令前后检查。没有全系统连续租约。
4. 用户新范围取消发布后的Backup/Restore，不等于发布后数据库绝无写入。原启动/EnsureReady/迁移检查/权限流程及正常业务行为保持各自原合同。新批次WAL正常追加，只有guard读核期间的previous要求不变；旧f0与旧记录不改。
5. 拒绝“彻底排除”“充分且安全闭环”等绝对表述。有限接口在当前精确范围没有识别到引用，不是任意句柄、瞬态或未来行为的完备证明。

AGY9对单个2299/9745精确pair的有限支持判断，与已审33条路径来源及整串rawSHA约束一致；无需从未保存字段推断其用途。但模型的认可不是执行授权，也不替代真实验证。未发现超出上述纠正的新增具体源码缺陷；没有据泛化可能性增加新框架或新放行条件。

## 新spec generator 静态复审

读取版本 `prepare-live-adoption-spec.mjs` SHA `0dca713344b4b3f5e5586d8d490b8d1ea4dc10ed0269fe18fa66534fe4c52992` 与FINAL报告 `88e039d7dfefa2e0ba93c6e4898f0de3519b7f57bdc55d7074ff06baf3d64dbb`。前次指出的两项已修：三个新增必需JSON都有固定SHA并进入guard op.files；最终11文件闭包同时与final.guardFiles、HANDOFF_V6精确绑定，不能把QA后新字节只重算hash就当已验证。

原Node/PowerShell、candidate tools/TypeScript、previous保全记录pins保留；wsl.exe不加入generic单链接文件列表，使用单独已核系统工具身份合同。测试文件/collector摘要和batch摘要重新计算；19操作、1Backup+1Restore、source/artifact身份保持；最终spec仍productionApproved=false，执行命令要求另给明确批准时间戳。对当前精确输入没有发现额外封存阻断。

本次没有运行generator或fresh qualification；这些由主 agent 执行并保留实际结果。原三次失败不能被最终通过覆盖，生产仍须最终精确批准。
