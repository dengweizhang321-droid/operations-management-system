# 结构与原生制品准备

本期仅新增结构151→152（ai_assistant.0086）：业务意图、动作、追加审计三张AI表。工作计划和库存草稿复用原领域对象，不另建事实表或搬迁数据。

新增152有限安装器使用真实pi-business-mandatory-code-checks-v1、code-checked材料，明确functionalValidationPerformed=false；不伪造功能演练。旧150/151材料保持原字节。实际采用保留来源、父链、authority、权限、原意图、receipt、版本、互斥及CAS门禁。

addition/candidate/catalog和ai-0086 recipe登记152，部署、启动、备份及恢复按实际结构路由。PrepareApp复制完整backend、六店Pi业务候选及受控店铺注册表。复制候选不代表n8n已发布、激活或执行。

Skills使用独立1.2.0包，保留原1.0.0/1.1.0。镜像由原rootless builder和锁定资产生成，未启动容器验收。摘要见 [image.json](image.json)。已有Runner经PreparePiUpgrade、PiUpgradeCheck及获准后的UpgradePi采用；首次PreparePi不是升级。

后续Runner升级按新来源保存prepared/intent/result，保留上次固定原件；未决或unknown计划阻止新目标。准备不启动Runner或切换生产user unit。AI writer复用已有机器人配置和DPAPI路径，不输出密钥。

必要的固定准备控制器更新经install-main-prebuild准备及原adopt入口，保持队列、rotation、CAS与unknown保护；它只更新制品准备工具，不是应用上线。最终main冻结后调用prepare-only，原生preparation/PREPARED.json才证明就绪。没有明确“上线”授权，不执行生产迁移、Runner切换或n8n发布。

只读元数据见 [native-metadata.json](native-metadata.json)，历史PUBLISHED索引和较新SUCCESS分别解释；语法证据见 [syntax-checks.json](syntax-checks.json)。最终提交和制品由任务交付记录填写，不把历史回执当成本次上线。
