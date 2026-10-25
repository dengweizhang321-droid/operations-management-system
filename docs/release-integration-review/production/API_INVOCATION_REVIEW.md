# 已批准公开 API 的实际调用器只读审查

2026-10-10，Asia/Shanghai。审查者 `/root/preparation_review`。**实际薄调用器通过本次静态/接口边界审查，无已知调用阻断。** 未运行该调用器、公开生产API、UI、collector、4534项完整哈希循环或重型测试；仅只读代码/文件/现有记录、观察原TypeScript解析路径，并新增本审查材料。

被审 [execute-reviewed-api.mjs](/E:/codex-artifacts/release-integration-review-20261010/AB-ui-supplement-20261010-0820-final/production/execute-reviewed-api.mjs) SHA为 `545e99899203f77371b532161ce0055272db4b7fc5acf950e131b2e8886fecc7`。详情见 [机器审查记录](API_INVOCATION_REVIEW.json)。

## 已批准接口及授权边界

`executeSupplement`已经包含在用户批准的controller `97e66370…`内，且已通过相应独立API/旧ABI夹具审查。当前supplement范围 `0bcad05b…`没有限定必须使用CLI包装。新人类记录精确绑定上海16:41:31（UTC08:41:31）及item `01a124f9-78a0-75b3-bd46-c484e6734b12`，允许本补充及原AB后11步骤。选择该既有公开接口不修改22文件、manifest、controller、source或candidate，不创造新的许可。

原CLI失败来自包装自建digest要求所有文件单链接；原AB已采用safeFileDigest对精确System32 PowerShell主机有既有WRP硬链接例外。该实际主机nlink=2，实际SHA `7600ffe1…`与原pin一致。薄调用器仍对该文件完整计算原摘要，并未跳过它；新22文件保持单链接要求。这里使用原已批准政策，不新增其他路径例外。

## 实际代码核对

- 第16–21行检查原authority及manifest原字节SHA、固定输出根、固定真人时间/item；公开函数继续检查明确批准、scope SHA、failed时间和原状态。
- 第24–27行先核controller/impact及原pin中的TypeScript package/入口，再import impact；固定package name、main精确路径及无exports。只读Node解析观察确认实际impact位置的TypeScript解析到已pin的采用包入口。
- 第31–38行要求新22普通单链接，完整验证4914声明项／4534唯一pin后才导入其余旧runtime，并调用原verifyBatch。实际runtime来自原采用engine/impact/worker/rotation，没有mock/no-op。
- 第39–41行与原controller main一致：每次collector调用重验新文件及原collector全部pin，保持原exe/argv/cwd，核原batch SHA及5000ms新鲜度。原executeBatch继续负责binding、动态准入、原锁/WAL和跳过passed；原runApprovedOperation及剩余动作不变。
- 第42行只写create-only描述性preflight；它不是新批准或UI完成证明。第43行调用同一批准export。新UI原有意图/started/result和失败关闭仍由未改的controller与原engine负责。

首版 `5b0548b6…`曾在import impact前仅pin自身模块，漏掉其直接TypeScript导入的提前校验；作者已经补齐，未修改封存22文件。此发现及闭合保留在机器记录。

采样时caller preflight和六个补充/新UI执行输出仍不存在。此通过不代表已实际执行哈希循环或生产验收；执行时必须使用上述准确调用器SHA，并让其全部真实校验通过。若更换runtime/collector、放宽断言或例外、换候选或范围，本结论不适用，不能借公开API绕开人类授权。旧failed/unknown不能因本审查或诊断通过被改称成功。
