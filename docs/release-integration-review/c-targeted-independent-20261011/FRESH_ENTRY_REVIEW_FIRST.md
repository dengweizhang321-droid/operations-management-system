# fresh 外置入口首轮独立审查

当前入口 **b7c1edb6b05da5dac5791e1474ca0e01047d216e8e9763c2aa80d05012ed72c2 未通过**，前后SHA一致，原字节保存在[fresh-entry-reviewed-first.mjs.txt](fresh-entry-reviewed-first.mjs.txt)。新spec未封，未签生产候选。

| 阻断 | 实际触发与最小修法 |
| --- | --- |
| NRT-ENTRY01 P1 | 8–11行先import四候选模块，随后才核spec／manifest／collector闭包。漂移模块的top-level执行已发生，后置验证不能撤销。须builtin-only bootstrap先核固定manifest/keyFiles、完整可执行闭包及self/spec绑定，再import；保留之后所有原验证器。 |
| NRT-ENTRY02 P2 | collector返回current后46行assertFresh拒绝时丢返回stages／attempts；beforeOperation核输入／fresh失败也须保全lastAdmission固定事实。应安全attach已知metadata再拒绝，不强写foreign WAL、不伪passed或重建raw输出。 |

[两个虚拟I/O反例](fresh-entry-independent-first.test.mjs)均证实接缝，[原日志](FRESH_ENTRY_INDEPENDENT_FIRST.log)：0/2、109.9295ms。第一个在无任何验证前执行4次虚拟import；第二个实际stale断言抛错后known stages为undefined。验证器仅为隔离这两点的受控替身，不能冒称完整协议或真实collector已执行。

方向上的保留项已核：原verifyBatch／validateNoDataCollector、固定21c manifest／plan／journalRoot、tests.evidence精确self mode pin；完整collector pins在采样前；实际public executeBatch＋无session collectBatchAdmission传phase／step，原onStatusAttempt／writeOnce与runApprovedOperation保持。直接collector失败可以保留原stages／attempts，解决子CLI回传差异的一部分；最后输入核验后再≤5秒拒绝过期。NotReady非retry、unknown不重放及实际权限／排空／身份仍由原模块执行。

修后应重新冻结新字节／tests及spec闭包，不能借旧CLI支持或旧b7c签名。未production execute／qualify、未真实collector／模块导入、未改实现／生产文件，未全树扫描。完整记录见[FRESH_ENTRY_REVIEW_FIRST.json](FRESH_ENTRY_REVIEW_FIRST.json)。
