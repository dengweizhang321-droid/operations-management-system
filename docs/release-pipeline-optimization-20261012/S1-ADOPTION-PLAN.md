# S1退出码修复：精确宿主采用方案

2026-10-13。本轮只做只读现场核验、私有载荷/旧文件保全和隔离验证。**未部署、未停服、未修改生产入口或用户主检出；S2保持离线，无自动hook；完整CI建设暂缓。** 新工作树基线为`565f7073f71691690039c1c83c757ec2f32d731f`，本报告不是生产执行批准。

建议用户在下列两个选择间直接决定：

- **A：批准本次精确单文件宿主采用及同文件受控恢复。** 仅将`D:\运营管理系统\tools\operations-system-service.ps1`由下列旧摘要换成候选摘要，包括同一文件的原DACL精确还原；最终owner、group、权限及继承描述符必须原样，不扩权。明确不进行Worker/Django应用发布、数据库操作、服务Start/Stop/Restart、快捷方式/计划任务/guard重绑、主检出整体同步或S2 hook。这是需要本次明确批准的限定宿主操作范围，不是现有v3/v4自动减免资格，不改变常规strict/full规则。
- **B：保持宿主旧文件，继续仅保留仓库修复。** 如果平时只使用桌面应用，S1不会改变其直接调用总控的路径，可暂缓；不能因仓库已合而写生产已采用。以后走常规应用发布仍须其自己的strict/full准备、验证和授权，且另列宿主S1安装步骤；仅在不可变source-snapshot含S1或执行未包含S1的protected-entrypoint apply，都不能更新实际宿主S1。

## 唯一持久目标及载荷

| 项目 | 确定事实 |
| --- | --- |
| 现场目标 | `D:\运营管理系统\tools\operations-system-service.ps1`，普通非重解析点文件；当前23155字节，与主检出2f55的该文件相同，尚无S1修复 |
| 旧SHA-256 | `aff5a37974251422281e75d150292115b014f9265b5895747bdae05d9b028b6d` |
| 新SHA-256 | `38b1e5b2de4e20c6a0e75a8a8ab400c738a7fb0bdfae64803cfe14d97d48e97d`，23456字节、UTF-8 BOM |
| 源码来源 | 原产品`2f21c238d2a4766caad547d08be63acab769ab08`；固定交付4968baed；仓库子集`97282a6bced9752f32deb35ba346475e3a32a11c`；main565f字节相同 |
| 私有载荷目录 | `D:/codex-artifacts/release-s1-adoption-20261013/candidate-v1/`，payload/和rollback/各一文件，manifest.json及四份已安装原子安装库的只读比较副本；不是已安装Worker候选。最终推荐原语另绑定到qualified-plan.json，不把比较用rename库当最终元数据保全实现 |
| 载荷manifest摘要 | `5671c3a1cc5d50844d4393c1ceace064b0543c4cd9c9574345d06e91c1b1b201`；载荷/旧文件/库逐字节核验，摘要与完整内容投影见[候选清单](evidence-s1-adoption/candidate-manifest.json) |
| 最终采用资格清单 | [qualified-plan.json](evidence-s1-adoption/qualified-plan.json)，SHA-256 `feca5a1efc2633970a1d3f4cb2bacbccac1fc62c79340a48aa23126a50c220f9`；绑定File.Replace＋原DACL还原及两shell精确模型，不使用比较用rename库认领最终权限保全 |
| 文件元数据 | 当前原Get-Acl返回的owner/group/DACL SDDL摘要`5dd22c94c50ddb891a9197e085dae5ac86abb7d17cde20b482384bf5bad5a6cf`；最终PS5/PS7私有模型在安装前逐字节重现该描述符，替换＋原DACL还原及文件恢复后都精确相同。执行前还须复核调用者身份、owner/ACL、单硬链接、父级实体路径及其他未识别保护；不宣称完整系统SACL/全runtime ACL验收 |

本次只保原Process.Handle、拒绝null退出码再转int、在非零错误中保实际退出码。两shell AST确认21函数库存/CLI签名相同，只有`Invoke-ControlledScript`函数体变化，其他20函数体相同。500ms轮询、输出/JSON、参数、互斥、后台receipt、唯一引擎及业务调用均不改。

采用时只改这一**已有持久文件**，同目录create-only暂存、sync后`System.IO.File.Replace(stage,target,uniqueBackup,false)`，保留实际被替换文件备份；然后仅用原始描述符恢复该文件DACL并精确回读，不删旧目标再写，不修改其他已有文件/目录权限。备用文件和create-only回执保存在同D盘私有输出目录。不快进/reset主检出；原六处修改和未跟踪文件仍由原任务处理。采用后主检出会多出这一处明确的S1文件改动，Git HEAD仍可保持2f55，不把它混入原任务六处改动或自动提交。

## 已核实入口：哪些真的经过S1

| 入口 | 现场绑定 / 调用链 | S1作用边界 |
| --- | --- | --- |
| `D:\运营管理系统\运营系统.bat` | 同目录PS5→service.ps1；start/start-bg/stop/stop-worker/restart/restart-full/restart-bg/status/logs及菜单；cmd转发ERRORLEVEL。物理CRLF与原Git声明换行一致，未改bat | 直接受益的生命周期包装入口；失败子命令不再因null被转成0 |
| npm `system:start/stop/restart/restart:full/status/logs` | 现场package与main相同，指向同一个service.ps1；入口参数与源码一致 | 直接受益；不增加npm依赖或更换命令 |
| 桌面与开始菜单“运营管理系统” | 两份实际快捷方式指向不同LocalAppData目录内的Launcher.exe；两份launcher.json都绑定主检出`tools/operations-system-control.ps1`及pwsh | **绕过S1**。不换快捷方式、exe或config；本修复不能认领桌面Start的其他退出码/超时问题 |
| `运行项目.bat`、普通npm start/dev | 直接汇聚总控/唯一worker-local-service引擎 | 绕过S1，不改这些路径 |
| Worker登录启动项 | 固定21c release内worker-local-service.ps1→deployment-manifest.json | 不经过宿主S1；不重绑 |
| Django登录启动项 | 固定django-sales/app/tools/django-runtime-supervisor.ps1 | 不经过S1；不启停 |
| 看门狗计划任务 | e033版本Watchdog.NoConsole.exe→该版本watchdog脚本及安全只读wrapper | 不经过S1；不改driver-binding或调度 |

这张表核已知仓库调用者、实际快捷方式/config/登录项/计划任务，不声称知道用户使用频率或全机任意外部动态调用。服务包装器的背景模式仍只回后台启动/PID receipt，不是最终服务成功；S1只改善背景子脚本的真实错误，未新增异步终态回传协议。

## 当前实际运行版本与绑定

2026-10-13上海04:03–04:06采样，原只读resolver完整核生效链及已安装guard：

- Worker effective head：`20261011T090355Z-21c2645a63247749`；manifest `6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4`；guard `92eff2b54a9227f954a7f223a698f1c3c0e9d45168a7dc758188523311812e01`；220个successor、0未完成记录，protectedSourceRoot仍主检出。current-deployment的9a33只是bootstrap，不冒充effective head。
- Django实际`app/deployment.json`：`85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09`，appFingerprint `fc33df2880e62e52415aa66655b1d380356023d779495c1d739324bf5fda55a1`；没有换成main最新源码。
- 看门狗正式任务仍固定e033版本。桌面程序两个安装目录均绑定总控，未执行exe验证或打开页面。
- Supervisor PID36568、5791 helper PID23536、3000 workerd PID17184经现有e033只读原生元数据观察与对应路径核对；supervisor出生时间按原CIM微秒契约匹配receipt。未作HTTP/业务健康验收，不能从身份与监听宣称当前完整Ready或连续SLO。

当前guard原始12入口列表不含service.ps1，也不含运营系统.bat；它包含package、旧启动bat、总控、worker-service、guard/release/rotation/fence/deadline等。现场总控/worker等是正式绑定的字节，与用户主检出六处改动有关，不能用main覆盖；S1的安装载荷不得带它们。源码定义和**实际guard receipt**一致核验，不按名称猜测。隔离验证后再次回读这12入口，全部摘要保持。

初次CIM无法读七个解释器的ExecutablePath/CommandLine，原样保留[首次观察](evidence-s1-adoption/host-facts.json)。随后仅提取并复用e033已安装的只读native helper（PROCESS_QUERY_LIMITED_INFORMATION，无VM_READ/提权/控制进程），补齐八个相关PID，0未知、0命令引用S1。原先按100ns直接比较出现0.7μs精度差，按该已安装helper的原微秒比较契约闭合；[第一次native观察](evidence-s1-adoption/native-completion.json)及[补证](evidence-s1-adoption/native-completion-v2.json)均保留，不把初次缺失改成无占用。**这些是旧时点观察，执行前必须重新核验。**

## 已完成的最小充分隔离验证

| 检查 | 结果及实际范围 |
| --- | --- |
| 真实S1原退出码夹具 | PS5、PS7各通过原exit0/9/259、缺码拒绝、父直接退出/五秒后代输出、异常后独立进程获得锁；原断言/预算保持 |
| 实际包装分支接缝 | 每shell21例，共42例：Start JSON/文本、Stop全后端/仅Worker、热/完整Restart、Status的0/9/259；原函数加载后只覆盖私有ProjectRoot、控制子脚本、测试mutex等资源，不重写被测分支。每shell恰21次子调用，无额外调用/重试；全部真实受控子进程，未运行生产Status/Start/Stop、浏览器、HTTP或DB |
| 安装边界与旧原语比较 | 原8例通过：私有模型安装/BOM/邻近文件/模型ACL保持、旧字节恢复、旧摘要冲突拒绝、候选篡改拒绝、恢复拒绝第三方改动、非目标/硬链接/junction拒绝；这些边界用于最终方案，但首个模型多了临时祖先的一条继承ACE，不冒称精确生产描述符模型 |
| 最终精确元数据模型 | PS5/PS7各重现真实owner/group/DACL描述符5dd2；File.Replace不忽略合并错误、验证实际被替换旧文件、还原原DACL，再核新字节；同原语恢复旧文件及DACL，最终描述符完全一致。不同stage描述符不被当作目标应有权限，原/候选备份摘要均核验 |
| 静态两shell复审 | 21函数、仅1函数体改变，其余20/CLI签名一致；原源/目标、安装库与调用者逐字节/路径核验 |
| 已有子集验收复用 | 原17项服务/隔离生命周期切片与改动lint通过，S1三文件仍精确原字节；不重做前五任务，不认领全部12组件/23 reader-writer冷启动 |
| 原常规策略核验 | 实际调用原classifyImpact/recoveryDecision，仍`strict/full`，原requirements保持；没有改路径白名单、full/pending/门禁或发虚假L3回执 |

结果/驱动摘要与原输出见[evidence索引](S1-ADOPTION-EVIDENCE.json)。本轮辅助夹具先有真实失败：PS5中文断言缺UTF-8 BOM；策略脚本绝对import/默认代码页；AST两侧-join优先级；补充ACL观察继承了PS7模块路径。另有实际元数据模型失败：复制生产父目录owner到私有对象不允许、临时祖先增加ACE、原rename或File.Replace重算自动继承标记、无必要的owner/group setter被拒。全部原记录保留，不列作产品通过；最终模型只复制父目录Access到私有父目录并阻断无关祖先继承，原生API重现真实子文件描述符，最终安装只还原原DACL而不设owner/group/提权。真实最终描述符必须全等，不忽略AI标记求通过；产品/原退出码断言不变。

## 五项独立决策与采用资格

| 判断 | 本次方案 |
| --- | --- |
| 验证强度 | 按实际宿主包装器严格核退出证据、分支契约、锁/后代、原子安装/CAS前置检查/ACL/恢复与原依赖；不把不切服务当免验，也不称完整应用冷启动/L3已完成 |
| 数据库保障 | **常规应用发布仍strict/full，S1不符合v3被动展示或v4十工具资格。** A仅请求一次独立宿主文件安装/文件恢复操作范围，其明确执行链没有DB连接、迁移、Backup/Restore或服务动作；不伪造recoveryDecision=not-required，不把此范围扩展到之后Start/Stop或应用发布。若用户不批准这一精确宿主范围，维持现状；走常规发布时按原full另行准备，不能自动套用A |
| 维护范围 | A无需停Worker/Django/PG，也不进入应用维护；只在原系统控制mutex下短暂排他安装这个文件，期间不提交其他生命周期命令。当前未尝试获得真实mutex，不把它写当前空闲；拿不到时拒绝/延后，不停服务抢锁 |
| 切换方式 | 同目录create-only暂存＋sync＋File.Replace（禁止忽略元数据错误）＋仅原DACL精确还原；前后校验目标owner/group/DACL和完整guard/入口不变；不Restart、不执行Worker plan/apply、DjangoPrepare/Deploy、不改source-snapshot或正式启动项 |
| 恢复边界 | 只恢复保全的旧宿主文件；恢复前目标必须仍为本候选摘要、无活动包装器且取得原mutex，保ACL/旧文件摘要。第三方改动/未知不覆盖。不能回滚DB、撤销已发生子命令效果、重放未知动作、恢复D1或沿用f15授权 |

这里没有创造通用“宿主文件低风险免备份”规范，也没有用拆分隐藏同一产品的验证缺口。A需用户对上述精确操作范围明确批准；本报告自身不豁免既有发布规则。若范围扩大到受保护入口、安装模块、应用制品、启动钩子、数据库或真实服务动作，A失效，回到该范围原完整发布/验证/恢复及重新批准。

## 批准A后执行的固定流程（本轮未执行）

1. 再读原目标/候选/rollback/资格清单摘要、文件长度/BOM、实体父链/单链接、owner/group/DACL、调用者与主检出状态；复核effective head/guard/Django/快捷方式/任务绑定。目标不再aff5、权限/调用者/额外保护或绑定变化、有活动S1/后台/Menu或未知解释器/路径别名时，不安装。不得换管理员/其他身份来绕过失败；身份或权限模型不符先重做相应私有模型。
2. 非阻塞获取`Local\TERUISI.Operations.SystemControl.v2`；不抢锁、不杀进程、不自动关闭菜单。确认没有其他编辑器/任务正在改此文件或发布正在依赖主检出来源；必要时延后。保全当前旧字节和ACL/归属记录，核已有rollback确为同一前驱，输出目录create-only。
3. 锁内立即再核旧/新字节、原描述符与允许目标，create-only写同目录随机stage并flush；对唯一target执行`File.Replace(stage,target,uniqueBackup,false)`。核实际被替换旧文件摘要/元数据。Win32只用`DACL_SECURITY_INFORMATION=4`将旧DACL及控制标记原样写回同一target；不写Owner/Group、不调整权限主体或父目录、不忽略任何最终描述符差异。暂时重算标记的窗口不作成功点；effective ACE有新增/owner-group意外变化或还原失败保持未完成，保全备份/当前字节后只走明确受控恢复，不强行chmod。
4. 核新SHA、BOM、原owner/group/DACL精确相同及所有邻近保护入口未变；释放安装mutex。用**已采用文件的库模式**运行相同私有退出码/分支验证，覆写到私有日志、测试mutex和mock子脚本，不调用真实生命周期/旧Status。再读原生进程/版本/入口绑定，记“宿主S1已采用、服务版本未更换”，不记全Ready或真实冷启动验收。
5. 安装/元数据或库模式契约确有回归时，先区分已安装/尚未安装及未知结果。只在目标仍是新摘要、实际被替换旧文件/描述符可信且无活动调用时，同样锁内File.Replace恢复aff5并还原原DACL、核最终描述符；任何漂移留两份证据并拒绝覆盖。**新包装器正确报告原子命令失败不是回退理由**，不为了恢复表面exit0而回退，也不自动重试该命令。

File.Replace保留替换备份、不出现先删空档；上层摘要前置检查＋合作mutex**不是针对任意第三方rename的内核CAS**。其他写者无法排除、ACL不等或结果未知时不可执行/盲目回退。这里没有把普通rename的权限继承当作充分元数据保全。依据[Microsoft File.Replace](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.replace?view=net-7.0)禁止忽略属性/ACL合并错误；实际模型仍发现继承标记重算，所以最终精确相等以实测为准。仅恢复原DACL的API范围参考[Microsoft SetFileSecurity](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-setfilesecurityw)。A明确包含同一文件原DACL还原，不包含真正权限扩大、业务/数据库状态恢复或后续运行Start授权。

## 当前交付与剩余决定

私有载荷和旧文件已保全，所有上述必要隔离检查完成；主检出旧S1与12保护入口仍原样，生产采用为false。S2和完整CI未新增建设/采用，本计划不承诺净省分钟数。

唯一待用户决定的是A的精确宿主文件写入/文件恢复授权，或选择B暂缓。采用时的即时占用、版本/摘要/ACL和同一前驱复核是执行前门禁，旧观察不能提前给它们通过；若不成立则拒绝，不需靠扩大历史lint、全域CI或完整应用冷启动求通过。
