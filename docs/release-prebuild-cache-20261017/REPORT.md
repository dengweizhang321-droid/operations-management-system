# main 提前打包与重复复制优化

用户授权：合并后自动提前打包，用户仍手动点击发布；依赖不变复用，同包不重复构建，保留进度和实际成功提示。本任务不执行生产切换、维护、迁移或服务启停。

## 实现

- 固定 main 入口新增 `--prepare-only`，默认发布传入 `--deploy-only`。准备原子写 PREPARED，部署才写 STARTED；准备失败与未知发布分别保存。
- Worker 使用原 online plan/reusePlan，Django 使用原 PrepareApp/DeployApp，新增只读 VerifyPreparedApp 把原完整候选检查放到维护前。组件范围继续复用原 Git 完整差异计划。
- 本机 reference-transaction hook 监听远端 main 跟踪引用的已提交更新。隐藏 Node 队列合并事件，不依赖模型或常驻轮询。命名管道负责串行，终态票据绑定原始 SHA，避免进程退出或清理断点造成重复准备。
- 安装时定位并验证本机实际 Git，把其目录同时传入 hook 和手动入口的固定环境；不假设 Git 在默认 Program Files。新增实际 Git 执行测试与 9 项 hook 回归通过。首次实际触发的 fetch ENOENT 保留原票据，发生在候选准备前，修正安装路径后才新建后续准备。
- 同一精确准备包直接复用其依赖，不再安装；新 main 的新包沿用既有离线 tarball cache 和原 npm ci。新增 node_modules 目录缓存因实测更慢撤回，不交付额外缓存状态或 verifier 协议。
- 源码复制有界并发 8；构建末尾把同 staging 卷的 node_modules 转移到 release，不再复制第二份。后续完整树验证、原启动/apply 门禁不变。
- 构建明细日志分别记录源码快照、依赖、Vinext、helper、完整哈希、原合约检查、封包及候选复验，避免把构建封包总耗时称作编译耗时。

## 验证与采用边界

定向测试覆盖准备/发布分离、同包复用、组件范围、源码/请求/前驱漂移、失败与 unknown、Git 真实触发、并发与退出交接、锁 owner 终止、票据终态断点。原生 Worker/rotation/source-binding 与 PowerShell 5/7 原准备路径按直接影响验证。

独立审查请求模型 Sol High；工具未独立返回实际模型。修复持久 runner 锁、队列终态断点及 legacy prepare-only 落入部署发现，增量复审通过；实验目录缓存也修复其独立承诺问题后测量，最终因性能负收益撤回。未降低完整性要求。

有效验证：main/host/component/hook 相关 46 项通过；最新 main 冻结与旧成功/未知状态回归 7 项通过；原生 Worker/rotation 67 项通过；source-binding 23 项通过；PowerShell 5/7 准备与在线前驱 3 项通过；progress/command/host 原 10 项通过。首次原生测试缺少隔离 esbuild 解析路径，配置独立依赖后重新执行通过，不把失败启动算作有效验证。最终调用状态增量由独立审查者以无生产能力的子进程替身验证。

真实依赖计时保存在 `D:/codex-artifacts/release-dependencies-20261017-01/RESULTS.json`，复现脚本及撤回实现同目录保全。相同锁、Node/npm、离线 cache 的三次测量：原 npm ci 49.713 秒，目录缓存首次建立 146.417 秒，命中 162.923 秒。三者完整 31,248 文件树摘要相同，SWC 真实 native 加载、esbuild 转换和 workerd 版本验证通过。这是同机不同时间的局部观察，不是完整发布收益；目录缓存没有体现提速，故不采用。

固定入口安装和最终准备结果记录在包外 CONTROL-TOOLS.json、prebuild-queue 日志和精确来源的 preparation/PREPARED.json；只有后续用户手动执行完成的 SUCCESS.json 才是上线事实。main 之后有新提交时须重新获取并准备其对应包，不能复用旧 main 的完成提示。
