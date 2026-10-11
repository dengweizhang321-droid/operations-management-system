# 受限源码 V2：修正零上下文移植的语句落点

主任务对真实39ce不可变候选（manifest131cde5c）运行197项，196通过、1失败。该失败不是fixture问题：开发源码90321中位于restore块内的backupId断言，被旧7d611零上下文补丁应用到受限677586源码时插到了块外return前，引用了作用域外backup。语法检查和原始哈希一致只能说明“保留了该错误文件”，不能证明语义正确。此前Astra移植验证未检查函数落点，是验证遗漏。

旧sourceV1、39ce包、原197日志和全部handoff保持不变。新V2只把该断言移到 `if (op.kind === 'restore')` 块内，紧随 `const backup = outputsFor(...)`。正确开发三核心未修改；原impact197f与admissione877也不改。

完整复核不只检查这一行：impact23函数、admission16函数、batch24函数，共63函数；全部模块全文和顶层AST节点与开发意图逐项相等。唯一允许扣除的旧差异明确记录完整文本：batch的safeReadinessFailure named import，以及原readonly retry解析／断言块相对main新增诊断catch的差异。没有泛化忽略上下文或未知代码。另以AST证明新backupId断言唯一、直接位于restore block第二句，前句定义backup。

新文件 `E:/codex-artifacts/release-first-adoption-targeted-20261011/targeted-limited-v2/tools/release-batch.mjs` SHA `e0d2e1d38e0416fca6bb4a61eb42ccf07baabb363493796dd54f3b8e50bf2ccc`。主任务将从冻结新文件直接复制到新全量来源，不再盲用U0。另提供带12行上下文的V1修正补丁和相对旧58cc来源的完整受限补丁，均在独立新目录正常git apply后逐原始SHA比对，不使用--unidiff-zero。

真实新V2模块的原恢复成功用例＋8项错误回执负例9/9通过；断言不改，底层native仍为明确隔离接缝，未实际PG恢复或生产执行。第一次私有harness未复制retention测试源依赖导致ENOENT，日志保留；补入候选source-snapshot原文件后通过。该测试准备错误与真实197中的移植缺陷分开记录。

最终 `ASTRA_TARGETED_LIMITED_V2_FINAL_HANDOFF.json` SHA `fa282a6b477d39e5b3fd5d9ec425964ed71a75a0c22069d029d73b65398f1b11`；完整body proof SHA `a57cbf432b3b0deb36951e608482f794453552b05a13112f8deee14a893e0f42`。V1修正补丁SHA `a5ed4f0517d7fe50b0777c164b3a0753d0f5e319dea84ace1479b75eaef83665`；完整受限补丁SHA `463fd5597dbd35773e35b894a30bf5acd76b2c4cd8e70220372a222c27d04d3d`。新全量候选仍须原准备／完整测试／独立复核／重新封存；旧39ce不能生产采用。
