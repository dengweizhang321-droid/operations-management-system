# 证据索引

| 证据 | 用途 |
| --- | --- |
| [verification.json](evidence/verification.json) | 验证时间、命令、源码摘要、退出码、耗时、原始日志摘要 |
| [verify.mjs](evidence/verify.mjs) | 只运行隔离定向测试、构建及只读边界的重现入口 |
| [targeted.stdout.log](evidence/targeted.stdout.log) | PS5/PS7 四分项真实超时、异步完成、原失败与回执保全 |
| [regression.stdout.log](evidence/regression.stdout.log) | 原钉钉授权与总控回归（20 项） |
| [boundary.stdout.log](evidence/boundary.stdout.log) | Django 生产边界检查 |
| [parse-ps5.stdout.log](evidence/parse-ps5.stdout.log) / [parse-ps7.stdout.log](evidence/parse-ps7.stdout.log) | 两代宿主语法检查 |
| [build.stdout.log](evidence/build.stdout.log) / [build.stderr.log](evidence/build.stderr.log) | 私有依赖下构建及原警告 |
| [diff-check.stdout.log](evidence/diff-check.stdout.log) | 差异格式检查；空输出且退出 0 为通过 |
| [fixture-correction.stdout.log](evidence/fixture-correction.stdout.log) | 保留前次 PS5 回执断言的夹具失败，不改写为成功；原因与修正见 REPORT |
| [prior-verification.json](evidence/prior-verification.json) / [assertion-correction.stdout.log](evidence/assertion-correction.stdout.log) | 原组合回归退出 1：并发协调三个用例通过，旧默认 deadline 静态断言失败；更新断言后的独立回归另见当前 verification.json |
| [timing-replay.json](evidence/timing-replay.json) | 原文件摘要、四分项计时与默认预算的离线代入；保留接收器耗时被截断的不确定性 |
| [final-boundary.json](evidence/final-boundary.json) | 13 个禁止文件逐项 blob 对照原基线相同，任务文档相对链接通过 |

每项检查同时保留同名 `.stderr.log`；完整性摘要见 verification.json。本目录 `.gitattributes` 将原生日志设为不转换文本、不生成文本差异，以保留 CRLF、尾空格与原始摘要；不修改原始输出来满足格式检查。空 stderr 不表示执行成功，须结合原退出码。没有采集生产新状态、外发消息或调用生产生命周期。

独立审查者额外私有反例位于 `C:\Users\86137\AppData\Local\Temp\teruisi-review-drain-2fdd498070624f4b90a29526d55c7469`；该临时夹具作为审查辅助，正式结论另由仓库内排空回归用例覆盖，不依赖临时目录长期存在。
