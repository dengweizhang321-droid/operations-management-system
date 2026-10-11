# fresh v2 固定字节独立复审

**当前v2入口源码及隔离模型通过，无新增阻断。** 仅签 `fresh-adoption-entry-v2.mjs` SHA `69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99`，前后相同；[原字节](fresh-entry-reviewed-v2.mjs.txt)保全，不签尚未封存的新spec或真实闭包qualification。

实际固定root表达式独立求值确认：绝对D路径、零控制字符、与原固定root相等，[原记录](FRESH_ENTRY_V2_LITERAL.log)保留。旧8bf两TAB反例与0/4没有覆写。

[四项私有模型](fresh-entry-independent-v2.test.mjs)4/4、133.4159ms，[最终原日志](FRESH_ENTRY_INDEPENDENT_V2_FINAL.log) SHA `f8961226cac4cdee5c41cb9cbe751fab92b8e4b98b839e2ae46a81cbe172c681`：闭包模型先验证后3次虚拟import、漂移时零import；正常stale保current stages／attempts并落证；writeOnce EACCES仍抛primary STALE、保current及保存失败码；beforeOperation拒绝发生在原已持久admission之后，采样WAL仍在。原verifyBatch／collector验证、自身mode pin、无session完整collector、phase／step／onAttempt／原操作器、采样后新鲜度门禁静态保持。

两次前置失败是我的模型问题，原日志均保留：135.3783ms跨VM prototype；250.788ms Windows separator下虚拟TS package未返回raw。只修同数据返回域和fixture路径匹配，未改任何作者断言、正规root或实现；不把旧轮次数相加。模型替代builtinTree／hash／pins和原API，不证明真实31k树、完整verifyBatch或实际collector已执行。

新spec仍须精确绑定v2文件名／SHA／mode、闭包／tests／19步及批准范围；真实树和fresh collector准备证据另核。旧214/215仍是失败，不借此证明会话优化／C分钟收益。没有生产execute／qualify／collector、真树扫描、product import或修改实现。详见[机器报告](FRESH_ENTRY_V2_REVIEW.json)。
