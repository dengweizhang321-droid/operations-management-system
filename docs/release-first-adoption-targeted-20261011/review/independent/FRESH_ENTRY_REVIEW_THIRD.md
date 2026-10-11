# 8bf 固定入口复审：真实 root literal 阻断

**精确8bf稿不能签通过。** 前后SHA `8bf175c321401523955c4273a9ab5d29fd4c2ee81f0cdf32130a60886bf09f35`相同，原字节保存在[fresh-entry-reviewed-third.mjs.txt](fresh-entry-reviewed-third.mjs.txt)。

NRT-ENTRY03：第10行普通JavaScript字串的单反斜杠使两处`\t`求值为TAB。对实际literal的[纯求值检查](fresh-entry-root-literal-check.mjs)确认2个控制字符、非绝对Windows路径、与原固定root不等，[原记录](FRESH_ENTRY_ROOT_LITERAL.log)保留。因此正规spec.journalRoot会在bootstrap先被拒绝。修法是用正斜杠固定路径再path.resolve、正确双反斜杠或String.raw；保留原断言，不能把夹具／spec改成坏路径找绿。

[四项私有模型](fresh-entry-independent-third.test.mjs)0/4、123.5911ms，[原日志](FRESH_ENTRY_INDEPENDENT_THIRD.log)全部先停在这个真实root错配，**未到达三处原边界，不能写为其失败或通过**。虚拟builtinTree／pins不代表实际31k树已核。作者10/10也不能替代该原fixed-root检查。

静态看，前置闭包检查已在import之前；普通stale保存当前metadata，writeOnce异常也保留原error＋evidenceSaveFailure。新root修正后须按新SHA跑原小suite确认。beforeOperation仍在原executeBatch已持久admission之后，不把其附属throw诊断不足虚报为采样WAL全丢或新增P1。

没有production execute／qualify／collector、真实树扫描／product import或修改作者实现。完整精确结论见[FRESH_ENTRY_REVIEW_THIRD.json](FRESH_ENTRY_REVIEW_THIRD.json)。
