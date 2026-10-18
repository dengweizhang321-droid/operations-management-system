# 三项发布提速候选

本任务基线 `7ca85e40c2857ede3a55c4fffda1b3945aeb4f1f`。这是源码冻结前的候选时点报告，不作为实时状态。最终提交、候选兼容验证、main 原生 PREPARED 及控制升级材料由交付负责人在工作树外 `D:/codex-artifacts/release-three-optimizations-20261018/FINAL-STATE.json` 和对应原生回执记录，不为收尾状态反复修改源码文档。此时没有本轮新的上线授权，真实固定控制入口未采用，未执行生产切换或业务写入。

## 修改

- 八代有限结构证明在同一只读调用栈返回本次已验证的不可变父 catalogue；public load_plan 二元组与 verify_active 三元组保持，两个独立 Python gate 均重新读取原件。原 admission/install/finalize、结构/权限校验和历史 recipe/receipt 字节不改。
- Django 两个原 gate 分别记录 completed/failed 耗时；计时 best-effort 不改变原异常。绑定源由原受控完整 reader 一次生成 tree/inventory，复核成员变化；apply、CAS、fence、权限、进程及首尾完整采样保持。
- 手动与 hook 准备共用 v2 队列；DISPATCH 完整落盘前仅观察，之后冻结目标且 unknown 不重放。原 native rotation 仅 prepare-only 有界等待，部署默认锁语义保持。固定控制包独立封存，首次升级采用 committed-only shell、有限 legacy phase fence、安装态失败关闭、旧窗口收敛及单一 adopted 边界。

## 已取得证据及边界

证据根：`D:/codex-artifacts/release-three-optimizations-20261018/`。独立方案与审查在 PLAN / PLAN-ADDENDUM / PLAN-R4 / 对应 REVIEW 文件；后续增量拒绝反例保留原件。

- `schema-flow-tests.log`：完整合成 139→150 原政策、Journal、backup/restore JSON 验证及所有有限祖先函数，两条 Tmall 父分支、逐层 pointer/plan/receipt/source/tmp/duplicate、fresh public 与 installed 分支共 4 项通过。它证明合成历史验证，不声称真的做了备份或恢复。
- `postgres-gates-2/MEASUREMENTS.json`：同一冻结证据和真实私有 PostgreSQL 的旧/新 3 对、12 次 helper 调用全部成功。基线每对按 release→database、再 candidate release→database 的固定顺序，属于本机桌面暖缓存条件样本，不是冷热对照或稳定 P95。原始输出和退出状态保留。
- `postgres-negatives-5/REPORT.json`：真实缺/额外 migration、缺列/索引/实际 writer 权限、原生私有 pending graph、错误 role 共 7 项通过；`CLEANUP.json` 证明私有 55531 已停、data/password 已删除。只把生产固定身份检查替换成严格私有 data/port/db/owner 断言，真实 catalogue/权限/pending-plan 不 mock，未执行服务冷启动。
- 两个 helper 旧均值合计约 213.038 秒，新约 4.769 秒；这是 helper 范围，未测外层完整 PS/native 启动及线上整轮净收益。完整独立 gate 仍各验一次 139 父证明。
- `frontend-paired-measurement/MEASUREMENTS.json`：同一冻结 7ca 受控代码源，4,056 文件、66,439,714 字节；输入排除 docs 与账号工作簿。旧每次读取 8,112 次/132,879,428 字节，新 4,056 次/66,439,714 字节。3 对原始 elapsed 分列，未把该源夹具时间外推为正式发布分钟。
- PS5/PS7 真实 Invoke-DjangoMigrations 函数的 gate 顺序、各自成功/失败计时及原异常保留通过；在原 native migrate 边界前停止。这不是原生完整冷启动。

仍需本候选最终兼容验证器生成报告及独立复审；控制安装/进程分类的最新实际候选证据与 R5 闭合结论以其增量报告为准，不能用早期小型 shim 夹具代替。

## 测试隔离事件更正

早期 `control-upgrade-tests-1.log` 6 项功能通过，但错误地由公开 adoption helper 获取过真实 production rotation 命名管道，不能作为隔离通过证据。已知测试总窗口为 2026-10-18 05:53:48.894–05:54:32.349 UTC；逐次锁占用起止未单独记录，此 43.455 秒窗口不等于连续持锁时长。

该轮没有执行服务/发布/业务写入，目标 hook/config/control 写入均在私有 fixture；真实固定 control、hook、config 与任务 START-STATE 的摘要复核相同。具体事实、原日志 SHA、进程退出核验和更正见 `ISOLATION-INCIDENT.json`。后续全部安装测试使用仅允许 TEMP/artifact 同根 state/repository 的 `adoptControlUpgradeForTest`，派生 `TERUISI.Test.ControlRotation.<hash>`，不把生产常量改成任意 CLI 参数。不能用“全程未触生产”概括本任务。

后续私有父子进程分类夹具运行隐藏的同用户合成命令，不调用真正 PrepareApp/HardenAcl；其证据只能证明实际 OS 命令分类和退出收敛。

## 交付状态

最终组合版本以最终 main 原生 PREPARED 为准，不要求历史中间包全部完成；未 dispatch 旧目标可 superseded，已开始的不取消。源码合入、原生制品就绪、控制入口 adopted 和生产上线分别报告；新的“上线”之前不切换生产。
