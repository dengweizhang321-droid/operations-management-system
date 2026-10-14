# 本次上线前驱换绑核查

2026-10-15，用户在本聊天明确“确认上线”。当前代码仍为已验证发布源 `86fa943d`，原市场代码验证及46次调用账本复用，没有增加真实模型调用。

等待确认期间另一项普通权限发布把Worker前驱从 `20261014T142300Z-5417c162f772702e` 切换为 `20261014T160504Z-80bb62ecc29f92c5`。两者应用源8342文件、完整源指纹 `987c716f1680d82bc9c9d838293eaca93219ea562045a97eddd031072457afaf` 相同；运行环境和前驱绑定变化，因此原计划不再用于切换，使用原prepare重建新绑定候选。

完整实物比对还发现非任务文件换行差异。保留当前Worker四个前端/测试文件、当前Django两份既有migration的原始字节后，Git内容归一化仍是原提交且工作树干净。所有60个受测市场/直接依赖源码SHA不变。新Django包除市场两个Python文件、deployment元数据及原PrepareApp R2自检的CF传输缓存外，其他字节和全部migration都与当前安装一致。

CF缓存仅改变 `clientTcpRtt`、`tlsClientRandom`、`tlsExportedAuthenticator`四个握手/finished叶子、`edgeL4.deliveryRate`，类型保持；其余JSON完全相同，不保存原值。它属于既有隔离R2自检产生的传输元数据，没有扩大为任意缓存忽略规则。

按最新任务模型分工的前驱冲突触发条件，请求独立 `gpt-6-astra`、`high` 上下文只读核查，未参与本轮实现；工具未返回独立实际型号证据，因此记录请求配置而不冒称实际型号已另行确认。核查结论未见方案级阻断，并确认：原DeployApp会核实维护、应用停稳、PG身份和prepared前驱；原Worker apply核cutover/Worker链，因此维护内先Django再Worker可行；`KeepPostgres`支持封包，未使用不支持的`IncludeBackend`。Django DeployApp/HardenAcl的原输出为文本，按direct-exit-files保存并以目标manifest回读，不误套统一JSON解析。

执行沿原唯一入口及原rotation lease，未知只留started/失败与维护，不在finally自动恢复或重放。完成判定只核两个目标组件、必要服务、启动绑定和正式识别暂停/计数保持；无额外综合验收。完整原始核查、准备和操作记录位于 `D:/codex-artifacts/market-ai-blockers-production-20261015/`。
