# R2：一次固定入口 --check 执行记录

2026-11-04，按 `D:/运营管理系统/codex-提示词-R2-跑check并停下.md` 执行。**本次检查通过；未执行正式发布，等待用户上线授权。**

## 执行与时间

执行命令原文（普通用户，Administrator=false；隐藏后台运行）：

```text
"C:\Program Files\nodejs\node.exe" "D:\codex-isolated\main-manual-release-20261016\control\tools\publish-latest-main.mjs" --config "D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json" --check
```

| 项目 | 实际结果 |
| --- | --- |
| 调用开始（上海时间） | 2026-11-04 02:01:34.9259985 +08:00 |
| 调用结束（上海时间） | 2026-11-04 02:03:51.4057560 +08:00 |
| 总耗时 | 136,478 ms，约 2 分 16.48 秒（包装器单调计时） |
| Node 子进程 | PID 46896 |
| 命令执行次数 | **1**，没有第二次检查 |
| 原命令退出码 | **0** |
| stderr | 空，0 字节 |

后台包装器仅记录命令、进程、时间、退出码和本次 stdout/stderr，不设置重试或发布分支。记录路径：`D:\codex-artifacts\readiness-selflock-r2-20261104-020134\RESULT.json`。

## 通过依据：两条均满足

不是仅按退出码判成功。stdout 于 UTC `2026-11-03T18:03:51.383Z` 出现完整原文：

```text
检查通过：有新main待发布；已有准备记录，正式发布时仍需原生复验；本次未打包、未部署。
```

紧随其后的 JSON 原文：

```json
{"status":"prepared","preparationStatus":"ready-for-native-verification","targetCommit":"ba78ceff052c543ff568f7c7eac0c42b983129e7","currentCommit":"e7aaf6c16939770d0941994873747fe301ef0b93","packet":"D:\\codex-isolated\\main-release-packages\\ba78ceff052c-9918ce3e-527bb5f5","source":"D:\\codex-isolated\\main-release-packages\\ba78ceff052c-9918ce3e-527bb5f5\\source","components":["worker","django"],"migrate":false,"publicationPerformed":false}
```

已程序核对：原文存在且 JSON 紧随其后；targetCommit 精确为指定 ba78ceff 全长提交，components 顺序和值均为 `["worker","django"]`，migrate=false，publicationPerformed=false，preparationStatus=`ready-for-native-verification`。执行次数=1、普通权限及退出码也一并核对。

stdout 另有原生资格结果 `mode=frozen-latest-main`、`maintenanceReadinessRoute=native-exit-observer`，随后打印“发布前检查通过：后台运行目录权限与部署清单符合进入维护的要求。”，但本次成功判据仍以上面两条完整输出为准。

## 日志与各阶段耗时

原生进度日志绝对路径：

```text
D:\codex-isolated\main-manual-release-20261016\logs\release-2026-11-03T18-01-39.775Z-0d49f544-ea1a-4251-8ef7-b419881ca0f6.log
```

下表全部时间为上海时间；日志原始时间为 UTC，换算加 8 小时。

| 阶段 | 起止 | 耗时与证据口径 |
| --- | --- | --- |
| 包装器开始至首条原生进度日志 | 02:01:34.926 → 02:01:39.775 | 约 4.85 秒，包含进程启动/固定 shim；不细分未测量部分 |
| 唯一编号步骤 1：检查最新 main（不部署） | 02:01:39.778 → 02:01:59.317 | 时间戳差 **19.539 秒**；原生文案打印“耗时 19 秒” |
| 步骤 1 完成文案之后的原生资格/准备状态/发布前检查 | 02:01:59.317 → 02:03:51.383 | **112.066 秒**，这是连续区间，不是某个 HTTP 请求耗时；各内部调用没有分别记录起止，不能再精确拆分 |
| 最终成功文案至子进程退出回执 | 02:03:51.383 → 02:03:51.406 | 约 0.023 秒 |

日志只有一个编号步骤。它在输出“完成”后继续沿用步骤 1 心跳，直到最终成功；没有把该显示现象当成额外执行一次，也没有将“19 秒”误报为整个检查耗时。此次未进入部署、维护或启动步骤。

原始证据保存在同一个外置目录：

```text
D:\codex-artifacts\readiness-selflock-r2-20261104-020134\
  run-once.ps1
  RUNNING.json
  RESULT.json
  stdout.log
  stderr.log
  runner.stdout.log
  runner.stderr.log
  VERIFIED-RESULT.json
```

`stdout.log` SHA-256：`d1ad2ad321e17a06f5eb39bbb57ce2923da943774735198b90a5127377a979da`。`VERIFIED-RESULT.json` 保存明确字段判据及下面的只读快照。

## 执行后只读状态

本次没有失败步骤，无需错误分类或恢复。为确认本次检查未变成发布，仅回读原任务指定的文件状态，没有再发 HTTP：

- 冻结包 `publish-ba78ceff052c/STARTED.json` **不存在**。
- Django `run/` 下 `system-maintenance.json`、`automation-drain.json`、`release-publication-lease.json` **均不存在**。
- `PUBLISHED-MAIN.json` 仍为 `e7aaf6c16939770d0941994873747fe301ef0b93 / deployed_and_ready`；执行前后文件 SHA-256 均为 `98a604d3a7d79f341de89ffaf658e3452d1749943f78e1c2e56a0345612c030c`，字节未变。

未改源码、配置、冻结制品、Pi 身份闸或运行状态文件；未重建/采用控制包、重启服务、执行数据库命令或预热探针。固定 --check 自身产生的日志和准备状态观察属于原入口行为，不等于本次重新打包。

本记录只追加在 R1 原任务目录，`REPORT.md` 保持原样。已核对本次 Markdown、JSON 原文及引用路径；不追加功能测试或其他业务验收。检查结果只是这一次观察成功，后续正式入口仍会执行自己的原生检查。

**未执行正式发布，等待用户上线授权。**
