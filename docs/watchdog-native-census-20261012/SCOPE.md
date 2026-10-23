# 精确诊断版本更新与最后收尾范围

- 新9文件诊断版本 `e0330d7aea1e17395cf56214c8c62e8d54c2e46359d30cce9296800c8802760c`；原实际安装计划 `7458df1fe403453129cfd982c2c88b492a0842d48f2c98b34fcbff49a4fd67aa`；执行意图 `4601d0bc81a61f273a4294e6e863671cdc91abe1adc18779621bd5d0351286fb`（262 pins）。
- 仅原安装器更新 Watchdog Task Action/不可变版本/installation/transaction；Triggers、Principal、RunLevel、Settings 不变。Django85cf/Worker6cff及原f15/spec960c不改，不新Backup/Restore、DB迁移、业务修正、业务服务停启或人工Check。
- 原60秒诊断期限不变。同轮双CIM及目标held句柄核验减少重复查询；一次真实只读预览38.073秒、12组件/4探针通过、29回执前后相同，不代表持续SLO。
- 安装成功后等实际计划任务两份新健康帧，严格晚于真实INSTALL_RESULT.at；300秒单轮，任一新不健康即拒。实际producer完成时间距末CAS不超过5秒，不能重盖时间或放宽。
- 仅原73条WAL/head5ae、17passed、唯一natural unknown下做一次原API补证为74条/18passed，旧失败保留；原bc79环境与6989旧批准继续最后Startup closeout。不能重放已完成步骤。
- 失败保owner及真实新/旧版本状态，不保证自动回退；只有原安装器内部事务提供其已有回滚行为。post-install回读失败不会假称已回退，不能自动再安装/扩大DB动作。
- 新版本尚未获生产批准、未执行；批准后仍由本人真实Windows UAC确认。最后三文件不在262意图中，审批同时绑定以下精确源码，生成运输前必须复验，不能重新接受漂移字节：
- `D:\.codex\worktrees\watchdog-native-census\运营管理系统\docs\watchdog-native-census-20261012\run-census-closeout-chain.mjs` — `025ecd3a073f136ff55ddc5f7d9bdc4597d742142153748d6d7675904e999239`
- `D:\.codex\worktrees\watchdog-native-census\运营管理系统\docs\watchdog-native-census-20261012\census-closeout-state.mjs` — `c94a9548717115c750e5ec190fc24337ae536dc4d634a360c6124e9284f7df2d`
- `D:\.codex\worktrees\watchdog-native-census\运营管理系统\docs\watchdog-native-census-20261012\prepare-census-transport.mjs` — `f21b76270e62bbcc85bc68b77dce6b3ce0f99a372ce9f895d6064d128af58f8d`
