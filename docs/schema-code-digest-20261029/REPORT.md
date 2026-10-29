# Sales154 结构材料摘要更新与静态门禁（待审核候选）

本轮基于 `deaa20f9d21fe1b6feea8d01a093f37ad3e92c9f`，开发树 `D:/codex-worktrees/schema-code-digest-20261029`，分支 `codex/schema-code-digest-20261029`。只修改开发树中的当前Sales recipe、对应新检查声明、静态工具/测试/CI和交付材料；没有准备制品、调用binder、采用控制包、运行生产门禁或写入生产/损失核销状态。

## 实算结果与根因

真实 `sales_preflight_addition.CODE_FILES` 是 **86项**，不是74。完整原始字节摘要表见 [CODE-FILES.json](CODE-FILES.json)，与d958逐项对照见 [DIGEST-AUDIT.json](DIGEST-AUDIT.json)。实算命令（本树私有Python，仅安装仓库锁定依赖）：

```powershell
@'
import sys
from pathlib import Path
sys.dont_write_bytecode = True
root = Path('.').resolve()
sys.path.insert(0, str(root / 'tools'))
import sales_preflight_addition as gate
print(len(gate.CODE_FILES))
print(gate.code_digest(root))
'@ | .runtime/check-venv/Scripts/python.exe -B -
```

算法没有修改：实际导入继承链得到去重后的CODE_FILES；逐文件调用真实 `common.sha` 对**原始字节**计算SHA-256；将 `{path: sha}` 通过 `json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()` 规范化，再SHA-256。最终键已排序，所以纯枚举顺序不会改变摘要；不能用手工解析的部分文件集合代替实际tuple。迁移源码摘要另有CRLF规范化规则，不要混入codeSha计算。

| 绑定 | 旧值 | 本轮值 |
| --- | --- | --- |
| codeSha256 | `6253cf315a9195c017df3a6e5949261cc4521601c26ab516a6d317ac868ded9e` | `e411415d0a76aae5ba8648e3db2b306c82dcd786262eb8171eff6e593875b1a1` |
| validationSha256 | `3d9183c9d0ed8e9350ac3c2c3a59585037be565a92ba2fb773fbd74cb64035f4` | `4cd684632b28cef6c4770bd452f6e211b29ae7f3b0da994a04d406eafa7dbb4a` |
| 本轮执行证据SHA | — | `0c749d77734d32bb5ec372ccf143e383805a26b1780f38146e51f2ddb6b2b58e` |

`d95852dd` 的完整86文件用相同真实算法复算，结果正是旧6253；旧CHECKS.sourceFiles也有完整86项并可重构6253。**原recipe当时有效。** 当前86项中仅 `tools/manual-maintenance-continuation.mjs` 相比d958有变化（`197c5378…` → `401d007a…`），其余85项相同。真正触发本次失配的是后续已批准的资格常量/注释变化，不是原摘要算法需要放宽。

`settings.py` 不属于原CODE_FILES；它属于候选的 `source_inventory`。本轮将其作为补充源码检查项，记录实际SHA、执行语法检查，并让新CI检查验证这项补充绑定；没有擅自修改gate的CODE_FILES或将它冒称为86项之一。没有收到用户手工74项的具体列表，因此不猜测具体漏掉哪12项。

## 新声明来自本轮实际执行

先实际运行 [run-mandatory-checks.py](run-mandatory-checks.py)，成功后才更新recipe与validation。新执行材料为 [MANDATORY-CHECKS.json](MANDATORY-CHECKS.json)，原始输出为 [MANDATORY-CHECKS.log](MANDATORY-CHECKS.log)。旧recipe和validation原字节另存 [RECIPE-BEFORE.json](RECIPE-BEFORE.json)、[VALIDATION-BEFORE.json](VALIDATION-BEFORE.json)，旧 `docs/jackyun-sales-preflight-20261029/CHECKS.json` 未改。

- Python：原集合56项＋settings.py，共57项，`compile(bytes, path, 'exec')`，不执行模块、不写pyc。
- Node：5项实际 `node --check`，不导入或执行发布入口。
- PowerShell：9个ps1＋2个psm1，分别通过PS5.1与PS7.6的 `Parser.ParseFile`；不执行脚本。
- JSON：14项通过真实 `gate.common.read` 的独立文件、大小、重复键及JSON检查。
- 迁移闭合：真实 `gate.source_delta` 对比Git父提交 `4a0a77646309391a173dbd95269f70ed893916af` 的私有migration-only副本，仅增加指定Sales0012，原163项源码保持。
- 迁移图/模型：`MigrationLoader(None)`、dummy数据库及禁止连接guard下确认154个图节点、目标只有AddIndex，MigrationAutodetector无差异；不运行迁移或业务SQL。

口径必须分开：候选有164个迁移目录Python文件，其中12个是 `__init__.py`，仓库migration节点152个；再加政策中两项Django contenttypes内置迁移为154。父树163个文件＝151个仓库节点＋12个init，加两项内置为153。首轮把非init文件数当成代际的诊断断言失败，保留于 [MANDATORY-CHECKS-FIRST.log](MANDATORY-CHECKS-FIRST.log)；最终通过的是明确核政策和实际迁移图的修正版，没有删掉数量约束凑绿。

三项声明继续如实为false：

- `productionTouched=false`：检查只读候选源码和Git对象，所有临时文件在开发树；未访问生产父代/数据库/生命周期入口。
- `functionalValidationPerformed=false`：本声明覆盖语法、源码闭合和静态模型状态；没有生产业务功能验收。另跑的CI代码单元测试与静态门禁反例不冒称业务功能验收。
- `fullBackupOrRestorePerformed=false`：没有数据库备份或恢复；私有Git迁移文本副本不是数据库恢复。

声明仍使用原gate要求的四项checks集合，版本/steps/generations/parentVariants不变；只是重新记录实际执行时间、新codeSha及新证据引用。migrationSha仍为 `f8f2c4c1d1007fd43934e7ac3d4e53a034d88f95efbd514e8d69d2e1dd633848`。

## 新静态检查与CI

`tools/check_schema_code_digest.py --recipe <相对路径>`实际导入对应candidate的gate，不解析字符串模拟继承集合，不调用candidate/bind/admission/parent_proof或数据库。

对当前Sales，它核验recipe/codeDigest/proof三者一致、validation原始SHA、steps/迁移源摘要、四checks及三项false声明；还核新证据引用、完整86项sourceFiles真实字节、三类syntax通过状态、migrationClosure通过状态和必需settings补充绑定。缺项、改字节、路径越界或重新绑定引用但仍使用旧source map都拒绝。

静态检查本身不证明历史检查真的执行；该事实由本轮执行记录及原始日志提供。输出中的 `declaredChecksExecuted:false`、`parentVerified:false`、`databaseContacted:false` 明确区分这三个边界。

CI新增独立step，按backend/requirements.txt提取精确psycopg pin创建私有venv，运行15项私有反例及当前Sales recipe检查；原控制器3项和66项白名单保持。CI明确选择当前153→154 Sales，不宣称所有历史recipe都适用于当前源树。

## 其他同类钉子：一次列清

完整表见 [PIN-AUDIT.md](PIN-AUDIT.md) 和 [RELATED-RECIPE-PINS.json](RELATED-RECIPE-PINS.json)。另外7份旧recipe的codeSha均与当前代码不匹配，包括PiBusiness75项（当前39c77fbb…）、PiNative80项（当前e5de94d4…）；它们的对应candidate有同名实算门禁，当前直接套用仍会拒绝。

这些旧材料目标为148–153，不能为让全表变绿，把完整154源码的迁移摘要填进旧过渡证明。其validation引用原字节、step摘要和对应目标代际的迁移投影仍匹配；历史执行声明没有在本轮重签。当前生产153→154计划只选择Sales。如果未来要使用旧过渡，必须以相应实际候选源树和父代重新审查、检查并绑定，不能把本轮Sales通过扩展给它们。

同样，原生前驱/限定版本对、retirement原inventory、旧abort-only恢复工具及已封存manifest是历史约束，不能统一改成当前源码hash。本轮没有删断言、缩减CODE_FILES、改通配或修改禁改文件迎合旧摘要。

## 文件变更

| 文件 | 原因 |
| --- | --- |
| `config/main-schema-releases/sales-0012.json` | 更新真实codeSha与本轮validation原字节SHA。 |
| `docs/jackyun-sales-preflight-20261029/sales154-mandatory-code-checks.json` | 重新声明本轮检查时间、代码摘要及新执行证据引用，不沿用旧执行声明。 |
| `tools/check_schema_code_digest.py` | 通用显式recipe只读静态验证；Sales证据增加完整成员及补充范围绑定。 |
| `tests/schema-code-digest-static.py` | 15项私有真实gate反例/正例，覆盖未同步摘要及材料缺口。 |
| `.github/workflows/ci.yml` | 接入当前Sales检查和其反例，保持原3项及66白名单不变。 |
| 本任务文档、执行脚本与日志 | 完整成员、新旧hash、必需执行与同类pins审计。 |
| `.gitattributes` | 对本任务原始证据及当前Sales validation设置窄范围字节保留，避免行尾转换改变验证摘要。 |

## 实际结果与交付边界

实际摘要检查passed/errors[]；私有静态测试15/15；maintenance-controller-qualification 3/3；完整ESLint56errors/132warnings（规范化消息中开发树路径后错误指纹同原基线）；backend-boundary violations: []；Pi152 ACL27项；CI白名单66/66。原始输出均保存在本目录。

本轮86项CODE_FILES原字节全部未改，四禁改文件、settings.py、已登记资格实现及本地e44清单保持。没有修改任何生产目录、已采用bundle、已核销artifact-loss记录或冻结包。独立复审通过只代表本轮源码检查与材料一致性，不代表已经运行freeze-source、生产父代验证、制品准备或发布。

本次没有修改已采用控制bundle的叶文件。现有main-schema-release读取冻结候选源树中的recipe/validation并调用同树binder，所以无需为这个源码材料更新单独升级e664控制包。用户审核并另行授权合并后，应按新提交重新准备；不能热改旧冻结包的recipe或回执。该后续准备及发布本轮均未执行。
