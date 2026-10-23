# OpenCode Go 真实连接与生产采用

2026-10-13（Asia/Shanghai）。本轮真实模型连接已通过，同一应用版本恢复为原普通用户运行方式，服务与监控复验完成。

## 真实模型测试

使用原公开模型测试 API、原同源保护、同一已保存的 OpenCode Go / deepseek-v4.1-flash 配置，在上海 19:26:51 发起一次请求，19:26:57 完成：HTTP 200、ok=true、文本连接成功，耗时 5888ms。回读配置卡 lastTestResult 为“文本连接成功”，lastTestedAt 与本次完成时间对应。模型版本仍为 1、maxTokens 仍为 65536，原密钥和其他参数未更换，无需重新配对。

原上海 18:35 测试 HTTP 400、供应商 inference_failed 的失败证据保留。补齐会话头后连接通过，说明当前保存配置可正常调用；没有通过同时刻删头对照实验断定旧失败只有一个原因，也不将短连接测试当成长输出/多轮经营工具的完整生产验收。

## 已采用版本与维护

源码 a7423963 已推 main；正式候选 c1df9357 以当前生产来源为底，仅组合四文件增量。Django manifest 08695d0d67c45970a52032421650e859f3926d739aa2993ce896fdd7dc803b92 已采用，appFingerprint cda4b44aa850ed453cc5492f3e5b9a7070bb09afbbbb4eb66259092086a1ff59。Worker 仍为 20261013T091815Z-878966319497c4bd / b2d57b6d6e990a1fc2cb6909ce778d887e8b019c491bdd9002f3c416f36d982e，未重新打包或激活新 Worker。

原维护 db9caa954a6b412f83074d6b9a40bce0 的续接于上海 19:25:46 完成；原 StartWorker 确认 complete readiness、新 Django manifest、同一 Worker 和维护解除。PostgreSQL 保持，未新增 schema migration、数据恢复或新备份。已有恢复点按原 Verify 校验通过。

首次管理员环境缺少 PowerShell 7 的失败及部分 Worker 停止效果完整保留；独立核查后，仅为本次管理员进程补齐已安装的 PowerShell 路径，以同一维护 ID 和候选续接，没有修改系统 PATH 或跳过原生命周期校验。详见 REPORT.md 及原始日志。

## 运行权限收尾

初次恢复为管理员进程时，普通用户监控读不到 supervisor 的可执行文件/命令行，报告 ownership_error；高权限 supervisor 自身 healthy、12 组件及四个 HTTP 探针均正常。直接普通上下文原 Django Status 也报告 reader/writer ownership_error。此为本轮进程权限选择造成的运行方式不匹配，不能把监控错误伪报成全绿。

为恢复原登录启动和普通用户监控方式，本轮用原控制器保留 PostgreSQL、进入新的独立维护 89ced79fd8ce4a04b4802c4f6594c78a，保持同一已安装应用字节，随后从普通用户上下文执行原 Start 与 supervisor Run。没有更改监控任务 RunLevel、调度、默认模型、API 密钥或产品代码，也不重新调用已经通过的供应商测试。

原普通上下文 Start 于 19:56:43 完成，readiness=complete；原 Django Status 回读 PostgreSQL/Django reader/writer 均 running，读写 readiness 均 ready，普通上下文能读取进程可执行文件和命令行。初次普通 supervisor 启动因继承 PS7 模块路径而在 Get-Acl 加载时失败、未建立 PID 回执；原失败保留，之后仅为 native PS5 子进程安装固定系统 Modules 环境，再按原 Run 启动，未改全局模块路径。后续普通上下文对 supervisor PID 的可执行文件、命令行和存在性均验证相符。

20:06:57 完成的自然监控 healthy=true、Worker exact_release、backend Ready、supervisor running/healthy，12 组件全部就绪，四个 HTTP 探针全部 200。原监控失败/过期观察仍保留，不回填为成功。维护与 automation-drain 均不存在，部署 manifest 仍为上述同一 08695d0d，没有为了运行方式恢复重复部署代码。

最终回读模型卡仍为“文本连接成功”、lastTestedAt 仍对应 19:26:57 的那一次请求。后续回读配置版本为 2，不能据此把版本 1 的真实测试伪报为版本 2 的新测试；本轮没有提交保存参数请求，也没有覆盖其他配置变化。

维护期间原定时 RunWeeklyReport 在 19:20:30 留有“另一个 Django 本机服务操作仍在运行”的失败日志；本轮没有手动重放该非目标业务任务，不把其失败改成成功。

## 证据

全部脱敏测试、范围计划、准备、原操作进程/完成记录、首次失败与两类恢复记录保存在 D:/codex-artifacts/opencode-go-session-20261013。LIVE_PROVIDER_TEST.json 为真实连接回执；resume-v2/DEPLOY_RESULT.json 为本次代码采用完成；restore-standard-context 为进程运行上下文恢复，不能将其中 stop-only 的 DEPLOY_RESULT.json 当成完整启动完成。

正式候选来源仍被当前部署清单引用，继续保留，不能作为普通已合并开发树随意清理。
