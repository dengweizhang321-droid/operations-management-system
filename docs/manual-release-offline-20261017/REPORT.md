# 发布包专用缓存与强制离线安装

- 用户799c8cab尝试仍在候选npm ci阶段失败，`maintenanceStarted=false`。独立只读核验Worker有效head/240条完整successor、Django清单仍与前驱一致，当前无维护；旧STARTED、FAILED和日志保留。
- 之前仅设置prefer-offline仍允许联网。pacote的“no local data”来自缓存读取与解压整体失败，不能仅凭该日志断言缓存缺包；原日志未保存最初回退异常。相近深度隔离路径使用原runProcess、原npmCiArguments和普通权限复验：强制offline38秒通过；只加诊断hook记录原回退异常的prefer-offline模式39秒也通过，没有出现回退，最初回退原因未重现。
- 本次从锁文件SRI验证通过的已有内容建立发布目录专用npm-cache：601个去重tarball、205113473字节；未缓存的200个锁文件项不在本机安装闭包内，仍以真实Windows完整安装结果为依据。未更改锁文件、registry、全局npm配置或原生npm ci参数。
- driver固定npm cache为随包目录，offline=true、prefer-online=false，禁止安装失败时回退网络；保留原安装脚本、完整性、互斥、生命周期和未知结果门禁。`--check`仅检查缓存目录存在及展示离线模式，不冒称已经完成安装验证。
- 最终专用cache环境下，原runProcess＋bundled npm11.16.0＋Node24.18.0、原npm ci参数真实完整安装609包40秒通过，heap/InspectorProxy项目postinstall通过；Next16.2.6存在、Windows SWC原生模块真实加载、esbuild实际转换、workerd.exe版本调用全部通过。7项host/progress定向检查、Node语法和diff检查通过。
- 外部证据：手动发布目录的`NPM-CACHE-BUNDLE.json`、`OFFLINE-INSTALL.json`及stdout/stderr、`OFFLINE-NATIVE-CHECK.json`。证据仅表示此次隔离安装与工具检查通过，不表示正式候选构建或整轮发布已成功。
- 没有真实候选打包、生产维护、部署、迁移或服务启停；最终main入口仍由用户手动点击。
