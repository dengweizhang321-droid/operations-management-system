# 已批准全景财务兼容候选采用（进行中）

用户在具体候选/追加维护影响交付后再次明确“批准”。本次授权绑定e3a/3184134a后继包及一次KeepPostgres应用维护，替代候选页等待许可状态；不重复139迁移/缓存回填、不改业务记录、用户/权限/预算，不业务补跑或主动外发。原候选与独立证据见 [交接](20261003-finance-edge-candidate.md)。

实际执行目录 `E:\codex-artifacts\netshop-scheme2-20261003\finance-edge-production`，maintenance `d57d8472603b4c509fa0f3ec5caf85e9`。原EnterMaintenance于14:52:19创建keepPostgres标记，完整排空后14:53:57更新drainedStopped，实际命令exit0返回backendStopped/postgresPreserved。当前最新前备份进行中；尚未部署或恢复，不冒维护已完成。

14:49—14:51预检：实际parent6b和候选318、receipt6e2不变；main/remote807185f3，primary干净，准备源仍bd96029b。原系统12Ready/exact_release，PG20664及n8n16852创建身份与上一轮保持。helper空槽ready；三条原自然等待5690/5696/5704保留。三个AI队列total0、备份console无非终态。市场workspace_fast旧503不能当通过；改用原market_reader/只读/7秒最小状态计数证实两running job均cloudpaused、livelease0，保原503证据。

后续严格执行最新前Backup/Verify/独立恢复→采用准确已审包/HardenAcl→后Backup/Verify/独立恢复及原Exit/Start→12组件/版本/启动绑定/资源/守护/渠道→原用户同月全景六源独立验收。具体步骤以原控制器要求为准；不擅自绕过排空、停止数据库/n8n、重复迁移或把prepared/结构健康冒业务通过。

## 实际部署与前后数据核验

前备份daily-20261003T065443Z-5cfab96246d8 / manifest `ff0597ddfc0da5b074595e73faa897b98a3bdd41f5eff1330a76b2670705ca6b`、dump `2c785c7d9985eb80454cf31ebf971186a003aad7907f82d77947f01a370258eb`、content `b250f5d973a68e71f6c1336653814a048c031fba1f0d591d4f427a7cab1c7328`，Backup及Verify成功。E独立恢复74793871d982/55897实际15:06:47—15:15:31，内容/profile一致、生产未改、隔离DATA正常清理；非作者独立E链审通过。

原DeployApp/e3a/6e2实际15:17:30 exit0，HardenAcl15:18:39 exit0。installed manifest318与财务源码0cbe逐SHA匹配，不新增迁移/回填。应用仍停止，当前尚未Exit/Start。

后备份daily-20261003T071934Z-3fb1777e8236 / manifest `d35a04684a546497fb76b686fbc8bc1ad1216c2e126f3f166520a0d889f02ddb`、dump `d3690c5de54bb86b2fad5293e2a3ab1bb99775730975d6a444b1580838320c64`、content同before的b250；Backup整体exit0及Verify成功。全部295表、完整profile/evidence、49角色前后严格相等，没有任何表豁免；139→139、私钥0。本轮netshop基线是自然业务后的25551，不能与早晨回填后25539混称。

原三份/两保护保持，before点及早晨139后点已按原规则轮转淘汰；当前为本次后备份与9月28/29两个既有保护点，旧点仅有历史证据，不冒现存恢复点。上午pre138私有安全保全独立保持。本次后独立恢复a3750aa99eee/E55897正在执行；只有实际完成后才退出维护/原Start/真实全景复验，不能称生产业务已恢复。

## 应用已恢复，真实全景验收进行中

后独立恢复a3750aa99eee于15:39:08实际完成exit0，expected/restored content b250及profile dcf6一致、生产/服务未改、隔离DATA正常清理。前后完整backup/restore/Deploy/Harden链及全部295表/49角色/证据逐字段一致已由非作者E审闭合；本次没有Install或新增迁移。

原ExitMaintenance d57成功，原Worker87 Start真实子进程27556于15:48:16结束exit0，实际started/supervisor24184。采用文件日志捕获，仅等待原控制器，不重复启动；运行Django318/139、Worker87。15:52:37原系统Status全部12组件Ready/exact_release，VerifyStartup verified；17实际首页assets均200且原字节一致。PG20664/n8n16852与before创建身份保持，原helper空闲、5413 error与原自然等待5690/5696/5704均保留。

原受保护Restore-WatchSupervisor入口返回并恢复Django supervisor3544，Status running/healthy。该入口的采集外壳39752发生输出尾挂；其原子命令已消失、仅conhost子，Root即时核验exe/创建时间/命令SHA后仅单进程Kill外壳，六服务身份逐项不变，未用树终止或服务Stop。该采集外壳exit-1/原函数控制器exit未知明确保留，不与前述Worker Start exit0混称。既有钉钉stdout精确connected，stderr非空217字节未称零错误流；本任务未发送测试消息。

自然15:55:24轮次task0与15:55:25 healthy快照匹配；第二轮与原用户同9月1—29设备店/SPU全景六源/八章独立复验仍待完成。当前不能由结构就绪推断旧S403已闭合。
