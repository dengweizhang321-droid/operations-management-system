# prepare-health-probe-capture 静态独立复核

结论：prepare-only 捕获调用器通过静态复核，未运行，无剩余阻断。source SHA 5e698ea8d89145bc50e94a4d6d03220eb9194ffb5b72130c98a152852e1181be；候选机器报告 SHA 0e420c9dddbe82841f2a3832b80e232e2904095dcb98ee5797f678a18b4e7b0e。

固定 source/Node/原 AB cwd/唯一11日 artifact 与 audit；spawn前核报告对应15文件当前字节；仅启动 prepare.mjs，不启动 caller/API/collector/Status/锁或生命周期。目标需不存在，目录/输入拒 reparse、单链接和读取变动；日志 wx/fsync，真实 PID/exit/时间/SHA 由执行后记录。

本结论不等于 prepare 成功或生产批准。纯 prepare 的真实 exit0 和全物理封存须随后独立复核；完整旧4771/new闭包的导入前核验由已审 sealer 执行。复核者未调用该 driver、任何生产工具或新探测。
