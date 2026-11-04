# 同类摘要与资格钉子盘点

范围：全部8份config/main-schema-releases recipe、对应candidate/gate继承集合及当前代码中的相关显式controller pins。只读源码审计，不扫描或改写生产/封存目录。

| recipe | 代际 | CODE_FILES数 | recipe记录codeSha256 | 当前真实gate实算 | 本轮处置 |
| --- | --- | --- | --- | --- | --- |
| `ai-0084.json` | 149→150 | 54 | `74c6e6b8686dd69c011491ccc9b66a438b2f2c823c53d6186e869fdfc2d92d6b` | `28d7a475d1f2ce5cccef8d798b51735b385464905ef17126262c259b166efea1` | 当前字节不匹配；旧代际材料未重新签发 |
| `ai-0085.json` | 150→151 | 64 | `b95550b3aadf2c5265d8edcacb7d11250d76247e4f86a57d0bd891832722bf43` | `090afdd0feb1e79ed11d8a58774c945c63c30ebeaba197d37467f99b4ba6b041` | 当前字节不匹配；旧代际材料未重新签发 |
| `ai-0086.json` | 151→152 | 75 | `1c20bca695c568a9c2deb9efd3cb595c24b7e75ea0575fead74a79f30472219c` | `39c77fbba4c3b68700dc5fed85bd3b41fdbd9402660ef46954bb2823a391ebf8` | 当前字节不匹配；旧代际材料未重新签发 |
| `ai-0087.json` | 152→153 | 80 | `76580ec4763599b76ad04fbc2c476771031be892d6bda03892057c446c122b59` | `e5de94d4c9e25154b1718b777ab6b7c20b26de484eee2c3c4838c9f89c96d753` | 当前字节不匹配；旧代际材料未重新签发 |
| `inventory-0016.json` | 147→148 | 26 | `fee0b4cbe2f128f80672999978ae783935128ddaf73070b1a12878f1693b633b` | `ec12641037122d5aa5ef57cf2f791402f791f1597b5aeab632dd6d81a829ae9e` | 当前字节不匹配；旧代际材料未重新签发 |
| `inventory-0017-from148.json` | 148→149 | 32 | `ce713799e3923b5597d58aa9d277d3248dc53cea9f651b813a474c54cdcba9fe` | `06d8fd94105eaed7f0ebcf72e96a3973d843730b21bc9bfe9c9d4a9083e3de9a` | 当前字节不匹配；旧代际材料未重新签发 |
| `inventory-0017.json` | 147→149 | 32 | `ce713799e3923b5597d58aa9d277d3248dc53cea9f651b813a474c54cdcba9fe` | `06d8fd94105eaed7f0ebcf72e96a3973d843730b21bc9bfe9c9d4a9083e3de9a` | 当前字节不匹配；旧代际材料未重新签发 |
| `sales-0012.json` | 153→154 | 86 | `e411415d0a76aae5ba8648e3db2b306c82dcd786262eb8171eff6e593875b1a1` | `e411415d0a76aae5ba8648e3db2b306c82dcd786262eb8171eff6e593875b1a1` | 已重验更新，匹配 |

## PiBusiness与PiNative的明确结论

两者都受影响，分别由pi_business_candidate.py、pi_native_candidate.py调用各自真实gate.code_digest，并在同名mandatory检查处拒绝不匹配：

- PiBusiness：75文件，记录1c20bca6…，当前39c77fbb…。其旧syntaxEvidence包含78文件，覆盖当前75成员，其中21项当前字节不同；该语法材料的75项投影摘要a87fdaf2…并不等于recipe的1c20bca6…，所以不能把它说成原codeSha的完整可重构前像。引用文件本身的raw SHA仍正确。
- PiNative：80文件，记录76580ec4…，当前e5de94d4…。其旧proof内80项sourceFiles可重构原76580ec4；当前12项已变：tools/postgres_no_key_backup.py、tools/integration_release_gate.py、tools/bi-app-adopt.ps1、tools/django-local-service.ps1、tools/django-postgres-maintenance.ps1、tools/main-schema-release.mjs、tools/publish-prepared-main.mjs、tools/django-ai.ps1、tools/manual-maintenance-continuation.mjs，以及backend/teruisi_backend/health.py、backend/ai_assistant/pi_service.py、backend/ai_assistant/pi_gateway.py。

不能把这些差异都归因今天：除当前Sales对d958只有一项变化外，旧Pi材料积累了更早的代码演进。没有修改publish-prepared-main.mjs去迎合旧摘要。

## 为什么不把其他7份一律改成当前值

全部8份recipe的validation原字节绑定、proof与recipe之间的codeSha声明、stepFiles都能对上。各历史migrationSha也与当前迁移源按其目标代际的投影相符；投影会按每个step最早登记的目标代际排除后续增量，复合recipe不会误删更早步骤。这不代表这些recipe能在当前154完整源树执行。

另外7份目标为148–153，当前源树已包含154迁移。只更新其codeSha、把完整154 migrationSha填进旧152/153声明，会编造不成立的过渡证明。它们继续受原门禁拒绝，若以后需要选用，必须按实际目标源树与对应父代独立重验；本轮没有重新签发它们。当前153→154计划选择Sales recipe，不会选择这些旧recipe。

CI当前明确强制Sales154 recipe，checker提供重复--recipe参数用于其它明确选择；不宣称8份当前都通过，也不通过忽略不匹配让旧recipe执行。JSON逐项证据见RELATED-RECIPE-PINS.json。

## 其余相关pins

| 位置/类别 | 核查与处置 |
| --- | --- |
| manual-maintenance-continuation.mjs 当前controller资格 | Django98028c、Worker1b8c与process-deadline既有固定transport均由3项静态检查通过；本轮不改资格。 |
| 同文件旧前驱、A项历史版本、Q14固定AI对 | 是已审过渡/历史事实，不要求等于当前源码；不得批量替换。 |
| preparation-retirement-qualification.mjs 的Django65f/AI f97 | collector核对原inventory及历史生产者范围，不是当前Sales schema准入表；保持。 |
| retract-startup-repair-fence.mjs 的95331… | 20261012精确abort-only恢复工具资格，非当前通用部署声明；保持。 |
| 固定native-tools/控制bundle manifest、已封存PREPARED/plan/receipt | 不作为当前源码可随意刷新的pin；本轮未改写、未采用、未重放。 |
| 旧validation底层CHECKS/evidence引用 | raw SHA仍可核；保留旧历史，不替换成当前声明。Sales新proof改指本轮新执行证据。 |

该盘点不是对未知生产目录的全盘完整性承诺；它列出了当前源码内本次相关的同类约束，没有执行生产gate。
