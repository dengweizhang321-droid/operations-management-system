# Sales154 控制器精确资格登记（候选，待用户审核）

本轮依据用户在独立核验父子生命周期证明后给出的明确授权，仅追加候选控制器资格。开发树 `D:/codex-worktrees/sales154-controller-qualification-20261029`，分支 `codex/sales154-controller-qualification-20261029`，直接从指定最新main `822a45ac468b55f31b6bae8c003c6b0c8f6df3b8` 建立。没有基于旧491c1408继续开发，没有改写settings.py，也没有准备制品、采用、发布或执行核销。

## 精确变更与依据

| 文件 | 改动 | 为什么 |
| --- | --- | --- |
| `tools/manual-maintenance-continuation.mjs` | 新增 `sales154SchemaAdditionDjangoScriptSha256`，在Django候选数组末尾追加；补审阅注释 | 正式登记用户已批准的98028c字节，不改准入函数、不移出控制器、不使用通配。 |
| `tests/maintenance-controller-qualification.test.mjs` | 原样承接上轮ab4af41e的三文件静态检查 | 同一份测试先复现2通过/1失败，登记后自然3/3；没有改测试来转绿。 |
| `.github/workflows/ci.yml` | 承接上轮独立资格检查step，放在lint后、build前 | 让控制器字节漂移在CI阶段可见；保持原66项白名单不变。 |
| `tests/manual-maintenance-continuation.test.mjs` | 当前仓库字节断言更新到新已审常量；精确数组期望追加第三项；新增Sales154代际正负例 | 保留历史资格及拒绝断言，覆盖新旧方向、单字符摘要修改、跨控制器与未知名称拒绝。 |
| 本任务文档与原始日志 | 来源、保护摘要、实际检查输出、独立复审 | 将资格声明与已批准的审阅结论、测试证据绑定。 |
| `.gitattributes` | 仅本任务JSON/TAP/log原始证据保留字节 | 防止Git行尾转换改变证据摘要；不影响应用或控制文件。 |

旧常量原样保留：

```text
aDescendantCreationGuardDjangoScriptSha256
4ba1fcaf3cd1568a64098a9d2d32039f850ec2db1da4f81aa97fa3ab9530723a
```

新增常量：

```text
sales154SchemaAdditionDjangoScriptSha256
98028cb49195b7b145c74fdb5205e949e6152d065ce926265cd5773e8b00580b
```

Django数组顺序为原PiNative资格、原4ba资格、新980资格。Worker数组与process-deadline空候选例外数组均未改。数组属于候选侧兼容资格；旧已装控制器的实际前驱证据仍由原readiness pins校验。正反方向单元检查只证明资格函数接受，未执行实际部署或回滚。

## 已批准审阅结论如何写入注释

该控制器字节来自d95852dd：23行Sales154 schema addition前置分派，以及3项PrepareApp复制内容。Sales verified后return，确实跳过同函数内Pi153的PowerShell分支。

Pi153保护由 `sales_preflight_addition.parent_proof` → `pi_native_addition._verify_active_with_base` 完整承接，四种成功路径重验父代生命周期证明，再限定唯一Sales0012增量。migrate前独立 `integration_release_gate.py database` 调用与数据库保护仍保留。依据是父子证明，不是互斥，也不是用catalog替代生命周期。

新增注释明确写出了上述事实，没有声称“完全没有新执行路径”，也没有加入“no legacy execution limits are changed”之类表述。控制器本身、Sales/Pi验证器及数据库门禁代码没有在本轮修改。

## 静态检查的自然转绿

静态test来自ab4af41e，SHA与上轮用户实际运行的版本相同，见 [BASELINE.json](BASELINE.json)。在新822树中，登记前实跑仍是2通过/1失败；登记后不改这份test，实跑3通过、0失败、0跳过：

```text
ok 1 - repository django-local-service.ps1 bytes have an explicit reviewed candidate qualification
ok 2 - repository worker-local-service.ps1 bytes have an explicit reviewed candidate qualification
ok 3 - repository process-deadline.ps1 remains the exact already-reviewed predecessor transport
# tests 3
# pass 3
# fail 0
# skipped 0
```

原始输出：[登记前](STATIC-BEFORE.tap)、[登记后](STATIC-AFTER.tap)。Worker实际SHA为 `1b8c5d4d61ba491d042f41ae91e9cc7b0d0c87a28536bac7b4c8a1e53fda761e`。process-deadline实际SHA为 `5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd`，按四个既有前驱共同transport资格核对，空例外数组保持，不虚称跳过或新增数组登记。

## 检查与边界

代际合同只选择了与本次资格直接相关的六个用例，实际6/6通过，见 [GENERATION-CONTRACT.tap](GENERATION-CONTRACT.tap)。没有运行该旧测试文件中读取生产原生transport的Windows专属用例，不把本次结果称为该文件全量通过。

| 检查 | 实际结果 | 原始证据 |
| --- | --- | --- |
| 三控制文件静态检查 | exit0；3/3，0失败、0跳过 | [STATIC-AFTER.tap](STATIC-AFTER.tap) |
| 六个资格合同定向用例 | exit0；6/6，0失败 | [GENERATION-CONTRACT.tap](GENERATION-CONTRACT.tap) |
| 完整ESLint，含 --ignore-pattern ".claude/**" | exit1；56 errors/132 warnings；仅规范化消息内开发树路径后，错误指纹与原基线一致 | [ESLINT-RESULT.json](ESLINT-RESULT.json) |
| check:backend-boundary | exit0；violations: [] | [backend-boundary.log](backend-boundary.log) |
| check:pi152-acl | exit0；27 checks；no_database=True | [pi152-acl.log](pi152-acl.log) |
| 原CI白名单，--test-timeout=30000 | exit0；66/66，0失败、0跳过 | [ci-allowlist.log](ci-allowlist.log) |

代码冻结摘要见 [CODE-FREEZE.json](CODE-FREEZE.json)。测试只在本独立树执行；没有访问生产服务或执行控制器。Node v24.18.0、npm11.16.0；独立安装依赖后只对本树运行既有XLSX补丁，package与lock未改。完整ESLint原始JSON在本树 `.runtime/qualification/eslint-final.json`，摘要记录于ESLINT-RESULT。

收尾逐项核验10个本地保护文件（含四禁改文件、三个控制器、lock、settings.py和原e44清单）保持原字节；settings.py等于822a45ac，未覆盖SQLite修复。生产绑定清单与27份已核销artifact-loss记录的名称和字节均保持，见 [PRESERVATION-CHECK.json](PRESERVATION-CHECK.json)。这些现场动作仅为有界只读摘要采样，没有执行损失核销或写入生产记录。独立增量审查结果见 [REVIEW.md](REVIEW.md)。

## 后续交付界限

本次仅代码资格登记候选。合并、按新提交重新准备制品及发布均等待用户分别授权。现有491c制品、PREPARED及生产状态不在本轮修改范围内。

后续资格从新候选冻结源树相对导入，不需要先发布生产资格清单。新提交改变源树身份，应按新提交重新走原生准备；不能修改旧PREPARED或旧源树来冒充新提交。底层不变组件是否复用由原生准备流程决定。
