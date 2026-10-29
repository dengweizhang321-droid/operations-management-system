# Sales154 生命周期门禁：A/B 审阅发现（未登记资格）

结论：**对“提前 return 是否跳过既有 AI migration 保护”的问题，源码证据支持 A 的第二种解释：生命周期父证明承接＋唯一 Sales 增量＋独立数据库前置检查。不是触发条件互斥，也不是拿 catalog 校验替代生命周期门禁。未找到 B 所要求的保护绕过反例。**

这不等于“没有新增执行路径”。新 Python 验证分支与提前 return 确实存在，准入流程确有扩展，不能把原注释解释为整个控制流完全不变。本次没有登记任何新哈希，没有修改控制器、资格清单、已核销清单/记录或生产目录。用户要求先交发现，仍按此边界执行。

本报告基于提交 `d95852dd8542e95b8927787c1e7b082a16a5b215` 与当前 `491c14081e65a905d8cc31d4f6d37b086b8dbc34` 的源码审阅，不声称生产证据现状或整轮发布已经验证。独立审查与主审分别核对了对应源码。

## 1. 实际26行与控制流变化

`tools/django-local-service.ps1` 的变化是两个纯插入块：1790–1812为23行Sales分派，2210–2212为3个Python文件的PrepareApp复制项。其余原始字节行不变；前后完整摘要分别为用户给出的 `4ba1fcaf…0723a`、`98028cb4…580b`，HEAD等于后者。机器证据见 [CONTROLLER-DIFF-EVIDENCE.json](CONTROLLER-DIFF-EVIDENCE.json)。

新增块会调用有界Python子进程，verified后提前return，确实不再按PS顺序进入Pi153分支。Stop、DeployApp的执行主体、进程终止、维护锁及普通manage.py migrate调用本身没有被这26行修改；但不能因此宣称准入选择没有变化。

## 2. 互斥说法不成立

- 两个精确版本值分别为 `teruisi-sales-preflight-index-schema-addition-v1` 与 `teruisi-pi-native-schema-addition-v1`。同一个version字符串不可能同时等于两者，但PS条件是版本匹配 **或** 对应plan存在 **或** active存在，故不能推导两个完整条件互斥。
- `sales-preflight-index-addition-active.json` 与 `pi-native-addition-active.json`可以共存。Sales的`parent_proof()`必须读取、验证Pi153的active；Sales发布自己的active不删除Pi153的active。正常设计是父子证据链，不是互斥状态。
- `IntegrationOperationId`只是32位hex标识，两个目录分别为 `sales-preflight-index-additions/<id>` 与 `pi-native-additions/<id>`。没有跨目录全局唯一拒绝，即使ID相同也对应不同plan。Sales读取自己的plan，并用`parentReferenceSha256`绑定Pi父代，不靠字符串ID互斥保护。

依据：PS1792–1795、1815–1818；两Python模块的`VERSION`、`ACTIVE`、`directory()`与`publish_installed()`。

## 3. 生命周期保护实际怎样承接

关键调用是 **`sales_preflight_addition.parent_proof()` → `pi_native_addition._verify_active_with_base()`**，不是`pi_native_catalog.verify_catalog()`。

| PS选择的验证命令 | Sales实际校验路径 | Pi153保护落点 |
| --- | --- | --- |
| PrepareApp＋evidence → admission | Sales95–119 | 先对`runtime/app`的153父树运行Pi153完整active证明，再核Sales evidence、前驱、验证记录、代码和候选源码摘要。 |
| DeployApp＋operation → deployment | Sales345–355 → `_load_plan_with_base`143–160 | 对该Sales operation保存的`baseline`父树运行同一Pi153证明；另核Sales维护窗、prepared receipt、candidate evidence、源码/代码、前驱与候选manifest。 |
| PrepareApp/DeployApp无初次凭据 → successor | Sales323–324 → `_verify_active_with_base`167–185 → `_load_plan_with_base` | 重新核Pi153父树完整证明，再核Sales自己的plan、finalized receipt、install intent与154迁移闭合。 |
| Django migrate → release | 与successor相同 | 同样要求Pi153 finalized父证明和Sales finalized证明；PS返回后还有数据库门禁。 |

Pi153的`_verify_active_with_base`及其递归plan读取会核对：Pi active结构、operation、plan、candidate evidence摘要、prepared receipt、finalized receipt、install intent、父代引用、迁移摘要、preservation/defaults及permissionsVerified标志。Sales调用默认`installed=False`，因此未finalized的Pi153不能充当成功父代。

可将证明写为：

```text
P153(B) ∧ D154(C, B) ∧ Sales本阶段绑定
```

其中B是已验证153父树，C是154候选树。P153就是原Pi生命周期验证函数；D154由Sales53–59实现：B中全部migration保持相同，C唯一新增migration必须为catalog固定SHA的 `sales.0012_excluded_business_date_index`。迁移SHA使用common.migrations既有CRLF规范化规则，不能称迁移文件原始字节完全相同。

Pi153 `_verify_active_with_base`对传入root的唯一直接使用是其178行的`source_delta(root, Pi基线)`。因此先验证B的Pi证明，再证明C的153迁移投影等于B，保留了该父谓词；新增Sales专有权限来自另行绑定的154有限增量。直接用旧Pi153 verifier检查C，会因多出Sales0012而拒绝，这是其153边界；不能把这一必然拒绝等同于child绕过父保护。

## 4. catalog与数据库检查是另一层，没有替代上面的证明

普通迁移入口仍在PS3643运行生命周期门禁，随后在3662运行`integration_release_gate.py database`，最后才在3672运行`manage.py migrate --noinput`。Sales分支内return只退出`Assert-NoUnapprovedProtectedAiMigration`，不跳出该调用者。

`integration_release_gate.py:404–406`在Sales active存在时调用Sales `complete_database()`。该函数再次验证Sales/父代生命周期链，并检查数据库身份、精确154回执、已应用迁移集合、**不存在pending迁移计划**、defaults及catalog。Sales catalog再调用Pi catalog的完整结构/ACL检查，`permissions=True`没有放宽。

所以职责是两层并存：文件/回执生命周期证明防未经批准的代际与候选；数据库检查防实际库、权限、已应用集合或待执行计划不符。catalog父调用只能说明数据库层承接，不能单独证明PS return安全；本报告没有这样使用它。

## 5. 边界与拒绝路径（源码层证据）

- Pi active缺失、损坏、receipt未finalized或父引用变化：每个成功Sales命令均需父证明，异常传播；不会仅凭Sales marker存在就放行。
- Sales active只到installed：release/successor要求finalized，不能放行普通迁移。
- PrepareApp带其他版本evidence且Sales active存在：路由为Sales admission，版本/key集合不符合而拒绝。
- 错误operation：读取Sales命名空间的相应plan；缺失或绑定不符拒绝。有合法Sales plan时，仍要父证明和Sales全部部署绑定，不能从ID重名获得授权。
- 原有AI migration被新增或修改：D154有限集合/摘要比较拒绝；数据库阶段还要求无pending迁移。这里没有发现允许额外AI migration的成功分支。
- 新PS块只传admission/deployment/release/successor；Python这些分支在django.setup与install分派之前返回，不由这23行直接执行迁移。整个Python模块另有plan/install/finalize写路径，不能将整个文件称为纯只读验证器。
- Python错误退出码仍由PS328–330的`ConvertFrom-UniqueNativeJson`拒绝；status字符串不能覆盖非零退出。

以上是源码证明与拒绝条件推演，不是运行生产门禁、数据库或业务场景所得结果。没有为A登记资格，也不把未找到反例说成任意修改后都安全。

## 6. 资格登记与新静态检查

本轮资格清单未改。若未来用户另行批准登记，应追加精确的98028c…版本，而非替换4ba1fc…；旧版本及其他既有已审版本应保留用于过渡。这个动作本轮没有执行。

准确说，这个数组是**候选控制器的兼容例外**，不是生产已装hash白名单。`assertMaintenanceControllerGeneration`先接受installed与候选字节相同，否则查候选hash是否已审。因此4ba生产→980候选这一方向关键是980候选资格；4ba仍应保留既有资格，用于它自身作为候选等既有兼容场景，不应借本次更新删除旧已审事实。实际installed前驱仍由readiness的manifest/文件pins单独读取绑定。

已新增 `tests/maintenance-controller-qualification.test.mjs`，并接入CI独立step（lint后、build前），没有改66项白名单：

- Django/Worker的当前原始字节SHA必须位于各自已有候选资格数组。
- process-deadline的候选例外数组按原设计仍为`[]`；测试不新增豁免，而是要求文件精确等于四个已审前驱共同的transport SHA `5ae9617f…0fd`。这是已审固定前驱资格，不冒称数组登记。
- 实跑3项：**2通过、1失败**。Django98028c…未登记而失败，Worker与transport通过；失败原样保留，见 [QUALIFICATION-CHECK.tap](QUALIFICATION-CHECK.tap)。这份分支不是合并或发布就绪状态。

## 7. 制品与清单读取来源

未来若资格修复合入新提交，需要按新提交重新走原生prepare。现有491c1408整包及PREPARED不能冒充新源树：`publish-prepared-main.mjs:173–174`检查requestSha256和完整sourceIdentity，229、285还核源码未变。不能热改旧包内资格文件或改回执使其匹配。

资格模块来自**候选冻结源树**：固定控制入口启动`<packet>/source/tools/publish-main.mjs`；该文件12–14确定source，62相对导入候选`publish-prepared-main.mjs`，后者12相对导入同树的`manual-maintenance-continuation.mjs`。部署前资格核验传入这个source，同时只读实际installed前驱用于比较。

还须区分导入与执行：`publish-prepared-main.mjs:182`明确要求`!context.prepareOnly`才在复用包时运行提前资格检查；prepare-only在248–250返回，258的完整维护前资格检查位于其后。因此“已有PREPARED”本来就不证明维护资格已通过，这也是本轮需要把静态字节检查前移到CI的原因。这里没有把资格检查改到准备阶段，也没有修改受保护publisher。

因此，未来经审阅的新资格可随新候选源树在同一次准备/发布链生效，不需要先把资格清单单独发布到生产才能读到它，没有这个循环依赖。旧包仍是旧源码的完好制品；是否复用不变的底层组件由原生prepare机制决定，本轮不重打包、不复制旧回执、不承诺手工复用。

## 8. 本轮交付与实际检查

开发树 `D:/codex-worktrees/sales154-qualification-review-20261029`，分支 `codex/sales154-qualification-review-20261029`。只新增静态测试、CI对应step及审阅材料，没有登记新资格或修改生命周期实现。控制器三文件、资格模块、四禁改文件和e44清单的原字节摘要见 [UNMODIFIED-BASELINE.json](UNMODIFIED-BASELINE.json)，收尾均保持。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 新资格静态测试 | exit1；2通过、1失败，Django98028c未登记；故意不放行 | [QUALIFICATION-CHECK.tap](QUALIFICATION-CHECK.tap) |
| 完整ESLint，含 --ignore-pattern ".claude/**" | 56 errors /132 warnings，规范化消息内开发树根路径后错误指纹与原基线一致 | [ESLINT-RESULT.json](ESLINT-RESULT.json) |
| check:backend-boundary | exit0；violations: [] | [backend-boundary.log](backend-boundary.log) |
| check:pi152-acl | exit0；27 checks；no_database=True | [pi152-acl.log](pi152-acl.log) |
| CI现有白名单，--test-timeout=30000 | exit0；66通过、0失败 | [ci-allowlist.log](ci-allowlist.log) |

执行环境为本开发树Node v24.18.0、npm 11.16.0。独立依赖安装后只对本树运行既有XLSX补丁；未改package.json或lockfile。资格静态测试直接使用Node内置test、fs和crypto，没有执行PS/Python控制器，没有查询生产。

CI白名单不变，新资格检查是独立step。当前它会在CI中阻止后续build；这是保留的未资格化状态，不能称本分支已全绿、合并就绪或发布就绪。汇总见 [VALIDATION-SUMMARY.json](VALIDATION-SUMMARY.json)。
