# 21c 冻结包非复用 transport 静态审查

**当前 targeted CLI 不能仅改 spec 切到非复用 transport，NRT01 阻断。** 实际包 `20261011T090355Z-21c2645a63247749`／manifest `6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4`，batch源码e0d2e1d、admissione877cbf8、retryc520faf9、helperb735均按小文件SHA与keyFiles核对。旧872d/aed7批次尚是现存唯一ADOPTION_BATCH，新对象未出现，不预签。

`release-batch.mjs:658`对targetedBatchVersion必调validateNoDataCollector；`:25–26`却只允许in-process-content-evidence-v1。删除transport字段虽理论上会选`:689`的原子进程分支，实际先被验证拒绝；其他新truthy名称也被`:679`拒绝。须形成窄限定新规则／dispatch并重新冻结、复审及批准；新public API外置适配器也应作为新精确受审协议，不能借绕过CLI宣称原样支持。我未改代码或执行验证器。

全量路径自身保留完整SourceBinding与源码／Node／npm／环境／配置初末复算、前驱／测试／Django清单与收据门禁。无session不调用memory reuse。CLI只传phase，switch的step未定义，因而完整artifact／admission检查比in-process分步路径更多；其targeted-step早期门禁未同样触发，但实际consumer／Restore仍核新apply／deploy／ACL／consumer已passed。流程和耗时不能宣称完全相同。

重型内容／恢复工作之后仍核末chain／Django／WAL，再取Worker/helper和验收Status观察；保留真实完成时间、内部非负≤5秒与父进程响应年龄检查。原runProcess对子进程采用原600000ms或更早继承绝对期限，继承给后代，晚输出拒绝；不是全批55分钟保证。四暂态才重试，NotReady非retry；unknown仍阻断续接、生命周期不重放，每动作前仍完整采集。

**失败留证分布不等价。** in-process错误能直接将stages／attempts写父WAL；子进程CLI会先将Status attempt固定元数据create-only/fsync写自身_observations并输出stderr，但失败出口只给message＋exit1，父层拿到的是outer process metadata，未自动恢复child分类／stages／attempts。原临时输出会删除，不能凭SHA重建Status全文或猜组件。新方案应明确绑定真实child-side证据或披露父WAL缺口，不能称“取证完全不变”。

详见[NONREUSE_TRANSPORT_REVIEW.json](NONREUSE_TRANSPORT_REVIEW.json)。没有collector／生产CLI／Status／HTTP／SQL／锁、测试或整树／payload扫描，也未修改实现。旧214/215与普通通知失败保留，C性能未测；新spec出现后还须核真实transport、argv／cwd／closure、19步、原始SHA和批准范围。
